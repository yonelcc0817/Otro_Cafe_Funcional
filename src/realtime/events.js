import { emitRealtime } from "./socketServer.js";

export const emitOrderChanged = ({ id, mesaId, operationId }) => {
  const rooms = ["authenticated"];
  if (mesaId) rooms.push(`table:${mesaId}`);

  emitRealtime("orders:changed", { id, mesaId, operationId }, rooms);
  emitRealtime("statistics:changed", { operationId }, ["role:admin"]);
};

export const emitMesaChanged = (mesaId, operationId) => {
  emitRealtime("tables:changed", { mesaId, operationId }, [
    "authenticated",
    ...(mesaId ? [`table:${mesaId}`] : []),
  ]);
};

export const emitCatalogChanged = (operationId) => {
  emitRealtime("catalog:changed", { operationId }, [
    "menu:public",
    "authenticated",
  ]);
};

// Aviso de producto agotado, solo para quien repone (RF-11). Viaja el nombre,
// nunca la cantidad: al agotarse siempre es cero.
export const emitStockDepleted = ({ productoId, nombre, operationId }) => {
  emitRealtime(
    "stock:depleted",
    { productoId, nombre, operationId },
    ["role:admin", "role:trabajador"],
  );
};

export const emitTurnoChanged = (turnoId, operationId) => {
  emitRealtime("turnos:changed", { turnoId, operationId }, ["authenticated"]);
};

export const emitStaffChanged = (operationId) => {
  emitRealtime("staff:changed", { operationId }, ["role:admin"]);
  emitRealtime("statistics:changed", { operationId }, ["role:admin"]);
};

export const emitSessionRevoked = (userId) => {
  emitRealtime("session:revoked", {}, [`user:${userId}`]);
};

export const emitProfileChanged = (user, operationId) => {
  emitRealtime(
    "profile:changed",
    {
      id: user.id,
      nombre: user.nombre,
      email: user.email,
      telefono: user.telefono,
      imagen: user.imagen,
      rol: user.rol,
      operationId,
    },
    [`user:${user.id}`],
  );
};

export const emitRolesChanged = (operationId) => {
  emitRealtime("roles:changed", { operationId }, ["role:admin"]);
  emitRealtime("staff:changed", { operationId }, ["role:admin"]);
};
