import express from "express";
import productoController from "../controllers/productoController.js";
import upload from "../middlewares/multerConfig.js";
import authMiddleware from "../middlewares/authMiddleware.js";
import idempotencyMiddleware from "../middlewares/idempotencyMiddleware.js";

const router = express.Router();

const {
  listarProductos,
  listarProductosGestion,
  obtenerProductoID,
  crearProducto,
  actualizarProducto,
  actualizarDisponibilidadProducto,
  actualizarEstadoProducto,
  actualizarStock,
  quitarStock,
  destacarProducto,
  eliminarProducto,
} = productoController;

router.get("/", listarProductos);
// Debe ir antes de "/:id" para que no lo capture la ruta por id.
router.get(
  "/gestion",
  authMiddleware(["admin", "trabajador"]),
  listarProductosGestion,
);
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
// Selector único de estado: disponible | baja | agotado.
router.patch(
  "/:id/estado",
  authMiddleware(["admin", "trabajador"]),
  idempotencyMiddleware,
  actualizarEstadoProducto,
);
router.patch(
  "/:id/stock",
  authMiddleware(["admin", "trabajador"]),
  idempotencyMiddleware,
  actualizarStock,
);
router.delete(
  "/:id/stock",
  authMiddleware(["admin", "trabajador"]),
  idempotencyMiddleware,
  quitarStock,
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
