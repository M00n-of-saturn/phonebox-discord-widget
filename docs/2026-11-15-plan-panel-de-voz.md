# Panel de voz de Discord: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un widget de PhoneBox que muestra el canal de voz de Discord, sus participantes y quién habla, con botones de silenciar, ensordecer y colgar que reflejan el estado real.

**Architecture:** Un `bridge` en la PC (servicio de usuario de systemd) habla con Discord por su socket local, mantiene un estado propio validado y lo publica en el agente de PhoneBox (`POST /api/push/discord-voice`). El `widget` (un bloque de HTML en el sandbox del panel) solo dibuja ese estado y pide acciones por id de acceso directo; cada acceso directo ejecuta `ctl`, que envía una palabra fija al bridge por un socket Unix.

**Tech Stack:** TypeScript sobre Node 24 (ejecuta `.ts` directo para las pruebas), `esbuild` para empaquetar, `node:test` para pruebas, `secret-tool` (KWallet) para secretos. Sin dependencias en ejecución.

**Spec:** `docs/2026-11-15-diseno-panel-de-voz.md`

## Global Constraints

- Dependencias: solo `typescript`, `esbuild` y `@types/node`, todas de desarrollo, con lockfile de pnpm. `pnpm audit` sin altas ni críticas.
- TypeScript: `strict`, `erasableSyntaxOnly`, `allowImportingTsExtensions`, `noEmit`; imports relativos con extensión `.ts`; sin `enum` ni propiedades de parámetro.
- Ningún secreto en el repositorio, en `dist/`, en registros, en la configuración de PhoneBox ni en datos enviados al teléfono. Los secretos nunca se pasan como argumentos de un proceso.
- En `src/widget/` están prohibidos `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval` y `new Function`. Todo texto se dibuja con `textContent`.
- Clave de publicación: `discord-voice`. `ttl`: 15 s. Latido: 5 s. Máximo 5 envíos por segundo. Máximo 12 miembros. Nombres de hasta 32 caracteres sin caracteres de control.
- Órdenes aceptadas: `alternar-silencio`, `alternar-ensordecer`, `colgar`. Ninguna otra.
- Ids de accesos directos: `discord-mute`, `discord-deafen`, `discord-hangup`, `discord-open`.
- Socket de control: `$XDG_RUNTIME_DIR/phonebox-discord-widget.sock`, permisos 0600. El bridge no abre puertos de red y solo publica en `http://127.0.0.1:8765`.
- Los registros incluyen tipo de evento y códigos, nunca nombres, ids, tokens ni cuerpos de mensajes.
- Textos de la interfaz en español neutro, exactamente como figuran en este plan.
- Datos de prueba ficticios (Ana, Bruno, Carla...). Ninguna captura ni prueba usa nombres reales.
- Sin commits: el proyecto no está en git. Si el usuario lo pide, un commit por tarea.

## Review Focus

1. Nombre vacío, solo espacios, solo emoji, con caracteres de control o con HTML: se muestra como texto seguro o como `?`, sin romper la fila. (Tarea 1 y Tarea 8)
2. Más de 12 personas en el canal: se muestran 12 y el contador indica el total real. (Tarea 4)
3. Cambio de canal o reinicio de Discord estando en voz: no quedan miembros del canal anterior ni indicadores de "habla" pegados. (Tarea 4 y Tarea 5)
4. Botón pulsado con el bridge detenido o Discord cerrado: `ctl` termina con error en menos de 2 s y nada queda colgado. (Tarea 6)
5. Archivo de socket viejo tras una caída, o segundo bridge arrancando: el viejo se reemplaza solo si nadie escucha; con un bridge vivo, el segundo termina con error. (Tarea 6)

---

## Estructura de archivos

```
package.json, tsconfig.json
src/shared/models/VoiceState.ts        Modelo del estado, saneado de nombres y validación
src/shared/models/Command.ts           Lista de órdenes y su validación
src/bridge/discord/FrameCodec.ts       Codifica y decodifica tramas del socket de Discord
src/bridge/discord/RpcClient.ts        Conexión, peticiones con nonce y eventos
src/bridge/auth/SecretStore.ts         Interfaz de secretos; llavero y versión en memoria
src/bridge/auth/TokenService.ts        Canje y refresco de tokens OAuth2
src/bridge/config/BridgeConfig.ts      Lee y valida config.json
src/bridge/sources/VoiceSource.ts      Interfaz de un origen de estado de voz
src/bridge/sources/VoiceStateTracker.ts  Traduce datos crudos de Discord a VoiceState
src/bridge/sources/DiscordVoiceSource.ts Une RpcClient, TokenService y el tracker; reconexión
src/bridge/publishers/PhoneBoxPublisher.ts Publica en el agente con límite y latido
src/bridge/control/ControlServer.ts    Socket Unix que recibe órdenes
src/bridge/main.ts | ctl.ts | setup.ts Puntos de entrada
src/widget/services/PhoneBoxClient.ts  Envuelve window.phonebox y detecta datos caducados
src/widget/components/*.ts             StatusBanner, MemberList, ControlBar, VoicePanel
src/widget/styles/widget.css, src/widget/index.html, src/widget/main.ts
scripts/build.mjs, scripts/install.mjs, scripts/lib/phoneboxConfig.mjs
tests/**                               Espejo de src/, más tests/helpers/fakeDom.ts
docs/amenazas.md
```

