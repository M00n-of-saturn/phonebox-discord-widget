import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { PhoneBoxClient, type PanelView, type PhoneBoxApi } from '../../src/widget/services/PhoneBoxClient.ts';
import type { VoiceState } from '../../src/shared/models/VoiceState.ts';

function voice(discord: VoiceState['discord']): VoiceState {
  return {
    v: 1,
    discord,
    canal: discord === 'conectado' ? { nombre: 'General', total: 1 } : null,
    yo: { silenciado: false, ensordecido: false },
    miembros: discord === 'conectado' ? [{ clave: 'a1b2c3d4', nombre: 'Ana', habla: false, silenciado: false, ensordecido: false }] : [],
  };
}

function item(data: unknown, at: number) {
  return { data, at, expiresAt: at + 15_000 };
}

class FakeApi implements PhoneBoxApi {
  handlers = new Map<string, Array<(value: unknown) => void>>();
  ran: string[] = [];

  on(kind: string, handler: (value: unknown) => void): void {
    const list = this.handlers.get(kind) ?? [];
    list.push(handler);
    this.handlers.set(kind, list);
  }

  run(id: string): void {
    this.ran.push(id);
  }

  push(value: unknown): void {
    for (const handler of this.handlers.get('push') ?? []) handler(value);
  }
}

function setup(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const api = new FakeApi();
  const client = new PhoneBoxClient(api);
  const views: PanelView[] = [];
  client.onView((view) => views.push(view));
  return {
    api,
    client,
    views,
    get last(): PanelView {
      const view = views.at(-1);
      assert.ok(view);
      return view;
    },
  };
}

test('sin datos la vista inicial es sin-conexion', (t) => {
  const ctx = setup(t);
  assert.deepEqual(ctx.views, [{ kind: 'sin-conexion' }]);
});

test('un estado válido da la vista de su estado de Discord', (t) => {
  const ctx = setup(t);
  ctx.api.push({ 'discord-voice': item(voice('conectado'), 1), otra: item({}, 1) });
  assert.deepEqual(ctx.last, { kind: 'conectado', state: voice('conectado') });
  ctx.api.push({ 'discord-voice': item(voice('cerrado'), 2) });
  assert.deepEqual(ctx.last, { kind: 'cerrado' });
  ctx.api.push({ 'discord-voice': item(voice('sin-autorizar'), 3) });
  assert.deepEqual(ctx.last, { kind: 'sin-autorizar' });
});

test('datos ausentes o inválidos dan sin-conexion', (t) => {
  const ctx = setup(t);
  const invalid: unknown[] = [
    {},
    { otra: item(voice('conectado'), 1) },
    { 'discord-voice': item({ ...voice('conectado'), v: 2 }, 1) },
    { 'discord-voice': item('texto', 1) },
    { 'discord-voice': 'texto' },
    { 'discord-voice': null },
    'texto',
    null,
    [],
  ];
  let at = 100;
  for (const value of invalid) {
    ctx.api.push({ 'discord-voice': item(voice('conectado'), at++) });
    assert.equal(ctx.last.kind, 'conectado');
    ctx.api.push(value);
    assert.deepEqual(ctx.last, { kind: 'sin-conexion' }, JSON.stringify(value));
  }
});

test('si at no cambia durante 15 s, pasa a sin-conexion', (t) => {
  const ctx = setup(t);
  ctx.api.push({ 'discord-voice': item(voice('conectado'), 1) });
  t.mock.timers.tick(10_000);
  ctx.api.push({ 'discord-voice': item(voice('conectado'), 1) });
  assert.equal(ctx.last.kind, 'conectado');
  t.mock.timers.tick(5000);
  assert.deepEqual(ctx.last, { kind: 'sin-conexion' });
  // Repetir el mismo at no lo revive.
  ctx.api.push({ 'discord-voice': item(voice('conectado'), 1) });
  assert.deepEqual(ctx.last, { kind: 'sin-conexion' });
  // Un at nuevo sí.
  ctx.api.push({ 'discord-voice': item(voice('conectado'), 2) });
  assert.equal(ctx.last.kind, 'conectado');
});

test('un at nuevo antes de 15 s mantiene la vista', (t) => {
  const ctx = setup(t);
  for (let at = 1; at <= 10; at++) {
    ctx.api.push({ 'discord-voice': item(voice('conectado'), at) });
    t.mock.timers.tick(5000);
    assert.equal(ctx.last.kind, 'conectado');
  }
});

test('un suscriptor tardío recibe la vista actual', (t) => {
  const ctx = setup(t);
  ctx.api.push({ 'discord-voice': item(voice('cerrado'), 1) });
  const late: PanelView[] = [];
  ctx.client.onView((view) => late.push(view));
  assert.deepEqual(late, [{ kind: 'cerrado' }]);
});

test('run pasa el id al panel', (t) => {
  const ctx = setup(t);
  ctx.client.run('discord-mute');
  ctx.client.run('discord-open');
  assert.deepEqual(ctx.api.ran, ['discord-mute', 'discord-open']);
});
