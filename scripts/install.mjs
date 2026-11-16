// Instala el widget: agrega la página y los accesos directos en PhoneBox y deja el bridge como servicio de usuario.
// Uso: pnpm run install-widget            (instala o actualiza)
//      pnpm run install-widget --uninstall (revierte; la copia de la configuración se conserva)

import { execFileSync } from 'node:child_process';
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyWidget, removeWidget } from './lib/phoneboxConfig.mjs';

const AGENT = 'http://127.0.0.1:8765';
const SERVICE = 'phonebox-discord-widget.service';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const home = process.env.HOME || homedir();
const phoneboxConfig = join(process.env.XDG_CONFIG_HOME || join(home, '.config'), 'PhoneBox', 'config.json');
const backup = `${phoneboxConfig}.pre-discord.bak`;
const unitPath = join(process.env.XDG_CONFIG_HOME || join(home, '.config'), 'systemd', 'user', SERVICE);

function say(message) {
  process.stdout.write(`${message}\n`);
}

function systemctl(...args) {
  execFileSync('systemctl', ['--user', ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
}

async function readSettings() {
  const response = await fetch(`${AGENT}/api/settings`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`el agente de PhoneBox respondió HTTP ${response.status} al leer la configuración`);
  const version = response.headers.get('x-config-version');
  if (!version) throw new Error('el agente de PhoneBox no envió X-Config-Version');
  return { settings: await response.json(), version };
}

async function writeSettings(settings, version) {
  const response = await fetch(`${AGENT}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Config-Version': version },
    body: JSON.stringify(settings),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`el agente de PhoneBox rechazó la configuración (HTTP ${response.status})`);
}

function unitFile() {
  return [
    '[Unit]',
    'Description=Panel de voz de Discord para PhoneBox (bridge)',
    'After=graphical-session.target',
    '',
    '[Service]',
    `ExecStart=${process.execPath} ${join(root, 'dist', 'bridge.js')}`,
    'Restart=on-failure',
    'RestartSec=5',
    'NoNewPrivileges=yes',
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n');
}

async function install() {
  const html = join(root, 'dist', 'widget.html');
  for (const file of [html, join(root, 'dist', 'bridge.js'), join(root, 'dist', 'ctl.js')]) {
    if (!existsSync(file)) throw new Error(`falta ${file}; ejecuta "pnpm build" primero`);
  }

  if (existsSync(backup)) say(`Ya existe una copia previa: ${backup} (no se sobrescribe).`);
  else {
    copyFileSync(phoneboxConfig, backup, constants.COPYFILE_EXCL);
    say(`Copia de la configuración de PhoneBox: ${backup}`);
  }

  const { settings, version } = await readSettings();
  const next = applyWidget(settings, { html: readFileSync(html, 'utf8'), nodePath: process.execPath, ctlPath: join(root, 'dist', 'ctl.js') });
  await writeSettings(next, version);
  say('PhoneBox: página "Discord" y accesos directos agregados.');

  mkdirSync(dirname(unitPath), { recursive: true });
  writeFileSync(unitPath, unitFile());
  systemctl('daemon-reload');
  systemctl('enable', SERVICE);
  // restart: si ya estaba en marcha, toma la versión recién construida.
  systemctl('restart', SERVICE);
  say(`Servicio ${SERVICE} activado.`);
}

async function uninstall() {
  if (existsSync(unitPath)) {
    systemctl('disable', '--now', SERVICE);
    rmSync(unitPath);
    systemctl('daemon-reload');
    say(`Servicio ${SERVICE} quitado.`);
  }
  const { settings, version } = await readSettings();
  await writeSettings(removeWidget(settings), version);
  say('PhoneBox: página "Discord" y accesos directos quitados.');
  if (existsSync(backup)) say(`La copia previa sigue en ${backup}.`);
}

const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--uninstall')) {
  say('Uso: pnpm run install-widget [--uninstall]');
  process.exit(1);
}

try {
  await (args.includes('--uninstall') ? uninstall() : install());
} catch (error) {
  say(`No se pudo completar: ${error instanceof Error ? error.message : 'error desconocido'}`);
  process.exitCode = 1;
}
