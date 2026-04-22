import express from "express";
import usuarioController from "../controllers/usuarioController.js";
import authMiddleware from "../middlewares/authMiddleware.js";
import uploadPersonal from "../middlewares/multerPersonal.js";

const {
  listarUsuarios,
  obtenerUsuarioID,
  crearUsuario,
  editarUsurario,
  actualizarPerfil,
  cambiarContraseña,
  cambiarEstadoUsuario,
  eliminarUsuario,
} = usuarioController;
const router = express.Router();

// 🔒 Solo admin puede crear, actualizar y eliminar
router.get("/", authMiddleware("admin"), listarUsuarios);
router.get("/:id", authMiddleware("admin"), obtenerUsuarioID);
router.post(
  "/",
  authMiddleware("admin"),
  uploadPersonal.single("imagen"),
  crearUsuario,
);
router.patch(
  "/:id",
  authMiddleware("admin"),
  uploadPersonal.single("imagen"),
  editarUsurario,
);
router.patch(
  "/perfil/actualizar",
  authMiddleware(),
  uploadPersonal.single("imagen"),
  actualizarPerfil,
);
router.patch("/:id/cambiar_password", authMiddleware(), cambiarContraseña);
router.patch(
  "/:id/cambiar_estado",
  authMiddleware("admin"),
  cambiarEstadoUsuario,
);
router.delete("/:id", authMiddleware("admin"), eliminarUsuario);

export default router;
