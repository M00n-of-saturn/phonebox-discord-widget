import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { AlreadyRunningError, ControlServer, controlSocketPath, sendCommand } from '../../src/bridge/control/ControlServer.ts';
import type { Command } from '../../src/shared/models/Command.ts';

function tempSocket(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'pdw-ctl-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'control.sock');
}

async function startServer(t: TestContext, path: string, onCommand: (command: Command) => Promise<void> = async () => {}) {
  const received: Command[] = [];
  const server = new ControlServer(path, async (command) => {
    received.push(command);
    await onCommand(command);
  });
  await server.listen();
  t.after(() => server.close());
  return { server, received };
}

/** Envía bytes crudos y devuelve lo que el servidor contestó antes de cerrar. */
function rawExchange(path: string, payload: string | Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(path);
    let reply = '';
    socket.on('connect', () => socket.write(payload));
    socket.on('data', (chunk: Buffer) => (reply += chunk.toString('utf8')));
    socket.on('close', () => resolve(reply));
    socket.on('error', (error: NodeJS.ErrnoException) => {
      // El servidor puede cerrar mientras aún se escribe; lo que importa es la respuesta.
      if (error.code === 'EPIPE' || error.code === 'ECONNRESET') return;
      reject(error);
    });
  });
}

test('sendCommand entrega la orden y resuelve', async (t) => {
  const path = tempSocket(t);
  const { received } = await startServer(t, path);
  await sendCommand(path, 'colgar');
  assert.deepEqual(received, ['colgar']);
});

test('el archivo del socket tiene modo 0600 y no cambia el umask del proceso', async (t) => {
  const path = tempSocket(t);
  const before = process.umask();
  await startServer(t, path);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(process.umask(), before);
});

test('una orden desconocida recibe error y no llega a onCommand', async (t) => {
  const path = tempSocket(t);
  const { received } = await startServer(t, path);
  assert.equal(await rawExchange(path, 'borrar-todo\n'), 'error\n');
  assert.deepEqual(received, []);
});

test('una línea larga sin salto recibe error y se cierra', async (t) => {
  const path = tempSocket(t);
  const { received } = await startServer(t, path);
  assert.equal(await rawExchange(path, 'a'.repeat(1000)), 'error\n');
  assert.deepEqual(received, []);
});

test('si onCommand rechaza, responde error y sendCommand rechaza', async (t) => {
  const path = tempSocket(t);
  await startServer(t, path, async () => {
    throw new Error('sin conexión con Discord');
  });
  await assert.rejects(sendCommand(path, 'alternar-silencio'));
});

test('un cliente que no envía nada se desconecta a los 2 s y el servidor sigue atendiendo', async (t) => {
  const path = tempSocket(t);
  const { received } = await startServer(t, path);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const idle = net.createConnection(path);
  const closed = new Promise<void>((resolve) => idle.on('close', () => resolve()));
  await new Promise<void>((resolve) => idle.on('connect', () => resolve()));
  // Espera a que el servidor registre la conexión antes de avanzar el reloj.
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(2000);
  await closed;
  t.mock.timers.reset();
  await sendCommand(path, 'colgar');
  assert.deepEqual(received, ['colgar']);
});

test('un socket viejo sin nadie escuchando se reemplaza', async (t) => {
  const path = tempSocket(t);
  // Un proceso que deja el socket creado y muere sin borrarlo.
  const script = `require('node:net').createServer().listen(${JSON.stringify(path)}, () => process.kill(process.pid, 'SIGKILL'))`;
  spawnSync(process.execPath, ['-e', script]);
  assert.ok(existsSync(path), 'el proceso de prueba no dejó el socket');
  const { received } = await startServer(t, path);
  await sendCommand(path, 'colgar');
  assert.deepEqual(received, ['colgar']);
});

test('un archivo común en la ruta no se borra', async (t) => {
  const path = tempSocket(t);
  writeFileSync(path, 'no soy un socket');
  const server = new ControlServer(path, async () => {});
  await assert.rejects(server.listen());
  assert.ok(existsSync(path));
});

test('con un bridge vivo, un segundo listen lanza AlreadyRunningError y el primero sigue', async (t) => {
  const path = tempSocket(t);
  const { received } = await startServer(t, path);
  const second = new ControlServer(path, async () => {});
  await assert.rejects(second.listen(), AlreadyRunningError);
  await sendCommand(path, 'colgar');
  assert.deepEqual(received, ['colgar']);
});

test('close borra el archivo del socket', async (t) => {
  const path = tempSocket(t);
  const server = new ControlServer(path, async () => {});
  await server.listen();
  await server.close();
  assert.ok(!existsSync(path));
});

test('sendCommand a una ruta inexistente rechaza en menos de 2 s', async (t) => {
  const path = tempSocket(t);
  const started = Date.now();
  await assert.rejects(sendCommand(path, 'colgar'));
  assert.ok(Date.now() - started < 2000);
});

test('sendCommand rechaza si el servidor no contesta a tiempo', async (t) => {
  const path = tempSocket(t);
  const mute = net.createServer(() => {});
  await new Promise<void>((resolve) => mute.listen(path, resolve));
  t.after(() => mute.close());
  const started = Date.now();
  await assert.rejects(sendCommand(path, 'colgar', 200));
  assert.ok(Date.now() - started < 2000);
});

test('controlSocketPath', () => {
  assert.throws(() => controlSocketPath({}));
  assert.equal(controlSocketPath({ XDG_RUNTIME_DIR: '/run/user/1000' }), '/run/user/1000/phonebox-discord-widget.sock');
});
