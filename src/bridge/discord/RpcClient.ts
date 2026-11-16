// Cliente de la conexión local de Discord: saludo, peticiones con nonce y eventos.
// Ningún error termina el proceso ni incluye contenido de los mensajes de Discord.

import { randomUUID } from 'node:crypto';
import net from 'node:net';
import { FrameDecoder, FrameError, OP, encodeFrame, type Frame } from './FrameCodec.ts';

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const SOCKETS_PER_FOLDER = 10;

/** Fallo de la conexión o de una petición. `code` es el código de Discord, si lo hubo. */
export class RpcError extends Error {
  code: number | null;

  constructor(message: string, code: number | null = null) {
    super(message);
    this.name = 'RpcError';
    this.code = code;
  }
}

/**
 * Busca el socket de Discord solo dentro de XDG_RUNTIME_DIR (carpeta privada del usuario).
 * No se mira /tmp: ahí otro usuario local podría dejar un socket falso.
 */
export function findDiscordSocket(env: NodeJS.ProcessEnv, exists: (path: string) => boolean): string | null {
  const runtime = env.XDG_RUNTIME_DIR;
  if (!runtime) return null;
  for (const folder of [runtime, `${runtime}/app/com.discordapp.Discord`]) {
    for (let index = 0; index < SOCKETS_PER_FOLDER; index++) {
      const candidate = `${folder}/discord-ipc-${index}`;
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

interface Pending {
  resolve: (data: unknown) => void;
  reject: (error: RpcError) => void;
  timer: NodeJS.Timeout;
}

interface Waiter {
  resolve: () => void;
  reject: (error: RpcError) => void;
  timer: NodeJS.Timeout;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numericCode(value: unknown): number | null {
  return isRecord(value) && typeof value.code === 'number' ? value.code : null;
}

export class RpcClient {
  #socketPath: string;
  #clientId: string;
  #connectTimeoutMs: number;
  #socket: net.Socket | null = null;
  #decoder = new FrameDecoder();
  #pending = new Map<string, Pending>();
  #ready: Waiter | null = null;
  #closed = false;
  #eventHandlers: Array<(evt: string, data: unknown) => void> = [];
  #closeHandlers: Array<(reason: string) => void> = [];

  constructor(socketPath: string, clientId: string, opts: { connectTimeoutMs?: number } = {}) {
    this.#socketPath = socketPath;
    this.#clientId = clientId;
    this.#connectTimeoutMs = opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  }

  /** Resuelve al recibir READY. Solo puede llamarse una vez por instancia. */
  connect(): Promise<void> {
    if (this.#socket || this.#closed) return Promise.reject(new RpcError('la conexión ya se usó'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.#shutdown('sin-saludo', null, true), this.#connectTimeoutMs);
      this.#ready = { resolve, reject, timer };
      const socket = net.createConnection(this.#socketPath);
      this.#socket = socket;
      socket.once('connect', () => this.#send(OP.HANDSHAKE, { v: 1, client_id: this.#clientId }));
      socket.on('data', (chunk: Buffer) => this.#onData(chunk));
      socket.on('error', () => this.#shutdown('error-de-conexion', null, true));
      socket.on('close', () => this.#shutdown('conexion-cerrada', null, true));
    });
  }

  request(cmd: string, args: object = {}, evt?: string, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS): Promise<unknown> {
    if (this.#closed || !this.#socket || this.#ready) {
      return Promise.reject(new RpcError(`sin conexión para ${cmd}`));
    }
    const nonce = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(nonce);
        reject(new RpcError(`sin respuesta a ${cmd}`));
      }, timeoutMs);
      this.#pending.set(nonce, { resolve, reject, timer });
      this.#send(OP.FRAME, { cmd, args, evt, nonce });
    });
  }

  onEvent(handler: (evt: string, data: unknown) => void): void {
    this.#eventHandlers.push(handler);
  }

  /** Avisa cuando la conexión se pierde por una causa ajena. `close()` no dispara este aviso. */
  onClose(handler: (reason: string) => void): void {
    this.#closeHandlers.push(handler);
  }

  close(): void {
    this.#shutdown('cierre-local', null, false);
  }

  #send(op: number, payload: unknown): void {
    if (this.#closed || !this.#socket) return;
    try {
      this.#socket.write(encodeFrame(op, payload));
    } catch (error) {
      if (!(error instanceof FrameError)) throw error;
      this.#shutdown('trama-invalida', null, true);
    }
  }

  #onData(chunk: Buffer): void {
    if (this.#closed) return;
    let frames: Frame[];
    try {
      frames = this.#decoder.push(chunk);
    } catch (error) {
      if (!(error instanceof FrameError)) throw error;
      this.#shutdown('trama-invalida', null, true);
      return;
    }
    for (const frame of frames) {
      if (this.#closed) return;
      this.#dispatch(frame);
    }
  }

  #dispatch(frame: Frame): void {
    if (frame.op === OP.PING) {
      this.#send(OP.PONG, frame.payload);
      return;
    }
    if (frame.op === OP.CLOSE) {
      this.#shutdown('cierre-remoto', numericCode(frame.payload), true);
      return;
    }
    if (frame.op !== OP.FRAME) return;
    const message = frame.payload;
    if (!isRecord(message)) {
      this.#shutdown('trama-invalida', null, true);
      return;
    }
    const evt = typeof message.evt === 'string' ? message.evt : null;
    if (this.#ready) {
      if (message.cmd === 'DISPATCH' && evt === 'READY') {
        const ready = this.#ready;
        this.#ready = null;
        clearTimeout(ready.timer);
        ready.resolve();
      }
      return;
    }
    const nonce = typeof message.nonce === 'string' ? message.nonce : null;
    const waiting = nonce === null ? undefined : this.#pending.get(nonce);
    if (waiting && nonce !== null) {
      this.#pending.delete(nonce);
      clearTimeout(waiting.timer);
      if (evt === 'ERROR') {
        const code = numericCode(message.data);
        waiting.reject(new RpcError(`Discord rechazó la petición (código ${code ?? 'desconocido'})`, code));
      } else {
        waiting.resolve(message.data);
      }
      return;
    }
    if (message.cmd === 'DISPATCH' && evt !== null && nonce === null) {
      for (const handler of this.#eventHandlers) handler(evt, message.data);
    }
  }

  #shutdown(reason: string, code: number | null, notify: boolean): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#socket?.destroy();
    const error = new RpcError(`conexión con Discord cerrada (${reason})`, code);
    const ready = this.#ready;
    this.#ready = null;
    if (ready) {
      clearTimeout(ready.timer);
      ready.reject(error);
    }
    for (const waiting of this.#pending.values()) {
      clearTimeout(waiting.timer);
      waiting.reject(error);
    }
    this.#pending.clear();
    // Si la conexión nunca llegó a READY, el rechazo de connect() ya informa del fallo.
    if (notify && !ready) {
      for (const handler of this.#closeHandlers) handler(reason);
    }
  }
}
