import jwt from "jsonwebtoken";
import { Server } from "socket.io";
import prisma from "../config/database.js";

const JWT_SECRET = process.env.JWT_SECRET || "default_secret_key";
const servers = new Set();

const normalizeRole = (role) => role?.trim().toLowerCase();

const authenticateSocket = async (socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) {
    socket.data.user = null;
    return next();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await prisma.usuario.findUnique({
      where: { id: decoded.userId },
      include: { rol: { select: { nombre: true } } },
    });

    if (!user || !user.activo) {
      return next(new Error("unauthorized"));
    }

    socket.data.user = {
      id: user.id,
      role: normalizeRole(user.rol.nombre),
    };
    return next();
  } catch {
    return next(new Error("unauthorized"));
  }
};

export const attachSocketServer = (httpServer) => {
  const io = new Server(httpServer, {
    cors: {
      origin: true,
      methods: ["GET", "POST"],
    },
  });

  io.use(authenticateSocket);

  io.on("connection", (socket) => {
    socket.join("menu:public");

    if (socket.data.user) {
      socket.join("authenticated");
      socket.join(`role:${socket.data.user.role}`);
      socket.join(`user:${socket.data.user.id}`);
    }

    socket.on("table:subscribe", async (codigoQR, acknowledge) => {
      if (typeof codigoQR !== "string" || codigoQR.length === 0) {
        acknowledge?.({ ok: false });
        return;
      }

      try {
        const table = await prisma.mesa.findUnique({
          where: { codigoQR },
          select: { id: true },
        });

        if (!table) {
          acknowledge?.({ ok: false });
          return;
        }

        if (socket.data.tableRoom) {
          await socket.leave(socket.data.tableRoom);
        }

        socket.data.tableRoom = `table:${table.id}`;
        await socket.join(`table:${table.id}`);
        acknowledge?.({ ok: true });
      } catch {
        acknowledge?.({ ok: false });
      }
    });
  });

  servers.add(io);
  io.on("close", () => servers.delete(io));
  return io;
};

export const emitRealtime = (event, payload, rooms = []) => {
  for (const io of servers) {
    const target = rooms.length > 0 ? io.to(rooms) : io;
    target.emit(event, payload);
  }
};
