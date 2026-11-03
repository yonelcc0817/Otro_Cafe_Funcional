import { createServer } from "http";
import app from "../../src/app.js";
import prisma from "../../src/config/database.js";
import { attachSocketServer } from "../../src/realtime/socketServer.js";

export { prisma };

/**
 * Levanta la aplicación en un puerto efímero con Socket.IO adjunto,
 * replicando lo que hace `index.js` sin depender de los certificados TLS
 * ni de puertos fijos.
 */
export const startTestServer = async () => {
  const httpServer = createServer(app);
  const io = attachSocketServer(httpServer);

  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const { port } = httpServer.address();

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () => {
      await io.close();
      if (httpServer.listening) {
        await new Promise((resolve) => httpServer.close(resolve));
      }
    },
  };
};

export const PASSWORD_SEMILLA = process.env.SEED_PASSWORD || "123456";

/** Inicia sesión con email o teléfono; devuelve null si no es posible. */
export const iniciarSesion = async (baseUrl, identificador) => {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identificador, password: PASSWORD_SEMILLA }),
  });
  if (!res.ok) return null;
  return res.json();
};

/** Busca un administrador activo de la semilla para operar en las pruebas. */
export const obtenerAdminActivo = async (baseUrl) => {
  const admins = await prisma.usuario.findMany({
    where: { activo: true, rol: { nombre: { equals: "admin", mode: "insensitive" } } },
    select: { id: true, email: true, telefono: true },
    orderBy: { id: "asc" },
  });

  for (const admin of admins) {
    for (const identificador of [admin.email, admin.telefono]) {
      if (!identificador) continue;
      const sesion = await iniciarSesion(baseUrl, identificador);
      if (sesion?.token) return { ...sesion, id: sesion.user?.id ?? admin.id };
    }
  }
  return null;
};

export const limpiarRegistrosIdempotencia = async (operationIds) => {
  if (operationIds.length === 0) return;
  await prisma.idempotencyRecord.deleteMany({
    where: { operationId: { in: operationIds } },
  });
};