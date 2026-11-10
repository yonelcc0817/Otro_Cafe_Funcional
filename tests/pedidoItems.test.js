import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import {
  limpiarRegistrosIdempotencia,
  obtenerAdminActivo,
  prisma,
  startTestServer,
} from "./helpers/testContext.js";

let servidor;
let admin;
let categoria;
let turnoMaximoInicial = 0;

const creados = { productos: [], pedidos: [], mesas: [] };
const operaciones = [];

const nuevaClave = () => {
  const clave = crypto.randomUUID();
  operaciones.push(clave);
  return clave;
};

const nuevoProducto = async ({ precio = 10, stock = null } = {}) => {
  const producto = await prisma.producto.create({
    data: {
      nombre: `Prueba items ${crypto.randomUUID()}`,
      precio,
      disponible: true,
      stock,
      categoriaId: categoria.id,
    },
  });
  creados.productos.push(producto.id);
  return producto;
};

const nuevaMesa = async () => {
  const mesa = await prisma.mesa.create({
    data: {
      nombre: `Prueba ${crypto.randomUUID()}`,
      codigoQR: crypto.randomUUID(),
    },
  });
  creados.mesas.push(mesa.id);
  return mesa;
};

const conAdmin = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${admin.token}`,
  "Idempotency-Key": nuevaClave(),
});

const pedir = async (codigoQR, productos) => {
  const res = await fetch(`${servidor.baseUrl}/api/pedidos`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": nuevaClave(),
    },
    body: JSON.stringify({ codigoQR, productos }),
  });
  const body = await res.json();
  if (body?.data?.id) creados.pedidos.push(body.data.id);
  return { res, body };
};

const marcarHecho = async (pedidoId, index) => {
  const res = await fetch(
    `${servidor.baseUrl}/api/pedidos/${pedidoId}/items/${index}/done`,
    { method: "PATCH", headers: conAdmin() },
  );
  return { res, body: await res.json() };
};

const editarPedido = async (pedidoId, productos) => {
  const res = await fetch(`${servidor.baseUrl}/api/pedidos/${pedidoId}`, {
    method: "PATCH",
    headers: conAdmin(),
    body: JSON.stringify({ productos }),
  });
  return { res, body: await res.json() };
};

/** Resumen de los ítems para comparar sin depender de campos internos. */
const resumen = (body) =>
  (body?.data?.productos ?? []).map((item) => ({
    productoId: item.productoId,
    cantidad: item.cantidad,
    done: item.done === true,
    delivered: item.delivered === true,
  }));

before(async () => {
  servidor = await startTestServer();
  admin = await obtenerAdminActivo(servidor.baseUrl);
  categoria = await prisma.categoria.findFirst({ orderBy: { id: "asc" } });
  const turno = await prisma.turno.findFirst({ orderBy: { id: "desc" } });
  turnoMaximoInicial = turno?.id ?? 0;
});

after(async () => {
  await prisma.pedido.deleteMany({ where: { id: { in: creados.pedidos } } });
  await prisma.mesa.deleteMany({ where: { id: { in: creados.mesas } } });
  await prisma.producto.deleteMany({ where: { id: { in: creados.productos } } });
  await prisma.turno.deleteMany({ where: { id: { gt: turnoMaximoInicial } } });
  await limpiarRegistrosIdempotencia(operaciones);
  await servidor.close();
  await prisma.$disconnect();
});

test("pedir de nuevo un producto pendiente suma en el mismo item", async (t) => {
  if (!admin) return t.skip("no hay administrador semillado con el que operar");

  const cafe = await nuevoProducto();
  const mesa = await nuevaMesa();

  const primero = await pedir(mesa.codigoQR, [
    { productoId: cafe.id, cantidad: 1 },
  ]);
  assert.equal(primero.res.status, 201);

  const segundo = await pedir(mesa.codigoQR, [
    { productoId: cafe.id, cantidad: 1 },
  ]);
  assert.equal(segundo.res.status, 200);

  assert.deepEqual(resumen(segundo.body), [
    { productoId: cafe.id, cantidad: 2, done: false, delivered: false },
  ]);
  assert.equal(segundo.body.data.total, 20);
});

test("pedir de nuevo un producto ya hecho crea un item independiente", async (t) => {
  if (!admin) return t.skip("no hay administrador semillado con el que operar");

  const cafe = await nuevoProducto();
  const mesa = await nuevaMesa();

  const primero = await pedir(mesa.codigoQR, [
    { productoId: cafe.id, cantidad: 1 },
  ]);
  assert.equal(primero.res.status, 201);

  const hecho = await marcarHecho(primero.body.data.id, 0);
  assert.equal(hecho.res.status, 200);
  assert.equal(hecho.body.data.productos[0].done, true);

  const segundo = await pedir(mesa.codigoQR, [
    { productoId: cafe.id, cantidad: 1 },
  ]);
  assert.equal(segundo.res.status, 200);

  assert.deepEqual(resumen(segundo.body), [
    { productoId: cafe.id, cantidad: 1, done: true, delivered: false },
    { productoId: cafe.id, cantidad: 1, done: false, delivered: false },
  ]);
  assert.equal(segundo.body.data.total, 20);
});

test("editar el pedido conserva un item hecho y otro pendiente", async (t) => {
  if (!admin) return t.skip("no hay administrador semillado con el que operar");

  const cafe = await nuevoProducto();
  const mesa = await nuevaMesa();

  const primero = await pedir(mesa.codigoQR, [
    { productoId: cafe.id, cantidad: 1 },
  ]);
  assert.equal(primero.res.status, 201);
  await marcarHecho(primero.body.data.id, 0);

  // Lo mismo que envía la pantalla de edición: los dos ítems con su estado.
  const editado = await editarPedido(primero.body.data.id, [
    { productoId: cafe.id, cantidad: 1, done: true, delivered: false },
    { productoId: cafe.id, cantidad: 1, done: false, delivered: false },
  ]);
  assert.equal(editado.res.status, 200);

  assert.deepEqual(resumen(editado.body), [
    { productoId: cafe.id, cantidad: 1, done: true, delivered: false },
    { productoId: cafe.id, cantidad: 1, done: false, delivered: false },
  ]);
  assert.equal(editado.body.data.total, 20);
});

test("editar el pedido suma en el item pendiente sin tocar el hecho", async (t) => {
  if (!admin) return t.skip("no hay administrador semillado con el que operar");

  const cafe = await nuevoProducto();
  const mesa = await nuevaMesa();

  const primero = await pedir(mesa.codigoQR, [
    { productoId: cafe.id, cantidad: 1 },
  ]);
  assert.equal(primero.res.status, 201);
  await marcarHecho(primero.body.data.id, 0);

  // La pantalla ya sumó la unidad nueva al ítem pendiente que creó.
  const editado = await editarPedido(primero.body.data.id, [
    { productoId: cafe.id, cantidad: 1, done: true, delivered: false },
    { productoId: cafe.id, cantidad: 2, done: false, delivered: false },
  ]);
  assert.equal(editado.res.status, 200);

  assert.deepEqual(resumen(editado.body), [
    { productoId: cafe.id, cantidad: 1, done: true, delivered: false },
    { productoId: cafe.id, cantidad: 2, done: false, delivered: false },
  ]);
  assert.equal(editado.body.data.total, 30);
});