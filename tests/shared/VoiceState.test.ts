import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_NAME, parseVoiceState, sanitizeName } from '../../src/shared/models/VoiceState.ts';

function validState(): Record<string, unknown> {
  return {
    v: 1,
    discord: 'conectado',
    canal: { nombre: 'General', total: 5 },
    yo: { silenciado: false, ensordecido: false },
    miembros: [{ clave: 'a1b2c3d4', nombre: 'Ana', habla: true, silenciado: false, ensordecido: false }],
  };
}

function member(index: number): Record<string, unknown> {
  return {
    clave: index.toString(16).padStart(8, '0'),
    nombre: `Persona ${index}`,
    habla: false,
    silenciado: false,
    ensordecido: false,
  };
}

test('sanitizeName limpia espacios y caracteres invisibles', () => {
  assert.equal(sanitizeName('  Ana  '), 'Ana');
  assert.equal(sanitizeName('A\u0000n​a\n'), 'Ana');
  assert.equal(sanitizeName('🎧'), '🎧');
});

test('sanitizeName corta por puntos de código a 32', () => {
  assert.equal(sanitizeName('x'.repeat(40)).length, MAX_NAME);
  assert.equal(Array.from(sanitizeName('🎧'.repeat(40))).length, MAX_NAME);
});

test('sanitizeName devuelve "?" si no queda nada utilizable', () => {
  for (const raw of ['', '   ', '\u0000​', 42, null, undefined, {}, ['Ana']]) {
    assert.equal(sanitizeName(raw), '?');
  }
});

test('sanitizeName no altera texto con HTML: el escape lo hace textContent', () => {
  const html = '<img src=x onerror=alert(1)>';
  assert.equal(sanitizeName(html), html);
});

test('parseVoiceState acepta el ejemplo del diseño', () => {
  assert.deepEqual(parseVoiceState(validState()), validState());
});

test('parseVoiceState acepta canal nulo y lista vacía', () => {
  const state = { ...validState(), canal: null, miembros: [] };
  assert.deepEqual(parseVoiceState(state), state);
});

test('parseVoiceState acepta 12 miembros y rechaza 13', () => {
  const twelve = { ...validState(), miembros: Array.from({ length: 12 }, (_, i) => member(i)) };
  assert.notEqual(parseVoiceState(twelve), null);
  const thirteen = { ...validState(), miembros: Array.from({ length: 13 }, (_, i) => member(i)) };
  assert.equal(parseVoiceState(thirteen), null);
});

test('parseVoiceState descarta propiedades desconocidas', () => {
  const state = validState();
  const parsed = parseVoiceState({
    ...state,
    extra: 'x',
    canal: { nombre: 'General', total: 5, id: '123' },
    miembros: [{ ...member(1), id: '999', avatar: 'https://example.invalid/a.png' }],
  });
  assert.deepEqual(parsed, { ...state, miembros: [member(1)] });
});

test('parseVoiceState rechaza datos inválidos', () => {
  const base = validState();
  const invalid: Array<[string, unknown]> = [
    ['null', null],
    ['cadena', 'hola'],
    ['arreglo', []],
    ['versión distinta', { ...base, v: 2 }],
    ['estado desconocido', { ...base, discord: 'otro' }],
    ['sin yo', { ...base, yo: undefined }],
    ['yo con tipo erróneo', { ...base, yo: { silenciado: 'no', ensordecido: false } }],
    ['miembros no es arreglo', { ...base, miembros: {} }],
    ['miembro sin clave', { ...base, miembros: [{ ...member(1), clave: undefined }] }],
    ['clave con formato inválido', { ...base, miembros: [{ ...member(1), clave: 'XYZ' }] }],
    ['nombre de 33 caracteres', { ...base, miembros: [{ ...member(1), nombre: 'x'.repeat(33) }] }],
    ['nombre vacío', { ...base, miembros: [{ ...member(1), nombre: '' }] }],
    ['nombre con carácter de control', { ...base, miembros: [{ ...member(1), nombre: 'A\u0000na' }] }],
    ['habla no booleano', { ...base, miembros: [{ ...member(1), habla: 'si' }] }],
    ['miembro nulo', { ...base, miembros: [null] }],
    ['total negativo', { ...base, canal: { nombre: 'General', total: -1 } }],
    ['total no entero', { ...base, canal: { nombre: 'General', total: 1.5 } }],
    ['canal sin nombre', { ...base, canal: { total: 1 } }],
    ['canal indefinido', { ...base, canal: undefined }],
  ];
  for (const [label, raw] of invalid) assert.equal(parseVoiceState(raw), null, label);
});
