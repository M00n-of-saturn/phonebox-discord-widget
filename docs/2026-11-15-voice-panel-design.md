# Design: Discord voice panel for PhoneBox

**Date:** 2026-11-15
**Status:** approved by the user on 2026-11-15

## Purpose

See from the desk phone whether I am in a Discord voice channel, who is there and who is talking,
and mute, deafen or hang up without switching windows on the PC.

## Goals

- Show the current voice channel, its members and who is talking, with less than one second of delay.
- Three buttons that reflect the real state: mute, deafen and hang up.
- Keep working on its own after restarting the PC, closing Discord or unplugging the phone.
- Meet the "Security" section of the `README.md`.

## Out of scope

- Notifications, mentions and messages ("option C"; the structure is ready to add it later).
- Vesktop or other unofficial clients.
- Avatars, per-user volume, switching channel or server.

## What would make the project fail even if it works

- The personal account token, the application secret or an access token ending up in the
  repository, in a log, on the phone or in the PhoneBox configuration.
- A malicious user or channel name being able to run code in the widget.
- The phone being able to ask the PC for anything other than the three intended actions.

## Verified constraints

| Fact | How it was verified |
|---|---|
| A custom application gets the `rpc`, `rpc.voice.read` and `rpc.voice.write` scopes and can read and write voice settings | `spike/discord-rpc-probe.mjs`, steps 1 to 7 OK (2026-11-15) |
| "Who is talking" and member-change events arrive after subscribing with the channel id | Same probe, steps 8 and 9 OK inside a channel with 7 members: 29 speaking events and 7 changes in 20 s (2026-11-15) |
| The agent accepts free-form JSON on `POST /api/push/<key>` and delivers it intact, with a `ttl` expiry | Test request to the local agent |
| The "Custom HTML" widget runs in an `iframe` with `sandbox="allow-scripts"`; it receives data through `phonebox.on('push', fn)` and can only request `phonebox.run(id)` for shortcut ids that already exist in the configuration | Reading `panel/widgets/pc.js` from agent 0.9.10 |
| The widget is delivered as a single block of HTML | The agent's widget catalog |

## Approaches considered

| Approach | What it offers | Why or why not |
|---|---|---|
| A. Buttons with keyboard shortcuts only | Open Discord, mute and deafen blindly | Discarded: shows no state and duplicates the bundled "Discord controls" widget |
| **B. Voice panel over the official local connection** | Channel, members, who is talking and buttons with real state | **Chosen by the user.** Uses a custom application, no account token |
| C. B plus notifications | Also mentions and direct messages | Postponed: needs one more scope and routes message content through the agent |

## How it works

```
Discord (PC) ──local connection──> bridge (PC) ──POST /api/push/discord-voice──> PhoneBox agent ──USB──> widget (phone)
     ^                                ^                                                                       │
     └── SET_VOICE_SETTINGS ──────────┘<── local socket ── ctl <── shortcut <── phonebox.run(id) ─────────────┘
```

### Parts

1. **bridge** (PC, systemd user service). Keeps the connection to Discord, translates its events into its
   own state and publishes it to the agent. Listens for commands on a local socket.
2. **ctl** (PC, one-shot program). Run by the PhoneBox shortcuts; sends one command to the bridge's
   socket and exits.
3. **widget** (phone). Draws the state it receives and requests actions by id. Holds no logic and no secrets.
4. **shared**. The state model and its validation, used by both bridge and widget.

### State sent to the phone

Key `discord-voice`, with a 15-second `ttl` so that a dead bridge does not leave stale data on screen.
Field names and values are in Spanish because that is what the code uses.

```json
{
  "v": 1,
  "discord": "conectado | cerrado | sin-autorizar",
  "canal": { "nombre": "General", "total": 5 },
  "yo": { "silenciado": false, "ensordecido": false },
  "miembros": [
    { "clave": "a1b2c3d4", "nombre": "Ana", "habla": true, "silenciado": false, "ensordecido": false }
  ]
}
```

Glossary: `conectado` connected, `cerrado` closed, `sin-autorizar` not authorized, `canal` channel,
`nombre` name, `yo` me, `silenciado` muted, `ensordecido` deafened, `miembros` members, `clave` key,
`habla` speaking.

- `canal` is `null` outside a voice channel.
- `clave` is an opaque per-session identifier (a hash of the Discord id with a random salt that changes
  on every start); the real id never leaves the PC.
