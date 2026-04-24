import express from "express";
import productoController from "../controllers/productoController.js";
import upload from "../middlewares/multerConfig.js";
import authMiddleware from "../middlewares/authMiddleware.js";

const router = express.Router();

const {
  listarProductos,
  obtenerProductoID,
  crearProducto,
  actualizarProducto,
  actualizarDisponibilidadProducto,
  destacarProducto,
  eliminarProducto,
} = productoController;

router.get("/", listarProductos);
router.get("/:id", obtenerProductoID);
router.post(
  "/",
  authMiddleware("admin"),
  upload.single("imagen"),
  crearProducto,
);
router.patch(
  "/:id",
  authMiddleware("admin"),
  upload.single("imagen"),
  actualizarProducto,
);
router.patch(
  "/:id/disponibilidad",
  authMiddleware(),
  actualizarDisponibilidadProducto,
);
router.patch("/:id/destacar", authMiddleware("admin"), destacarProducto);
router.delete("/:id", authMiddleware("admin"), eliminarProducto);
// router.post("/productos", productoController.crearProducto);

export default router;
