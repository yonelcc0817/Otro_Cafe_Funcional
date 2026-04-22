import prisma from "../config/database.js";
import { handlePrismaError } from "../utils/handlePrismaError.js";
import bcrypt from "bcrypt";
import { validatePassword } from "../utils/validatePassword.js";
import { validateRol } from "../utils/validateRol.js";
import fs from "fs/promises";
import path from "path";

const listarUsuarios = async (req, res) => {
  try {
    const usuarios = await prisma.usuario.findMany({
      select: {
        id: true,
        nombre: true,
        email: true,
        telefono: true,
        activo: true,
        rol: { select: { id: true, nombre: true } },
        imagen: true,
      },
      orderBy: { nombre: "asc" },
    });

    if (usuarios.length === 0) {
      return res.status(404).json({ message: "No se encontraron usuarios" });
    }

    res.status(200).json({ data: usuarios });
  } catch (error) {
    handlePrismaError(error, res, "Ocurrio un error al buscar los usuarios");
  }
};

const obtenerUsuarioID = async (req, res) => {
  try {
    const { id } = req.params;

    const usuario = await prisma.usuario.findUnique({
      where: { id: Number(id) },
      select: {
        id: true,
        nombre: true,
        telefono: true,
        email: true,
        rol: { select: { id: true, nombre: true } },
        imagen: true,
      },
    });

    if (!usuario) {
      return res
        .status(404)
        .json({ message: "No existe nigun usuario asociado a ese id" });
    }

    return res.status(200).json({ data: usuario });
  } catch (error) {
    handlePrismaError(error, res, "Ocurrio un error al obtener el usuario");
  }
};

const crearUsuario = async (req, res) => {
  try {
    const { nombre, email, password, rol, telefono } = req.body;

    if (!nombre || !password) {
      if (req.file) await fs.unlink(req.file.path).catch(() => {});
      return res
        .status(400)
        .json({ message: "Los campos nombre y contraseña son obligatorios" });
    }

    const { valid, message } = validatePassword(password);
    if (!valid) {
      return res.status(400).json({ message });
    }

    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          message:
            "Por favor proporcione una cuenta de correo electrónico válida",
        });
      }

      const usuarioExistente = await prisma.usuario.findUnique({
        where: { email },
      });

      if (usuarioExistente) {
        return res.status(400).json({
          message: "Ya existe un usuario con este correo electrónico",
        });
      }
    }

    const passwordHash = await bcrypt.hash(password, 10);

    // Buscar rol
    let rolValido;
    if (rol) {
      rolValido = await validateRol(rol);
    } else {
      rolValido = await validateRol("trabajador");
    }

    const nuevoUsuario = await prisma.usuario.create({
      data: {
        nombre,
        email: email || null,
        telefono: telefono || null,
        passwordHash,
        rol: { connect: { id: Number(rolValido.id) } },
        imagen: req.file ? req.file.filename : null, // GUARDAR IMAGEN
      },
      select: {
        id: true,
        nombre: true,
        email: true,
        telefono: true,
        rol: { select: { id: true, nombre: true } },
        imagen: true,
      },
    });

    return res.status(200).json({
      message: `Usuario ${nuevoUsuario.nombre} creado`,
      data: nuevoUsuario,
    });
  } catch (error) {
    if (req.file) await fs.unlink(req.file.path).catch(() => {});
    handlePrismaError(error, res, "Hubo un error al crear el usuario");
  }
};

const editarUsurario = async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, email, password, rol, telefono, eliminarImagen } = req.body;

    const usuarioExistente = await prisma.usuario.findUnique({
      where: { id: Number(id) },
    });
    if (!usuarioExistente) {
      if (req.file) await fs.unlink(req.file.path).catch(() => {});
      return res.status(404).json({ message: "No existe el usuario" });
    }

    const data = {};
    if (nombre) data.nombre = nombre;
    if (req.body.hasOwnProperty("email")) data.email = email || null;
    if (req.body.hasOwnProperty("telefono")) data.telefono = telefono || null;

    if (rol) {
      const rolValido = await validateRol(rol);
      data.rol = { connect: { id: Number(rolValido.id) } };
    }

    if (password) {
      data.passwordHash = await bcrypt.hash(password, 10);
    }

    // MANEJO DE IMAGEN (Igual que en productos)
    if (req.file) {
      if (usuarioExistente.imagen) {
        const rutaVieja = path.resolve(
          "uploads/personal",
          usuarioExistente.imagen,
        );
        await fs.unlink(rutaVieja).catch(() => {});
      }
      data.imagen = req.file.filename;
    } else if (eliminarImagen === "true") {
      if (usuarioExistente.imagen) {
        const rutaVieja = path.resolve(
          "uploads/personal",
          usuarioExistente.imagen,
        );
        await fs.unlink(rutaVieja).catch(() => {});
      }
      data.imagen = null;
    }

    const usuarioActualizado = await prisma.usuario.update({
      where: { id: Number(id) },
      data,
      select: {
        id: true,
        nombre: true,
        email: true,
        telefono: true,
        imagen: true,
        rol: { select: { id: true, nombre: true } },
      },
    });

    return res
      .status(200)
      .json({ message: "Usuario actualizado", data: usuarioActualizado });
  } catch (error) {
    if (req.file) await fs.unlink(req.file.path).catch(() => {});
    handlePrismaError(error, res, "Error al editar el usuario");
  }
};

