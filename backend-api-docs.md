# Backend API Documentation - Otro Café

Esta documentación describe los endpoints de la API del backend para la aplicación Otro Café, un sistema de gestión de pedidos para un café. Los endpoints están organizados por módulo. Se detallan las estructuras exactas de entrada y salida basadas en los modelos de Prisma y controladores.

## Autenticación (/api/auth)

### POST /api/auth/login
- **Descripción**: Inicia sesión de un usuario (mesero o admin) usando email/teléfono y contraseña. Devuelve un token JWT.
- **Entrada**: Body JSON
  - `identificador`: string (obligatorio, email válido o teléfono)
  - `password`: string (obligatorio)
- **Salida**: JSON
  - `message`: string
  - `token`: string (JWT)
  - `user`: object
    - `id`: number
    - `nombre`: string
    - `rol`: string (nombre del rol, ej. "admin", "trabajador")

### POST /api/auth/logout
- **Descripción**: Cierra sesión del usuario. Si no es admin, marca como inactivo.
- **Entrada**: Header `Authorization: Bearer <token>`
- **Salida**: JSON
  - `message`: string

## Roles (/api/roles) - Requiere rol admin

### GET /api/roles
- **Descripción**: Lista todos los roles disponibles.
- **Entrada**: Header `Authorization: Bearer <token>` (admin)
- **Salida**: JSON
  - `data`: array de objects
    - `id`: number
    - `nombre`: string (ej. "admin", "trabajador")

### GET /api/roles/:id
- **Descripción**: Obtiene un rol específico por ID.
- **Entrada**:
  - Params: `id`: number (obligatorio)
  - Header `Authorization: Bearer <token>` (admin)
- **Salida**: JSON
  - `data`: object
    - `id`: number
    - `nombre`: string

### POST /api/roles
- **Descripción**: Crea un nuevo rol.
- **Entrada**:
  - Body JSON: `nombre`: string (obligatorio, único)
  - Header `Authorization: Bearer <token>` (admin)
- **Salida**: JSON
  - `message`: string
  - `data`: object
    - `id`: number
    - `nombre`: string

### PATCH /api/roles/:id
- **Descripción**: Actualiza un rol existente.
- **Entrada**:
  - Params: `id`: number (obligatorio)
  - Body JSON: `nombre`: string (obligatorio)
  - Header `Authorization: Bearer <token>` (admin)
- **Salida**: JSON
  - `message`: string
  - `data`: object
    - `id`: number
    - `nombre`: string

### DELETE /api/roles/:id
- **Descripción**: Elimina un rol.
- **Entrada**:
  - Params: `id`: number (obligatorio)
  - Header `Authorization: Bearer <token>` (admin)
- **Salida**: JSON
  - `message`: string

## Usuarios (/api/usuarios) - Requiere rol admin excepto cambiar contraseña

### GET /api/usuarios
- **Descripción**: Lista todos los usuarios.
- **Entrada**: Header `Authorization: Bearer <token>` (admin)
- **Salida**: JSON
  - `data`: array de objects
    - `id`: number
    - `nombre`: string
    - `email`: string | null
    - `telefono`: string | null
    - `activo`: boolean
    - `rol`: object
      - `id`: number
      - `nombre`: string

### GET /api/usuarios/:id
- **Descripción**: Obtiene detalles de un usuario.
- **Entrada**:
  - Params: `id`: number (obligatorio)
  - Header `Authorization: Bearer <token>` (admin)
- **Salida**: JSON
  - `data`: object
    - `id`: number
    - `nombre`: string
    - `telefono`: string | null
    - `email`: string | null
    - `rol`: object
      - `id`: number
      - `nombre`: string

### POST /api/usuarios
- **Descripción**: Crea un nuevo usuario.
- **Entrada**:
  - Body JSON:
    - `nombre`: string (obligatorio)
    - `email`: string | null (único si proporcionado)
    - `telefono`: string | null (único si proporcionado)
    - `password`: string (obligatorio, validado: min 8 chars, mayúscula, minúscula, número)
    - `rol`: string | null (nombre del rol, default "trabajador")
  - Header `Authorization: Bearer <token>` (admin)
