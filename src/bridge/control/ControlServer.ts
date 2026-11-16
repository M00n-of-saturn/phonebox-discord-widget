// Socket Unix por el que `ctl` le pide órdenes al bridge. Protocolo: el cliente envía una línea con una
// orden de la lista fija; el servidor responde `ok\n` o `error\n` y cierra. Nada más se acepta.

import { chmodSync, lstatSync, rmSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { parseCommand, type Command } from '../../shared/models/Command.ts';

const SOCKET_NAME = 'phonebox-discord-widget.sock';
const MAX_LINE_BYTES = 64;
const IDLE_TIMEOUT_MS = 2000;
const PROBE_TIMEOUT_MS = 1000;
const DEFAULT_SEND_TIMEOUT_MS = 2000;

export class AlreadyRunningError extends Error {
  constructor() {
    super('ya hay un bridge escuchando en el socket de control');
    this.name = 'AlreadyRunningError';
  }
}

export function controlSocketPath(env: NodeJS.ProcessEnv): string {
  const runtime = env.XDG_RUNTIME_DIR;
  if (!runtime) throw new Error('falta XDG_RUNTIME_DIR; el socket de control solo se crea en la carpeta privada del usuario');
  return join(runtime, SOCKET_NAME);
}

/** Resuelve true si alguien acepta conexiones en la ruta. */
function someoneListens(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(path);
    const done = (listening: boolean) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(listening);
    };
    // Si no contesta ni rechaza, se asume vivo: es más seguro no borrar el socket de otro.
    const timer = setTimeout(() => done(true), PROBE_TIMEOUT_MS);
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

export class ControlServer {
  readonly #path: string;
  readonly #onCommand: (command: Command) => Promise<void>;
  #server: net.Server | null = null;
  #sockets = new Set<net.Socket>();

  constructor(socketPath: string, onCommand: (command: Command) => Promise<void>) {
    this.#path = socketPath;
    this.#onCommand = onCommand;
  }

  async listen(): Promise<void> {
    await this.#removeStaleSocket();
    const server = net.createServer((socket) => this.#handle(socket));
    // El socket se crea ya con permisos 0600; el umask del proceso se restaura enseguida.
    const previousUmask = process.umask(0o177);
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', (error: NodeJS.ErrnoException) => reject(error.code === 'EADDRINUSE' ? new AlreadyRunningError() : error));
        server.listen(this.#path, () => resolve());
      });
    } finally {
      process.umask(previousUmask);
    }
    chmodSync(this.#path, 0o600);
    this.#server = server;
  }

  async close(): Promise<void> {
    const server = this.#server;
    this.#server = null;
    if (server === null) return;
    for (const socket of this.#sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(this.#path, { force: true });
  }

  async #removeStaleSocket(): Promise<void> {
    let isSocket: boolean;
    try {
      isSocket = lstatSync(this.#path).isSocket();
    } catch {
      return; // No existe.
    }
    if (!isSocket) throw new Error('la ruta del socket de control existe y no es un socket; no se toca');
    if (await someoneListens(this.#path)) throw new AlreadyRunningError();
    rmSync(this.#path, { force: true });
  }

  #handle(socket: net.Socket): void {
    this.#sockets.add(socket);
    let received = Buffer.alloc(0);
    let answered = false;
    const idle = setTimeout(() => socket.destroy(), IDLE_TIMEOUT_MS);

    const answer = (reply: 'ok\n' | 'error\n') => {
      if (socket.destroyed) return;
      socket.end(reply);
    };

    socket.on('error', () => {});
    socket.on('close', () => {
      clearTimeout(idle);
      this.#sockets.delete(socket);
    });
    socket.on('data', (chunk: Buffer) => {
      if (answered) return;
      // Nunca se guardan más de MAX_LINE_BYTES, llegue lo que llegue.
      received = Buffer.concat([received, chunk.subarray(0, MAX_LINE_BYTES - received.length)]);
      const newline = received.indexOf(0x0a);
      if (newline === -1) {
        if (received.length < MAX_LINE_BYTES) return;
        answered = true;
        clearTimeout(idle);
        answer('error\n');
        return;
      }
      answered = true;
      clearTimeout(idle);
      socket.pause();
      const command = parseCommand(received.subarray(0, newline + 1).toString('utf8'));
      if (command === null) {
        answer('error\n');
        return;
      }
      this.#onCommand(command).then(
        () => answer('ok\n'),
        () => answer('error\n'),
      );
    });
  }
}

/** Envía una orden al bridge. Rechaza si no hay bridge, si la rechaza o si no contesta a tiempo. */
export function sendCommand(socketPath: string, command: Command, timeoutMs = DEFAULT_SEND_TIMEOUT_MS): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let reply = '';
    let settled = false;
    const settle = (error: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error === null) resolve();
      else reject(error);
    };
    const timer = setTimeout(() => settle(new Error('el bridge no respondió a tiempo')), timeoutMs);
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(`${command}\n`));
    socket.on('data', (chunk: string) => {
      reply += chunk;
      if (reply.length > 'error\n'.length) settle(new Error('respuesta inesperada del bridge'));
    });
    socket.on('end', () => settle(reply === 'ok\n' ? null : new Error('el bridge no pudo ejecutar la orden')));
    socket.on('error', () => settle(new Error('no hay un bridge escuchando')));
    socket.on('close', () => settle(new Error('el bridge cerró la conexión sin responder')));
  });
}
