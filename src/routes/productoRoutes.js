import express from "express";
import productoController from "../controllers/productoController.js";
import upload from "../middlewares/multerConfig.js";
import authMiddleware from "../middlewares/authMiddleware.js";
import multer from "multer";

const router = express.Router();

const { crearProducto, listarProductos } = productoController;

router.post(
  "/productos",
  authMiddleware(),
  (req, res, next) => {
    upload.single("imagen")(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: err.message });
      } else if (err) {
        return res.status(400).json({ error: err.message });
      }
      next();
    });
  },
  crearProducto
);

router.get("/productos", listarProductos);
// router.post("/productos", productoController.crearProducto);

export default router;
