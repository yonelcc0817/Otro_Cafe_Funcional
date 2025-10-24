import prisma from "../config/database.js";

export const validateRol = async (rolInput) => {
  let rol;

  if (typeof rolInput === "number") {
    rol = await prisma.rol.findUnique({ where: { id: rolInput } });
  } else if (typeof rolInput === "string") {
    const parseId = parseInt(rolInput, 10);

    if (!isNaN(parseId)) {
      rol = await prisma.rol.findUnique({ where: { id: parseId } });
    } else {
      const rolNormalizado = rolInput.trim().toLowerCase();
      rol = await prisma.rol.findUnique({ where: { nombre: rolNormalizado } });
    }
  }

  if (!rol) {
    throw new Error("Rol no válido o no encontrado");
  }

  return rol;
};
