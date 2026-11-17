import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyWidget, langFromUnit, parseInstallArgs, removeWidget, setWidgetLang } from '../../scripts/lib/phoneboxConfig.mjs';

const ORIGINAL_IDS = ['terminal', 'files', 'vscode', 'browser', 'music', 'calc', 'settings', 'monitor', 'mute', 'monitoroff', 'lock'];
const OPTS = { html: '<style></style><main></main><script></script>', nodePath: '/usr/bin/node', ctlPath: '/home/ana/widget/dist/ctl.js' };

function fakeConfig() {
  return {
    display: { brightness: 50 },
    shortcuts: ORIGINAL_IDS.map((id) => ({ id, label: id, icon: '⭐', color: '#000000', cmd: id, toggle: false })),
    pages: [
      { id: 'home', title: 'Home', icon: '🏠', enabled: true, widgets: [{ id: 'clock', type: 'clock', x: 0, y: 0, w: 6, h: 4, options: {} }] },
      { id: 'deck', title: 'Shortcuts', icon: '🎛️', enabled: true, widgets: [{ id: 'shortcuts', type: 'shortcuts', x: 0, y: 0, w: 12, h: 6, options: { columns: 4 } }] },
      {
        id: 'mini',
        title: 'Mini',
        icon: '⭐',
        enabled: true,
        widgets: [{ id: 'sc', type: 'shortcuts', x: 0, y: 0, w: 4, h: 2, options: { ids: ['lock', 'mute'] } }],
      },
    ],
  };
}

function ids(config: { shortcuts: Array<{ id: string }> }): string[] {
  return config.shortcuts.map((s) => s.id);
}

test('agrega los cuatro accesos directos con ctl y la ruta de node', () => {
  const result = applyWidget(fakeConfig(), OPTS);
  assert.equal(result.shortcuts.length, 15);
  const byId = Object.fromEntries(result.shortcuts.map((s: { id: string }) => [s.id, s]));
  assert.equal(byId['discord-mute'].cmd, '/usr/bin/node');
  assert.equal(byId['discord-mute'].args, '/home/ana/widget/dist/ctl.js alternar-silencio');
  assert.equal(byId['discord-deafen'].args, '/home/ana/widget/dist/ctl.js alternar-ensordecer');
  assert.equal(byId['discord-hangup'].args, '/home/ana/widget/dist/ctl.js colgar');
  assert.equal(byId['discord-open'].cmd, 'discord');
  for (const id of ['discord-mute', 'discord-deafen', 'discord-hangup', 'discord-open']) {
    for (const key of ['label', 'icon', 'color']) assert.equal(typeof byId[id][key], 'string', `${id}.${key}`);
    assert.equal(byId[id].toggle, false);
  }
});

test('el widget shortcuts sin ids pasa a listar solo los 11 originales', () => {
  const result = applyWidget(fakeConfig(), OPTS);
  const deck = result.pages.find((p: { id: string }) => p.id === 'deck');
  assert.deepEqual(deck.widgets[0].options, { columns: 4, ids: ORIGINAL_IDS });
});

test('un widget shortcuts que ya tenía ids no se toca', () => {
  const result = applyWidget(fakeConfig(), OPTS);
  const mini = result.pages.find((p: { id: string }) => p.id === 'mini');
  assert.deepEqual(mini.widgets[0].options, { ids: ['lock', 'mute'] });
});

test('agrega la página discord con el html', () => {
  const result = applyWidget(fakeConfig(), OPTS);
  const page = result.pages.find((p: { id: string }) => p.id === 'discord');
  assert.deepEqual(page, {
    id: 'discord',
    title: 'Discord',
    icon: '🎮',
    enabled: true,
    widgets: [{ id: 'discord-voice', type: 'html', x: 0, y: 0, w: 12, h: 6, options: { html: OPTS.html, transparent: false } }],
  });
  assert.deepEqual(result.display, { brightness: 50 });
});

test('aplicar dos veces da lo mismo que una, y actualiza el html', () => {
  const once = applyWidget(fakeConfig(), OPTS);
  assert.deepEqual(applyWidget(once, OPTS), once);
  const updated = applyWidget(once, { ...OPTS, html: '<main>nuevo</main>' });
  assert.equal(updated.pages.filter((p: { id: string }) => p.id === 'discord').length, 1);
  assert.equal(updated.pages.find((p: { id: string }) => p.id === 'discord').widgets[0].options.html, '<main>nuevo</main>');
  assert.equal(updated.shortcuts.length, 15);
});

