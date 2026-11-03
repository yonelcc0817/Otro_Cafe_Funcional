import express from "express";
import authMiddleware from "../middlewares/authMiddleware.js";
import idempotencyMiddleware from "../middlewares/idempotencyMiddleware.js";
import rolController from "../controllers/rolController.js";

const { crearRol, listarRoles, obtenerRolPorId, actualizarRol, eliminarRol } =
  rolController;
const router = express.Router();

router.get("/", authMiddleware("admin"), listarRoles);
router.get("/:id", authMiddleware("admin"), obtenerRolPorId);
router.post("/", authMiddleware("admin"), idempotencyMiddleware, crearRol);
router.patch(
  "/:id",
  authMiddleware("admin"),
  idempotencyMiddleware,
  actualizarRol,
);
router.delete(
  "/:id",
  authMiddleware("admin"),
  idempotencyMiddleware,
  eliminarRol,
);

export default router;
