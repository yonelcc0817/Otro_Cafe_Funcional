import prisma from "../config/database.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { handlePrismaError } from "../utils/handlePrismaError.js";

const JWT_SECRET = process.env.JWT_SECRET || "default_secret_key";

const JWT_EXPIRES_IN = "8h";

// const AuthController = {
const login = async (req, res) => {
  try {
    const { identificador, password } = req.body;

    if (!identificador || !password) {
      return res
        .status(400)
        .json({ message: "Email o teléfono y contraseña son obligatorios" });
    }

    let user;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (emailRegex.test(identificador)) {
      user = await prisma.usuario.findFirst({
        where: { email: identificador },
        include: { rol: { select: { nombre: true } } },
      });
    } else {
      user = await prisma.usuario.findFirst({
        where: { telefono: identificador },
        include: { rol: { select: { nombre: true } } },
      });
    }

    if (!user) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    if (!user.activo) {
      return res.status(401).json({ message: "Usuario no activo hoy" });
    }

    const passwordMatch = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatch) {
      return res.status(401).json({ message: "Contraseña incorrecta" });
    }

    const token = jwt.sign(
      {
        userId: user.id,
        nombre: user.nombre,
        rol: user.rol?.nombre || "sin rol",
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN },
    );

    // RESPUESTA ACTUALIZADA CON TODOS LOS DATOS
    return res.status(200).json({
      message: "Inicio de sesión exitoso",
      token,
      user: {
        id: user.id,
        nombre: user.nombre,
        email: user.email, // <-- IMPORTANTE: Agregar esto
        telefono: user.telefono, // <-- IMPORTANTE: Agregar esto
        imagen: user.imagen, // <-- IMPORTANTE: Agregar esto
        rol: user.rol?.nombre || "sin rol",
      },
    });
  } catch (error) {
    handlePrismaError(error, res, "Ha ocurrido un error al inicar sesión");
  }
};

const logout = async (req, res) => {
  try {
    const usuario = await prisma.usuario.findUnique({
      where: { id: req.user.id },
      include: { rol: { select: { nombre: true } } },
    });

    if (!usuario) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    if (usuario.rol.nombre !== "admin") {
      await prisma.usuario.update({
        where: { id: req.user.id },
        data: { activo: false },
      });
      return res
        .status(200)
        .json({ message: "Cierre de sesión exitoso, turno finalizado" });
    }

    return res.status(200).json({ message: "Cierre de sesión exitoso" });
  } catch (error) {
    handlePrismaError(error, res, "Ha ocurrido un error al cerrar sesión");
  }
};
// };

export default {
  login,
  logout,
};