---

### Task 1: Proyecto y modelos compartidos

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
  export function sanitizeName(raw: unknown): string;          // '?' si no queda nada
  export function parseVoiceState(raw: unknown): VoiceState | null;
  export const COMMANDS = ['alternar-silencio', 'alternar-ensordecer', 'colgar'] as const;
  export type Command = (typeof COMMANDS)[number];
  export function parseCommand(raw: string): Command | null;
  ```

- [ ] **Step 1:** Crear `package.json` (`"type": "module"`, `"private": true`, scripts `test`: `node --test "tests/**/*.test.ts"`, `typecheck`: `tsc`, `build`: `node scripts/build.mjs`, `setup`: `node dist/setup.js`, `install-widget`: `node scripts/install.mjs`) y `tsconfig.json` con las opciones de Global Constraints. Ejecutar `pnpm add -D typescript esbuild` y `pnpm audit`. Esperado: sin vulnerabilidades altas ni críticas.
- [ ] **Step 2: Pruebas que fallan** en `tests/shared/VoiceState.test.ts`:
  - `sanitizeName('  Ana  ') === 'Ana'`; `sanitizeName('A\u0000n​a\n') === 'Ana'`; `sanitizeName('x'.repeat(40)).length === 32`; `sanitizeName('   ') === '?'`; `sanitizeName(42) === '?'`; `sanitizeName('<img src=x onerror=alert(1)>')` devuelve la misma cadena recortada a 32 (el escape es responsabilidad de `textContent`); `sanitizeName('🎧') === '🎧'`.
  - `parseVoiceState` acepta el ejemplo del diseño y devuelve un objeto igual.
  - Devuelve `null` con: `v: 2`; `discord: 'otro'`; `miembros` con 13 elementos; un miembro sin `clave`; `clave` que no cumpla `/^[0-9a-f]{8}$/`; `nombre` de 33 caracteres; `habla: 'si'`; `canal.total` negativo o no entero; `raw` igual a `null`, cadena o arreglo.
  - Ignora propiedades desconocidas (no aparecen en el resultado).
- [ ] **Step 3:** En `tests/shared/Command.test.ts`: `parseCommand('colgar') === 'colgar'`; `parseCommand('colgar\n') === 'colgar'`; devuelve `null` para `''`, `'COLGAR'`, `'colgar; rm -rf ~'`, `'alternar-silencio alternar-ensordecer'` y una cadena de 100 caracteres.
- [ ] **Step 4:** `pnpm test`. Esperado: FALLA por módulos inexistentes.
- [ ] **Step 5:** Implementar ambos archivos. `sanitizeName` elimina `\p{Cc}` y `\p{Cf}`, recorta espacios y corta por puntos de código (no por unidades UTF-16) a `MAX_NAME`. `parseCommand` quita un único salto de línea final y compara por igualdad exacta contra `COMMANDS`.
- [ ] **Step 6:** `pnpm test && pnpm typecheck`. Esperado: todo en verde.

### Task 2: Tramas y cliente de la conexión local de Discord

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
  export class FrameDecoder { push(chunk: Buffer): Frame[] }   // lanza FrameError

  export class RpcError extends Error { code: number | null }
  export function findDiscordSocket(env: NodeJS.ProcessEnv, exists: (p: string) => boolean): string | null;
  export class RpcClient {
    constructor(socketPath: string, clientId: string);
    connect(): Promise<void>;                                   // resuelve al recibir READY
    request(cmd: string, args?: object, evt?: string, timeoutMs?: number): Promise<unknown>;
    onEvent(handler: (evt: string, data: unknown) => void): void;
    onClose(handler: (reason: string) => void): void;
    close(): void;
  }
  ```

- [ ] **Step 1: Pruebas de `FrameCodec`:** ida y vuelta de `{cmd:'X'}`; una trama entregada byte a byte produce exactamente una `Frame`; dos tramas en un solo trozo producen dos; longitud negativa y longitud mayor que `MAX_FRAME_BYTES` lanzan `FrameError`; cuerpo que no es JSON lanza `FrameError`; texto con `ñ` y emoji conserva los bytes.
- [ ] **Step 2: Pruebas de `RpcClient`** contra un servidor `net` en un socket temporal (`fs.mkdtemp`): `connect()` envía `HANDSHAKE` con `{v:1, client_id}` y resuelve tras `READY`; `request` resuelve con `data` de la respuesta con el mismo `nonce`; una respuesta `evt:'ERROR'` rechaza con `RpcError` y su `code`; sin respuesta rechaza al vencer `timeoutMs`; un `DISPATCH` sin `nonce` llega a `onEvent`; `PING` recibe `PONG` con el mismo cuerpo; `CLOSE` del servidor dispara `onClose` y rechaza las peticiones pendientes; una trama inválida cierra la conexión y dispara `onClose`.
  `findDiscordSocket` devuelve `$XDG_RUNTIME_DIR/discord-ipc-0` si existe, prueba índices 0 a 9, luego `$XDG_RUNTIME_DIR/app/com.discordapp.Discord/` y `null` si no hay ninguno.
