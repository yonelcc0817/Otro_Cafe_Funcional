import prisma from "../config/database.js";
import { handlePrismaError } from "../utils/handlePrismaError.js";
import {
  emitCatalogChanged,
  emitMesaChanged,
  emitOrderChanged,
  emitStockDepleted,
} from "../realtime/events.js";
import {
  aplicarConsumo,
  bloquearConLimite,
  bloquearProductos,
  calcularConsumo,
  conciliarCantidades,
  reponerPedido,
} from "../services/stockService.js";

const parseLocalDate = (fecha) => {
  const [year, month, day] = fecha.split("-").map(Number);
  return new Date(year, month - 1, day);
};

const getLocalDateString = (date = new Date()) => {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const getDateRange = (date = new Date()) => {
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();

  // Para manejar zona horaria America/Havana (UTC-4)
  // Extendemos el rango para incluir pedidos que cruzan medianoche UTC
  const inicio = new Date(year, month, day, 0, 0, 0, 0);
  const fin = new Date(year, month, day + 1, 3, 59, 59, 999); // +1 día, hasta las 03:59 del día siguiente

  return { inicio, fin };
};

const getTurnoAbiertoHoy = async () => {
  const { inicio, fin } = getDateRange();
  return prisma.turno.findFirst({
    where: {
      fecha: { gte: inicio, lte: fin },
      estado: "abierto",
    },
  });
};

const createTurno = async () => {
  const { inicio, fin } = getDateRange();
  const turnosHoy = await prisma.turno.count({
    where: { fecha: { gte: inicio, lte: fin } },
  });

  return prisma.turno.create({
    data: {
      numero: turnosHoy + 1,
      fecha: inicio,
      estado: "abierto",
      trabajadoresActivos: [],
    },
  });
};

const getOrCreateActiveTurno = async () => {
  let turno = await getTurnoAbiertoHoy();
  if (!turno) {
    turno = await createTurno();
  }
  return turno;
};

const normalizarSolicitudProductos = (productos) => {
  const cantidades = new Map();

  for (const item of productos) {
    const productoId = Number(item?.productoId);
    const cantidad = Number(item?.cantidad);
    if (
      !Number.isInteger(productoId) ||
      !Number.isInteger(cantidad) ||
      cantidad <= 0
    ) {
      return { valid: false };
    }
    cantidades.set(productoId, (cantidades.get(productoId) ?? 0) + cantidad);
  }

  return { valid: true, cantidades };
};

const crearOactualizarPedido = async (req, res) => {
  try {
    const { codigoQR, productos } = req.body;

    if (!codigoQR || !Array.isArray(productos) || productos.length === 0) {
      return res.status(400).json({ message: "Faltan datos obligatorios" });
    }

    const solicitud = normalizarSolicitudProductos(productos);
    if (!solicitud.valid) {
      return res.status(400).json({ message: "Cantidad o producto inválido" });
    }

    // Buscar la mesa asociada al QR
    const mesa = await prisma.mesa.findUnique({
      where: { codigoQR },
    });

    if (!mesa) {
      return res.status(404).json({ message: "Mesa no encontrada", data: [] });
    }

    const operationId = req.get("Idempotency-Key");

    // Todo el alta va en una transacción: se bloquean los productos antes de
    // leer su stock para que dos pedidos simultáneos no consuman la misma
    // unidad (RF-9).
    const resultado = await prisma.$transaction(async (tx) => {
      const abierto = await tx.pedido.findFirst({
        where: { mesaId: mesa.id, estado: "abierto" },
      });

      if (abierto) {
        // Mismo orden de bloqueo que en la edición: primero el pedido, luego
        // los productos, para no provocar interbloqueos.
        await tx.$queryRaw`SELECT "id" FROM "Pedido" WHERE "id" = ${abierto.id} FOR UPDATE`;
      }

      const pedidoExistente = abierto
        ? await tx.pedido.findUnique({ where: { id: abierto.id } })
        : null;

      const productosBloqueados = await bloquearProductos(tx, [
        ...solicitud.cantidades.keys(),
      ]);

      const { items, ajustes } = calcularConsumo({
        productos: productosBloqueados,
        cantidades: solicitud.cantidades,
      });

      const registradas = new Map(
        items.map(({ productoId, registrado }) => [productoId, registrado]),
      );

      // Solo hay que avisar al catálogo si se tocó algún producto con límite.
      const cambioStock = items.some(
        ({ productoId }) => productosBloqueados.get(productoId).stock !== null,
      );

      // Ninguno de los productos pedidos tiene disponibilidad: no se crea un
      // pedido vacío, se informa al cliente (RF-12, RF-17).
      if (registradas.size === 0) {
        return { sinDisponible: true, ajustes };
      }

      const nuevosProductos = [...registradas].map(([productoId, cantidad]) => {
        const producto = productosBloqueados.get(productoId);
        return {
          productoId,
          nombre: producto.nombre,
          precio: producto.precio,
          cantidad,
          subtotal: producto.precio * cantidad,
          imagen: producto.imagen,
          done: false,
          delivered: false,
        };
      });

      const agotados = await aplicarConsumo(tx, items);

      if (pedidoExistente) {
        const productosCombinados = [...(pedidoExistente.productos || [])];

        for (const nuevo of nuevosProductos) {
          const pendiente = productosCombinados.find(
            (p) => p.productoId === nuevo.productoId && p.done === false,
          );

          if (pendiente) {
            const index = productosCombinados.indexOf(pendiente);
            productosCombinados[index] = {
              ...pendiente,
              cantidad: pendiente.cantidad + nuevo.cantidad,
              subtotal: pendiente.subtotal + nuevo.subtotal,
            };
          } else {
            productosCombinados.push(nuevo);
          }
        }

        const nuevoTotal = productosCombinados.reduce(
          (sum, p) => sum + p.subtotal,
          0,
        );

        const pedidoActualizado = await tx.pedido.update({
          where: { id: pedidoExistente.id },
          data: {
            productos: productosCombinados,
            total: nuevoTotal,
          },
          include: { mesa: { select: { nombre: true } } },
        });

        return {
          pedido: pedidoActualizado,
          ajustes,
          agotados,
          cambioStock,
          creado: false,
        };
      }

      const total = nuevosProductos.reduce((sum, p) => sum + p.subtotal, 0);

      // --- Lógica de numeración diaria ---
      const { inicio: inicioDia, fin: finDia } = getDateRange();

      const cuentaHoy = await tx.pedido.count({
        where: {
          createdAt: { gte: inicioDia, lte: finDia },
        },
      });

      const turnoActivo = await getOrCreateActiveTurno();

      const nuevoPedido = await tx.pedido.create({
        data: {
          mesaId: mesa.id,
          productos: nuevosProductos,
          total,
          numero_diario: cuentaHoy + 1,
          turnoId: turnoActivo.id,
        },
        include: { mesa: { select: { nombre: true } } },
      });

      await tx.mesa.update({
        where: { id: mesa.id },
        data: { estado: "ocupada" },
      });

      return { pedido: nuevoPedido, ajustes, agotados, cambioStock, creado: true };
    });

    if (resultado.sinDisponible) {
      return res.status(409).json({
        message:
          "Ninguno de los productos solicitados tiene disponibilidad suficiente",
        ajustes: resultado.ajustes,
      });
    }

    const { pedido, ajustes, agotados, cambioStock, creado } = resultado;

    if (cambioStock) {
      emitCatalogChanged(operationId);
    }
    for (const agotado of agotados) {
      emitStockDepleted({ ...agotado, operationId });
    }

    emitOrderChanged({
      id: pedido.id,
      mesaId: mesa.id,
      operationId,
    });
    if (creado) emitMesaChanged(mesa.id, operationId);

    return res.status(creado ? 201 : 200).json({
      message: creado
        ? "Pedido creado exitosamente"
        : "Productos añadidos correctamente",
      data: pedido,
      ajustes,
    });
  } catch (error) {
    handlePrismaError(error, res, "Hubo un error al crear el pedido");
  }
};

const obtenerPedidoPorMesa = async (req, res) => {
  try {
    const { mesaId } = req.params;

    const pedido = await prisma.pedido.findFirst({
      where: { mesaId: Number(mesaId), estado: "abierto" },
      include: { mesa: { select: { nombre: true } } },
    });

    if (!pedido) {
      return res.status(404).json({
        message:
          "No existe un pedido abierto asociado a esta mesa. Puede crear uno nuevo.",
      });
    }

    return res.status(200).json({
      data: { ...pedido, mesa: pedido.mesa.nombre },
    });
  } catch (error) {
    handlePrismaError(error, res, "Error al obtener el pedido de esta mesa");
  }
};

const obtenerPedidoPorQR = async (req, res) => {
  try {
    const { codigoQR } = req.params;

    const mesa = await prisma.mesa.findUnique({
      where: { codigoQR },
    });

    if (!mesa) {
      return res.status(404).json({
        message: "Mesa no encontrada o código QR inválido.",
      });
    }

    const pedido = await prisma.pedido.findFirst({
      where: { mesaId: mesa.id, estado: "abierto" },
      include: { mesa: { select: { nombre: true } } },
    });

    if (!pedido) {
      return res.status(200).json({
        message:
          "No existe un pedido abierto para esta mesa. Puedes crear uno nuevo.",
      });
    }

    return res.status(200).json({
      data: { ...pedido, mesa: pedido.mesa.nombre },
    });
  } catch (error) {
    handlePrismaError(error, res, "Error al obtener el pedido por código QR");
  }
};

const obtenerPedidoId = async (req, res) => {
  try {
    const { id } = req.params;

    const pedido = await prisma.pedido.findUnique({
      where: { id: Number(id) },
      include: { mesa: { select: { nombre: true } } },
    });

    if (!pedido) {
      return res
        .status(404)
        .json({ message: "No existe ningún pedido asociado a ese Id" });
    }

    return res.status(200).json({
      data: { ...pedido, mesa: pedido.mesa.nombre },
    });
  } catch (error) {
    handlePrismaError(error, res, "Error al obtener el pedido");
  }
};

const listarPedidos = async (estado, req, res, mensajeError) => {
  try {
    const { fecha, hora, numeroDiario, turnoId } = req.query;

    const where = { estado };

    // LÓGICA DE FECHA:
    // Solo aplicamos filtro de fecha si:
    // 1. Nos pasan una fecha por query
    // 2. O si estamos listando pedidos CERRADOS (por defecto hoy)
    if (fecha || estado === "cerrado" || numeroDiario) {
      const fechaBase = fecha ? fecha : getLocalDateString();
      const fechaObj = parseLocalDate(fechaBase);

      let { inicio, fin } = getDateRange(fechaObj);

      // Si se pasa hora, ajustar fin a esa hora
      if (hora) {
        const [hour, minute] = hora.split(":").map(Number);
        fin = new Date(fechaObj);
        fin.setHours(hour, minute, 59, 999);
      }

      where.createdAt = {
        gte: inicio,
        lte: fin,
      };
    }

    if (numeroDiario) {
      where.numero_diario = { lte: Number(numeroDiario) };
    }

    if (turnoId) {
      where.turnoId = Number(turnoId);
    }

    const pedidos = await prisma.pedido.findMany({
      where,
      orderBy: { numero_diario: "desc" },
      select: {
        id: true,
        numero_diario: true,
        mesaId: true,
        estado: true,
        productos: true,
        total: true,
        tipo_pago: true,
        cant_efect: true,
        cant_transf: true,
        cant_prop: true,
        turnoId: true,
        updatedAt: true,
        createdAt: true,
        mesa: { select: { nombre: true } },
      },
    });

    if (!pedidos.length) {
      return res
        .status(200)
        .json({ data: [], message: mensajeError, totalIngresos: 0 });
    }

    const pedidosLimpios = pedidos.map((p) => ({
      ...p,
      mesa: p.mesa.nombre,
    }));

    // Calcular total de ingresos
    const totalIngresos = pedidos.reduce(
      (sum, p) => sum + parseFloat(p.total || 0),
      0,
    );

    return res.status(200).json({ data: pedidosLimpios, totalIngresos });
  } catch (error) {
    handlePrismaError(error, res, "Error al listar los pedidos");
  }
};

const listarPedidosActivos = (req, res) =>
  listarPedidos("abierto", req, res, "No hay pedidos abiertos");

const listarPedidosCompletados = (req, res) =>
  listarPedidos("cerrado", req, res, "No hay pedidos cerrados");

const actualizarEstado = async (req, res) => {
  try {
    const { id } = req.params;
    const { tipo_pago, cant_efect, cant_transf, cant_prop } = req.body;

    const pedido = await prisma.pedido.findUnique({
      where: { id: Number(id) },
      select: { estado: true, mesaId: true },
    });

    if (!pedido) {
      return res.status(404).json({ message: "Pedido no encontrado" });
    }

    // Mantenemos tu lógica de alternancia de estado (Toggle)
    const nuevoEstado = pedido.estado === "abierto" ? "cerrado" : "abierto";

    const data = { estado: nuevoEstado };

    // Si el nuevo estado es CERRADO, procesamos la información de pago
    if (nuevoEstado === "cerrado") {
      data.tipo_pago = tipo_pago;
      data.cant_efect = parseFloat(cant_efect || 0);
      data.cant_transf = parseFloat(cant_transf || 0);
      data.cant_prop = parseFloat(cant_prop || 0);
    }

    const pedidoActualizado = await prisma.pedido.update({
      where: { id: Number(id) },
      data,
      include: { mesa: { select: { nombre: true } } },
    });
    emitOrderChanged({
      id: pedidoActualizado.id,
      mesaId: pedidoActualizado.mesaId,
      operationId: req.get("Idempotency-Key"),
    });
    if (pedidoActualizado.estado === "cerrado") {
      emitMesaChanged(pedidoActualizado.mesaId, req.get("Idempotency-Key"));
    }

    return res.status(200).json({
      message: "Estado del pedido actualizado correctamente",
      data: { ...pedidoActualizado, mesa: pedidoActualizado.mesa.nombre },
    });
  } catch (error) {
    handlePrismaError(error, res, "Error al actualizar el estado del pedido");
  }
};

const modificarPedido = async (req, res) => {
  try {
    const { id } = req.params;
    const { productos, mesaId, estado } = req.body;
    const usuario = req.user; // Requerido el middleware de auth

    const pedido = await prisma.pedido.findUnique({
      where: { id: Number(id) },
    });

    if (!pedido) {
      return res
        .status(404)
        .json({ message: "No existe ningún pedido asociado a ese id" });
    }

    // --- Lógica de Restricción de Edición ---
    const esHoy =
      new Date(pedido.createdAt).toDateString() === new Date().toDateString();

    // Si no es admin y el pedido NO es de hoy, bloquear
    if (usuario.rol !== "admin" && !esHoy) {
      return res.status(403).json({
        message:
          "Solo el administrador puede editar pedidos de fechas pasadas.",
      });
    }

    const hayProductos =
      Array.isArray(productos) && productos.length > 0;

    const solicitud = hayProductos
      ? normalizarSolicitudProductos(productos)
      : null;

    if (hayProductos && !solicitud.valid) {
      return res.status(400).json({ message: "Cantidad o producto inválido" });
    }

    const operationId = req.get("Idempotency-Key");

    const resultado = await prisma.$transaction(async (tx) => {
      // Bloqueo del pedido antes que los productos, igual que en el alta.
      await tx.$queryRaw`SELECT "id" FROM "Pedido" WHERE "id" = ${Number(id)} FOR UPDATE`;
      const pedidoActual = await tx.pedido.findUnique({
        where: { id: Number(id) },
      });

      const data = {};
      if (mesaId) data.mesaId = Number(mesaId);
      if (estado) data.estado = estado;

      let ajustes = [];
      let agotados = [];
      let cambioStock = false;

      if (solicitud) {
        const solicitadas = [...solicitud.cantidades].map(
          ([productoId, cantidad]) => ({ productoId, cantidad }),
        );

        // Conciliar contra lo que el pedido ya tenía descontado (RF-20).
        const conciliado = await conciliarCantidades(tx, {
          anteriores: pedidoActual?.productos ?? [],
          solicitadas,
        });

        ajustes = conciliado.ajustes;
        agotados = conciliado.agotados;
        cambioStock = conciliado.cambioStock;

        const metaPorProducto = new Map();
        for (const item of productos) {
          const productoId = Number(item?.productoId);
          if (!metaPorProducto.has(productoId)) {
            metaPorProducto.set(productoId, {
              done: item?.done ?? false,
              delivered: item?.delivered ?? false,
            });
          }
        }

        const productosBD = await tx.producto.findMany({
          where: { id: { in: [...solicitud.cantidades.keys()] } },
          select: { id: true, nombre: true, precio: true, imagen: true },
        });
        const productosPorId = new Map(
          productosBD.map((producto) => [producto.id, producto]),
        );

        const productosPedido = [...conciliado.cantidadesFinales]
          .filter(([, cantidad]) => cantidad > 0)
          .map(([productoId, cantidad]) => {
            const prod = productosPorId.get(productoId);
            if (!prod) throw new Error(`Producto ${productoId} no encontrado`);
            const meta = metaPorProducto.get(productoId) ?? {};
            return {
              productoId,
              nombre: prod.nombre,
              precio: prod.precio,
              cantidad,
              subtotal: prod.precio * cantidad,
              imagen: prod.imagen,
              done: meta.done ?? false,
              delivered: meta.delivered ?? false,
            };
          });

        data.productos = productosPedido;
        data.total = productosPedido.reduce((sum, p) => sum + p.subtotal, 0);
      }

      const pedidoModificado = await tx.pedido.update({
        where: { id: Number(id) },
        data,
      });

      return { pedidoModificado, ajustes, agotados, cambioStock };
    });

    const { pedidoModificado, ajustes, agotados, cambioStock } = resultado;

    if (cambioStock) {
      emitCatalogChanged(operationId);
    }
    for (const agotado of agotados) {
      emitStockDepleted({ ...agotado, operationId });
    }

    emitOrderChanged({
      id: pedidoModificado.id,
      mesaId: pedidoModificado.mesaId || pedido.mesaId,
      operationId,
    });

    return res.status(200).json({
      message: "Pedido modificado correctamente",
      data: pedidoModificado,
      ajustes,
    });
  } catch (error) {
    handlePrismaError(error, res, "Error al modificar el pedido");
  }
};

const toggleItemDone = async (req, res) => {
  try {
    const { id, index } = req.params;
    const pedidoId = Number(id);
    const idx = Number(index);

    if (Number.isNaN(pedidoId) || Number.isNaN(idx)) {
      return res.status(400).json({ message: "Id o índice inválido" });
    }

    const pedido = await prisma.pedido.findUnique({ where: { id: pedidoId } });
    if (!pedido)
      return res.status(404).json({ message: "Pedido no encontrado" });

    const productos = Array.isArray(pedido.productos) ? pedido.productos : [];
    if (idx < 0 || idx >= productos.length) {
      return res.status(400).json({ message: "Índice de ítem inválido" });
    }

    productos[idx].done = !Boolean(productos[idx].done);

    const updated = await prisma.pedido.update({
      where: { id: pedidoId },
      data: { productos },
    });
    emitOrderChanged({
      id: updated.id,
      mesaId: updated.mesaId,
      operationId: req.get("Idempotency-Key"),
    });

    return res.status(200).json({ message: "Ítem actualizado", data: updated });
  } catch (error) {
    handlePrismaError(error, res, "Error al actualizar ítem (done)");
  }
};

const toggleItemDelivered = async (req, res) => {
  try {
    const { id, index } = req.params;
    const pedidoId = Number(id);
    const idx = Number(index);

    if (Number.isNaN(pedidoId) || Number.isNaN(idx)) {
      return res.status(400).json({ message: "Id o índice inválido" });
    }

    const pedido = await prisma.pedido.findUnique({ where: { id: pedidoId } });
    if (!pedido)
      return res.status(404).json({ message: "Pedido no encontrado" });

    const productos = Array.isArray(pedido.productos) ? pedido.productos : [];
    if (idx < 0 || idx >= productos.length) {
      return res.status(400).json({ message: "Índice de ítem inválido" });
    }

    // Toggle delivered
    productos[idx].delivered = !Boolean(productos[idx].delivered);

    // If now delivered, ensure done is true
    if (productos[idx].delivered) productos[idx].done = true;

    const updated = await prisma.pedido.update({
      where: { id: pedidoId },
      data: { productos },
    });
    emitOrderChanged({
      id: updated.id,
      mesaId: updated.mesaId,
      operationId: req.get("Idempotency-Key"),
    });

    return res.status(200).json({ message: "Ítem actualizado", data: updated });
  } catch (error) {
    handlePrismaError(error, res, "Error al actualizar ítem (delivered)");
  }
};

const eliminarPedido = async (req, res) => {
  try {
    const { id } = req.params;
    const pedidoId = Number(id);
    const operationId = req.get("Idempotency-Key");

    if (!Number.isInteger(pedidoId)) {
      return res.status(400).json({ message: "Id de pedido inválido" });
    }

    const resultado = await prisma.$transaction(async (tx) => {
      const bloqueado = await tx.$queryRaw`
        SELECT "id" FROM "Pedido" WHERE "id" = ${pedidoId} FOR UPDATE
      `;
      if (bloqueado.length === 0) return null;

      const pedido = await tx.pedido.findUnique({ where: { id: pedidoId } });
      if (!pedido) return null;

      // Se devuelve al stock lo que el pedido había descontado, pero solo en
      // los productos que siguen teniendo límite (RF-21).
      const conLimite = await bloquearConLimite(tx, pedido.productos);
      await reponerPedido(tx, pedido.productos, conLimite);

      await tx.pedido.delete({ where: { id: pedidoId } });

      return {
        id: pedido.id,
        mesaId: pedido.mesaId,
        repuso: conLimite.size > 0,
      };
    });

    if (!resultado) {
      return res.status(404).json({ message: "Pedido no encontrado" });
    }

    if (resultado.repuso) emitCatalogChanged(operationId);
    emitOrderChanged({
      id: resultado.id,
      mesaId: resultado.mesaId,
      operationId,
    });
    emitMesaChanged(resultado.mesaId, operationId);

    return res
      .status(200)
      .json({ message: "El pedido ha sido eliminado correctamente" });
  } catch (error) {
    handlePrismaError(error, res, "Error al eliminar el pedido");
  }
};

const calcularEstadisticasDia = async (fechaBase) => {
  const fecha =
    typeof fechaBase === "string" ? parseLocalDate(fechaBase) : fechaBase;
  const { inicio, fin } = getDateRange(fecha);
  const year = fecha.getFullYear();
  const month = fecha.getMonth();
  const day = fecha.getDate();

  const pedidosCerrados = await prisma.pedido.findMany({
    where: {
      estado: "cerrado",
      createdAt: { gte: inicio, lte: fin },
    },
    select: { total: true, productos: true, createdAt: true },
  });

  const ingresosTotales = pedidosCerrados.reduce(
    (sum, p) => sum + parseFloat(p.total || 0),
    0,
  );

  const productosVendidos = {};
  pedidosCerrados.forEach((pedido) => {
    const productos = Array.isArray(pedido.productos) ? pedido.productos : [];
    productos.forEach((prod) => {
      const id = prod.productoId;
      if (!productosVendidos[id]) {
        productosVendidos[id] = {
          productoId: id,
          nombre: prod.nombre,
          cantidad: 0,
          imagen: prod.imagen || null,
        };
      }
      productosVendidos[id].cantidad += prod.cantidad || 1;
      if (!productosVendidos[id].imagen && prod.imagen) {
        productosVendidos[id].imagen = prod.imagen;
      }
    });
  });

  const topProductos = Object.values(productosVendidos).sort(
    (a, b) => b.cantidad - a.cantidad,
  );

  const intervalos = [];
  for (let h = 8; h < 22; h += 2) {
    const inicioInt = new Date(year, month, day, h, 0, 0, 0);
    const finInt = new Date(year, month, day, h + 2, 0, 0, 0);
    const pedidosIntervalo = pedidosCerrados.filter(
      (p) => p.createdAt >= inicioInt && p.createdAt < finInt,
    );
    intervalos.push({
      intervalo: `${h}:00-${h + 2}:00`,
      pedidos: pedidosIntervalo.length,
      ingresos: pedidosIntervalo.reduce(
        (sum, p) => sum + parseFloat(p.total || 0),
        0,
      ),
    });
  }

  const trabajadores = await prisma.usuario.findMany({
    where: {
      rol: { nombre: { in: ["trabajador", "admin"] } },
      activo: true,
    },
    select: { id: true, nombre: true, email: true },
  });

  return {
    ingresosTotales,
    topProductos,
    trabajadoresActivos: trabajadores,
    mapaCalor: intervalos,
  };
};

const obtenerEstadisticasDiarias = async (req, res) => {
  try {
    const { fecha } = req.query;
    const fechaActual = fecha ? parseLocalDate(fecha) : new Date();
    const fechaAnterior = new Date(fechaActual);
    fechaAnterior.setDate(fechaAnterior.getDate() - 7);

    const statsActuales = await calcularEstadisticasDia(fechaActual);
    const statsSemanaAnterior = await calcularEstadisticasDia(fechaAnterior);

    const ingresosActuales = statsActuales.ingresosTotales || 0;
    const ingresosPrevios = statsSemanaAnterior.ingresosTotales || 0;

    let variacionIngresos = 0;
    let estadoVariacion = "neutral";

    if (ingresosPrevios === 0 && ingresosActuales === 0) {
      variacionIngresos = 0;
      estadoVariacion = "neutral";
    } else if (ingresosPrevios === 0 && ingresosActuales > 0) {
      variacionIngresos = 100;
      estadoVariacion = "growth";
    } else {
      variacionIngresos =
        ((ingresosActuales - ingresosPrevios) / ingresosPrevios) * 100;
      estadoVariacion = variacionIngresos >= 0 ? "growth" : "loss";
    }

    return res.status(200).json({
      ...statsActuales,
      ingresosTotalesSemanaAnterior: ingresosPrevios,
      variacionIngresos,
      estadoVariacion,
    });
  } catch (error) {
    handlePrismaError(error, res, "Error al obtener estadísticas diarias");
  }
};

const obtenerEstadisticasMensuales = async (req, res) => {
  try {
    const { mes } = req.query;

    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes || "")) {
      return res
        .status(400)
        .json({ message: "El mes debe tener el formato YYYY-MM" });
    }

    const [year, month] = mes.split("-").map(Number);
    const inicio = new Date(year, month - 1, 1);
    const fin = new Date(year, month, 1);
    const cantidadDias = new Date(year, month, 0).getDate();

    const pedidosCerrados = await prisma.pedido.findMany({
      where: {
        estado: "cerrado",
        createdAt: { gte: inicio, lt: fin },
      },
      select: { total: true, createdAt: true },
    });

    const ingresosPorDia = Array.from({ length: cantidadDias }, (_, index) => ({
      fecha: `${mes}-${String(index + 1).padStart(2, "0")}`,
      dia: index + 1,
      ingresos: 0,
      pedidos: 0,
    }));

    pedidosCerrados.forEach((pedido) => {
      const dia = pedido.createdAt.getDate();
      const estadistica = ingresosPorDia[dia - 1];

      if (estadistica) {
        estadistica.ingresos += Number(pedido.total || 0);
        estadistica.pedidos += 1;
      }
    });

    return res.status(200).json({ mes, dias: ingresosPorDia });
  } catch (error) {
    handlePrismaError(error, res, "Error al obtener estadísticas mensuales");
  }
};

export default {
  crearOactualizarPedido,
  obtenerPedidoPorMesa,
  obtenerPedidoPorQR,
  listarPedidosActivos,
  listarPedidosCompletados,
  actualizarEstado,
  modificarPedido,
  toggleItemDelivered,
  toggleItemDone,
  eliminarPedido,
  obtenerEstadisticasDiarias,
  obtenerEstadisticasMensuales,
};
