import jwt from "jsonwebtoken";
import prisma from "../config/database.js";

const JWT_SECRET = process.env.JWT_SECRET || "default_secret_key";
//
const normalize = (r) => (typeof r === "string" ? r.trim().toLowerCase() : r);

const authMiddleware = (requiredRoles) => {
  return async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Token no proporcionado" });
    }

    const token = authHeader.split(" ")[1];

    try {
      const decoded = jwt.verify(token, JWT_SECRET);

      const user = await prisma.usuario.findUnique({
        where: { id: decoded.userId },
        include: { rol: { select: { nombre: true } } },
      });
      if (!user) {
        return res.status(404).json({ message: "Usuario no encontrado" });
      }
      if (!user.activo) {
        return res.status(401).json({ message: "Usuario no activo hoy" });
      }

      let rolesPermitidos = null;
      if (Array.isArray(requiredRoles)) {
        rolesPermitidos = requiredRoles
          .filter((r) => typeof r === "string" && r.trim().length > 0)
          .map((r) => r.trim().toLowerCase());
        if (rolesPermitidos.length === 0) rolesPermitidos = null; // tratar array vacío como "sin restricción"
      } else if (
        typeof requiredRoles === "string" &&
        requiredRoles.trim().length > 0
      ) {
        rolesPermitidos = [requiredRoles.trim().toLowerCase()];
      } else {
        rolesPermitidos = null; // no se pasó nada -> cualquier usuario autenticado
      }

      const userRole = normalize(user.rol.nombre);

      if (rolesPermitidos && !rolesPermitidos.includes(userRole)) {
        return res.status(403).json({ message: "Acceso denegado" });
      }

      req.user = { id: user.id, nombre: user.nombre, rol: user.rol.nombre };

      next();
    } catch (error) {
      res
        .status(401)
        .json({ error: error.message, message: "Token invalido o expirado" });
    }
  };
};

export default authMiddleware;
