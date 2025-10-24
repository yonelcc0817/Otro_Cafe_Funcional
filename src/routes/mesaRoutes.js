import express from "express";
import authMiddleware from "../middlewares/authMiddleware.js";
import mesaController from "../controllers/mesaController.js";

const { listarMesas, obtenerMesaID, crearMesa, actualizarMesa, eliminarMesa } =
  mesaController;
const router = express.Router();

router.get("/", authMiddleware(), listarMesas);
router.get("/:id", authMiddleware(), obtenerMesaID);
router.post("/", authMiddleware("admin"), crearMesa);
router.patch("/:id", authMiddleware(), actualizarMesa);
router.delete("/:id", authMiddleware("admin"), eliminarMesa);

export default router;
