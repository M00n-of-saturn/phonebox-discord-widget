# Discord voice panel: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A PhoneBox widget that shows the Discord voice channel, its members and who is talking, with mute, deafen and hang up buttons that reflect the real state.

**Architecture:** A `bridge` on the PC (systemd user service) talks to Discord over its local socket, keeps its own validated state and publishes it to the PhoneBox agent (`POST /api/push/discord-voice`). The `widget` (a block of HTML in the panel's sandbox) only draws that state and requests actions by shortcut id; each shortcut runs `ctl`, which sends a fixed word to the bridge over a Unix socket.

**Tech Stack:** TypeScript on Node 24 (runs `.ts` directly for tests), `esbuild` for bundling, `node:test` for tests, `secret-tool` (KWallet) for secrets. No runtime dependencies.

**Spec:** `docs/2026-11-15-voice-panel-design.md`

> Command words, status values, state field names and interface text are in Spanish, because that is what the
> code uses. They are quoted literally below; the design document has a glossary.

## Global Constraints

- Dependencies: only `typescript`, `esbuild` and `@types/node`, all development-only, with a pnpm lockfile. `pnpm audit` with no high or critical issues.
- TypeScript: `strict`, `erasableSyntaxOnly`, `allowImportingTsExtensions`, `noEmit`; relative imports with the `.ts` extension; no `enum` and no parameter properties.
- No secret in the repository, in `dist/`, in logs, in the PhoneBox configuration or in data sent to the phone. Secrets are never passed as process arguments.
- In `src/widget/`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval` and `new Function` are forbidden. All text is drawn with `textContent`.
- Publish key: `discord-voice`. `ttl`: 15 s. Heartbeat: 5 s. At most 5 sends per second. At most 12 members. Names up to 32 characters with no control characters.
- Accepted commands: `alternar-silencio`, `alternar-ensordecer`, `colgar`. Nothing else.
- Shortcut ids: `discord-mute`, `discord-deafen`, `discord-hangup`, `discord-open`.
- Control socket: `$XDG_RUNTIME_DIR/phonebox-discord-widget.sock`, 0600 permissions. The bridge opens no network ports and only publishes to `http://127.0.0.1:8765`.
- Logs include event type and codes, never names, ids, tokens or message bodies.
- Interface text in neutral Spanish, exactly as written in this plan.
- Fictional test data (Ana, Bruno, Carla...). No screenshot or test uses real names.
- No commits: the project is not in git. If the user asks, one commit per task.

## Review Focus

1. Empty name, only spaces, only emoji, with control characters or with HTML: shown as safe text or as `?`, without breaking the row. (Task 1 and Task 8)
2. More than 12 people in the channel: 12 are shown and the counter shows the real total. (Task 4)
3. Changing channel or restarting Discord while in voice: no members from the previous channel and no stuck "speaking" indicators remain. (Task 4 and Task 5)
4. Button pressed with the bridge stopped or Discord closed: `ctl` exits with an error in under 2 s and nothing hangs. (Task 6)
5. Old socket file after a crash, or a second bridge starting: the old one is replaced only if nobody is listening; with a live bridge, the second one exits with an error. (Task 6)

---

## File structure

```
package.json, tsconfig.json
src/shared/models/VoiceState.ts        State model, name sanitizing and validation
src/shared/models/Command.ts           Command list and its validation
src/bridge/discord/FrameCodec.ts       Encodes and decodes Discord socket frames
src/bridge/discord/RpcClient.ts        Connection, requests with nonce, and events
src/bridge/auth/SecretStore.ts         Secrets interface; keyring and in-memory versions
src/bridge/auth/TokenService.ts        OAuth2 token exchange and refresh
src/bridge/config/BridgeConfig.ts      Reads and validates config.json
src/bridge/sources/VoiceSource.ts      Interface for a voice-state source
src/bridge/sources/VoiceStateTracker.ts  Translates raw Discord data into VoiceState
src/bridge/sources/DiscordVoiceSource.ts Joins RpcClient, TokenService and the tracker; reconnection
src/bridge/publishers/PhoneBoxPublisher.ts Publishes to the agent with rate limit and heartbeat
src/bridge/control/ControlServer.ts    Unix socket that receives commands
src/bridge/main.ts | ctl.ts | setup.ts Entry points
src/widget/services/PhoneBoxClient.ts  Wraps window.phonebox and detects stale data
src/widget/components/*.ts             StatusBanner, MemberList, ControlBar, VoicePanel
src/widget/styles/widget.css, src/widget/index.html, src/widget/main.ts
scripts/build.mjs, scripts/install.mjs, scripts/lib/phoneboxConfig.mjs
tests/**                               Mirror of src/, plus tests/helpers/fakeDom.ts
docs/threat-model.md
```

---

### Task 1: Project and shared models

**Files:**
- Create: `package.json`, `tsconfig.json`, `src/shared/models/VoiceState.ts`, `src/shared/models/Command.ts`
- Test: `tests/shared/VoiceState.test.ts`, `tests/shared/Command.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type DiscordStatus = 'conectado' | 'cerrado' | 'sin-autorizar';
  export interface Member { clave: string; nombre: string; habla: boolean; silenciado: boolean; ensordecido: boolean }
  export interface VoiceState {
    v: 1; discord: DiscordStatus;
    canal: { nombre: string; total: number } | null;
    yo: { silenciado: boolean; ensordecido: boolean };
    miembros: Member[];
  }
  export const MAX_MEMBERS = 12; export const MAX_NAME = 32; export const PUSH_KEY = 'discord-voice';
  export function sanitizeName(raw: unknown): string;          // '?' if nothing is left
  export function parseVoiceState(raw: unknown): VoiceState | null;
  export const COMMANDS = ['alternar-silencio', 'alternar-ensordecer', 'colgar'] as const;
  export type Command = (typeof COMMANDS)[number];
  export function parseCommand(raw: string): Command | null;
  ```

- [ ] **Step 1:** Create `package.json` (`"type": "module"`, `"private": true`, scripts `test`: `node --test "tests/**/*.test.ts"`, `typecheck`: `tsc`, `build`: `node scripts/build.mjs`, `setup`: `node dist/setup.js`, `install-widget`: `node scripts/install.mjs`) and `tsconfig.json` with the options from Global Constraints. Run `pnpm add -D typescript esbuild` and `pnpm audit`. Expected: no high or critical vulnerabilities.
- [ ] **Step 2: Failing tests** in `tests/shared/VoiceState.test.ts`:
  - `sanitizeName('  Ana  ') === 'Ana'`; `sanitizeName('A\u0000n​a\n') === 'Ana'`; `sanitizeName('x'.repeat(40)).length === 32`; `sanitizeName('   ') === '?'`; `sanitizeName(42) === '?'`; `sanitizeName('<img src=x onerror=alert(1)>')` returns the same string cut to 32 (escaping is `textContent`'s job); `sanitizeName('🎧') === '🎧'`.
  - `parseVoiceState` accepts the example from the design and returns an equal object.
  - Returns `null` for: `v: 2`; `discord: 'otro'`; `miembros` with 13 elements; a member without `clave`; a `clave` that does not match `/^[0-9a-f]{8}$/`; a 33-character `nombre`; `habla: 'si'`; a negative or non-integer `canal.total`; `raw` equal to `null`, a string or an array.
  - Ignores unknown properties (they do not appear in the result).
- [ ] **Step 3:** In `tests/shared/Command.test.ts`: `parseCommand('colgar') === 'colgar'`; `parseCommand('colgar\n') === 'colgar'`; returns `null` for `''`, `'COLGAR'`, `'colgar; rm -rf ~'`, `'alternar-silencio alternar-ensordecer'` and a 100-character string.
- [ ] **Step 4:** `pnpm test`. Expected: FAIL because the modules do not exist.
- [ ] **Step 5:** Implement both files. `sanitizeName` removes `\p{Cc}` and `\p{Cf}`, trims spaces and cuts by code points (not UTF-16 units) to `MAX_NAME`. `parseCommand` strips a single trailing newline and compares by exact equality against `COMMANDS`.
- [ ] **Step 6:** `pnpm test && pnpm typecheck`. Expected: all green.

### Task 2: Frames and client for Discord's local connection

**Files:**
- Create: `src/bridge/discord/FrameCodec.ts`, `src/bridge/discord/RpcClient.ts`
- Test: `tests/bridge/FrameCodec.test.ts`, `tests/bridge/RpcClient.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 } as const;
  export const MAX_FRAME_BYTES = 4 * 1024 * 1024;
  export interface Frame { op: number; payload: unknown }
  export class FrameError extends Error {}
  export function encodeFrame(op: number, payload: unknown): Buffer;
  export class FrameDecoder { push(chunk: Buffer): Frame[] }   // throws FrameError

  export class RpcError extends Error { code: number | null }
  export function findDiscordSocket(env: NodeJS.ProcessEnv, exists: (p: string) => boolean): string | null;
  export class RpcClient {
    constructor(socketPath: string, clientId: string);
    connect(): Promise<void>;                                   // resolves when READY arrives
    request(cmd: string, args?: object, evt?: string, timeoutMs?: number): Promise<unknown>;
    onEvent(handler: (evt: string, data: unknown) => void): void;
    onClose(handler: (reason: string) => void): void;
    close(): void;
  }
  ```

- [ ] **Step 1: `FrameCodec` tests:** round trip of `{cmd:'X'}`; a frame delivered byte by byte produces exactly one `Frame`; two frames in a single chunk produce two; negative length and length greater than `MAX_FRAME_BYTES` throw `FrameError`; a body that is not JSON throws `FrameError`; text with `ñ` and emoji keeps its bytes.
- [ ] **Step 2: `RpcClient` tests** against a `net` server on a temporary socket (`fs.mkdtemp`): `connect()` sends `HANDSHAKE` with `{v:1, client_id}` and resolves after `READY`; `request` resolves with the `data` of the response carrying the same `nonce`; an `evt:'ERROR'` response rejects with `RpcError` and its `code`; no response rejects when `timeoutMs` expires; a `DISPATCH` without `nonce` reaches `onEvent`; `PING` gets a `PONG` with the same body; a `CLOSE` from the server fires `onClose` and rejects pending requests; an invalid frame closes the connection and fires `onClose`.
  `findDiscordSocket` returns `$XDG_RUNTIME_DIR/discord-ipc-0` if it exists, tries indexes 0 to 9, then `$XDG_RUNTIME_DIR/app/com.discordapp.Discord/`, and `null` if none exists.
- [ ] **Step 3:** `pnpm test`. Expected: FAIL.
- [ ] **Step 4:** Implement. Working protocol reference: `spike/discord-rpc-probe.mjs` (8-byte header: opcode and length as little-endian 32-bit integers). Unlike the probe, no error calls `process.exit`.
- [ ] **Step 5:** `pnpm test && pnpm typecheck`. Expected: green.

### Task 3: Secrets, tokens and configuration

**Files:**
- Create: `src/bridge/auth/SecretStore.ts`, `src/bridge/auth/TokenService.ts`, `src/bridge/config/BridgeConfig.ts`
- Test: `tests/bridge/TokenService.test.ts`, `tests/bridge/BridgeConfig.test.ts`, `tests/bridge/SecretStore.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type SecretName = 'client-secret' | 'refresh-token';
  export interface SecretStore {
    get(name: SecretName): Promise<string | null>;
    set(name: SecretName, value: string): Promise<void>;
    delete(name: SecretName): Promise<void>;
  }
  export class MemorySecretStore implements SecretStore {}
  export class KeyringSecretStore implements SecretStore {}     // throws KeyringUnavailableError
  export class KeyringUnavailableError extends Error {}

  export class TokenService {
    constructor(opts: { clientId: string; redirectUri: string; store: SecretStore; fetchFn: typeof fetch });
    exchangeCode(code: string): Promise<string>;      // stores the refresh token, returns the access token
    refresh(): Promise<string | null>;                 // null if there is no refresh token or Discord rejects it
  }

  export interface BridgeConfig { clientId: string; redirectUri: string }
  export function configPath(env: NodeJS.ProcessEnv): string;   // $XDG_CONFIG_HOME or ~/.config, + /phonebox-discord-widget/config.json
  export function loadConfig(path: string): BridgeConfig;       // throws ConfigError
  export function saveConfig(path: string, config: BridgeConfig): void;  // directory 0700, file 0600
  export class ConfigError extends Error {}
  ```

- [ ] **Step 1: `TokenService` tests** with `MemorySecretStore` and a fake `fetchFn`: `exchangeCode('abc')` does `POST https://discord.com/api/oauth2/token` with an `application/x-www-form-urlencoded` body containing `grant_type=authorization_code`, `code`, `client_id`, `client_secret` and `redirect_uri`; it stores `refresh-token` and returns the `access_token`. `refresh()` with no stored token returns `null` without calling `fetchFn`; with a token it uses `grant_type=refresh_token` and **replaces** the stored token with the new one; on HTTP 400 with `invalid_grant` it deletes the stored token and returns `null`; on HTTP 500 or a network error it throws, and the stored token is kept. Without `client-secret` in the store, both methods throw an error whose message contains no secret value. No error message includes `code`, tokens or the secret (assert it with sentinel values).
- [ ] **Step 2: `BridgeConfig` tests:** `saveConfig`/`loadConfig` round trip in a temporary directory; the file ends up with mode `0o600`; `loadConfig` throws `ConfigError` if the file is missing, if it is not JSON, or if `clientId` does not match `/^\d{15,25}$/`; `redirectUri` defaults to `http://localhost`.
- [ ] **Step 3: `KeyringSecretStore` test** (skipped with `t.skip` if `secret-tool` is not on the PATH): stores, reads and deletes an entry with attributes `service phonebox-discord-widget-test name refresh-token` and a fictional value; `get` of a missing entry returns `null`.
- [ ] **Step 4:** `pnpm test`. Expected: FAIL.
- [ ] **Step 5:** Implement. `KeyringSecretStore` uses `execFile('secret-tool', ['store', '--label', ..., 'service', service, 'name', name])` with the value written to **stdin**, plus `lookup` and `clear`; the service name is a constructor parameter defaulting to `phonebox-discord-widget`. `ENOENT` or an exit code other than 0 and 1 throws `KeyringUnavailableError`.
- [ ] **Step 6:** `pnpm test && pnpm typecheck`. Expected: green.

### Task 4: Voice state translator

**Files:**
- Create: `src/bridge/sources/VoiceSource.ts`, `src/bridge/sources/VoiceStateTracker.ts`
- Test: `tests/bridge/VoiceStateTracker.test.ts`

**Interfaces:**
- Consumes: `VoiceState`, `DiscordStatus`, `sanitizeName`, `MAX_MEMBERS`, `Command` (Task 1).
- Produces:
  ```ts
  export interface VoiceSource {
    start(onChange: (state: VoiceState) => void): void;
    execute(command: Command): Promise<void>;
    stop(): void;
  }
  export class VoiceStateTracker {
    constructor(salt: string);
    setStatus(status: DiscordStatus): void;          // 'cerrado' and 'sin-autorizar' clear channel and members
    setSelfId(id: string | null): void;
    setVoiceSettings(raw: unknown): boolean;         // {mute, deaf}; false if the data is invalid
    setChannel(raw: unknown): boolean;               // null = not in a channel
    applyVoiceState(kind: 'create' | 'update' | 'delete', raw: unknown): boolean;
    setSpeaking(userId: unknown, speaking: boolean): boolean;
    get self(): { mute: boolean; deaf: boolean };
    get channelId(): string | null;
    snapshot(): VoiceState;
  }
  ```

Raw Discord shapes that are validated: channel `{ id: string, name: string, voice_states: Array<RawState> }`; `RawState = { nick?: string, user: { id: string, username: string, global_name?: string | null }, voice_state: { mute, deaf, self_mute, self_deaf: boolean } }`; speaking `{ user_id: string }`.

Rules: display name = `nick`, otherwise `global_name`, otherwise `username`, passed through `sanitizeName`; the member whose id is the user's own is named `Tú` (You) and goes first; `silenciado = mute || self_mute`; `ensordecido = deaf || self_deaf`; `clave` = first 8 hex characters of SHA-256 of `salt + id`; `canal.total` is the real number of people even when `miembros` is cut at `MAX_MEMBERS`.

- [ ] **Step 1: Failing tests:**
  - Initial state: `{ v:1, discord:'cerrado', canal:null, yo:{silenciado:false, ensordecido:false}, miembros:[] }`.
  - `setChannel` with three fictional people produces three members with the expected names according to the display-name rule, and `canal.total === 3`.
  - With 15 people: `miembros.length === 12`, `canal.total === 15`, and the user is included even if they arrive in position 14.
  - `applyVoiceState('create')` adds, `'update'` changes `silenciado`, `'delete'` removes the member and clears their "speaking" state.
  - `setSpeaking(id, true)` sets `habla`; for an id that is not in the channel it returns `false` and adds nothing.
  - `setChannel(otherChannel)` drops members and "speaking" indicators from the previous channel; `setChannel(null)` leaves `canal: null` and `miembros: []`.
  - `setStatus('cerrado')` clears channel and members.
  - Two trackers with different salts give different keys for the same id; the key matches `/^[0-9a-f]{8}$/`; the real id does not appear in `JSON.stringify(snapshot())`.
  - Invalid data returns `false` and does not change the `snapshot`: a channel without `voice_states`, a user without `id`, a `voice_state.mute` that is not a boolean, a string `raw`.
  - Every `snapshot()` passes `parseVoiceState` without returning `null` (assert it in each case above).
- [ ] **Step 2:** `pnpm test`. Expected: FAIL.
- [ ] **Step 3:** Implement `VoiceStateTracker` as a pure class, with no input or output.
- [ ] **Step 4:** `pnpm test && pnpm typecheck`. Expected: green.

### Task 5: Discord voice source and publisher

**Files:**
- Create: `src/bridge/sources/DiscordVoiceSource.ts`, `src/bridge/publishers/PhoneBoxPublisher.ts`
- Test: `tests/bridge/DiscordVoiceSource.test.ts`, `tests/bridge/PhoneBoxPublisher.test.ts`

**Interfaces:**
- Consumes: `RpcClient` (Task 2), `TokenService` (Task 3), `VoiceStateTracker`, `VoiceSource` (Task 4).
- Produces:
  ```ts
  export interface RpcLike {                       // RpcClient satisfies it; allows a test double
    connect(): Promise<void>;
    request(cmd: string, args?: object, evt?: string, timeoutMs?: number): Promise<unknown>;
    onEvent(handler: (evt: string, data: unknown) => void): void;
    onClose(handler: (reason: string) => void): void;
    close(): void;
  }
  export class DiscordVoiceSource implements VoiceSource {
    constructor(opts: {
      createRpc: () => RpcLike | null;             // null = Discord is not open
      tokens: { refresh(): Promise<string | null> };
      tracker: VoiceStateTracker;
      retryMs?: number;                            // 5000
      log?: (message: string) => void;
    });
  }
  export class PhoneBoxPublisher {
    constructor(opts: { baseUrl?: string; fetchFn: typeof fetch; minIntervalMs?: number; heartbeatMs?: number; ttlSec?: number });
    publish(state: VoiceState): void;              // never throws
    stop(): void;
  }
  ```

Source sequence after connecting: `tokens.refresh()`; if it is `null`, status `sin-autorizar`, close and retry after `retryMs`. With a token: `AUTHENTICATE {access_token}` (store `data.user.id` with `setSelfId`), `GET_VOICE_SETTINGS`, global `SUBSCRIBE` to `VOICE_SETTINGS_UPDATE` and `VOICE_CHANNEL_SELECT`, `GET_SELECTED_VOICE_CHANNEL`. On joining a channel: `SUBSCRIBE` with `{channel_id}` to `VOICE_STATE_CREATE`, `VOICE_STATE_UPDATE`, `VOICE_STATE_DELETE`, `SPEAKING_START`, `SPEAKING_STOP`; on leaving or switching, `UNSUBSCRIBE` from the previous channel's five. `VOICE_CHANNEL_SELECT` with a non-null `channel_id` requests `GET_SELECTED_VOICE_CHANNEL` again.

Commands: `alternar-silencio` → `SET_VOICE_SETTINGS {mute: !tracker.self.mute}`; `alternar-ensordecer` → `SET_VOICE_SETTINGS {deaf: !tracker.self.deaf}`; `colgar` → `SELECT_VOICE_CHANNEL {channel_id: null}`. Without an authenticated connection, `execute` rejects immediately.

- [ ] **Step 1: Source tests** with a fake `RpcLike` that records requests and can emit events:
  - Normal start: the requests of the sequence are sent in that order and `onChange` receives `discord: 'conectado'`.
  - `createRpc` returns `null`: `onChange` receives `cerrado` and it retries after `retryMs` (simulated clock with `t.mock.timers`).
  - `tokens.refresh()` returns `null`: `onChange` receives `sin-autorizar` and **no** `AUTHORIZE` or `AUTHENTICATE` is sent.
  - A `SPEAKING_START` event produces an `onChange` with `habla: true` for that member.
  - Channel switch: five `UNSUBSCRIBE` with the previous channel and five `SUBSCRIBE` with the new one are sent; the state keeps no members from the previous one.
  - `onClose`: `onChange` receives `cerrado` with `miembros: []` and it reconnects after `retryMs`.
  - `execute('alternar-silencio')` with current `mute` `false` sends `SET_VOICE_SETTINGS {mute: true}`; `execute('colgar')` sends `SELECT_VOICE_CHANNEL {channel_id: null}`; `execute` without a connection rejects.
  - `stop()` closes the connection and cancels pending retries.
  - No text passed to `log` contains the sentinel access token or names from the test data.
- [ ] **Step 2: Publisher tests** with a simulated clock: the first `publish` does `POST http://127.0.0.1:8765/api/push/discord-voice?ttl=15` with `Content-Type: application/json` and the state as body; ten `publish` calls in 100 ms produce at most two requests and the last one carries the most recent state; with no changes the last state is repeated every 5000 ms; a `fetchFn` that rejects does not propagate the error and the next heartbeat retries; the constructor throws if the host of `baseUrl` is not `127.0.0.1` or `localhost`; `stop()` cancels the heartbeat.
- [ ] **Step 3:** `pnpm test`. Expected: FAIL.
- [ ] **Step 4:** Implement both.
- [ ] **Step 5:** `pnpm test && pnpm typecheck`. Expected: green.

### Task 6: Control socket and entry points

**Files:**
- Create: `src/bridge/control/ControlServer.ts`, `src/bridge/main.ts`, `src/bridge/ctl.ts`, `src/bridge/setup.ts`, `scripts/build.mjs`
- Test: `tests/bridge/ControlServer.test.ts`

**Interfaces:**
- Consumes: `parseCommand`, `Command` (Task 1); everything above in `main.ts` and `setup.ts`.
- Produces:
  ```ts
  export function controlSocketPath(env: NodeJS.ProcessEnv): string;   // throws if XDG_RUNTIME_DIR is missing
  export class ControlServer {
    constructor(socketPath: string, onCommand: (command: Command) => Promise<void>);
    listen(): Promise<void>;     // throws AlreadyRunningError if another process answers on the socket
    close(): Promise<void>;      // deletes the socket file
  }
  export class AlreadyRunningError extends Error {}
  export function sendCommand(socketPath: string, command: Command, timeoutMs?: number): Promise<void>;  // 2000
  ```
  Protocol: the client sends one line; the server replies `ok\n` or `error\n` and closes.
  `dist/bridge.js`, `dist/ctl.js <command>` (exit code 0 or 1), `dist/setup.js`.

- [ ] **Step 1: Failing tests** in a temporary directory:
  - `sendCommand(..., 'colgar')` calls `onCommand('colgar')` and resolves.
  - The socket file has mode `0o600`.
  - A line `borrar-todo\n` gets `error\n` and `onCommand` is not called; a 1000-byte line with no newline gets `error\n` and the connection closes after reading at most 64 bytes.
  - If `onCommand` rejects, the reply is `error\n` and `sendCommand` rejects.
  - A client that connects and sends nothing is disconnected after 2 s (simulated clock) and the server keeps serving others.
  - With an old socket file and nobody listening, `listen()` replaces it and works.
  - With a live `ControlServer` on the same path, a second `listen()` throws `AlreadyRunningError` and the first keeps working.
  - `sendCommand` to a non-existent path rejects in under 2 s.
  - `controlSocketPath({})` throws; with `XDG_RUNTIME_DIR=/run/user/1000` it returns `/run/user/1000/phonebox-discord-widget.sock`.
- [ ] **Step 2:** `pnpm test`. Expected: FAIL.
- [ ] **Step 3:** Implement `ControlServer` and `sendCommand`. Mode 0600 is set with `process.umask(0o177)` around `listen` and restored afterwards.
- [ ] **Step 4:** Implement `main.ts`: loads `loadConfig(configPath(env))`, creates `KeyringSecretStore`, `TokenService`, `VoiceStateTracker(randomBytes(16).toString('hex'))`, `DiscordVoiceSource` (with `createRpc` based on `findDiscordSocket`), `PhoneBoxPublisher` and `ControlServer`; `SIGTERM` and `SIGINT` stop everything and delete the socket. A `ConfigError` or `KeyringUnavailableError` at startup writes one line to stderr telling the user to run `pnpm run setup` and exits with code 1.
- [ ] **Step 5:** Implement `ctl.ts`: `parseCommand(process.argv[2] ?? '')`; if it is `null`, prints the valid commands and exits with 1; otherwise `sendCommand` and exits with 0 or 1.
- [ ] **Step 6:** Implement `setup.ts`: asks for the Client ID (validated with the same expression as Task 3) and the Client Secret with hidden input (raw mode on `process.stdin`, no echo); saves with `saveConfig` and `store.set('client-secret', ...)`; connects to Discord; sends `AUTHORIZE {client_id, scopes: ['rpc','rpc.voice.read','rpc.voice.write']}` with a 120 s wait; calls `tokens.exchangeCode`; prints `Autorización guardada en el llavero.` (Authorization saved in the keyring). If `secret-tool` or the keyring is missing, prints `No hay llavero del sistema disponible; no se guardó nada.` (No system keyring available; nothing was saved) and exits with 1. Never prints the secret, the code or the tokens.
- [ ] **Step 7:** Implement `scripts/build.mjs` for the bridge's three entry points: `esbuild` with `bundle: true`, `platform: 'node'`, `format: 'esm'`, `target: 'node24'`, output in `dist/`.
- [ ] **Step 8:** `pnpm test && pnpm typecheck && pnpm build`. Then `node dist/ctl.js borrar-todo; echo $?` → `1`; `node dist/ctl.js colgar; echo $?` with the bridge stopped → `1` in under 2 s.

### Task 7: Live bridge verification (with the user)

**Files:** none new.

- [ ] **Step 1:** Ask the user to run `pnpm run setup` in their own terminal (hidden secret input) and to click **Authorize** in Discord. Expected: `Autorización guardada en el llavero.`
- [ ] **Step 2:** Run `node dist/bridge.js` in the background and query `curl -s http://127.0.0.1:8765/api/push`. Expected: a `discord-voice` entry with `discord: "conectado"`. Report only counts and booleans, not names.
- [ ] **Step 3:** With the user in a channel: `node dist/ctl.js alternar-silencio` twice; check that `yo.silenciado` changes to `true` and back to `false` in `/api/push`.
- [ ] **Step 4:** Stop the bridge; after 15 s `/api/push` no longer contains `discord-voice`.
- [ ] **Step 5: Secret scan.** `grep -rlF -f <(secret-tool lookup service phonebox-discord-widget name client-secret) . --exclude-dir=node_modules --exclude=.env` and the same with `name refresh-token`: neither returns any file. The value is passed as a pattern file, never as an argument or on screen.

### Task 8: Widget

**Files:**
- Create: `src/widget/services/PhoneBoxClient.ts`, `src/widget/components/StatusBanner.ts`, `MemberList.ts`, `ControlBar.ts`, `VoicePanel.ts`, `src/widget/styles/widget.css`, `src/widget/index.html`, `src/widget/main.ts`, `tests/helpers/fakeDom.ts`
- Modify: `scripts/build.mjs` (add the widget)
- Test: `tests/widget/PhoneBoxClient.test.ts`, `tests/widget/VoicePanel.test.ts`, `tests/widget/security.test.ts`

**Interfaces:**
- Consumes: `VoiceState`, `parseVoiceState`, `PUSH_KEY` (Task 1).
- Produces:
  ```ts
  export interface PhoneBoxApi { on(kind: string, handler: (value: unknown) => void): void; run(id: string): void }
  export type PanelView =
    | { kind: 'sin-conexion' } | { kind: 'cerrado' } | { kind: 'sin-autorizar' }
    | { kind: 'conectado'; state: VoiceState };
  export class PhoneBoxClient {
    constructor(api: PhoneBoxApi, opts?: { staleMs?: number });   // 15000
    onView(handler: (view: PanelView) => void): void;
    run(id: 'discord-mute' | 'discord-deafen' | 'discord-hangup' | 'discord-open'): void;
  }
  export class VoicePanel { constructor(doc: Document, root: HTMLElement, client: PhoneBoxClient); render(view: PanelView): void }
  ```

Incoming data: `phonebox.on('push', fn)` delivers a map `{ [key]: { data, at, expiresAt } }`. The client takes `map['discord-voice']?.data`, passes it through `parseVoiceState` and treats as `sin-conexion` (no connection) any data that is missing, invalid, or whose `at` does not change during `staleMs` (measured with its own timer, without comparing against the phone's clock).

Exact interface text: `No estás en un canal de voz` (You are not in a voice channel), `Discord está cerrado` (Discord is closed), `Abrir Discord` (Open Discord), `Sin conexión con la PC` (No connection to the PC), `Falta autorizar: ejecuta "pnpm run setup" en la PC` (Authorization missing: run "pnpm run setup" on the PC), `Silenciar` / `Silenciado` (Mute / Muted), `Ensordecer` / `Ensordecido` (Deafen / Deafened), `Colgar` (Hang up), `N en voz` (N in voice). The `Colgar` button only appears inside a channel.

- [ ] **Step 1:** Create `tests/helpers/fakeDom.ts`: a minimal `Document` (`createElement`, `createTextNode`) with elements that support `textContent`, `append`, `replaceChildren`, `classList`, `dataset`, `setAttribute`, `addEventListener`, `click()` and `querySelector` by class; define `innerHTML`, `outerHTML` and `insertAdjacentHTML` as accessors that **throw**.
- [ ] **Step 2: `PhoneBoxClient` tests** with a simulated clock: a map with a valid `discord-voice` → view `conectado`; `discord: 'cerrado'` → `cerrado`; `sin-autorizar` → `sin-autorizar`; empty map, invalid `data` or a value that is not an object → `sin-conexion`; the same `at` repeated for 15 s → `sin-conexion`; a new `at` before 15 s keeps `conectado`; `run('discord-mute')` calls `api.run('discord-mute')`.
- [ ] **Step 3: `VoicePanel` tests** with `fakeDom`: each of the five views shows its exact text; in a channel with Ana (speaking), Bruno (muted) and Tú, there are three rows, Ana's has the `habla` class and Bruno's shows the mute indicator; `yo.silenciado: true` sets the text `Silenciado` and the `activo` class on that button; pressing each button calls `client.run` with its id; `Colgar` does not exist outside a channel; `Abrir Discord` exists only in the `cerrado` view; a member named `<img src=x onerror=alert(1)>` appears with that literal text in `textContent` and the tree contains no `img` element; rendering the same state twice does not duplicate rows; names `?` and 32-character names render without throwing.
- [ ] **Step 4: `tests/widget/security.test.ts`:** read every file in `src/widget/` and assert that none contains `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval(` or `new Function`; after `pnpm build`, assert that `dist/widget.html` contains no `</script>` inside the script block other than the final closing tag, contains no `http://` or `https://` (the widget loads nothing from the internet) and weighs less than 64 KB.
- [ ] **Step 5:** `pnpm test`. Expected: FAIL.
- [ ] **Step 6:** Implement the client, the components (each class receives `doc` and creates its own root element) and `main.ts`, which instantiates `PhoneBoxClient(window.phonebox)` and `VoicePanel`. CSS with `vh`/`vw` units like the agent's example widget, transparent background, touch targets at least 20 vh tall, and `text-overflow: ellipsis` on names.
- [ ] **Step 7:** Extend `scripts/build.mjs`: bundle `src/widget/main.ts` as a minified `iife` for `es2020`, replace `</script` with `<\/script` in the output and insert CSS and JS at the `/*CSS*/` and `/*JS*/` markers of `src/widget/index.html`, producing `dist/widget.html`.
- [ ] **Step 8:** `pnpm build && pnpm test && pnpm typecheck`. Expected: green.

### Task 9: PhoneBox installation and service

**Files:**
- Create: `scripts/install.mjs`, `scripts/lib/phoneboxConfig.mjs`
- Test: `tests/scripts/phoneboxConfig.test.ts`

**Interfaces:**
- Produces:
  ```js
  // scripts/lib/phoneboxConfig.mjs
  export function applyWidget(config, { html, nodePath, ctlPath }) // returns a modified copy; does not mutate the input
  ```

`applyWidget`: adds or replaces by id the shortcuts `discord-mute` (`cmd: nodePath`, `args: ctlPath + ' alternar-silencio'`), `discord-deafen` (`... alternar-ensordecer`), `discord-hangup` (`... colgar`) and `discord-open` (`cmd: 'discord'`); in every `shortcuts` widget whose `ids` option is empty or missing, sets `ids` to the ids of the shortcuts that do **not** start with `discord-`; adds or replaces the page `{ id: 'discord', title: 'Discord', icon: '🎮', enabled: true, widgets: [{ id: 'discord-voice', type: 'html', x: 0, y: 0, w: 12, h: 6, options: { html, transparent: false } }] }`.

- [ ] **Step 1: Failing tests** with a fictional configuration of 11 shortcuts and a page with a `shortcuts` widget without `ids`: after `applyWidget` there are 15 shortcuts; the `shortcuts` widget lists exactly the 11 originals; the `discord` page exists with the given HTML; applying it twice gives the same result as once; a `shortcuts` widget that already had `ids` is not modified; the input is not mutated; it rejects (throws) if `ctlPath` or `nodePath` contain spaces or quotes.
- [ ] **Step 2:** `pnpm test`. Expected: FAIL.
- [ ] **Step 3:** Implement `applyWidget` and `scripts/install.mjs`: requires `dist/widget.html` to exist; copies `~/.config/PhoneBox/config.json` to `config.json.pre-discord.bak` (without overwriting an earlier copy); `GET /api/settings` keeping `X-Config-Version`; `PUT /api/settings` with that header; writes `~/.config/systemd/user/phonebox-discord-widget.service` (`ExecStart=<process.execPath> <absolute path>/dist/bridge.js`, `Restart=on-failure`, `RestartSec=5`, `After=graphical-session.target phonebox.service`, `WantedBy=default.target`) and runs `systemctl --user daemon-reload` and `enable --now`. With `--uninstall` it reverts all three.
- [ ] **Step 4:** `pnpm test && pnpm build && pnpm install-widget`. Expected: `systemctl --user is-active phonebox-discord-widget.service` → `active`; `GET /api/settings` contains the `discord` page and 15 shortcuts; the "Shortcuts" page still shows 11.

### Task 10: Phone verification, threat model and wrap-up

**Files:**
- Create: `docs/threat-model.md`, `tests/fixtures/*.json`
- Modify: `README.md`
- Delete: `spike/`

- [ ] **Step 1: States with fictional data.** Stop the service and publish each state by hand with `curl -X POST 'http://127.0.0.1:8765/api/push/discord-voice?ttl=60' -H 'Content-Type: application/json' -d @tests/fixtures/<state>.json` (create the five files in `tests/fixtures/` with Ana, Bruno, Carla, Diego and Tú; one with 12 members and `total: 15`; one with the name `<img src=x onerror=alert(1)>`). After each one, `adb exec-out screencap -p` and review the screenshot: exact text, nothing overflowing, the HTML name shown as text. Delete the key with `DELETE` and check for `Sin conexión con la PC` after 15 s.
- [ ] **Step 2: Live with the user.** Re-enable the service. The user confirms, looking at the phone inside a channel: the channel and who is talking appear; the three buttons act and change state; when Discord is closed, `Discord está cerrado` appears and `Abrir Discord` opens it. No screenshots are taken in this step (real names).
- [ ] **Step 3:** Write `docs/threat-model.md` with one row per threat and columns asset, vector, impact, likelihood, mitigation, evidence (file and test): XSS through Discord names; arbitrary command from the phone; another local user writing to the socket; secret or token on disk, in logs or in the repository; stolen refresh token; third parties' personal data on the phone or in screenshots; compromised dependency; another local process impersonating the Discord socket; stale state shown as current.
- [ ] **Step 4:** Update `README.md`: installation (`pnpm install`, `pnpm build`, `pnpm run setup`, `pnpm install-widget`), uninstallation, how to run the tests, and links to the design and to `docs/threat-model.md`. Remove the "To be decided" section.
- [ ] **Step 5:** Delete `spike/`. Tell the user they can delete `.env`, because the secret is already in the keyring.
- [ ] **Step 6: Closing gate.** `pnpm test`, `pnpm typecheck`, `pnpm audit` and the secret scan from Task 7 step 5, all green, with the output pasted in the final report.
