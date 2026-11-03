import {
  DUPLICATE_RETRY_AFTER_SECONDS,
  fingerprintRequest,
  isGuestOrderRequest,
  isValidOperationId,
  resolveExistingOperation,
} from "../services/idempotencyPolicy.js";
import {
  completeOperation,
  findOperation,
  reclaimStaleOperation,
  releaseOperation,
  reserveOperation,
} from "../services/idempotencyService.js";

// `JSON.stringify(undefined)` no es una cadena válida para `JSON.parse`, así que
// un controlador que responda sin cuerpo se normaliza a `null`.
const serializeResponse = (body) => JSON.parse(JSON.stringify(body ?? null));

const pendingResponse = (res, operationId) => {
  res.set("Retry-After", "1");
  return res.status(503).json({
    pending: true,
    operationId,
    message: "La solicitud continúa procesándose",
  });
};

const duplicateResponse = (res) => {
  res.set("Retry-After", String(DUPLICATE_RETRY_AFTER_SECONDS));
  return res.status(429).json({
    retryAfterSeconds: DUPLICATE_RETRY_AFTER_SECONDS,
    message:
      "Hay problemas con el servidor. Vuelve a intentarlo en 30 segundos.",
  });
};

const idempotencyMiddleware = async (req, res, next) => {
  const operationId = req.get("Idempotency-Key");
  if (!operationId) return next();

  if (!isValidOperationId(operationId)) {
    return res.status(400).json({ message: "Idempotency-Key inválida" });
  }

  const request = {
    method: req.method,
    originalUrl: req.originalUrl,
    userId: req.user?.id,
    body: req.body,
    authorization: req.get("Authorization"),
  };

  const fingerprint = fingerprintRequest(request);
  const isGuestOrder = isGuestOrderRequest(request);
  const guestFingerprint = isGuestOrder ? fingerprint : null;

  let reserved;
  try {
    reserved = await reserveOperation({
      operationId,
      fingerprint,
      guestFingerprint,
    });

    if (!reserved) {
      const existing = await findOperation(operationId);

      switch (resolveExistingOperation(existing, fingerprint)) {
        case "conflict":
          return res.status(409).json({
            message: "Idempotency-Key ya fue utilizada para otra solicitud",
          });

        case "replay":
          return res
            .status(existing.statusCode)
            .json(existing.response === undefined ? null : existing.response);

        case "reclaim": {
          // La reserva quedó sin completar y ya superó el plazo de abandono: se
          // libera y se reintenta, para que un reinicio del proceso no deje la
          // operación bloqueada indefinidamente.
          const reclaimed = await reclaimStaleOperation(existing);
          if (reclaimed) {
            reserved = await reserveOperation({
              operationId,
              fingerprint,
              guestFingerprint,
            });
          }
          break;
        }

        default:
          break;
      }

      if (!reserved) return pendingResponse(res, operationId);
    }
  } catch (error) {
    // El índice único parcial sobre `guestFingerprint` rechaza una segunda
    // solicitud idéntica de cliente mientras la primera sigue pendiente.
    if (isGuestOrder && error.meta?.code === "23505") {
      return duplicateResponse(res);
    }
    return next(error);
  }

  req.idempotencyKey = operationId;
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    const responseBody = serializeResponse(body);
    const persistResponse =
      res.statusCode < 500
        ? completeOperation(operationId, res.statusCode, responseBody)
        : releaseOperation(operationId);

    return persistResponse
      .then(() => originalJson(body))
      .catch((error) => {
        console.error("Error al persistir recibo de idempotencia:", error);
        if (!res.headersSent) {
          return pendingResponse(res, operationId);
        }
        return originalJson(body);
      });
  };

  return next();
};

export default idempotencyMiddleware;