- [ ] **Step 3:** `pnpm test`. Esperado: FALLA.
- [ ] **Step 4:** Implementar. Referencia de protocolo que ya funciona: `spike/discord-rpc-probe.mjs` (cabecera de 8 bytes: operación y longitud como enteros de 32 bits little-endian). A diferencia de la prueba, ningún error llama a `process.exit`.
- [ ] **Step 5:** `pnpm test && pnpm typecheck`. Esperado: verde.

### Task 3: Secretos, tokens y configuración

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
  export class KeyringSecretStore implements SecretStore {}     // lanza KeyringUnavailableError
  export class KeyringUnavailableError extends Error {}

  export class TokenService {
    constructor(opts: { clientId: string; redirectUri: string; store: SecretStore; fetchFn: typeof fetch });
    exchangeCode(code: string): Promise<string>;      // guarda el refresh token, devuelve el access token
    refresh(): Promise<string | null>;                 // null si no hay refresh token o Discord lo rechaza
  }

  export interface BridgeConfig { clientId: string; redirectUri: string }
  export function configPath(env: NodeJS.ProcessEnv): string;   // $XDG_CONFIG_HOME o ~/.config, + /phonebox-discord-widget/config.json
  export function loadConfig(path: string): BridgeConfig;       // lanza ConfigError
  export function saveConfig(path: string, config: BridgeConfig): void;  // carpeta 0700, archivo 0600
  export class ConfigError extends Error {}
  ```

- [ ] **Step 1: Pruebas de `TokenService`** con `MemorySecretStore` y un `fetchFn` falso: `exchangeCode('abc')` hace `POST https://discord.com/api/oauth2/token` con cuerpo `application/x-www-form-urlencoded` que contiene `grant_type=authorization_code`, `code`, `client_id`, `client_secret` y `redirect_uri`; guarda `refresh-token` y devuelve el `access_token`. `refresh()` sin token guardado devuelve `null` sin llamar a `fetchFn`; con token usa `grant_type=refresh_token` y **reemplaza** el token guardado por el nuevo; ante HTTP 400 con `invalid_grant` borra el token guardado y devuelve `null`; ante HTTP 500 o error de red lanza, y el token guardado se conserva. Sin `client-secret` en el almacén, ambos métodos lanzan un error cuyo mensaje no contiene ningún valor secreto. Ningún mensaje de error incluye `code`, tokens ni el secreto (afirmarlo con valores centinela).
- [ ] **Step 2: Pruebas de `BridgeConfig`:** ida y vuelta de `saveConfig`/`loadConfig` en una carpeta temporal; el archivo queda con modo `0o600`; `loadConfig` lanza `ConfigError` si falta el archivo, si no es JSON, o si `clientId` no cumple `/^\d{15,25}$/`; `redirectUri` por defecto `http://localhost`.
- [ ] **Step 3: Prueba de `KeyringSecretStore`** (se omite con `t.skip` si `secret-tool` no está en el PATH): guarda, lee y borra una entrada con atributos `service phonebox-discord-widget-test name refresh-token` y un valor ficticio; `get` de una entrada inexistente devuelve `null`.
- [ ] **Step 4:** `pnpm test`. Esperado: FALLA.
- [ ] **Step 5:** Implementar. `KeyringSecretStore` usa `execFile('secret-tool', ['store', '--label', ..., 'service', servicio, 'name', nombre])` con el valor escrito por **stdin**, `lookup` y `clear`; el nombre del servicio es un parámetro del constructor con valor por defecto `phonebox-discord-widget`. `ENOENT` o un código de salida distinto de 0 y 1 lanzan `KeyringUnavailableError`.
- [ ] **Step 6:** `pnpm test && pnpm typecheck`. Esperado: verde.

### Task 4: Traductor de estado de voz

**Files:**
- Create: `src/bridge/sources/VoiceSource.ts`, `src/bridge/sources/VoiceStateTracker.ts`
- Test: `tests/bridge/VoiceStateTracker.test.ts`

