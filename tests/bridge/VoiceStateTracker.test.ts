import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VoiceStateTracker } from '../../src/bridge/sources/VoiceStateTracker.ts';
import { parseVoiceState, type VoiceState } from '../../src/shared/models/VoiceState.ts';

const SELF_ID = '100000000000000099';

function userId(n: number): string {
  return `1000000000000000${String(n).padStart(2, '0')}`;
}

function rawState(id: string, username: string, extra: { nick?: string; global_name?: string | null; mute?: boolean; self_mute?: boolean; deaf?: boolean; self_deaf?: boolean } = {}) {
  return {
    ...(extra.nick === undefined ? {} : { nick: extra.nick }),
    user: { id, username, ...(extra.global_name === undefined ? {} : { global_name: extra.global_name }) },
    voice_state: {
      mute: extra.mute ?? false,
      deaf: extra.deaf ?? false,
      self_mute: extra.self_mute ?? false,
      self_deaf: extra.self_deaf ?? false,
    },
  };
}

function rawChannel(id: string, name: string, states: unknown[]) {
  return { id, name, voice_states: states };
}

/** Todo estado publicado debe pasar la validación del modelo compartido. */
function snap(tracker: VoiceStateTracker): VoiceState {
  const state = tracker.snapshot();
  assert.deepEqual(parseVoiceState(JSON.parse(JSON.stringify(state))), state);
  return state;
}

function connectedTracker(salt = 'sal-de-prueba'): VoiceStateTracker {
  const tracker = new VoiceStateTracker(salt, 'Tú');
  tracker.setStatus('conectado');
  tracker.setSelfId(SELF_ID);
  return tracker;
}

const TRES = [
  rawState(userId(1), 'ana_usuario', { nick: 'Ana', global_name: 'Ana Global' }),
  rawState(userId(2), 'bruno_usuario', { global_name: 'Bruno' }),
  rawState(userId(3), 'carla', { global_name: null }),
];

test('estado inicial', () => {
  assert.deepEqual(snap(new VoiceStateTracker('sal', 'Tú')), {
    v: 1,
    discord: 'cerrado',
    canal: null,
    yo: { silenciado: false, ensordecido: false },
    miembros: [],
  });
});

test('setChannel con tres personas usa nick, luego global_name, luego username', () => {
  const tracker = connectedTracker();
  assert.equal(tracker.setChannel(rawChannel('500', 'General', TRES)), true);
  const state = snap(tracker);
  assert.deepEqual(state.canal, { nombre: 'General', total: 3 });
  assert.deepEqual(state.miembros.map((m) => m.nombre), ['Ana', 'Bruno', 'carla']);
  assert.equal(tracker.channelId, '500');
  assert.equal(state.discord, 'conectado');
});

test('silenciado y ensordecido combinan el estado del servidor y el propio', () => {
  const tracker = connectedTracker();
  tracker.setChannel(
    rawChannel('500', 'General', [
      rawState(userId(1), 'Ana', { mute: true }),
      rawState(userId(2), 'Bruno', { self_mute: true }),
      rawState(userId(3), 'Carla', { deaf: true }),
      rawState(userId(4), 'Diego', { self_deaf: true }),
      rawState(userId(5), 'Elena'),
    ]),
  );
  const flags = snap(tracker).miembros.map((m) => [m.silenciado, m.ensordecido]);
  assert.deepEqual(flags, [[true, false], [true, false], [false, true], [false, true], [false, false]]);
});

test('el propio usuario se llama Tú y va primero', () => {
  const tracker = connectedTracker();
  tracker.setChannel(rawChannel('500', 'General', [...TRES, rawState(SELF_ID, 'mi_usuario', { nick: 'Mi apodo' })]));
  assert.deepEqual(snap(tracker).miembros.map((m) => m.nombre), ['Tú', 'Ana', 'Bruno', 'carla']);
});

test('con 15 personas se muestran 12, el total es 15 y el propio usuario está incluido', () => {
  const tracker = connectedTracker();
  const states = [];
  for (let n = 1; n <= 15; n++) states.push(n === 14 ? rawState(SELF_ID, 'mi_usuario') : rawState(userId(n), `Persona ${n}`));
  tracker.setChannel(rawChannel('500', 'General', states));
  const state = snap(tracker);
  assert.equal(state.miembros.length, 12);
  assert.equal(state.canal?.total, 15);
  assert.equal(state.miembros[0]?.nombre, 'Tú');
  assert.deepEqual(state.miembros.slice(1, 3).map((m) => m.nombre), ['Persona 1', 'Persona 2']);
});

