import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "./helpers/testContext.js";

// La deduplicación de pedidos de cliente (RF-12) no vive en el código: la
// garantía es el índice único parcial sobre `guestFingerprint`. Si una
// migración no se aplicó, el middleware no puede detectar el duplicado y el
// comportamiento solo falla en producción. Estas comprobaciones lo detectan.

after(async () => {
  await prisma.$disconnect();
});

describe("esquema de idempotencia", () => {
  it("la tabla IdempotencyRecord tiene la columna guestFingerprint", async () => {
    const columnas = await prisma.$queryRaw`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'IdempotencyRecord'
    `;
    const nombres = columnas.map((columna) => columna.column_name);

    assert.ok(
      nombres.includes("guestFingerprint"),
      `falta la columna guestFingerprint; columnas presentes: ${nombres.join(", ")}`,
    );
  });

  it("existe el índice único parcial que deduplica pedidos de invitado", async () => {
    const [indice] = await prisma.$queryRaw`
      SELECT indexdef
      FROM pg_indexes
      WHERE tablename = 'IdempotencyRecord'
        AND indexname = 'IdempotencyRecord_pending_guestFingerprint_key'
    `;

    assert.ok(indice, "falta el índice único parcial sobre guestFingerprint");
    assert.match(indice.indexdef, /UNIQUE/);
    assert.match(
      indice.indexdef,
      /"completedAt" IS NULL|completedAt IS NULL/,
      "el índice debe cubrir solo las operaciones todavía pendientes",
    );
  });

  it("el índice rechaza dos pedidos de invitado idénticos sin completar", async () => {
    const huella = `prueba-esquema-${Date.now()}`;
    const insertar = (operationId) => prisma.$executeRaw`
      INSERT INTO "IdempotencyRecord"
        ("operationId", "fingerprint", "guestFingerprint", "statusCode", "createdAt", "updatedAt")
      VALUES (${operationId}, ${huella}, ${huella}, 102, NOW(), NOW())
    `;

    const primero = `${huella}-a`;
    const segundo = `${huella}-b`;

    try {
      await insertar(primero);
      await assert.rejects(
        () => insertar(segundo),
        (error) => {
          assert.match(
            String(error.meta?.code ?? error.code ?? ""),
            /23505|P2002/,
            `se esperaba una violación de unicidad; recibido: ${error.code} ${JSON.stringify(error.meta)}`,
          );
          return true;
        },
        "el segundo pedido idéntico debe ser rechazado por la base de datos",
      );
    } finally {
      await prisma.idempotencyRecord.deleteMany({
        where: { operationId: { in: [primero, segundo] } },
      });
    }
  });
});
