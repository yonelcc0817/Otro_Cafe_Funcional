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
    },
  });
};

const createTurno = async (fecha = new Date()) => {
  const { inicio, fin } = getDateRange(fecha);
  const cantidadTurnosHoy = await prisma.turno.count({
    where: {
      fecha: { gte: inicio, lte: fin },
    },
  });

  return prisma.turno.create({
    data: {
      numero: cantidadTurnosHoy + 1,
      fecha: inicio,
      estado: "abierto",
      trabajadoresActivos: [],
    },
  });
};

const getTrabajadoresActivos = async () => {
  return prisma.usuario.findMany({
    where: {
      activo: true,
      rol: { nombre: { in: ["trabajador", "admin"] } },
    },
    select: { id: true, nombre: true, email: true },
  });
};

const calcularResumenTurno = async (turnoId) => {
  const turno = await prisma.turno.findUnique({
    where: { id: Number(turnoId) },
    include: { pedidos: { include: { mesa: true } } },
  });

  if (!turno) {
    throw new Error("Turno no encontrado");
  }

  const pedidos = turno.pedidos || [];
  const pedidosCerrados = pedidos.filter((p) => p.estado === "cerrado");
  const pedidosAbiertos = pedidos.filter((p) => p.estado === "abierto");

  let efectivo = 0;
  let transferencia = 0;
  let propina = 0;
  let totalTurno = 0;
  const productosMap = {};
  const pagosPorProducto = {};

  const obtenerPagoPorProducto = (pedido, subtotalProducto) => {
    const montoEfectivo = parseFloat(pedido.cant_efect || 0);
    const montoTransferencia = parseFloat(pedido.cant_transf || 0);
    const montoPropina = parseFloat(pedido.cant_prop || 0);
    const totalPedido = montoEfectivo + montoTransferencia + montoPropina;

    if (totalPedido <= 0) {
      return { efectivo: 0, transferencia: 0 };
    }

    const factor = subtotalProducto / totalPedido;
    return {
      efectivo: montoEfectivo * factor,
      transferencia: montoTransferencia * factor,
    };
  };

  pedidosCerrados.forEach((pedido) => {
    const montoEfectivoPedido = parseFloat(pedido.cant_efect || 0);
    const montoTransferenciaPedido = parseFloat(pedido.cant_transf || 0);
    const montoPropinaPedido = parseFloat(pedido.cant_prop || 0);
    const ingresoNetoPedido = montoEfectivoPedido + montoTransferenciaPedido;

    efectivo += montoEfectivoPedido;
    transferencia += montoTransferenciaPedido;
    propina += montoPropinaPedido;
    totalTurno += ingresoNetoPedido;

    const productos = Array.isArray(pedido.productos) ? pedido.productos : [];
    productos.forEach((prod) => {
      const productoId = prod.productoId;
      const subtotalProducto = parseFloat(prod.subtotal || 0);

      if (!productosMap[productoId]) {
        productosMap[productoId] = {
          productoId,
          nombre: prod.nombre || "Producto",
          cantidad: 0,
          monto: 0,
        };
      }

      productosMap[productoId].cantidad += prod.cantidad || 0;
      productosMap[productoId].monto += subtotalProducto;

      if (!pagosPorProducto[productoId]) {
        pagosPorProducto[productoId] = {
          productoId,
          nombre: prod.nombre || "Producto",
          efectivo: 0,
          transferencia: 0,
        };
      }

      const { efectivo: pagoEfectivo, transferencia: pagoTransferencia } =
        obtenerPagoPorProducto(pedido, subtotalProducto);

      pagosPorProducto[productoId].efectivo += pagoEfectivo;
      pagosPorProducto[productoId].transferencia += pagoTransferencia;
    });
  });

  const productos = Object.values(productosMap).sort(
    (a, b) => b.cantidad - a.cantidad,
  );

  const pedidosDetalles = pedidosCerrados.map((pedido) => ({
    numeroDiario: pedido.numero_diario,
    mesa: pedido.mesa?.nombre || `Mesa ${pedido.mesaId}`,
    cantEfect: parseFloat(pedido.cant_efect || 0),
    cantTransf: parseFloat(pedido.cant_transf || 0),
    cantProp: parseFloat(pedido.cant_prop || 0),
    tipoPago: pedido.tipo_pago,
  }));

  return {
    turnoId: turno.id,
    numero: turno.numero,
    fecha: turno.fecha,
    estado: turno.estado,
    pedidosTotales: pedidos.length,
    pedidosCerrados: pedidosCerrados.length,
    pedidosAbiertos: pedidosAbiertos.length,
    efectivo,
    transferencia,
    propina,
    totalTurno,
    productos,
    pagosPorProducto: Object.values(pagosPorProducto),
    pedidosDetalles,
    trabajadoresActivos: turno.trabajadoresActivos || [],
  };
};