test('nombres y canal pasan por sanitizeName', () => {
  const tracker = connectedTracker();
  tracker.setChannel(
    rawChannel('500', '  Sala\u0000 uno  ', [
      rawState(userId(1), 'x', { nick: 'A\u0000na\n' }),
      rawState(userId(2), 'y'.repeat(40)),
      rawState(userId(3), '   '),
      rawState(userId(4), 'z', { nick: '<img src=x onerror=alert(1)>' }),
    ]),
  );
  const state = snap(tracker);
  assert.equal(state.canal?.nombre, 'Sala uno');
  assert.deepEqual(state.miembros.map((m) => m.nombre), ['Ana', 'y'.repeat(32), '?', '<img src=x onerror=alert(1)>']);
});

test('applyVoiceState agrega, actualiza y quita', () => {
  const tracker = connectedTracker();
  tracker.setChannel(rawChannel('500', 'General', TRES));
  assert.equal(tracker.applyVoiceState('create', rawState(userId(4), 'Diego')), true);
  assert.deepEqual(snap(tracker).miembros.map((m) => m.nombre), ['Ana', 'Bruno', 'carla', 'Diego']);
  assert.equal(snap(tracker).canal?.total, 4);

  assert.equal(tracker.applyVoiceState('update', rawState(userId(4), 'Diego', { self_mute: true })), true);
  assert.equal(snap(tracker).miembros[3]?.silenciado, true);
  assert.equal(snap(tracker).miembros.length, 4);

  tracker.setSpeaking(userId(4), true);
  assert.equal(tracker.applyVoiceState('delete', rawState(userId(4), 'Diego')), true);
  assert.deepEqual(snap(tracker).miembros.map((m) => m.nombre), ['Ana', 'Bruno', 'carla']);
  // Si vuelve a entrar, no conserva el indicador de habla.
  tracker.applyVoiceState('create', rawState(userId(4), 'Diego'));
  assert.equal(snap(tracker).miembros[3]?.habla, false);
});

test('applyVoiceState fuera de un canal devuelve false y no agrega nada', () => {
  const tracker = connectedTracker();
  assert.equal(tracker.applyVoiceState('create', rawState(userId(4), 'Diego')), false);
  assert.deepEqual(snap(tracker).miembros, []);
});

test('setSpeaking marca y desmarca habla', () => {
  const tracker = connectedTracker();
  tracker.setChannel(rawChannel('500', 'General', TRES));
  assert.equal(tracker.setSpeaking(userId(1), true), true);
  assert.deepEqual(snap(tracker).miembros.map((m) => m.habla), [true, false, false]);
  assert.equal(tracker.setSpeaking(userId(1), false), true);
  assert.deepEqual(snap(tracker).miembros.map((m) => m.habla), [false, false, false]);
});

test('setSpeaking para alguien que no está en el canal devuelve false y no agrega nada', () => {
  const tracker = connectedTracker();
  tracker.setChannel(rawChannel('500', 'General', TRES));
  const before = snap(tracker);
  assert.equal(tracker.setSpeaking(userId(9), true), false);
  assert.equal(tracker.setSpeaking(42, true), false);
  assert.equal(tracker.setSpeaking(undefined, true), false);
  assert.deepEqual(snap(tracker), before);
});

test('cambiar de canal descarta miembros e indicadores de habla del anterior', () => {
  const tracker = connectedTracker();
  tracker.setChannel(rawChannel('500', 'General', TRES));
  tracker.setSpeaking(userId(1), true);
  tracker.setChannel(rawChannel('600', 'Otro', [rawState(userId(1), 'Ana'), rawState(userId(5), 'Elena')]));
  const state = snap(tracker);
  assert.deepEqual(state.canal, { nombre: 'Otro', total: 2 });
  assert.deepEqual(state.miembros.map((m) => [m.nombre, m.habla]), [['Ana', false], ['Elena', false]]);
  assert.equal(tracker.channelId, '600');
});

test('volver a leer el mismo canal conserva quién habla entre los que siguen', () => {
  const tracker = connectedTracker();
  tracker.setChannel(rawChannel('500', 'General', TRES));
  tracker.setSpeaking(userId(1), true);
  tracker.setSpeaking(userId(3), true);
  tracker.setChannel(rawChannel('500', 'General', TRES.slice(0, 2)));
  assert.deepEqual(snap(tracker).miembros.map((m) => m.habla), [true, false]);
  tracker.applyVoiceState('create', TRES[2]);
  assert.equal(snap(tracker).miembros[2]?.habla, false);
});

test('setChannel(null) deja canal nulo y sin miembros', () => {
  const tracker = connectedTracker();
  tracker.setChannel(rawChannel('500', 'General', TRES));
  tracker.setSpeaking(userId(1), true);
  assert.equal(tracker.setChannel(null), true);
  const state = snap(tracker);
  assert.equal(state.canal, null);
  assert.deepEqual(state.miembros, []);
  assert.equal(tracker.channelId, null);
});

