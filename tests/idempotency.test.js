import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import idempotencyMiddleware from "../src/middlewares/idempotencyMiddleware.js";
import { prisma, limpiarRegistrosIdempotencia } from "./helpers/testContext.js";

const clavesUsadas = [];

const nuevaClave = () => {
  const clave = randomUUID();
  clavesUsadas.push(clave);
  return clave;
};

// `authorization` no lleva valor por defecto a propósito: en JavaScript pasar
// `undefined` activaría el default, y una prueba de "cliente sin autenticar"
// enviaría un token sin querer. Sin default, `undefined` significa de verdad
// "sin header", igual que `req.get("Authorization")` en Express.
const crearReq = ({
  key,
  method = "POST",
  url = "/api/categorias",
  body = {},
  authorization,
  user = { id: 1 },
} = {}) => ({
  method,
  originalUrl: url,
  body,
  user,
  get(header) {
    const nombre = String(header).toLowerCase();
    if (nombre === "idempotency-key") return key;
    if (nombre === "authorization") return authorization;
    return undefined;
  },
});

const crearRes = () => ({
  statusCode: 200,
  headersSent: false,
  headers: {},
  body: undefined,
  status(code) {
    this.statusCode = code;
    return this;
  },
  set(nombre, valor) {
    this.headers[nombre] = valor;
    return this;
  },
  json(payload) {
    this.body = payload;
    return Promise.resolve(this);
  },
});

/** Ejecuta el middleware y devuelve el estado resultante de la petición. */
const ejecutar = async (req) => {
  const res = crearRes();
  let nextLlamado = false;
  let errorRecibido = null;

  await idempotencyMiddleware(req, res, (error) => {
    nextLlamado = true;
    if (error) errorRecibido = error;
  });

  return { req, res, nextLlamado, errorRecibido };
};

before(async () => {
  // Confirma que la tabla de idempotencia existe antes de probar el middleware.
  await prisma.$queryRaw`SELECT 1 FROM "IdempotencyRecord" LIMIT 1`;
});

after(async () => {
  await limpiarRegistrosIdempotencia(clavesUsadas);
  await prisma.$disconnect();
});

describe("idempotencyMiddleware", () => {
  it("deja pasar la petición sin tocar la base cuando no hay Idempotency-Key", async () => {
    const { nextLlamado, req } = await ejecutar(crearReq({ key: undefined }));
    assert.equal(nextLlamado, true);
    assert.equal(req.idempotencyKey, undefined);
  });

  it("rechaza una Idempotency-Key desmesurada con 400", async () => {
    const { res, nextLlamado } = await ejecutar(
      crearReq({ key: "x".repeat(129) }),
    );
    assert.equal(nextLlamado, false);
    assert.equal(res.statusCode, 400);
  });

  it("reserva la operación, permite ejecutarla y guarda la respuesta", async () => {
    const key = nuevaClave();
    const { req, res, nextLlamado } = await ejecutar(crearReq({ key }));

    assert.equal(nextLlamado, true);
    assert.equal(req.idempotencyKey, key);

    res.status(201);
    await res.json({ id: 42, nombre: "Categoría de prueba" });

    const registro = await prisma.idempotencyRecord.findUnique({
      where: { operationId: key },
    });
    assert.ok(registro, "el recibo debe quedar persistido");
    assert.equal(registro.statusCode, 201);
    assert.equal(registro.response.nombre, "Categoría de prueba");
    assert.ok(registro.completedAt, "el recibo debe quedar completado");
  });

  it("repite la respuesta almacenada sin volver a ejecutar el controlador", async () => {
    const key = nuevaClave();
    const cuerpo = { nombre: `Repetible ${Date.now()}` };

    const primera = await ejecutar(crearReq({ key, body: cuerpo }));
    assert.equal(primera.nextLlamado, true);
    primera.res.status(201);
    await primera.res.json({ id: 7, ...cuerpo });

    const segunda = await ejecutar(crearReq({ key, body: cuerpo }));
    assert.equal(segunda.nextLlamado, false, "no debe reejecutarse");
    assert.equal(segunda.res.statusCode, 201);
    assert.equal(segunda.res.body.id, 7);
    assert.equal(segunda.res.body.nombre, cuerpo.nombre);
  });

  it("responde 409 cuando la misma clave llega con otro cuerpo", async () => {
    const key = nuevaClave();

    const primera = await ejecutar(
      crearReq({ key, body: { nombre: "Original" } }),
    );
    assert.equal(primera.nextLlamado, true);
    await primera.res.json({ id: 1 });

    const segunda = await ejecutar(
      crearReq({ key, body: { nombre: "Distinto" } }),
    );
    assert.equal(segunda.nextLlamado, false);
    assert.equal(segunda.res.statusCode, 409);
  });

  it("responde 503 con Retry-After mientras la operación sigue en curso", async () => {
    const key = nuevaClave();
    const cuerpo = { nombre: "En curso" };

    const primera = await ejecutar(crearReq({ key, body: cuerpo }));
    assert.equal(primera.nextLlamado, true);
    // Deliberadamente no se responde: la operación queda pendiente.

    const segunda = await ejecutar(crearReq({ key, body: cuerpo }));
    assert.equal(segunda.nextLlamado, false);
    assert.equal(segunda.res.statusCode, 503);
    assert.equal(segunda.res.body.pending, true);
    assert.equal(segunda.res.headers["Retry-After"], "1");
  });

  it("libera la reserva cuando el controlador falla con 5xx", async () => {
    const key = nuevaClave();
    const cuerpo = { nombre: "Falla transitoria" };

    const primera = await ejecutar(crearReq({ key, body: cuerpo }));
    primera.res.status(500);
    await primera.res.json({ message: "boom" });

    const registro = await prisma.idempotencyRecord.findUnique({
      where: { operationId: key },
    });
    assert.equal(registro, null, "un 5xx no debe dejar recibo completado");

    const reintento = await ejecutar(crearReq({ key, body: cuerpo }));
    assert.equal(reintento.nextLlamado, true, "el reintento debe poder ejecutarse");
  });

  it("rechaza con 429 la segunda solicitud idéntica de un cliente mientras la primera está pendiente", async () => {
    const cuerpo = JSON.stringify({
      codigoQR: "mesa-de-prueba-idempotencia",
      productos: [{ productoId: 1, cantidad: 1 }],
    });
    const primeraClave = nuevaClave();
    const segundaClave = nuevaClave();

    const primera = await ejecutar(
      crearReq({
        key: primeraClave,
        url: "/api/pedidos",
        body: JSON.parse(cuerpo),
        authorization: undefined,
        user: null,
      }),
    );
    assert.equal(primera.nextLlamado, true);
    assert.equal(primera.errorRecibido, null, "la reserva no debe fallar");
    // La primera solicitud queda pendiente a propósito.

    const segunda = await ejecutar(
      crearReq({
        key: segundaClave,
        url: "/api/pedidos",
        body: JSON.parse(cuerpo),
        authorization: undefined,
        user: null,
      }),
    );
    assert.equal(
      segunda.nextLlamado,
      false,
      "la segunda solicitud no debe llegar al controlador",
    );
    assert.equal(segunda.res.statusCode, 429);
    assert.equal(segunda.res.body.retryAfterSeconds, 30);
  });
});