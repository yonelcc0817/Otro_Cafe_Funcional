// Reglas puras de existencias. Sin Prisma ni Express: se prueban aisladas.

export const MENSAJE_CANTIDAD_INVALIDA =
  "La cantidad disponible debe ser un número entero mayor que cero";

const invalida = () => ({ valid: false, message: MENSAJE_CANTIDAD_INVALIDA });

/**
 * Valida la cantidad que fija el personal al activar o reponer la baja
 * disponibilidad (RF-2). Acepta enteros positivos, como número o como texto.
 */
export const normalizarCantidad = (valor) => {
  if (typeof valor === "number") {
    return Number.isSafeInteger(valor) && valor > 0
      ? { valid: true, cantidad: valor }
      : invalida();
  }

  if (typeof valor !== "string") return invalida();

  const limpio = valor.trim();
  if (!/^\d+$/.test(limpio)) return invalida();

  const cantidad = Number(limpio);
  if (!Number.isSafeInteger(cantidad) || cantidad <= 0) return invalida();

  return { valid: true, cantidad };
};

/**
 * Los tres estados que ve el personal en un único selector. En base de datos
 * son dos columnas (`disponible` y `stock`), pero aquí son una sola cosa: quien
 * elige un estado no tiene que saber qué columna se escribe.
 */
export const ESTADO_DISPONIBLE = "disponible";
export const ESTADO_BAJA = "baja";
export const ESTADO_AGOTADO = "agotado";

export const ESTADOS_VALIDOS = [
  ESTADO_DISPONIBLE,
  ESTADO_BAJA,
  ESTADO_AGOTADO,
];

export const MENSAJE_ESTADO_INVALIDO = `El estado debe ser uno de: ${ESTADOS_VALIDOS.join(", ")}`;
export const MENSAJE_CANTIDAD_REQUERIDA =
  "Para la baja disponibilidad hay que indicar la cantidad disponible";

/** Traduce lo que llega por la API a uno de los tres estados, o error. */
export const normalizarEstado = (valor) => {
  const estado = typeof valor === "string" ? valor.trim().toLowerCase() : "";
  if (!ESTADOS_VALIDOS.includes(estado)) {
    return { valid: false, message: MENSAJE_ESTADO_INVALIDO };
  }
  return { valid: true, estado };
};

/**
 * Estado efectivo de un producto, en el mismo vocabulario que el selector.
 * Un producto oculto a mano (`disponible = false`) se muestra como agotado: para
 * el cliente da igual el motivo, no se le ofrece.
 */
export const estadoDeProducto = (producto) => {
  if (!producto?.disponible) return ESTADO_AGOTADO;
  return estaAgotado(producto) ? ESTADO_AGOTADO : esBajaDisponibilidad(producto) ? ESTADO_BAJA : ESTADO_DISPONIBLE;
};

/**
 * Traduce un estado a las columnas que hay que escribir. Es el único punto que
 * conoce la correspondencia entre lo que elige el personal y la base de datos.
 *
 * - disponible: se levanta cualquier restricción (`stock = null`).
 * - baja: se fija la cantidad indicada.
 * - agotado: cero existencias, oculto del menú.
 */
export const calcularEstado = ({ estado, cantidad }) => {
  const normalizado = normalizarEstado(estado);
  if (!normalizado.valid) return normalizado;

  if (normalizado.estado === ESTADO_BAJA) {
    const validacion = normalizarCantidad(cantidad);
    if (!validacion.valid) {
      return cantidad === undefined || cantidad === null || cantidad === ""
        ? { valid: false, message: MENSAJE_CANTIDAD_REQUERIDA }
        : validacion;
    }
    return { valid: true, data: { disponible: true, stock: validacion.cantidad } };
  }

  if (normalizado.estado === ESTADO_AGOTADO) {
    return { valid: true, data: { disponible: true, stock: 0 } };
  }

  return { valid: true, data: { disponible: true, stock: null } };
};

