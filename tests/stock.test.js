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

const nuevoProducto = async (stock) => {
  const producto = await prisma.producto.create({
    data: {
      nombre: `Prueba stock ${crypto.randomUUID()}`,
      precio: 10,
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
    data: { nombre: `Prueba ${crypto.randomUUID()}`, codigoQR: crypto.randomUUID() },
  });
  creados.mesas.push(mesa.id);
  return mesa;
};

const pedir = async (codigoQR, productos) => {
  const res = await fetch(`${servidor.baseUrl}/api/pedidos`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": nuevaClave(),
    },
    body: JSON.stringify({ codigoQR, productos }),
  });
  return { res, body: await res.json() };
};

const conAdmin = (extra = {}) => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${admin.token}`,
  "Idempotency-Key": nuevaClave(),
  ...extra,
});

const stockDe = async (productoId) => {
  const producto = await prisma.producto.findUnique({
    where: { id: productoId },
    select: { stock: true },
  });
  return producto.stock;
};

const cantidadRegistrada = (body, productoId) =>
  body?.data?.productos?.find((p) => p.productoId === productoId)?.cantidad ?? 0;

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

test("recorta el pedido a lo disponible y comunica la cantidad exacta", async (t) => {
  if (!admin) return t.skip("no hay administrador semillado con el que operar");

  const producto = await nuevoProducto(2);
  const mesa = await nuevaMesa();

  const { res, body } = await pedir(mesa.codigoQR, [
    { productoId: producto.id, cantidad: 5 },
  ]);

  assert.equal(res.status, 201);
  creados.pedidos.push(body.data.id);
  assert.equal(cantidadRegistrada(body, producto.id), 2);

  const ajuste = body.ajustes.find((a) => a.productoId === producto.id);
  assert.equal(ajuste.solicitado, 5);
  assert.equal(ajuste.registrado, 2);
  assert.equal(ajuste.disponible, 2);
  assert.equal(ajuste.restante, 0);
  assert.equal(await stockDe(producto.id), 0);
});

test("descuenta exactamente lo pedido cuando no excede el stock", async (t) => {
  if (!admin) return t.skip("no hay administrador semillado con el que operar");

  const producto = await nuevoProducto(5);
  const mesa = await nuevaMesa();

  const { res, body } = await pedir(mesa.codigoQR, [
    { productoId: producto.id, cantidad: 2 },
  ]);

  assert.equal(res.status, 201);
  creados.pedidos.push(body.data.id);
  assert.equal(body.ajustes.length, 0);
  assert.equal(await stockDe(producto.id), 3);
});

test("un producto sin límite no se recorta nunca", async (t) => {
  if (!admin) return t.skip("no hay administrador semillado con el que operar");

  const producto = await nuevoProducto(null);
  const mesa = await nuevaMesa();

  const { res, body } = await pedir(mesa.codigoQR, [
    { productoId: producto.id, cantidad: 100 },
  ]);

  assert.equal(res.status, 201);
  creados.pedidos.push(body.data.id);
  assert.equal(cantidadRegistrada(body, producto.id), 100);
  assert.equal(body.ajustes.length, 0);
  assert.equal(await stockDe(producto.id), null);
});

test("no crea pedido cuando ningún producto tiene disponibilidad", async (t) => {
  if (!admin) return t.skip("no hay administrador semillado con el que operar");

  const producto = await nuevoProducto(0);
  const mesa = await nuevaMesa();

  const { res, body } = await pedir(mesa.codigoQR, [
    { productoId: producto.id, cantidad: 1 },
  ]);

  assert.equal(res.status, 409);
  assert.equal(body.ajustes[0].registrado, 0);
  assert.equal(body.ajustes[0].disponible, 0);

  const abiertos = await prisma.pedido.count({
    where: { mesaId: mesa.id, estado: "abierto" },
  });
  assert.equal(abiertos, 0);
});

test("dos pedidos simultáneos por la última unidad no se sobrevenden", async (t) => {
  if (!admin) return t.skip("no hay administrador semillado con el que operar");

  const producto = await nuevoProducto(1);
  const mesaA = await nuevaMesa();
  const mesaB = await nuevaMesa();

  const [a, b] = await Promise.all([
    pedir(mesaA.codigoQR, [{ productoId: producto.id, cantidad: 1 }]),
    pedir(mesaB.codigoQR, [{ productoId: producto.id, cantidad: 1 }]),
  ]);

  for (const { body } of [a, b]) {
    if (body?.data?.id) creados.pedidos.push(body.data.id);
  }

  const total =
    cantidadRegistrada(a.body, producto.id) +
    cantidadRegistrada(b.body, producto.id);

  assert.equal(total, 1);
  assert.equal(await stockDe(producto.id), 0);
});

test("editar el pedido a la baja devuelve la diferencia al stock", async (t) => {
  if (!admin) return t.skip("no hay administrador semillado con el que operar");

  const producto = await nuevoProducto(5);
  const mesa = await nuevaMesa();

  const { body } = await pedir(mesa.codigoQR, [
    { productoId: producto.id, cantidad: 3 },
  ]);
  creados.pedidos.push(body.data.id);
  assert.equal(await stockDe(producto.id), 2);

  const edicion = await fetch(
    `${servidor.baseUrl}/api/pedidos/${body.data.id}`,
    {
      method: "PATCH",
      headers: conAdmin(),
      body: JSON.stringify({
        productos: [{ productoId: producto.id, cantidad: 1 }],
      }),
    },
  );
  assert.equal(edicion.status, 200);
  assert.equal(await stockDe(producto.id), 4);
});

test("un aumento por encima de lo disponible se recorta al editar", async (t) => {
  if (!admin) return t.skip("no hay administrador semillado con el que operar");

  const producto = await nuevoProducto(4);
  const mesa = await nuevaMesa();

  const { body } = await pedir(mesa.codigoQR, [
    { productoId: producto.id, cantidad: 1 },
  ]);
  creados.pedidos.push(body.data.id);
  assert.equal(await stockDe(producto.id), 3);

  const edicion = await fetch(
    `${servidor.baseUrl}/api/pedidos/${body.data.id}`,
    {
      method: "PATCH",
      headers: conAdmin(),
      body: JSON.stringify({
        productos: [{ productoId: producto.id, cantidad: 10 }],
      }),
    },
  );
  const resultado = await edicion.json();

  assert.equal(edicion.status, 200);
  assert.equal(resultado.data.productos[0].cantidad, 4);
  assert.equal(await stockDe(producto.id), 0);
});

test("eliminar el pedido devuelve todo lo descontado", async (t) => {
  if (!admin) return t.skip("no hay administrador semillado con el que operar");

  const producto = await nuevoProducto(3);
  const mesa = await nuevaMesa();

  const { body } = await pedir(mesa.codigoQR, [
    { productoId: producto.id, cantidad: 3 },
  ]);
  assert.equal(await stockDe(producto.id), 0);

  const borrado = await fetch(
    `${servidor.baseUrl}/api/pedidos/${body.data.id}`,
    { method: "DELETE", headers: conAdmin() },
  );

  assert.equal(borrado.status, 200);
  assert.equal(await stockDe(producto.id), 3);
});

test("activar la baja disponibilidad rechaza cantidades inválidas", async (t) => {
  if (!admin) return t.skip("no hay administrador semillado con el que operar");

  const producto = await nuevoProducto(null);

  for (const cantidad of [0, -1, 1.5, "abc", "", null]) {
    const res = await fetch(
      `${servidor.baseUrl}/api/productos/${producto.id}/stock`,
      {
        method: "PATCH",
        headers: conAdmin(),
        body: JSON.stringify({ cantidad }),
      },
    );
    assert.equal(res.status, 400, `debería rechazar ${String(cantidad)}`);
  }

  assert.equal(await stockDe(producto.id), null);
});

test("activar, reponer y quitar la baja disponibilidad", async (t) => {
  if (!admin) return t.skip("no hay administrador semillado con el que operar");

  const producto = await nuevoProducto(null);
  const url = `${servidor.baseUrl}/api/productos/${producto.id}/stock`;

  const alta = await fetch(url, {
    method: "PATCH",
    headers: conAdmin(),
    body: JSON.stringify({ cantidad: 4 }),
  });
  const altaBody = await alta.json();
  assert.equal(alta.status, 200);
  assert.equal(altaBody.data.stock, 4);
  assert.equal(altaBody.data.bajaDisponibilidad, true);
  assert.equal(await stockDe(producto.id), 4);

  const reposicion = await fetch(url, {
    method: "PATCH",
    headers: conAdmin(),
    body: JSON.stringify({ cantidad: 9 }),
  });
  assert.equal(reposicion.status, 200);
  assert.equal(await stockDe(producto.id), 9);

  const quitado = await fetch(url, {
    method: "DELETE",
    headers: conAdmin(),
  });
  const quitadoBody = await quitado.json();
  assert.equal(quitado.status, 200);
  assert.equal(quitadoBody.data.stock, null);
  assert.equal(quitadoBody.data.bajaDisponibilidad, false);
  assert.equal(await stockDe(producto.id), null);
});

test("el listado público oculta la cantidad exacta", async () => {
  const producto = await nuevoProducto(7);

  const res = await fetch(`${servidor.baseUrl}/api/productos`);
  const body = await res.json();
  const encontrado = body.data.find((p) => p.id === producto.id);

  assert.equal(encontrado.stock, undefined);
  assert.equal(encontrado.bajaDisponibilidad, true);
  assert.equal(encontrado.agotado, false);
});

test("la vista de gestión sí expone la cantidad", async (t) => {
  if (!admin) return t.skip("no hay administrador semillado con el que operar");

  const producto = await nuevoProducto(7);

  const res = await fetch(`${servidor.baseUrl}/api/productos/gestion`, {
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  const body = await res.json();
  const encontrado = body.data.find((p) => p.id === producto.id);

  assert.equal(res.status, 200);
  assert.equal(encontrado.stock, 7);
});

test("la vista de gestión exige autenticación", async () => {
  const res = await fetch(`${servidor.baseUrl}/api/productos/gestion`);
  assert.equal(res.status, 401);
});

test("el selector de estado aplica las columnas de cada opción", async (t) => {
  if (!admin) return t.skip("no hay administrador semillado con el que operar");

  const producto = await nuevoProducto(null);
  const url = `${servidor.baseUrl}/api/productos/${producto.id}/estado`;
  const aplicar = async (cuerpo) => {
    const res = await fetch(url, {
      method: "PATCH",
      headers: conAdmin(),
      body: JSON.stringify(cuerpo),
    });
    return { res, body: await res.json() };
  };

  // Baja disponibilidad: fija la cantidad y deja el producto en venta.
  const baja = await aplicar({ estado: "baja", cantidad: 4 });
  assert.equal(baja.res.status, 200);
  assert.equal(baja.body.data.estado, "baja");
  assert.equal(baja.body.data.stock, 4);

  // Agotado: cero existencias, oculto del menú.
  const agotado = await aplicar({ estado: "agotado" });
  assert.equal(agotado.res.status, 200);
  assert.equal(agotado.body.data.estado, "agotado");
  assert.equal(agotado.body.data.stock, 0);
  assert.equal(await stockDe(producto.id), 0);

  // Disponible: se levanta la restricción por completo.
  const disponible = await aplicar({ estado: "disponible" });
  assert.equal(disponible.res.status, 200);
  assert.equal(disponible.body.data.estado, "disponible");
  assert.equal(disponible.body.data.stock, null);
  assert.equal(await stockDe(producto.id), null);

  // Un producto oculto a mano se reabre eligiendo un estado.
  await prisma.producto.update({
    where: { id: producto.id },
    data: { disponible: false },
  });
  const reabierto = await aplicar({ estado: "baja", cantidad: 2 });
  assert.equal(reabierto.res.status, 200);
  assert.equal(reabierto.body.data.estado, "baja");
  const enBase = await prisma.producto.findUnique({
    where: { id: producto.id },
    select: { disponible: true },
  });
  assert.equal(enBase.disponible, true);
});

test("el selector de estado rechaza estados y cantidades inválidas", async (t) => {
  if (!admin) return t.skip("no hay administrador semillado con el que operar");

  const producto = await nuevoProducto(null);
  const url = `${servidor.baseUrl}/api/productos/${producto.id}/estado`;

  for (const cuerpo of [
    { estado: "inventado" },
    {},
    { estado: "baja" },
    { estado: "baja", cantidad: 0 },
    { estado: "baja", cantidad: -2 },
    { estado: "baja", cantidad: 1.5 },
    { estado: "baja", cantidad: "abc" },
  ]) {
    const res = await fetch(url, {
      method: "PATCH",
      headers: conAdmin(),
      body: JSON.stringify(cuerpo),
    });
    assert.equal(res.status, 400, `debería rechazar ${JSON.stringify(cuerpo)}`);
  }

  assert.equal(await stockDe(producto.id), null);
});