import express from "express";
import productoController from "../controllers/productoController.js";
import upload from "../middlewares/multerConfig.js";
import authMiddleware from "../middlewares/authMiddleware.js";
import multer from "multer";

const router = express.Router();

const { crearProducto, listarProductos } = productoController;

router.post("/productos",  authMiddleware(),upload.single("imagen"),crearProducto);

router.get("/productos", listarProductos);
// router.post("/productos", productoController.crearProducto);

export default router;