/** Un producto está en baja disponibilidad cuando tiene una cantidad fijada. */
export const esBajaDisponibilidad = (producto) =>
  producto?.stock !== null && producto?.stock !== undefined;

/** Agotado es la baja disponibilidad con cero unidades (RF-10, RF-12). */
export const estaAgotado = (producto) => producto?.stock === 0;

/**
 * Recorta la cantidad pedida a lo que existe (RF-5, RF-6). `stock` nulo
 * significa venta sin límite y no recorta nada.
 */
export const calcularAjuste = ({ solicitado, stock }) => {
  const pedido = Math.max(0, Number(solicitado) || 0);

  if (stock === null || stock === undefined) {
    return { registrado: pedido, ajustado: false, restante: null };
  }

  const disponible = Math.max(0, Number(stock) || 0);
  const registrado = Math.min(pedido, disponible);

  return {
    registrado,
    ajustado: registrado !== pedido,
    restante: disponible - registrado,
  };
};

const indexarCantidades = (items) => {
  const mapa = new Map();
  for (const item of items ?? []) {
    const productoId = Number(item?.productoId);
    const cantidad = Number(item?.cantidad);
    if (!Number.isInteger(productoId) || !Number.isFinite(cantidad)) continue;
    mapa.set(productoId, (mapa.get(productoId) ?? 0) + cantidad);
  }
  return mapa;
};

/**
 * Diferencia por producto entre el pedido anterior y el nuevo (RF-20).
 * Positivo: hay que consumir más del stock. Negativo: hay que devolverlo.
 */
export const calcularDeltas = ({ anteriores, nuevas }) => {
  const previas = indexarCantidades(anteriores);
  const proximas = indexarCantidades(nuevas);
  const ids = new Set([...previas.keys(), ...proximas.keys()]);

  return [...ids]
    .map((productoId) => ({
      productoId,
      delta: (proximas.get(productoId) ?? 0) - (previas.get(productoId) ?? 0),
    }))
    .filter(({ delta }) => delta !== 0)
    .sort((a, b) => a.productoId - b.productoId);
};

/* ------------------------------------------------------------------ *
 * Dependencias entre productos (spec 004)
 * ------------------------------------------------------------------ */

/** Un producto es dependiente si tiene al menos un producto base. */
export const esProductoDependiente = (dependencias) =>
  Array.isArray(dependencias) && dependencias.length > 0;

/**
 * Estado efectivo de un producto dependiente a partir de sus productos base.
 * El producto dependiente no tiene cantidad propia: hereda el estado más
 * restrictivo de sus dependencias (RF-9, RF-10, RF-11).
 */
export const estadoDerivadoProducto = (producto, bases = []) => {
  if (!producto?.disponible) return ESTADO_AGOTADO;
  if (!esProductoDependiente(bases)) return estadoDeProducto(producto);

  let minimo = null;

  for (const base of bases) {
    if (!base?.disponible) return ESTADO_AGOTADO;
    if (estaAgotado(base)) return ESTADO_AGOTADO;

    if (esBajaDisponibilidad(base)) {
      minimo = minimo === null ? base.stock : Math.min(minimo, base.stock);
    }
  }

  return minimo === null ? ESTADO_DISPONIBLE : ESTADO_BAJA;
};

/**
 * Cantidad vendible de un producto. `null` significa venta sin límite; un
 * número es el tope; `0` significa agotado. Para un dependiente es el mínimo
 * de sus dependencias con límite (RF-12, RF-13). Las dependencias sin límite
 * no acotan.
 */
export const cantidadVendibleProducto = (producto, bases = []) => {
  if (!producto?.disponible) return 0;
  if (!esProductoDependiente(bases)) {
    return producto.stock === null || producto.stock === undefined
      ? null
      : Math.max(0, producto.stock);
  }

  let minimo = null;

  for (const base of bases) {
    if (!base?.disponible || estaAgotado(base)) return 0;

    if (esBajaDisponibilidad(base)) {
      minimo = minimo === null ? base.stock : Math.min(minimo, base.stock);
    }
  }

  return minimo;
};

