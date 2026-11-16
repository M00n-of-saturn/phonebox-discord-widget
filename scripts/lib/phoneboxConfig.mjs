// Cambios puros sobre la configuración de PhoneBox (la que devuelve GET /api/settings).
// Nunca mutan la entrada: devuelven una copia.

const PREFIX = 'discord-';
const PAGE_ID = 'discord';
const UNSAFE_PATH = /[\s"'`\\$;&|<>]/;

function shortcutsFor(nodePath, ctlPath) {
  const ctl = (label, icon, color, id, command) => ({ id, label, icon, color, cmd: nodePath, args: `${ctlPath} ${command}`, toggle: false });
  return [
    ctl('Discord: silenciar', '🎙️', '#5865f2', 'discord-mute', 'alternar-silencio'),
    ctl('Discord: ensordecer', '🎧', '#5865f2', 'discord-deafen', 'alternar-ensordecer'),
    ctl('Discord: colgar', '📞', '#ef4444', 'discord-hangup', 'colgar'),
    { id: 'discord-open', label: 'Abrir Discord', icon: '🎮', color: '#5865f2', cmd: 'discord', toggle: false },
  ];
}

function page(html) {
  return {
    id: PAGE_ID,
    title: 'Discord',
    icon: '🎮',
    enabled: true,
    widgets: [{ id: 'discord-voice', type: 'html', x: 0, y: 0, w: 12, h: 6, options: { html, transparent: false } }],
  };
}

/** PhoneBox separa los argumentos por espacios: una ruta con espacios o comillas se partiría mal. */
function checkPath(name, value) {
  if (typeof value !== 'string' || !value.startsWith('/') || UNSAFE_PATH.test(value)) {
    throw new Error(`${name} debe ser una ruta absoluta sin espacios, comillas ni caracteres especiales`);
  }
}

function checkShape(config) {
  if (typeof config !== 'object' || config === null || !Array.isArray(config.shortcuts) || !Array.isArray(config.pages)) {
    throw new Error('la configuración de PhoneBox no tiene las listas shortcuts y pages');
  }
}

function upsertById(list, item) {
  const index = list.findIndex((existing) => existing?.id === item.id);
  if (index === -1) list.push(item);
  else list[index] = item;
}

function shortcutWidgets(config) {
  return config.pages.flatMap((p) => (Array.isArray(p?.widgets) ? p.widgets : [])).filter((w) => w?.type === 'shortcuts');
}

function sameList(a, b) {
  return Array.isArray(a) && a.length === b.length && a.every((value, index) => value === b[index]);
}

/** Agrega o reemplaza los accesos directos y la página del widget; el resto queda igual. */
export function applyWidget(config, { html, nodePath, ctlPath }) {
  checkShape(config);
  checkPath('nodePath', nodePath);
  checkPath('ctlPath', ctlPath);
  if (typeof html !== 'string' || html === '') throw new Error('falta el HTML del widget');

  const next = structuredClone(config);
  for (const shortcut of shortcutsFor(nodePath, ctlPath)) upsertById(next.shortcuts, shortcut);

  // Un widget "shortcuts" sin lista muestra todos; se le fija la lista previa para que no aparezcan los nuevos.
  const others = next.shortcuts.map((s) => s.id).filter((id) => !String(id).startsWith(PREFIX));
  for (const widget of shortcutWidgets(next)) {
    widget.options ??= {};
    const current = widget.options.ids;
    if (!Array.isArray(current) || current.length === 0) widget.options.ids = others;
  }

  upsertById(next.pages, page(html));
  return next;
}

/** Revierte applyWidget. Una lista de ids que el usuario cambió después se respeta. */
export function removeWidget(config) {
  checkShape(config);
  const next = structuredClone(config);
  const installed = next.pages.some((p) => p?.id === PAGE_ID) || next.shortcuts.some((s) => String(s?.id).startsWith(PREFIX));
  if (!installed) return next;

  next.shortcuts = next.shortcuts.filter((s) => !String(s?.id).startsWith(PREFIX));
  next.pages = next.pages.filter((p) => p?.id !== PAGE_ID);
  const all = next.shortcuts.map((s) => s.id);
  for (const widget of shortcutWidgets(next)) {
    if (sameList(widget.options?.ids, all)) delete widget.options.ids;
  }
  return next;
}