**Interfaces:**
- Consumes: `VoiceState`, `DiscordStatus`, `sanitizeName`, `MAX_MEMBERS`, `Command` (Tarea 1).
- Produces:
  ```ts
  export interface VoiceSource {
    start(onChange: (state: VoiceState) => void): void;
    execute(command: Command): Promise<void>;
    stop(): void;
  }
  export class VoiceStateTracker {
    constructor(salt: string);
    setStatus(status: DiscordStatus): void;          // 'cerrado' y 'sin-autorizar' vacían canal y miembros
    setSelfId(id: string | null): void;
    setVoiceSettings(raw: unknown): boolean;         // {mute, deaf}; false si el dato es inválido
    setChannel(raw: unknown): boolean;               // null = fuera de un canal
    applyVoiceState(kind: 'create' | 'update' | 'delete', raw: unknown): boolean;
    setSpeaking(userId: unknown, speaking: boolean): boolean;
    get self(): { mute: boolean; deaf: boolean };
    get channelId(): string | null;
    snapshot(): VoiceState;
  }
  ```

Formas crudas de Discord que se validan: canal `{ id: string, name: string, voice_states: Array<EstadoCrudo> }`; `EstadoCrudo = { nick?: string, user: { id: string, username: string, global_name?: string | null }, voice_state: { mute, deaf, self_mute, self_deaf: boolean } }`; habla `{ user_id: string }`.

Reglas: nombre visible = `nick`, si no `global_name`, si no `username`, pasado por `sanitizeName`; el miembro cuyo id es el propio se llama `Tú` y va primero; `silenciado = mute || self_mute`; `ensordecido = deaf || self_deaf`; `clave` = primeros 8 caracteres hexadecimales de SHA-256 de `salt + id`; `canal.total` es el número real de personas aunque `miembros` se corte en `MAX_MEMBERS`.

- [ ] **Step 1: Pruebas que fallan:**
  - Estado inicial: `{ v:1, discord:'cerrado', canal:null, yo:{silenciado:false, ensordecido:false}, miembros:[] }`.
  - `setChannel` con tres personas ficticias produce tres miembros con los nombres esperados según la regla de nombre visible, y `canal.total === 3`.
  - Con 15 personas: `miembros.length === 12`, `canal.total === 15`, y el propio usuario está incluido aunque llegue en la posición 14.
  - `applyVoiceState('create')` agrega, `'update'` cambia `silenciado`, `'delete'` quita y borra su estado de "habla".
  - `setSpeaking(id, true)` marca `habla`; para un id que no está en el canal devuelve `false` y no agrega nada.
  - `setChannel(otroCanal)` descarta miembros e indicadores de "habla" del canal anterior; `setChannel(null)` deja `canal: null` y `miembros: []`.
  - `setStatus('cerrado')` vacía canal y miembros.
  - Dos trackers con sales distintas dan claves distintas para el mismo id; la clave cumple `/^[0-9a-f]{8}$/`; el id real no aparece en `JSON.stringify(snapshot())`.
  - Datos inválidos devuelven `false` y no cambian el `snapshot`: canal sin `voice_states`, usuario sin `id`, `voice_state.mute` que no es booleano, `raw` cadena.
  - Todo `snapshot()` pasa por `parseVoiceState` sin devolver `null` (afirmarlo en cada caso anterior).
- [ ] **Step 2:** `pnpm test`. Esperado: FALLA.
- [ ] **Step 3:** Implementar `VoiceStateTracker` como clase pura, sin entrada ni salida.
- [ ] **Step 4:** `pnpm test && pnpm typecheck`. Esperado: verde.

### Task 5: Origen de voz de Discord y publicador

**Files:**
- Create: `src/bridge/sources/DiscordVoiceSource.ts`, `src/bridge/publishers/PhoneBoxPublisher.ts`
- Test: `tests/bridge/DiscordVoiceSource.test.ts`, `tests/bridge/PhoneBoxPublisher.test.ts`

**Interfaces:**
- Consumes: `RpcClient` (Tarea 2), `TokenService` (Tarea 3), `VoiceStateTracker`, `VoiceSource` (Tarea 4).
- Produces:
  ```ts
  export interface RpcLike {                       // lo cumple RpcClient; permite un doble en pruebas
    connect(): Promise<void>;
    request(cmd: string, args?: object, evt?: string, timeoutMs?: number): Promise<unknown>;
    onEvent(handler: (evt: string, data: unknown) => void): void;
    onClose(handler: (reason: string) => void): void;
    close(): void;
  }
  export class DiscordVoiceSource implements VoiceSource {
    constructor(opts: {
      createRpc: () => RpcLike | null;             // null = Discord no está abierto
      tokens: { refresh(): Promise<string | null> };
      tracker: VoiceStateTracker;
      retryMs?: number;                            // 5000
      log?: (message: string) => void;
    });
  }
  export class PhoneBoxPublisher {
    constructor(opts: { baseUrl?: string; fetchFn: typeof fetch; minIntervalMs?: number; heartbeatMs?: number; ttlSec?: number });
    publish(state: VoiceState): void;              // nunca lanza
    stop(): void;
  }
  ```

