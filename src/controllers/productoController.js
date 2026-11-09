import prisma from "../config/database.js";
import { handlePrismaError } from "../utils/handlePrismaError.js";
import { emitCatalogChanged } from "../realtime/events.js";
import {
  ESTADO_AGOTADO,
  ESTADO_BAJA,
  cantidadVendibleProducto,
  esBajaDisponibilidad,
  esProductoDependiente,
  estaAgotado,
  estadoDeProducto,
  estadoDerivadoProducto,
  normalizarCantidad,
} from "../services/stockPolicy.js";
import {
  aplicarEstado,
  establecerCantidad,
  quitarLimite,
} from "../services/stockService.js";
import path from "path";
import fs from "fs/promises";

// Productos base de los que depende un producto (spec 004).
const basesDeProducto = (producto) =>
  (producto?.dependencias ?? [])
    .map((dependencia) => dependencia.base)
    .filter(Boolean);

// Estado y marca que se muestran al cliente o al personal. Para un producto
// dependiente se calculan a partir de sus productos base (RF-9 a RF-11).
const estadoConDependencias = (producto, bases) => {
  const estado = estadoDerivadoProducto(producto, bases);
  return {
    estado,
    bajaDisponibilidad: estado === ESTADO_BAJA,
    agotado: estado === ESTADO_AGOTADO,
  };
};

const selectDependencias = {
  dependencias: {
    select: {
      base: {
        select: { id: true, nombre: true, disponible: true, stock: true },
      },
    },
  },
};

const selectDependientes = {
  dependientes: {
    select: { dependiente: { select: { id: true, nombre: true } } },
  },
};

const selectProductoGestion = {
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
  ...selectDependencias,
  ...selectDependientes,
};

// Un producto con dependencias no admite estado ni cantidad propios: ambos se
// calculan con sus productos base (RF-14 a RF-16).
const MENSAJE_DEPENDIENTE =
  "La disponibilidad de este producto se calcula con sus dependencias: cámbiala en los productos base o quita las dependencias";

