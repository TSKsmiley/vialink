# ViaLink

A browser-based configurator for [Vial](https://get.vial.today/) keyboards. It talks to the
keyboard over WebHID, so it runs in Chromium-based browsers (Chrome, Edge, Opera) with nothing
to install. Try it at https://tsksmiley.github.io/vialink/ (the project was called vial-ts
before).

> **Experimental.** ViaLink is vibe coded: most of it was written by an AI coding assistant, with
> tests against a simulated keyboard but very little testing on real hardware. It can write wrong
> settings to your keyboard. Save a backup of your layout (in desktop Vial, or with "Save .vil")
> before changing anything, and report problems as issues.

ViaLink is a TypeScript port of [vial-gui](https://github.com/vial-kb/vial-gui)'s protocol and
keycode logic with a new React UI, and borrows code from [Vialite](https://github.com/tcyeee/vialite).
See [NOTICE.md](NOTICE.md) for what comes from where.

## Status

Milestone 1, a usable keymap editor:

- Connect to a Vial keyboard (VIA protocol 9, Vial protocol up to 6) and show its VIA version,
  Vial version and UID, with a warning for vial-qmk example UIDs.
- Edit keys and encoders on every layer with a tabbed keycode picker, search, and an "Any" field
  for typed expressions such as `LT(1, KC_SPC)` or `LCTL(KC_C)`.
- Layout options, applied to the keyboard view as you change them.
- Save and load `.vil` files compatible with desktop Vial (keymap, encoders and layout options;
  macros, tap dance, combos, key overrides and QMK settings are not read or written yet).
- Layer names on boards running the
  [Theis194 layer-names firmware](https://github.com/Theis194/vial-gui/tree/dynamic-layer-names)
  are shown on the layer tabs (editing them comes later).
- A HID log that can export the session as a replayable trace.
- A demo keyboard (a simulated KLOR) for trying the UI without hardware.

Not yet: unlocking (so `QK_BOOT` can only be assigned to a board already unlocked in desktop
Vial), the matrix tester, macros and other dynamic features, lighting, and the firmware flasher.

## Development

Requires Node 24+ and pnpm.

```sh
pnpm install
pnpm dev            # dev server at http://localhost:5173
pnpm test           # Vitest
pnpm check          # TypeScript
pnpm lint           # ESLint
pnpm format         # Prettier
pnpm build          # production build in dist/
```

On Linux the browser needs read/write access to the keyboard's hidraw device; Vial's
[udev rule](https://get.vial.today/manual/linux-udev.html) covers this.

### Layout

- `src/core/`: framework-free protocol code. It never imports React or the DOM and runs under
  Node in tests.
  - `transport/`: the `Transport` interface, the WebHID and replay transports, and the
    single-flight `RequestQueue` every command goes through.
  - `protocol/`: command constants and pure encode/decode functions per command.
  - `definition/`: fetching and decompressing `vial.json`, the KLE parser, layout options and
    geometry.
  - `keycodes/`: the per-keyboard `KeycodeTable` and the keycode expression parser.
  - `keyboard.ts`: loads a keyboard and writes changes.
  - `vil.ts`: `.vil` save and load.
  - `sim/`: a simulated keyboard that answers commands like the firmware, for tests and the demo.
- `src/app/`: the React UI.
- `fixtures/`: keyboard definitions and `.vil` files used by tests.
- `scripts/`: `dump_keycodes.py` regenerates `src/core/keycodes/data/keycodes.json` from a vial-gui
  checkout (`pnpm keycodes:dump <path>`); `compress_fixtures.py` XZ-compresses the fixture
  definitions.

## Licence

ViaLink's own code is GPL-2.0-or-later, as vial-gui. A few files adapted from Vialite are
GPL-2.0-only, so ViaLink as a whole is distributed under GPL version 2. See [LICENSE](LICENSE)
and [NOTICE.md](NOTICE.md) for which files those are.
