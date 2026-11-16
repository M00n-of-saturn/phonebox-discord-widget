/** Estado de voz que el bridge publica y el widget dibuja. Ver docs/2026-11-15-diseno-panel-de-voz.md */

export const DISCORD_STATUSES = ['conectado', 'cerrado', 'sin-autorizar'] as const;
export type DiscordStatus = (typeof DISCORD_STATUSES)[number];

export interface Member {
  /** Identificador opaco por sesión; nunca el id real de Discord. */
  clave: string;
  nombre: string;
  habla: boolean;
  silenciado: boolean;
  ensordecido: boolean;
}

export interface VoiceState {
  v: 1;
  discord: DiscordStatus;
  canal: { nombre: string; total: number } | null;
  yo: { silenciado: boolean; ensordecido: boolean };
  miembros: Member[];
}

export const MAX_MEMBERS = 12;
export const MAX_NAME = 32;
export const PUSH_KEY = 'discord-voice';

const UNUSABLE_NAME = '?';
const INVISIBLE = /[\p{Cc}\p{Cf}]/gu;
const KEY_FORMAT = /^[0-9a-f]{8}$/;

/**
 * Convierte un nombre que viene de Discord en texto seguro de mostrar: sin caracteres de control
 * ni de formato, sin espacios en los extremos y de hasta MAX_NAME puntos de código.
 * No escapa HTML: eso lo garantiza el widget al dibujar con textContent.
 */
export function sanitizeName(raw: unknown): string {
  if (typeof raw !== 'string') return UNUSABLE_NAME;
  const visible = raw.replace(INVISIBLE, '').trim();
  const cut = Array.from(visible).slice(0, MAX_NAME).join('').trim();
  return cut.length > 0 ? cut : UNUSABLE_NAME;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Un nombre es válido si ya está saneado: sanearlo de nuevo no lo cambia. */
function isCleanName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && sanitizeName(value) === value;
}

function parseMember(raw: unknown): Member | null {
  if (!isRecord(raw)) return null;
  const { clave, nombre, habla, silenciado, ensordecido } = raw;
  if (typeof clave !== 'string' || !KEY_FORMAT.test(clave)) return null;
  if (!isCleanName(nombre)) return null;
  if (typeof habla !== 'boolean' || typeof silenciado !== 'boolean' || typeof ensordecido !== 'boolean') return null;
  return { clave, nombre, habla, silenciado, ensordecido };
}

function parseChannel(raw: unknown): VoiceState['canal'] | undefined {
  if (raw === null) return null;
  if (!isRecord(raw)) return undefined;
  const { nombre, total } = raw;
  if (!isCleanName(nombre)) return undefined;
  if (typeof total !== 'number' || !Number.isInteger(total) || total < 0) return undefined;
  return { nombre, total };
}

/**
 * Valida un dato de origen no confiable y devuelve un VoiceState con solo los campos conocidos,
 * o null si algo no cumple el formato.
 */
export function parseVoiceState(raw: unknown): VoiceState | null {
  if (!isRecord(raw)) return null;
  if (raw.v !== 1) return null;

  const discord = DISCORD_STATUSES.find((status) => status === raw.discord);
  if (discord === undefined) return null;

  const canal = parseChannel(raw.canal);
  if (canal === undefined) return null;

  const yo = raw.yo;
  if (!isRecord(yo) || typeof yo.silenciado !== 'boolean' || typeof yo.ensordecido !== 'boolean') return null;

  if (!Array.isArray(raw.miembros) || raw.miembros.length > MAX_MEMBERS) return null;
  const miembros: Member[] = [];
  for (const item of raw.miembros) {
    const member = parseMember(item);
    if (member === null) return null;
    miembros.push(member);
  }

  return { v: 1, discord, canal, yo: { silenciado: yo.silenciado, ensordecido: yo.ensordecido }, miembros };
}