- **Salida**: JSON
  - `message`: string
  - `data`: object
    - `id`: number
    - `nombre`: string
    - `email`: string | null
    - `telefono`: string | null
    - `rol`: object
      - `id`: number
      - `nombre`: string

### PATCH /api/usuarios/:id
- **Descripción**: Edita datos de usuario.
- **Entrada**:
  - Params: `id`: number (obligatorio)
  - Body JSON (campos opcionales):
    - `nombre`: string
    - `email`: string
    - `telefono`: string
    - `rol`: string (nombre del rol)
    - `password`: string (si incluido, se hashea)
  - Header `Authorization: Bearer <token>` (admin)
- **Salida**: JSON
  - `message`: string
  - `data`: object (usuario actualizado, estructura como en POST)

### PATCH /api/usuarios/:id/cambiar_password
- **Descripción**: Cambia contraseña del usuario autenticado.
- **Entrada**:
  - Params: `id`: number (obligatorio, debe coincidir con user.id del token)
  - Body JSON: `password`: string (obligatorio, validado)
  - Header `Authorization: Bearer <token>`
- **Salida**: JSON
  - `message`: string

### PATCH /api/usuarios/:id/cambiar_estado
- **Descripción**: Activa/desactiva usuario.
- **Entrada**:
  - Params: `id`: number (obligatorio)
  - Body JSON: `activo`: boolean (obligatorio)
  - Header `Authorization: Bearer <token>` (admin)
- **Salida**: JSON
  - `message`: string

### DELETE /api/usuarios/:id
- **Descripción**: Elimina un usuario.
- **Entrada**:
  - Params: `id`: number (obligatorio)
  - Header `Authorization: Bearer <token>` (admin)
- **Salida**: JSON
  - `message`: string

## Mesas (/api/mesas)

### GET /api/mesas
- **Descripción**: Lista todas las mesas.
- **Entrada**: Header `Authorization: Bearer <token>`
- **Salida**: JSON
  - `data`: array de objects
    - `id`: number
    - `nombre`: string
    - `codigoQR`: string
    - `estado`: string (ej. "disponible", "ocupada")

### GET /api/mesas/:id
- **Descripción**: Obtiene detalles de una mesa.
- **Entrada**:
  - Params: `id`: number (obligatorio)
  - Header `Authorization: Bearer <token>`
- **Salida**: JSON
  - `data`: object
    - `id`: number
    - `nombre`: string
    - `codigoQR`: string
    - `estado`: string

### POST /api/mesas
- **Descripción**: Crea una nueva mesa.
- **Entrada**:
  - Body JSON:
    - `numero`: number (obligatorio, pero en schema es nombre, ajustar)
    - `capacidad`: number (no usado en controller, pero en schema no existe, asumir opcional)
  - Header `Authorization: Bearer <token>` (admin)
- **Salida**: JSON
  - `message`: string
  - `data`: object (mesa creada, estructura como en GET)

### PATCH /api/mesas/:id
- **Descripción**: Actualiza datos de mesa.
- **Entrada**:
  - Params: `id`: number (obligatorio)
  - Body JSON (campos opcionales):
    - `nombre`: string
    - `codigoQR`: string
    - `estado`: string
  - Header `Authorization: Bearer <token>`
- **Salida**: JSON
  - `message`: string
  - `data`: object (mesa actualizada)

### DELETE /api/mesas/:id
- **Descripción**: Elimina una mesa.
- **Entrada**:
  - Params: `id`: number (obligatorio)
  - Header `Authorization: Bearer <token>` (admin)
- **Salida**: JSON
  - `message`: string

### GET /api/mesas/codigo/:codigoQR
- **Descripción**: Obtiene mesa por código QR (público para clientes).
- **Entrada**: Params: `codigoQR`: string (obligatorio)
- **Salida**: JSON
  - `data`: object (estructura como en GET /:id)

