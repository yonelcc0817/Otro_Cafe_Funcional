import prisma from "../config/database.js";
import crypto from "crypto";
import { handlePrismaError } from "../utils/handlePrismaError.js";

const listarMesas = async (req, res) => {
  try {
    const mesas = await prisma.mesa.findMany({
      include: { pedidos: true },
    });
    if (mesas.length === 0) {
      return res.status(404).json({ message: "No se encontraron mesas" });
    }
    res.status(200).json({ data: mesas });
  } catch (error) {
    handlePrismaError(error, res, "Ocurrio un error al buscar las mesas");
  }
};

const obtenerMesaID = async (req, res) => {
  try {
    const { id } = req.params;

    const mesa = await prisma.mesa.findUnique({
      where: { id: Number(id) },
      include: { pedidos: true },
    });

    if (!mesa) {
      return res
        .status(404)
        .json({ message: "No existe niguna mesa asociada a ese id" });
    }

    return res.status(200).json({ data: mesa });
  } catch (error) {
    handlePrismaError(error, res, "Ocurrio un error al obtener la mesa");
  }
};

const crearMesa = async (req, res) => {
  try {
    const { nombre } = req.body;

    if (!nombre) {
      return res
        .status(400)
        .json({ error: "El nombre de la mesa es obligatorio." });
    }
    // hashear el nombre para generar el QR

    const codigoQR = crypto.randomBytes(32).toString("hex");

    const mesa = await prisma.mesa.create({
      data: { nombre, codigoQR },
    });

    return res.status(200).json({
      message: `La ${mesa.nombre} ha sido creada correctamente`,
      data: mesa,
    });
  } catch (error) {
    handlePrismaError(error, res, "Hubo un error al crear la mesa");
  }
};

const actualizarMesa = async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, estado } = req.body;

    const mesa = await prisma.mesa.findUnique({
      where: mesa.id === id,
    });
    if (!mesa) {
      return res
        .status(404)
        .json({ message: "No existe niguna mesa asociada a ese id" });
    }

    const data = {};
    if (nombre) data.nombre = nombre;
    if (estado) data.estado = estado;

    if (Object.keys(data).length === 0) {
      return res
        .status(400)
        .json({ message: "No se proporcionaron datos para actualizar" });
    }

    const mesaActualizada = await prisma.mesa.update({
      where: { id: Number(id) },
      data,
    });

    return res.status(200).json({
      message: "Mesa actualizada correctamente",
      data: mesaActualizada,
    });
  } catch (error) {
    handlePrismaError(
      error,
      res,
      "Ha ocurrido un error al intentar actualizar la mesa"
    );
  }
};

const eliminarMesa = async (req, res) => {
  try {
    const { id } = req.params;
    const mesa = await prisma.mesa.findFirst({
      where: mesa.id === id,
    });
    if (!mesa) {
      return res
        .status(404)
        .json({ message: "No existe niguna mesa asociada a ese id" });
    }

    await prisma.mesa.delete({
      where: { id: Number(id) },
    });

    return res
      .status(200)
      .json({ message: "La mesa ha sido eliminada correctamente" });
  } catch (error) {
    handlePrismaError(
      error,
      res,
      "Ha ocurrido un error al intentar eliminar la mesa"
    );
  }
};

export default {
  listarMesas,
  obtenerMesaID,
  crearMesa,
  actualizarMesa,
  eliminarMesa,
};