// Relee un producto con el formato que espera la gestión.
const productoGestion = (id) =>
  prisma.producto.findUnique({
    where: { id: Number(id) },
    select: selectProductoGestion,
  });

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
        ...selectDependencias,
      },

      orderBy: { nombre: "asc" },
    });
    if (productos.length === 0) {
      return res
        .status(200)
        .json({ message: "No se encontraron productos", data: [] });
    }
    // La cantidad exacta no sale en el listado público (RF-4): solo se indica
    // si el producto tiene pocas unidades o si ya se agotó. En un producto
    // dependiente esas marcas se heredan de sus productos base (RF-9 a RF-11).
    const data = productos.map((prod) => {
      const bases = basesDeProducto(prod);
      const { bajaDisponibilidad, agotado } = estadoConDependencias(prod, bases);

      return {
        id: prod.id,
        nombre: prod.nombre,
        description: prod.description,
        precio: prod.precio,
        disponible: prod.disponible,
        destacado: prod.destacado,
        bajaDisponibilidad,
        agotado,
        imagen: prod.imagen,
        categoriaId: prod.categoriaId,
        categoria: prod.categoria.nombre,
      };
    });

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
      include: { categoria: true, ...selectDependencias },
    });
    if (!producto) {
      return res
        .status(404)
        .json({ message: "No existe ningún producto asociado a ese Id" });
    }

    const bases = basesDeProducto(producto);
    const { bajaDisponibilidad, agotado } = estadoConDependencias(
      producto,
      bases,
    );

    // Igual que en el listado, no se expone ninguna cantidad: ni la propia ni
    // la de los productos base de los que depende (RF-4).
    return res.status(200).json({
      data: {
        id: producto.id,
        nombre: producto.nombre,
        description: producto.description,
        precio: producto.precio,
        disponible: producto.disponible,
        destacado: producto.destacado,
        imagen: producto.imagen,
        categoriaId: producto.categoriaId,
        categoria: producto.categoria,
        bajaDisponibilidad,
        agotado,
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

    // RF-43: no se puede eliminar un producto del que otros dependen. Se
    // comprueba antes de borrar la imagen para no dejar el catálogo a medias.
    const dependientes = await prisma.productoDependencia.findMany({
      where: { baseId: Number(id) },
      select: { dependiente: { select: { id: true, nombre: true } } },
    });

    if (dependientes.length > 0) {
      const nombres = dependientes
        .map(({ dependiente }) => dependiente.nombre)
        .join(", ");
      const verbo = dependientes.length === 1 ? "depende" : "dependen";

      return res.status(409).json({
        message: `No se puede eliminar: ${nombres} ${verbo} de este producto. Quita antes esas dependencias.`,
        data: dependientes.map(({ dependiente }) => dependiente),
      });
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

/**
 * Formato que ve el personal: cantidad exacta, estado derivado y las
 * dependencias con las que se calcula. Es el único sitio donde se decide qué
 * significa cada campo para la interfaz de gestión.
 */
const formatearProductoGestion = (prod) => {
  // Si el producto desapareció entre la transacción y la relectura, se responde
  // sin datos en lugar de reventar con un 500 sobre un cambio ya confirmado.
  if (!prod) return null;

  const bases = basesDeProducto(prod);
  const esDependiente = esProductoDependiente(bases);
  const { estado, bajaDisponibilidad, agotado } = estadoConDependencias(
    prod,
    bases,
  );

  return {
    id: prod.id,
    nombre: prod.nombre,
    description: prod.description,
    precio: prod.precio,
    disponible: prod.disponible,
    destacado: prod.destacado,
    // Un producto dependiente no tiene cantidad propia (RF-14): se informa la
    // cantidad que puede venderse según sus productos base (RF-12, RF-13).
    stock: esDependiente ? cantidadVendibleProducto(prod, bases) : prod.stock,
    esDependiente,
    estado,
    bajaDisponibilidad,
    agotado,
    dependencias: bases.map((base) => ({
      id: base.id,
      nombre: base.nombre,
      disponible: base.disponible,
      stock: base.stock,
      estado: estadoDeProducto(base),
    })),
    dependientes: (prod.dependientes ?? []).map(({ dependiente }) => dependiente),
    imagen: prod.imagen,
    categoriaId: prod.categoriaId,
    categoria: prod.categoria?.nombre,
  };
};

// Vista de gestión: incluye la cantidad exacta, solo para personal.
const listarProductosGestion = async (req, res) => {
  try {
    const productos = await prisma.producto.findMany({
      select: selectProductoGestion,
      orderBy: { nombre: "asc" },
    });

    const data = productos.map(formatearProductoGestion);

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
      select: { id: true, _count: { select: { dependencias: true } } },
    });

    if (!productoExistente) {
      return res
        .status(404)
        .json({ message: "No existe ningún producto asociado a ese Id" });
    }

    if (productoExistente._count.dependencias > 0) {
      return res.status(400).json({ message: MENSAJE_DEPENDIENTE });
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
      select: { id: true, _count: { select: { dependencias: true } } },
    });

    if (!productoExistente) {
      return res
        .status(404)
        .json({ message: "No existe ningún producto asociado a ese Id" });
    }

    if (productoExistente._count.dependencias > 0) {
      return res.status(400).json({ message: MENSAJE_DEPENDIENTE });
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
      select: { id: true, _count: { select: { dependencias: true } } },
    });

    if (!productoExistente) {
      return res
        .status(404)
        .json({ message: "No existe ningún producto asociado a ese Id" });
    }

    if (productoExistente._count.dependencias > 0) {
      return res.status(400).json({ message: MENSAJE_DEPENDIENTE });
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

/**
 * Vincula un producto base al producto indicado (RF-6 a RF-8).
 *
 * Al crear el primer vínculo el producto deja de tener existencias propias: su
 * cantidad pasa a derivarse de sus productos base (RF-14).
 */
const agregarDependencia = async (req, res) => {
  try {
    const dependienteId = Number(req.params.id);
    const baseId = Number(req.body?.baseId);

    if (!Number.isInteger(dependienteId) || !Number.isInteger(baseId)) {
      return res
        .status(400)
        .json({ message: "Hay que indicar un producto base válido" });
    }

    if (dependienteId === baseId) {
      return res
        .status(400)
        .json({ message: "Un producto no puede depender de sí mismo" });
    }

    const [dependiente, base] = await Promise.all([
      prisma.producto.findUnique({
        where: { id: dependienteId },
        select: {
          id: true,
          _count: { select: { dependencias: true, dependientes: true } },
        },
      }),
      prisma.producto.findUnique({
        where: { id: baseId },
        select: { id: true, _count: { select: { dependencias: true } } },
      }),
    ]);

    if (!dependiente) {
      return res
        .status(404)
        .json({ message: "No existe ningún producto asociado a ese Id" });
    }

    if (!base) {
      return res
        .status(404)
        .json({ message: "No existe el producto base indicado" });
    }

    // Solo se admite un nivel: ni el producto base puede depender de otros, ni
    // el dependiente puede ser base de un tercero. Así no hay cadenas.
    if (dependiente._count.dependientes > 0) {
      return res.status(400).json({
        message:
          "Ese producto es base de otros: solo se admite un nivel de dependencia",
      });
    }

    if (base._count.dependencias > 0) {
      return res.status(400).json({
        message:
          "Ese producto ya depende de otros: solo se admite un nivel de dependencia",
      });
    }

    const yaVinculado = await prisma.productoDependencia.findUnique({
      where: { dependienteId_baseId: { dependienteId, baseId } },
      select: { baseId: true },
    });

    if (yaVinculado) {
      return res
        .status(409)
        .json({ message: "Ese producto ya es una dependencia" });
    }

    const esPrimera = dependiente._count.dependencias === 0;

    await prisma.$transaction(async (tx) => {
      await tx.productoDependencia.create({ data: { dependienteId, baseId } });

      // RF-29: el primer vínculo descarta las existencias propias. Desde aquí
      // el producto se vende según lo que quede de sus productos base.
      // La visibilidad manual no se toca: si el personal lo había ocultado,
      // sigue oculto (RF-27 y RF-28).
      if (esPrimera) {
        await tx.producto.update({
          where: { id: dependienteId },
          data: { stock: null },
        });
      }
    });

    emitCatalogChanged(req.get("Idempotency-Key"));

    const producto = await productoGestion(dependienteId);

    return res.status(201).json({
      message: "Dependencia agregada correctamente",
      data: formatearProductoGestion(producto),
    });
  } catch (error) {
    handlePrismaError(
      error,
      res,
      "Hubo un error al agregar la dependencia del producto",
    );
  }
};

/**
 * Quita un vínculo del producto. Al quitar el último, el producto queda
 * agotado hasta que el personal le asigne un estado: así no se ofrece como
 * vendible mientras nadie ha decidido con qué existencias cuenta.
 */
const quitarDependencia = async (req, res) => {
  try {
    const dependienteId = Number(req.params.id);
    const baseId = Number(req.params.baseId);

    if (!Number.isInteger(dependienteId) || !Number.isInteger(baseId)) {
      return res
        .status(400)
        .json({ message: "La dependencia indicada no es válida" });
    }

    const vinculo = await prisma.productoDependencia.findUnique({
      where: { dependienteId_baseId: { dependienteId, baseId } },
      select: { baseId: true },
    });

    if (!vinculo) {
      return res.status(404).json({
        message: "Ese producto no es una dependencia de este producto",
      });
    }

    await prisma.$transaction(async (tx) => {
      await tx.productoDependencia.delete({
        where: { dependienteId_baseId: { dependienteId, baseId } },
      });

      const restantes = await tx.productoDependencia.count({
        where: { dependienteId },
      });

      if (restantes === 0) {
        await tx.producto.update({
          where: { id: dependienteId },
          data: { stock: 0 },
        });
      }
    });

    emitCatalogChanged(req.get("Idempotency-Key"));

    const producto = await productoGestion(dependienteId);

    return res.status(200).json({
      message: "Dependencia eliminada correctamente",
      data: formatearProductoGestion(producto),
    });
  } catch (error) {
    handlePrismaError(
      error,
      res,
      "Hubo un error al quitar la dependencia del producto",
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
  agregarDependencia,
  quitarDependencia,
};
