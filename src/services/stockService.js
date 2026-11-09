import { Prisma } from "@prisma/client";
import prisma from "../config/database.js";
import { calcularEstado, planificarConsumo } from "./stockPolicy.js";

/**
 * Bloquea las filas de producto implicadas antes de leer su stock.
 * `FOR UPDATE` dentro de la misma transacción es lo que impide que dos
 * pedidos simultáneos consuman la misma última unidad (RF-9). Los ids se
 * ordenan para que dos transacciones no se bloqueen en orden inverso.
 */
export const bloquearProductos = async (tx, ids) => {
  const unicos = [
    ...new Set(ids.map(Number).filter((id) => Number.isInteger(id))),
  ].sort((a, b) => a - b);

  if (unicos.length === 0) return new Map();

  const filas = await tx.$queryRaw`
    SELECT "id", "nombre", "precio", "imagen", "disponible", "stock"
    FROM "Producto"
    WHERE "id" IN (${Prisma.join(unicos)})
    ORDER BY "id"
    FOR UPDATE
  `;

  return new Map(filas.map((fila) => [fila.id, fila]));
};

/**
 * Decide cuánto se puede registrar de cada producto pedido. No escribe nada:
 * devuelve los consumos a aplicar y los avisos que hay que mostrar al cliente.
 *
 * Si el producto es dependiente, su disponibilidad se calcula con las
 * dependencias y el consumo se descuenta de cada producto base (spec 004).
 */
export const calcularConsumo = ({
  productos,
  cantidades,
  dependenciasPorProducto = new Map(),
}) =>
  planificarConsumo({ productos, cantidades, dependenciasPorProducto });

/** Entradas de un Map de consumos ordenadas por id de producto. */
const ordenarConsumos = (consumos) =>
  [...(consumos ?? [])].sort(([a], [b]) => a - b);

/**
 * Aplica el consumo agregado por producto base que devuelve el planificador.
 * Mantiene la guarda `stock >= cantidad` para no dejar existencias negativas.
 */
export const aplicarConsumos = async (tx, consumos) => {
  const agotados = [];

  // Los ids se recorren en orden ascendente: es el mismo orden en el que se
  // bloquean las filas, y así dos pedidos simultáneos no se esperan en cruz.
  for (const [productoId, cantidad] of ordenarConsumos(consumos)) {
    if (!Number.isFinite(cantidad) || cantidad <= 0) continue;

    const filas = await tx.$queryRaw`
      UPDATE "Producto"
      SET "stock" = "stock" - ${cantidad}
      WHERE "id" = ${productoId}
        AND "stock" IS NOT NULL
        AND "stock" >= ${cantidad}
      RETURNING "id", "nombre", "stock"
    `;

    const fila = filas[0];
    if (!fila) {
      throw new Error(
        `No se pudo descontar ${cantidad} unidades del producto ${productoId}`,
      );
    }
    if (fila.stock === 0) {
      agotados.push({ productoId: fila.id, nombre: fila.nombre });
    }
  }

  return agotados;
};

/**
 * Carga las dependencias salientes de los productos indicados.
 * Devuelve Map<productoId, number[]> con los ids de sus productos base.
 */
export const cargarDependencias = async (tx, productoIds) => {
  const ids = [
    ...new Set(
      (productoIds ?? [])
        .map(Number)
        .filter((id) => Number.isInteger(id)),
    ),
  ];

  const mapa = new Map();
  if (ids.length === 0) return mapa;

  const filas = await tx.productoDependencia.findMany({
    where: { dependienteId: { in: ids } },
    select: { dependienteId: true, baseId: true },
  });

  for (const fila of filas) {
    const bases = mapa.get(fila.dependienteId) ?? [];
    bases.push(fila.baseId);
    mapa.set(fila.dependienteId, bases);
  }

  return mapa;
};

/** Ids de producto base referenciados por un mapa de dependencias. */
export const idsDeDependencias = (dependenciasPorProducto) => [
  ...new Set(
    [...(dependenciasPorProducto?.values() ?? [])]
      .flat()
      .map(Number)
      .filter((id) => Number.isInteger(id)),
  ),
];

/**
 * Consume el stock de los productos pedidos dentro de una transacción.
 *
 * Bloquea de una vez los productos pedidos y sus productos base: sin ese
 * bloqueo, dos pedidos simultáneos del mismo producto dependiente podrían
 * consumir la última unidad de su base (RF-18 a RF-21).
 */
export const consumirPedido = async (
  tx,
  { cantidades, dependenciasPorProducto = new Map() },
) => {
  const productos = await bloquearProductos(tx, [
    ...cantidades.keys(),
    ...idsDeDependencias(dependenciasPorProducto),
  ]);

  const plan = calcularConsumo({
    productos,
    cantidades,
    dependenciasPorProducto,
  });

  const agotados = await aplicarConsumos(tx, plan.consumos);

  return {
    items: plan.items,
    ajustes: plan.ajustes,
    consumos: plan.consumos,
    agotados,
    productos,
    // Solo se toca el catálogo si algún producto base tenía límite.
    cambioStock: plan.consumos.size > 0,
  };
};

/**
 * Suma el consumo de este pedido a la tabla PedidoConsumo. Si el pedido ya
 * tenía consumido ese producto base (por ejemplo, al añadir más productos a
 * un pedido abierto), incrementa la cantidad.
 */
export const registrarConsumosPedido = async (tx, pedidoId, consumos) => {
  for (const [productoId, cantidad] of consumos ?? []) {
    if (!Number.isFinite(cantidad) || cantidad <= 0) continue;

    await tx.pedidoConsumo.upsert({
      where: { pedidoId_productoId: { pedidoId, productoId } },
      create: { pedidoId, productoId, cantidad },
      update: { cantidad: { increment: cantidad } },
    });
  }
};