## Pedidos (/api/pedidos)

### GET /api/pedidos/activos
- **Descripción**: Lista pedidos activos.
- **Entrada**: Header `Authorization: Bearer <token>`
- **Salida**: JSON
  - `data`: array de objects
    - `id`: number
    - `mesaId`: number
    - `estado`: string ("abierto" | "cerrado")
    - `productos`: array de objects
      - `productoId`: number
      - `nombre`: string
      - `precio`: number
      - `cantidad`: number
      - `subtotal`: number
    - `total`: number
    - `tipo_pago`: string | null ("efectivo" | "transferencia" | "mixto")
    - `createdAt`: string (ISO date)
    - `updatedAt`: string (ISO date)
    - `mesa`: object
      - `nombre`: string

### GET /api/pedidos/completados
- **Descripción**: Lista pedidos completados.
- **Entrada**: Header `Authorization: Bearer <token>`
- **Salida**: JSON (estructura igual a /activos, pero estado "cerrado")

### POST /api/pedidos
- **Descripción**: Crea o actualiza pedido para una mesa.
- **Entrada**: Body JSON
  - `codigoQR`: string (obligatorio, de la mesa)
  - `productos`: array (obligatorio, no vacío) de objects
    - `productoId`: number (obligatorio)
    - `cantidad`: number (obligatorio)
- **Salida**: JSON
  - `message`: string
  - `data`: object (pedido, estructura como en GET)

### GET /api/pedidos/:mesaId
- **Descripción**: Obtiene pedido activo de una mesa.
- **Entrada**: Params: `mesaId`: number (obligatorio)
- **Salida**: JSON
  - `data`: object (pedido activo, estructura como en GET /activos, con mesa.nombre en lugar de mesa object)

### PATCH /api/pedidos/estado/:id
- **Descripción**: Actualiza estado del pedido.
- **Entrada**:
  - Params: `id`: number (obligatorio)
  - Body JSON: `estado`: string (obligatorio, "abierto" | "cerrado")
  - Header `Authorization: Bearer <token>`
- **Salida**: JSON
  - `message`: string
  - `data`: object (pedido actualizado)

### PATCH /api/pedidos/:id
- **Descripción**: Modifica pedido (admin).
- **Entrada**:
  - Params: `id`: number (obligatorio)
  - Body JSON (campos opcionales):
    - `productos`: array (como en POST)
    - `total`: number
    - `tipo_pago`: string
  - Header `Authorization: Bearer <token>` (admin)
- **Salida**: JSON
  - `message`: string
  - `data`: object (pedido actualizado)

### DELETE /api/pedidos/:id
- **Descripción**: Elimina pedido.
- **Entrada**:
  - Params: `id`: number (obligatorio)
  - Header `Authorization: Bearer <token>` (admin)
- **Salida**: JSON
  - `message`: string

## Categorías (/api/categorias)

### GET /api/categorias
- **Descripción**: Lista categorías activas (público).
- **Entrada**: Ninguna
- **Salida**: JSON
  - `data`: array de objects
    - `id`: number
    - `nombre`: string

### GET /api/categorias/todas
- **Descripción**: Lista todas las categorías (admin).
- **Entrada**: Header `Authorization: Bearer <token>` (admin)
- **Salida**: JSON
  - `data`: array de objects
    - `id`: number
    - `nombre`: string
    - `position`: number | null
    - `habilitada`: boolean

### GET /api/categorias/:id
- **Descripción**: Obtiene categoría por ID.
- **Entrada**: Params: `id`: number (obligatorio)
- **Salida**: JSON
  - `data`: object
    - `id`: number
    - `nombre`: string
    - `position`: number | null
    - `habilitada`: boolean

### POST /api/categorias
- **Descripción**: Crea nueva categoría.
- **Entrada**:
  - Body JSON: `nombre`: string (obligatorio)
  - Header `Authorization: Bearer <token>` (admin)
