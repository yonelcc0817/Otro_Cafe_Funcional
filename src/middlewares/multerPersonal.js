import multer from "multer";
import path from "path";
import fs from "fs";

// Carpeta específica para el personal
const uploadPath = "uploads/personal";

// Asegurar que la carpeta existe al arrancar el servidor
try {
  if (!fs.existsSync(uploadPath)) {
    fs.mkdirSync(uploadPath, { recursive: true });
  }
} catch (err) {
  console.error("Error creando carpeta de uploads personal:", err);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    // Generar nombre: staff-162837465-9823.png
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `personal-${uniqueSuffix}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif/;
  const ext = path.extname(file.originalname).toLowerCase();

  // Validamos que sea una imagen real
  if (allowedTypes.test(ext) && file.mimetype.startsWith("image/")) {
    cb(null, true);
  } else {
    cb(new Error("Solo se permiten imágenes (jpeg, jpg, png, gif)"));
  }
};

const uploadPersonal = multer({
  storage,
  fileFilter,
  //   limits: { fileSize: 2 * 1024 * 1024 }, // Límite opcional de 2MB para fotos de perfil
});

export default uploadPersonal;