Secuencia del origen tras conectar: `tokens.refresh()`; si es `null`, estado `sin-autorizar`, cerrar y reintentar en `retryMs`. Si hay token: `AUTHENTICATE {access_token}` (guardar `data.user.id` con `setSelfId`), `GET_VOICE_SETTINGS`, `SUBSCRIBE` global a `VOICE_SETTINGS_UPDATE` y `VOICE_CHANNEL_SELECT`, `GET_SELECTED_VOICE_CHANNEL`. Al entrar a un canal: `SUBSCRIBE` con `{channel_id}` a `VOICE_STATE_CREATE`, `VOICE_STATE_UPDATE`, `VOICE_STATE_DELETE`, `SPEAKING_START`, `SPEAKING_STOP`; al salir o cambiar, `UNSUBSCRIBE` de los cinco del canal anterior. `VOICE_CHANNEL_SELECT` con `channel_id` no nulo vuelve a pedir `GET_SELECTED_VOICE_CHANNEL`.

Órdenes: `alternar-silencio` → `SET_VOICE_SETTINGS {mute: !tracker.self.mute}`; `alternar-ensordecer` → `SET_VOICE_SETTINGS {deaf: !tracker.self.deaf}`; `colgar` → `SELECT_VOICE_CHANNEL {channel_id: null}`. Sin conexión autenticada, `execute` rechaza de inmediato.

- [ ] **Step 1: Pruebas del origen** con un `RpcLike` falso que registra peticiones y permite emitir eventos:
  - Arranque normal: se emiten las peticiones de la secuencia en ese orden y `onChange` recibe `discord: 'conectado'`.
  - `createRpc` devuelve `null`: `onChange` recibe `cerrado` y se reintenta tras `retryMs` (reloj simulado con `t.mock.timers`).
  - `tokens.refresh()` devuelve `null`: `onChange` recibe `sin-autorizar` y **no** se envía `AUTHORIZE` ni `AUTHENTICATE`.
  - Evento `SPEAKING_START` produce un `onChange` con `habla: true` para ese miembro.
  - Cambio de canal: se envían cinco `UNSUBSCRIBE` con el canal anterior y cinco `SUBSCRIBE` con el nuevo; el estado no conserva miembros del anterior.
  - `onClose`: `onChange` recibe `cerrado` con `miembros: []` y se reconecta tras `retryMs`.
  - `execute('alternar-silencio')` con `mute` actual `false` envía `SET_VOICE_SETTINGS {mute: true}`; `execute('colgar')` envía `SELECT_VOICE_CHANNEL {channel_id: null}`; `execute` sin conexión rechaza.
  - `stop()` cierra la conexión y cancela reintentos pendientes.
  - Ningún texto pasado a `log` contiene el token de acceso centinela ni nombres de los datos de prueba.
- [ ] **Step 2: Pruebas del publicador** con reloj simulado: el primer `publish` hace `POST http://127.0.0.1:8765/api/push/discord-voice?ttl=15` con `Content-Type: application/json` y el estado como cuerpo; diez `publish` en 100 ms producen como máximo dos peticiones y la última lleva el estado más reciente; sin cambios se repite el último estado cada 5000 ms; un `fetchFn` que rechaza no propaga el error y el siguiente latido reintenta; el constructor lanza si el host de `baseUrl` no es `127.0.0.1` o `localhost`; `stop()` cancela el latido.
- [ ] **Step 3:** `pnpm test`. Esperado: FALLA.
- [ ] **Step 4:** Implementar ambos.
- [ ] **Step 5:** `pnpm test && pnpm typecheck`. Esperado: verde.

### Task 6: Socket de control y puntos de entrada

**Files:**
- Create: `src/bridge/control/ControlServer.ts`, `src/bridge/main.ts`, `src/bridge/ctl.ts`, `src/bridge/setup.ts`, `scripts/build.mjs`
- Test: `tests/bridge/ControlServer.test.ts`

**Interfaces:**
- Consumes: `parseCommand`, `Command` (Tarea 1); todo lo anterior en `main.ts` y `setup.ts`.
- Produces:
  ```ts
  export function controlSocketPath(env: NodeJS.ProcessEnv): string;   // lanza si falta XDG_RUNTIME_DIR
  export class ControlServer {
    constructor(socketPath: string, onCommand: (command: Command) => Promise<void>);
    listen(): Promise<void>;     // lanza AlreadyRunningError si otro proceso responde en el socket
    close(): Promise<void>;      // borra el archivo del socket
  }
  export class AlreadyRunningError extends Error {}
  export function sendCommand(socketPath: string, command: Command, timeoutMs?: number): Promise<void>;  // 2000
  ```
  Protocolo: el cliente envía una línea; el servidor responde `ok\n` o `error\n` y cierra.
  `dist/bridge.js`, `dist/ctl.js <orden>` (código de salida 0 o 1), `dist/setup.js`.

