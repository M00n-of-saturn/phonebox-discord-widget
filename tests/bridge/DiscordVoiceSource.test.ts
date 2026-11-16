import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { DiscordVoiceSource, type RpcLike } from '../../src/bridge/sources/DiscordVoiceSource.ts';
import { VoiceStateTracker } from '../../src/bridge/sources/VoiceStateTracker.ts';
import type { VoiceState } from '../../src/shared/models/VoiceState.ts';

const SELF_ID = '100000000000000099';
const ACCESS = 'centinela-token-de-acceso';
const NAMES = ['Ana', 'Bruno', 'Carla', 'Diego', 'General', 'Otro canal'];
const CHANNEL_EVENTS = ['VOICE_STATE_CREATE', 'VOICE_STATE_UPDATE', 'VOICE_STATE_DELETE', 'SPEAKING_START', 'SPEAKING_STOP'];

function userId(n: number): string {
  return `1000000000000000${String(n).padStart(2, '0')}`;
}

function rawState(id: string, username: string, selfMute = false) {
  return { user: { id, username }, voice_state: { mute: false, deaf: false, self_mute: selfMute, self_deaf: false } };
}

const GENERAL = {
  id: '500',
  name: 'General',
  voice_states: [rawState(SELF_ID, 'yo'), rawState(userId(1), 'Ana'), rawState(userId(2), 'Bruno')],
};
const OTRO = { id: '600', name: 'Otro canal', voice_states: [rawState(SELF_ID, 'yo'), rawState(userId(3), 'Carla')] };

interface Sent {
  cmd: string;
  args: Record<string, unknown>;
  evt: string | undefined;
}

/** Doble de RpcClient: registra peticiones, responde según el estado simulado de Discord y emite eventos. */
class FakeRpc implements RpcLike {
  sent: Sent[] = [];
  closed = false;
  failConnect = false;
  #events: Array<(evt: string, data: unknown) => void> = [];
  #closes: Array<(reason: string) => void> = [];
  #discord: FakeDiscord;

  constructor(discord: FakeDiscord) {
    this.#discord = discord;
  }

  async connect(): Promise<void> {
    if (this.failConnect) throw new Error('sin-saludo');
  }

  async request(cmd: string, args: object = {}, evt?: string): Promise<unknown> {
    if (this.closed) throw new Error('cerrado');
    this.sent.push({ cmd, args: args as Record<string, unknown>, evt });
    const discord = this.#discord;
    switch (cmd) {
      case 'AUTHENTICATE':
        return { user: { id: SELF_ID, username: 'yo' } };
      case 'GET_VOICE_SETTINGS':
        return { ...discord.settings, input: { volume: 100 } };
      case 'GET_SELECTED_VOICE_CHANNEL':
        return discord.channel;
      case 'SET_VOICE_SETTINGS':
        discord.settings = { ...discord.settings, ...(args as object) };
        return { ...discord.settings };
      default:
        return {};
    }
  }

  onEvent(handler: (evt: string, data: unknown) => void): void {
    this.#events.push(handler);
  }

  onClose(handler: (reason: string) => void): void {
    this.#closes.push(handler);
  }

  close(): void {
    this.closed = true;
  }

