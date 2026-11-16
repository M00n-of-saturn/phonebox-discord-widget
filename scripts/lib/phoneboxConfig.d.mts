// Tipos de scripts/lib/phoneboxConfig.mjs para tsc. La configuración de PhoneBox es JSON libre.

type PhoneBoxConfig = any;

export function applyWidget(config: unknown, opts: { html: string; nodePath: string; ctlPath: string }): PhoneBoxConfig;
export function removeWidget(config: unknown): PhoneBoxConfig;
