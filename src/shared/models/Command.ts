/** Órdenes que el teléfono puede pedirle al bridge. No existe ninguna otra. */
export const COMMANDS = ['alternar-silencio', 'alternar-ensordecer', 'colgar'] as const;

export type Command = (typeof COMMANDS)[number];

/**
 * Valida una orden recibida como texto. Acepta un único salto de línea final
 * y compara por igualdad exacta: no recorta espacios ni ignora mayúsculas.
 */
export function parseCommand(raw: string): Command | null {
  if (typeof raw !== 'string') return null;
  const text = raw.endsWith('\n') ? raw.slice(0, -1) : raw;
  return COMMANDS.find((command) => command === text) ?? null;
}