- [ ] **Step 1: Pruebas que fallan** en una carpeta temporal:
  - `sendCommand(..., 'colgar')` llama a `onCommand('colgar')` y resuelve.
  - El archivo del socket tiene modo `0o600`.
  - Una línea `borrar-todo\n` recibe `error\n` y `onCommand` no se llama; una línea de 1000 bytes sin salto de línea recibe `error\n` y se cierra tras leer como máximo 64 bytes.
  - Si `onCommand` rechaza, la respuesta es `error\n` y `sendCommand` rechaza.
  - Un cliente que conecta y no envía nada es desconectado a los 2 s (reloj simulado) y el servidor sigue atendiendo a otros.
  - Con un archivo de socket viejo y sin nadie escuchando, `listen()` lo reemplaza y funciona.
  - Con un `ControlServer` vivo en la misma ruta, un segundo `listen()` lanza `AlreadyRunningError` y el primero sigue funcionando.
  - `sendCommand` a una ruta inexistente rechaza en menos de 2 s.
  - `controlSocketPath({})` lanza; con `XDG_RUNTIME_DIR=/run/user/1000` devuelve `/run/user/1000/phonebox-discord-widget.sock`.
- [ ] **Step 2:** `pnpm test`. Esperado: FALLA.
- [ ] **Step 3:** Implementar `ControlServer` y `sendCommand`. El modo 0600 se fija con `process.umask(0o177)` alrededor de `listen` y se restaura después.
- [ ] **Step 4:** Implementar `main.ts`: carga `loadConfig(configPath(env))`, crea `KeyringSecretStore`, `TokenService`, `VoiceStateTracker(randomBytes(16).toString('hex'))`, `DiscordVoiceSource` (con `createRpc` basado en `findDiscordSocket`), `PhoneBoxPublisher` y `ControlServer`; `SIGTERM` y `SIGINT` detienen todo y borran el socket. Un `ConfigError` o `KeyringUnavailableError` al arrancar escribe una línea en stderr que indica ejecutar `pnpm run setup` y termina con código 1.
- [ ] **Step 5:** Implementar `ctl.ts`: `parseCommand(process.argv[2] ?? '')`; si es `null`, imprime las órdenes válidas y sale con 1; si no, `sendCommand` y sale con 0 o 1.
- [ ] **Step 6:** Implementar `setup.ts`: pide el Client ID (validado con la misma expresión de la Tarea 3) y el Client Secret con entrada oculta (modo crudo de `process.stdin`, sin eco); guarda con `saveConfig` y `store.set('client-secret', ...)`; conecta a Discord; envía `AUTHORIZE {client_id, scopes: ['rpc','rpc.voice.read','rpc.voice.write']}` con espera de 120 s; llama a `tokens.exchangeCode`; imprime `Autorización guardada en el llavero.`. Si falta `secret-tool` o el llavero, imprime `No hay llavero del sistema disponible; no se guardó nada.` y sale con 1. Nunca imprime el secreto, el código ni los tokens.
- [ ] **Step 7:** Implementar `scripts/build.mjs` para los tres puntos de entrada del bridge: `esbuild` con `bundle: true`, `platform: 'node'`, `format: 'esm'`, `target: 'node24'`, salida en `dist/`.
- [ ] **Step 8:** `pnpm test && pnpm typecheck && pnpm build`. Luego `node dist/ctl.js borrar-todo; echo $?` → `1`; `node dist/ctl.js colgar; echo $?` con el bridge detenido → `1` en menos de 2 s.

### Task 7: Verificación del bridge en vivo (con el usuario)

**Files:** ninguno nuevo.

- [ ] **Step 1:** Pedir al usuario que ejecute `pnpm run setup` en su terminal (entrada oculta del secreto) y que pulse **Autorizar** en Discord. Esperado: `Autorización guardada en el llavero.`
- [ ] **Step 2:** Ejecutar `node dist/bridge.js` en segundo plano y consultar `curl -s http://127.0.0.1:8765/api/push`. Esperado: una entrada `discord-voice` con `discord: "conectado"`. Informar solo conteos y booleanos, no nombres.
- [ ] **Step 3:** Con el usuario en un canal: `node dist/ctl.js alternar-silencio` dos veces; comprobar que `yo.silenciado` cambia a `true` y vuelve a `false` en `/api/push`.
- [ ] **Step 4:** Detener el bridge; a los 15 s `/api/push` ya no contiene `discord-voice`.
- [ ] **Step 5: Búsqueda de secretos.** `grep -rlF -f <(secret-tool lookup service phonebox-discord-widget name client-secret) . --exclude-dir=node_modules --exclude=.env` y lo mismo con `name refresh-token`: ninguno devuelve archivos. El valor se pasa como archivo de patrones, nunca como argumento ni por pantalla.

### Task 8: Widget

