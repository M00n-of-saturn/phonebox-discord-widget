import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { ConfigError, configPath, loadConfig, saveConfig } from '../../src/bridge/config/BridgeConfig.ts';

const CLIENT_ID = '123456789012345678';

function tempDir(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'config-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('configPath usa XDG_CONFIG_HOME y, si falta, ~/.config', () => {
  assert.equal(
    configPath({ XDG_CONFIG_HOME: '/x/cfg', HOME: '/home/ana' }),
    '/x/cfg/phonebox-discord-widget/config.json',
  );
  assert.equal(configPath({ HOME: '/home/ana' }), '/home/ana/.config/phonebox-discord-widget/config.json');
});

test('ida y vuelta de saveConfig y loadConfig', (t) => {
  const path = join(tempDir(t), 'sub', 'config.json');
  saveConfig(path, { clientId: CLIENT_ID, redirectUri: 'http://localhost' });
  assert.deepEqual(loadConfig(path), { clientId: CLIENT_ID, redirectUri: 'http://localhost' });
});

test('el archivo queda con modo 0600 y la carpeta con 0700', (t) => {
  const path = join(tempDir(t), 'sub', 'config.json');
  saveConfig(path, { clientId: CLIENT_ID, redirectUri: 'http://localhost' });
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(statSync(dirname(path)).mode & 0o777, 0o700);
});

test('saveConfig corrige el modo de un archivo que ya existía con permisos abiertos', (t) => {
  const path = join(tempDir(t), 'config.json');
  writeFileSync(path, '{}', { mode: 0o644 });
  saveConfig(path, { clientId: CLIENT_ID, redirectUri: 'http://localhost' });
  assert.equal(statSync(path).mode & 0o777, 0o600);
});

test('saveConfig rechaza una configuración inválida sin escribir', (t) => {
  const path = join(tempDir(t), 'config.json');
  assert.throws(() => saveConfig(path, { clientId: 'abc', redirectUri: 'http://localhost' }), ConfigError);
  assert.throws(() => statSync(path));
});

test('redirectUri es http://localhost por defecto', (t) => {
  const path = join(tempDir(t), 'config.json');
  writeFileSync(path, JSON.stringify({ clientId: CLIENT_ID }));
  assert.deepEqual(loadConfig(path), { clientId: CLIENT_ID, redirectUri: 'http://localhost' });
});

test('loadConfig ignora propiedades desconocidas', (t) => {
  const path = join(tempDir(t), 'config.json');
  writeFileSync(path, JSON.stringify({ clientId: CLIENT_ID, clientSecret: 'no-deberia-estar' }));
  assert.deepEqual(loadConfig(path), { clientId: CLIENT_ID, redirectUri: 'http://localhost' });
});

test('loadConfig lanza ConfigError si falta el archivo', (t) => {
  assert.throws(() => loadConfig(join(tempDir(t), 'no-existe.json')), ConfigError);
});

test('loadConfig lanza ConfigError si no es JSON o no es un objeto', (t) => {
  const path = join(tempDir(t), 'config.json');
  for (const content of ['{no json', '[]', 'null', '"texto"']) {
    writeFileSync(path, content);
    assert.throws(() => loadConfig(path), ConfigError, content);
  }
});

test('loadConfig lanza ConfigError si clientId no es un id numérico de 15 a 25 dígitos', (t) => {
  const path = join(tempDir(t), 'config.json');
  for (const clientId of [undefined, 123456789012345678, '', 'abc', '1'.repeat(14), '1'.repeat(26), `${CLIENT_ID}\n`, ` ${CLIENT_ID}`]) {
    writeFileSync(path, JSON.stringify({ clientId }));
    assert.throws(() => loadConfig(path), ConfigError, JSON.stringify(clientId));
  }
});

test('loadConfig lanza ConfigError si redirectUri no es una dirección http o https', (t) => {
  const path = join(tempDir(t), 'config.json');
  for (const redirectUri of [42, '', 'localhost', 'file:///etc/passwd', 'javascript:alert(1)']) {
    writeFileSync(path, JSON.stringify({ clientId: CLIENT_ID, redirectUri }));
    assert.throws(() => loadConfig(path), ConfigError, JSON.stringify(redirectUri));
  }
});
