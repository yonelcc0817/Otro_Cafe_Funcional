import express from "express";
import authMiddleware from "../middlewares/authMiddleware.js";
import idempotencyMiddleware from "../middlewares/idempotencyMiddleware.js";
import pedidoController from "../controllers/pedidoController.js";

const {
  crearOactualizarPedido,
  obtenerPedidoPorMesa,
  obtenerPedidoPorQR,
  listarPedidosActivos,
  listarPedidosCompletados,
  actualizarEstado,
  modificarPedido,
  toggleItemDone,
  toggleItemDelivered,
  eliminarPedido,
  obtenerEstadisticasDiarias,
  obtenerEstadisticasMensuales,
} = pedidoController;
const router = express.Router();

router.get("/activos", authMiddleware(), listarPedidosActivos);
router.get("/completados", authMiddleware(), listarPedidosCompletados);

router.post("/", idempotencyMiddleware, crearOactualizarPedido);
router.get("/qr/:codigoQR", obtenerPedidoPorQR);
router.get("/:mesaId", obtenerPedidoPorMesa);

router.patch(
  "/estado/:id",
  authMiddleware(),
  idempotencyMiddleware,
  actualizarEstado,
);

router.patch("/:id", authMiddleware(), idempotencyMiddleware, modificarPedido);
// Nuevas rutas para marcar "done" y "delivered" por ítem
router.patch(
  "/:id/items/:index/done",
  authMiddleware(),
  idempotencyMiddleware,
  toggleItemDone,
);
router.patch(
  "/:id/items/:index/delivered",
  authMiddleware(),
  idempotencyMiddleware,
  toggleItemDelivered,
);
// Ruta legacy (alias) para compatibilidad
router.patch(
  "/:id/items/:index",
  authMiddleware(),
  idempotencyMiddleware,
  toggleItemDone,
);
router.delete(
  "/:id",
  authMiddleware("admin"),
  idempotencyMiddleware,
  eliminarPedido,
);
router.get(
  "/estadisticas/diarias",
  authMiddleware(),
  obtenerEstadisticasDiarias,
);
router.get(
  "/estadisticas/mensuales",
  authMiddleware(),
  obtenerEstadisticasMensuales,
);

export default router;
