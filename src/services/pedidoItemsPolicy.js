/**
 * Reglas de los ítems de un pedido.
 *
 * Un ítem ya preparado (`done`) y otro pendiente del mismo producto se
 * mantienen como ítems separados: el pedido muestra así una unidad hecha y
 * otra por hacer. Solo se suman las cantidades de ítems que comparten producto
 * y estado, de modo que volver a pedir un producto que ya está pendiente
 * aumenta ese mismo ítem.
 */

const esCantidadValida = (cantidad) =>
  Number.isInteger(cantidad) && cantidad > 0;

const claveDeGrupo = (productoId, done, delivered) =>
  `${productoId}|${done}|${delivered}`;

/**
 * Reconstruye el arreglo `productos` que se guarda en el pedido a partir de
 * los ítems que envía el cliente o el personal.
 *
 * @param {object} opciones
 * @param {Array} opciones.items Ítems solicitados: `{ productoId, cantidad,
 *   done?, delivered? }`. Los duplicados con el mismo estado se suman.
 * @param {Map<number, number>} opciones.registradas Unidades que el stock
 *   permite registrar, por producto.
 * @param {Map<number, object>} opciones.productosPorId Datos actuales del
 *   catálogo (`nombre`, `precio`, `imagen`).
 */
export const reconstruirItemsPedido = ({
  items,
  registradas,
  productosPorId,
}) => {
  const grupos = new Map();

  for (const item of items ?? []) {
    const productoId = Number(item?.productoId);
    const cantidad = Number(item?.cantidad);

    if (!Number.isInteger(productoId) || !esCantidadValida(cantidad)) continue;

    const done = item?.done === true;
    const delivered = item?.delivered === true;
    const clave = claveDeGrupo(productoId, done, delivered);
    const grupo = grupos.get(clave);

    if (grupo) {
      grupo.cantidad += cantidad;
    } else {
      // El orden de inserción se conserva: los índices de la interfaz no
      // cambian al guardar una edición.
      grupos.set(clave, { productoId, done, delivered, cantidad });
    }
  }

  const gruposPorProducto = new Map();
  for (const grupo of grupos.values()) {
    const lista = gruposPorProducto.get(grupo.productoId) ?? [];
    lista.push(grupo);
    gruposPorProducto.set(grupo.productoId, lista);
  }

  // El stock puede alcanzar solo para parte de lo solicitado. El recorte se
  // aplica primero a los ítems pendientes (los últimos añadidos) y solo
  // después a los ya preparados, que no deben deshacerse por falta de stock.
  for (const [productoId, gruposProducto] of gruposPorProducto) {
    const registrado = registradas.get(productoId) ?? 0;
    const solicitado = gruposProducto.reduce(
      (suma, grupo) => suma + grupo.cantidad,
      0,
    );
    let sobrante = solicitado - registrado;
    if (sobrante <= 0) continue;

    const ordenDeRecorte = [
      ...gruposProducto.filter((grupo) => !grupo.done).reverse(),
      ...gruposProducto.filter((grupo) => grupo.done).reverse(),
    ];

    for (const grupo of ordenDeRecorte) {
      if (sobrante <= 0) break;
      const quitado = Math.min(grupo.cantidad, sobrante);
      grupo.cantidad -= quitado;
      sobrante -= quitado;
    }
  }

  const resultado = [];

  for (const grupo of grupos.values()) {
    if (grupo.cantidad <= 0) continue;

    const producto = productosPorId.get(grupo.productoId);
    if (!producto) {
      throw new Error(`Producto ${grupo.productoId} no encontrado`);
    }

    resultado.push({
      productoId: grupo.productoId,
      nombre: producto.nombre,
      precio: producto.precio,
      cantidad: grupo.cantidad,
      subtotal: producto.precio * grupo.cantidad,
      imagen: producto.imagen,
      done: grupo.done,
      delivered: grupo.delivered,
    });
  }

  return resultado;
};