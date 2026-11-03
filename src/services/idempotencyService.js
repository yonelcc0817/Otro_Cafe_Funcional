import prisma from "../config/database.js";
import { COMPLETED_RETENTION_DAYS } from "./idempotencyPolicy.js";

// Acceso a datos del registro de idempotencia. Las reglas (plazos, huellas y
// clasificación de una operación existente) viven en idempotencyPolicy.js.

export const reserveOperation = async ({
  operationId,
  fingerprint,
  guestFingerprint,
}) => {
  const reserved = await prisma.$queryRaw`
    INSERT INTO "IdempotencyRecord"
      ("operationId", "fingerprint", "guestFingerprint", "statusCode", "createdAt", "updatedAt")
    VALUES (
      ${operationId},
      ${fingerprint},
      ${guestFingerprint},
      102,
      NOW(),
      NOW()
    )
    ON CONFLICT ("operationId") DO NOTHING
    RETURNING "operationId"
  `;

  return reserved.length > 0;
};

export const findOperation = async (operationId) => {
  const [record] = await prisma.$queryRaw`
    SELECT "operationId", "fingerprint", "statusCode", "response", "completedAt", "createdAt"
    FROM "IdempotencyRecord"
    WHERE "operationId" = ${operationId}
    LIMIT 1
  `;

  return record;
};

// Borrado compare-and-delete: solo libera la reserva si nadie la completó
// mientras tanto, para no descartar una respuesta válida en carrera.
export const reclaimStaleOperation = async (record) => {
  const deleted = await prisma.$executeRaw`
    DELETE FROM "IdempotencyRecord"
    WHERE "operationId" = ${record.operationId}
      AND "completedAt" IS NULL
      AND "createdAt" = ${record.createdAt}
  `;

  return deleted === 1;
};

export const completeOperation = async (operationId, statusCode, response) => {
  await prisma.$executeRaw`
    UPDATE "IdempotencyRecord"
    SET "statusCode" = ${statusCode},
        "response" = ${JSON.stringify(response)}::jsonb,
        "completedAt" = NOW(),
        "updatedAt" = NOW()
    WHERE "operationId" = ${operationId}
  `;
};

// Un 5xx no se persiste como recibo: la operación pudo no haberse aplicado y el
// cliente debe poder reintentarla.
export const releaseOperation = async (operationId) => {
  await prisma.$executeRaw`
    DELETE FROM "IdempotencyRecord"
    WHERE "operationId" = ${operationId} AND "completedAt" IS NULL
  `;
};

export const purgeExpiredOperations = async () => {
  const deleted = await prisma.$executeRaw`
    DELETE FROM "IdempotencyRecord"
    WHERE "completedAt" IS NOT NULL
      AND "completedAt" < NOW() - (${COMPLETED_RETENTION_DAYS}::int * INTERVAL '1 day')
  `;

  return Number(deleted);
};
