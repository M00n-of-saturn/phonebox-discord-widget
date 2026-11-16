// Un origen de estado de voz. Hoy solo existe el de Discord; la interfaz deja lugar para otros.

import type { Command } from '../../shared/models/Command.ts';
import type { VoiceState } from '../../shared/models/VoiceState.ts';

export interface VoiceSource {
  /** Empieza a observar y avisa con cada estado nuevo. */
  start(onChange: (state: VoiceState) => void): void;
  /** Ejecuta una orden; rechaza si no hay conexión. */
  execute(command: Command): Promise<void>;
  stop(): void;
}
