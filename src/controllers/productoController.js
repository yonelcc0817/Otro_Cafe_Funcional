import prisma from "../config/database.js";
import { handlePrismaError } from "../utils/handlePrismaError.js";
import path from "path";
import fs from "fs/promises";

const listarProductos = async (req, res) => {
  try {
    const productos = await prisma.producto.findMany({
      select: {
        id: true,
        nombre: true,
        description: true,
        precio: true,
        disponible: true,
        imagen: true,
        categoriaId: true,
        categoria: { select: { nombre: true } },
      },

      orderBy: { nombre: "asc" },
    });
    if (productos.length === 0) {
      return res
        .status(200)
        .json({ message: "No se encontraron productos", data: [] });
    }
    const data = productos.map((prod) => ({
      id: prod.id,
      nombre: prod.nombre,
      description: prod.description,
      precio: prod.precio,
      disponible: prod.disponible,
      imagen: prod.imagen,
      categoriaId: prod.categoriaId,
      categoria: prod.categoria.nombre,
    }));

    res.status(200).json({ data });
  } catch (error) {
    handlePrismaError(
      error,
      res,
      "Ha ocurrido un error al listar los productos",
    );
  }
};

const obtenerProductoID = async (req, res) => {
  try {
    const { id } = req.params;

    const producto = await prisma.producto.findUnique({
      where: { id: Number(id) },
      include: { categoria: true },
    });
    if (!producto) {
      return res
        .status(404)
        .json({ message: "No existe ningún producto asociado a ese Id" });
    }

    return res.status(200).json({ data: producto });
  } catch (error) {
    handlePrismaError(
      error,
      res,
      "Ha ocurrido un error al obtener el producto",
    );
  }
};

const crearProducto = async (req, res) => {
  try {
    const { nombre, precio, description, disponible, categoriaId } = req.body;

    // Validación básica
    if (!nombre || precio == null || !categoriaId) {
      // Limpiar archivo si hubo error de validación
      if (req.file) await fs.unlink(req.file.path).catch(() => {});
      return res.status(400).json({
        message: "Los campos nombre, precio, y categoría son obligatorios",
      });
    }

    const data = {
      nombre,
      precio: parseFloat(precio),
      description,
      // SOLUCIÓN AL ERROR 500: Convertir strings de FormData a tipos reales
      disponible: disponible === "true" || disponible === true,
      categoriaId: parseInt(categoriaId),
    };

    if (req.file) {
      data.imagen = req.file.filename;
    }

    const nuevo = await prisma.producto.create({
      data,
      include: { categoria: { select: { id: true, nombre: true } } },
    });

    return res
      .status(201)
      .json({ message: "Producto creado exitosamente", data: nuevo });
  } catch (error) {
    // Si falla la base de datos, borramos la imagen recién subida para no dejar basura
    if (req.file) await fs.unlink(req.file.path).catch(() => {});
    console.error("Error al crear producto:", error);

    // Si no tienes handlePrismaError, usa un return res.status(500)...
    return res
      .status(500)
      .json({ message: "Error interno del servidor", error: error.message });
  }
};

const actualizarProducto = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      nombre,
      precio,
      description,
      disponible,
      categoriaId,
      eliminarImagen,
    } = req.body;

    const productoExistente = await prisma.producto.findUnique({
      where: { id: Number(id) },
    });

    if (!productoExistente) {
      return res
        .status(404)
        .json({ message: "No existe ningún producto asociado a ese Id" });
    }

    const data = {};
    if (nombre) data.nombre = nombre;

    // Parseo de Precio
    if (precio != null) data.precio = parseFloat(precio);

    // CORRECCIÓN 1: Parseo de Categoría (String -> Int)
    if (categoriaId) data.categoriaId = parseInt(categoriaId);

    // CORRECCIÓN 2: Parseo de Disponibilidad (String -> Boolean)
    if (disponible != null)
      data.disponible = disponible === "true" || disponible === true;

    if (description) data.description = description;

    // Manejo de imagen nueva
    if (req.file) {
      if (productoExistente.imagen) {
        const rutaVieja = path.resolve(
          "uploads/productos",
          productoExistente.imagen,
        );
        try {
          await fs.unlink(rutaVieja);
          console.log(`Imagen anterior eliminada: ${rutaVieja}`);
        } catch (err) {
          console.warn(
            `No se pudo eliminar la imagen anterior: ${rutaVieja}`,
            err.message,
          );
        }
      }
      data.imagen = req.file.filename;
    } else if (eliminarImagen === "true") {
      if (productoExistente.imagen) {
        const rutaVieja = path.resolve(
          "uploads/productos",
          productoExistente.imagen,
        );
        try {
          await fs.unlink(rutaVieja);
        } catch (err) {
          console.warn(
            `No se pudo eliminar la imagen: ${rutaVieja}`,
            err.message,
          );
        }
      }
      data.imagen = null;
    }

    const productoActualizado = await prisma.producto.update({
      where: { id: Number(id) },
      data,
      include: { categoria: { select: { id: true, nombre: true } } },
    });

    return res.status(200).json({
      message: "Producto actualizado exitosamente",
      data: productoActualizado,
    });
  } catch (error) {
    // Si no tienes handlePrismaError, usa console.error(error) para ver el detalle en los logs del servidor
    handlePrismaError(error, res, "Hubo un error al actualizar el producto");
  }
};

