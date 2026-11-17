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

// Idiomas del panel. Los scripts no importan de src/, así que tienen su propia lista.
const LANGS = ['en', 'es'];
const LANG_MARK = 'data-lang="en"';

/** Fija el idioma en el HTML del widget; exige que la marca por defecto aparezca exactamente una vez. */
export function setWidgetLang(html, lang) {
  if (!LANGS.includes(lang)) throw new Error(`idioma no válido: ${lang}`);
  if (html.split(LANG_MARK).length !== 2) throw new Error(`el HTML del widget debe contener ${LANG_MARK} exactamente una vez`);
  return html.replace(LANG_MARK, `data-lang="${lang}"`);
}

/**
 * Idioma con el que quedó instalado el servicio (argumento --lang de ExecStart).
 * Sin unidad (null): null, primera instalación. Unidad con --lang en|es: ese idioma.
 * Unidad sin --lang: instalación anterior a esta opción, todas eran en español, así que 'es'.
 * Un valor no válido (--lang fr) da null.
 */
export function langFromUnit(unitText) {
  if (typeof unitText !== 'string') return null;
  const line = unitText.split('\n').find((l) => l.startsWith('ExecStart='));
  const match = line?.match(/(?:^|\s)--lang(?:=|\s+)(\S+)/);
  if (!match) return 'es';
  return LANGS.includes(match[1]) ? match[1] : null;
}

/** Interpreta los argumentos del instalador. Sin --lang conserva el idioma actual (o en). Lanza Error si algo no vale. */
export function parseInstallArgs(args, current) {
  let uninstall = false;
  let lang = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--uninstall') {
      uninstall = true;
      continue;
    }
    if (arg !== '--lang' && !arg.startsWith('--lang=')) throw new Error(`opción desconocida: ${arg}`);
    if (lang !== null) throw new Error('--lang se indicó más de una vez');
    const value = arg === '--lang' ? args[++i] : arg.slice('--lang='.length);
    if (!LANGS.includes(value)) throw new Error('--lang debe ser en o es');
    lang = value;
  }
  if (uninstall && lang !== null) throw new Error('--lang no se combina con --uninstall');
  return uninstall ? { uninstall: true } : { uninstall: false, lang: lang ?? current ?? 'en' };
}