/**
 * Devuelve al stock exactamente lo que el pedido había descontado. Usa el
 * desglose guardado en PedidoConsumo; si el pedido es anterior a esta
 * funcionalidad, cae al comportamiento anterior (solo productos con límite).
 */
export const reponerConsumosPedido = async (tx, pedidoId, consumosPrevios) => {
  if (consumosPrevios.length > 0) {
    await aplicarReposicion(
      tx,
      consumosPrevios.map(({ productoId, cantidad }) => ({
        productoId,
        cantidad,
      })),
    );
    return;
  }

  const pedido = await tx.pedido.findUnique({
    where: { id: pedidoId },
    select: { productos: true },
  });
  if (!pedido) return;

  const conLimite = await bloquearConLimite(tx, pedido.productos);
  await reponerPedido(tx, pedido.productos, conLimite);
};

/** Devuelve unidades al stock (RF-20, RF-21). Ignora productos sin límite. */
export const aplicarReposicion = async (tx, reposiciones) => {
  const ordenadas = [...(reposiciones ?? [])].sort(
    (a, b) => a.productoId - b.productoId,
  );

  for (const { productoId, cantidad } of ordenadas) {
    if (cantidad <= 0) continue;

    await tx.$executeRaw`
      UPDATE "Producto"
      SET "stock" = "stock" + ${cantidad}
      WHERE "id" = ${productoId} AND "stock" IS NOT NULL
    `;
  }
};

/**
 * Reajusta el consumo de un pedido ya existente al editar sus cantidades
 * (RF-32 a RF-37).
 *
 * Se devuelve al stock exactamente lo que el pedido tenía descontado y se
 * vuelve a consumir con el catálogo actual. El desglose guardado en
 * PedidoConsumo es lo que permite devolver lo correcto aunque las
 * dependencias hayan cambiado desde que se creó el pedido.
 */
export const reconciliarConsumosPedido = async (
  tx,
  { pedidoId, productosPedido, cantidades, dependenciasPorProducto = new Map() },
) => {
  const consumosPrevios = await tx.pedidoConsumo.findMany({
    where: { pedidoId },
    select: { productoId: true, cantidad: true },
  });

  // Un único bloqueo, en orden ascendente, de todo lo que se va a tocar:
  // productos pedidos, sus bases, lo que consumía el pedido y lo que figuraba
  // en él. A partir de aquí, cualquier otra transacción espera.
  await bloquearProductos(tx, [
    ...cantidades.keys(),
    ...idsDeDependencias(dependenciasPorProducto),
    ...consumosPrevios.map(({ productoId }) => productoId),
    ...(productosPedido ?? []).map((item) => item?.productoId),
  ]);

  await reponerConsumosPedido(tx, pedidoId, consumosPrevios);
  await tx.pedidoConsumo.deleteMany({ where: { pedidoId } });

  // Las filas acaban de cambiar: hay que releerlas ya bloqueadas para no
  // planificar sobre existencias desactualizadas.
  const consumido = await consumirPedido(tx, {
    cantidades,
    dependenciasPorProducto,
  });

  await registrarConsumosPedido(tx, pedidoId, consumido.consumos);

  return {
    ...consumido,
    cambioStock: consumido.cambioStock || consumosPrevios.length > 0,
  };
};

/** Devuelve al stock todo lo que descontó un pedido (RF-21). */
export const reponerPedido = async (tx, productos, productoIdsBloqueados) => {
  const reposiciones = new Map();
  for (const item of productos ?? []) {
    const productoId = Number(item?.productoId);
    const cantidad = Number(item?.cantidad);
    if (!Number.isInteger(productoId) || !Number.isFinite(cantidad)) continue;
    if (cantidad <= 0) continue;
    if (!productoIdsBloqueados.has(productoId)) continue;
    reposiciones.set(productoId, (reposiciones.get(productoId) ?? 0) + cantidad);
  }

  await aplicarReposicion(
    tx,
    [...reposiciones].map(([productoId, cantidad]) => ({
      productoId,
      cantidad,
    })),
  );
};

/**
 * Fija la cantidad de baja disponibilidad (RF-1, RF-22, RF-23).
 *
 * Activar la baja disponibilidad también deja el producto disponible: si
 * siguiera marcado como no disponible, la cantidad fijada no tendría efecto
 * y el producto continuaría oculto.
 */
export const establecerCantidad = (id, cantidad) =>
  prisma.producto.update({
    where: { id: Number(id) },
    data: { stock: cantidad, disponible: true },
  });

/** Quita la baja disponibilidad: vuelve a venderse sin límite (RF-15). */
export const quitarLimite = (id) =>
  prisma.producto.update({
    where: { id: Number(id) },
    data: { stock: null },
  });

/**
 * Aplica uno de los tres estados del selector en una sola escritura. Es el
 * único camino por el que el personal cambia disponibilidad y existencias, para
 * que las dos columnas no puedan quedar en una combinación que no existe en la
 * interfaz.
 */
export const aplicarEstado = async (id, { estado, cantidad }) => {
  const calculo = calcularEstado({ estado, cantidad });
  if (!calculo.valid) return calculo;

  const producto = await prisma.producto.update({
    where: { id: Number(id) },
    data: calculo.data,
  });

  return { valid: true, producto };
};

/** Bloquea y devuelve solo los productos que siguen con límite de stock. */
export const bloquearConLimite = async (tx, productos) => {
  const ids = (productos ?? [])
    .map((item) => Number(item?.productoId))
    .filter((id) => Number.isInteger(id));

  const bloqueados = await bloquearProductos(tx, ids);
  return new Set(
    [...bloqueados]
      .filter(([, producto]) => producto.stock !== null)
      .map(([id]) => id),
  );
};