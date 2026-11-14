// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { Keyboard } from "../keyboard.ts";
import * as C from "../protocol/constants.ts";
import {
  lightingSave,
  qmkLightingSet,
  qmkRgblightSetColor,
  QMK_BACKLIGHT_EFFECT,
  QMK_RGBLIGHT_EFFECT,
  vialRgbGetMode,
  vialRgbGetSupported,
  vialRgbSetMode,
} from "../protocol/lighting.ts";
import { installLighting, simVialRgb, type SimLighting } from "../sim/lighting.ts";
import { SimulatedKeyboard } from "../sim/simulatedKeyboard.ts";
import { RequestQueue } from "../transport/queue.ts";
import { padTo, toHex } from "../util/bytes.ts";
import { lightingExtension, LightingError } from "./lighting.ts";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../../../fixtures/definitions/${name}`, import.meta.url)));
const KLOR = fixture("klor.vial.json.xz"); // "lighting": "vialrgb"
const QMK = fixture("test_2x2_backlight_rgblight.vial.json.xz"); // "qmk_backlight_rgblight"
const NONE = fixture("test_2x2_encoder.vial.json.xz"); // "none"

async function board(definition: Uint8Array, lighting: Omit<SimLighting, "saves" | "saved"> | null) {
  const klor = definition === KLOR;
  const sim = new SimulatedKeyboard({
    compressedDefinition: definition,
    rows: klor ? 8 : 2,
    cols: klor ? 6 : 2,
    layers: 2,
    encoderCount: klor ? 0 : 1,
  });
  const fw = lighting ? installLighting(sim, lighting) : null;
  await sim.open();
  const notices: string[] = [];
  const kb = await Keyboard.load(new RequestQueue(sim, { retryDelayMs: 0 }), {
    extensions: [lightingExtension as never],
  });
  kb.notifyHandler = (_kind, message) => notices.push(message);
  return { sim, kb, fw, lighting: kb.extension(lightingExtension), notices };
}

const lightingRequests = (sim: SimulatedKeyboard) =>
  sim.requests.filter((r) => r[0] === C.CMD_VIA_LIGHTING_SET_VALUE || r[0] === C.CMD_VIA_LIGHTING_SAVE);

describe("lighting wire format", () => {
  it("packs VialRGB set mode as vial-gui's struct 'BBHBBBB'", () => {
    expect(toHex(vialRgbSetMode.encode({ mode: 0x0102, speed: 3, hue: 4, sat: 5, val: 6 }))).toBe(
      "0741020103040506",
    );
  });

  it("asks for supported effects above an id, little-endian", () => {
    expect(toHex(vialRgbGetSupported.encode(0x1234))).toBe("08423412");
    const reply = padTo(new Uint8Array([0x08, 0x42, 1, 0, 2, 0, 0x2c, 0, 0xff, 0xff]), 32);
    reply.fill(0xff, 10);
    expect(vialRgbGetSupported.decode(reply)).toEqual([1, 2, 44]);
  });

  it("reads mode, speed and HSV from GET_MODE", () => {
    expect(vialRgbGetMode.decode(new Uint8Array([8, 0x41, 0x18, 0, 9, 10, 11, 12]))).toEqual({
      mode: 24,
      speed: 9,
      hue: 10,
      sat: 11,
      val: 12,
    });
  });

  it("encodes the QMK values and save", () => {
    expect(toHex(qmkLightingSet.encode(QMK_RGBLIGHT_EFFECT, 7))).toBe("078107");
    expect(toHex(qmkRgblightSetColor.encode(10, 20))).toBe("0783" + "0a14");
    expect(toHex(lightingSave.encode())).toBe("09");
    expect(() => qmkLightingSet.encode(QMK_BACKLIGHT_EFFECT, 256)).toThrow(RangeError);
  });
});

describe("lighting probe", () => {
  it("is off when the definition says no lighting", async () => {
    const { lighting } = await board(NONE, null);
    expect(lighting).toBeNull();
  });

  it("is off when the firmware doesn't answer lighting commands", async () => {
    const { lighting } = await board(KLOR, null);
    expect(lighting).toBeNull();
  });

  it("reads VialRGB info, the supported effects and the current mode", async () => {
    const effects = Array.from({ length: 30 }, (_, i) => i + 1); // more than one reply holds
    const { lighting } = await board(KLOR, { vialrgb: simVialRgb({ effects, mode: 6, val: 80 }) });
    expect(lighting?.kinds).toEqual(["vialrgb"]);
    expect(lighting?.vialRgbInfo).toEqual({
      version: 1,
      maxBrightness: 200,
      effects: [0, ...effects],
    });
    expect(lighting?.vialrgb).toEqual({ effect: 6, speed: 128, hue: 0, sat: 255, brightness: 80 });
    expect(
      lighting
        ?.effects("vialrgb")
        .slice(0, 3)
        .map((e) => e.name),
    ).toEqual(["Disable", "Direct Control", "Solid Color"]);
  });

  it("names effects vial-gui doesn't know by id", async () => {
    const { lighting } = await board(KLOR, { vialrgb: simVialRgb({ effects: [2, 99] }) });
    expect(lighting?.effects("vialrgb").map((e) => e.name)).toEqual(["Disable", "Solid Color", "Effect 99"]);
  });

  it("stops asking for effects when a reply adds nothing (echoing firmware)", async () => {
    const sim = new SimulatedKeyboard({ compressedDefinition: KLOR, rows: 8, cols: 6, layers: 2 });
    installLighting(sim, { vialrgb: simVialRgb() });
    // Firmware that echoes GET_SUPPORTED untouched: gt, then zeros.
    sim.handlers.unshift((msg) => msg[0] === 0x08 && msg[1] === 0x42);
    await sim.open();
    const kb = await Keyboard.load(new RequestQueue(sim, { retryDelayMs: 0 }), {
      extensions: [lightingExtension as never],
    });
    expect(kb.extension(lightingExtension)?.vialRgbInfo?.effects).toEqual([0]);
    expect(sim.requests.filter((r) => r[0] === 0x08 && r[1] === 0x42)).toHaveLength(1);
  });

  it("hides VialRGB of an unknown protocol version, with a notice", async () => {
    const error = vi.fn();
    const sim = new SimulatedKeyboard({ compressedDefinition: KLOR, rows: 8, cols: 6, layers: 2 });
    installLighting(sim, { vialrgb: simVialRgb({ version: 2 }) });
    await sim.open();
    const queue = new RequestQueue(sim, { retryDelayMs: 0 });
    const kb = await Keyboard.load(queue, { extensions: [lightingExtension as never] });
    kb.notifyHandler = (kind, message) => kind === "error" && error(message);
    expect(kb.extension(lightingExtension)).toBeNull();
    expect(error).toHaveBeenCalledWith(expect.stringContaining("VialRGB protocol 2"));
  });

  it("reads backlight and underglow on a qmk_backlight_rgblight board", async () => {
    const { lighting } = await board(QMK, {
      backlight: { brightness: 120, breathing: true },
      rgblight: { brightness: 90, effect: 3, speed: 2, hue: 40, sat: 200 },
    });
    expect(lighting?.kinds).toEqual(["backlight", "rgblight"]);
    expect(lighting?.backlight).toEqual({ brightness: 120, breathing: true });
    expect(lighting?.rgblight).toEqual({ brightness: 90, effect: 3, speed: 2, hue: 40, sat: 200 });
  });
});

describe("lighting changes", () => {
  it("sends the whole VialRGB mode on each change and records it for undo", async () => {
    const { sim, kb, fw, lighting } = await board(KLOR, { vialrgb: simVialRgb() });
    await lighting!.commit("vialrgb", { effect: 24 });
    expect(fw!.vialrgb!.mode).toBe(24);
    expect(lightingRequests(sim).map((r) => toHex(r.slice(0, 8)))).toEqual(["0741180080" + "00ff64"]);
    expect(kb.history.nextUndo?.label).toBe("RGB effect: Solid Color → Raindrops");
    expect(lighting!.unsaved).toBe(true);

    await kb.history.undo();
    expect(fw!.vialrgb!.mode).toBe(2);
    expect(lighting!.vialrgb!.effect).toBe(2);
    await kb.history.redo();
    expect(fw!.vialrgb!.mode).toBe(24);
  });

  it("makes a drag one undo step: previews are sent, the commit is recorded", async () => {
    const { kb, fw, lighting } = await board(KLOR, { vialrgb: simVialRgb({ val: 100 }) });
    const before = kb.history.nextUndo?.label;
    await lighting!.preview("vialrgb", { brightness: 110 });
    await lighting!.preview("vialrgb", { brightness: 150 });
    expect(fw!.vialrgb!.val).toBe(150);
    expect(kb.history.nextUndo?.label).toBe(before);
    await lighting!.commit("vialrgb", { brightness: 160 });
    expect(kb.history.nextUndo?.label).toBe("RGB brightness: 100 → 160");
    await kb.history.undo();
    expect(fw!.vialrgb!.val).toBe(100);
  });

  it("merges previews sent while one is on its way", async () => {
    const { sim, lighting } = await board(KLOR, { vialrgb: simVialRgb() });
    const all = [10, 20, 30, 40].map((hue) => lighting!.preview("vialrgb", { hue }));
    await Promise.all(all);
    const sentHues = lightingRequests(sim).map((r) => r[5]);
    expect(sentHues[0]).toBe(10);
    expect(sentHues.at(-1)).toBe(40);
    expect(sentHues.length).toBeLessThan(4);
  });

  it("refuses values outside the board's limits without sending", async () => {
    const { sim, lighting } = await board(KLOR, { vialrgb: simVialRgb({ maxBrightness: 120 }) });
    await expect(lighting!.commit("vialrgb", { brightness: 121 })).rejects.toThrow(LightingError);
    await expect(lighting!.commit("vialrgb", { effect: 3 })).rejects.toThrow("no RGB effect 3");
    await expect(lighting!.commit("backlight", { brightness: 1 })).rejects.toThrow("no backlight");
    expect(lightingRequests(sim)).toHaveLength(0);
  });

  it("writes only the QMK values that changed", async () => {
    const { sim, kb, fw, lighting } = await board(QMK, {
      backlight: { brightness: 120, breathing: false },
      rgblight: { brightness: 90, effect: 1, speed: 2, hue: 40, sat: 200 },
    });
    await lighting!.commit("rgblight", { hue: 50, sat: 200 });
    await lighting!.commit("backlight", { breathing: true });
    expect(lightingRequests(sim).map((r) => toHex(r.slice(0, 4)))).toEqual(["078332c8", "070a0100"]);
    expect(fw!.rgblight!.hue).toBe(50);
    expect(fw!.backlight!.breathing).toBe(true);
    expect(kb.history.nextUndo?.label).toBe("Backlight breathing: off → on");
    await kb.history.undo();
    await kb.history.undo();
    expect(fw!.rgblight!.hue).toBe(40);
    expect(fw!.backlight!.breathing).toBe(false);
  });

  it("saves to EEPROM on request and clears unsaved", async () => {
    const { fw, lighting } = await board(KLOR, { vialrgb: simVialRgb() });
    await lighting!.commit("vialrgb", { speed: 10 });
    expect(lighting!.unsaved).toBe(true);
    await lighting!.save();
    expect(fw!.saves).toBe(1);
    expect(JSON.parse(fw!.saved!).v.speed).toBe(10);
    expect(lighting!.unsaved).toBe(false);
  });
});
