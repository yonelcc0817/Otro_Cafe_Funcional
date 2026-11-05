import { Prisma } from "@prisma/client";
import prisma from "../config/database.js";
import {
  calcularAjuste,
  calcularDeltas,
  calcularEstado,
} from "./stockPolicy.js";

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
 */
export const calcularConsumo = ({ productos, cantidades }) => {
  const items = [];
  const ajustes = [];

  for (const [productoId, solicitado] of cantidades) {
    const producto = productos.get(productoId);
    if (!producto) throw new Error(`Producto ${productoId} no encontrado`);

    // Un producto marcado como no disponible no se puede pedir aunque tenga
    // existencias: la baja disponibilidad no lo vuelve a ofrecer.
    const disponibleEfectivo = producto.disponible ? producto.stock : 0;
    const ajuste = calcularAjuste({
      solicitado,
      stock: disponibleEfectivo,
    });

    if (ajuste.registrado > 0) {
      items.push({ productoId, registrado: ajuste.registrado });
    }

    if (ajuste.ajustado || ajuste.registrado === 0) {
      // `disponible` es lo que había antes de descontar: es la cifra que se
      // comunica al cliente cuando su pedido excede las existencias (RF-7).
      ajustes.push({
        productoId,
        nombre: producto.nombre,
        solicitado,
        registrado: ajuste.registrado,
        disponible:
          ajuste.restante === null
            ? null
            : ajuste.registrado + ajuste.restante,
        restante: ajuste.restante ?? 0,
      });
    }
  }

  return { items, ajustes };
};

/** Descuenta del stock lo registrado. Devuelve los que acaban de agotarse. */
export const aplicarConsumo = async (tx, items) => {
  const agotados = [];

  for (const { productoId, registrado } of items) {
    const filas = await tx.$queryRaw`
      UPDATE "Producto"
      SET "stock" = "stock" - ${registrado}
      WHERE "id" = ${productoId}
        AND "stock" IS NOT NULL
        AND "stock" >= ${registrado}
      RETURNING "id", "nombre", "stock"
    `;

    const fila = filas[0];
    if (fila && fila.stock === 0) {
      agotados.push({ productoId: fila.id, nombre: fila.nombre });
    }
  }

  return agotados;
};

/** Devuelve unidades al stock (RF-20, RF-21). Ignora productos sin límite. */
export const aplicarReposicion = async (tx, reposiciones) => {
  for (const { productoId, cantidad } of reposiciones) {
    if (cantidad <= 0) continue;

    await tx.$executeRaw`
      UPDATE "Producto"
      SET "stock" = "stock" + ${cantidad}
      WHERE "id" = ${productoId} AND "stock" IS NOT NULL
    `;
  }
};

/**
 * Concilia el stock al editar las cantidades de un pedido (RF-20).
 *
 * `solicitadas` son las cantidades finales que el usuario quiere dejar en el
 * pedido. Los aumentos se recortan a lo disponible; las reducciones devuelven
 * la diferencia. `cantidadesFinales` trae lo que realmente queda en el pedido.
 */
export const conciliarCantidades = async (
  tx,
  { anteriores, solicitadas },
) => {
  const deltas = calcularDeltas({ anteriores, nuevas: solicitadas });
  const productos = await bloquearProductos(
    tx,
    deltas.map(({ productoId }) => productoId),
  );

  const cantidadesFinales = new Map(
    solicitadas.map(({ productoId, cantidad }) => [Number(productoId), Number(cantidad)]),
  );
  const reposiciones = [];
  const consumos = [];
  const ajustes = [];

  for (const { productoId, delta } of deltas) {
    const producto = productos.get(productoId);
    if (!producto) throw new Error(`Producto ${productoId} no encontrado`);

    if (delta < 0) {
      reposiciones.push({ productoId, cantidad: -delta });
      continue;
    }

    const disponibleEfectivo = producto.disponible ? producto.stock : 0;
    const ajuste = calcularAjuste({
      solicitado: delta,
      stock: disponibleEfectivo,
    });

    if (ajuste.registrado > 0) {
      consumos.push({ productoId, registrado: ajuste.registrado });
    }

    if (ajuste.registrado !== delta) {
      const solicitadaFinal = cantidadesFinales.get(productoId) ?? 0;
      const recortada = solicitadaFinal - delta + ajuste.registrado;
      cantidadesFinales.set(productoId, recortada);
      ajustes.push({
        productoId,
        nombre: producto.nombre,
        solicitado: solicitadaFinal,
        registrado: recortada,
        restante: ajuste.restante ?? 0,
      });
    }
  }

  await aplicarReposicion(tx, reposiciones);
  const agotados = await aplicarConsumo(tx, consumos);

  // Solo los productos con límite cambian de cantidad.
  const cambioStock = deltas.some(({ productoId }) => {
    const producto = productos.get(productoId);
    return producto && producto.stock !== null;
  });

  return { cantidadesFinales, ajustes, agotados, cambioStock };
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