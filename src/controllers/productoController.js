import prisma from "../config/database.js";
import { handlePrismaError } from "../utils/handlePrismaError.js";
import { emitCatalogChanged } from "../realtime/events.js";
import {
  esBajaDisponibilidad,
  estaAgotado,
  estadoDeProducto,
  normalizarCantidad,
} from "../services/stockPolicy.js";
import {
  aplicarEstado,
  establecerCantidad,
  quitarLimite,
} from "../services/stockService.js";
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
        destacado: true,
        stock: true,
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
    // La cantidad exacta no sale en el listado público (RF-4): solo se indica
    // si el producto tiene pocas unidades o si ya se agotó.
    const data = productos.map((prod) => ({
      id: prod.id,
      nombre: prod.nombre,
      description: prod.description,
      precio: prod.precio,
      disponible: prod.disponible,
      destacado: prod.destacado,
      bajaDisponibilidad: esBajaDisponibilidad(prod),
      agotado: estaAgotado(prod),
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

    // Igual que en el listado, la cantidad exacta no se expone (RF-4).
    const { stock, ...resto } = producto;

    return res.status(200).json({
      data: {
        ...resto,
        bajaDisponibilidad: esBajaDisponibilidad(producto),
        agotado: estaAgotado(producto),
      },
    });
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
    emitCatalogChanged(req.get("Idempotency-Key"));

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
    emitCatalogChanged(req.get("Idempotency-Key"));

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

// Acepta booleano o el texto que envía el formulario; null si no es válido.
const parsearBooleano = (valor) => {
  if (typeof valor === "boolean") return valor;
  if (typeof valor === "string") {
    const limpio = valor.trim().toLowerCase();
    if (limpio === "true") return true;
    if (limpio === "false") return false;
  }
  return null;
};

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

    // Si el cliente envía un valor concreto se respeta; si no, se mantiene el
    // comportamiento anterior de alternar el estado.
    const solicitado = parsearBooleano(req.body?.disponible);
    const nuevoEstado =
      solicitado === null ? !productoExistente.disponible : solicitado;

    await prisma.producto.update({
      where: { id: Number(id) },
      data: { disponible: nuevoEstado },
    });
    emitCatalogChanged(req.get("Idempotency-Key"));

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

export const destacarProducto = async (req, res) => {
  const { id } = req.params;

  try {
    // Usamos una transacción para asegurar la atomicidad
    const resultado = await prisma.$transaction(async (tx) => {
      // 1. Quitamos el estado 'destacado' de CUALQUIER producto que lo tenga
      await tx.producto.updateMany({
        where: { destacado: true },
        data: { destacado: false },
      });

      // 2. Marcamos el producto actual como destacado
      const actualizado = await tx.producto.update({
        where: { id: parseInt(id) },
        data: { destacado: true },
      });

      return actualizado;
    });
    emitCatalogChanged(req.get("Idempotency-Key"));

    res.status(200).json({
      message: "Producto insignia actualizado correctamente",
      data: resultado,
    });
  } catch (error) {
    console.error("Error al destacar producto:", error);
    res.status(500).json({ message: "Error interno del servidor" });
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
    emitCatalogChanged(req.get("Idempotency-Key"));

    return res.status(200).json({ message: "Producto eliminado exitosamente" });
  } catch (error) {
    handlePrismaError(error, res, "Hubo un error al eliminar el producto");
  }
};

// Vista de gestión: incluye la cantidad exacta, solo para personal.
const listarProductosGestion = async (req, res) => {
  try {
    const productos = await prisma.producto.findMany({
      select: {
        id: true,
        nombre: true,
        description: true,
        precio: true,
        disponible: true,
        destacado: true,
        stock: true,
        imagen: true,
        categoriaId: true,
        categoria: { select: { nombre: true } },
      },
      orderBy: { nombre: "asc" },
    });

    const data = productos.map((prod) => ({
      id: prod.id,
      nombre: prod.nombre,
      description: prod.description,
      precio: prod.precio,
      disponible: prod.disponible,
      destacado: prod.destacado,
      stock: prod.stock,
      bajaDisponibilidad: esBajaDisponibilidad(prod),
      agotado: estaAgotado(prod),
      imagen: prod.imagen,
      categoriaId: prod.categoriaId,
      categoria: prod.categoria.nombre,
    }));

    return res.status(200).json({ data });
  } catch (error) {
    handlePrismaError(error, res, "Error al listar los productos de gestión");
  }
};

// Activa o repone la baja disponibilidad con una cantidad concreta
// (RF-1, RF-2, RF-22, RF-23).
const actualizarStock = async (req, res) => {
  try {
    const { id } = req.params;

    const validacion = normalizarCantidad(req.body?.cantidad);
    if (!validacion.valid) {
      return res.status(400).json({ message: validacion.message });
    }

    const productoExistente = await prisma.producto.findUnique({
      where: { id: Number(id) },
      select: { id: true },
    });

    if (!productoExistente) {
      return res
        .status(404)
        .json({ message: "No existe ningún producto asociado a ese Id" });
    }

    const producto = await establecerCantidad(id, validacion.cantidad);
    emitCatalogChanged(req.get("Idempotency-Key"));

    return res.status(200).json({
      message: "Cantidad disponible actualizada correctamente",
      data: {
        id: producto.id,
        stock: producto.stock,
        bajaDisponibilidad: esBajaDisponibilidad(producto),
        agotado: estaAgotado(producto),
      },
    });
  } catch (error) {
    handlePrismaError(
      error,
      res,
      "Hubo un error al actualizar la cantidad disponible del producto",
    );
  }
};

// Quita la baja disponibilidad: el producto vuelve a venderse sin límite
// (RF-15).
const quitarStock = async (req, res) => {
  try {
    const { id } = req.params;

    const productoExistente = await prisma.producto.findUnique({
      where: { id: Number(id) },
      select: { id: true },
    });

    if (!productoExistente) {
      return res
        .status(404)
        .json({ message: "No existe ningún producto asociado a ese Id" });
    }

    const producto = await quitarLimite(id);
    emitCatalogChanged(req.get("Idempotency-Key"));

    return res.status(200).json({
      message: "El producto vuelve a venderse sin límite",
      data: {
        id: producto.id,
        stock: producto.stock,
        bajaDisponibilidad: esBajaDisponibilidad(producto),
        agotado: estaAgotado(producto),
      },
    });
  } catch (error) {
    handlePrismaError(
      error,
      res,
      "Hubo un error al quitar la cantidad disponible del producto",
    );
  }
};

// Selector único de personal: un solo estado por producto, y es este endpoint
// el que decide qué columnas se escriben para cada uno.
const actualizarEstadoProducto = async (req, res) => {
  try {
    const { id } = req.params;

    const productoExistente = await prisma.producto.findUnique({
      where: { id: Number(id) },
      select: { id: true },
    });

    if (!productoExistente) {
      return res
        .status(404)
        .json({ message: "No existe ningún producto asociado a ese Id" });
    }

    const resultado = await aplicarEstado(id, {
      estado: req.body?.estado,
      cantidad: req.body?.cantidad,
    });

    if (!resultado.valid) {
      return res.status(400).json({ message: resultado.message });
    }

    emitCatalogChanged(req.get("Idempotency-Key"));

    const { producto } = resultado;
    return res.status(200).json({
      message: "Estado del producto actualizado correctamente",
      data: {
        id: producto.id,
        disponible: producto.disponible,
        stock: producto.stock,
        estado: estadoDeProducto(producto),
        bajaDisponibilidad: esBajaDisponibilidad(producto),
        agotado: estaAgotado(producto),
      },
    });
  } catch (error) {
    handlePrismaError(
      error,
      res,
      "Hubo un error al actualizar el estado del producto",
    );
  }
};

export default {
  listarProductos,
  listarProductosGestion,
  obtenerProductoID,
  crearProducto,
  actualizarProducto,
  actualizarDisponibilidadProducto,
  actualizarEstadoProducto,
  actualizarStock,
  quitarStock,
  destacarProducto,
  eliminarProducto,
};
