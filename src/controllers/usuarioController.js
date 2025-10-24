import prisma from "../config/database.js";
import { handlePrismaError } from "../utils/handlePrismaError.js";
import bcrypt from "bcrypt";
import { validatePassword } from "../utils/validatePassword.js";
import { validateRol } from "../utils/validateRol.js";

const listarUsuarios = async (req, res) => {
  try {
    const usuarios = await prisma.usuario.findMany({
      select: {
        id: true,
        nombre: true,
        email: true,
        telefono: true,
        activo: true,
        rol: true,
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
        rol: true,
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
      return res
        .status(400)
        .json({ message: "Los campos nombre y contraseña son obligatorios" });
    }

    const { valid, message } = validatePassword(password);
    if (!valid) {
      return res.status(400).json({ message });
    }

    const usuarioExistente = await prisma.usuario.findUnique({
      where: { email },
    });

    if (usuarioExistente) {
      return res.status(400).json({
        message: "Ya existe un usuario con este correo electrónico",
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const data = {};
    let rolValido;
    if (rol) {
      rolValido = await validateRol(rol);
    } else {
      rolValido = await validateRol("trabajador");
    }
    if (email) {
      data.email = email;
    }
    if (telefono) {
      data.telefono = telefono;
    }
    data.nombre = nombre;
    data.passwordHash = passwordHash;

    const nuevoUsuario = await prisma.usuario.create({
      data: {
        nombre: data.nombre,
        email: data.email,
        telefono: data.telefono,
        passwordHash: data.passwordHash,
        rol: { connect: { id: Number(rolValido.id) } },
      },
      select: {
        id: true,
        nombre: true,
        email: true,
        telefono: true,
        rol: true,
      },
    });

    return res.status(200).json({
      message: `El usuario ${nuevoUsuario.nombre} ha sido creado correctamente`,
      data: nuevoUsuario,
    });
  } catch (error) {
    handlePrismaError(error, res, "Hubo un error al crear el usuario");
  }
};

const editarUsurario = async (req, res) => {
  try {
    const { id } = req.params;

    const { nombre, email, password, rol, telefono } = req.body;

    const usuario = await prisma.usuario.findUnique({
      where: { id: Number(id) },
    });
    if (!usuario) {
      return res
        .status(404)
        .json({ message: "No existe nigun usuario asociado a ese id" });
    }

    const data = {};
    if (nombre) data.nombre = nombre;
    if (email) data.email = email;
    if (rol) data.rol = rol;
    if (telefono) data.telefono = telefono;
    if (password) {
      const passwordHash = await bcrypt.hash(password, 10);
      data.passwordHash = passwordHash;
    }

    const usuarioActualizado = await prisma.usuario.update({
      where: { id: Number(id) },
      data,
      select: {
        id: true,
        nombre: true,
        email: true,
        rol: true,
        telefono: true,
      },
    });

    return res.status(200).json({
      message: "Usuario actualizado exitosamente",
      data: usuarioActualizado,
    });
  } catch (error) {
    handlePrismaError(error, res, "Hubo un error al editar el usuario");
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
        usuario.passwordHash
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
      "Hubo un error al cambiar el estado del usuario"
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
  cambiarContraseña,
  cambiarEstadoUsuario,
  eliminarUsuario,
};
