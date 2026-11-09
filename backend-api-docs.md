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
- **Descripción**: Crea o actualiza pedido para una mesa. Descuenta del stock
  las cantidades registradas dentro de una transacción; si la cantidad pedida
  excede las existencias, se registra la cantidad disponible y se informa de
  ella en `ajustes`.
  - Si un producto depende de otros (spec 004), su disponibilidad es el mínimo
    de la de sus bases y cada unidad vendida se descuenta de **todas** ellas.
    Lo descontado queda registrado por pedido y producto base, para poder
    devolverlo exactamente al editar o eliminar el pedido.
- **Entrada**: Body JSON
  - `codigoQR`: string (obligatorio, de la mesa)
  - `productos`: array (obligatorio, no vacío) de objects
    - `productoId`: number (obligatorio)
    - `cantidad`: number (obligatorio, entero mayor que cero)
- **Salida**: JSON
  - `message`: string
  - `data`: object (pedido, estructura como en GET)
  - `ajustes`: array de objects, vacío si no hubo recortes
    - `productoId`: number
    - `nombre`: string
    - `solicitado`: number
    - `registrado`: number (0 si el producto no tenía disponibilidad)
    - `disponible`: number | null (unidades que había antes de descontar)
    - `restante`: number (unidades que quedan después de registrar)
- **Errores**: `409` si ninguno de los productos solicitados tiene
  disponibilidad; en ese caso no se crea ningún pedido y `ajustes` explica
  cuáles se descartaron.

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
- **Descripción**: Modifica pedido. Devuelve al stock exactamente lo que el
  pedido tenía descontado y vuelve a consumir según el catálogo actual: los
  aumentos que excedan lo disponible se recortan y las reducciones devuelven
  unidades al stock. Con dependencias, lo devuelto y lo consumido se aplica a
  los productos base.
  (admin para pedidos de fechas pasadas; cualquier usuario autenticado para los
  del día en curso)
- **Entrada**:
  - Params: `id`: number (obligatorio)
  - Body JSON (campos opcionales):
    - `productos`: array (como en POST)
    - `mesaId`: number
    - `estado`: string
  - Header `Authorization: Bearer <token>`
- **Salida**: JSON
  - `message`: string
  - `data`: object (pedido actualizado)
  - `ajustes`: array con los recortes aplicados (misma estructura que en POST)

### DELETE /api/pedidos/:id
- **Descripción**: Elimina pedido y devuelve al stock exactamente las cantidades
  que tenía descontadas, incluidos los productos base de los productos
  dependientes vendidos. Los pedidos anteriores a las dependencias se reponen
  con el criterio anterior (solo productos con límite).
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
- **Descripción**: Lista todos los productos (público). No filtra por
  disponibilidad y **nunca expone la cantidad exacta de existencias**.
- **Entrada**: Ninguna
- **Salida**: JSON
  - `data`: array de objects
    - `id`: number
    - `nombre`: string
    - `description`: string | null
    - `precio`: number
    - `disponible`: boolean
    - `destacado`: boolean
    - `bajaDisponibilidad`: boolean (tiene una cantidad fijada)
    - `agotado`: boolean (la cantidad fijada llegó a cero)
    - `imagen`: string | null (URL relativa, ej. "productos/imagen.jpg")
    - `categoriaId`: number
    - `categoria`: string (nombre de la categoría)
- **Dependencias**: si el producto depende de otros, `bajaDisponibilidad` y
  `agotado` se calculan con sus productos base (el más restrictivo manda), y
  tampoco se exponen sus cantidades.

### GET /api/productos/gestion
- **Descripción**: Listado para las pantallas de personal. Incluye la cantidad
  exacta de existencias y las dependencias de cada producto.
- **Entrada**:
  - Header `Authorization: Bearer <token>` (admin o trabajador)
- **Salida**: JSON
  - `data`: array de objects con los mismos campos que `GET /api/productos`
    más:
    - `stock`: number | null (`null` = venta sin límite, `0` = agotado). En un
      producto dependiente es la cantidad que se puede vender según sus bases.
    - `esDependiente`: boolean (tiene al menos un producto base)
    - `estado`: string (`disponible` | `baja` | `agotado`), derivado si el
      producto es dependiente
    - `dependencias`: array de productos base
      - `id`, `nombre`, `disponible`, `stock`, `estado`
    - `dependientes`: array de `{ id, nombre }` con los productos que dependen
      de este

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
- **Descripción**: Cambia la disponibilidad del producto. Si el cuerpo trae
  `disponible`, se aplica ese valor; si no, se alterna el estado actual.
- **Entrada**:
  - Params: `id`: number (obligatorio)
  - Body JSON: `disponible`: boolean (opcional)
  - Header `Authorization: Bearer <token>`
