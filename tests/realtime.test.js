import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { io } from "socket.io-client";
import {
  startTestServer,
  limpiarRegistrosIdempotencia,
  obtenerAdminActivo,
} from "./helpers/testContext.js";

// Objetivo de latencia de la Spec 002: un cambio debe reflejarse en las demás
// vistas en 300 ms.
const LATENCIA_MAXIMA_MS = 300;
const ESPERA_EVENTO_MS = 3000;

let servidor;
let sesionAdmin;
const sockets = [];
const clavesIdempotencia = [];
const categoriasCreadas = [];
const usuariosCreados = [];

/** Conecta un cliente Socket.IO y resuelve cuando el handshake termina. */
const conectar = (token) =>
  new Promise((resolve, reject) => {
    const socket = io(servidor.baseUrl, {
      path: "/socket.io",
      transports: ["websocket"],
      auth: { token },
      reconnection: false,
    });
    sockets.push(socket);

    const temporizador = setTimeout(
      () => reject(new Error("el handshake no terminó a tiempo")),
      ESPERA_EVENTO_MS,
    );

    socket.on("connect", () => {
      clearTimeout(temporizador);
      resolve(socket);
    });
    socket.on("connect_error", (error) => {
      clearTimeout(temporizador);
      reject(error);
    });
  });

/** Espera un evento concreto y devuelve cuánto tardó en llegar. */
const esperarEvento = (socket, evento) =>
  new Promise((resolve, reject) => {
    const inicio = performance.now();
    const temporizador = setTimeout(
      () => reject(new Error(`no llegó el evento "${evento}"`)),
      ESPERA_EVENTO_MS,
    );

    socket.once(evento, (payload) => {
      clearTimeout(temporizador);
      resolve({ payload, latenciaMs: performance.now() - inicio });
    });
  });

/** Comprueba que un evento NO llega en la ventana indicada. */
const confirmarSilencio = (socket, evento, ventanaMs = 700) =>
  new Promise((resolve, reject) => {
    const alLlegar = (payload) => {
      clearTimeout(temporizador);
      reject(
        new Error(`el evento "${evento}" no debía llegar a este cliente: ${JSON.stringify(payload)}`),
      );
    };
    const temporizador = setTimeout(() => {
      socket.off(evento, alLlegar);
      resolve();
    }, ventanaMs);
    socket.once(evento, alLlegar);
  });

const PASSWORD_TRABAJADOR = "Trabajador123!";

/**
 * Crea un usuario con rol trabajador para poder comprobar el aislamiento por
 * rol sin depender de que la semilla traiga uno. Devuelve null si no se pudo,
 * para omitir la prueba en lugar de darla por buena.
 */
const crearSesionTrabajador = async (baseUrl, tokenAdmin) => {
  const email = `trabajador.rt.${Date.now()}@otrocafe.test`;

  const respuesta = await fetch(`${baseUrl}/api/usuarios`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokenAdmin}`,
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({
      nombre: "Trabajador RT",
      email,
      password: PASSWORD_TRABAJADOR,
      rol: "trabajador",
    }),
  });

  if (!respuesta.ok) {
    return { sesion: null, motivo: `no se pudo crear el usuario (${respuesta.status}): ${await respuesta.text()}` };
  }

  const cuerpo = await respuesta.json();
  const id = cuerpo?.data?.id ?? cuerpo?.id;
  if (id) usuariosCreados.push(id);

  // Se entra con la contraseña recién asignada, no con la de la semilla.
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identificador: email, password: PASSWORD_TRABAJADOR }),
  });
  if (!login.ok) {
    return { sesion: null, motivo: `el usuario se creó pero no pudo iniciar sesión (${login.status})` };
  }
  const sesion = await login.json();
  if (!sesion?.token) {
    return { sesion: null, motivo: "el login no devolvió token" };
  }

  // El rol viaja como cadena en la respuesta de login.
  const rol = String(sesion.user?.rol ?? sesion.user?.role?.nombre ?? "").toLowerCase();
  if (rol === "admin") {
    return { sesion: null, motivo: "el usuario creado resultó tener rol admin" };
  }

  return { sesion, motivo: null };
};

const peticion = (ruta, { method = "GET", token, body } = {}) =>
  fetch(`${servidor.baseUrl}${ruta}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Idempotency-Key": (() => {
        const clave = crypto.randomUUID();
        clavesIdempotencia.push(clave);
        return clave;
      })(),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

before(async () => {
  servidor = await startTestServer();
  sesionAdmin = await obtenerAdminActivo(servidor.baseUrl);
});

