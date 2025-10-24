import prisma from "./config/database.js"; // tu instancia de Prisma

async function testConnection() {
  try {
    await prisma.$connect();
    console.log("✅ Conexión con la base de datos exitosa");
    const usuarios = await prisma.usuario.findMany();
    console.log("usuarios", usuarios);
  } catch (error) {
    console.error("❌ Error al conectar con la base de datos:", error);
  } finally {
    await prisma.$disconnect();
  }
}

testConnection();
