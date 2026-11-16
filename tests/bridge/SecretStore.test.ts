import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { KeyringSecretStore, KeyringUnavailableError, MemorySecretStore } from '../../src/bridge/auth/SecretStore.ts';

const TEST_SERVICE = 'phonebox-discord-widget-test';
const hasSecretTool = spawnSync('secret-tool', ['--version']).error === undefined;

test('MemorySecretStore guarda, lee, reemplaza y borra', async () => {
  const store = new MemorySecretStore();
  assert.equal(await store.get('refresh-token'), null);
  await store.set('refresh-token', 'valor-ficticio-1');
  await store.set('client-secret', 'otro-ficticio');
  assert.equal(await store.get('refresh-token'), 'valor-ficticio-1');
  await store.set('refresh-token', 'valor-ficticio-2');
  assert.equal(await store.get('refresh-token'), 'valor-ficticio-2');
  await store.delete('refresh-token');
  assert.equal(await store.get('refresh-token'), null);
  assert.equal(await store.get('client-secret'), 'otro-ficticio');
});

test('KeyringSecretStore lanza KeyringUnavailableError si falta secret-tool', async () => {
  const store = new KeyringSecretStore(TEST_SERVICE, 'secret-tool-que-no-existe');
  await assert.rejects(store.get('refresh-token'), KeyringUnavailableError);
  await assert.rejects(
    store.set('refresh-token', 'centinela-valor'),
    (error: unknown) => error instanceof KeyringUnavailableError && !error.message.includes('centinela'),
  );
  await assert.rejects(store.delete('refresh-token'), KeyringUnavailableError);
});

test('KeyringSecretStore rechaza un valor vacío sin tocar el llavero', async () => {
  const store = new KeyringSecretStore(TEST_SERVICE, 'secret-tool-que-no-existe');
  await assert.rejects(store.set('refresh-token', ''), (error: unknown) => !(error instanceof KeyringUnavailableError));
});

test('KeyringSecretStore guarda, lee y borra en el llavero del sistema', async (t) => {
  if (!hasSecretTool) {
    t.skip('secret-tool no está en el PATH');
    return;
  }
  const store = new KeyringSecretStore(TEST_SERVICE);
  const value = 'valor ficticio con ñ y espacios';
  try {
    await store.delete('refresh-token');
  } catch (error) {
    if (!(error instanceof KeyringUnavailableError)) throw error;
    t.skip('el llavero del sistema no responde');
    return;
  }
  t.after(() => store.delete('refresh-token'));
  assert.equal(await store.get('refresh-token'), null);
  await store.set('refresh-token', value);
  assert.equal(await store.get('refresh-token'), value);
  await store.set('refresh-token', 'segundo-valor-ficticio');
  assert.equal(await store.get('refresh-token'), 'segundo-valor-ficticio');
  await store.delete('refresh-token');
  assert.equal(await store.get('refresh-token'), null);
});
