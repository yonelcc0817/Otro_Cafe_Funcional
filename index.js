// /* Otro_cafe_backend/index.js */
// import app from "./src/app.js";
// import express from "express";
// import path from "path";
// import fs from "fs";
// import { fileURLToPath } from "url";

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);

// const PORT = process.env.PORT || 3000;
// const distPath = path.join(__dirname, "dist");

// // 1. Verificamos si existe la carpeta dist (Modo Producción)
// if (fs.existsSync(distPath)) {
//   console.log("📦 CARPETA 'dist' DETECTADA: Sirviendo Frontend compilado.");
//   app.use(express.static(distPath));

//   // Fallback para React Router
//   app.get("/{*splat}", (req, res) => {
//     if (!req.path.startsWith("/api")) {
//       res.sendFile(path.join(distPath, "index.html"));
//     }
//   });
// } else {
//   // Si no existe dist, solo funcionará la API (Modo Desarrollo)
//   console.warn(
//     "⚠️  AVISO: Carpeta 'dist' no encontrada. El servidor solo responderá a la /api",
//   );
//   app.get("/", (req, res) =>
//     res.send("La API está lista. Pero el Frontend no está compilado."),
//   );
// }

// app.listen(PORT, "0.0.0.0", () => {
//   console.log(`🚀 SERVIDOR ESCUCHANDO EN: http://0.0.0.0:${PORT}`);
// });

// // import app from "./src/app.js";
// // import express from "express";
// // import path from "path";
// // import { fileURLToPath } from "url";

// // const __filename = fileURLToPath(import.meta.url);
// // const __dirname = path.dirname(__filename);

// // // 1. CARPETA FRONTEND COMPILADO
// // // Aquí es donde meterás la carpeta 'dist' que genere el frontend
// // const distPath = path.join(__dirname, "dist");

// // // 2. SERVIR FRONTEND
// // // Primero intentamos servir archivos estáticos si existen
// // app.use(express.static(distPath));

// // // 3. SPA FALLBACK
// // // Si un cliente pide una ruta que no es de la API (ej. /menu), le damos el index.html
// // app.get("*", (req, res) => {
// //   if (!req.path.startsWith("/api")) {
// //     // Verificamos si existe el archivo para evitar errores si no has hecho el build aún
// //     const indexPath = path.join(distPath, "index.html");
// //     res.sendFile(indexPath);
// //   }
// // });

// // // 4. ENCENDIDO PARA LA SUBRED
// // const PORT = process.env.PORT || 3000;
// // app.listen(PORT, "0.0.0.0", () => {
// //   console.log("================================================");
// //   console.log("☕ DISPOSITIVO ABIERTO Y LISTO PARA OTRO CAFÉ");
// //   console.log(`🌐 Puerto de escucha: ${PORT}`);
// //   console.log(`📢 Escuchando en toda la red (IP local de esta PC)`);
// //   console.log("================================================");
// // });

import app from "./src/app.js";
import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const distPath = path.join(__dirname, "dist");

if (fs.existsSync(distPath)) {
  console.log("📦 CARPETA 'dist' DETECTADA: Sirviendo Frontend compilado.");

  // Servir archivos estáticos DEL FRONTEND
  app.use(express.static(distPath));

  // Fallback para rutas del frontend (SPA)
  app.get("/{*splat}", (req, res) => {
    if (!req.path.startsWith("/api")) {
      res.sendFile(path.join(distPath, "index.html"));
    }
  });
} else {
  console.warn("⚠️  AVISO: Carpeta 'dist' no encontrada. Solo API.");
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 SERVIDOR ESCUCHANDO EN: http://0.0.0.0:${PORT}`);
});
