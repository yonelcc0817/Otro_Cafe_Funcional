import test from "node:test";
import assert from "node:assert/strict";
import {
  calcularAjuste,
  calcularDeltas,
  cantidadVendibleProducto,
  esBajaDisponibilidad,
  esProductoDependiente,
  estaAgotado,
  estadoDerivadoProducto,
  normalizarCantidad,
  planificarConsumo,
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

/* ------------------------------------------------------------------ *
 * Dependencias entre productos (spec 004)
 * ------------------------------------------------------------------ */

const producto = (
  id,
  { stock = null, disponible = true, nombre = `Producto ${id}` } = {},
) => ({ id, nombre, precio: 10, disponible, stock });

test("un producto es dependiente solo si tiene productos base", () => {
  assert.equal(esProductoDependiente([]), false);
  assert.equal(esProductoDependiente(undefined), false);
  assert.equal(esProductoDependiente([1]), true);
});

test("el estado de un producto sin dependencias es el suyo propio", () => {
  assert.equal(estadoDerivadoProducto(producto(1)), "disponible");
  assert.equal(estadoDerivadoProducto(producto(1, { stock: 3 })), "baja");
  assert.equal(estadoDerivadoProducto(producto(1, { stock: 0 })), "agotado");
  assert.equal(
    estadoDerivadoProducto(producto(1, { disponible: false })),
    "agotado",
  );
});

test("un producto dependiente hereda el estado mas restrictivo de sus bases", () => {
  const dependiente = producto(2);
  const flan = producto(1, { stock: 5 });
  const helado = producto(3, { stock: 2 });

  assert.equal(estadoDerivadoProducto(dependiente, [flan, helado]), "baja");
  assert.equal(
    estadoDerivadoProducto(dependiente, [producto(1), producto(3)]),
    "disponible",
  );
  // Una base agotada agota el producto dependiente.
  assert.equal(
    estadoDerivadoProducto(dependiente, [flan, producto(3, { stock: 0 })]),
    "agotado",
  );
  // Una base ocultada a mano también lo deja agotado.
  assert.equal(
    estadoDerivadoProducto(dependiente, [
      flan,
      producto(3, { disponible: false }),
    ]),
    "agotado",
  );
  // El propio producto oculto manda sobre sus bases.
  assert.equal(
    estadoDerivadoProducto(producto(2, { disponible: false }), [flan]),
    "agotado",
  );
});

test("la cantidad vendible de un dependiente es el minimo de sus bases", () => {
  const dependiente = producto(2);

  assert.equal(cantidadVendibleProducto(producto(1, { stock: 4 })), 4);
  assert.equal(cantidadVendibleProducto(producto(1)), null);
  assert.equal(
    cantidadVendibleProducto(dependiente, [
      producto(1, { stock: 5 }),
      producto(3, { stock: 3 }),
    ]),
    3,
  );
  assert.equal(
    cantidadVendibleProducto(dependiente, [
      producto(1),
      producto(3, { stock: 3 }),
    ]),
    3,
  );
  assert.equal(
    cantidadVendibleProducto(dependiente, [producto(1), producto(3)]),
    null,
  );
  assert.equal(
    cantidadVendibleProducto(dependiente, [
      producto(1, { stock: 5 }),
      producto(3, { stock: 0 }),
    ]),
    0,
  );
  assert.equal(
    cantidadVendibleProducto(dependiente, [
      producto(1, { stock: 5 }),
      producto(3, { disponible: false }),
    ]),
    0,
  );
  assert.equal(
    cantidadVendibleProducto(producto(2, { disponible: false }), [producto(1)]),
    0,
  );
});

test("vender un dependiente descuenta de cada una de sus bases", () => {
  const productos = new Map([
    [1, producto(1, { stock: 10 })],
    [2, producto(2)],
    [3, producto(3, { stock: 10 })],
  ]);
  const plan = planificarConsumo({
    productos,
    cantidades: new Map([[2, 2]]),
    dependenciasPorProducto: new Map([[2, [1, 3]]]),
  });

  assert.deepEqual(plan.items, [{ productoId: 2, registrado: 2 }]);
  assert.deepEqual(Object.fromEntries(plan.consumos), { 1: 2, 3: 2 });
  assert.deepEqual(plan.ajustes, []);
});

test("un dependiente se recorta al minimo de sus bases con limite", () => {
  const productos = new Map([
    [1, producto(1, { stock: 3 })],
    [2, producto(2)],
    [3, producto(3, { stock: 10 })],
  ]);
  const plan = planificarConsumo({
    productos,
    cantidades: new Map([[2, 5]]),
    dependenciasPorProducto: new Map([[2, [1, 3]]]),
  });

  assert.deepEqual(plan.items, [{ productoId: 2, registrado: 3 }]);
  assert.deepEqual(plan.ajustes, [
    {
      productoId: 2,
      nombre: "Producto 2",
      solicitado: 5,
      registrado: 3,
      disponible: 3,
      restante: 0,
    },
  ]);
  assert.deepEqual(Object.fromEntries(plan.consumos), { 1: 3, 3: 3 });
});

test("un dependiente con una base agotada no se vende", () => {
  const productos = new Map([
    [1, producto(1, { stock: 5 })],
    [2, producto(2)],
    [3, producto(3, { stock: 0 })],
  ]);
  const plan = planificarConsumo({
    productos,
    cantidades: new Map([[2, 1]]),
    dependenciasPorProducto: new Map([[2, [1, 3]]]),
  });

  assert.deepEqual(plan.items, []);
  assert.deepEqual(Object.fromEntries(plan.consumos), {});
  assert.equal(plan.ajustes[0].registrado, 0);
  assert.equal(plan.ajustes[0].disponible, 0);
});

test("vender un dependiente no descuenta de bases sin limite", () => {
  const productos = new Map([
    [1, producto(1)],
    [2, producto(2)],
    [3, producto(3)],
  ]);
  const plan = planificarConsumo({
    productos,
    cantidades: new Map([[2, 5]]),
    dependenciasPorProducto: new Map([[2, [1, 3]]]),
  });

  assert.deepEqual(plan.items, [{ productoId: 2, registrado: 5 }]);
  assert.deepEqual(Object.fromEntries(plan.consumos), {});
  assert.deepEqual(plan.ajustes, []);
});

test("un pedido con base y dependiente comparte las mismas unidades", () => {
  const productos = new Map([
    [1, producto(1, { stock: 5 })],
    [2, producto(2)],
  ]);
  const plan = planificarConsumo({
    productos,
    cantidades: new Map([
      [2, 3],
      [1, 2],
    ]),
    dependenciasPorProducto: new Map([[2, [1]]]),
  });

  assert.deepEqual(plan.items, [
    { productoId: 2, registrado: 3 },
    { productoId: 1, registrado: 2 },
  ]);
  assert.deepEqual(plan.ajustes, []);
  assert.deepEqual(Object.fromEntries(plan.consumos), { 1: 5 });
});

test("un pedido con base y dependiente se recorta antes de sobrevender", () => {
  const productos = new Map([
    [1, producto(1, { stock: 5 })],
    [2, producto(2)],
  ]);
  const plan = planificarConsumo({
    productos,
    cantidades: new Map([
      [2, 4],
      [1, 3],
    ]),
    dependenciasPorProducto: new Map([[2, [1]]]),
  });

  assert.deepEqual(plan.items, [
    { productoId: 2, registrado: 4 },
    { productoId: 1, registrado: 1 },
  ]);
  assert.equal(plan.ajustes[0].productoId, 1);
  assert.equal(plan.ajustes[0].registrado, 1);
  assert.deepEqual(Object.fromEntries(plan.consumos), { 1: 5 });
});

test("dos dependientes de la misma base no se sobrevenden entre si", () => {
  const productos = new Map([
    [1, producto(1, { stock: 5 })],
    [2, producto(2)],
    [3, producto(3)],
  ]);
  const dependencias = new Map([
    [2, [1]],
    [3, [1]],
  ]);

  const plan = planificarConsumo({
    productos,
    cantidades: new Map([
      [2, 3],
      [3, 3],
    ]),
    dependenciasPorProducto: dependencias,
  });

  assert.deepEqual(plan.items, [
    { productoId: 2, registrado: 3 },
    { productoId: 3, registrado: 2 },
  ]);
  assert.equal(plan.ajustes.length, 1);
  assert.equal(plan.ajustes[0].productoId, 3);
  assert.equal(plan.ajustes[0].registrado, 2);
  assert.deepEqual(Object.fromEntries(plan.consumos), { 1: 5 });
});

test("un producto inexistente se informa como no disponible", () => {
  const plan = planificarConsumo({
    productos: new Map(),
    cantidades: new Map([[99, 2]]),
    dependenciasPorProducto: new Map(),
  });

  assert.deepEqual(plan.items, []);
  assert.deepEqual(plan.ajustes, [
    {
      productoId: 99,
      nombre: null,
      solicitado: 2,
      registrado: 0,
      disponible: 0,
      restante: 0,
    },
  ]);
});