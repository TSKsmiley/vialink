// SPDX-License-Identifier: GPL-2.0-or-later
// The UI kit an extension's view gets (PanelProps.ui): ViaLink's components
// and helpers already connected to the keyboard, so a view never needs the
// Keyboard itself (user, 13 Nov). Components that need only the keycode table
// (KeycodePicker, KeySearch, keyText) take ctx.board.keycodes directly.

import type { ComponentProps } from "react";
import type { Keyboard } from "../../core/keyboard.ts";
import { KeyboardView } from "../components/KeyboardView.tsx";
import type { PickerInfo } from "../components/KeycodePicker.tsx";
import { pickerInfoOf } from "../hooks.ts";
import { placementsOf } from "./featureLayout.tsx";

export interface PanelKit {
  /** The keyboard drawing (layout, keycaps, selection), for picking keys. */
  KeyboardView(props: Omit<ComponentProps<typeof KeyboardView>, "keyboard">): React.JSX.Element;
  /** Layer names, used layers and tap dance summaries for the keycode picker. */
  pickerInfo(): PickerInfo;
  /** Where `code` sits on the keymap ("L0 · row 2, col 3"), for "used on" lines. */
  placementsOf(code: number): string[];
}

const kits = new WeakMap<Keyboard, PanelKit>();

/** One kit per keyboard. */
export function kitFor(keyboard: Keyboard): PanelKit {
  let kit = kits.get(keyboard);
  if (!kit) {
    kit = {
      KeyboardView: (props) => <KeyboardView keyboard={keyboard} {...props} />,
      pickerInfo: () => pickerInfoOf(keyboard),
      placementsOf: (code) => placementsOf(keyboard, code),
    };
    kits.set(keyboard, kit);
  }
  return kit;
}