- At most 12 members and names of up to 32 characters, with no control characters.
- It is published when something changes, at most 5 times per second, and every 5 seconds as a heartbeat.

### Commands from the phone to the PC

Three new shortcuts in PhoneBox: `discord-mute`, `discord-deafen`, `discord-hangup`, plus
`discord-open` to launch Discord when it is closed. Each one runs `ctl` with a fixed word.
The bridge accepts only `alternar-silencio` (toggle mute), `alternar-ensordecer` (toggle deafen) and
`colgar` (hang up); any other input is rejected.

The socket lives at `$XDG_RUNTIME_DIR/phonebox-discord-widget.sock` with 0600 permissions: only the user
can write to it, and no network port is opened.

The existing "Shortcuts" page shows every shortcut; it gets an explicit list of the 11 existing ones
so the four new shortcuts do not appear there.

### What it looks like

A new "Discord" page with one full-screen widget in landscape (the interface text is in Spanish):

```
┌──────────────────────────────────────────────────────────┐
│  🔊 General                                   5 en voz   │
│                                                          │
│  ● Ana          ○ Bruno 🔇     ○ Carla                   │
│  ○ Diego 🎧     ○ Tú                                     │
│                                                          │
│  [  🎙 Silenciar  ]   [  🎧 Ensordecer  ]   [  ☎ Colgar ]│
└──────────────────────────────────────────────────────────┘
```

- A filled, highlighted dot marks whoever is talking.
- The buttons change color and label according to the real state ("Silenciado" muted, "Ensordecido" deafened).
- Outside a channel: "No estás en un canal de voz" (You are not in a voice channel); mute and deafen stay active.
- Discord closed: "Discord está cerrado" (Discord is closed) and an "Abrir Discord" (Open Discord) button.
- No data from the bridge (the `ttl` expired): "Sin conexión con la PC" (No connection to the PC).
- No avatars: initials are used instead, because the sandbox must not depend on the internet and this way
  no image URLs are sent to the phone.

### Secrets and authorization

- A setup command asks once for the Client ID and the Client Secret (hidden input) and stores the
  secret in the system keyring (KWallet, through `secret-tool`). The Client ID, which is not secret, goes in
  `~/.config/phonebox-discord-widget/config.json`.
- The first time, Discord shows the "Authorize" window. The resulting refresh token is stored in the
  keyring; the access token lives only in memory.
- If the keyring is not available, setup stops and says so; it never falls back to a plain-text file
  unless the user decides to.
- The `.env` file is only for development and for the `spike/` probe.

### Failures

| Situation | Behavior |
|---|---|
| Discord closed | The bridge retries every 5 s and publishes `discord: "cerrado"` |
| Refresh token revoked or expired | Publishes `sin-autorizar`; the widget asks to run setup again |
| PhoneBox agent down | The bridge stays connected to Discord and keeps retrying to publish |
| Bridge down | systemd restarts it; the state expires after 15 s and the widget shows "Sin conexión con la PC" |
| Unexpected data from Discord | The event is dropped and its type is logged, without its content |

## Technical decisions (mine, open to change)

- **TypeScript** on Node 24. Development dependencies only: `typescript` and `esbuild`. None at runtime:
  the Discord protocol is implemented with Node modules, as in the probe.
- **Build:** `esbuild` produces `dist/bridge.js`, `dist/ctl.js` and `dist/widget.html` (HTML, CSS and JS in one block).
- **Installation:** a script writes the systemd service and adds the shortcuts and the page to
  PhoneBox through `PUT /api/settings`, after backing up the configuration.
- **Tests** with `node:test`.

## Required tests

- Discord frames: split into several chunks, invalid length, invalid JSON.
- Model validation: missing fields, wrong types, more than 12 members, long names or names with
  control characters.
- Security: a name like `<img src=x onerror=...>` is shown as text; the socket rejects commands
  outside the list; a secret scan of the repository and `dist/` finds nothing; `pnpm audit`
  reports no high or critical issues.
- Manual, with the phone: the five screen states and the three buttons.
- `docs/threat-model.md` with the threat matrix (asset, vector, impact, likelihood, mitigation, evidence).

## Left to the implementer

- Exact class and file names within the `src/` structure already created.
- Colors, sizes and the animation of the "speaking" indicator.
- How to fake the DOM in the XSS test without adding heavy dependencies.