const actualizarPerfil = async (req, res) => {
  try {
    const id = req.user.id; // Obtenemos el ID del token de sesión (authMiddleware)
    const { nombre, email, telefono, password } = req.body;

    const usuarioExistente = await prisma.usuario.findUnique({ where: { id } });

    const data = {};
    if (nombre) data.nombre = nombre;
    if (email) data.email = email;
    if (telefono) data.telefono = telefono;

    if (password) {
      const { valid, message } = validatePassword(password);
      if (!valid) return res.status(400).json({ message });
      data.passwordHash = await bcrypt.hash(password, 10);
    }

    if (req.file) {
      if (usuarioExistente.imagen) {
        const rutaVieja = path.resolve(
          "uploads/personal",
          usuarioExistente.imagen,
        );
        await fs.unlink(rutaVieja).catch(() => {});
      }
      data.imagen = req.file.filename;
    }

    const perfilActualizado = await prisma.usuario.update({
      where: { id },
      data,
      select: {
        id: true,
        nombre: true,
        email: true,
        telefono: true,
        imagen: true,
        rol: { select: { id: true, nombre: true } },
      },
    });

    res.status(200).json({
      message: "Perfil actualizado correctamente",
      data: perfilActualizado,
    });
  } catch (error) {
    if (req.file) await fs.unlink(req.file.path).catch(() => {});
    handlePrismaError(error, res, "Error al actualizar perfil");
  }
};

const cambiarContraseña = async (req, res) => {
  try {
    const { id } = req.params;
    const { password, newPassword } = req.body;
    if (!newPassword) {
      return res.status(400).json({
        message: "El campo nueva contraseña es obligatorio",
      });
    }
    const usuario = await prisma.usuario.findUnique({
      where: { id: Number(id) },
      select: { passwordHash: true },
    });

    if (!usuario) {
      return res
        .status(404)
        .json({ message: "No existe ningun usuario asociado a ese id" });
    }

    const isAdmin = req.user?.rol?.toLowerCase() === "admin";

    if (!isAdmin) {
      if (req.user.id !== Number(id)) {
        return res
          .status(403)
          .json({ message: "No tienes permiso para cambiar esta contraseña" });
      }

      if (!password && !isAdmin) {
        return res
          .status(400)
          .json({ message: "Debes proporcionar tu contraseña actual " });
      }

      const passwordMatch = await bcrypt.compare(
        password,
        usuario.passwordHash,
      );
      if (!passwordMatch) {
        return res.status(401).json({ message: "Contraseña incorrecta" });
      }
    }

    const { valid, message } = validatePassword(newPassword);
    if (!valid) {
      return res.status(400).json({ message });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    const usuarioActualizado = await prisma.usuario.update({
      where: { id: Number(id) },
      data: {
        passwordHash: passwordHash,
      },
      select: { id: true, nombre: true },
    });

    return res.status(200).json({
      message: "La contraseña ha sido cambiada correctamente",
      data: { id: usuarioActualizado.id, nombre: usuarioActualizado.nombre },
    });
  } catch (error) {
    handlePrismaError(error, res, "Hubo un error al cambiar la contraseña");
  }
};

const cambiarEstadoUsuario = async (req, res) => {
  try {
    const { id } = req.params;

    const usuario = await prisma.usuario.findUnique({
      where: { id: Number(id) },
      select: { activo: true },
    });

    if (!usuario) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    const usuarioActualizado = await prisma.usuario.update({
      where: { id: Number(id) },
      data: { activo: !usuario.activo },
    });

    return res.status(200).json({
      message: "El estado ha sido cambiado satisfactoriamente",
      data: usuarioActualizado,
    });
  } catch (error) {
    handlePrismaError(
      error,
      res,
      "Hubo un error al cambiar el estado del usuario",
    );
  }
};

const eliminarUsuario = async (req, res) => {
  try {
    const { id } = req.params;

    const usuario = await prisma.usuario.findUnique({
      where: { id: Number(id) },
    });
    if (!usuario) {
      return res
        .status(404)
        .json({ message: "No existe nigun usuario asociado a ese id" });
    }

    await prisma.usuario.delete({
      where: { id: Number(id) },
    });

    return res.status(200).json({
      message: `El usuario ${usuario.nombre} ha sido eliminado correctamente`,
    });
  } catch (error) {
    handlePrismaError(error, res, "Hubo un error al eliminar el usuario");
  }
};

export default {
  listarUsuarios,
  obtenerUsuarioID,
  crearUsuario,
  editarUsurario,
  actualizarPerfil,
  cambiarContraseña,
  cambiarEstadoUsuario,
  eliminarUsuario,
};
