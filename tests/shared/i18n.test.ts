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

test('las tablas fijan el texto literal de cada idioma', () => {
  assert.deepEqual(
    { ...STRINGS.en, inVoice: STRINGS.en.inVoice(7) },
    {
      noConnection: 'No connection to the PC',
      closed: 'Discord is closed',
      notAuthorized: 'Authorization missing: run "pnpm run setup" on the PC',
      notInChannel: 'You are not in a voice channel',
      inVoice: '7 in voice',
      mute: 'Mute',
      muted: 'Muted',
      deafen: 'Deafen',
      deafened: 'Deafened',
      hangUp: 'Hang up',
      openDiscord: 'Open Discord',
      you: 'You',
    },
  );
  assert.deepEqual(
    { ...STRINGS.es, inVoice: STRINGS.es.inVoice(7) },
    {
      noConnection: 'Sin conexión con la PC',
      closed: 'Discord está cerrado',
      notAuthorized: 'Falta autorizar: ejecuta "pnpm run setup" en la PC',
      notInChannel: 'No estás en un canal de voz',
      inVoice: '7 en voz',
      mute: 'Silenciar',
      muted: 'Silenciado',
      deafen: 'Ensordecer',
      deafened: 'Ensordecido',
      hangUp: 'Colgar',
      openDiscord: 'Abrir Discord',
      you: 'Tú',
    },
  );
});
