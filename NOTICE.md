# Credits and third-party code

ViaLink's own code is free software under the GNU General Public License,
version 2 or (at your option) any later version (`GPL-2.0-or-later`).

The files adapted from Vialite (listed below) are under GPL version 2 only
(`GPL-2.0-only`), because Vialite is licensed under GPL-2.0 without the
"or any later version" option. ViaLink as a whole, including the built app, is
therefore distributed under **GPL version 2**. Each file's
`SPDX-License-Identifier` header gives its own licence. See [LICENSE](LICENSE).

## Vial — vial-gui

ViaLink is a TypeScript port of the protocol and keycode logic of
[vial-gui](https://github.com/vial-kb/vial-gui), the desktop configurator of the
[Vial](https://get.vial.today/) project (GPL-2.0-or-later). vial-gui's Python
source is treated as the specification; ported files say which upstream file
they follow in their header comment.

- `src/core/protocol/constants.ts`, `src/core/protocol/commands.ts`,
  `src/core/keyboard.ts`: `protocol/constants.py`, `protocol/keyboard_comm.py`,
  `protocol/dynamic.py`, `util.py`
- `src/core/keycodes/`: `keycodes/keycodes.py`, `keycodes/keycodes_v5.py`,
  `keycodes/keycodes_v6.py`, `any_keycode.py`. The tables in
  `src/core/keycodes/data/keycodes.json` are extracted from vial-gui by
  `scripts/dump_keycodes.py`; the source commit is recorded in that file.
- `src/core/definition/`: `kle_serial.py`, `editor/layout_editor.py`,
  `widgets/keyboard_widget.py`
- `src/core/vil.ts`: the `.vil` format of `save_layout()` / `restore_layout()`
- `src/core/sim/simulatedKeyboard.ts`: modelled on `protocol/dummy_keyboard.py`
  and `test/test_keyboard.py`

The layer-names extension follows the `dynamic-layer-names` branch of
[Theis194/vial-gui](https://github.com/Theis194/vial-gui).

## Vialite

[Vialite](https://github.com/tcyeee/vialite) by tcyeee (GPL-2.0) is a web
configurator for Vial keyboards that also ports vial-gui to TypeScript. ViaLink
adapts these parts of it; each file is `GPL-2.0-only` and notes that it was
modified for ViaLink (November 2026):

- `src/core/transport/webhid.ts`: reply-sequence tracking from `src/protocol/transport.ts`
- `src/core/definition/kle.ts`: from `src/protocol/kleSerial.ts`
- `src/core/definition/layoutOptions.ts`, `src/core/definition/definition.ts`
  (XZ reader): from `src/protocol/keyboard.ts`
- `src/core/definition/geometry.ts`: from `src/components/keymap/layout/layoutGeometry.ts`
- `src/core/vil.ts`: BigInt uid handling, macro omission and skipped-feature
  detection (`detectSkippedFeatures`) from `src/protocol/vilFile.ts`

## Fixtures

- `fixtures/definitions/klor.vial.json`: from
  [Theis194/klor-qmk-config](https://github.com/Theis194/klor-qmk-config)
  (`keymaps/vial/vial.json`)
- `fixtures/definitions/keychron_q10_iso_encoder.vial.json`: from
  [vial-kb/vial-qmk](https://github.com/vial-kb/vial-qmk)
  (`keyboards/keychron/q10/iso_encoder/keymaps/vial/vial.json`, GPL-2.0-or-later)