- **Salida**: JSON
  - `message`: string
  - `disponible`: boolean (estado resultante)
- **Nota**: es la única forma de ocultar o volver a mostrar a mano un producto
  dependiente; su estado y su cantidad siguen calculándose con sus bases.

### PATCH /api/productos/:id/estado
- **Descripción**: Selector único de estado del producto. Es el endpoint que usa
  la vista de inventario: un solo estado por producto, y el backend decide qué
  columnas escribir.
  - `disponible`: se levanta cualquier restricción (`stock = null`).
  - `baja`: se fija la cantidad indicada (`stock = cantidad`).
  - `agotado`: cero existencias, oculto del menú (`stock = 0`).
  En los tres casos el producto queda con `disponible = true`.
- **Entrada**:
  - Params: `id`: number (obligatorio)
  - Body JSON:
    - `estado`: string (obligatorio: `disponible` | `baja` | `agotado`)
    - `cantidad`: number (obligatorio solo si `estado` es `baja`; entero mayor que cero)
  - Header `Authorization: Bearer <token>` (admin o trabajador)
- **Salida**: JSON
  - `message`: string
  - `data`: object
    - `id`: number
    - `disponible`: boolean
    - `stock`: number | null
    - `estado`: string (`disponible` | `baja` | `agotado`)
    - `bajaDisponibilidad`: boolean
    - `agotado`: boolean
- **Errores**: `400` si el estado no es válido, si `baja` llega sin cantidad
  válida o si el producto tiene dependencias (su estado se calcula con sus
  productos base); `404` si el producto no existe.

### PATCH /api/productos/:id/stock
- **Descripción**: Activa o repone la baja disponibilidad con una cantidad
  concreta de unidades. Deja el producto disponible para la venta.
- **Entrada**:
  - Params: `id`: number (obligatorio)
  - Body JSON: `cantidad`: number (obligatorio, entero mayor que cero)
  - Header `Authorization: Bearer <token>` (admin o trabajador)
- **Salida**: JSON
  - `message`: string
  - `data`: object
    - `id`: number
    - `stock`: number
    - `bajaDisponibilidad`: boolean
    - `agotado`: boolean
- **Errores**: `400` si la cantidad no es un entero mayor que cero o si el
  producto tiene dependencias.

### DELETE /api/productos/:id/stock
- **Descripción**: Quita la baja disponibilidad. El producto vuelve a venderse
  sin límite de cantidad.
- **Entrada**:
  - Params: `id`: number (obligatorio)
  - Header `Authorization: Bearer <token>` (admin o trabajador)
- **Salida**: JSON
  - `message`: string
  - `data`: object (`id`, `stock: null`, `bajaDisponibilidad`, `agotado`)
- **Errores**: `400` si el producto tiene dependencias.

### DELETE /api/productos/:id
- **Descripción**: Elimina producto.
- **Entrada**:
  - Params: `id`: number (obligatorio)
  - Header `Authorization: Bearer <token>` (admin)
- **Salida**: JSON
  - `message`: string
- **Errores**: `409` si otros productos dependen de este. La respuesta incluye
  `data` con `[{ id, nombre }]` de los productos que lo impiden; hay que quitar
  esas dependencias antes de poder eliminarlo.

### POST /api/productos/:id/dependencias
- **Descripción**: Hace que el producto venda las existencias de un producto
  base. El producto dependiente pierde sus existencias propias: su estado y su
  cantidad se calculan con sus bases, y al venderlo se descuenta de cada una.
  - Solo se admite un nivel de dependencia: la base no puede depender de otros,
    y un producto que ya es base de otro no puede depender de nadie.
  - Al crear la primera dependencia se descartan las existencias propias del
    producto (`stock = null`). La visibilidad manual (`disponible`) se
    conserva: si el producto estaba oculto, sigue oculto.
- **Entrada**:
  - Params: `id`: number (producto dependiente)
  - Body JSON: `baseId`: number (producto base)
  - Header `Authorization: Bearer <token>` (admin o trabajador)
- **Salida**: JSON (`201`)
  - `message`: string
  - `data`: producto en el formato de `GET /api/productos/gestion`
- **Errores**: `400` si el vínculo es inválido o rompe la regla de un solo
  nivel; `404` si alguno de los productos no existe; `409` si el vínculo ya
  existía.

### DELETE /api/productos/:id/dependencias/:baseId
- **Descripción**: Quita un producto base de las dependencias del producto. Si
  era la última, el producto queda `agotado` hasta que el personal le asigne un
  estado.
- **Entrada**:
  - Params: `id`: number (producto dependiente), `baseId`: number (producto base)
  - Header `Authorization: Bearer <token>` (admin o trabajador)
