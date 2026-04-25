import express from "express";
import authMiddleware from "../middlewares/authMiddleware.js";
import turnoController from "../controllers/turnoController.js";

const {
  getTurnosDia,
  getTurnoActual,
  getTurnoById,
  changeTurno,
  closeTurno,
} = turnoController;

const router = express.Router();

router.get("/", authMiddleware(), getTurnosDia);
router.get("/actual", authMiddleware(), getTurnoActual);
router.get("/:id", authMiddleware(), getTurnoById);
router.post("/cambiar", authMiddleware(), changeTurno);
router.post("/cerrar", authMiddleware(), closeTurno);

export default router;
