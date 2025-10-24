import express from "express";
import authMiddleware from "../middlewares/authMiddleware.js";
import rolController from "../controllers/rolController.js";

const { crearRol, listarRoles, obtenerRolPorId, actualizarRol, eliminarRol } = rolController;
const router = express.Router();

router.get("/", authMiddleware("admin"), listarRoles);
router.get("/:id", authMiddleware("admin"), obtenerRolPorId);
router.post("/", authMiddleware("admin"), crearRol);
router.patch("/:id", authMiddleware("admin"), actualizarRol);
router.delete("/:id", authMiddleware("admin"), eliminarRol);

export default router;
