// Configuración no secreta del bridge. El secreto de la aplicación nunca va en este archivo.

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface BridgeConfig {
  clientId: string;
  redirectUri: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export const CLIENT_ID_PATTERN = /^\d{15,25}$/;
const DEFAULT_REDIRECT_URI = 'http://localhost';
const MAX_REDIRECT_URI = 200;

export function configPath(env: NodeJS.ProcessEnv): string {
  const base = env.XDG_CONFIG_HOME || join(env.HOME || homedir(), '.config');
  return join(base, 'phonebox-discord-widget', 'config.json');
}

function validate(raw: unknown): BridgeConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ConfigError('la configuración no es un objeto');
  }
  const { clientId, redirectUri = DEFAULT_REDIRECT_URI } = raw as Record<string, unknown>;
  if (typeof clientId !== 'string' || !CLIENT_ID_PATTERN.test(clientId)) {
    throw new ConfigError('clientId falta o no es un id numérico de Discord');
  }
  if (typeof redirectUri !== 'string' || redirectUri.length > MAX_REDIRECT_URI || !isHttpUrl(redirectUri)) {
    throw new ConfigError('redirectUri no es una dirección http o https');
  }
  return { clientId, redirectUri };
}

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export function loadConfig(path: string): BridgeConfig {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new ConfigError('no se pudo leer el archivo de configuración');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ConfigError('el archivo de configuración no es JSON válido');
  }
  return validate(raw);
}

export function saveConfig(path: string, config: BridgeConfig): void {
  const valid = validate(config);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(valid, null, 2)}\n`, { mode: 0o600 });
  // `mode` solo aplica al crear el archivo; si ya existía, se corrige aquí.
  chmodSync(path, 0o600);
}