test('no muta la entrada', () => {
  const input = fakeConfig();
  const copy = structuredClone(input);
  applyWidget(input, OPTS);
  assert.deepEqual(input, copy);
});

test('rechaza rutas con espacios, comillas o relativas', () => {
  for (const bad of ['/ruta con espacio/node', '/ruta/"comilla"', "/ruta/'x'", '/ruta/`x`', 'node', '']) {
    assert.throws(() => applyWidget(fakeConfig(), { ...OPTS, nodePath: bad }), bad);
    assert.throws(() => applyWidget(fakeConfig(), { ...OPTS, ctlPath: bad }), bad);
  }
});

test('rechaza una configuración sin listas de accesos directos o páginas', () => {
  assert.throws(() => applyWidget({}, OPTS));
  assert.throws(() => applyWidget({ shortcuts: [], pages: 'x' }, OPTS));
});

test('removeWidget deja la configuración como estaba', () => {
  const original = fakeConfig();
  assert.deepEqual(removeWidget(applyWidget(original, OPTS)), original);
  // Sin el widget instalado no cambia nada.
  assert.deepEqual(removeWidget(original), original);
});

test('removeWidget respeta una lista de ids que el usuario cambió después', () => {
  const installed = applyWidget(fakeConfig(), OPTS);
  const deck = installed.pages.find((p: { id: string }) => p.id === 'deck');
  deck.widgets[0].options.ids = ['lock'];
  const removed = removeWidget(installed);
  assert.deepEqual(removed.pages.find((p: { id: string }) => p.id === 'deck').widgets[0].options.ids, ['lock']);
  assert.deepEqual(ids(removed), ORIGINAL_IDS);
});

test('setWidgetLang cambia el idioma del panel y es idempotente', () => {
  assert.equal(setWidgetLang('<main data-lang="en">', 'es'), '<main data-lang="es">');
  assert.equal(setWidgetLang('<main data-lang="en">', 'en'), '<main data-lang="en">');
});

test('setWidgetLang falla si la marca data-lang="en" no aparece exactamente una vez', () => {
  assert.throws(() => setWidgetLang('<main>', 'es'));
  assert.throws(() => setWidgetLang('<main data-lang="en"><i data-lang="en">', 'es'));
});

test('langFromUnit lee --lang de la línea ExecStart', () => {
  const unit = (exec: string) => `[Service]\nExecStart=${exec}\nRestart=on-failure\n`;
  assert.equal(langFromUnit(unit('/usr/bin/node /x/dist/bridge.js --lang es')), 'es');
  assert.equal(langFromUnit(unit('/usr/bin/node /x/dist/bridge.js --lang=en')), 'en');
  assert.equal(langFromUnit(null), null);
  // Unidad sin --lang: instalación anterior a esta opción, todas eran en español.
  assert.equal(langFromUnit(unit('/usr/bin/node /x/dist/bridge.js')), 'es');
  assert.equal(langFromUnit(unit('/usr/bin/node /x/dist/bridge.js --lang fr')), null);
  assert.equal(langFromUnit('[Unit]\nDescription=usa --lang es\n[Service]\nExecStart=/usr/bin/node /x\n'), 'es');
});

test('parseInstallArgs elige el idioma o conserva el actual', () => {
  assert.deepEqual(parseInstallArgs([], null), { uninstall: false, lang: 'en' });
  assert.deepEqual(parseInstallArgs([], 'es'), { uninstall: false, lang: 'es' });
  assert.deepEqual(parseInstallArgs(['--lang', 'es'], 'en'), { uninstall: false, lang: 'es' });
  assert.deepEqual(parseInstallArgs(['--lang=es'], null), { uninstall: false, lang: 'es' });
  assert.deepEqual(parseInstallArgs(['--uninstall'], 'es'), { uninstall: true });
});

test('parseInstallArgs rechaza entradas inválidas', () => {
  for (const args of [['--foo'], ['--lang'], ['--lang', 'ES'], ['--lang', 'fr'], ['--lang='], ['--lang=fr'], ['--lang', 'es', '--lang', 'en'], ['--lang', 'es', '--uninstall'], ['es']]) {
    assert.throws(() => parseInstallArgs(args, null), Error, args.join(' '));
  }
});
