// middlewares/multer.js
import multer from "multer";
import path from "path";
import fs from "fs";

const uploadPath = "uploads/productos";

// Crear carpeta de uploads con manejo de errores
try {
  if (!fs.existsSync(uploadPath)) {
    fs.mkdirSync(uploadPath, { recursive: true });
  }
} catch (err) {
  console.error("Error creando carpeta de uploads:", err);
  throw err; // abortar si no se puede crear la carpeta
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `producto-${uniqueSuffix}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif/;
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedTypes.test(ext) && file.mimetype.startsWith("image/")) {
    cb(null, true);
  } else {
    cb(new Error("Solo se permiten imágenes (jpeg, jpg, png, gif)"));
  }
};

console.log("storage definido?:", !!storage);
console.log("storage keys:", Object.keys(storage || {}));


const upload = multer({
  storage,
  fileFilter,
});

export default upload;

// // Export named (asegúrate de importar con llaves: import { upload } from ...)
// export const upload = multer({
//   storage,
//   fileFilter,
//   limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
// });

// Si prefieres default export, descomenta la siguiente línea y ajusta tu import
