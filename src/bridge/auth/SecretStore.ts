// Almacén de secretos. La versión real usa el llavero del sistema por medio de `secret-tool`;
// el valor viaja siempre por la entrada estándar, nunca como argumento de un proceso.

import { execFile } from 'node:child_process';

export type SecretName = 'client-secret' | 'refresh-token';

export interface SecretStore {
  get(name: SecretName): Promise<string | null>;
  set(name: SecretName, value: string): Promise<void>;
  delete(name: SecretName): Promise<void>;
}

export class MemorySecretStore implements SecretStore {
  #values = new Map<SecretName, string>();

  async get(name: SecretName): Promise<string | null> {
    return this.#values.get(name) ?? null;
  }

  async set(name: SecretName, value: string): Promise<void> {
    this.#values.set(name, value);
  }

  async delete(name: SecretName): Promise<void> {
    this.#values.delete(name);
  }
}

/** El llavero del sistema no está o no responde. El mensaje nunca incluye valores. */
export class KeyringUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeyringUnavailableError';
  }
}

const KEYRING_TIMEOUT_MS = 60_000;
const MAX_SECRET_BYTES = 64 * 1024;

interface ToolResult {
  exitCode: number;
  stdout: string;
}

export class KeyringSecretStore implements SecretStore {
  #service: string;
  #command: string;

  constructor(service = 'phonebox-discord-widget', command = 'secret-tool') {
    this.#service = service;
    this.#command = command;
  }

  async get(name: SecretName): Promise<string | null> {
    const result = await this.#run(['lookup', ...this.#attributes(name)]);
    // `secret-tool lookup` termina con 1 cuando la entrada no existe.
    if (result.exitCode === 1 || result.stdout === '') return null;
    return result.stdout;
  }

  async set(name: SecretName, value: string): Promise<void> {
    if (value === '') throw new Error('no se guarda un secreto vacío');
    const label = `PhoneBox Discord widget (${name})`;
    const result = await this.#run(['store', '--label', label, ...this.#attributes(name)], value);
    if (result.exitCode !== 0) throw new KeyringUnavailableError('el llavero del sistema no guardó la entrada');
  }

  async delete(name: SecretName): Promise<void> {
    await this.#run(['clear', ...this.#attributes(name)]);
  }

  #attributes(name: SecretName): string[] {
    return ['service', this.#service, 'name', name];
  }

  #run(args: string[], input?: string): Promise<ToolResult> {
    return new Promise((resolve, reject) => {
      const child = execFile(
        this.#command,
        args,
        { timeout: KEYRING_TIMEOUT_MS, maxBuffer: MAX_SECRET_BYTES, encoding: 'utf8' },
        (error, stdout) => {
          if (!error) return resolve({ exitCode: 0, stdout });
          if (error.code === 1) return resolve({ exitCode: 1, stdout });
          // No se propaga el error original: su mensaje incluye la línea de órdenes.
          const detail = error.code === 'ENOENT' ? 'falta el programa secret-tool' : 'el llavero del sistema no responde';
          reject(new KeyringUnavailableError(detail));
        },
      );
      child.stdin?.on('error', () => {});
      child.stdin?.end(input ?? '');
    });
  }
}