const getTurnosDia = async (req, res) => {
  try {
    const { fecha } = req.query;
    const fechaConsulta = fecha ? new Date(fecha) : new Date();
    const { inicio, fin } = getDateRange(fechaConsulta);

    const turnos = await prisma.turno.findMany({
      where: {
        fecha: { gte: inicio, lte: fin },
      },
      orderBy: { numero: "asc" },
    });

    return res.status(200).json({ data: turnos });
  } catch (error) {
    handlePrismaError(error, res, "Error al listar los turnos");
  }
};

const getTurnoActual = async (req, res) => {
  try {
    const turno = await getTurnoAbiertoHoy();
    if (!turno) {
      return res
        .status(404)
        .json({ message: "No hay turno abierto actualmente" });
    }
    return res.status(200).json({ data: turno });
  } catch (error) {
    handlePrismaError(error, res, "Error al obtener el turno actual");
  }
};

const getTurnoById = async (req, res) => {
  try {
    const { id } = req.params;
    const turno = await prisma.turno.findUnique({
      where: { id: Number(id) },
    });

    if (!turno) {
      return res.status(404).json({ message: "Turno no encontrado" });
    }

    const resumen = await calcularResumenTurno(turno.id);
    return res.status(200).json({ data: { ...turno, resumen } });
  } catch (error) {
    handlePrismaError(error, res, "Error al obtener el turno");
  }
};

const cerrarTurnoPorId = async (turnoId) => {
  const resumen = await calcularResumenTurno(turnoId);
  resumen.estado = "cerrado"; // Update estado in resumen
  const trabajadoresActivos = await getTrabajadoresActivos();

  return prisma.turno.update({
    where: { id: Number(turnoId) },
    data: {
      estado: "cerrado",
      cerradoEn: new Date(),
      resumen,
      trabajadoresActivos,
    },
  });
};

const changeTurno = async (req, res) => {
  try {
    const turnoActivo = await getTurnoAbiertoHoy();
    let turnoCerrado = null;

    if (turnoActivo) {
      turnoCerrado = await cerrarTurnoPorId(turnoActivo.id);
    }

    const nuevoTurno = await createTurno();

    return res.status(200).json({
      message: turnoActivo
        ? "Turno anterior cerrado y nuevo turno creado"
        : "No había turno abierto; se creó un nuevo turno",
      closedTurno: turnoCerrado,
      newTurno: nuevoTurno,
    });
  } catch (error) {
    handlePrismaError(error, res, "Error al cambiar de turno");
  }
};

const closeTurno = async (req, res) => {
  try {
    const turnoActivo = await getTurnoAbiertoHoy();
    if (!turnoActivo) {
      return res
        .status(400)
        .json({ message: "No hay turno abierto para cerrar" });
    }

    const turnoCerrado = await cerrarTurnoPorId(turnoActivo.id);
    return res.status(200).json({
      message: "Turno cerrado correctamente",
      data: turnoCerrado,
    });
  } catch (error) {
    handlePrismaError(error, res, "Error al cerrar el turno");
  }
};

export default {
  getTurnosDia,
  getTurnoActual,
  getTurnoById,
  changeTurno,
  closeTurno,
};
