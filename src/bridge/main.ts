// Punto de entrada del bridge (servicio de usuario de systemd).
// Registra en stderr solo tipos de evento y códigos; journald les pone la hora.

import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { KeyringSecretStore, KeyringUnavailableError } from './auth/SecretStore.ts';
import { TokenService } from './auth/TokenService.ts';
import { ConfigError, configPath, loadConfig, type BridgeConfig } from './config/BridgeConfig.ts';
import { AlreadyRunningError, ControlServer, controlSocketPath } from './control/ControlServer.ts';
import { STRINGS, langFromArgs } from '../shared/i18n.ts';
import { RpcClient, findDiscordSocket } from './discord/RpcClient.ts';
import { PhoneBoxPublisher } from './publishers/PhoneBoxPublisher.ts';
import { DiscordVoiceSource } from './sources/DiscordVoiceSource.ts';
import { VoiceStateTracker } from './sources/VoiceStateTracker.ts';

const SETUP_HINT = 'Falta la configuración o el secreto de la aplicación; ejecuta "pnpm run setup".';

function log(message: string): void {
  process.stderr.write(`${message}\n`);
}

async function loadSettings(store: KeyringSecretStore): Promise<BridgeConfig> {
  try {
    const config = loadConfig(configPath(process.env));
    if ((await store.get('client-secret')) === null) throw new ConfigError('falta el secreto de la aplicación');
    return config;
  } catch (error) {
    if (error instanceof ConfigError || error instanceof KeyringUnavailableError) {
      log(`${error.name}: ${error.message}`);
      log(SETUP_HINT);
      process.exit(1);
    }
    throw error;
  }
}

async function main(): Promise<void> {
  const store = new KeyringSecretStore();
  const config = await loadSettings(store);
  const tokens = new TokenService({ clientId: config.clientId, redirectUri: config.redirectUri, store, fetchFn: fetch });
  const tracker = new VoiceStateTracker(randomBytes(16).toString('hex'), STRINGS[langFromArgs(process.argv.slice(2))].you);
  const source = new DiscordVoiceSource({
    createRpc: () => {
      const socketPath = findDiscordSocket(process.env, existsSync);
      return socketPath === null ? null : new RpcClient(socketPath, config.clientId);
    },
    tokens,
    tracker,
    log,
  });
  const publisher = new PhoneBoxPublisher({ fetchFn: fetch, log });
  const control = new ControlServer(controlSocketPath(process.env), (command) => source.execute(command));

  try {
    await control.listen();
  } catch (error) {
    if (error instanceof AlreadyRunningError) {
      log('Ya hay un bridge en marcha; este termina.');
      process.exit(1);
    }
    throw error;
  }

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log(`deteniendo ${signal}`);
    source.stop();
    publisher.stop();
    await control.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  log('bridge en marcha');
  source.start((state) => publisher.publish(state));
}

main().catch((error: unknown) => {
  log(`fallo-inesperado ${error instanceof Error ? error.name : 'desconocido'}`);
  process.exit(1);
});
