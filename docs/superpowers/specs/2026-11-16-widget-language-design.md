# Design: widget interface language (English default, Spanish option)

**Date:** 2026-11-16
**Status:** approved by the user on 2026-11-16
**Size:** small change

## Why

The repository is public and its documentation is now in English. Visitors from GitHub should get the panel in
English, while the owner keeps using it in Spanish.

## Goals

- Every text visible on the phone exists in English and in Spanish.
- English is the default; Spanish is chosen at install time with `pnpm run install-widget --lang es`.

## Non-goals

- Terminal messages (`pnpm run setup`, bridge errors, `ctl`, installer output) stay as they are.
- Internal identifiers, state field names, command words and code comments stay in Spanish.
- Switching language from the phone, or following the phone's system language.
- Languages other than English and Spanish.

## Approaches

| Approach | Trade-off | Decision |
|---|---|---|
| **1. Chosen at install time** (`--lang en\|es`) | Simple, decided once, independent of the phone; changing it means reinstalling | **Chosen by the user** |
| 2. Follow the phone's language | Automatic, but cannot force Spanish on an English phone | Discarded |
| 3. Toggle button on the panel | Switch any time, but takes space and the sandboxed widget cannot remember the choice across reloads | Discarded |

## Design

- **Strings.** One table per language in the widget (`en`, `es`) with the 12 visible texts, including
  `{n} in voice` / `{n} en voz`. Components read from the active table instead of literals.
- **Widget.** `dist/widget.html` carries both tables. `install.mjs` writes the chosen language into the HTML
  (for example `data-lang="es"` on the root element) before sending it to PhoneBox. A missing or unknown value
  falls back to English.
- **Bridge.** The user's own row is labelled `You` or `Tú`. The bridge produces that name, so it needs the language
  too: the systemd unit runs `dist/bridge.js --lang <code>`. Unknown or missing value: English.
- **Installer.** `--lang` accepts only `en` and `es`; anything else exits with an error. *(My call)* Without
  `--lang`, a reinstall keeps the language of the current installation (read from the existing unit), so running
  `install-widget` after a `pnpm build` does not silently switch the owner's phone to English; a first install uses
  English.
- **Tests.** Each view's exact text is checked in both languages; the security test still passes on the
  installed HTML; `applyWidget` and the language option are covered; unknown language falls back to English.
- **Docs.** *(My call)* README (both versions) documents `--lang es`; the English README shows English screenshots,
  retaken with the fictional data in `tests/fixtures/`, and the Spanish README keeps the current Spanish ones.
- **Owner's install.** After the change, reinstall with `--lang es` so the phone stays in Spanish.

## Left to the builder

- Exact names of the string table and helper, and where the language attribute lives in the HTML.
- How to retake the English screenshots (on the phone with adb, as before, or in Brave with the agent's prelude).
