import express from "express";
import usuarioController from "../controllers/usuarioController.js";
import authMiddleware from "../middlewares/authMiddleware.js";

const {
  listarUsuarios,
  obtenerUsuarioID,
  crearUsuario,
  editarUsurario,
  cambiarContraseña,
  cambiarEstadoUsuario,
  eliminarUsuario,
} = usuarioController;
const router = express.Router();

// 🔒 Solo admin puede crear, actualizar y eliminar
router.get("/", authMiddleware("admin"), listarUsuarios);
router.get("/:id", authMiddleware("admin"), obtenerUsuarioID);
router.post("/", authMiddleware("admin"), crearUsuario);
router.patch("/:id", authMiddleware("admin"), editarUsurario);
router.patch("/:id/cambiar_password", authMiddleware(), cambiarContraseña);
router.patch(
  "/:id/cambiar_estado",
  authMiddleware("admin"),
  cambiarEstadoUsuario
);
router.delete("/:id", authMiddleware("admin"), eliminarUsuario);

export default router;
