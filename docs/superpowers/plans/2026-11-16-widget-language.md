# Widget Interface Language Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The phone panel shows its text in English by default, or in Spanish when installed with `pnpm run install-widget --lang es`.

**Architecture:** A shared string table (`src/shared/i18n.ts`) holds both languages. The widget reads its language from a `data-lang` attribute that the installer writes into the HTML before sending it to PhoneBox; the bridge gets the same language as a `--lang` argument in its systemd unit, because it produces the user's own name (`You` / `Tú`). A reinstall without `--lang` keeps the language found in the existing unit.

**Tech Stack:** TypeScript on Node 24, `node:test`, `esbuild`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-16-widget-language-design.md`

## Global Constraints

- Languages: exactly `en` and `es`. Default and fallback: `en`.
- Terminal messages, internal identifiers, state field names, command words and code comments do not change.
- No new dependencies. Security rules of the widget still hold (`textContent` only; `dist/widget.html` has no `http://`/`https://`, under 64 KB).
- Exact interface text:

  | Key | `en` | `es` |
  |---|---|---|
  | `noConnection` | `No connection to the PC` | `Sin conexión con la PC` |
  | `closed` | `Discord is closed` | `Discord está cerrado` |
  | `notAuthorized` | `Authorization missing: run "pnpm run setup" on the PC` | `Falta autorizar: ejecuta "pnpm run setup" en la PC` |
  | `notInChannel` | `You are not in a voice channel` | `No estás en un canal de voz` |
  | `inVoice(n)` | `` `${n} in voice` `` | `` `${n} en voz` `` |
  | `mute` / `muted` | `Mute` / `Muted` | `Silenciar` / `Silenciado` |
  | `deafen` / `deafened` | `Deafen` / `Deafened` | `Ensordecer` / `Ensordecido` |
  | `hangUp` | `Hang up` | `Colgar` |
  | `openDiscord` | `Open Discord` | `Abrir Discord` |
  | `you` | `You` | `Tú` |

## Review Focus

1. Owner reinstalls after `pnpm build` without `--lang`: the panel stays in Spanish. (Task 3, `langFromUnit` + `parseInstallArgs` tests)
2. `--lang ES`, `--lang fr`, `--lang` with no value, `--lang es --uninstall`: the installer exits with the usage line and changes nothing. (Task 3)
3. A unit edited by hand, or from before this change, with no `--lang`: treated as English, no crash. (Task 3)
4. The built HTML lacks the `data-lang="en"` marker or has it twice: the installer refuses instead of sending an HTML without a language. (Task 3)
5. Longer English labels (`Authorization missing: …`, `Deafened`) overflow on the phone: checked on the screenshots. (Task 4)

---

### Task 1: Shared strings and the bridge's own name

**Files:**
- Create: `src/shared/i18n.ts`, `tests/shared/i18n.test.ts`
- Modify: `src/bridge/sources/VoiceStateTracker.ts` (drop `SELF_NAME`), `src/bridge/main.ts:40`
- Test: `tests/bridge/VoiceStateTracker.test.ts`, `tests/bridge/DiscordVoiceSource.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const LANGS = ['en', 'es'] as const;
  export type Lang = (typeof LANGS)[number];
  export interface Strings {
    noConnection: string; closed: string; notAuthorized: string; notInChannel: string;
    inVoice(n: number): string;
    mute: string; muted: string; deafen: string; deafened: string;
    hangUp: string; openDiscord: string; you: string;
  }
  export const STRINGS: Record<Lang, Strings>;          // values from Global Constraints
  export function parseLang(raw: unknown): Lang;        // exact 'en' | 'es', anything else → 'en'
  export function langFromArgs(argv: readonly string[]): Lang;  // '--lang es' or '--lang=es'; else 'en'
  // VoiceStateTracker
  constructor(salt: string, selfName?: string);          // default STRINGS.en.you
  ```

- [ ] **Step 1: Failing tests** in `tests/shared/i18n.test.ts`: `parseLang('es') === 'es'`; `parseLang('en') === 'en'`; `parseLang` of `'ES'`, `'fr'`, `''`, `undefined`, `42` → `'en'`; `langFromArgs(['--lang', 'es'])` and `langFromArgs(['--lang=es'])` → `'es'`; `langFromArgs([])`, `['--lang']`, `['--lang', 'fr']` → `'en'`; `STRINGS.en.inVoice(15) === '15 in voice'`, `STRINGS.es.inVoice(15) === '15 en voz'`; both tables have the same keys and every value is a non-empty string (or a function).
  In `tests/bridge/VoiceStateTracker.test.ts`: existing trackers become `new VoiceStateTracker(salt, 'Tú')` (assertions unchanged); new test "el nombre propio por defecto es You": `new VoiceStateTracker('sal')` with the self id in the channel → first member's `nombre === 'You'`. In `tests/bridge/DiscordVoiceSource.test.ts:136` pass `'Tú'` as second argument.
- [ ] **Step 2:** `pnpm test`. Expected: FAIL (module `i18n.ts` missing; default-name test fails).
- [ ] **Step 3:** Implement `src/shared/i18n.ts`; give `VoiceStateTracker` the `selfName` parameter; in `main.ts` build the tracker with `STRINGS[langFromArgs(process.argv.slice(2))].you`.
- [ ] **Step 4:** `pnpm test && pnpm typecheck`. Expected: green.
- [ ] **Step 5:** Commit: `feat: shared English/Spanish strings; bridge names the user per --lang`.

### Task 2: Widget reads its language

**Files:**
- Modify: `src/widget/components/StatusBanner.ts` (remove `MESSAGES`), `ControlBar.ts`, `VoicePanel.ts`, `src/widget/main.ts`, `src/widget/index.html`
- Test: `tests/widget/VoicePanel.test.ts`, `tests/widget/security.test.ts`

