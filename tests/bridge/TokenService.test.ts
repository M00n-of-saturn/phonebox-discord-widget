import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemorySecretStore } from '../../src/bridge/auth/SecretStore.ts';
import { TokenService } from '../../src/bridge/auth/TokenService.ts';

const CLIENT_ID = '123456789012345678';
const SECRET = 'centinela-secreto-de-app';
const CODE = 'centinela-codigo';
const ACCESS = 'centinela-acceso';
const REFRESH_OLD = 'centinela-refresco-viejo';
const REFRESH_NEW = 'centinela-refresco-nuevo';
const SENTINELS = [SECRET, CODE, ACCESS, REFRESH_OLD, REFRESH_NEW];

interface Call {
  url: string;
  method: string | undefined;
  contentType: string | null;
  body: URLSearchParams;
}

function fakeFetch(respond: () => Response | Promise<Response>): { fetchFn: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method,
      contentType: new Headers(init?.headers).get('content-type'),
      body: new URLSearchParams(String(init?.body)),
    });
    return respond();
  }) as typeof fetch;
  return { fetchFn, calls };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function setup(respond: () => Response | Promise<Response>, secrets: { secret?: boolean; refresh?: boolean } = {}) {
  const store = new MemorySecretStore();
  if (secrets.secret !== false) await store.set('client-secret', SECRET);
  if (secrets.refresh) await store.set('refresh-token', REFRESH_OLD);
  const { fetchFn, calls } = fakeFetch(respond);
  const service = new TokenService({ clientId: CLIENT_ID, redirectUri: 'http://localhost', store, fetchFn });
  return { store, calls, service };
}

function assertNoSentinels(error: unknown): true {
  assert.ok(error instanceof Error);
  const text = `${error.message} ${String(error.stack)} ${JSON.stringify(error)} ${String((error as Error).cause ?? '')}`;
  for (const sentinel of SENTINELS) assert.ok(!text.includes(sentinel), `el error contiene un valor secreto`);
  return true;
}

test('exchangeCode canjea el código, guarda el token de refresco y devuelve el de acceso', async () => {
  const { store, calls, service } = await setup(() => json(200, { access_token: ACCESS, refresh_token: REFRESH_NEW }));
  assert.equal(await service.exchangeCode(CODE), ACCESS);
  assert.equal(calls.length, 1);
  const call = calls[0]!;
  assert.equal(call.url, 'https://discord.com/api/oauth2/token');
  assert.equal(call.method, 'POST');
  assert.equal(call.contentType, 'application/x-www-form-urlencoded');
  assert.deepEqual(Object.fromEntries(call.body), {
    grant_type: 'authorization_code',
    code: CODE,
    client_id: CLIENT_ID,
    client_secret: SECRET,
    redirect_uri: 'http://localhost',
  });
  assert.equal(await store.get('refresh-token'), REFRESH_NEW);
});

test('exchangeCode lanza ante un rechazo de Discord, sin valores secretos en el error', async () => {
  const { store, service } = await setup(() => json(400, { error: 'invalid_grant', error_description: `código ${CODE}` }));
  await assert.rejects(service.exchangeCode(CODE), assertNoSentinels);
  assert.equal(await store.get('refresh-token'), null);
});

test('exchangeCode lanza si la respuesta no trae ambos tokens', async () => {
  const { store, service } = await setup(() => json(200, { access_token: ACCESS }));
  await assert.rejects(service.exchangeCode(CODE), assertNoSentinels);
  assert.equal(await store.get('refresh-token'), null);
});

test('refresh sin token guardado devuelve null sin llamar a la red', async () => {
  const { calls, service } = await setup(() => json(200, {}));
  assert.equal(await service.refresh(), null);
  assert.equal(calls.length, 0);
});

test('refresh usa el token guardado y lo reemplaza por el nuevo', async () => {
  const { store, calls, service } = await setup(() => json(200, { access_token: ACCESS, refresh_token: REFRESH_NEW }), {
    refresh: true,
  });
  assert.equal(await service.refresh(), ACCESS);
  assert.deepEqual(Object.fromEntries(calls[0]!.body), {
    grant_type: 'refresh_token',
    refresh_token: REFRESH_OLD,
    client_id: CLIENT_ID,
    client_secret: SECRET,
  });
  assert.equal(await store.get('refresh-token'), REFRESH_NEW);
});

test('refresh ante HTTP 400 invalid_grant borra el token guardado y devuelve null', async () => {
  const { store, service } = await setup(() => json(400, { error: 'invalid_grant' }), { refresh: true });
  assert.equal(await service.refresh(), null);
  assert.equal(await store.get('refresh-token'), null);
});

test('refresh ante HTTP 400 con otro error lanza y conserva el token', async () => {
  const { store, service } = await setup(() => json(400, { error: 'invalid_request' }), { refresh: true });
  await assert.rejects(service.refresh(), assertNoSentinels);
  assert.equal(await store.get('refresh-token'), REFRESH_OLD);
});

test('refresh ante HTTP 500 lanza y conserva el token', async () => {
  const { store, service } = await setup(() => new Response(`fallo ${REFRESH_OLD}`, { status: 500 }), { refresh: true });
  await assert.rejects(service.refresh(), assertNoSentinels);
  assert.equal(await store.get('refresh-token'), REFRESH_OLD);
});

test('refresh ante un error de red lanza y conserva el token', async () => {
  const { store, service } = await setup(
    () => {
      throw new TypeError(`fetch failed ${SECRET} ${REFRESH_OLD}`);
    },
    { refresh: true },
  );
  await assert.rejects(service.refresh(), assertNoSentinels);
  assert.equal(await store.get('refresh-token'), REFRESH_OLD);
});

test('refresh con respuesta 200 incompleta lanza y conserva el token', async () => {
  const { store, service } = await setup(() => json(200, { access_token: ACCESS }), { refresh: true });
  await assert.rejects(service.refresh(), assertNoSentinels);
  assert.equal(await store.get('refresh-token'), REFRESH_OLD);
});

test('sin client-secret ambos métodos lanzan sin llamar a la red', async () => {
  const { calls, service } = await setup(() => json(200, {}), { secret: false, refresh: true });
  await assert.rejects(service.exchangeCode(CODE), assertNoSentinels);
  await assert.rejects(service.refresh(), assertNoSentinels);
  assert.equal(calls.length, 0);
});
