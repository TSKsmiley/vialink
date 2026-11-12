// SPDX-License-Identifier: GPL-2.0-or-later
// Connect flow: pick a raw-HID device, open it, wrap it in a request queue and
// load the keyboard. The demo connection runs the same flow against a
// simulated KLOR, so the UI can be tried without hardware.

import klorDefinitionUrl from "../../fixtures/definitions/klor.vial.json.xz?url";
import type { KeyboardExtension } from "../core/extensions/types.ts";
import { Keyboard, type LoadProgress } from "../core/keyboard.ts";
import {
  CMD_VIA_VIAL_PREFIX,
  CMD_VIAL_UNLOCK_POLL,
  CMD_VIAL_UNLOCK_START,
  RAW_HID_USAGE,
  RAW_HID_USAGE_PAGE,
} from "../core/protocol/constants.ts";
import { installAltRepeatKey } from "../core/sim/alt-repeat-key.ts";
import { installCombos } from "../core/sim/combos.ts";
import { installKeyOverrides } from "../core/sim/key-overrides.ts";
import { installMacroSimulator } from "../core/sim/macros.ts";
import { installQmkSettings } from "../core/sim/qmk-settings.ts";
import { SimulatedKeyboard } from "../core/sim/simulatedKeyboard.ts";
import { installTapDanceSimulator } from "../core/sim/tap-dance.ts";
import { RequestQueue } from "../core/transport/queue.ts";
import type { Transport } from "../core/transport/types.ts";
import { WebHidTransport } from "../core/transport/webhid.ts";

export function webHidSupported(): boolean {
  return typeof navigator !== "undefined" && "hid" in navigator;
}

export class NoDeviceSelectedError extends Error {
  constructor() {
    super("No device was selected.");
    this.name = "NoDeviceSelectedError";
  }
}

/** Shows the browser's device chooser, filtered to the raw-HID interface VIA and Vial share. */
export async function requestDevice(): Promise<HIDDevice> {
  const devices = await navigator.hid.requestDevice({
    filters: [{ usagePage: RAW_HID_USAGE_PAGE, usage: RAW_HID_USAGE }],
  });
  const device = devices.find((d) =>
    d.collections.some((c) => c.usagePage === RAW_HID_USAGE_PAGE && c.usage === RAW_HID_USAGE),
  );
  if (!device) throw new NoDeviceSelectedError();
  return device;
}

export interface Connection {
  keyboard: Keyboard;
  queue: RequestQueue;
  demo: boolean;
}

/**
 * Opens the transport and loads the keyboard. The queue is handed to
 * `onQueue` before loading starts, so the debug panel logs the load itself.
 */
export async function connect(
  transport: Transport,
  options: {
    demo?: boolean;
    onQueue?: (q: RequestQueue) => void;
    onProgress?: (p: LoadProgress) => void;
    extensions?: readonly KeyboardExtension<unknown>[];
  } = {},
): Promise<Connection> {
  await transport.open();
  const queue = new RequestQueue(transport);
  options.onQueue?.(queue);
  try {
    const keyboard = await Keyboard.load(queue, {
      onProgress: options.onProgress,
      extensions: options.extensions,
    });
    return { keyboard, queue, demo: options.demo ?? false };
  } catch (err) {
    await queue.close().catch(() => undefined);
    throw err;
  }
}

export function webHidTransport(device: HIDDevice): Transport {
  return new WebHidTransport(device);
}

/** A simulated KLOR running the layer-names firmware, with a small starter keymap. */
export async function demoTransport(): Promise<Transport> {
  const response = await fetch(klorDefinitionUrl);
  const compressed = new Uint8Array(await response.arrayBuffer());
  // KLOR matrix: rows 0-3 left half, 4-7 right half; 6 columns each.
  const letters = [
    [0x00, 0x14, 0x1a, 0x08, 0x15, 0x17],
    [0x00, 0x04, 0x16, 0x07, 0x09, 0x0a],
    [0x00, 0x1d, 0x1b, 0x06, 0x19, 0x05],
    [0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
    [0x13, 0x12, 0x0c, 0x18, 0x1c, 0x00],
    [0x33, 0x0f, 0x0e, 0x0d, 0x0b, 0x00],
    [0x38, 0x37, 0x36, 0x10, 0x11, 0x00],
    [0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
  ];
  const sim = new SimulatedKeyboard({
    info: { productName: "Klor (demo)", vendorId: 0xfc32, productId: 0x0287 },
    compressedDefinition: compressed,
    rows: 8,
    cols: 6,
    layers: 4,
    keymap: [letters, letters.map((row) => row.map(() => 0x01))],
    macroCount: 16,
    macroBufferSize: 1024,
    dynamic: { tapDance: 4, combo: 8, keyOverride: 4, altRepeatKey: 4, featureFlags: 0b11 },
    layerNames: ["Base", "Lower", "Raise", "Adjust"],
    unlockKeys: [
      { row: 0, col: 3 },
      { row: 4, col: 3 },
    ],
  });
  // The Vial features each extension edits, with a little starter content.
  installMacroSimulator(sim, {
    count: 16,
    memory: 1024,
    contents: new TextEncoder().encode("Hello from ViaLink\0"),
  });
  installTapDanceSimulator(sim, { count: 4, entries: [{ onTap: 0x29, onHold: 0x39 }] }); // Esc / Caps Lock
  installCombos(sim, { count: 8, entries: [[0x0d, 0x0e, 0, 0, 0x29]] }); // J + K = Esc
  installKeyOverrides(sim, { count: 4 });
  installAltRepeatKey(sim, { count: 4 });
  installQmkSettings(sim);

  // Nobody can hold the keys of a simulated board: "hold" them once an unlock
  // starts, and let them go again when it finishes.
  sim.handlers.push((msg, board) => {
    if (msg[0] === CMD_VIA_VIAL_PREFIX && msg[1] === CMD_VIAL_UNLOCK_START) board.holdUnlockKeys();
    if (msg[0] === CMD_VIA_VIAL_PREFIX && msg[1] === CMD_VIAL_UNLOCK_POLL && board.unlocked) {
      board.holdUnlockKeys(false);
    }
    return false;
  });
  return sim;
}
