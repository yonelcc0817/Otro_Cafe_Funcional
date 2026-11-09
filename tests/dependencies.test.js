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

const nuevoProducto = async ({ stock = null, disponible = true } = {}) => {
  const producto = await prisma.producto.create({
    data: {
      nombre: `Prueba dependencia ${crypto.randomUUID()}`,
      precio: 10,
      disponible,
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

const vincular = async (dependienteId, baseId) => {
  const res = await fetch(
    `${servidor.baseUrl}/api/productos/${dependienteId}/dependencias`,
    {
      method: "POST",
      headers: conAdmin(),
      body: JSON.stringify({ baseId }),
    },
  );
  return { res, body: await res.json() };
};

const desvincular = async (dependienteId, baseId) => {
  const res = await fetch(
    `${servidor.baseUrl}/api/productos/${dependienteId}/dependencias/${baseId}`,
    { method: "DELETE", headers: conAdmin() },
  );
  return { res, body: await res.json() };
};

/** Crea un producto dependiente ya vinculado a las bases indicadas. */
const nuevoDependiente = async (bases) => {
  const dependiente = await nuevoProducto({ stock: 99 });
  for (const base of bases) {
    const { res, body } = await vincular(dependiente.id, base.id);
    assert.equal(res.status, 201, body.message);
  }
  return dependiente;
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

const stockDe = async (productoId) => {
  const producto = await prisma.producto.findUnique({
    where: { id: productoId },
    select: { stock: true },
  });
  return producto.stock;
};

const enGestion = async (productoId) => {
  const res = await fetch(`${servidor.baseUrl}/api/productos/gestion`, {
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  const body = await res.json();
  return body.data.find((p) => p.id === productoId);
};

before(async () => {
  servidor = await startTestServer();
  admin = await obtenerAdminActivo(servidor.baseUrl);
  categoria = await prisma.categoria.findFirst({ orderBy: { id: "asc" } });
  const turno = await prisma.turno.findFirst({ orderBy: { id: "desc" } });
  turnoMaximoInicial = turno?.id ?? 0;
});

after(async () => {
  await prisma.pedido.deleteMany({ where: { id: { in: creados.pedidos } } });
  await prisma.productoDependencia.deleteMany({
    where: { dependienteId: { in: creados.productos } },
  });
  await prisma.mesa.deleteMany({ where: { id: { in: creados.mesas } } });
  await prisma.producto.deleteMany({ where: { id: { in: creados.productos } } });
  await prisma.turno.deleteMany({ where: { id: { gt: turnoMaximoInicial } } });
  await limpiarRegistrosIdempotencia(operaciones);
  await servidor.close();
  await prisma.$disconnect();
});

test("vincular productos hereda el estado y descarta la cantidad propia", async (t) => {
  if (!admin) return t.skip("no hay administrador semillado con el que operar");

  const flan = await nuevoProducto({ stock: 5 });
  const helado = await nuevoProducto({ stock: 2 });
  const dependiente = await nuevoProducto({ stock: 99 });

  const primero = await vincular(dependiente.id, flan.id);
  assert.equal(primero.res.status, 201);
  assert.equal(primero.body.data.esDependiente, true);
  assert.equal(primero.body.data.stock, 5);
  assert.equal(primero.body.data.estado, "baja");
  // RF-14: el primer vínculo descarta las existencias propias.
  assert.equal(await stockDe(dependiente.id), null);

  const segundo = await vincular(dependiente.id, helado.id);
  assert.equal(segundo.res.status, 201);
  assert.equal(segundo.body.data.stock, 2);
  assert.deepEqual(
    segundo.body.data.dependencias.map((base) => base.id).sort(),
    [flan.id, helado.id].sort(),
  );

  const gestion = await enGestion(dependiente.id);
  assert.equal(gestion.esDependiente, true);
  assert.equal(gestion.estado, "baja");
  assert.equal(gestion.bajaDisponibilidad, true);
  assert.equal(gestion.agotado, false);

  // Un producto que es base no puede tener dependencias propias (un nivel).
  const base = await enGestion(flan.id);
  assert.equal(base.esDependiente, false);
  assert.deepEqual(
    base.dependientes.map((p) => p.id),
    [dependiente.id],
  );

  // El menú público informa de la baja disponibilidad sin exponer cantidades.
  const res = await fetch(`${servidor.baseUrl}/api/productos`);
  const body = await res.json();
  const publico = body.data.find((p) => p.id === dependiente.id);
  assert.equal(publico.stock, undefined);
  assert.equal(publico.bajaDisponibilidad, true);
});

test("vincular un producto oculto conserva la visibilidad manual", async (t) => {
  if (!admin) return t.skip("no hay administrador semillado con el que operar");

  const base = await nuevoProducto({ stock: 10 });
  const dependiente = await nuevoProducto({ stock: 4, disponible: false });

  const { res } = await vincular(dependiente.id, base.id);
  assert.equal(res.status, 201);

  // RF-29 descarta la cantidad, pero la decisión manual de ocultarlo (RF-27)
  // sigue vigente: sus bases existen, pero el producto no se ofrece.
  const oculto = await enGestion(dependiente.id);
  assert.equal(oculto.esDependiente, true);
  assert.equal(oculto.disponible, false);
  assert.equal(oculto.estado, "agotado");

  // Al volver a mostrarlo aplica el estado derivado de sus bases (RF-28).
  const mostrar = await fetch(
    `${servidor.baseUrl}/api/productos/${dependiente.id}/disponibilidad`,
    {
      method: "PATCH",
      headers: conAdmin(),
      body: JSON.stringify({ disponible: true }),
    },
  );
  assert.equal(mostrar.status, 200);

  const visible = await enGestion(dependiente.id);
  assert.equal(visible.disponible, true);
  assert.equal(visible.estado, "baja");
});

test("un producto dependiente no admite estado ni cantidad propios", async (t) => {
  if (!admin) return t.skip("no hay administrador semillado con el que operar");

  const base = await nuevoProducto({ stock: 8 });
  const dependiente = await nuevoDependiente([base]);

  const intentos = [
    { metodo: "PATCH", ruta: "estado", cuerpo: { estado: "disponible" } },
    { metodo: "PATCH", ruta: "stock", cuerpo: { cantidad: 3 } },
    { metodo: "DELETE", ruta: "stock" },
  ];

  for (const { metodo, ruta, cuerpo } of intentos) {
    const res = await fetch(
      `${servidor.baseUrl}/api/productos/${dependiente.id}/${ruta}`,
      {
        method: metodo,
        headers: conAdmin(),
        body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      },
    );
    assert.equal(res.status, 400, `${metodo} /${ruta}`);
  }

  // Ocultarlo a mano sí está permitido, y se muestra como agotado.
  const oculto = await fetch(
    `${servidor.baseUrl}/api/productos/${dependiente.id}/disponibilidad`,
    {
      method: "PATCH",
      headers: conAdmin(),
      body: JSON.stringify({ disponible: false }),
    },
  );
  assert.equal(oculto.status, 200);
  assert.equal((await enGestion(dependiente.id)).agotado, true);

  await fetch(
    `${servidor.baseUrl}/api/productos/${dependiente.id}/disponibilidad`,
    {
      method: "PATCH",
      headers: conAdmin(),
      body: JSON.stringify({ disponible: true }),
    },
  );
  assert.equal((await enGestion(dependiente.id)).agotado, false);
});

test("vender un dependiente descuenta de todas sus bases", async (t) => {
  if (!admin) return t.skip("no hay administrador semillado con el que operar");

  const flan = await nuevoProducto({ stock: 10 });
  const helado = await nuevoProducto({ stock: 10 });
  const dependiente = await nuevoDependiente([flan, helado]);
  const mesa = await nuevaMesa();

  const { res, body } = await pedir(mesa.codigoQR, [
    { productoId: dependiente.id, cantidad: 2 },
  ]);

  assert.equal(res.status, 201);
  creados.pedidos.push(body.data.id);
  assert.equal(await stockDe(flan.id), 8);
  assert.equal(await stockDe(helado.id), 8);

  const consumos = await prisma.pedidoConsumo.findMany({
    where: { pedidoId: body.data.id },
    orderBy: { productoId: "asc" },
  });
  assert.deepEqual(
    consumos.map(({ productoId, cantidad }) => ({ productoId, cantidad })),
    [
      { productoId: flan.id, cantidad: 2 },
      { productoId: helado.id, cantidad: 2 },
    ],
  );
});

test("el dependiente se agota cuando se agota una de sus bases", async (t) => {
  if (!admin) return t.skip("no hay administrador semillado con el que operar");

  const base = await nuevoProducto({ stock: 1 });
  const dependiente = await nuevoDependiente([base]);
  const mesa = await nuevaMesa();

  const { res, body } = await pedir(mesa.codigoQR, [
    { productoId: dependiente.id, cantidad: 3 },
  ]);
  assert.equal(res.status, 201);
  creados.pedidos.push(body.data.id);
  assert.equal(body.data.productos[0].cantidad, 1);
  assert.equal(await stockDe(base.id), 0);
  assert.equal((await enGestion(dependiente.id)).estado, "agotado");

  const mesa2 = await nuevaMesa();
  const segundo = await pedir(mesa2.codigoQR, [
    { productoId: dependiente.id, cantidad: 1 },
  ]);
  assert.equal(segundo.res.status, 409);
});

test("dos pedidos simultaneos de un dependiente no sobrevenden sus bases", async (t) => {
  if (!admin) return t.skip("no hay administrador semillado con el que operar");

  const base = await nuevoProducto({ stock: 1 });
  const dependiente = await nuevoDependiente([base]);
  const mesaA = await nuevaMesa();
  const mesaB = await nuevaMesa();

  const [a, b] = await Promise.all([
    pedir(mesaA.codigoQR, [{ productoId: dependiente.id, cantidad: 1 }]),
    pedir(mesaB.codigoQR, [{ productoId: dependiente.id, cantidad: 1 }]),
  ]);

  for (const { body } of [a, b]) {
    if (body?.data?.id) creados.pedidos.push(body.data.id);
  }

  const registrado =
    (a.body?.data?.productos?.[0]?.cantidad ?? 0) +
    (b.body?.data?.productos?.[0]?.cantidad ?? 0);

  assert.equal(registrado, 1);
  assert.equal(await stockDe(base.id), 0);
});

test("editar el pedido devuelve a cada base lo que consumio", async (t) => {
  if (!admin) return t.skip("no hay administrador semillado con el que operar");

  const flan = await nuevoProducto({ stock: 10 });
  const helado = await nuevoProducto({ stock: 10 });
  const dependiente = await nuevoDependiente([flan, helado]);
  const mesa = await nuevaMesa();

  const { body } = await pedir(mesa.codigoQR, [
    { productoId: dependiente.id, cantidad: 3 },
  ]);
  creados.pedidos.push(body.data.id);
  assert.equal(await stockDe(flan.id), 7);
  assert.equal(await stockDe(helado.id), 7);

  const edicion = await fetch(
    `${servidor.baseUrl}/api/pedidos/${body.data.id}`,
    {
      method: "PATCH",
      headers: conAdmin(),
      body: JSON.stringify({
        productos: [{ productoId: dependiente.id, cantidad: 1 }],
      }),
    },
  );
  assert.equal(edicion.status, 200);
  assert.equal(await stockDe(flan.id), 9);
  assert.equal(await stockDe(helado.id), 9);
});

test("eliminar el pedido repone todas las bases", async (t) => {
  if (!admin) return t.skip("no hay administrador semillado con el que operar");

  const flan = await nuevoProducto({ stock: 10 });
  const helado = await nuevoProducto({ stock: 10 });
  const dependiente = await nuevoDependiente([flan, helado]);
  const mesa = await nuevaMesa();

  const { body } = await pedir(mesa.codigoQR, [
    { productoId: dependiente.id, cantidad: 2 },
  ]);
  assert.equal(await stockDe(flan.id), 8);
  assert.equal(await stockDe(helado.id), 8);

  const borrado = await fetch(
    `${servidor.baseUrl}/api/pedidos/${body.data.id}`,
    { method: "DELETE", headers: conAdmin() },
  );

  assert.equal(borrado.status, 200);
  assert.equal(await stockDe(flan.id), 10);
  assert.equal(await stockDe(helado.id), 10);
});

test("no se puede eliminar un producto del que dependen otros", async (t) => {
  if (!admin) return t.skip("no hay administrador semillado con el que operar");

  const base = await nuevoProducto({ stock: 4 });
  const dependiente = await nuevoDependiente([base]);

  const res = await fetch(`${servidor.baseUrl}/api/productos/${base.id}`, {
    method: "DELETE",
    headers: conAdmin(),
  });
  const body = await res.json();

  assert.equal(res.status, 409);
  assert.match(body.message, new RegExp(dependiente.nombre));
  assert.equal(await stockDe(base.id), 4);
});

test("quitar el ultimo vinculo deja el producto agotado", async (t) => {
  if (!admin) return t.skip("no hay administrador semillado con el que operar");

  const base = await nuevoProducto({ stock: 6 });
  const dependiente = await nuevoDependiente([base]);

  const { res, body } = await desvincular(dependiente.id, base.id);
  assert.equal(res.status, 200);
  assert.equal(body.data.esDependiente, false);
  assert.equal(body.data.estado, "agotado");
  assert.equal(body.data.stock, 0);
  assert.equal(await stockDe(dependiente.id), 0);

  // Ya sin dependencias, el personal puede asignarle un estado.
  const estado = await fetch(
    `${servidor.baseUrl}/api/productos/${dependiente.id}/estado`,
    {
      method: "PATCH",
      headers: conAdmin(),
      body: JSON.stringify({ estado: "baja", cantidad: 3 }),
    },
  );
  assert.equal(estado.status, 200);
  assert.equal(await stockDe(dependiente.id), 3);
});

test("rechaza vinculos invalidos", async (t) => {
  if (!admin) return t.skip("no hay administrador semillado con el que operar");

  const base = await nuevoProducto({ stock: 4 });
  const dependiente = await nuevoProducto();

  const aSiMismo = await vincular(dependiente.id, dependiente.id);
  assert.equal(aSiMismo.res.status, 400);

  const inexistente = await vincular(dependiente.id, 999999999);
  assert.equal(inexistente.res.status, 404);

  const alta = await vincular(dependiente.id, base.id);
  assert.equal(alta.res.status, 201);

  const repetido = await vincular(dependiente.id, base.id);
  assert.equal(repetido.res.status, 409);

  // El dependiente ya tiene dependencias: no puede ser base de otro producto.
  const otro = await nuevoProducto();
  const enCadena = await vincular(otro.id, dependiente.id);
  assert.equal(enCadena.res.status, 400);

  // Y al revés: un producto que ya es base de otros no puede depender de nadie.
  const baseDeOtro = await nuevoProducto();
  await nuevoDependiente([baseDeOtro]);
  const enCadenaInversa = await vincular(baseDeOtro.id, base.id);
  assert.equal(enCadenaInversa.res.status, 400);
});