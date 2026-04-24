// import express from "express";
// import cors from "cors";
// import dotenv from "dotenv";
// import { PrismaClient } from "@prisma/client";
// import authRoutes from "./routes/authRoutes.js";
// import rolRoutes from "./routes/rolRoutes.js";
// import usuarioRoutes from "./routes/usuarioRoutes.js";
// import mesaRoutes from "./routes/mesaRoutes.js";
// import pedidoRoutes from "./routes/pedidoRoutes.js";
// import productoRoutes from "./routes/productoRoutes.js";
// import categoriaRoutes from "./routes/categoriaRoutes.js";

// // import upload from "./middlewares/multerConfig.js";

// dotenv.config();

// const app = express();
// const prisma = new PrismaClient();

// app.use(express.json());
// app.use(express.urlencoded({ extended: true }));
// app.use(cors());
// app.set("json replacer", (_, value) =>
//   typeof value === "bigint" ? value.toString() : value,
// );
// app.use("/uploads", express.static("uploads"));

// // app.get("/", (req, res) => {
// //   res.send("¡Bienvenido a la API de Otro Café!");
// // });

// app.use("/api/auth", authRoutes);

// // Rutas principales
// app.use("/api/roles", rolRoutes);
// app.use("/api/usuarios", usuarioRoutes);
// app.use("/api/mesas", mesaRoutes);
// app.use("/api/pedidos", pedidoRoutes);
// app.use("/api/categorias", categoriaRoutes);
// app.use("/api/productos", productoRoutes);

// export default app;

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import authRoutes from "./routes/authRoutes.js";
import rolRoutes from "./routes/rolRoutes.js";
import usuarioRoutes from "./routes/usuarioRoutes.js";
import mesaRoutes from "./routes/mesaRoutes.js";
import pedidoRoutes from "./routes/pedidoRoutes.js";
import productoRoutes from "./routes/productoRoutes.js";
import categoriaRoutes from "./routes/categoriaRoutes.js";

dotenv.config();

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static("uploads"));
app.use(cors());

app.use("/api/auth", authRoutes);
app.use("/api/roles", rolRoutes);
app.use("/api/usuarios", usuarioRoutes);
app.use("/api/mesas", mesaRoutes);
app.use("/api/pedidos", pedidoRoutes);
app.use("/api/categorias", categoriaRoutes);
app.use("/api/productos", productoRoutes);

export default app;
