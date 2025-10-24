import express from "express";
import authMiddleware from "../middlewares/authMiddleware.js"
import categoriaController from "../controllers/categoriaController.js";

const {listarCategorias, obtenerCategoriaId, crearCategoria, actualizarCategoria, eliminarCategoria} = categoriaController;
const router = express.Router();

router.get("/",authMiddleware(), listarCategorias);
router.get("/:id",authMiddleware(), obtenerCategoriaId);
router.post("/",authMiddleware("admin"), crearCategoria);
router.patch("/:id",authMiddleware("admin"), actualizarCategoria);
router.delete("/:id",authMiddleware("admin"), eliminarCategoria);

export default router;