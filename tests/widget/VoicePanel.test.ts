import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LANGS, STRINGS, type Lang } from '../../src/shared/i18n.ts';
import { VoicePanel } from '../../src/widget/components/VoicePanel.ts';
import { PhoneBoxClient, type PanelView } from '../../src/widget/services/PhoneBoxClient.ts';
import type { Member, VoiceState } from '../../src/shared/models/VoiceState.ts';
import { fakeDom, type FakeElement } from '../helpers/fakeDom.ts';

function member(clave: string, nombre: string, extra: Partial<Member> = {}): Member {
  return { clave, nombre, habla: false, silenciado: false, ensordecido: false, ...extra };
}

const EN_CANAL: VoiceState = {
  v: 1,
  discord: 'conectado',
  canal: { nombre: 'General', total: 3 },
  yo: { silenciado: false, ensordecido: false },
  miembros: [member('00000001', 'Tú'), member('00000002', 'Ana', { habla: true }), member('00000003', 'Bruno', { silenciado: true })],
};

const FUERA: VoiceState = { ...EN_CANAL, canal: null, miembros: [] };

function setup(lang: Lang = 'en') {
  const { doc, root, fakeRoot } = fakeDom();
  const ran: string[] = [];
  const client = new PhoneBoxClient({ on: () => {}, run: (id) => ran.push(id) });
  const panel = new VoicePanel(doc, root, client, STRINGS[lang]);
  return { panel, root: fakeRoot, ran };
}

function button(root: FakeElement, text: string): FakeElement | undefined {
  return root.querySelectorAll('button').find((b) => b.textContent === text);
}

function rows(root: FakeElement): FakeElement[] {
  return root.querySelectorAll('.miembro');
}

function views(lang: Lang): Array<[PanelView, string]> {
  const t = STRINGS[lang];
  return [
    [{ kind: 'sin-conexion' }, t.noConnection],
    [{ kind: 'cerrado' }, t.closed],
    [{ kind: 'sin-autorizar' }, t.notAuthorized],
    [{ kind: 'conectado', state: FUERA }, t.notInChannel],
    [{ kind: 'conectado', state: EN_CANAL }, t.inVoice(3)],
  ];
}

const LITERALES: Record<Lang, { closed: string; open: string }> = {
  en: { closed: 'Discord is closed', open: 'Open Discord' },
  es: { closed: 'Discord está cerrado', open: 'Abrir Discord' },
};

for (const lang of LANGS) {
  test(`[${lang}] la vista cerrada usa los textos literales del idioma`, () => {
    const { panel, root } = setup(lang);
    panel.render({ kind: 'cerrado' });
    assert.ok(root.textContent.includes(LITERALES[lang].closed));
    assert.ok(button(root, LITERALES[lang].open));
  });

  test(`[${lang}] cada vista muestra su texto exacto`, () => {
    for (const [view, text] of views(lang)) {
      const { panel, root } = setup(lang);
      panel.render(view);
      assert.ok(root.textContent.includes(text), `${view.kind}: falta "${text}" en "${root.textContent}"`);
    }
  });

  test(`[${lang}] los botones reflejan el estado propio`, () => {
    const t = STRINGS[lang];
    const { panel, root } = setup(lang);
    panel.render({ kind: 'conectado', state: EN_CANAL });
    assert.ok(button(root, t.mute));
    assert.ok(button(root, t.deafen));
    panel.render({ kind: 'conectado', state: { ...EN_CANAL, yo: { silenciado: true, ensordecido: true } } });
    assert.ok(button(root, t.muted)?.classList.contains('activo'));
    assert.ok(button(root, t.deafened)?.classList.contains('activo'));
    assert.equal(button(root, t.mute), undefined);
    panel.render({ kind: 'conectado', state: EN_CANAL });
    assert.ok(!button(root, t.mute)?.classList.contains('activo'));
  });

  test(`[${lang}] cada botón pide su acceso directo`, () => {
    const t = STRINGS[lang];
    const { panel, root, ran } = setup(lang);
    panel.render({ kind: 'conectado', state: EN_CANAL });
    button(root, t.mute)?.click();
    button(root, t.deafen)?.click();
    button(root, t.hangUp)?.click();
    panel.render({ kind: 'cerrado' });
    button(root, t.openDiscord)?.click();
    assert.deepEqual(ran, ['discord-mute', 'discord-deafen', 'discord-hangup', 'discord-open']);
  });

  test(`[${lang}] colgar solo existe dentro de un canal y abrir Discord solo con Discord cerrado`, () => {
    const t = STRINGS[lang];
    for (const [view] of views(lang)) {
      const { panel, root } = setup(lang);
      panel.render(view);
      const inChannel = view.kind === 'conectado' && view.state.canal !== null;
      assert.equal(button(root, t.hangUp) !== undefined, inChannel, `${t.hangUp} en ${view.kind}`);
      assert.equal(button(root, t.openDiscord) !== undefined, view.kind === 'cerrado', `${t.openDiscord} en ${view.kind}`);
    }
  });

  test(`[${lang}] con 12 miembros y total 15 muestra 12 filas y el total`, () => {
    const { panel, root } = setup(lang);
    const miembros = Array.from({ length: 12 }, (_, i) => member(String(i).padStart(8, '0'), `Persona ${i + 1}`));
    panel.render({ kind: 'conectado', state: { ...EN_CANAL, canal: { nombre: 'General', total: 15 }, miembros } });
    assert.equal(rows(root).length, 12);
    assert.ok(root.textContent.includes(STRINGS[lang].inVoice(15)));
  });
}

