// Envuelve window.phonebox: convierte el mapa de datos empujados en una vista y detecta datos caducados.
// Todo lo que llega se valida con parseVoiceState; un dato dudoso se trata como falta de conexión.

import { PUSH_KEY, parseVoiceState, type VoiceState } from '../../shared/models/VoiceState.ts';

export interface PhoneBoxApi {
  on(kind: string, handler: (value: unknown) => void): void;
  run(id: string): void;
}

export type ShortcutId = 'discord-mute' | 'discord-deafen' | 'discord-hangup' | 'discord-open';

export type PanelView =
  | { kind: 'sin-conexion' }
  | { kind: 'cerrado' }
  | { kind: 'sin-autorizar' }
  | { kind: 'conectado'; state: VoiceState };

const DEFAULT_STALE_MS = 15_000;
const NO_CONNECTION: PanelView = { kind: 'sin-conexion' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function viewOf(state: VoiceState): PanelView {
  if (state.discord === 'conectado') return { kind: 'conectado', state };
  return { kind: state.discord };
}

export class PhoneBoxClient {
  readonly #api: PhoneBoxApi;
  readonly #staleMs: number;
  #handlers: Array<(view: PanelView) => void> = [];
  #view: PanelView = NO_CONNECTION;
  #lastAt: unknown = undefined;
  #fresh = false;
  #staleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(api: PhoneBoxApi, opts: { staleMs?: number } = {}) {
    this.#api = api;
    this.#staleMs = opts.staleMs ?? DEFAULT_STALE_MS;
    api.on('push', (value) => this.#onPush(value));
  }

  /** El manejador recibe la vista actual de inmediato y luego cada cambio. */
  onView(handler: (view: PanelView) => void): void {
    this.#handlers.push(handler);
    handler(this.#view);
  }

  run(id: ShortcutId): void {
    this.#api.run(id);
  }

  #onPush(value: unknown): void {
    const entry = isRecord(value) ? value[PUSH_KEY] : undefined;
    const state = isRecord(entry) ? parseVoiceState(entry.data) : null;
    if (!isRecord(entry) || state === null) {
      this.#emit(NO_CONNECTION);
      return;
    }
    // La frescura se mide con un temporizador propio: el reloj del teléfono no tiene por qué coincidir con el de la PC.
    if (entry.at !== this.#lastAt) {
      this.#lastAt = entry.at;
      this.#fresh = true;
      if (this.#staleTimer !== null) clearTimeout(this.#staleTimer);
      this.#staleTimer = setTimeout(() => {
        this.#fresh = false;
        this.#emit(NO_CONNECTION);
      }, this.#staleMs);
    }
    this.#emit(this.#fresh ? viewOf(state) : NO_CONNECTION);
  }

  #emit(view: PanelView): void {
    this.#view = view;
    for (const handler of this.#handlers) handler(view);
  }
}
