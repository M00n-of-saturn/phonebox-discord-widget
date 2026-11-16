// Instalación interactiva: guarda el Client ID en la configuración y el Client Secret en el llavero,
// pide a Discord la autorización y guarda el token de refresco. Nunca imprime secretos, códigos ni tokens.

import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { KeyringSecretStore, KeyringUnavailableError } from './auth/SecretStore.ts';
import { TokenError, TokenService } from './auth/TokenService.ts';
import { CLIENT_ID_PATTERN, configPath, loadConfig, saveConfig, type BridgeConfig } from './config/BridgeConfig.ts';
import { RpcClient, RpcError, findDiscordSocket } from './discord/RpcClient.ts';

const SCOPES = ['rpc', 'rpc.voice.read', 'rpc.voice.write'];
const AUTHORIZE_TIMEOUT_MS = 120_000;
const DEFAULT_REDIRECT_URI = 'http://localhost';

class SetupError extends Error {}

function say(message: string): void {
  process.stdout.write(`${message}\n`);
}

function currentConfig(path: string): BridgeConfig | null {
  try {
    return loadConfig(path);
  } catch {
    return null;
  }
}

async function askClientId(current: string | null): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const hint = current === null ? '' : ` [Enter para mantener ${current}]`;
      const answer = (await rl.question(`Client ID de tu aplicación de Discord${hint}: `)).trim();
      if (answer === '' && current !== null) return current;
      if (CLIENT_ID_PATTERN.test(answer)) return answer;
      say('El Client ID son solo números (entre 15 y 25 cifras). Inténtalo de nuevo.');
    }
  } finally {
    rl.close();
  }
}

/** Lee una línea sin mostrarla en pantalla. */
function askHidden(prompt: string): Promise<string> {
  const input = process.stdin;
  if (!input.isTTY) return Promise.reject(new SetupError('Ejecuta "pnpm run setup" en una terminal interactiva.'));
  process.stdout.write(prompt);
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (result: string | null) => {
      input.off('data', onData);
      input.setRawMode(false);
      input.pause();
      process.stdout.write('\n');
      if (result === null) reject(new SetupError('Instalación cancelada; no se guardó nada nuevo.'));
      else resolve(result);
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') return finish(value);
        if (char === '\u0003' || char === '\u0004') return finish(null);
        if (char === '\u007f' || char === '\b') value = Array.from(value).slice(0, -1).join('');
        else if (char >= ' ') value += char;
      }
    };
    input.setRawMode(true);
    input.setEncoding('utf8');
    input.resume();
    input.on('data', onData);
  });
}

async function askSecret(hasCurrent: boolean): Promise<string | null> {
  const hint = hasCurrent ? ' [Enter para mantener el guardado]' : '';
  for (;;) {
    const answer = (await askHidden(`Client Secret (no se mostrará al escribir)${hint}: `)).trim();
    if (answer === '' && hasCurrent) return null;
    if (answer.length >= 16 && answer.length <= 256 && /^[\x21-\x7e]+$/.test(answer)) return answer;
    say('Ese valor no parece un Client Secret de Discord. Inténtalo de nuevo.');
  }
}

async function authorize(clientId: string): Promise<string> {
  const socketPath = findDiscordSocket(process.env, existsSync);
  if (socketPath === null) throw new SetupError('Discord no está abierto. Ábrelo y vuelve a ejecutar "pnpm run setup".');
  const rpc = new RpcClient(socketPath, clientId);
  try {
    await rpc.connect();
    say('Revisa la ventana de Discord y pulsa "Autorizar" (tienes 2 minutos).');
    const data = await rpc.request('AUTHORIZE', { client_id: clientId, scopes: SCOPES }, undefined, AUTHORIZE_TIMEOUT_MS);
    const code = typeof data === 'object' && data !== null ? (data as Record<string, unknown>).code : undefined;
    if (typeof code !== 'string' || code === '') throw new SetupError('Discord no devolvió un código de autorización.');
    return code;
  } finally {
    rpc.close();
  }
}

async function main(): Promise<number> {
  const store = new KeyringSecretStore();
  const path = configPath(process.env);
  try {
    // Comprueba el llavero antes de pedir nada.
    const hasSecret = (await store.get('client-secret')) !== null;
    const existing = currentConfig(path);
    const clientId = await askClientId(existing?.clientId ?? null);
    const secret = await askSecret(hasSecret);

    saveConfig(path, { clientId, redirectUri: existing?.redirectUri ?? DEFAULT_REDIRECT_URI });
    if (secret !== null) await store.set('client-secret', secret);
    say('Configuración guardada.');

    const code = await authorize(clientId);
    const tokens = new TokenService({ clientId, redirectUri: existing?.redirectUri ?? DEFAULT_REDIRECT_URI, store, fetchFn: fetch });
    await tokens.exchangeCode(code);
    say('Autorización guardada en el llavero.');
    return 0;
  } catch (error) {
    if (error instanceof KeyringUnavailableError) say('No hay llavero del sistema disponible; no se guardó nada.');
    else if (error instanceof SetupError || error instanceof TokenError) say(error.message);
    else if (error instanceof RpcError) say(`Discord no completó la autorización (${error.code === null ? 'sin código' : `código ${error.code}`}).`);
    else say(`Fallo inesperado (${error instanceof Error ? error.name : 'desconocido'}).`);
    return 1;
  }
}

process.exitCode = await main();
