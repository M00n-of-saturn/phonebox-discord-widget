// Cliente de línea de órdenes que usan los accesos directos de PhoneBox: `node dist/ctl.js <orden>`.
// Sale con 0 si el bridge ejecutó la orden y con 1 en cualquier otro caso, en menos de 2 s.

import { COMMANDS, parseCommand } from '../shared/models/Command.ts';
import { controlSocketPath, sendCommand } from './control/ControlServer.ts';

async function main(): Promise<number> {
  const command = parseCommand(process.argv[2] ?? '');
  if (command === null) {
    process.stderr.write(`Orden no válida. Órdenes aceptadas: ${COMMANDS.join(', ')}\n`);
    return 1;
  }
  try {
    await sendCommand(controlSocketPath(process.env), command);
    return 0;
  } catch (error) {
    process.stderr.write(`No se pudo ejecutar "${command}": ${error instanceof Error ? error.message : 'error desconocido'}\n`);
    return 1;
  }
}

process.exitCode = await main();
