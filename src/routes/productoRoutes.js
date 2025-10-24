import express from "express";
import productoController from "../controllers/productoController.js";

const router = express.Router();

router.get("/productos", productoController.listarProductos);
router.post("/productos", productoController.crearProducto);

export default router;
