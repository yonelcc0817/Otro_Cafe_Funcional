import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_OPERATION_ID_LENGTH,
  STALE_PENDING_MS,
  fingerprintRequest,
  isGuestOrderRequest,
  isStalePending,
  isValidOperationId,
  resolveExistingOperation,
} from "../src/services/idempotencyPolicy.js";

const baseRequest = {
  method: "POST",
  originalUrl: "/api/pedidos",
  userId: 7,
  body: { codigoQR: "abc", productos: [{ productoId: 1, cantidad: 2 }] },
  authorization: "Bearer token",
};

test("isValidOperationId acepta claves dentro del límite y rechaza el resto", () => {
  assert.equal(isValidOperationId("op-1"), true);
  assert.equal(isValidOperationId("a".repeat(MAX_OPERATION_ID_LENGTH)), true);

  assert.equal(isValidOperationId("a".repeat(MAX_OPERATION_ID_LENGTH + 1)), false);
  assert.equal(isValidOperationId(""), false);
  assert.equal(isValidOperationId(undefined), false);
  assert.equal(isValidOperationId(12345), false);
});

test("fingerprintRequest es determinista para la misma solicitud", () => {
  assert.equal(fingerprintRequest(baseRequest), fingerprintRequest({ ...baseRequest }));
});

test("fingerprintRequest cambia ante cualquier diferencia relevante", () => {
  const original = fingerprintRequest(baseRequest);

  const variants = {
    "otro cuerpo": { ...baseRequest, body: { ...baseRequest.body, codigoQR: "otro" } },
    "otro método": { ...baseRequest, method: "PATCH" },
    "otra ruta": { ...baseRequest, originalUrl: "/api/mesas" },
    "otro autor": { ...baseRequest, userId: 8 },
    "sin autor": { ...baseRequest, userId: undefined },
  };

  for (const [label, request] of Object.entries(variants)) {
    assert.notEqual(fingerprintRequest(request), original, `debe cambiar con ${label}`);
  }
});

test("fingerprintRequest no distingue el token, solo el autor", () => {
  const otroToken = { ...baseRequest, authorization: "Bearer distinto" };
  assert.equal(fingerprintRequest(otroToken), fingerprintRequest(baseRequest));
});

test("isGuestOrderRequest solo marca el pedido público por mesa", () => {
  const guest = { ...baseRequest, authorization: undefined };

  assert.equal(isGuestOrderRequest(guest), true);
  assert.equal(isGuestOrderRequest({ ...guest, originalUrl: "/api/pedidos?x=1" }), true);

  assert.equal(isGuestOrderRequest(baseRequest), false, "con token no es invitado");
  assert.equal(isGuestOrderRequest({ ...guest, method: "GET" }), false);
  assert.equal(isGuestOrderRequest({ ...guest, originalUrl: "/api/mesas" }), false);
});

test("isStalePending solo marca reservas sin completar y fuera de plazo", () => {
  const now = Date.now();
  const antigua = new Date(now - STALE_PENDING_MS - 1).toISOString();
  const reciente = new Date(now - STALE_PENDING_MS + 5000).toISOString();
  const limite = new Date(now - STALE_PENDING_MS).toISOString();

  assert.equal(isStalePending({ completedAt: null, createdAt: antigua }, now), true);
  assert.equal(isStalePending({ completedAt: null, createdAt: reciente }, now), false);
  assert.equal(isStalePending({ completedAt: null, createdAt: limite }, now), false);
  assert.equal(
    isStalePending({ completedAt: new Date().toISOString(), createdAt: antigua }, now),
    false,
    "una operación completada nunca es reclamable",
  );
  assert.equal(isStalePending(null, now), false);
  assert.equal(isStalePending(undefined, now), false);
});

test("resolveExistingOperation clasifica cada caso", () => {
  const now = Date.now();
  const fingerprint = fingerprintRequest(baseRequest);
  const antigua = new Date(now - STALE_PENDING_MS - 1).toISOString();

  assert.equal(
    resolveExistingOperation(null, fingerprint),
    "conflict",
    "sin registro no se puede reutilizar la clave",
  );

  assert.equal(
    resolveExistingOperation(
      { fingerprint: "otra", completedAt: null, createdAt: antigua },
      fingerprint,
    ),
    "conflict",
    "misma clave con cuerpo distinto",
  );

  assert.equal(
    resolveExistingOperation(
      { fingerprint, completedAt: new Date().toISOString(), response: { ok: true } },
      fingerprint,
    ),
    "replay",
  );

  assert.equal(
    resolveExistingOperation(
      { fingerprint, completedAt: null, createdAt: antigua },
      fingerprint,
    ),
    "reclaim",
    "una reserva abandonada se libera en lugar de bloquear para siempre",
  );

  assert.equal(
    resolveExistingOperation(
      { fingerprint, completedAt: null, createdAt: new Date(now).toISOString() },
      fingerprint,
    ),
    "pending",
  );
});

test("un recibo completado sin cuerpo se reproduce en lugar de quedar pendiente", () => {
  const fingerprint = fingerprintRequest(baseRequest);

  assert.equal(
    resolveExistingOperation({ fingerprint, completedAt: new Date().toISOString() }, fingerprint),
    "replay",
    "una respuesta sin cuerpo es válida; completar lo marca `completedAt`",
  );
});
