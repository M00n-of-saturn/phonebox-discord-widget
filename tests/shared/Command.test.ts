import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COMMANDS, parseCommand } from '../../src/shared/models/Command.ts';

test('acepta exactamente las tres órdenes previstas', () => {
  assert.deepEqual([...COMMANDS], ['alternar-silencio', 'alternar-ensordecer', 'colgar']);
  for (const command of COMMANDS) assert.equal(parseCommand(command), command);
});

test('acepta un único salto de línea final', () => {
  assert.equal(parseCommand('colgar\n'), 'colgar');
  assert.equal(parseCommand('colgar\n\n'), null);
});

test('rechaza cualquier otra entrada', () => {
  const invalid = [
    '',
    'COLGAR',
    ' colgar',
    'colgar ',
    'colgar; rm -rf ~',
    'alternar-silencio alternar-ensordecer',
    'x'.repeat(100),
    'toString',
    '__proto__',
  ];
  for (const raw of invalid) assert.equal(parseCommand(raw), null, JSON.stringify(raw));
});