after(async () => {
  for (const socket of sockets) socket.disconnect();
  for (const id of categoriasCreadas) {
    await fetch(`${servidor.baseUrl}/api/categorias/${id}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${sesionAdmin?.token}`,
        "Idempotency-Key": crypto.randomUUID(),
      },
    }).catch(() => {});
  }
  for (const id of usuariosCreados) {
    await fetch(`${servidor.baseUrl}/api/usuarios/${id}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${sesionAdmin?.token}`,
        "Idempotency-Key": crypto.randomUUID(),
      },
    }).catch(() => {});
  }
  await limpiarRegistrosIdempotencia(clavesIdempotencia);
  await servidor.close();
});

describe("conexiones Socket.IO", () => {
  it("rechaza el handshake con un token inválido", async () => {
    await assert.rejects(
      () => conectar("token-invalido"),
      (error) => {
        assert.equal(error.message, "unauthorized");
        return true;
      },
      "un token inválido no debe obtener conexión autorizada",
    );
  });

  it("acepta como anónimo una conexión sin token", async () => {
    const socket = await conectar(undefined);
    assert.equal(socket.connected, true);
  });
});

describe("autorización de eventos", () => {
  it("un cliente anónimo no recibe eventos solo para personal", async () => {
    const anonimo = await conectar(undefined);

    const silencios = await Promise.all([
      confirmarSilencio(anonimo, "staff:changed"),
      confirmarSilencio(anonimo, "orders:changed"),
      confirmarSilencio(anonimo, "statistics:changed"),
      confirmarSilencio(anonimo, "turnos:changed"),
    ]);

    assert.equal(silencios.length, 4);
  });

  it("una sesión con rol no admin no recibe eventos de administración", async (t) => {
    if (!sesionAdmin?.token) {
      t.skip("no hay un administrador activo en la semilla para iniciar sesión");
      return;
    }

    const { sesion: sesionTrabajador, motivo } = await crearSesionTrabajador(
      servidor.baseUrl,
      sesionAdmin.token,
    );
    if (!sesionTrabajador?.token) {
      t.skip(`no se pudo preparar una sesión con rol trabajador: ${motivo}`);
      return;
    }

    const trabajador = await conectar(sesionTrabajador.token);

    assert.equal(trabajador.connected, true, "el trabajador sí debe poder conectarse");

    await Promise.all([
      confirmarSilencio(trabajador, "staff:changed"),
      confirmarSilencio(trabajador, "statistics:changed"),
      confirmarSilencio(trabajador, "roles:changed"),
    ]);
  });
});

describe("propagación en tiempo real (RF-1)", () => {
  it("un cambio de catálogo llega a otra sesión autorizada dentro de 300 ms", async (t) => {
    if (!sesionAdmin?.token) {
      t.skip("no hay un administrador activo en la semilla para iniciar sesión");
      return;
    }

    const observador = await conectar(sesionAdmin.token);
    const espera = esperarEvento(observador, "catalog:changed");

    const nombre = `Categoría RT ${Date.now()}`;
    const respuesta = await peticion("/api/categorias", {
      method: "POST",
      token: sesionAdmin.token,
      body: { nombre },
    });

    assert.equal(respuesta.status, 201, `la creación debe funcionar: ${await respuesta.clone().text()}`);
    const creada = await respuesta.json();
    const id = creada.data?.id ?? creada.id;
    if (id) categoriasCreadas.push(id);

    const { payload, latenciaMs } = await espera;

    assert.ok(
      latenciaMs <= LATENCIA_MAXIMA_MS,
      `el evento tardó ${latenciaMs.toFixed(1)} ms, por encima del objetivo de ${LATENCIA_MAXIMA_MS} ms`,
    );
    assert.ok(payload.operationId, "el evento debe identificar la operación que lo originó");
  });

  it("el cliente anónimo recibe el cambio de catálogo por ser el menú público", async (t) => {
    if (!sesionAdmin?.token) {
      t.skip("no hay un administrador activo en la semilla para iniciar sesión");
      return;
    }

    const menuPublico = await conectar(undefined);
    const espera = esperarEvento(menuPublico, "catalog:changed");

    const nombre = `Categoría menú ${Date.now()}`;
    const respuesta = await peticion("/api/categorias", {
      method: "POST",
      token: sesionAdmin.token,
      body: { nombre },
    });
    const creada = await respuesta.json();
    const id = creada.data?.id ?? creada.id;
    if (id) categoriasCreadas.push(id);

    await espera;
  });
});
