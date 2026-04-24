import express from "express";
import authMiddleware from "../middlewares/authMiddleware.js";
import pedidoController from "../controllers/pedidoController.js";

const {
  crearOactualizarPedido,
  obtenerPedidoPorMesa,
  listarPedidosActivos,
  listarPedidosCompletados,
  actualizarEstado,
  modificarPedido,
  toggleItemDone,
  eliminarPedido,
  obtenerEstadisticasDiarias,
} = pedidoController;
const router = express.Router();

router.get("/activos", authMiddleware(), listarPedidosActivos);
router.get("/completados", authMiddleware(), listarPedidosCompletados);

router.post("/", crearOactualizarPedido);
router.get("/:mesaId", obtenerPedidoPorMesa);

router.patch("/estado/:id", authMiddleware(), actualizarEstado);

router.patch("/:id", authMiddleware(), modificarPedido);
router.patch("/:id/items/:index", authMiddleware(), toggleItemDone);
router.delete("/:id", authMiddleware("admin"), eliminarPedido);
router.get("/estadisticas/diarias", authMiddleware(), obtenerEstadisticasDiarias);

export default router;
