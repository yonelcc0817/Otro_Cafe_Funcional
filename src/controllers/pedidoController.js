import prisma from "../config/database.js";
import { handlePrismaError } from "../utils/handlePrismaError.js";


const crearOactualizarPedido = async (req, res) => {
  try {
    const { mesaId, productos } = req.body;

    if (!mesaId || !productos || productos.length === 0) {
      return res.status(400).json({ message: "Faltan datos obligatorios" });
    }

    // 1️⃣ Buscar si ya existe un pedido abierto para esa mesa
    let pedidoExistente = await prisma.pedido.findFirst({
      where: { mesaId: Number(mesaId), estado: "abierto" },
    });

    // 2️⃣ Obtener los productos desde la base de datos
    const ids = productos.map((p) => p.productoId);
    const productosBD = await prisma.producto.findMany({
      where: { id: { in: ids } },
      select: { id: true, nombre: true, precio: true },
    });
    
    // Validar y preparar los productos
    const productosPedido = productos.map((p) => {
      const prod = productosBD.find((x) => x.id === p.productoId);
      if (!prod) throw new Error(`Producto ${p.productoId} no encontrado`);
      return {
        productoId: prod.id,
        nombre: prod.nombre,
        precio: prod.precio,
        cantidad: p.cantidad,
        subtotal: prod.precio * p.cantidad,
      };
    });

    // 3️⃣ Si ya existe un pedido abierto → agregar productos
    if (pedidoExistente) {
      const productosActuales = pedidoExistente.productos || [];
      const productosCombinados = [...productosActuales, ...productosPedido];

      const nuevoTotal = productosCombinados.reduce(
        (sum, p) => sum + p.subtotal,
        0
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

     // 4️⃣ Si no hay pedido abierto → crear uno nuevo
    const total = productosPedido.reduce((sum, p) => sum + p.subtotal, 0);

    const nuevoPedido = await prisma.pedido.create({
      data: {
        mesaId: Number(mesaId),
        productos: productosPedido,
        total,
      },
      include: { mesa: { select: { nombre: true } } },
    });

    // Actualizar el estado de la mesa
    await prisma.mesa.update({
      where: { id: Number(mesaId) },
      data: { estado: "ocupada" },
    });

    return res
      .status(201)
      .json({ message: "Pedido creado exitosamente", data: nuevoPedido });

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

const listarPedidos = async (estado, res, mensajeError) => {
  try {
    const pedidos = await prisma.pedido.findMany({
      where: { estado },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        mesaId: true,
        estado: true,
        productos: true,
        total: true,
        mesa: { select: { nombre: true } },
      },
    });

    if (!pedidos.length) {
      return res.status(404).json({ message: mensajeError });
    }

    const pedidosLimpios = pedidos.map((p) => ({
      ...p,
      mesa: p.mesa.nombre,
    }));

    return res.status(200).json({ data: pedidosLimpios });
  } catch (error) {
    handlePrismaError(error, res, "Error al listar los pedidos");
  }
};

const listarPedidosActivos = (req, res) =>
  listarPedidos("abierto", res, "No se encontraron pedidos abiertos");

const listarPedidosCompletados = (req, res) =>
  listarPedidos("cerrado", res, "No se encontraron pedidos completados");

const actualizarEstado = async (req, res) => {
  try {
    const { id } = req.params;

    const pedido = await prisma.pedido.findUnique({
      where: { id: Number(id) },
      select: { estado: true },
    });

    const nuevoEstado = pedido.estado === "abierto" ? "cerrado" : "abierto";

    const pedidoActualizado = await prisma.pedido.update({
      where: { id: Number(id) },
      data: {
        estado: nuevoEstado,
      },
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
    const { productos } = req.body;

    const pedido = await prisma.pedido.findUnique({
      where: { id: Number(id) },
    });

    if (!pedido) {
      return res
        .status(404)
        .json({ message: "No existe ningún pedido asociado a ese id" });
    }

    if (pedido.estado === "cerrado") {
      return res.status(400).json({
        message: "El pedido se encuentra 'CERRADO' y no se puede modificar",
      });
    }

    const ids = productos.map((p) => p.productoId);

    const productosBD = await prisma.producto.findMany({
      where: { id: { in: ids } },
      select: { id: true, nombre: true, precio: true },
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
      };
    });

    const total = productosPedido.reduce((sum, p) => sum + p.subtotal, 0);

    const pedidoModificado = await prisma.pedido.update({
      where: { id: Number(id) },
      data: { productos: productosPedido, total },
    });

    return res.status(200).json({
      message: "Pedido modificado correctamente",
      data: pedidoModificado,
    });
  } catch (error) {
    handlePrismaError(error, res, "Error al modificar el pedido");
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

export default {
  crearOactualizarPedido,
  obtenerPedidoPorMesa,
  listarPedidosActivos,
  listarPedidosCompletados,
  actualizarEstado,
  modificarPedido,
  eliminarPedido,
};
