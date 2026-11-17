/** Textos de la interfaz del widget y nombre propio del bridge, en inglés (por defecto) y español. */

export const LANGS = ['en', 'es'] as const;
export type Lang = (typeof LANGS)[number];

export interface Strings {
  noConnection: string;
  closed: string;
  notAuthorized: string;
  notInChannel: string;
  inVoice(n: number): string;
  mute: string;
  muted: string;
  deafen: string;
  deafened: string;
  hangUp: string;
  openDiscord: string;
  you: string;
}

export const STRINGS: Record<Lang, Strings> = {
  en: {
    noConnection: 'No connection to the PC',
    closed: 'Discord is closed',
    notAuthorized: 'Authorization missing: run "pnpm run setup" on the PC',
    notInChannel: 'You are not in a voice channel',
    inVoice: (n) => `${n} in voice`,
    mute: 'Mute',
    muted: 'Muted',
    deafen: 'Deafen',
    deafened: 'Deafened',
    hangUp: 'Hang up',
    openDiscord: 'Open Discord',
    you: 'You',
  },
  es: {
    noConnection: 'Sin conexión con la PC',
    closed: 'Discord está cerrado',
    notAuthorized: 'Falta autorizar: ejecuta "pnpm run setup" en la PC',
    notInChannel: 'No estás en un canal de voz',
    inVoice: (n) => `${n} en voz`,
    mute: 'Silenciar',
    muted: 'Silenciado',
    deafen: 'Ensordecer',
    deafened: 'Ensordecido',
    hangUp: 'Colgar',
    openDiscord: 'Abrir Discord',
    you: 'Tú',
  },
};

/** Solo 'en' y 'es' exactos; cualquier otra cosa cae en inglés. */
export function parseLang(raw: unknown): Lang {
  return LANGS.find((lang) => lang === raw) ?? 'en';
}

/** Lee `--lang es` o `--lang=es` de los argumentos; si no hay o no es válido, 'en'. */
export function langFromArgs(argv: readonly string[]): Lang {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--lang') return parseLang(argv[i + 1]);
    if (arg?.startsWith('--lang=')) return parseLang(arg.slice('--lang='.length));
  }
  return 'en';
}
