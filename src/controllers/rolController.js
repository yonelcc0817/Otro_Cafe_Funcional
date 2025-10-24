import prisma from "../config/database.js";
import { handlePrismaError } from "../utils/handlePrismaError.js";

// Crear un nuevo rol
const crearRol = async (req, res) => {
  try {
    const { nombre } = req.body;

    if (!nombre) {
      return res
        .status(400)
        .json({ message: "El nombre del rol es obligatorio" });
    }

    const nuevoRol = await prisma.rol.create({
      data: { nombre },
    });

    return res.status(201).json({
      message: "Rol creado exitosamente",
      data: nuevoRol,
    });
  } catch (error) {
    handlePrismaError(error, res, "Error al crear el rol");
  }
};

// Obtener todos los roles
const listarRoles = async (req, res) => {
  try {
    const roles = await prisma.rol.findMany({
      select: {
        id: true,
        nombre: true,
      },
      orderBy: { nombre: "asc" },
    });

    if (!roles.length) {
      return res.status(404).json({ message: "No se encontraron roles" });
    }

    return res.status(200).json({ data: roles });
  } catch (error) {
    handlePrismaError(error, res, "Error al listar los roles");
  }
};

// Obtener un rol por ID
const obtenerRolPorId = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || isNaN(Number(id))) {
      return res.status(400).json({ message: "ID de rol inválido" });
    }

    const rol = await prisma.rol.findUnique({
      where: { id: Number(id) },
    });

    if (!rol) {
      return res.status(404).json({ message: "Rol no encontrado" });
    }

    return res.status(200).json({ data: rol });
  } catch (error) {
    handlePrismaError(error, res, "Error al obtener el rol");
  }
};

// Actualizar un rol
const actualizarRol = async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre } = req.body;

    const rolActualizado = await prisma.rol.update({
      where: { id: Number(id) },
      data: { nombre },
    });

    return res.status(200).json({
      message: "Rol actualizado correctamente",
      data: rolActualizado,
    });
  } catch (error) {
    handlePrismaError(error, res, "Error al actualizar el rol");
  }
};

// Eliminar un rol
const eliminarRol = async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.rol.delete({
      where: { id: Number(id) },
    });

    return res.status(200).json({ message: "Rol eliminado correctamente" });
  } catch (error) {
    handlePrismaError(error, res, "Error al eliminar el rol");
  }
};

export default {
  crearRol,
  listarRoles,
  obtenerRolPorId,
  actualizarRol,
  eliminarRol,
};
