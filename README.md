# ViaLink

A browser-based configurator for [Vial](https://get.vial.today/) keyboards. It talks to the
keyboard over WebHID, so it runs in Chromium-based browsers (Chrome, Edge, Opera) with nothing
to install. Try it at https://tsksmiley.github.io/vialink/ (the project was called vial-ts
before).

> **Experimental.** ViaLink is vibe coded: most of it was written by an AI coding assistant, and it
> has only been tested on one real keyboard, the [KLOR](https://github.com/GEIGEIGEIST/KLOR) by
> GEIGEIGEIST (plus a simulated keyboard in the test suite). It can write wrong
> settings to your keyboard. Save a backup of your layout (in desktop Vial, or with "Save .vil")
> before changing anything, and report problems as issues.

ViaLink is a TypeScript port of [vial-gui](https://github.com/vial-kb/vial-gui)'s protocol and
keycode logic with a new React UI, and borrows code from [Vialite](https://github.com/tcyeee/vialite).
See [NOTICE.md](NOTICE.md) for what comes from where.

## What it does

- Connects to a Vial keyboard (VIA protocol 9, Vial protocol up to 6), with unlock, lock and a warning
  for vial-qmk example UIDs. A demo keyboard (a simulated KLOR) lets you try everything without
  hardware.
- **Keymap:** a layer rail (name, keys set, how each layer is reached; Alt to peek) and a key
  inspector beside the keyboard: describe the key in words, build layer keys ("When held / When
  tapped"), add modifiers, pick tap dances and macros, or search any key by name, shortcut (`ctrl+c`)
  or expression (`LT(1, KC_SPC)`). Shift-click to change several keys at once.
- **Undo and redo** for every change written to the keyboard (Ctrl+Z / Ctrl+Shift+Z, the top bar,
  and a toast after each change). Loading a layout is one step.
- **Layers:** copy, paste (with a preview and three modes), duplicate, swap (names too) and clear.
  Share a layer as one line of text (`vialink:layer:1:…`) that a friend can paste onto the same kind
  of keyboard, even with other layout options; it fits in a Discord message.
- **Tap dance, combos, macros** as lists with a detail view: combo keys are picked on the
  keyboard, macro steps read as words with step-by-step undo until Save. Key overrides, alt repeat
  keys and QMK settings are editable too.
- **Layer names** on boards running the
  [Theis194 layer-names firmware](https://github.com/Theis194/vial-qmk).
- Save and load `.vil` files compatible with desktop Vial, or keep layouts in the browser.
- A device panel with a readable HID log (filters, export as a replayable trace) and a matrix tester.
- Light and dark theme (follows the system, or pick one in the ⋯ menu); built with Cloudflare's
  [Kumo](https://github.com/cloudflare/kumo) components.

Not yet: lighting and the firmware flasher.

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
  - `history.ts`: undo and redo of every write.
  - `layers.ts`, `layer-share.ts`, `layerInfo.ts`: layer operations, the share text format and
    facts for the layer rail.
  - `extensions/`: optional features (macros, tap dance, combos, …) probed at connect time.
  - `vil.ts`: `.vil` save and load.
  - `sim/`: a simulated keyboard that answers commands like the firmware, for tests and the demo.
- `src/app/`: the React UI. `shell/` is the top bar, sidebar, undo and device panel; `keymap/` the
  keymap view; `extensions/` the feature views; `ui/` wraps the Kumo components ViaLink uses;
  `theme.css` holds the colour tokens.
- `fixtures/`: keyboard definitions and `.vil` files used by tests.
- `scripts/`: `dump_keycodes.py` and `dump_keymaps.py` regenerate the keycode tables and the
  keyboard layouts (Danish, German, …) in `src/core/keycodes/data/` from a vial-gui checkout.
  `pnpm vial:dump <path>` runs both, to catch up with upstream Vial in one step.
  `compress_fixtures.py` XZ-compresses the fixture definitions.

## Licence

ViaLink's own code is GPL-2.0-or-later, as vial-gui. A few files adapted from Vialite are
GPL-2.0-only, so ViaLink as a whole is distributed under GPL version 2. See [LICENSE](LICENSE)
and [NOTICE.md](NOTICE.md) for which files those are.
