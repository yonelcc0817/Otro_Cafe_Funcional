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
    console.error("Error en listarUsuarios:", error);
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
    console.error("Error en obtenerUsuarioID:", error);
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
      if (req.file) await fs.unlink(req.file.path).catch(() => {});
      return res.status(400).json({ message });
    }

    if (email && email !== "" && email !== "null") {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        if (req.file) await fs.unlink(req.file.path).catch(() => {});
        return res.status(400).json({ message: "Email inválido" });
      }

      const usuarioExistente = await prisma.usuario.findUnique({
        where: { email },
      });
      if (usuarioExistente) {
        if (req.file) await fs.unlink(req.file.path).catch(() => {});
        return res.status(400).json({ message: "El email ya está en uso" });
      }
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const rolValido = await validateRol(rol || "trabajador");

    const nuevoUsuario = await prisma.usuario.create({
      data: {
        nombre,
        email: email === "" || email === "null" ? null : email,
        telefono: telefono === "" || telefono === "null" ? null : telefono,
        passwordHash,
        rol: { connect: { id: Number(rolValido.id) } },
        imagen: req.file ? req.file.filename : null,
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

    return res.status(201).json({
      message: `Usuario ${nuevoUsuario.nombre} creado correctamente`,
      data: nuevoUsuario,
    });
  } catch (error) {
    if (req.file) await fs.unlink(req.file.path).catch(() => {});
    console.error("Error en crearUsuario:", error);
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
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    const data = {};
    if (nombre) data.nombre = nombre;

    // CORRECCIÓN: Usar 'in' en lugar de 'hasOwnProperty' para evitar el TypeError
    if ("email" in req.body) {
      data.email = email === "" || email === "null" ? null : email;
    }
    if ("telefono" in req.body) {
      data.telefono = telefono === "" || telefono === "null" ? null : telefono;
    }

    if (rol) {
      const rolEncontrado = await validateRol(rol);
      data.rol = { connect: { id: Number(rolEncontrado.id) } };
    }

    if (password && password !== "") {
      data.passwordHash = await bcrypt.hash(password, 10);
    }

    // MANEJO DE IMAGEN
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

    return res.status(200).json({
      message: "Usuario actualizado exitosamente",
      data: usuarioActualizado,
    });
  } catch (error) {
    if (req.file) await fs.unlink(req.file.path).catch(() => {});
    console.error("ERROR CRÍTICO EN EDITAR USUARIO:", error);
    return res.status(500).json({
      message: "Error interno al editar usuario",
      error: error.message,
    });
  }
};

// Localiza la función actualizarPerfil en usuarioController.js y sustitúyela:

// Sustituye tu función actualizarPerfil por esta:

const actualizarPerfil = async (req, res) => {
  try {
    const id = req.user.id; // Obtenido del token
    const { nombre, email, telefono, password } = req.body;

    // Normalizar valores (si vienen vacíos del FormData)
    const finalEmail = (email === "" || email === "null" || !email) ? null : email;
    const finalTelefono = (telefono === "" || telefono === "null" || !telefono) ? null : telefono;

    // VALIDACIÓN CRÍTICA: No permitir quedar incomunicado
    if (!finalEmail && !finalTelefono) {
      if (req.file) await fs.unlink(req.file.path).catch(() => {});
      return res.status(400).json({ 
        message: "No puedes dejar el perfil sin email y sin teléfono. Se requiere al menos uno para iniciar sesión." 
      });
    }

    const usuarioActual = await prisma.usuario.findUnique({ where: { id } });

    const data = {
      nombre,
      email: finalEmail,
      telefono: finalTelefono
    };

    // Cambio de contraseña basado en el TOKEN de sesión
    if (password && password.trim() !== "" && password !== "null") {
      const { valid, message } = validatePassword(password);
      if (!valid) {
        if (req.file) await fs.unlink(req.file.path).catch(() => {});
        return res.status(400).json({ message });
      }
      data.passwordHash = await bcrypt.hash(password, 10);
    }

    if (req.file) {
      if (usuarioActual.imagen) {
        const rutaVieja = path.resolve("uploads/personal", usuarioActual.imagen);
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
    console.error("Error en actualizarPerfil:", error);
    handlePrismaError(error, res, "Error al actualizar perfil");
  }
};

const cambiarContraseña = async (req, res) => {
  try {
    const { id } = req.params;
    const { password, newPassword } = req.body;
    if (!newPassword) {
      return res
        .status(400)
        .json({ message: "La nueva contraseña es obligatoria" });
    }
    const usuario = await prisma.usuario.findUnique({
      where: { id: Number(id) },
      select: { passwordHash: true },
    });

    if (!usuario) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    const isAdmin = req.user?.rol?.toLowerCase() === "admin";

    if (!isAdmin) {
      if (req.user.id !== Number(id)) {
        return res.status(403).json({ message: "No tienes permiso" });
      }
      if (!password) {
        return res
          .status(400)
          .json({ message: "Debes proporcionar tu contraseña actual" });
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
    if (!valid) return res.status(400).json({ message });

    const passwordHash = await bcrypt.hash(newPassword, 10);

    await prisma.usuario.update({
      where: { id: Number(id) },
      data: { passwordHash },
    });

    return res.status(200).json({ message: "Contraseña actualizada" });
  } catch (error) {
    console.error("Error en cambiarContraseña:", error);
    handlePrismaError(error, res, "Error al cambiar contraseña");
  }
};

const cambiarEstadoUsuario = async (req, res) => {
  try {
    const { id } = req.params;
    const usuario = await prisma.usuario.findUnique({
      where: { id: Number(id) },
      select: { activo: true },
    });

    if (!usuario)
      return res.status(404).json({ message: "Usuario no encontrado" });

    const usuarioActualizado = await prisma.usuario.update({
      where: { id: Number(id) },
      data: { activo: !usuario.activo },
    });

    return res.status(200).json({ data: usuarioActualizado });
  } catch (error) {
    console.error("Error en cambiarEstadoUsuario:", error);
    handlePrismaError(error, res, "Error al cambiar estado");
  }
};

const eliminarUsuario = async (req, res) => {
  try {
    const { id } = req.params;
    const usuario = await prisma.usuario.findUnique({
      where: { id: Number(id) },
    });
    if (!usuario)
      return res.status(404).json({ message: "Usuario no encontrado" });

    await prisma.usuario.delete({ where: { id: Number(id) } });
    return res.status(200).json({ message: "Usuario eliminado" });
  } catch (error) {
    console.error("Error en eliminarUsuario:", error);
    handlePrismaError(error, res, "Error al eliminar usuario");
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
