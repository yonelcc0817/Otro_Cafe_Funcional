import express from "express";
import productoController from "../controllers/productoController.js";
import upload from "../middlewares/multerConfig.js";
import authMiddleware from "../middlewares/authMiddleware.js";
import idempotencyMiddleware from "../middlewares/idempotencyMiddleware.js";

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
  idempotencyMiddleware,
  upload.single("imagen"),
  crearProducto,
);
router.patch(
  "/:id",
  authMiddleware("admin"),
  idempotencyMiddleware,
  upload.single("imagen"),
  actualizarProducto,
);
router.patch(
  "/:id/disponibilidad",
  authMiddleware(),
  idempotencyMiddleware,
  actualizarDisponibilidadProducto,
);
router.patch(
  "/:id/destacar",
  authMiddleware("admin"),
  idempotencyMiddleware,
  destacarProducto,
);
router.delete(
  "/:id",
  authMiddleware("admin"),
  idempotencyMiddleware,
  eliminarProducto,
);
// router.post("/productos", productoController.crearProducto);

export default router;
