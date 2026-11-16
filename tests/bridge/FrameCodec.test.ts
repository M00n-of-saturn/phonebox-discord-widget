import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FrameDecoder, FrameError, MAX_FRAME_BYTES, OP, encodeFrame } from '../../src/bridge/discord/FrameCodec.ts';

function header(op: number, length: number): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeInt32LE(op, 0);
  buffer.writeInt32LE(length, 4);
  return buffer;
}

test('codifica con cabecera de 8 bytes little-endian', () => {
  const encoded = encodeFrame(OP.FRAME, { cmd: 'X' });
  const body = Buffer.from('{"cmd":"X"}', 'utf8');
  assert.equal(encoded.readInt32LE(0), 1);
  assert.equal(encoded.readInt32LE(4), body.length);
  assert.deepEqual(encoded.subarray(8), body);
});

test('ida y vuelta de una trama', () => {
  const frames = new FrameDecoder().push(encodeFrame(OP.FRAME, { cmd: 'X' }));
  assert.deepEqual(frames, [{ op: 1, payload: { cmd: 'X' } }]);
});

test('una trama entregada byte a byte produce exactamente una', () => {
  const decoder = new FrameDecoder();
  const encoded = encodeFrame(OP.FRAME, { cmd: 'X', args: { a: 1 } });
  const frames: unknown[] = [];
  for (const byte of encoded) frames.push(...decoder.push(Buffer.from([byte])));
  assert.deepEqual(frames, [{ op: 1, payload: { cmd: 'X', args: { a: 1 } } }]);
});

test('dos tramas en un solo trozo producen dos', () => {
  const chunk = Buffer.concat([encodeFrame(OP.FRAME, { n: 1 }), encodeFrame(OP.PING, { n: 2 })]);
  assert.deepEqual(new FrameDecoder().push(chunk), [
    { op: 1, payload: { n: 1 } },
    { op: 3, payload: { n: 2 } },
  ]);
});

test('una trama y media deja la mitad pendiente para el siguiente trozo', () => {
  const decoder = new FrameDecoder();
  const second = encodeFrame(OP.FRAME, { n: 2 });
  const first = decoder.push(Buffer.concat([encodeFrame(OP.FRAME, { n: 1 }), second.subarray(0, 5)]));
  assert.deepEqual(first, [{ op: 1, payload: { n: 1 } }]);
  assert.deepEqual(decoder.push(second.subarray(5)), [{ op: 1, payload: { n: 2 } }]);
});

test('longitud negativa lanza FrameError', () => {
  assert.throws(() => new FrameDecoder().push(header(OP.FRAME, -1)), FrameError);
});

test('longitud mayor que el máximo lanza FrameError sin esperar el cuerpo', () => {
  assert.throws(() => new FrameDecoder().push(header(OP.FRAME, MAX_FRAME_BYTES + 1)), FrameError);
});

test('una longitud igual al máximo se acepta y queda a la espera del cuerpo', () => {
  assert.deepEqual(new FrameDecoder().push(header(OP.FRAME, MAX_FRAME_BYTES)), []);
});

test('cuerpo que no es JSON lanza FrameError sin incluir el contenido', () => {
  const body = Buffer.from('centinela-no-json', 'utf8');
  assert.throws(
    () => new FrameDecoder().push(Buffer.concat([header(OP.FRAME, body.length), body])),
    (error: unknown) => error instanceof FrameError && !error.message.includes('centinela'),
  );
});

test('texto con ñ y emoji conserva los bytes', () => {
  const payload = { nombre: 'Íñigo 🎧 año' };
  const encoded = encodeFrame(OP.FRAME, payload);
  assert.equal(encoded.readInt32LE(4), Buffer.byteLength(JSON.stringify(payload), 'utf8'));
  // Partido en medio de un carácter de varios bytes.
  const decoder = new FrameDecoder();
  const cut = encoded.indexOf(Buffer.from('🎧', 'utf8')) + 2;
  const frames = [...decoder.push(encoded.subarray(0, cut)), ...decoder.push(encoded.subarray(cut))];
  assert.deepEqual(frames, [{ op: 1, payload }]);
});

test('encodeFrame rechaza un cuerpo mayor que el máximo', () => {
  assert.throws(() => encodeFrame(OP.FRAME, { x: 'a'.repeat(MAX_FRAME_BYTES) }), FrameError);
});
