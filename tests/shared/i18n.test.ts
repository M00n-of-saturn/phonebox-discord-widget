import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LANGS, STRINGS, langFromArgs, parseLang } from '../../src/shared/i18n.ts';

test('parseLang acepta exactamente en y es', () => {
  assert.equal(parseLang('es'), 'es');
  assert.equal(parseLang('en'), 'en');
});

test('parseLang usa en para cualquier otro valor', () => {
  for (const raw of ['ES', 'fr', '', undefined, 42]) assert.equal(parseLang(raw), 'en', String(raw));
});

test('langFromArgs lee "--lang es" y "--lang=es"', () => {
  assert.equal(langFromArgs(['--lang', 'es']), 'es');
  assert.equal(langFromArgs(['--lang=es']), 'es');
});

test('langFromArgs usa en si falta el valor o no es válido', () => {
  assert.equal(langFromArgs([]), 'en');
  assert.equal(langFromArgs(['--lang']), 'en');
  assert.equal(langFromArgs(['--lang', 'fr']), 'en');
});

test('inVoice formatea la cantidad en cada idioma', () => {
  assert.equal(STRINGS.en.inVoice(15), '15 in voice');
  assert.equal(STRINGS.es.inVoice(15), '15 en voz');
});

test('ambas tablas tienen las mismas claves y ningún valor vacío', () => {
  assert.deepEqual(Object.keys(STRINGS.es).sort(), Object.keys(STRINGS.en).sort());
  for (const lang of LANGS) {
    for (const [key, value] of Object.entries(STRINGS[lang])) {
      if (typeof value === 'function') {
        const text = value(3);
        assert.ok(typeof text === 'string' && text.length > 0, `${lang}.${key}`);
      } else {
        assert.ok(typeof value === 'string' && value.length > 0, `${lang}.${key}`);
      }
    }
  }
});
