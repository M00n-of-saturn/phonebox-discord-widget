import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseVoiceState } from '../../src/shared/models/VoiceState.ts';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

test('cada archivo de tests/fixtures es un VoiceState válido', () => {
  const files = readdirSync(dir).filter((name) => name.endsWith('.json'));
  assert.ok(files.length >= 5);
  for (const name of files) {
    const raw: unknown = JSON.parse(readFileSync(join(dir, name), 'utf8'));
    assert.deepEqual(parseVoiceState(raw), raw, name);
  }
});