/**
 * Planifica el consumo de un pedido teniendo en cuenta las dependencias.
 *
 * - `productos`: Map id -> fila de producto ya bloqueada.
 * - `cantidades`: Map id -> cantidad solicitada, en orden de solicitud.
 * - `dependenciasPorProducto`: Map id -> array de ids de productos base.
 *
 * Devuelve las líneas realmente registradas, los ajustes que hay que mostrar
 * al cliente y el consumo agregado por producto base. No escribe nada.
 */
export const planificarConsumo = ({
  productos,
  cantidades,
  dependenciasPorProducto = new Map(),
}) => {
  const items = [];
  const ajustes = [];
  const consumos = new Map();

  const basesDe = (productoId) =>
    dependenciasPorProducto.get(productoId) ?? [];

  const disponibleDeBase = (baseId) => {
    const base = productos.get(baseId);
    if (!base?.disponible) return 0;
    if (base.stock === null || base.stock === undefined) return Infinity;
    return Math.max(0, base.stock - (consumos.get(baseId) ?? 0));
  };

  const disponibleDeProducto = (productoId) => {
    const producto = productos.get(productoId);
    if (!producto?.disponible) return 0;

    const bases = basesDe(productoId);
    if (bases.length === 0) {
      if (producto.stock === null || producto.stock === undefined) {
        return Infinity;
      }
      return Math.max(0, producto.stock - (consumos.get(productoId) ?? 0));
    }

    let minimo = Infinity;
    let tieneLimite = false;

    for (const baseId of bases) {
      const disponible = disponibleDeBase(baseId);
      if (disponible === 0) return 0;
      if (disponible !== Infinity) {
        tieneLimite = true;
        minimo = Math.min(minimo, disponible);
      }
    }

    return tieneLimite ? minimo : Infinity;
  };

  // Descuenta del producto base (o de cada base del dependiente). Las
  // dependencias sin límite no se consumen (RF-17).
  const consumir = (productoId, cantidad) => {
    const bases = basesDe(productoId);

    if (bases.length === 0) {
      const producto = productos.get(productoId);
      if (
        producto &&
        producto.stock !== null &&
        producto.stock !== undefined
      ) {
        consumos.set(
          productoId,
          (consumos.get(productoId) ?? 0) + cantidad,
        );
      }
      return;
    }

    for (const baseId of bases) {
      const base = productos.get(baseId);
      if (base && base.stock !== null && base.stock !== undefined) {
        consumos.set(baseId, (consumos.get(baseId) ?? 0) + cantidad);
      }
    }
  };

  for (const [productoId, solicitado] of cantidades) {
    const producto = productos.get(productoId);

    // Un producto que ya no existe se trata como no disponible: el pedido
    // sigue adelante con el resto en lugar de romperse entero.
    if (!producto) {
      ajustes.push({
        productoId,
        nombre: null,
        solicitado,
        registrado: 0,
        disponible: 0,
        restante: 0,
      });
      continue;
    }

    const disponible = disponibleDeProducto(productoId);
    // Sin tope (`Infinity`) se recorta como un producto sin límite.
    const { registrado } = calcularAjuste({
      solicitado,
      stock: Number.isFinite(disponible) ? disponible : null,
    });

    if (registrado > 0) {
      items.push({ productoId, registrado });
      consumir(productoId, registrado);
    }

    if (registrado !== solicitado) {
      ajustes.push({
        productoId,
        nombre: producto.nombre,
        solicitado,
        registrado,
        disponible: Number.isFinite(disponible) ? disponible : null,
        restante: Number.isFinite(disponible)
          ? disponible - registrado
          : null,
      });
    }
  }

  return { items, ajustes, consumos };
};