test("setStatus('cerrado') y 'sin-autorizar' vacían canal, miembros y ajustes propios", () => {
  for (const status of ['cerrado', 'sin-autorizar'] as const) {
    const tracker = connectedTracker();
    tracker.setVoiceSettings({ mute: true, deaf: true });
    tracker.setChannel(rawChannel('500', 'General', TRES));
    tracker.setSpeaking(userId(1), true);
    tracker.setStatus(status);
    assert.deepEqual(snap(tracker), {
      v: 1,
      discord: status,
      canal: null,
      yo: { silenciado: false, ensordecido: false },
      miembros: [],
    });
    assert.equal(tracker.channelId, null);
    // Al reconectar no reaparece nada del canal anterior.
    tracker.setStatus('conectado');
    assert.deepEqual(snap(tracker).miembros, []);
  }
});

test('setVoiceSettings refleja mute y deaf en yo y en self', () => {
  const tracker = connectedTracker();
  assert.deepEqual(tracker.self, { mute: false, deaf: false });
  assert.equal(tracker.setVoiceSettings({ mute: true, deaf: false, otra: 'cosa' }), true);
  assert.deepEqual(tracker.self, { mute: true, deaf: false });
  assert.deepEqual(snap(tracker).yo, { silenciado: true, ensordecido: false });
  for (const invalid of [null, 'texto', {}, { mute: 'si', deaf: false }, { mute: true }]) {
    assert.equal(tracker.setVoiceSettings(invalid), false, JSON.stringify(invalid));
  }
  assert.deepEqual(tracker.self, { mute: true, deaf: false });
});

test('la clave es opaca, depende de la sal y el id real no sale en el estado', () => {
  const a = connectedTracker('sal-a');
  const b = connectedTracker('sal-b');
  const channel = rawChannel('500777000', 'General', [...TRES, rawState(SELF_ID, 'yo')]);
  a.setChannel(channel);
  b.setChannel(channel);
  const stateA = snap(a);
  const stateB = snap(b);
  for (const member of stateA.miembros) assert.match(member.clave, /^[0-9a-f]{8}$/);
  assert.equal(new Set(stateA.miembros.map((m) => m.clave)).size, 4);
  assert.notDeepEqual(stateA.miembros.map((m) => m.clave), stateB.miembros.map((m) => m.clave));
  const text = JSON.stringify(stateA);
  for (const id of [userId(1), userId(2), userId(3), SELF_ID, '500777000']) assert.ok(!text.includes(id));
  // La clave es estable mientras dure la sesión.
  a.applyVoiceState('update', rawState(userId(1), 'ana_usuario', { nick: 'Ana', mute: true }));
  assert.equal(snap(a).miembros[1]?.clave, stateA.miembros[1]?.clave);
});

test('datos inválidos devuelven false y no cambian el estado', () => {
  const tracker = connectedTracker();
  tracker.setChannel(rawChannel('500', 'General', TRES));
  const before = snap(tracker);
  const sinId = { user: { username: 'x' }, voice_state: { mute: false, deaf: false, self_mute: false, self_deaf: false } };
  const muteTexto = { user: { id: userId(7), username: 'x' }, voice_state: { mute: 'no', deaf: false, self_mute: false, self_deaf: false } };

  assert.equal(tracker.setChannel('texto'), false);
  assert.equal(tracker.setChannel(undefined), false);
  assert.equal(tracker.setChannel({ id: '600', name: 'Sin estados' }), false);
  assert.equal(tracker.setChannel({ id: 600, name: 'Id numérico', voice_states: [] }), false);
  assert.equal(tracker.setChannel({ id: '600', voice_states: [] }), false);
  assert.equal(tracker.setChannel(rawChannel('600', 'Con uno malo', [TRES[0], sinId])), false);
  assert.equal(tracker.setChannel(rawChannel('600', 'Con uno malo', [TRES[0], muteTexto])), false);
  for (const kind of ['create', 'update', 'delete'] as const) {
    assert.equal(tracker.applyVoiceState(kind, 'texto'), false);
    assert.equal(tracker.applyVoiceState(kind, null), false);
    assert.equal(tracker.applyVoiceState(kind, sinId), false);
  }
  assert.equal(tracker.applyVoiceState('create', muteTexto), false);
  assert.equal(tracker.applyVoiceState('update', { user: { id: userId(1), username: 5 }, voice_state: muteTexto.voice_state }), false);
  assert.equal(tracker.applyVoiceState('delete', rawState(userId(9), 'No estaba')), false);

  assert.deepEqual(snap(tracker), before);
  assert.equal(tracker.channelId, '500');
});

test('el nombre propio por defecto es You', () => {
  const tracker = new VoiceStateTracker('sal');
  tracker.setStatus('conectado');
  tracker.setSelfId(SELF_ID);
  tracker.setChannel(rawChannel('500', 'General', [...TRES, rawState(SELF_ID, 'mi_usuario')]));
  assert.equal(snap(tracker).miembros[0]?.nombre, 'You');
});
