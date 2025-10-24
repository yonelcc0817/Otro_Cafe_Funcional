/*
  Warnings:

  - The values [ABIERTO,CERRADO] on the enum `EstadoPedido` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "EstadoPedido_new" AS ENUM ('abierto', 'cerrado');
ALTER TABLE "public"."Pedido" ALTER COLUMN "estado" DROP DEFAULT;
ALTER TABLE "Pedido" ALTER COLUMN "estado" TYPE "EstadoPedido_new" USING ("estado"::text::"EstadoPedido_new");
ALTER TYPE "EstadoPedido" RENAME TO "EstadoPedido_old";
ALTER TYPE "EstadoPedido_new" RENAME TO "EstadoPedido";
DROP TYPE "public"."EstadoPedido_old";
ALTER TABLE "Pedido" ALTER COLUMN "estado" SET DEFAULT 'abierto';
COMMIT;

-- AlterTable
ALTER TABLE "Pedido" ALTER COLUMN "estado" SET DEFAULT 'abierto';
