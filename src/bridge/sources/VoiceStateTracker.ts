// Traduce los datos crudos que manda Discord a un VoiceState validado. Clase pura: sin entrada ni salida.

import { createHash } from 'node:crypto';
import { STRINGS } from '../../shared/i18n.ts';
import { MAX_MEMBERS, sanitizeName, type DiscordStatus, type Member, type VoiceState } from '../../shared/models/VoiceState.ts';

interface TrackedMember {
  id: string;
  nombre: string;
  silenciado: boolean;
  ensordecido: boolean;
}

interface TrackedChannel {
  id: string;
  nombre: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'string';
}

/** Valida un estado de voz crudo de Discord; null si no cumple la forma esperada. */
function parseRawMember(raw: unknown): TrackedMember | null {
  if (!isRecord(raw)) return null;
  const { nick, user, voice_state: voice } = raw;
  if (!isRecord(user) || !isRecord(voice)) return null;
  const { id, username, global_name: globalName } = user;
  if (typeof id !== 'string' || id.length === 0 || typeof username !== 'string') return null;
  if (!isOptionalString(nick) || !isOptionalString(globalName)) return null;
  const { mute, deaf, self_mute: selfMute, self_deaf: selfDeaf } = voice;
  if (typeof mute !== 'boolean' || typeof deaf !== 'boolean') return null;
  if (typeof selfMute !== 'boolean' || typeof selfDeaf !== 'boolean') return null;

  const visible = [nick, globalName, username].find((name) => typeof name === 'string' && name.length > 0);
  return { id, nombre: sanitizeName(visible ?? username), silenciado: mute || selfMute, ensordecido: deaf || selfDeaf };
}

export class VoiceStateTracker {
  readonly #salt: string;
  readonly #keys = new Map<string, string>();
  #status: DiscordStatus = 'cerrado';
  #selfId: string | null = null;
  #self = { mute: false, deaf: false };
  #channel: TrackedChannel | null = null;
  /** En el orden en que llegaron; el propio usuario se reordena al tomar la instantánea. */
  #members: TrackedMember[] = [];
  #speaking = new Set<string>();
  readonly #selfName: string;

  constructor(salt: string, selfName: string = STRINGS.en.you) {
    this.#salt = salt;
    this.#selfName = selfName;
  }

  setStatus(status: DiscordStatus): void {
    this.#status = status;
    if (status !== 'conectado') {
      this.#clearChannel();
      this.#self = { mute: false, deaf: false };
    }
  }

  setSelfId(id: string | null): void {
    this.#selfId = id;
  }

  setVoiceSettings(raw: unknown): boolean {
    if (!isRecord(raw) || typeof raw.mute !== 'boolean' || typeof raw.deaf !== 'boolean') return false;
    this.#self = { mute: raw.mute, deaf: raw.deaf };
    return true;
  }

  /** null = fuera de un canal. Leer de nuevo el mismo canal conserva quién habla entre los que siguen. */
  setChannel(raw: unknown): boolean {
    if (raw === null) {
      this.#clearChannel();
      return true;
    }
    if (!isRecord(raw)) return false;
    const { id, name, voice_states: states } = raw;
    if (typeof id !== 'string' || id.length === 0 || typeof name !== 'string' || !Array.isArray(states)) return false;

    const members: TrackedMember[] = [];
    for (const item of states) {
      const member = parseRawMember(item);
      if (member === null) return false;
      const index = members.findIndex((m) => m.id === member.id);
      if (index === -1) members.push(member);
      else members[index] = member;
    }

    const sameChannel = this.#channel?.id === id;
    const present = new Set(members.map((m) => m.id));
    this.#speaking = sameChannel ? new Set([...this.#speaking].filter((userId) => present.has(userId))) : new Set();
    this.#channel = { id, nombre: sanitizeName(name) };
    this.#members = members;
    return true;
  }

  applyVoiceState(kind: 'create' | 'update' | 'delete', raw: unknown): boolean {
    if (this.#channel === null) return false;
    const member = parseRawMember(raw);
    if (member === null) return false;
    const index = this.#members.findIndex((m) => m.id === member.id);

    if (kind === 'delete') {
      if (index === -1) return false;
      this.#members.splice(index, 1);
      this.#speaking.delete(member.id);
      return true;
    }
    // Discord puede mandar 'update' de alguien que aún no vimos: se trata como alta.
    if (index === -1) this.#members.push(member);
    else this.#members[index] = member;
    return true;
  }

  setSpeaking(userId: unknown, speaking: boolean): boolean {
    if (typeof userId !== 'string' || !this.#members.some((m) => m.id === userId)) return false;
    if (speaking) this.#speaking.add(userId);
    else this.#speaking.delete(userId);
    return true;
  }

  get self(): { mute: boolean; deaf: boolean } {
    return { ...this.#self };
  }

  get channelId(): string | null {
    return this.#channel?.id ?? null;
  }

  snapshot(): VoiceState {
    const own = this.#members.filter((m) => m.id === this.#selfId);
    const others = this.#members.filter((m) => m.id !== this.#selfId);
    const miembros: Member[] = [...own, ...others].slice(0, MAX_MEMBERS).map((m) => ({
      clave: this.#keyFor(m.id),
      nombre: m.id === this.#selfId ? this.#selfName : m.nombre,
      habla: this.#speaking.has(m.id),
      silenciado: m.silenciado,
      ensordecido: m.ensordecido,
    }));
    return {
      v: 1,
      discord: this.#status,
      canal: this.#channel === null ? null : { nombre: this.#channel.nombre, total: this.#members.length },
      yo: { silenciado: this.#self.mute, ensordecido: this.#self.deaf },
      miembros,
    };
  }

  #clearChannel(): void {
    this.#channel = null;
    this.#members = [];
    this.#speaking = new Set();
  }

  #keyFor(id: string): string {
    let key = this.#keys.get(id);
    if (key === undefined) {
      key = createHash('sha256').update(this.#salt + id).digest('hex').slice(0, 8);
      this.#keys.set(id, key);
    }
    return key;
  }
}
