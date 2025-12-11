import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import crypto from "crypto";

const prisma = new PrismaClient();

async function main() {
  console.log("Limpiando datos antiguos...");

  // Primero borramos las tablas con TRUNCATE y reiniciamos IDs
  //  const tablas = ["pedido", "mesa", "producto", "categoria", "usuario", "rol"];
  //
  //  for (const tabla of tablas) {
  //    await prisma.$executeRawUnsafe(
  //      `TRUNCATE TABLE "${tabla}" RESTART IDENTITY CASCADE;`
  //    );
  //  }

  // console.log("Limpiando datos antiguos...");

  await prisma.pedido.deleteMany();
  await prisma.$executeRawUnsafe(
    `ALTER SEQUENCE "Pedido_id_seq" RESTART WITH 1`
  );
  await prisma.mesa.deleteMany();
  await prisma.$executeRawUnsafe(`ALTER SEQUENCE "Mesa_id_seq" RESTART WITH 1`);
  await prisma.producto.deleteMany();
  await prisma.$executeRawUnsafe(
    `ALTER SEQUENCE "Producto_id_seq" RESTART WITH 1`
  );
  await prisma.categoria.deleteMany();
  await prisma.$executeRawUnsafe(
    `ALTER SEQUENCE "Categoria_id_seq" RESTART WITH 1`
  );
  await prisma.usuario.deleteMany();
  await prisma.$executeRawUnsafe(
    `ALTER SEQUENCE "Usuario_id_seq" RESTART WITH 1`
  );
  await prisma.rol.deleteMany();
  await prisma.$executeRawUnsafe(`ALTER SEQUENCE "Rol_id_seq" RESTART WITH 1`);

  console.log("Datos antiguos eliminados ✅");
  console.log("Iniciando seed...");

  // Roles
  const rolAdmin = await prisma.rol.create({ data: { nombre: "admin" } });
  const rolTrabajador = await prisma.rol.create({
    data: { nombre: "trabajador" },
  });
  console.log(`Rol ${rolAdmin.nombre} creado.`);
  console.log(`Rol ${rolTrabajador.nombre} creado.`);

  // Usuarios
  const passwordHash = await bcrypt.hash("123456", 10);
  const usuarios = [
    { nombre: "Yonel", email: "yonelcc0817@gmail.com", rolId: rolAdmin.id },
    { nombre: "Maria", email: "maria@example.com", rolId: rolTrabajador.id },
  ];
  for (const user of usuarios) {
    await prisma.usuario.create({ data: { ...user, passwordHash } });
    console.log(`Usuario ${user.nombre} creado.`);
  }

  // Categorías
  const categoriasData = [
    "Cafés Calientes",
    "Cafés Fríos",
    "Helados",
    "Brunches",
    "Confituras",
  ];
  const categorias = {};
  for (const nombre of categoriasData) {
    const c = await prisma.categoria.create({ data: { nombre } });
    categorias[nombre] = c.id;
    console.log(`Categoría ${nombre} creada.`);
  }

  // Productos
  const productosData = [
    { nombre: "Latte", precio: 2.5, categoria: "Cafés Calientes" },
    {
      nombre: "Café Expresso",
      precio: 0.5,
      categoria: "Cafés Calientes",
    },
    { nombre: "Café Machiatto", precio: 4.5, categoria: "Cafés Calientes" },
    { nombre: "Frappé", precio: 2.0, categoria: "Cafés Fríos" },
    { nombre: "Affogato", precio: 3.0, categoria: "Cafés Fríos" },
    { nombre: "Helado Vainilla", precio: 1.5, categoria: "Helados" },
    { nombre: "Helado Chocolate", precio: 1.5, categoria: "Helados" },
    { nombre: "Sandwich", precio: 5.0, categoria: "Brunches" },
    { nombre: "Pastel", precio: 3.5, categoria: "Confituras" },
  ];

  const productos = {};
  for (const prod of productosData) {
    const p = await prisma.producto.create({
      data: {
        nombre: prod.nombre,
        precio: prod.precio,
        categoriaId: categorias[prod.categoria],
      },
    });
    productos[prod.nombre] = p.id;
    console.log(`Producto ${prod.nombre} creado.`);
  }

  // Mesas
  const mesasData = ["Mesa 1", "Mesa 2", "Mesa 3"];
  const mesas = {};
  for (const nombre of mesasData) {
    const codigoQR = crypto.randomBytes(32).toString("hex");
    const m = await prisma.mesa.create({
      data: { nombre, codigoQR },
    });
    mesas[nombre] = m.id;
    console.log(`Mesa ${nombre} creada con QR.`);
  }

  // Pedidos
  const pedidosData = [
    {
      mesa: "Mesa 1",
      items: [
        { nombre: "Latte", cantidad: 1 },
        { nombre: "Café Expresso", cantidad: 1 },
      ],
      total: 5.0,
      tipo_pago: "efectivo",
    },
    {
      mesa: "Mesa 2",
      items: [
        { nombre: "Frappé", cantidad: 1 },
        { nombre: "Affogato", cantidad: 1 },
      ],
      total: 5.5,
      tipo_pago: "transferencia",
    },
  ];

  for (const ped of pedidosData) {
    await prisma.pedido.create({
      data: {
        mesaId: mesas[ped.mesa],
        estado: "abierto", // opcional, si tu modelo lo tiene con default igual puedes omitirlo
        productos: ped.items.map((item) => {
          const productoId = productos[item.nombre]; // id en la tabla producto
          const prodDef = productosData.find((p) => p.nombre === item.nombre);
          const precio = prodDef ? prodDef.precio : 0;
          const cantidad = item.cantidad ?? 1;
          const subtotal = precio * cantidad;

          return {
            nombre: item.nombre,
            precio,
            cantidad,
            subtotal,
            productoId,
          };
        }),
        total: ped.total, // podrías también recalcularlo sumando subtotales si quieres
        tipo_pago: ped.tipo_pago,
      },
    });
    console.log(`Pedido para ${ped.mesa} creado.`);
  }

  console.log("Seed finalizado ✅");
}

main()
  .catch((e) => console.error("Error durante el seeding:", e))
  .finally(async () => await prisma.$disconnect());
