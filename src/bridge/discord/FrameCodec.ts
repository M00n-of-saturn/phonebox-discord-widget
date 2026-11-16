// Tramas de la conexión local de Discord: cabecera de 8 bytes (operación y longitud del cuerpo,
// enteros de 32 bits little-endian) seguida de un cuerpo JSON en UTF-8.

export const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 } as const;
export const MAX_FRAME_BYTES = 4 * 1024 * 1024;

const HEADER_BYTES = 8;

export interface Frame {
  op: number;
  payload: unknown;
}

/** Trama mal formada. El mensaje nunca incluye contenido de la trama. */
export class FrameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FrameError';
  }
}

export function encodeFrame(op: number, payload: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  if (body.length > MAX_FRAME_BYTES) throw new FrameError('trama saliente demasiado grande');
  const header = Buffer.alloc(HEADER_BYTES);
  header.writeInt32LE(op, 0);
  header.writeInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

/** Acumula trozos del socket y entrega las tramas completas. Tras un FrameError no debe reutilizarse. */
export class FrameDecoder {
  #buffer: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): Frame[] {
    this.#buffer = this.#buffer.length === 0 ? chunk : Buffer.concat([this.#buffer, chunk]);
    const frames: Frame[] = [];
    while (this.#buffer.length >= HEADER_BYTES) {
      const op = this.#buffer.readInt32LE(0);
      const length = this.#buffer.readInt32LE(4);
      if (length < 0 || length > MAX_FRAME_BYTES) throw new FrameError('trama con tamaño inválido');
      const end = HEADER_BYTES + length;
      if (this.#buffer.length < end) break;
      const body = this.#buffer.subarray(HEADER_BYTES, end).toString('utf8');
      this.#buffer = this.#buffer.subarray(end);
      let payload: unknown;
      try {
        payload = JSON.parse(body);
      } catch {
        throw new FrameError('trama que no es JSON válido');
      }
      frames.push({ op, payload });
    }
    return frames;
  }
}
