// src/utils/handlePrismaError.js
import { Prisma } from "@prisma/client";

/**
 * Maneja errores comunes de Prisma y devuelve una respuesta HTTP adecuada.
 * @param {Error} error - Error lanzado por Prisma.
 * @param {Response} res - Objeto de respuesta Express.
 * @param {string} [customMessage] - Mensaje opcional para incluir en el error 500.
 * @returns {Response} - Respuesta Express.
 */
export const handlePrismaError = (error, res, customMessage) => {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case "P2025": // Registro no encontrado
        return res.status(404).json({ message: "Registro no encontrado" });

      case "P2002": // Violación de campo único
        return res.status(409).json({
          message: "Violación de restricción única (valor duplicado)",
          meta: error.meta,
        });

      case "P2003": // Error de clave foránea
        return res.status(400).json({
          message: "Clave foránea inválida o relación inexistente",
        });

      default:
        return res.status(500).json({
          message: customMessage || "Error desconocido de base de datos",
          code: error.code,
        });
    }
  }

  // Si no es un error de Prisma, devolvemos genérico
  return res.status(500).json({
    message: customMessage || "Ha ocurrido un error interno",
    error: error.message,
  });
};