**Files:**
- Create: `src/widget/services/PhoneBoxClient.ts`, `src/widget/components/StatusBanner.ts`, `MemberList.ts`, `ControlBar.ts`, `VoicePanel.ts`, `src/widget/styles/widget.css`, `src/widget/index.html`, `src/widget/main.ts`, `tests/helpers/fakeDom.ts`
- Modify: `scripts/build.mjs` (agregar el widget)
- Test: `tests/widget/PhoneBoxClient.test.ts`, `tests/widget/VoicePanel.test.ts`, `tests/widget/security.test.ts`

**Interfaces:**
- Consumes: `VoiceState`, `parseVoiceState`, `PUSH_KEY` (Tarea 1).
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

Datos recibidos: `phonebox.on('push', fn)` entrega un mapa `{ [clave]: { data, at, expiresAt } }`. El cliente toma `mapa['discord-voice']?.data`, lo pasa por `parseVoiceState` y trata como `sin-conexion` un dato ausente, inválido o cuyo `at` no cambia durante `staleMs` (se mide con un temporizador propio, sin comparar con el reloj del teléfono).

Textos exactos: `No estás en un canal de voz`, `Discord está cerrado`, `Abrir Discord`, `Sin conexión con la PC`, `Falta autorizar: ejecuta "pnpm run setup" en la PC`, `Silenciar` / `Silenciado`, `Ensordecer` / `Ensordecido`, `Colgar`, `N en voz`. El botón `Colgar` solo aparece dentro de un canal.

- [ ] **Step 1:** Crear `tests/helpers/fakeDom.ts`: un `Document` mínimo (`createElement`, `createTextNode`) con elementos que soportan `textContent`, `append`, `replaceChildren`, `classList`, `dataset`, `setAttribute`, `addEventListener`, `click()` y `querySelector` por clase; definir `innerHTML`, `outerHTML` e `insertAdjacentHTML` como accesos que **lanzan**.
- [ ] **Step 2: Pruebas de `PhoneBoxClient`** con reloj simulado: mapa con `discord-voice` válido → vista `conectado`; `discord: 'cerrado'` → `cerrado`; `sin-autorizar` → `sin-autorizar`; mapa vacío, `data` inválido o valor que no es objeto → `sin-conexion`; el mismo `at` repetido durante 15 s → `sin-conexion`; un `at` nuevo antes de 15 s mantiene `conectado`; `run('discord-mute')` llama a `api.run('discord-mute')`.
- [ ] **Step 3: Pruebas de `VoicePanel`** con `fakeDom`: cada una de las cinco vistas muestra su texto exacto; en un canal con Ana (habla), Bruno (silenciado) y Tú, hay tres filas, la de Ana tiene la clase `habla` y la de Bruno muestra el indicador de silencio; `yo.silenciado: true` pone el texto `Silenciado` y la clase `activo` en ese botón; pulsar cada botón llama a `client.run` con su id; `Colgar` no existe fuera de un canal; `Abrir Discord` existe solo en la vista `cerrado`; un miembro con nombre `<img src=x onerror=alert(1)>` aparece con ese texto literal en `textContent` y el árbol no contiene ningún elemento `img`; renderizar dos veces el mismo estado no duplica filas; nombres `?` y de 32 caracteres se dibujan sin lanzar.
- [ ] **Step 4: `tests/widget/security.test.ts`:** leer todos los archivos de `src/widget/` y afirmar que ninguno contiene `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval(` ni `new Function`; tras `pnpm build`, afirmar que `dist/widget.html` no contiene `</script>` dentro del bloque de script salvo el cierre final, no contiene `http://` ni `https://` (el widget no carga nada de internet) y pesa menos de 64 KB.
- [ ] **Step 5:** `pnpm test`. Esperado: FALLA.
- [ ] **Step 6:** Implementar cliente, componentes (cada clase recibe `doc` y crea su propio elemento raíz) y `main.ts`, que instancia `PhoneBoxClient(window.phonebox)` y `VoicePanel`. CSS con unidades `vh`/`vw` como el widget de ejemplo del agente, fondo transparente, objetivos táctiles de al menos 20 vh de alto, y `text-overflow: ellipsis` en los nombres.
- [ ] **Step 7:** Ampliar `scripts/build.mjs`: empaquetar `src/widget/main.ts` como `iife` minificado para `es2020`, reemplazar `</script` por `<\/script` en el resultado e insertar CSS y JS en los marcadores `/*CSS*/` y `/*JS*/` de `src/widget/index.html`, generando `dist/widget.html`.
- [ ] **Step 8:** `pnpm build && pnpm test && pnpm typecheck`. Esperado: verde.

### Task 9: Instalación en PhoneBox y servicio

**Files:**
- Create: `scripts/install.mjs`, `scripts/lib/phoneboxConfig.mjs`
- Test: `tests/scripts/phoneboxConfig.test.ts`

**Interfaces:**
- Produces:
  ```js
  // scripts/lib/phoneboxConfig.mjs
  export function applyWidget(config, { html, nodePath, ctlPath }) // devuelve una copia modificada; no muta la entrada
  ```

