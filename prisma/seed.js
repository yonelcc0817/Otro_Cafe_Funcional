import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import crypto from "crypto";

const prisma = new PrismaClient();

async function main() {
  console.log("Iniciando reconstrucción de base de datos...");

  // Limpieza segura
  await prisma.pedido.deleteMany();
  await prisma.mesa.deleteMany();
  await prisma.producto.deleteMany();
  await prisma.categoria.deleteMany();
  await prisma.usuario.deleteMany();
  await prisma.rol.deleteMany();

  // Reset de secuencias (PostgreSQL)
  const tables = ["Pedido", "Mesa", "Producto", "Categoria", "Usuario", "Rol"];
  for (const table of tables) {
    try {
      await prisma.$executeRawUnsafe(`ALTER SEQUENCE "${table}_id_seq" RESTART WITH 1`);
    } catch (e) {
      console.warn(`No se pudo resetear secuencia para ${table}`);
    }
  }

  console.log("Limpieza completada ✅");

  // 1. Roles
  const rolAdmin = await prisma.rol.create({ data: { nombre: "admin" } });
  const rolTrabajador = await prisma.rol.create({ data: { nombre: "trabajador" } });

  // 2. Usuarios
  const passwordHash = await bcrypt.hash("123456", 10);
  await prisma.usuario.create({
    data: { nombre: "Yonel", email: "yonelcc0817@gmail.com", rolId: rolAdmin.id, passwordHash }
  });
  await prisma.usuario.create({
    data: { nombre: "Maria", email: "maria@example.com", rolId: rolTrabajador.id, passwordHash }
  });

  // 3. Categorías
  const categorias = ["Cafés Calientes", "Cafés Fríos", "Helados", "Brunches", "Confituras"];
  const catMap = {};
  for (const nombre of categorias) {
    const c = await prisma.categoria.create({ data: { nombre } });
    catMap[nombre] = c.id;
  }

  // 4. Productos
  const productosData = [
    { nombre: "Latte", precio: 2.5, cat: "Cafés Calientes" },
    { nombre: "Café Expresso", precio: 0.5, cat: "Cafés Calientes" },
    { nombre: "Frappé Classic", precio: 2.0, cat: "Cafés Fríos" },
    { nombre: "Affogato", precio: 3.0, cat: "Cafés Fríos" },
    { nombre: "Helado Chocolate", precio: 1.5, cat: "Helados" },
    { nombre: "Sandwich Mixto", precio: 5.0, cat: "Brunches" },
    { nombre: "Tarta Limón", precio: 3.5, cat: "Confituras" },
  ];
  const prodMap = {};
  for (const p of productosData) {
    const created = await prisma.producto.create({
      data: { nombre: p.nombre, precio: p.precio, categoriaId: catMap[p.cat] }
    });
    prodMap[p.nombre] = created;
  }

  // 5. Mesas
  const mesas = [];
  for (let i = 1; i <= 5; i++) {
    const m = await prisma.mesa.create({
      data: { 
        nombre: `Mesa ${i}`, 
        codigoQR: crypto.randomBytes(16).toString("hex"),
        estado: i === 2 ? "ocupada" : "disponible" // Mesa 2 ocupada por pedido abierto
      }
    });
    mesas.push(m);
  }

  // 6. Pedidos (Hoy y Pasados)
  const hoy = new Date();
  const ayer = new Date();
  ayer.setDate(hoy.getDate() - 1);

  // Pedido PASADO (Ayer) - Cerrado
  await prisma.pedido.create({
    data: {
      numero_diario: 1,
      mesaId: mesas[0].id,
      estado: "cerrado",
      total: 7.5,
      tipo_pago: "efectivo",
      cant_efect: 10,
      cant_prop: 2.5,
      createdAt: ayer,
      updatedAt: ayer,
      productos: [
        { productoId: prodMap["Latte"].id, nombre: "Latte", precio: 2.5, cantidad: 1, subtotal: 2.5 },
        { productoId: prodMap["Sandwich Mixto"].id, nombre: "Sandwich Mixto", precio: 5.0, cantidad: 1, subtotal: 5.0 }
      ]
    }
  });

  // Pedido HOY - Abierto (Mesa 2)
  await prisma.pedido.create({
    data: {
      numero_diario: 1,
      mesaId: mesas[1].id,
      estado: "abierto",
      total: 2.5,
      createdAt: hoy,
      productos: [
        { productoId: prodMap["Latte"].id, nombre: "Latte", precio: 2.5, cantidad: 1, subtotal: 2.5 }
      ]
    }
  });

  // Pedido HOY - Cerrado (Mesa 3)
  const hace1Minuto = new Date();
  hace1Minuto.setMinutes(hace1Minuto.getMinutes() - 1);

  await prisma.pedido.create({
    data: {
      numero_diario: 2,
      mesaId: mesas[2].id,
      estado: "cerrado",
      total: 5.5,
      tipo_pago: "transferencia",
      cant_transf: 5.5,
      createdAt: hoy,
      updatedAt: hace1Minuto, // Para probar "CERRADO RECIENTEMENTE"
      productos: [
        { productoId: prodMap["Frappé Classic"].id, nombre: "Frappé Classic", precio: 2.0, cantidad: 1, subtotal: 2.0 },
        { productoId: prodMap["Tarta Limón"].id, nombre: "Tarta Limón", precio: 3.5, cantidad: 1, subtotal: 3.5 }
      ]
    }
  });

  console.log("Seed finalizado con éxito! 🚀");
  console.log("-> 1 Pedido abierto hoy (Mesa 2)");
  console.log("-> 1 Pedido cerrado hoy (Mesa 3)");
  console.log("-> 1 Pedido cerrado ayer (Mesa 1)");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
