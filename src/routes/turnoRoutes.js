import express from "express";
import authMiddleware from "../middlewares/authMiddleware.js";
import idempotencyMiddleware from "../middlewares/idempotencyMiddleware.js";
import turnoController from "../controllers/turnoController.js";

const { getTurnosDia, getTurnoActual, getTurnoById, changeTurno, closeTurno } =
  turnoController;

const router = express.Router();

router.get("/", authMiddleware(), getTurnosDia);
router.get("/actual", authMiddleware(), getTurnoActual);
router.get("/:id", authMiddleware(), getTurnoById);
router.post("/cambiar", authMiddleware(), idempotencyMiddleware, changeTurno);
router.post("/cerrar", authMiddleware(), idempotencyMiddleware, closeTurno);

export default router;
