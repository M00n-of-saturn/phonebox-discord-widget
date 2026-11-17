// Tipos de scripts/lib/phoneboxConfig.mjs para tsc. La configuración de PhoneBox es JSON libre.

type PhoneBoxConfig = any;

export function applyWidget(config: unknown, opts: { html: string; nodePath: string; ctlPath: string }): PhoneBoxConfig;
export function removeWidget(config: unknown): PhoneBoxConfig;
export function setWidgetLang(html: string, lang: 'en' | 'es'): string;
// null sin unidad o con --lang no válido; 'es' si la unidad existe sin --lang (instalación previa a la opción).
export function langFromUnit(unitText: string | null): 'en' | 'es' | null;
export function parseInstallArgs(args: string[], current: 'en' | 'es' | null): { uninstall: true } | { uninstall: false; lang: 'en' | 'es' };