test('en un canal muestra nombre, filas, quién habla y quién está silenciado', () => {
  const { panel, root } = setup();
  panel.render({ kind: 'conectado', state: EN_CANAL });
  assert.ok(root.textContent.includes('General'));
  const list = rows(root);
  assert.equal(list.length, 3);
  assert.deepEqual(list.map((row) => row.querySelector('.nombre')?.textContent), ['Tú', 'Ana', 'Bruno']);
  assert.ok(list[1]?.classList.contains('habla'));
  assert.ok(!list[0]?.classList.contains('habla'));
  assert.ok(list[2]?.classList.contains('silenciado'));
  assert.ok(list[2]?.querySelector('.indicador-silencio'));
  assert.equal(list[1]?.querySelector('.indicador-silencio'), null);
});

test('fuera de un canal siguen silenciar y ensordecer', () => {
  const { panel, root } = setup();
  panel.render({ kind: 'conectado', state: FUERA });
  assert.ok(button(root, STRINGS.en.mute));
  assert.ok(button(root, STRINGS.en.deafen));
  assert.equal(rows(root).length, 0);
});

test('un nombre con HTML se muestra como texto literal', () => {
  const { panel, root } = setup();
  const name = '<img src=x onerror=alert(1)>';
  panel.render({
    kind: 'conectado',
    state: { ...EN_CANAL, canal: { nombre: '<b>Sala</b>', total: 1 }, miembros: [member('00000009', name)] },
  });
  assert.equal(rows(root)[0]?.querySelector('.nombre')?.textContent, name);
  assert.ok(root.textContent.includes('<b>Sala</b>'));
  assert.equal(root.querySelectorAll('img').length, 0);
  assert.equal(root.querySelectorAll('b').length, 0);
});

test('renderizar dos veces no duplica filas ni botones', () => {
  const { panel, root } = setup();
  panel.render({ kind: 'conectado', state: EN_CANAL });
  panel.render({ kind: 'conectado', state: EN_CANAL });
  assert.equal(rows(root).length, 3);
  assert.equal(root.querySelectorAll('button').length, 3);
});

test('nombres raros se dibujan sin lanzar y con inicial', () => {
  const { panel, root } = setup();
  const long = 'x'.repeat(32);
  panel.render({
    kind: 'conectado',
    state: { ...EN_CANAL, miembros: [member('00000001', '?'), member('00000002', long), member('00000003', '😀 Emo'), member('00000004', 'ana')] },
  });
  const list = rows(root);
  assert.deepEqual(list.map((row) => row.querySelector('.nombre')?.textContent), ['?', long, '😀 Emo', 'ana']);
  assert.deepEqual(list.map((row) => row.querySelector('.inicial')?.textContent), ['?', 'X', '😀', 'A']);
});