**Interfaces:**
- Consumes: `Strings`, `STRINGS`, `parseLang` (Task 1).
- Produces:
  ```ts
  new StatusBanner(doc: Document, strings: Strings)
  new ControlBar(doc: Document, run: (id: ShortcutId) => void, strings: Strings)
  new VoicePanel(doc: Document, root: HTMLElement, client: PhoneBoxClient, strings: Strings)
  ```
  `src/widget/index.html`: the root becomes `<main id="discord-panel" class="panel" data-lang="en">` — this exact attribute text is the marker Task 3 replaces. `main.ts` passes `STRINGS[parseLang(root.dataset.lang)]`.

- [ ] **Step 1: Failing tests** in `tests/widget/VoicePanel.test.ts`: the existing panel tests run once per language (`for (const lang of LANGS)`), with the expected text taken from `STRINGS[lang]` (five views, `inVoice(3)`, `inVoice(15)`, mute/muted, deafen/deafened, hang up, open Discord). Add one literal check per language so the table itself is pinned: in English the closed view shows `Discord is closed` and the button `Open Discord`; in Spanish, `Discord está cerrado` and `Abrir Discord`. In `tests/widget/security.test.ts`: `dist/widget.html` contains `data-lang="en"` exactly once.
- [ ] **Step 2:** `pnpm build && pnpm test`. Expected: FAIL.
- [ ] **Step 3:** Implement: components take `strings` and use it instead of literals; `index.html` gets the attribute; `main.ts` reads it.
- [ ] **Step 4:** `pnpm build && pnpm test && pnpm typecheck`. Expected: green.
- [ ] **Step 5:** Commit: `feat: widget text in English or Spanish from data-lang`.

### Task 3: Installer `--lang`

**Files:**
- Modify: `scripts/lib/phoneboxConfig.mjs`, `scripts/lib/phoneboxConfig.d.mts`, `scripts/install.mjs`
- Test: `tests/scripts/phoneboxConfig.test.ts`

**Interfaces:**
- Produces (in `phoneboxConfig.mjs`, typed in the `.d.mts`):
  ```ts
  export function setWidgetLang(html: string, lang: 'en' | 'es'): string;   // throws unless data-lang="en" occurs exactly once
  export function langFromUnit(unitText: string | null): 'en' | 'es' | null; // reads "--lang en|es" from the ExecStart line
  export function parseInstallArgs(args: string[], current: 'en' | 'es' | null):
    { uninstall: true } | { uninstall: false; lang: 'en' | 'es' };          // throws Error on bad input
  ```
  `parseInstallArgs`: `[]` → `{uninstall:false, lang: current ?? 'en'}`; `['--lang','es']` or `['--lang=es']` → `lang:'es'`; `['--uninstall']` → `{uninstall:true}`. Throws for an unknown option, a missing or invalid language (`ES`, `fr`), a repeated `--lang`, or `--lang` together with `--uninstall`.

- [ ] **Step 1: Failing tests**: `setWidgetLang('<main data-lang="en">', 'es')` → `'<main data-lang="es">'`; same with `'en'` returns it unchanged; throws for HTML without the marker and with it twice. `langFromUnit` → `'es'` for a unit whose `ExecStart=` ends in `bridge.js --lang es`; `null` for `null`, for a unit without `--lang`, and for `--lang fr`. `parseInstallArgs` covers every case listed above, including `([], 'es')` → `lang:'es'` and `([], null)` → `lang:'en'`.
- [ ] **Step 2:** `pnpm test`. Expected: FAIL.
- [ ] **Step 3:** Implement the three functions. In `install.mjs`: read the existing unit (if any), `parseInstallArgs(args, langFromUnit(...))`, on error print `Uso: pnpm run install-widget [--lang en|es] [--uninstall]` and exit 1; pass `setWidgetLang(html, lang)` to `applyWidget`; `unitFile(lang)` writes `ExecStart=… dist/bridge.js --lang <lang>`; print the language that was installed.
- [ ] **Step 4:** `pnpm test && pnpm typecheck`. Then `node scripts/install.mjs --lang fr; echo $?` → usage line and `1`, without touching PhoneBox.
- [ ] **Step 5:** Commit: `feat: install-widget --lang en|es, keeping the current language on reinstall`.

### Task 4: Docs, English screenshots and the owner's install

**Files:**
- Modify: `README.md`, `README.es.md`, `docs/ESTADO.md` (not in git)
- Create: English screenshots in `docs/images/` (same names with an `en-` prefix, e.g. `en-hero.png`, `en-panel-closed.png`)

- [ ] **Step 1:** README (both): install step shows `pnpm run install-widget` (English) and `pnpm run install-widget --lang es` (Spanish), and that a reinstall keeps the language. English README: drop "The interface is in Spanish." and point its images to the `en-` files. Spanish README keeps the current images.
- [ ] **Step 2:** Take the English screenshots with the fictional data in `tests/fixtures/`, matching the size and framing of the current images (on the phone with adb as in the original Task 10, or in Brave with the agent's prelude; never real names). Check them for overflow (Review Focus 5).
- [ ] **Step 3:** `pnpm build && pnpm test && pnpm typecheck && pnpm audit`. Expected: green.
- [ ] **Step 4:** `pnpm run install-widget --lang es`. Expected: the unit's `ExecStart` ends in `--lang es`, the service is `active`, and the user confirms the phone is in Spanish. Then `pnpm run install-widget` with no option and check the unit still says `--lang es`.
- [ ] **Step 5:** Commit `docs: install language option and English screenshots`; add a log entry to `docs/ESTADO.md`. Ask the user before pushing.
