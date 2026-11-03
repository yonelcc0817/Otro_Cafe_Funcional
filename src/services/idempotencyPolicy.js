import { createHash } from "crypto";

// Reglas de idempotencia sin acceso a datos: constantes y funciones puras, para
// poder verificarlas sin base de datos. La persistencia vive en
// idempotencyService.js y las decisiones HTTP en idempotencyMiddleware.js.

// Una reserva que no se completa en este plazo se considera abandonada (por
// ejemplo, el proceso terminó entre la reserva y la respuesta) y puede volver a
// ejecutarse.
export const STALE_PENDING_MS = 60 * 1000;

// Los recibos completados solo existen para repetir una respuesta ante un
// reintento. Pasado este plazo se purgan para acotar el tamaño de la tabla.
export const COMPLETED_RETENTION_DAYS = 7;

// Espera indicada al cliente cuando repite una solicitud idéntica aún pendiente.
export const DUPLICATE_RETRY_AFTER_SECONDS = 30;

export const MAX_OPERATION_ID_LENGTH = 128;

export const isValidOperationId = (operationId) =>
  typeof operationId === "string" &&
  operationId.length > 0 &&
  operationId.length <= MAX_OPERATION_ID_LENGTH;

/**
 * Identidad de una solicitud de escritura. Dos envíos con el mismo método,
 * ruta, autor y cuerpo comparten huella; cualquier diferencia la cambia.
 */
export const fingerprintRequest = ({ method, originalUrl, userId, body }) =>
  createHash("sha256")
    .update(
      JSON.stringify({
        method,
        path: originalUrl,
        userId: userId ?? null,
        body: body || {},
      }),
    )
    .digest("hex");

/**
 * Un pedido de cliente sin autenticar: es la ruta pública por mesa y la única
 * que aplica la deduplicación por huella de invitado.
 */
export const isGuestOrderRequest = ({ method, originalUrl, authorization }) =>
  method === "POST" &&
  String(originalUrl).split("?")[0] === "/api/pedidos" &&
  !authorization;

/**
 * Una reserva está abandonada cuando nadie la completó y ya superó el plazo.
 */
export const isStalePending = (record, now = Date.now()) =>
  !record?.completedAt &&
  now - new Date(record?.createdAt).getTime() > STALE_PENDING_MS;

/**
 * Decide qué hacer con una operación ya registrada, comparando la huella
 * recibida con la almacenada.
 *
 * @returns {"conflict"|"replay"|"reclaim"|"pending"}
 */
export const resolveExistingOperation = (record, fingerprint) => {
  if (!record || record.fingerprint !== fingerprint) return "conflict";
  // `completedAt` es la marca de finalización; el cuerpo puede ser `null` de
  // forma legítima, así que no se usa para decidir si la operación terminó.
  if (record.completedAt) return "replay";
  return isStalePending(record) ? "reclaim" : "pending";
};