- **Salida**: JSON
  - `message`: string
  - `data`: object
    - `id`: number
    - `nombre`: string
    - `position`: number | null
    - `habilitada`: boolean

### PATCH /api/categorias/:id
- **Descripción**: Actualiza categoría.
- **Entrada**:
  - Params: `id`: number (obligatorio)
  - Body JSON: `nombre`: string (obligatorio)
  - Header `Authorization: Bearer <token>` (admin)
- **Salida**: JSON
  - `message`: string
  - `data`: object (actualizado)

### DELETE /api/categorias/:id
- **Descripción**: Elimina categoría.
- **Entrada**:
  - Params: `id`: number (obligatorio)
  - Header `Authorization: Bearer <token>` (admin)
- **Salida**: JSON
  - `message`: string

## Productos (/api/productos)

### GET /api/productos
- **Descripción**: Lista productos disponibles (público).
- **Entrada**: Ninguna
- **Salida**: JSON
  - `data`: array de objects
    - `id`: number
    - `nombre`: string
    - `description`: string | null
    - `precio`: number
    - `imagen`: string | null (URL relativa, ej. "productos/imagen.jpg")
    - `categoriaId`: number
    - `categoria`: string (nombre de la categoría)

### GET /api/productos/:id
- **Descripción**: Obtiene detalles de producto.
- **Entrada**: Params: `id`: number (obligatorio)
- **Salida**: JSON
  - `data`: object
    - `id`: number
    - `nombre`: string
    - `description`: string | null
    - `precio`: number
    - `disponible`: boolean
    - `imagen`: string | null
    - `categoriaId`: number
    - `categoria`: object
      - `id`: number
      - `nombre`: string

### POST /api/productos
- **Descripción**: Crea nuevo producto con imagen.
- **Entrada**: Body FormData
  - `nombre`: string (obligatorio)
  - `precio`: number (obligatorio, >0)
  - `descripcion`: string | null
  - `disponible`: boolean | null (default true)
  - `categoriaId`: number (obligatorio)
  - `imagen`: file (obligatorio, imagen del producto)
  - Header `Authorization: Bearer <token>` (admin)
- **Salida**: JSON
  - `message`: string
  - `data`: object (producto creado, con categoria object)

### PATCH /api/productos/:id
- **Descripción**: Actualiza producto con posible nueva imagen.
- **Entrada**:
  - Params: `id`: number (obligatorio)
  - Body FormData (campos opcionales):
    - `nombre`: string
    - `precio`: number
    - `descripcion`: string
    - `categoriaId`: number
    - `imagen`: file (opcional, nueva imagen)
  - Header `Authorization: Bearer <token>` (admin)
- **Salida**: JSON
  - `message`: string
  - `data`: object (producto actualizado)

### PATCH /api/productos/:id/disponibilidad
- **Descripción**: Cambia disponibilidad del producto.
- **Entrada**:
  - Params: `id`: number (obligatorio)
  - Body JSON: `disponible`: boolean (obligatorio)
  - Header `Authorization: Bearer <token>`
- **Salida**: JSON
  - `message`: string

### DELETE /api/productos/:id
- **Descripción**: Elimina producto.
- **Entrada**:
  - Params: `id`: number (obligatorio)
  - Header `Authorization: Bearer <token>` (admin)
- **Salida**: JSON
  - `message`: string

## Notas Generales
- Todos los endpoints protegidos requieren header `Authorization: Bearer <token>`.
- Errores devuelven JSON { "message": "string" } con código HTTP apropiado (400, 401, 404, 500).
- Imágenes de productos se sirven desde `/uploads/productos/`, URL completa: `http://localhost:3000/uploads/productos/<filename>`.
- Para pedidos: estado restringido a "abierto" o "cerrado"; tipo_pago a "efectivo", "transferencia", "mixto".
- Formato de fechas: ISO 8601 (ej. "2024-10-19T12:00:00.000Z").
- IDs son números enteros autoincrementales.
- Campos opcionales marcados con | null o ?.