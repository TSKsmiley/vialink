// SPDX-License-Identifier: GPL-2.0-or-later
// Connect flow: pick a raw-HID device, open it, wrap it in a request queue and
// load the keyboard. The demo connection runs the same flow against a
// simulated KLOR, so the UI can be tried without hardware.

import klorDefinitionUrl from "../../fixtures/definitions/klor.vial.json.xz?url";
import type { BrowserStorage } from "../core/extensions/state.ts";
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
import { installLighting, simVialRgb } from "../core/sim/lighting.ts";
import { SimulatedKeyboard } from "../core/sim/simulatedKeyboard.ts";
import { installTapDanceSimulator } from "../core/sim/tap-dance.ts";
import { RequestQueue } from "../core/transport/queue.ts";
import { NativeHidTransport, type NativeKeyboard } from "../core/transport/native.ts";
import type { Transport } from "../core/transport/types.ts";
import { WebHidTransport } from "../core/transport/webhid.ts";
import { tauriHid } from "./desktop.ts";
import { DEMO_LAYER_NAMES, demoKeymap } from "./demoKeymap.ts";

/** `?nohid` in the address pretends the browser has no WebHID: the page Firefox and Safari get. */
const pretendNoHid = typeof location !== "undefined" && new URLSearchParams(location.search).has("nohid");

export function webHidSupported(): boolean {
  return !pretendNoHid && typeof navigator !== "undefined" && "hid" in navigator;
}

export class NoDeviceSelectedError extends Error {
  constructor() {
    super("No device was selected.");
    this.name = "NoDeviceSelectedError";
  }
}

/** The raw-HID interface VIA and Vial share (a keyboard also lists its keyboard and other interfaces). */
export function isRawHid(device: HIDDevice): boolean {
  return device.collections.some((c) => c.usagePage === RAW_HID_USAGE_PAGE && c.usage === RAW_HID_USAGE);
}

/** Shows the browser's device chooser, filtered to the raw-HID interface VIA and Vial share. */
export async function requestDevice(): Promise<HIDDevice> {
  const devices = await navigator.hid.requestDevice({
    filters: [{ usagePage: RAW_HID_USAGE_PAGE, usage: RAW_HID_USAGE }],
  });
  const device = devices.find(isRawHid);
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
    recency?: (id: string) => number;
    browserStorage?: BrowserStorage;
  } = {},
): Promise<Connection> {
  await transport.open();
  const queue = new RequestQueue(transport);
  options.onQueue?.(queue);
  try {
    const keyboard = await Keyboard.load(queue, {
      onProgress: options.onProgress,
      extensions: options.extensions,
      recency: options.recency,
      browserStorage: options.browserStorage,
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

/** What the connect screen can connect to. */
export type ConnectTarget =
  | { kind: "demo" }
  /** The browser's device chooser. */
  | { kind: "webhid" }
  /** A keyboard the browser already lets this site open (no chooser). */
  | { kind: "device"; device: HIDDevice }
  /** A keyboard the desktop app found (no WebHID there). */
  | { kind: "native"; device: NativeKeyboard };

/** Keyboards with the VIA/Vial raw-HID interface, in the desktop app. */
export function listNativeKeyboards(): Promise<NativeKeyboard[]> {
  return tauriHid.list();
}

export function nativeTransport(device: NativeKeyboard): Transport {
  return new NativeHidTransport(tauriHid, device);
}

/** A simulated KLOR running the layer-names firmware, with a starter keymap (demoKeymap.ts). */
export async function demoTransport(): Promise<Transport> {
  const response = await fetch(klorDefinitionUrl);
  const compressed = new Uint8Array(await response.arrayBuffer());
  const { keymap, encoders } = demoKeymap();
  const sim = new SimulatedKeyboard({
    info: { productName: "Klor (demo)", vendorId: 0xfc32, productId: 0x0287 },
    compressedDefinition: compressed,
    rows: 8,
    cols: 6,
    layers: 4,
    keymap,
    encoderCount: 2,
    encoders,
    macroCount: 16,
    macroBufferSize: 1024,
    dynamic: { tapDance: 4, combo: 8, keyOverride: 4, altRepeatKey: 4, featureFlags: 0b11 },
    layerNames: DEMO_LAYER_NAMES,
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
  installLighting(sim, { vialrgb: simVialRgb() }); // the KLOR definition says "vialrgb"

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
