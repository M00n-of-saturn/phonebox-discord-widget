import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { FrameDecoder, OP, encodeFrame, type Frame } from '../../src/bridge/discord/FrameCodec.ts';
import { RpcClient, RpcError, findDiscordSocket } from '../../src/bridge/discord/RpcClient.ts';

const CLIENT_ID = '123456789012345678';

interface Message {
  cmd?: string;
  args?: unknown;
  evt?: string;
  nonce?: string;
}

/** Lado del servidor de una conexión: cola de tramas recibidas y envío de tramas. */
class Peer {
  #socket: net.Socket;
  #frames: Frame[] = [];
  #waiting: Array<(frame: Frame) => void> = [];

  constructor(socket: net.Socket) {
    this.#socket = socket;
    const decoder = new FrameDecoder();
    socket.on('data', (chunk: Buffer) => {
      for (const frame of decoder.push(chunk)) {
        const waiter = this.#waiting.shift();
        if (waiter) waiter(frame);
        else this.#frames.push(frame);
      }
    });
    socket.on('error', () => {});
  }

  next(): Promise<Frame> {
    const frame = this.#frames.shift();
    if (frame) return Promise.resolve(frame);
    return new Promise((resolve) => this.#waiting.push(resolve));
  }

  async nextMessage(): Promise<Message> {
    return (await this.next()).payload as Message;
  }

  send(op: number, payload: unknown): void {
    this.#socket.write(encodeFrame(op, payload));
  }

  sendRaw(bytes: Buffer): void {
    this.#socket.write(bytes);
  }

  ready(): void {
    this.send(OP.FRAME, { cmd: 'DISPATCH', evt: 'READY', data: { v: 1 } });
  }

  get closed(): Promise<void> {
    return new Promise((resolve) => this.#socket.once('close', () => resolve()));
  }
}

async function startServer(t: TestContext): Promise<{ path: string; accept: () => Promise<Peer> }> {
  const dir = mkdtempSync(join(tmpdir(), 'rpc-test-'));
  const path = join(dir, 'discord-ipc-0');
  const peers: Peer[] = [];
  const waiting: Array<(peer: Peer) => void> = [];
  const sockets: net.Socket[] = [];
  const server = net.createServer((socket) => {
    sockets.push(socket);
    const peer = new Peer(socket);
    const waiter = waiting.shift();
    if (waiter) waiter(peer);
    else peers.push(peer);
  });
  await new Promise<void>((resolve) => server.listen(path, resolve));
  t.after(() => {
    for (const socket of sockets) socket.destroy();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    path,
    accept: () => {
      const peer = peers.shift();
      if (peer) return Promise.resolve(peer);
      return new Promise((resolve) => waiting.push(resolve));
    },
  };
}

/** Conecta un cliente y completa el saludo. */
async function connected(t: TestContext): Promise<{ client: RpcClient; peer: Peer }> {
  const server = await startServer(t);
  const client = new RpcClient(server.path, CLIENT_ID);
  t.after(() => client.close());
  const connecting = client.connect();
  const peer = await server.accept();
  await peer.next();
  peer.ready();
  await connecting;
  return { client, peer };
}

function closeReason(client: RpcClient): Promise<string> {
  return new Promise((resolve) => client.onClose(resolve));
}

test('connect envía HANDSHAKE y resuelve tras READY', async (t) => {
  const server = await startServer(t);
  const client = new RpcClient(server.path, CLIENT_ID);
  t.after(() => client.close());
  let resolved = false;
  const connecting = client.connect().then(() => {
    resolved = true;
  });
  const peer = await server.accept();
  const handshake = await peer.next();
  assert.deepEqual(handshake, { op: OP.HANDSHAKE, payload: { v: 1, client_id: CLIENT_ID } });
  assert.equal(resolved, false);
  peer.ready();
  await connecting;
  assert.equal(resolved, true);
});

test('connect rechaza si el socket no existe, sin terminar el proceso', async () => {
  const client = new RpcClient(join(tmpdir(), 'no-existe-rpc-test', 'discord-ipc-0'), CLIENT_ID);
  await assert.rejects(client.connect(), RpcError);
});

test('connect rechaza si Discord cierra antes de READY', async (t) => {
  const server = await startServer(t);
  const client = new RpcClient(server.path, CLIENT_ID);
  const connecting = client.connect();
  const peer = await server.accept();
  await peer.next();
  peer.send(OP.CLOSE, { code: 4000, message: 'centinela-mensaje' });
  await assert.rejects(
    connecting,
    (error: unknown) => error instanceof RpcError && error.code === 4000 && !error.message.includes('centinela'),
  );
});

test('connect rechaza si READY no llega dentro del plazo', async (t) => {
  const server = await startServer(t);
  const client = new RpcClient(server.path, CLIENT_ID, { connectTimeoutMs: 40 });
  const connecting = client.connect();
  const peer = await server.accept();
  await assert.rejects(connecting, RpcError);
  await peer.closed;
});

test('request resuelve con data de la respuesta con el mismo nonce', async (t) => {
  const { client, peer } = await connected(t);
  const first = client.request('GET_VOICE_SETTINGS');
  const second = client.request('SUBSCRIBE', { channel_id: '1' }, 'SPEAKING_START');
  const a = await peer.nextMessage();
  const b = await peer.nextMessage();
  assert.equal(a.cmd, 'GET_VOICE_SETTINGS');
  assert.deepEqual(a.args, {});
  assert.deepEqual({ cmd: b.cmd, args: b.args, evt: b.evt }, { cmd: 'SUBSCRIBE', args: { channel_id: '1' }, evt: 'SPEAKING_START' });
  assert.ok(a.nonce && b.nonce && a.nonce !== b.nonce);
  // Respuestas en orden inverso: cada una llega a su petición.
  peer.send(OP.FRAME, { cmd: 'SUBSCRIBE', nonce: b.nonce, data: { evt: 'SPEAKING_START' } });
  peer.send(OP.FRAME, { cmd: 'GET_VOICE_SETTINGS', nonce: a.nonce, data: { mute: true } });
  assert.deepEqual(await first, { mute: true });
  assert.deepEqual(await second, { evt: 'SPEAKING_START' });
});

test('una respuesta ERROR rechaza con RpcError y su código, sin el texto de Discord', async (t) => {
  const { client, peer } = await connected(t);
  const request = client.request('AUTHENTICATE', { access_token: 'centinela-token' });
  const message = await peer.nextMessage();
  peer.send(OP.FRAME, {
    cmd: 'AUTHENTICATE',
    evt: 'ERROR',
    nonce: message.nonce,
    data: { code: 4009, message: 'centinela-detalle' },
  });
  await assert.rejects(
    request,
    (error: unknown) => error instanceof RpcError && error.code === 4009 && !error.message.includes('centinela'),
  );
});

test('sin respuesta, request rechaza al vencer el plazo', async (t) => {
  const { client, peer } = await connected(t);
  const request = client.request('GET_VOICE_SETTINGS', {}, undefined, 40);
  const message = await peer.nextMessage();
  await assert.rejects(request, (error: unknown) => error instanceof RpcError && error.code === null);
  // Una respuesta tardía se ignora sin romper nada.
  peer.send(OP.FRAME, { cmd: 'GET_VOICE_SETTINGS', nonce: message.nonce, data: {} });
  const again = client.request('GET_VOICE_SETTINGS');
  const second = await peer.nextMessage();
  peer.send(OP.FRAME, { cmd: 'GET_VOICE_SETTINGS', nonce: second.nonce, data: { mute: false } });
  assert.deepEqual(await again, { mute: false });
});

test('un DISPATCH sin nonce llega a onEvent', async (t) => {
  const { client, peer } = await connected(t);
  const received = new Promise<[string, unknown]>((resolve) => client.onEvent((evt, data) => resolve([evt, data])));
  peer.send(OP.FRAME, { cmd: 'DISPATCH', evt: 'SPEAKING_START', data: { user_id: '42' } });
  assert.deepEqual(await received, ['SPEAKING_START', { user_id: '42' }]);
});

test('PING recibe PONG con el mismo cuerpo', async (t) => {
  const { peer } = await connected(t);
  peer.send(OP.PING, { marca: 7 });
  assert.deepEqual(await peer.next(), { op: OP.PONG, payload: { marca: 7 } });
});

test('CLOSE del servidor dispara onClose y rechaza las peticiones pendientes', async (t) => {
  const { client, peer } = await connected(t);
  const reason = closeReason(client);
  const pending = client.request('GET_VOICE_SETTINGS');
  await peer.nextMessage();
  peer.send(OP.CLOSE, { code: 1000, message: 'centinela' });
  await assert.rejects(pending, RpcError);
  assert.equal(typeof (await reason), 'string');
  assert.ok(!(await reason).includes('centinela'));
  await assert.rejects(client.request('GET_VOICE_SETTINGS'), RpcError);
});

test('que el servidor corte la conexión dispara onClose una sola vez', async (t) => {
  const server = await startServer(t);
  const client = new RpcClient(server.path, CLIENT_ID);
  const connecting = client.connect();
  const peer = await server.accept();
  await peer.next();
  peer.ready();
  await connecting;
  let calls = 0;
  const closed = new Promise<void>((resolve) =>
    client.onClose(() => {
      calls++;
      resolve();
    }),
  );
  const pending = client.request('GET_VOICE_SETTINGS');
  await peer.nextMessage();
  peer.send(OP.CLOSE, { code: 1000 });
  await closed;
  await assert.rejects(pending, RpcError);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(calls, 1);
});

test('una trama inválida cierra la conexión y dispara onClose', async (t) => {
  const { client, peer } = await connected(t);
  const reason = closeReason(client);
  const pending = client.request('GET_VOICE_SETTINGS');
  await peer.nextMessage();
  const header = Buffer.alloc(8);
  header.writeInt32LE(OP.FRAME, 0);
  header.writeInt32LE(-5, 4);
  const closed = peer.closed;
  peer.sendRaw(header);
  assert.equal(await reason, 'trama-invalida');
  await assert.rejects(pending, RpcError);
  await closed;
});

test('un cuerpo JSON que no es un objeto se trata como trama inválida', async (t) => {
  const { client, peer } = await connected(t);
  const reason = closeReason(client);
  peer.send(OP.FRAME, 5);
  assert.equal(await reason, 'trama-invalida');
});

test('close local rechaza lo pendiente y no dispara onClose', async (t) => {
  const { client, peer } = await connected(t);
  let calls = 0;
  client.onClose(() => calls++);
  const pending = client.request('GET_VOICE_SETTINGS');
  await peer.nextMessage();
  const closed = peer.closed;
  client.close();
  await assert.rejects(pending, RpcError);
  await closed;
  assert.equal(calls, 0);
});

test('findDiscordSocket prefiere discord-ipc-0 en XDG_RUNTIME_DIR', () => {
  const env = { XDG_RUNTIME_DIR: '/run/user/1000' };
  assert.equal(findDiscordSocket(env, () => true), '/run/user/1000/discord-ipc-0');
});

test('findDiscordSocket prueba los índices 0 a 9 en orden', () => {
  const env = { XDG_RUNTIME_DIR: '/run/user/1000' };
  const asked: string[] = [];
  const found = findDiscordSocket(env, (path) => {
    asked.push(path);
    return path.endsWith('discord-ipc-3');
  });
  assert.equal(found, '/run/user/1000/discord-ipc-3');
  assert.deepEqual(asked, [0, 1, 2, 3].map((i) => `/run/user/1000/discord-ipc-${i}`));
});

test('findDiscordSocket busca después en la carpeta del Flatpak oficial', () => {
  const env = { XDG_RUNTIME_DIR: '/run/user/1000' };
  const flatpak = '/run/user/1000/app/com.discordapp.Discord/discord-ipc-0';
  assert.equal(findDiscordSocket(env, (path) => path === flatpak), flatpak);
});

test('findDiscordSocket devuelve null si no hay ninguno, tras 20 intentos y sin mirar /tmp', () => {
  const asked: string[] = [];
  const found = findDiscordSocket({ XDG_RUNTIME_DIR: '/run/user/1000' }, (path) => {
    asked.push(path);
    return false;
  });
  assert.equal(found, null);
  assert.equal(asked.length, 20);
  assert.ok(asked.every((path) => path.startsWith('/run/user/1000/')));
});

test('findDiscordSocket devuelve null sin XDG_RUNTIME_DIR', () => {
  assert.equal(findDiscordSocket({}, () => true), null);
});
