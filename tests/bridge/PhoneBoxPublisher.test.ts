import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { PhoneBoxPublisher } from '../../src/bridge/publishers/PhoneBoxPublisher.ts';
import type { VoiceState } from '../../src/shared/models/VoiceState.ts';

interface Call {
  url: string;
  method: string | undefined;
  contentType: string | null;
  body: unknown;
}

function state(nombre: string): VoiceState {
  return {
    v: 1,
    discord: 'conectado',
    canal: { nombre, total: 0 },
    yo: { silenciado: false, ensordecido: false },
    miembros: [],
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 3; i++) await new Promise((resolve) => setImmediate(resolve));
}

function setup(t: TestContext, respond: () => Promise<Response> = async () => new Response('{}')) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const calls: Call[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method,
      contentType: new Headers(init?.headers).get('content-type'),
      body: JSON.parse(String(init?.body)),
    });
    return respond();
  }) as typeof fetch;
  const publisher = new PhoneBoxPublisher({ fetchFn });
  t.after(() => publisher.stop());
  return { publisher, calls };
}

test('el primer publish hace POST al agente local con el estado como JSON', async (t) => {
  const { publisher, calls } = setup(t);
  publisher.publish(state('General'));
  await flush();
  assert.deepEqual(calls, [
    {
      url: 'http://127.0.0.1:8765/api/push/discord-voice?ttl=15',
      method: 'POST',
      contentType: 'application/json',
      body: state('General'),
    },
  ]);
});

test('diez publish en 100 ms producen como máximo dos peticiones y la última lleva el estado más reciente', async (t) => {
  const { publisher, calls } = setup(t);
  for (let i = 0; i < 10; i++) {
    publisher.publish(state(`Canal ${i}`));
    t.mock.timers.tick(10);
    await flush();
  }
  t.mock.timers.tick(1000);
  await flush();
  assert.ok(calls.length <= 2, `hubo ${calls.length} peticiones`);
  assert.deepEqual(calls.at(-1)?.body, state('Canal 9'));
});

test('no supera cinco envíos por segundo', async (t) => {
  const { publisher, calls } = setup(t);
  for (let i = 0; i < 100; i++) {
    publisher.publish(state(`Canal ${i}`));
    t.mock.timers.tick(10);
    await flush();
  }
  // 1000 ms: el envío inmediato más uno cada 200 ms.
  assert.ok(calls.length <= 6, `hubo ${calls.length} peticiones`);
});

test('sin cambios repite el último estado cada 5000 ms', async (t) => {
  const { publisher, calls } = setup(t);
  publisher.publish(state('General'));
  await flush();
  t.mock.timers.tick(4999);
  await flush();
  assert.equal(calls.length, 1);
  t.mock.timers.tick(1);
  await flush();
  assert.equal(calls.length, 2);
  t.mock.timers.tick(5000);
  await flush();
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.at(-1)?.body, state('General'));
});

test('un fetch que rechaza no propaga el error y el siguiente latido reintenta', async (t) => {
  let fail = true;
  const { publisher, calls } = setup(t, async () => {
    if (fail) throw new Error('agente caído');
    return new Response('{}');
  });
  assert.doesNotThrow(() => publisher.publish(state('General')));
  await flush();
  assert.equal(calls.length, 1);
  fail = false;
  t.mock.timers.tick(5000);
  await flush();
  assert.equal(calls.length, 2);
});

test('el constructor lanza si el agente no es local', () => {
  const fetchFn = (async () => new Response('{}')) as typeof fetch;
  for (const baseUrl of ['http://192.168.1.10:8765', 'http://ejemplo.com', 'https://127.0.0.1.ejemplo.com', 'texto']) {
    assert.throws(() => new PhoneBoxPublisher({ baseUrl, fetchFn }), baseUrl);
  }
  for (const baseUrl of ['http://127.0.0.1:8765', 'http://localhost:9000']) {
    new PhoneBoxPublisher({ baseUrl, fetchFn }).stop();
  }
});

test('stop cancela el latido y los envíos pendientes', async (t) => {
  const { publisher, calls } = setup(t);
  publisher.publish(state('Uno'));
  publisher.publish(state('Dos'));
  await flush();
  publisher.stop();
  t.mock.timers.tick(20_000);
  await flush();
  assert.equal(calls.length, 1);
  publisher.publish(state('Tres'));
  await flush();
  assert.equal(calls.length, 1);
});