  emit(evt: string, data: unknown): void {
    for (const handler of this.#events) handler(evt, data);
  }

  drop(reason = 'cierre-remoto'): void {
    this.closed = true;
    for (const handler of this.#closes) handler(reason);
  }
}

class FakeDiscord {
  open = true;
  settings = { mute: false, deaf: false };
  channel: unknown = GENERAL;
  rpcs: FakeRpc[] = [];

  createRpc = (): FakeRpc | null => {
    if (!this.open) return null;
    const rpc = new FakeRpc(this);
    this.rpcs.push(rpc);
    return rpc;
  };

  get last(): FakeRpc {
    const rpc = this.rpcs.at(-1);
    assert.ok(rpc, 'no se creó ninguna conexión');
    return rpc;
  }
}

/** Deja correr las promesas pendientes sin avanzar el reloj simulado. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
}

const withTimers = new WeakSet<TestContext>();

function setup(t: TestContext, opts: { token?: string | null } = {}) {
  if (!withTimers.has(t)) {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    withTimers.add(t);
  }
  const discord = new FakeDiscord();
  const states: VoiceState[] = [];
  const logs: string[] = [];
  const token = opts.token === undefined ? ACCESS : opts.token;
  let refreshes = 0;
  const source = new DiscordVoiceSource({
    createRpc: () => discord.createRpc(),
    tokens: {
      refresh: async () => {
        refreshes++;
        return token;
      },
    },
    tracker: new VoiceStateTracker('sal-de-prueba'),
    retryMs: 5000,
    log: (message) => logs.push(message),
  });
  t.after(() => source.stop());
  return {
    discord,
    source,
    states,
    logs,
    get refreshes() {
      return refreshes;
    },
    get last(): VoiceState {
      const state = states.at(-1);
      assert.ok(state, 'no se publicó ningún estado');
      return state;
    },
    start: async () => {
      source.start((state) => states.push(state));
      await flush();
    },
  };
}

function summary(sent: Sent[]): string[] {
  return sent.map((s) => [s.cmd, s.evt, s.args.channel_id].filter((x) => x !== undefined).join(' '));
}

test('arranque normal: secuencia de peticiones en orden y estado conectado', async (t) => {
  const ctx = setup(t);
  await ctx.start();
  assert.deepEqual(summary(ctx.discord.last.sent), [
    'AUTHENTICATE',
    'GET_VOICE_SETTINGS',
    'SUBSCRIBE VOICE_SETTINGS_UPDATE',
    'SUBSCRIBE VOICE_CHANNEL_SELECT',
    'GET_SELECTED_VOICE_CHANNEL',
    ...CHANNEL_EVENTS.map((evt) => `SUBSCRIBE ${evt} 500`),
  ]);
  assert.deepEqual(ctx.discord.last.sent[0]?.args, { access_token: ACCESS });
  assert.equal(ctx.last.discord, 'conectado');
  assert.deepEqual(ctx.last.canal, { nombre: 'General', total: 3 });
  assert.deepEqual(ctx.last.miembros.map((m) => m.nombre), ['Tú', 'Ana', 'Bruno']);
});

test('fuera de un canal no se suscribe a eventos de canal', async (t) => {
  const ctx = setup(t);
  ctx.discord.channel = null;
  await ctx.start();
  assert.equal(ctx.discord.last.sent.filter((s) => s.args.channel_id !== undefined).length, 0);
  assert.equal(ctx.last.discord, 'conectado');
  assert.equal(ctx.last.canal, null);
});

test('Discord cerrado: publica cerrado y reintenta tras retryMs', async (t) => {
  const ctx = setup(t);
  ctx.discord.open = false;
  await ctx.start();
  assert.equal(ctx.last.discord, 'cerrado');
  assert.equal(ctx.discord.rpcs.length, 0);

  ctx.discord.open = true;
  t.mock.timers.tick(4999);
  await flush();
  assert.equal(ctx.discord.rpcs.length, 0);
  t.mock.timers.tick(1);
  await flush();
  assert.equal(ctx.discord.rpcs.length, 1);
  assert.equal(ctx.last.discord, 'conectado');
});

test('saludo fallido: cierra la conexión, publica cerrado y reintenta', async (t) => {
  const ctx = setup(t);
  const realCreate = ctx.discord.createRpc;
  ctx.discord.createRpc = () => {
    const rpc = realCreate();
    if (rpc && ctx.discord.rpcs.length === 1) rpc.failConnect = true;
    return rpc;
  };
  await ctx.start();
  assert.equal(ctx.last.discord, 'cerrado');
  assert.equal(ctx.discord.rpcs[0]?.closed, true);
  t.mock.timers.tick(5000);
  await flush();
  assert.equal(ctx.discord.rpcs.length, 2);
  assert.equal(ctx.last.discord, 'conectado');
});

test('sin token: publica sin-autorizar, no autentica y reintenta', async (t) => {
  const ctx = setup(t, { token: null });
  await ctx.start();
  assert.equal(ctx.last.discord, 'sin-autorizar');
  const cmds = ctx.discord.last.sent.map((s) => s.cmd);
  assert.ok(!cmds.includes('AUTHORIZE'));
  assert.ok(!cmds.includes('AUTHENTICATE'));
  assert.equal(ctx.discord.last.closed, true);
  t.mock.timers.tick(5000);
  await flush();
  assert.equal(ctx.refreshes, 2);
  assert.equal(ctx.last.discord, 'sin-autorizar');
});

test('SPEAKING_START y SPEAKING_STOP cambian habla del miembro', async (t) => {
  const ctx = setup(t);
  await ctx.start();
  ctx.discord.last.emit('SPEAKING_START', { user_id: userId(1), channel_id: '500' });
  assert.deepEqual(ctx.last.miembros.map((m) => m.habla), [false, true, false]);
  ctx.discord.last.emit('SPEAKING_STOP', { user_id: userId(1), channel_id: '500' });
  assert.deepEqual(ctx.last.miembros.map((m) => m.habla), [false, false, false]);
  // De otro canal, o de alguien que no está, no cambia nada ni publica.
  const count = ctx.states.length;
  ctx.discord.last.emit('SPEAKING_START', { user_id: userId(1), channel_id: '999' });
  ctx.discord.last.emit('SPEAKING_START', { user_id: userId(9), channel_id: '500' });
  assert.equal(ctx.states.length, count);
});

test('VOICE_STATE_* agrega, actualiza y quita miembros', async (t) => {
  const ctx = setup(t);
  await ctx.start();
  ctx.discord.last.emit('VOICE_STATE_CREATE', rawState(userId(4), 'Diego'));
  assert.deepEqual(ctx.last.miembros.map((m) => m.nombre), ['Tú', 'Ana', 'Bruno', 'Diego']);
  ctx.discord.last.emit('VOICE_STATE_UPDATE', rawState(userId(4), 'Diego', true));
  assert.equal(ctx.last.miembros[3]?.silenciado, true);
  ctx.discord.last.emit('VOICE_STATE_DELETE', rawState(userId(4), 'Diego'));
  assert.deepEqual(ctx.last.miembros.map((m) => m.nombre), ['Tú', 'Ana', 'Bruno']);
});

test('VOICE_SETTINGS_UPDATE cambia yo', async (t) => {
  const ctx = setup(t);
  await ctx.start();
  ctx.discord.last.emit('VOICE_SETTINGS_UPDATE', { mute: true, deaf: false, output: { volume: 50 } });
  assert.deepEqual(ctx.last.yo, { silenciado: true, ensordecido: false });
});

test('dato inesperado: se descarta y se registra solo el tipo', async (t) => {
  const ctx = setup(t);
  await ctx.start();
  const before = ctx.last;
  const count = ctx.states.length;
  ctx.discord.last.emit('VOICE_STATE_CREATE', { user: { username: 'Ana' } });
  ctx.discord.last.emit('VOICE_SETTINGS_UPDATE', 'texto');
  assert.equal(ctx.states.length, count);
  assert.deepEqual(ctx.last, before);
  assert.ok(ctx.logs.some((line) => line.includes('VOICE_STATE_CREATE')));
  assert.ok(ctx.logs.some((line) => line.includes('VOICE_SETTINGS_UPDATE')));
});

test('cambio de canal: cinco UNSUBSCRIBE del anterior, cinco SUBSCRIBE del nuevo y sin miembros viejos', async (t) => {
  const ctx = setup(t);
  await ctx.start();
  ctx.discord.last.emit('SPEAKING_START', { user_id: userId(1), channel_id: '500' });
  const rpc = ctx.discord.last;
  rpc.sent = [];
  ctx.discord.channel = OTRO;
  rpc.emit('VOICE_CHANNEL_SELECT', { channel_id: '600', guild_id: '1' });
  await flush();
  assert.deepEqual(summary(rpc.sent), [
    'GET_SELECTED_VOICE_CHANNEL',
    ...CHANNEL_EVENTS.map((evt) => `UNSUBSCRIBE ${evt} 500`),
    ...CHANNEL_EVENTS.map((evt) => `SUBSCRIBE ${evt} 600`),
  ]);
  assert.deepEqual(ctx.last.canal, { nombre: 'Otro canal', total: 2 });
  assert.deepEqual(ctx.last.miembros.map((m) => [m.nombre, m.habla]), [['Tú', false], ['Carla', false]]);
});

test('salir del canal: UNSUBSCRIBE del anterior y canal nulo', async (t) => {
  const ctx = setup(t);
  await ctx.start();
  const rpc = ctx.discord.last;
  rpc.sent = [];
  ctx.discord.channel = null;
  rpc.emit('VOICE_CHANNEL_SELECT', { channel_id: null });
  await flush();
  assert.deepEqual(summary(rpc.sent), CHANNEL_EVENTS.map((evt) => `UNSUBSCRIBE ${evt} 500`));
  assert.equal(ctx.last.canal, null);
  assert.deepEqual(ctx.last.miembros, []);
});

test('conexión perdida: publica cerrado sin miembros y reconecta tras retryMs', async (t) => {
  const ctx = setup(t);
  await ctx.start();
  ctx.discord.last.emit('SPEAKING_START', { user_id: userId(1), channel_id: '500' });
  ctx.discord.last.drop();
  assert.equal(ctx.last.discord, 'cerrado');
  assert.equal(ctx.last.canal, null);
  assert.deepEqual(ctx.last.miembros, []);
  await assert.rejects(ctx.source.execute('colgar'));

  t.mock.timers.tick(5000);
  await flush();
  assert.equal(ctx.discord.rpcs.length, 2);
  const reconnected: VoiceState = ctx.last;
  assert.equal(reconnected.discord, 'conectado');
  assert.deepEqual(reconnected.miembros.map((m) => m.habla), [false, false, false]);
  // Los eventos de la conexión vieja ya no cuentan.
  const count = ctx.states.length;
  ctx.discord.rpcs[0]?.emit('VOICE_STATE_CREATE', rawState(userId(4), 'Diego'));
  assert.equal(ctx.states.length, count);
});

test('una petición que falla a mitad del arranque cierra y reintenta una sola vez', async (t) => {
  const ctx = setup(t);
  const realCreate = ctx.discord.createRpc;
  ctx.discord.createRpc = () => {
    const rpc = realCreate();
    if (rpc && ctx.discord.rpcs.length === 1) {
      const original = rpc.request.bind(rpc);
      rpc.request = async (cmd, args, evt) => {
        if (cmd === 'GET_VOICE_SETTINGS') {
          rpc.drop();
          throw new Error('sin conexión');
        }
        return original(cmd, args, evt);
      };
    }
    return rpc;
  };
  await ctx.start();
  assert.equal(ctx.last.discord, 'cerrado');
  t.mock.timers.tick(5000);
  await flush();
  assert.equal(ctx.discord.rpcs.length, 2);
  assert.equal(ctx.last.discord, 'conectado');
});

test('execute envía las órdenes correctas', async (t) => {
  const ctx = setup(t);
  await ctx.start();
  const rpc = ctx.discord.last;
  rpc.sent = [];
  await ctx.source.execute('alternar-silencio');
  assert.deepEqual(rpc.sent.at(-1), { cmd: 'SET_VOICE_SETTINGS', args: { mute: true }, evt: undefined });
  assert.deepEqual(ctx.last.yo, { silenciado: true, ensordecido: false });
  await ctx.source.execute('alternar-silencio');
  assert.deepEqual(rpc.sent.at(-1)?.args, { mute: false });
  await ctx.source.execute('alternar-ensordecer');
  assert.deepEqual(rpc.sent.at(-1), { cmd: 'SET_VOICE_SETTINGS', args: { deaf: true }, evt: undefined });
  await ctx.source.execute('colgar');
  assert.deepEqual(rpc.sent.at(-1), { cmd: 'SELECT_VOICE_CHANNEL', args: { channel_id: null }, evt: undefined });
});

test('execute sin conexión autenticada rechaza de inmediato', async (t) => {
  const closed = setup(t);
  closed.discord.open = false;
  await closed.start();
  await assert.rejects(closed.source.execute('alternar-silencio'));

  const unauthorized = setup(t, { token: null });
  await unauthorized.start();
  await assert.rejects(unauthorized.source.execute('colgar'));
  assert.ok(!unauthorized.discord.last.sent.some((s) => s.cmd === 'SELECT_VOICE_CHANNEL'));
});

test('stop cierra la conexión y cancela reintentos', async (t) => {
  const ctx = setup(t);
  await ctx.start();
  ctx.source.stop();
  assert.equal(ctx.discord.last.closed, true);
  await assert.rejects(ctx.source.execute('colgar'));

  const retry = setup(t);
  retry.discord.open = false;
  await retry.start();
  retry.source.stop();
  retry.discord.open = true;
  t.mock.timers.tick(20_000);
  await flush();
  assert.equal(retry.discord.rpcs.length, 0);
});

test('los registros no contienen el token, nombres ni ids', async (t) => {
  const ctx = setup(t);
  await ctx.start();
  const rpc = ctx.discord.last;
  rpc.emit('VOICE_STATE_CREATE', { user: { username: 'Ana' }, voice_state: {} });
  rpc.emit('SPEAKING_START', { user_id: 5 });
  ctx.discord.channel = OTRO;
  rpc.emit('VOICE_CHANNEL_SELECT', { channel_id: '600' });
  await flush();
  rpc.drop();
  t.mock.timers.tick(5000);
  await flush();
  assert.ok(ctx.logs.length > 0);
  for (const line of ctx.logs) {
    assert.ok(!line.includes(ACCESS), line);
    for (const name of NAMES) assert.ok(!line.includes(name), line);
    for (const id of [SELF_ID, userId(1), '500', '600']) assert.ok(!line.includes(id), line);
  }
});
