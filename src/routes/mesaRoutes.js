import express from "express";
import authMiddleware from "../middlewares/authMiddleware.js";
import idempotencyMiddleware from "../middlewares/idempotencyMiddleware.js";
import mesaController from "../controllers/mesaController.js";

const {
  listarMesas,
  obtenerMesaID,
  crearMesa,
  actualizarMesa,
  eliminarMesa,
  obtenerMesaPorQR,
} = mesaController;
const router = express.Router();

router.get("/", authMiddleware(), listarMesas);
router.get("/:id", authMiddleware(), obtenerMesaID);
router.post("/", authMiddleware("admin"), idempotencyMiddleware, crearMesa);
router.patch("/:id", idempotencyMiddleware, actualizarMesa);
router.delete(
  "/:id",
  authMiddleware("admin"),
  idempotencyMiddleware,
  eliminarMesa,
);

router.get("/codigo/:codigoQR", obtenerMesaPorQR);

export default router;
