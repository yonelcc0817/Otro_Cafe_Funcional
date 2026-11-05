import test from "node:test";
import assert from "node:assert/strict";
import {
  calcularAjuste,
  calcularDeltas,
  esBajaDisponibilidad,
  estaAgotado,
  normalizarCantidad,
} from "../src/services/stockPolicy.js";

test("normalizarCantidad acepta enteros positivos", () => {
  assert.deepEqual(normalizarCantidad(5), { valid: true, cantidad: 5 });
  assert.deepEqual(normalizarCantidad("5"), { valid: true, cantidad: 5 });
  assert.deepEqual(normalizarCantidad("  7  "), { valid: true, cantidad: 7 });
  assert.deepEqual(normalizarCantidad("12"), { valid: true, cantidad: 12 });
});

test("normalizarCantidad rechaza cero, negativos, decimales y texto", () => {
  const invalidos = [
    0,
    -1,
    -10,
    1.5,
    "0",
    "-3",
    "1.5",
    "abc",
    "",
    "   ",
    null,
    undefined,
    true,
    {},
    [],
  ];

  for (const valor of invalidos) {
    const resultado = normalizarCantidad(valor);
    assert.equal(resultado.valid, false, `debería rechazar ${String(valor)}`);
    assert.ok(resultado.message);
  }
});

test("esBajaDisponibilidad distingue null de una cantidad fijada", () => {
  assert.equal(esBajaDisponibilidad({ stock: null }), false);
  assert.equal(esBajaDisponibilidad({}), false);
  assert.equal(esBajaDisponibilidad({ stock: 0 }), true);
  assert.equal(esBajaDisponibilidad({ stock: 3 }), true);
});

test("estaAgotado solo cuando el stock es cero", () => {
  assert.equal(estaAgotado({ stock: 0 }), true);
  assert.equal(estaAgotado({ stock: 1 }), false);
  assert.equal(estaAgotado({ stock: null }), false);
  assert.equal(estaAgotado({}), false);
});

test("calcularAjuste no recorta un producto sin límite", () => {
  assert.deepEqual(calcularAjuste({ solicitado: 100, stock: null }), {
    registrado: 100,
    ajustado: false,
    restante: null,
  });
});

test("calcularAjuste recorta al stock y reporta lo que queda", () => {
  assert.deepEqual(calcularAjuste({ solicitado: 5, stock: 3 }), {
    registrado: 3,
    ajustado: true,
    restante: 0,
  });

  assert.deepEqual(calcularAjuste({ solicitado: 2, stock: 5 }), {
    registrado: 2,
    ajustado: false,
    restante: 3,
  });

  assert.deepEqual(calcularAjuste({ solicitado: 1, stock: 0 }), {
    registrado: 0,
    ajustado: true,
    restante: 0,
  });
});

test("calcularDeltas suma duplicados y devuelve la diferencia por producto", () => {
  const deltas = calcularDeltas({
    anteriores: [
      { productoId: 1, cantidad: 3 },
      { productoId: 2, cantidad: 1 },
      { productoId: 3, cantidad: 2 },
    ],
    nuevas: [
      { productoId: 1, cantidad: 1 },
      { productoId: 2, cantidad: 1 },
      { productoId: 2, cantidad: 2 },
      { productoId: 4, cantidad: 5 },
    ],
  });

  assert.deepEqual(deltas, [
    { productoId: 1, delta: -2 },
    { productoId: 2, delta: 2 },
    { productoId: 3, delta: -2 },
    { productoId: 4, delta: 5 },
  ]);
});

test("calcularDeltas ignora lo que no cambia y tolera claves ausentes", () => {
  assert.deepEqual(
    calcularDeltas({
      anteriores: [{ productoId: 7, cantidad: 2 }],
      nuevas: [{ productoId: 7, cantidad: 2 }],
    }),
    [],
  );

  assert.deepEqual(calcularDeltas({ anteriores: null, nuevas: [] }), []);
});