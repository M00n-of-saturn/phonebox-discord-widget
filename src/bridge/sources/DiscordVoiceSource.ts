// Origen de voz de Discord: une la conexión local, los tokens y el traductor de estado, y reconecta solo.
// Los registros llevan tipo de evento y códigos; nunca nombres, ids ni tokens.

import type { Command } from '../../shared/models/Command.ts';
import type { VoiceState } from '../../shared/models/VoiceState.ts';
import type { VoiceSource } from './VoiceSource.ts';
import type { VoiceStateTracker } from './VoiceStateTracker.ts';

/** Lo cumple RpcClient; permite un doble en las pruebas. */
export interface RpcLike {
  connect(): Promise<void>;
  request(cmd: string, args?: object, evt?: string, timeoutMs?: number): Promise<unknown>;
  onEvent(handler: (evt: string, data: unknown) => void): void;
  onClose(handler: (reason: string) => void): void;
  close(): void;
}

export interface DiscordVoiceSourceOptions {
  /** null = Discord no está abierto. */
  createRpc: () => RpcLike | null;
  tokens: { refresh(): Promise<string | null> };
  tracker: VoiceStateTracker;
  retryMs?: number;
  log?: (message: string) => void;
}

const DEFAULT_RETRY_MS = 5000;
const CHANNEL_EVENTS = ['VOICE_STATE_CREATE', 'VOICE_STATE_UPDATE', 'VOICE_STATE_DELETE', 'SPEAKING_START', 'SPEAKING_STOP'] as const;
const VOICE_STATE_KINDS = {
  VOICE_STATE_CREATE: 'create',
  VOICE_STATE_UPDATE: 'update',
  VOICE_STATE_DELETE: 'delete',
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Describe un error sin su mensaje, que podría traer datos de Discord. */
function errorCode(error: unknown): string {
  if (isRecord(error) && typeof error.code === 'number') return `codigo-${error.code}`;
  return error instanceof Error ? error.name : 'desconocido';
}

export class DiscordVoiceSource implements VoiceSource {
  readonly #createRpc: () => RpcLike | null;
  readonly #tokens: { refresh(): Promise<string | null> };
  readonly #tracker: VoiceStateTracker;
  readonly #retryMs: number;
  readonly #log: (message: string) => void;
  #onChange: (state: VoiceState) => void = () => {};
  #rpc: RpcLike | null = null;
  /** Cada intento de conexión tiene su número; lo que llegue de un intento viejo se ignora. */
  #generation = 0;
  #authenticated = false;
  #stopped = false;
  #retryTimer: NodeJS.Timeout | null = null;
  /** Las lecturas de canal se hacen de a una para que las suscripciones no se crucen. */
  #channelQueue: Promise<void> = Promise.resolve();

  constructor(opts: DiscordVoiceSourceOptions) {
    this.#createRpc = opts.createRpc;
    this.#tokens = opts.tokens;
    this.#tracker = opts.tracker;
    this.#retryMs = opts.retryMs ?? DEFAULT_RETRY_MS;
    this.#log = opts.log ?? (() => {});
  }

  start(onChange: (state: VoiceState) => void): void {
    this.#onChange = onChange;
    this.#stopped = false;
    void this.#attempt();
  }

  async execute(command: Command): Promise<void> {
    const rpc = this.#rpc;
    if (!this.#authenticated || rpc === null) throw new Error('sin conexión con Discord');
    const generation = this.#generation;
    switch (command) {
      case 'alternar-silencio':
        this.#applySettings(generation, await rpc.request('SET_VOICE_SETTINGS', { mute: !this.#tracker.self.mute }), 'SET_VOICE_SETTINGS');
        return;
      case 'alternar-ensordecer':
        this.#applySettings(generation, await rpc.request('SET_VOICE_SETTINGS', { deaf: !this.#tracker.self.deaf }), 'SET_VOICE_SETTINGS');
        return;
      case 'colgar':
        await rpc.request('SELECT_VOICE_CHANNEL', { channel_id: null });
        return;
    }
  }

  stop(): void {
    this.#stopped = true;
    this.#generation++;
    this.#authenticated = false;
    if (this.#retryTimer !== null) clearTimeout(this.#retryTimer);
    this.#retryTimer = null;
    this.#rpc?.close();
    this.#rpc = null;
  }

  async #attempt(): Promise<void> {
    this.#retryTimer = null;
    if (this.#stopped) return;
    const generation = ++this.#generation;
    const rpc = this.#createRpc();
    if (rpc === null) {
      this.#end(generation, 'cerrado', 'discord-cerrado');
      return;
    }
    this.#rpc = rpc;
    rpc.onEvent((evt, data) => {
      if (generation === this.#generation) this.#onEvent(rpc, generation, evt, data);
    });
    rpc.onClose((reason) => this.#end(generation, 'cerrado', `conexion-perdida ${reason}`));

    try {
      await rpc.connect();
      const token = await this.#tokens.refresh();
      if (generation !== this.#generation) return;
      if (token === null) {
        this.#end(generation, 'sin-autorizar', 'sin-autorizar');
        return;
      }
      const auth = await rpc.request('AUTHENTICATE', { access_token: token });
      const user = isRecord(auth) ? auth.user : null;
      if (!isRecord(user) || typeof user.id !== 'string') throw new Error('respuesta-de-autenticacion-invalida');
      this.#tracker.setSelfId(user.id);
      if (!this.#tracker.setVoiceSettings(await rpc.request('GET_VOICE_SETTINGS'))) this.#log('dato-inesperado GET_VOICE_SETTINGS');
      await rpc.request('SUBSCRIBE', {}, 'VOICE_SETTINGS_UPDATE');
      await rpc.request('SUBSCRIBE', {}, 'VOICE_CHANNEL_SELECT');
      if (generation !== this.#generation) return;
      this.#authenticated = true;
      this.#tracker.setStatus('conectado');
      this.#log('conectado');
      await this.#queueChannelSync(rpc, generation, true);
      if (generation === this.#generation && this.#tracker.channelId === null) this.#emit();
    } catch (error) {
      this.#end(generation, 'cerrado', `fallo-al-conectar ${errorCode(error)}`);
    }
  }

  /** Cierra el intento actual, publica el estado y programa el siguiente. Solo actúa una vez por intento. */
  #end(generation: number, status: 'cerrado' | 'sin-autorizar', reason: string): void {
    if (generation !== this.#generation || this.#stopped) return;
    this.#generation++;
    this.#authenticated = false;
    this.#rpc?.close();
    this.#rpc = null;
    this.#log(reason);
    this.#tracker.setStatus(status);
    this.#emit();
    this.#retryTimer = setTimeout(() => void this.#attempt(), this.#retryMs);
  }

  #onEvent(rpc: RpcLike, generation: number, evt: string, data: unknown): void {
    if (evt === 'VOICE_SETTINGS_UPDATE') {
      this.#applySettings(generation, data, evt);
      return;
    }
    if (evt === 'VOICE_CHANNEL_SELECT') {
      if (!isRecord(data)) {
        this.#log(`dato-inesperado ${evt}`);
        return;
      }
      void this.#queueChannelSync(rpc, generation, data.channel_id !== null);
      return;
    }
    if (evt === 'SPEAKING_START' || evt === 'SPEAKING_STOP') {
      if (!isRecord(data) || typeof data.user_id !== 'string') {
        this.#log(`dato-inesperado ${evt}`);
        return;
      }
      if (typeof data.channel_id === 'string' && data.channel_id !== this.#tracker.channelId) return;
      if (this.#tracker.setSpeaking(data.user_id, evt === 'SPEAKING_START')) this.#emit();
      return;
    }
    if (evt === 'VOICE_STATE_CREATE' || evt === 'VOICE_STATE_UPDATE' || evt === 'VOICE_STATE_DELETE') {
      if (this.#tracker.applyVoiceState(VOICE_STATE_KINDS[evt], data)) this.#emit();
      else this.#log(`dato-inesperado ${evt}`);
    }
  }

  #applySettings(generation: number, data: unknown, source: string): void {
    if (generation !== this.#generation) return;
    if (this.#tracker.setVoiceSettings(data)) this.#emit();
    else this.#log(`dato-inesperado ${source}`);
  }

  /** inChannel = false evita la consulta: Discord ya avisó que no hay canal. */
  #queueChannelSync(rpc: RpcLike, generation: number, inChannel: boolean): Promise<void> {
    this.#channelQueue = this.#channelQueue
      .then(() => this.#syncChannel(rpc, generation, inChannel))
      .catch((error: unknown) => {
        if (generation === this.#generation) this.#log(`fallo-al-leer-canal ${errorCode(error)}`);
      });
    return this.#channelQueue;
  }

  async #syncChannel(rpc: RpcLike, generation: number, inChannel: boolean): Promise<void> {
    if (generation !== this.#generation) return;
    const data = inChannel ? await rpc.request('GET_SELECTED_VOICE_CHANNEL') : null;
    if (generation !== this.#generation) return;
    const previous = this.#tracker.channelId;
    if (!this.#tracker.setChannel(data ?? null)) {
      this.#log('dato-inesperado GET_SELECTED_VOICE_CHANNEL');
      return;
    }
    const current = this.#tracker.channelId;
    this.#emit();
    if (previous === current) return;
    if (previous !== null) {
      for (const evt of CHANNEL_EVENTS) await rpc.request('UNSUBSCRIBE', { channel_id: previous }, evt);
    }
    if (current !== null) {
      for (const evt of CHANNEL_EVENTS) await rpc.request('SUBSCRIBE', { channel_id: current }, evt);
    }
  }

  #emit(): void {
    this.#onChange(this.#tracker.snapshot());
  }
}