- **Salida**: JSON
  - `message`: string
  - `data`: producto en el formato de `GET /api/productos/gestion`
- **Errores**: `404` si ese vínculo no existe.

## Notas Generales
- Todos los endpoints protegidos requieren header `Authorization: Bearer <token>`.
- Errores devuelven JSON { "message": "string" } con código HTTP apropiado (400, 401, 404, 500).
- Imágenes de productos se sirven desde `/uploads/productos/`, URL completa: `http://localhost:3000/uploads/productos/<filename>`.
- Para pedidos: estado restringido a "abierto" o "cerrado"; tipo_pago a "efectivo", "transferencia", "mixto".
- Formato de fechas: ISO 8601 (ej. "2024-10-19T12:00:00.000Z").
- IDs son números enteros autoincrementales.
- Campos opcionales marcados con | null o ?.
## Idempotencia de escrituras
Todas las rutas de mutación (`POST`, `PATCH`, `DELETE`) de pedidos, mesas, turnos,
productos, categorías, roles y usuarios aceptan el header opcional
`Idempotency-Key`.

- Si se envía una clave nueva, el servidor reserva la operación, la ejecuta y
  guarda el recibo de la respuesta.
- Si se repite la misma clave con el mismo cuerpo, el servidor devuelve el
  recibo almacenado **sin volver a aplicar el cambio**.
- Si se repite la misma clave con un cuerpo distinto, responde `409`.
- Si la operación todavía está en curso, responde `503` con
  `{ "pending": true, "operationId": "..." }` y `Retry-After: 1`.
- El cliente puede reenviar la misma clave al recuperar la conexión: el efecto
  se aplica una sola vez.

### Solicitudes de cliente sin autenticar
`POST /api/pedidos` sin header `Authorization` es la ruta pública de pedido por
mesa. Mientras una solicitud idéntica siga pendiente, una segunda solicitud
igual responde `429`:

```json
{
  "retryAfterSeconds": 30,
  "message": "Hay problemas con el servidor. Vuelve a intentarlo en 30 segundos."
}
```

Los recibos completados se purgan a los 7 días; las reservas abandonadas (por
ejemplo, si el proceso termina antes de responder) se liberan tras 60 segundos.

## Comunicación en tiempo real (Socket.IO)
El canal Socket.IO se sirve sobre los mismos listeners HTTP (`PORT`) y HTTPS
(`HTTPS_PORT`) que la API, en la ruta `/socket.io`.

### Autenticación
El handshake es independiente del middleware HTTP. El token se envía en `auth`:

```js
io({ path: "/socket.io", auth: (cb) => cb({ token: localStorage.getItem("authToken") }) });
```

- Sin token, la conexión se acepta como **cliente anónimo**.
- Con token inválido, expirado o de un usuario inactivo, el handshake se rechaza
  con `unauthorized`.
- Los clientes anónimos solo pueden suscribirse a la sala de una mesa concreta;
  nunca reciben eventos de otras mesas ni datos administrativos.

### Salas
| Sala | Quién la recibe |
| --- | --- |
| `menu:public` | Toda conexión (catálogo visible al cliente) |
| `authenticated` | Usuarios con token válido |
| `role:admin` | Usuarios con rol admin |
| `user:<id>` | La propia sesión del usuario |
| `table:<mesaId>` | Quien se suscriba con `table:subscribe` |

### Suscripción a una mesa
```js
socket.emit("table:subscribe", codigoQR, (ack) => { /* { ok: true | false } */ });
```

### Eventos emitidos
| Evento | Payload | Salas |
| --- | --- | --- |
| `orders:changed` | `{ id, mesaId, operationId }` | `authenticated`, `table:<mesaId>` |
| `tables:changed` | `{ mesaId, operationId }` | `authenticated`, `table:<mesaId>` |
| `catalog:changed` | `{ operationId }` | `menu:public`, `authenticated` |
| `stock:depleted` | `{ productoId, nombre, operationId }` | `role:admin`, `role:trabajador` |
| `turnos:changed` | `{ turnoId, operationId }` | `authenticated` |
| `staff:changed` | `{ operationId }` | `role:admin` |
| `roles:changed` | `{ operationId }` | `role:admin` |
| `statistics:changed` | `{ operationId }` | `role:admin` |
| `profile:changed` | datos del perfil | `user:<id>` |
| `session:revoked` | `{}` | `user:<id>` |

Los eventos se emiten **después** de que Prisma confirme la escritura y llevan
`operationId` cuando la solicitud incluía `Idempotency-Key`, para que el cliente
pueda ignorar el eco de su propia operación.

`session:revoked` se envía al cambiar el rol o la contraseña de un usuario, o al
desactivar su cuenta: la sesión afectada debe volver al inicio de sesión.
