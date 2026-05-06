import prisma from "../config/database.js";
import { handlePrismaError } from "../utils/handlePrismaError.js";

const getDateRange = (date = new Date()) => {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  const inicio = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
  const fin = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));
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

const crearOactualizarPedido = async (req, res) => {
  try {
    const { codigoQR, productos } = req.body;

    if (!codigoQR || !productos || productos.length === 0) {
      return res.status(400).json({ message: "Faltan datos obligatorios" });
    }

    // Buscar la mesa asociada al QR
    const mesa = await prisma.mesa.findUnique({
      where: { codigoQR },
    });

    if (!mesa) {
      return res.status(404).json({ message: "Mesa no encontrada", data: [] });
    }

    // 1️⃣ Buscar si ya existe un pedido abierto para esa mesa
    let pedidoExistente = await prisma.pedido.findFirst({
      where: { mesaId: mesa.id, estado: "abierto" },
    });

    // 2️⃣ Obtener los productos desde la base de datos
    const ids = productos.map((p) => p.productoId);
    const productosBD = await prisma.producto.findMany({
      where: { id: { in: ids } },
      select: { id: true, nombre: true, precio: true, imagen: true },
    });

    // Validar y preparar los nuevos productos
    const nuevosProductosMap = new Map();
    for (const p of productos) {
      const prod = productosBD.find((x) => x.id === p.productoId);
      if (!prod) throw new Error(`Producto ${p.productoId} no encontrado`);

      const key = prod.id;
      const old = nuevosProductosMap.get(key);
      if (old) {
        // ya existe este producto en la lista, sumar cantidades
        nuevosProductosMap.set(key, {
          ...old,
          cantidad: old.cantidad + p.cantidad,
          subtotal: old.subtotal + prod.precio * p.cantidad,
        });
      } else {
        nuevosProductosMap.set(key, {
          productoId: prod.id,
          nombre: prod.nombre,
          precio: prod.precio,
          cantidad: p.cantidad,
          subtotal: prod.precio * p.cantidad,
          imagen: prod.imagen,
          done: false,
        });
      }
    }
    const productosPedido = Array.from(nuevosProductosMap.values());

    // 3️⃣ Si ya existe un pedido abierto → agregar productos (sin duplicados)
    if (pedidoExistente) {
      const productosActualesMap = new Map(
        (pedidoExistente.productos || []).map((p) => [p.productoId, p]),
      );

      // Combinar: sumar cantidad si ya existe, sino agregar
      productosPedido.forEach((nuevo) => {
        const existing = productosActualesMap.get(nuevo.productoId);

        if (existing) {
          // Si el producto existe y está marcado como DONE, agregar como nuevo item
          if (existing.done === true) {
            // Crear un nuevo item para este producto
            productosActualesMap.set(`${nuevo.productoId}_${Date.now()}`, {
              ...nuevo,
              // Mantener el nuevo producto con done: false (por defecto)
            });
          } else {
            // Si no está done, sumar cantidades normalmente
            productosActualesMap.set(nuevo.productoId, {
              ...existing,
              cantidad: existing.cantidad + nuevo.cantidad,
              subtotal: existing.subtotal + nuevo.subtotal,
              // Mantener el done existente (que sería false)
            });
          }
        } else {
          // Producto nuevo, agregarlo normalmente
          productosActualesMap.set(nuevo.productoId, nuevo);
        }
      });

      const productosCombinados = Array.from(productosActualesMap.values());
      const nuevoTotal = productosCombinados.reduce(
        (sum, p) => sum + p.subtotal,
        0,
      );

      const pedidoActualizado = await prisma.pedido.update({
        where: { id: pedidoExistente.id },
        data: {
          productos: productosCombinados,
          total: nuevoTotal,
        },
        include: { mesa: { select: { nombre: true } } },
      });

      return res.status(200).json({
        message: "Productos añadidos correctamente",
        data: pedidoActualizado,
      });
    }

    // 4️⃣ Si no hay pedido abierto → CREAR UNO NUEVO
    const total = productosPedido.reduce((sum, p) => sum + p.subtotal, 0);

    // --- Lógica de numeración diaria ---
    const inicioDia = new Date();
    inicioDia.setHours(0, 0, 0, 0);
    const finDia = new Date();
    finDia.setHours(23, 59, 59, 999);

    const cuentaHoy = await prisma.pedido.count({
      where: {
        createdAt: { gte: inicioDia, lte: finDia },
      },
    });

    const turnoActivo = await getOrCreateActiveTurno();

    const nuevoPedido = await prisma.pedido.create({
      data: {
        mesaId: mesa.id,
        productos: productosPedido,
        total,
        numero_diario: cuentaHoy + 1,
        turnoId: turnoActivo.id,
      },
      include: { mesa: { select: { nombre: true } } },
    });

    // Actualizar el estado de la mesa
    await prisma.mesa.update({
      where: { id: mesa.id },
      data: { estado: "ocupada" },
    });

    return res.status(201).json({
      message: "Pedido creado exitosamente",
      data: nuevoPedido,
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
      const fechaBase = fecha ? fecha : new Date().toISOString().split("T")[0];
      const [year, month, day] = fechaBase.split("-").map(Number);

      const inicio = new Date(year, month - 1, day, 0, 0, 0, 0);
      const fin = new Date(year, month - 1, day, 23, 59, 59, 999);

      // Si se pasa hora, ajustar fin a esa hora
      if (hora) {
        const [hour, minute] = hora.split(":").map(Number);
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
      select: { estado: true },
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

    const data = {};
    if (mesaId) data.mesaId = Number(mesaId);
    if (estado) data.estado = estado;

    if (productos && Array.isArray(productos) && productos.length > 0) {
      const ids = productos.map((p) => p.productoId);
      const productosBD = await prisma.producto.findMany({
        where: { id: { in: ids } },
        select: { id: true, nombre: true, precio: true, imagen: true },
      });

      const productosPedido = productos.map((p) => {
        const prod = productosBD.find((x) => x.id === p.productoId);
        if (!prod) throw new Error(`Producto ${p.productoId} no encontrado`);
        return {
          productoId: prod.id,
          nombre: prod.nombre,
          precio: prod.precio,
          cantidad: p.cantidad,
          subtotal: prod.precio * p.cantidad,
          imagen: prod.imagen,
          done: p.done,
        };
      });

      data.productos = productosPedido;
      data.total = productosPedido.reduce((sum, p) => sum + p.subtotal, 0);
    }

    const pedidoModificado = await prisma.pedido.update({
      where: { id: Number(id) },
      data,
    });

    return res.status(200).json({
      message: "Pedido modificado correctamente",
      data: pedidoModificado,
    });
  } catch (error) {
    handlePrismaError(error, res, "Error al modificar el pedido");
  }
};

const toggleItemDone = async (req, res) => {
  try {
    const { id, index } = req.params;
    const pedido = await prisma.pedido.findUnique({
      where: { id: Number(id) },
    });
    if (!pedido) {
      return res.status(404).json({ message: "Pedido no encontrado" });
    }
    const productos = pedido.productos || [];
    if (index < 0 || index >= productos.length) {
      return res.status(400).json({ message: "Índice de ítem inválido" });
    }
    productos[index].done = !productos[index].done;
    await prisma.pedido.update({
      where: { id: Number(id) },
      data: { productos },
    });
    return res.status(200).json({ message: "Ítem actualizado" });
  } catch (error) {
    handlePrismaError(error, res, "Error al actualizar ítem");
  }
};

const eliminarPedido = async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.pedido.delete({
      where: { id: Number(id) },
    });

    return res
      .status(200)
      .json({ message: "El pedido ha sido eliminado correctamente" });
  } catch (error) {
    handlePrismaError(error, res, "Error al eliminar el pedido");
  }
};

const calcularEstadisticasDia = async (fechaBase) => {
  const year = fechaBase.getUTCFullYear();
  const month = fechaBase.getUTCMonth();
  const day = fechaBase.getUTCDate();

  const inicio = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
  const fin = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));

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

  const topProductos = Object.values(productosVendidos)
    .sort((a, b) => b.cantidad - a.cantidad)
    .slice(0, 5);

  const intervalos = [];
  for (let h = 8; h < 22; h += 2) {
    const inicioInt = new Date(year, month - 1, day, h, 0, 0, 0);
    const finInt = new Date(year, month - 1, day, h + 2, 0, 0, 0);
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
    const fechaActual = fecha ? new Date(fecha) : new Date();
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

export default {
  crearOactualizarPedido,
  obtenerPedidoPorMesa,
  obtenerPedidoPorQR,
  listarPedidosActivos,
  listarPedidosCompletados,
  actualizarEstado,
  modificarPedido,
  toggleItemDone,
  eliminarPedido,
  obtenerEstadisticasDiarias,
};