`applyWidget`: agrega o reemplaza por id los accesos directos `discord-mute` (`cmd: nodePath`, `args: ctlPath + ' alternar-silencio'`), `discord-deafen` (`... alternar-ensordecer`), `discord-hangup` (`... colgar`) y `discord-open` (`cmd: 'discord'`); en cada widget de tipo `shortcuts` cuya opción `ids` esté vacía o ausente, fija `ids` a los ids de los accesos directos que **no** empiezan con `discord-`; agrega o reemplaza la página `{ id: 'discord', title: 'Discord', icon: '🎮', enabled: true, widgets: [{ id: 'discord-voice', type: 'html', x: 0, y: 0, w: 12, h: 6, options: { html, transparent: false } }] }`.

- [ ] **Step 1: Pruebas que fallan** con una configuración ficticia de 11 accesos directos y una página con widget `shortcuts` sin `ids`: tras `applyWidget` hay 15 accesos directos; el widget `shortcuts` lista exactamente los 11 originales; existe la página `discord` con el HTML dado; aplicar dos veces da el mismo resultado que una; un widget `shortcuts` que ya tenía `ids` no se modifica; la entrada no se muta; rechaza (lanza) si `ctlPath` o `nodePath` contienen espacios o comillas.
- [ ] **Step 2:** `pnpm test`. Esperado: FALLA.
- [ ] **Step 3:** Implementar `applyWidget` y `scripts/install.mjs`: exige que exista `dist/widget.html`; copia `~/.config/PhoneBox/config.json` a `config.json.pre-discord.bak` (sin sobrescribir una copia previa); `GET /api/settings` guardando `X-Config-Version`; `PUT /api/settings` con ese encabezado; escribe `~/.config/systemd/user/phonebox-discord-widget.service` (`ExecStart=<process.execPath> <ruta absoluta>/dist/bridge.js`, `Restart=on-failure`, `RestartSec=5`, `After=graphical-session.target phonebox.service`, `WantedBy=default.target`) y ejecuta `systemctl --user daemon-reload` y `enable --now`. Con `--uninstall` revierte las tres cosas.
- [ ] **Step 4:** `pnpm test && pnpm build && pnpm install-widget`. Esperado: `systemctl --user is-active phonebox-discord-widget.service` → `active`; `GET /api/settings` contiene la página `discord` y 15 accesos directos; la página "Shortcuts" sigue mostrando 11.

### Task 10: Verificación en el teléfono, amenazas y cierre

**Files:**
- Create: `docs/amenazas.md`, `tests/fixtures/*.json`
- Modify: `README.md`
- Delete: `spike/`

- [ ] **Step 1: Estados con datos ficticios.** Detener el servicio y publicar a mano cada estado con `curl -X POST 'http://127.0.0.1:8765/api/push/discord-voice?ttl=60' -H 'Content-Type: application/json' -d @tests/fixtures/<estado>.json` (crear los cinco archivos en `tests/fixtures/` con Ana, Bruno, Carla, Diego y Tú; uno con 12 miembros y `total: 15`; uno con el nombre `<img src=x onerror=alert(1)>`). Tras cada uno, `adb exec-out screencap -p` y revisar la captura: textos exactos, nada desbordado, nombre con HTML mostrado como texto. Borrar la clave con `DELETE` y comprobar `Sin conexión con la PC` tras 15 s.
- [ ] **Step 2: En vivo con el usuario.** Reactivar el servicio. El usuario confirma, mirando el teléfono dentro de un canal: aparece el canal y quién habla; los tres botones actúan y cambian de estado; al cerrar Discord aparece `Discord está cerrado` y `Abrir Discord` lo abre. No se toman capturas en este paso (nombres reales).
- [ ] **Step 3:** Escribir `docs/amenazas.md` con una fila por amenaza y columnas activo, vector, impacto, probabilidad, mitigación, evidencia (archivo y prueba): XSS por nombres de Discord; orden arbitraria desde el teléfono; otro usuario local escribiendo al socket; secreto o token en disco, registros o repositorio; token de refresco robado; datos personales de terceros en el teléfono o en capturas; dependencia comprometida; suplantación del socket de Discord por otro proceso local; estado viejo mostrado como actual.
- [ ] **Step 4:** Actualizar `README.md`: instalación (`pnpm install`, `pnpm build`, `pnpm run setup`, `pnpm install-widget`), desinstalación, cómo ejecutar pruebas, y enlaces al diseño y a `docs/amenazas.md`. Quitar la sección "Pendiente de decidir".
- [ ] **Step 5:** Borrar `spike/`. Indicar al usuario que puede borrar `.env`, porque el secreto ya está en el llavero.
- [ ] **Step 6: Puerta de cierre.** `pnpm test`, `pnpm typecheck`, `pnpm audit` y la búsqueda de secretos de la Tarea 7 paso 5, todo en verde, con la salida pegada en el informe final.
