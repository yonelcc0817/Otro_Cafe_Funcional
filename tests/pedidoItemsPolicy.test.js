import test from "node:test";
import assert from "node:assert/strict";
import { reconstruirItemsPedido } from "../src/services/pedidoItemsPolicy.js";

const productosPorId = new Map([
  [1, { id: 1, nombre: "Cafe", precio: 10, imagen: "cafe.png" }],
  [2, { id: 2, nombre: "Flan", precio: 20, imagen: null }],
]);

const reconstruir = ({ items, registradas }) =>
  reconstruirItemsPedido({
    items,
    registradas,
    productosPorId,
  });

test("los items pendientes del mismo producto se suman en uno solo", () => {
  const items = reconstruir({
    items: [
      { productoId: 1, cantidad: 1, done: false },
      { productoId: 1, cantidad: 1, done: false },
    ],
    registradas: new Map([[1, 2]]),
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].cantidad, 2);
  assert.equal(items[0].subtotal, 20);
  assert.equal(items[0].done, false);
});

test("un item hecho y otro pendiente del mismo producto quedan separados", () => {
  const items = reconstruir({
    items: [
      { productoId: 1, cantidad: 1, done: true, delivered: false },
      { productoId: 1, cantidad: 1, done: false },
    ],
    registradas: new Map([[1, 2]]),
  });

  assert.equal(items.length, 2);
  assert.deepEqual(
    items.map((item) => ({ cantidad: item.cantidad, done: item.done })),
    [
      { cantidad: 1, done: true },
      { cantidad: 1, done: false },
    ],
  );
});

test("el recorte se aplica primero a los pendientes", () => {
  const items = reconstruir({
    items: [
      { productoId: 1, cantidad: 1, done: true },
      { productoId: 1, cantidad: 1, done: false },
    ],
    registradas: new Map([[1, 1]]),
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].done, true);
  assert.equal(items[0].cantidad, 1);
});

test("el recorte solo toca lo preparado si aun falta por recortar", () => {
  const items = reconstruir({
    items: [
      { productoId: 1, cantidad: 2, done: true },
      { productoId: 1, cantidad: 1, done: false },
    ],
    registradas: new Map([[1, 1]]),
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].done, true);
  assert.equal(items[0].cantidad, 1);
});

test("los productos sin unidades registradas no se guardan", () => {
  const items = reconstruir({
    items: [
      { productoId: 1, cantidad: 1 },
      { productoId: 2, cantidad: 1 },
    ],
    registradas: new Map([[1, 1]]),
  });

  assert.deepEqual(
    items.map((item) => item.productoId),
    [1],
  );
});

test("entregado forma su propio grupo aunque este hecho", () => {
  const items = reconstruir({
    items: [
      { productoId: 1, cantidad: 1, done: true, delivered: true },
      { productoId: 1, cantidad: 1, done: true, delivered: false },
    ],
    registradas: new Map([[1, 2]]),
  });

  assert.equal(items.length, 2);
  assert.deepEqual(
    items.map((item) => item.delivered),
    [true, false],
  );
});

test("un producto desconocido no se puede reconstruir", () => {
  assert.throws(
    () =>
      reconstruir({
        items: [{ productoId: 999, cantidad: 1 }],
        registradas: new Map([[999, 1]]),
      }),
    /no encontrado/,
  );
});