// const actualizarProducto = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const {
//       nombre,
//       precio,
//       description,
//       disponible,
//       categoriaId,
//       eliminarImagen,
//     } = req.body;

//     const productoExistente = await prisma.producto.findUnique({
//       where: { id: Number(id) },
//     });
//     if (!productoExistente) {
//       return res
//         .status(404)
//         .json({ message: "No existe ningún producto asociado a ese Id" });
//     }

//     const data = {};
//     if (nombre) data.nombre = nombre;
//     if (precio != null) data.precio = parseFloat(precio);
//     if (description) data.description = description;
//     if (disponible != null) data.disponible = disponible;
//     if (categoriaId) data.categoriaId = categoriaId;

//     // manejo de imagen nueva
//     if (req.file) {
//       if (productoExistente.imagen) {
//         const rutaVieja = path.resolve(
//           "uploads/productos",
//           productoExistente.imagen,
//         );
//         try {
//           await fs.unlink(rutaVieja);
//           console.log(`Imagen anterior eliminada: ${rutaVieja}`);
//         } catch (err) {
//           console.warn(
//             `No se pudo eliminar la imagen anterior: ${rutaVieja}`,
//             err.message,
//           );
//         }
//       }
//       data.imagen = req.file.filename;
//     } else if (eliminarImagen === "true") {
//       //dejar el producto sin imagen
//       if (productoExistente.imagen) {
//         const rutaVieja = path.join(
//           "uploads/productos",
//           productoExistente.imagen,
//         );
//         try {
//           await fs.unlink(rutaVieja);
//           console.log(`Imagen eliminada: ${rutaVieja}`);
//         } catch (err) {
//           console.warn(`No se pudo eliminar la imagen: ${rutaVieja}`, err);
//         }
//       }
//       data.imagen = null;
//     }

//     const productoActualizado = await prisma.producto.update({
//       where: { id: Number(id) },
//       data,
//       include: { categoria: { select: { id: true, nombre: true } } },
//     });
//     return res.status(200).json({
//       message: "Producto actualizado exitosamente",
//       data: productoActualizado,
//     });
//   } catch (error) {
//     handlePrismaError(error, res, "Hubo un error al actualizar el producto");
//   }
// };

const actualizarDisponibilidadProducto = async (req, res) => {
  try {
    const { id } = req.params;

    const productoExistente = await prisma.producto.findUnique({
      where: { id: Number(id) },
      select: { disponible: true },
    });

    if (!productoExistente) {
      return res
        .status(404)
        .json({ message: "No existe ningún producto asociado a ese Id" });
    }

    const nuevoEstado = !productoExistente.disponible;

    await prisma.producto.update({
      where: { id: Number(id) },
      data: { disponible: nuevoEstado },
    });

    return res.status(200).json({
      message: "Disponibilidad del producto actualizada correctamente",
      disponible: nuevoEstado,
      data: [],
    });
  } catch (error) {
    handlePrismaError(
      error,
      res,
      "Hubo un error al actualizar la disponibilidad del producto",
    );
  }
};

const eliminarProducto = async (req, res) => {
  try {
    const { id } = req.params;

    const productoExistente = await prisma.producto.findUnique({
      where: { id: Number(id) },
    });

    if (!productoExistente) {
      return res
        .status(404)
        .json({ message: "No existe ningún producto asociado a ese Id" });
    }

    // eliminar imagen de los archivos
    if (productoExistente.imagen) {
      const rutaImagen = path.resolve(
        "uploads/productos",
        productoExistente.imagen,
      );
      try {
        await fs.unlink(rutaImagen);
        console.log(`Imagen eliminada: ${rutaImagen}`);
      } catch (err) {
        console.warn(
          `No se pudo eliminar la imagen: ${rutaImagen}`,
          err.message,
        );
      }
    }

    await prisma.producto.delete({
      where: { id: Number(id) },
    });

    return res.status(200).json({ message: "Producto eliminado exitosamente" });
  } catch (error) {
    handlePrismaError(error, res, "Hubo un error al eliminar el producto");
  }
};

export default {
  listarProductos,
  obtenerProductoID,
  crearProducto,
  actualizarProducto,
  actualizarDisponibilidadProducto,
  eliminarProducto,
};
