// Publica el estado en el agente local de PhoneBox con un límite de envíos y un latido.
// Nunca lanza: si el agente está caído, el siguiente envío o latido vuelve a intentar.

import { PUSH_KEY, type VoiceState } from '../../shared/models/VoiceState.ts';

export interface PhoneBoxPublisherOptions {
  baseUrl?: string;
  fetchFn: typeof fetch;
  minIntervalMs?: number;
  heartbeatMs?: number;
  ttlSec?: number;
  log?: (message: string) => void;
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);
const REQUEST_TIMEOUT_MS = 3000;

export class PhoneBoxPublisher {
  readonly #url: string;
  readonly #fetchFn: typeof fetch;
  readonly #minIntervalMs: number;
  readonly #heartbeatMs: number;
  readonly #log: (message: string) => void;
  #latest: VoiceState | null = null;
  #lastSentAt = Number.NEGATIVE_INFINITY;
  #throttleTimer: NodeJS.Timeout | null = null;
  #heartbeatTimer: NodeJS.Timeout | null = null;
  #stopped = false;
  #lastFailed = false;

  constructor(opts: PhoneBoxPublisherOptions) {
    const base = new URL(opts.baseUrl ?? 'http://127.0.0.1:8765');
    if (base.protocol !== 'http:' || !LOCAL_HOSTS.has(base.hostname)) {
      throw new Error('el agente de PhoneBox debe estar en 127.0.0.1 o localhost');
    }
    const ttlSec = opts.ttlSec ?? 15;
    this.#url = new URL(`/api/push/${PUSH_KEY}?ttl=${ttlSec}`, base).toString();
    this.#fetchFn = opts.fetchFn;
    this.#minIntervalMs = opts.minIntervalMs ?? 200;
    this.#heartbeatMs = opts.heartbeatMs ?? 5000;
    this.#log = opts.log ?? (() => {});
  }

  publish(state: VoiceState): void {
    if (this.#stopped) return;
    this.#latest = state;
    if (this.#throttleTimer !== null) return;
    const wait = this.#lastSentAt + this.#minIntervalMs - Date.now();
    if (wait <= 0) this.#send();
    else this.#throttleTimer = setTimeout(() => this.#send(), wait);
  }

  stop(): void {
    this.#stopped = true;
    if (this.#throttleTimer !== null) clearTimeout(this.#throttleTimer);
    if (this.#heartbeatTimer !== null) clearTimeout(this.#heartbeatTimer);
    this.#throttleTimer = null;
    this.#heartbeatTimer = null;
  }

  #send(): void {
    this.#throttleTimer = null;
    if (this.#stopped || this.#latest === null) return;
    this.#lastSentAt = Date.now();
    if (this.#heartbeatTimer !== null) clearTimeout(this.#heartbeatTimer);
    this.#heartbeatTimer = setTimeout(() => this.#send(), this.#heartbeatMs);
    const body = JSON.stringify(this.#latest);
    let request: Promise<Response>;
    try {
      request = this.#fetchFn(this.#url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      request = Promise.reject(new Error('fetch-sincrono'));
    }
    request.then(
      (response) => {
        void response.body?.cancel();
        this.#report(response.ok ? null : `publicacion-rechazada HTTP ${response.status}`);
      },
      () => this.#report('agente-no-disponible'),
    );
  }

  /** Registra solo los cambios entre éxito y fallo, para no llenar el registro con cada latido. */
  #report(failure: string | null): void {
    if (failure === null) {
      if (this.#lastFailed) this.#log('agente-disponible');
      this.#lastFailed = false;
    } else if (!this.#lastFailed) {
      this.#log(failure);
      this.#lastFailed = true;
    }
  }
}
