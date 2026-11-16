// Canje y refresco de tokens OAuth2 de Discord. El token de acceso solo se devuelve (vive en memoria);
// el de refresco va al almacén de secretos. Ningún error incluye códigos, tokens ni el secreto.

import type { SecretStore } from './SecretStore.ts';

const TOKEN_URL = 'https://discord.com/api/oauth2/token';
const HTTP_TIMEOUT_MS = 10_000;

export class TokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenError';
  }
}

type TokenResult = { ok: true; accessToken: string; refreshToken: string } | { ok: false; status: number; error: string | null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class TokenService {
  #clientId: string;
  #redirectUri: string;
  #store: SecretStore;
  #fetch: typeof fetch;

  constructor(opts: { clientId: string; redirectUri: string; store: SecretStore; fetchFn: typeof fetch }) {
    this.#clientId = opts.clientId;
    this.#redirectUri = opts.redirectUri;
    this.#store = opts.store;
    this.#fetch = opts.fetchFn;
  }

  /** Guarda el token de refresco y devuelve el de acceso. */
  async exchangeCode(code: string): Promise<string> {
    const clientSecret = await this.#clientSecret();
    const result = await this.#post({
      grant_type: 'authorization_code',
      code,
      client_id: this.#clientId,
      client_secret: clientSecret,
      redirect_uri: this.#redirectUri,
    });
    if (!result.ok) throw new TokenError(`Discord rechazó el canje del código (HTTP ${result.status})`);
    await this.#store.set('refresh-token', result.refreshToken);
    return result.accessToken;
  }

  /** Devuelve un token de acceso nuevo, o null si no hay token de refresco o Discord ya no lo acepta. */
  async refresh(): Promise<string | null> {
    const refreshToken = await this.#store.get('refresh-token');
    if (refreshToken === null) return null;
    const clientSecret = await this.#clientSecret();
    const result = await this.#post({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.#clientId,
      client_secret: clientSecret,
    });
    if (!result.ok) {
      if (result.status === 400 && result.error === 'invalid_grant') {
        await this.#store.delete('refresh-token');
        return null;
      }
      throw new TokenError(`Discord no refrescó el token (HTTP ${result.status})`);
    }
    await this.#store.set('refresh-token', result.refreshToken);
    return result.accessToken;
  }

  async #clientSecret(): Promise<string> {
    const secret = await this.#store.get('client-secret');
    if (secret === null) throw new TokenError('falta el secreto de la aplicación en el llavero; ejecuta "pnpm run setup"');
    return secret;
  }

  async #post(fields: Record<string, string>): Promise<TokenResult> {
    let response: Response;
    try {
      response = await this.#fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields).toString(),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
    } catch {
      // Se descarta el error original: podría arrastrar datos de la petición.
      throw new TokenError('no se pudo contactar a Discord para obtener el token');
    }
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (!response.ok) {
      const error = isRecord(body) && typeof body.error === 'string' && /^[a-z_]{1,40}$/.test(body.error) ? body.error : null;
      return { ok: false, status: response.status, error };
    }
    if (!isRecord(body) || typeof body.access_token !== 'string' || typeof body.refresh_token !== 'string' || !body.access_token || !body.refresh_token) {
      throw new TokenError('Discord devolvió una respuesta de token incompleta');
    }
    return { ok: true, accessToken: body.access_token, refreshToken: body.refresh_token };
  }
}
