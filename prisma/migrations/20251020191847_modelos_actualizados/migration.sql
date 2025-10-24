/*
  Warnings:

  - The `estado` column on the `Pedido` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the `Roles` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "EstadoPedido" AS ENUM ('ABIERTO', 'CERRADO');

-- DropForeignKey
ALTER TABLE "public"."Usuario" DROP CONSTRAINT "Usuario_rolId_fkey";

-- AlterTable
ALTER TABLE "Pedido" DROP COLUMN "estado",
ADD COLUMN     "estado" "EstadoPedido" NOT NULL DEFAULT 'ABIERTO';

-- AlterTable
ALTER TABLE "Usuario" ADD COLUMN     "activo" BOOLEAN NOT NULL DEFAULT true,
ALTER COLUMN "email" DROP NOT NULL;

-- DropTable
DROP TABLE "public"."Roles";

-- CreateTable
CREATE TABLE "Rol" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,

    CONSTRAINT "Rol_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Rol_nombre_key" ON "Rol"("nombre");

-- AddForeignKey
ALTER TABLE "Usuario" ADD CONSTRAINT "Usuario_rolId_fkey" FOREIGN KEY ("rolId") REFERENCES "Rol"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
