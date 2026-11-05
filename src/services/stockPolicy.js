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