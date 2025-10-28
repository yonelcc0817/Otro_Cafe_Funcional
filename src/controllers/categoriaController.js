import prisma from "../config/database.js";
import { handlePrismaError } from "../utils/handlePrismaError.js";

const crearCategoria = async (req, res) => {
  try {
    const { nombre, position } = req.body;

    if (!nombre) {
      return res
        .status(400)
        .json({ message: "El nombre de la categoría es obligatorio" });
    }

    const nuevaCategoria = await prisma.categoria.create({
      data: { nombre, position: parseInt(position) },
    });

    return res.status(201).json({
      message: "Categoría creada exitosamente",
      data: nuevaCategoria,
    });
  } catch (error) {
    handlePrismaError(error, res, "Error al crear la categoría");
  }
};

const obtenerCategoriaId = async (req, res) => {
  try {
    const { id } = req.params;

    const categoria = await prisma.categoria.findUnique({
      where: { id: Number(id) },
      include: { productos: true },
    });

    if (!categoria) {
      return res.status(404).json({ message: "Categoría no encontrada" });
    }

    return res.status(200).json({ data: categoria });
  } catch (error) {
    handlePrismaError(error, res, "Error al obtener la categoría");
  }
};

const listarCategorias = async (req, res) => {
  try {
    const categorias = await prisma.categoria.findMany({
      include: { productos: true },
      orderBy: { position: "asc" },
    });

    if (!categorias.length) {
      return res.status(404).json({ message: "No se encontraron categorías" });
    }

    return res.status(200).json({ data: categorias });
  } catch (error) {
    handlePrismaError(error, res, "Error al listar las categorías");
  }
};

const listarCategoriasActivas = async (req, res) => {
  try {
    const categorias = await prisma.categoria.findMany({
      where: { habilitada: true },
      include: { productos: true },
      orderBy: { position: "asc" },
    });

    if (!categorias.length) {
      return res.status(404).json({ message: "No se encontraron categorías" });
    }

    return res.status(200).json({ data: categorias });
  } catch (error) {
    handlePrismaError(error, res, "Error al listar las categorías");
  }
};

const actualizarCategoria = async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, position } = req.body;

    const data = {};
    if (nombre) data.nombre = nombre;
    if (position) data.position = parseInt(position);

    const categoriaActualizada = await prisma.categoria.update({
      where: { id: Number(id) },
      data,
      include: { productos: true },
    });

    return res.status(200).json({
      message: "Categoría actualizada correctamente",
      data: categoriaActualizada,
    });
  } catch (error) {
    handlePrismaError(error, res, "Error al actualizar la categoría");
  }
};

const eliminarCategoria = async (req, res) => {
  try {
    const { id } = req.params;

    const categoriaEliminada = await prisma.categoria.update({
      where: { id: Number(id) },
      data: { habilitada: false },
    });

    return res.status(200).json({
      message: "Categoría deshabilitada correctamente",
      data: categoriaEliminada,
    });
  } catch (error) {
    handlePrismaError(error, res, "Error al deshabilitar la categoría");
  }
};

export default {
  crearCategoria,
  obtenerCategoriaId,
  listarCategorias,
  listarCategoriasActivas,
  actualizarCategoria,
  eliminarCategoria,
};
