// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Keyboard } from "../keyboard.ts";
import * as C from "../protocol/constants.ts";
import { installQmkSettings } from "../sim/qmk-settings.ts";
import { SimulatedKeyboard } from "../sim/simulatedKeyboard.ts";
import { RequestQueue } from "../transport/queue.ts";
import { toHex } from "../util/bytes.ts";
import { parseVil, planVilRestore, saveVil } from "../vil.ts";
import {
  isQsidSupported,
  QMK_SETTINGS_TABS,
  qmkSettingsExtension,
  QmkSettingsError,
  qsidWidth,
} from "./qmk-settings.ts";

const xz = new Uint8Array(
  readFileSync(new URL("../../../fixtures/definitions/test_2x2_encoder.vial.json.xz", import.meta.url)),
);

const INITIAL = { 1: 0, 2: 50, 7: 200, 20: 5, 21: 0x81, 22: 0, 99: 3 };

async function board(
  opts: {
    vialProtocol?: number;
    settings?: Record<number, number> | null;
    defaults?: Record<number, number>;
    failGet?: number[];
  } = {},
) {
  const sim = new SimulatedKeyboard({
    compressedDefinition: xz,
    rows: 2,
    cols: 2,
    layers: 2,
    encoderCount: 1,
    vialProtocol: opts.vialProtocol,
  });
  const failGet = new Set(opts.failGet ?? []);
  sim.handlers.push((msg) => {
    if (msg[0] !== C.CMD_VIA_VIAL_PREFIX || msg[1] !== C.CMD_VIAL_QMK_SETTINGS_GET) return false;
    if (!failGet.has(msg[2] | (msg[3] << 8))) return false;
    msg[0] = 0xff;
    return true;
  });
  const fw = opts.settings === null ? null : installQmkSettings(sim, opts.settings ?? INITIAL, opts.defaults);
  await sim.open();
  const kb = await Keyboard.load(new RequestQueue(sim, { retryDelayMs: 0 }), {
    extensions: [qmkSettingsExtension as never],
  });
  return { sim, kb, fw, settings: kb.extension(qmkSettingsExtension) };
}

const sent = (sim: SimulatedKeyboard, sub: number) =>
  sim.requests.filter((r) => r[0] === 0xfe && r[1] === sub).map((r) => toHex(r.slice(0, 8)));

describe("QMK settings description", () => {
  it("follows qmk_settings.json widths, as qsid_serialize picks them", () => {
    expect(QMK_SETTINGS_TABS.map((t) => t.name)).toEqual([
      "Magic",
      "Grave Escape",
      "Tap-Hold",
      "Auto Shift",
      "Combo",
      "One Shot Keys",
      "Mouse keys",
    ]);
    expect(qsidWidth(21)).toBe(4); // boolean with "width": 4
    expect(qsidWidth(1)).toBe(1); // boolean without width
    expect(qsidWidth(7)).toBe(2);
    expect(qsidWidth(20)).toBe(1);
    expect(isQsidSupported(99)).toBe(false);
  });
});

describe("QMK settings extension", () => {
  it("reads the supported, described qsids from capabilities and skips the rest", async () => {
    const { sim, kb, settings } = await board();
    expect(kb.capabilities.qmkSettings).toEqual([1, 2, 7, 20, 21, 22, 99]);
    expect(settings).not.toBeNull();
    expect([...settings!.values]).toEqual([
      [1, 0],
      [2, 50],
      [7, 200],
      [20, 5],
      [21, 0x81],
      [22, 0],
    ]);
    // One GET per described qsid; 99 is not in qmk_settings.json, so it is never read.
    expect(sent(sim, C.CMD_VIAL_QMK_SETTINGS_GET)).toEqual(
      [1, 2, 7, 20, 21, 22].map((q) => toHex(Uint8Array.of(0xfe, 0x0a, q, 0, 0, 0, 0, 0))),
    );
    expect(settings!.tabs.map((t) => [t.name, t.fields.length])).toEqual([
      ["Magic", 10],
      ["Grave Escape", 4],
      ["Tap-Hold", 3],
      ["Combo", 1],
    ]);
    expect(settings!.isChecked(QMK_SETTINGS_TABS[0].fields[0])).toBe(true); // bit 0 of 0x81
    expect(settings!.isChecked(QMK_SETTINGS_TABS[0].fields[1])).toBe(false);
    expect(settings!.isChecked(QMK_SETTINGS_TABS[0].fields[7])).toBe(true); // bit 7
  });

  it("is inactive below Vial protocol 4 and on boards without settings", async () => {
    const old = await board({ vialProtocol: 3 });
    expect(old.kb.capabilities.qmkSettings).toEqual([]);
    expect(old.settings).toBeNull();
    expect(sent(old.sim, C.CMD_VIAL_QMK_SETTINGS_GET)).toEqual([]);

    expect((await board({ settings: null })).settings).toBeNull();
    expect((await board({ settings: { 99: 1 } })).settings).toBeNull();
    // Settings whose GET fails are left out.
    const partial = await board({ settings: { 2: 50, 7: 200 }, failGet: [2] });
    expect(partial.settings?.qsids).toEqual([7]);
    expect((await board({ settings: { 7: 200 }, failGet: [7] })).settings).toBeNull();
  });

  it("writes through, only on change, without an unlock", async () => {
    const { sim, kb, fw, settings } = await board();
    let asked = false;
    kb.unlockHandler = async () => {
      asked = true;
      return false;
    };
    let notified = 0;
    kb.subscribe(() => notified++);

    await settings!.set(7, 180);
    expect(fw!.values.get(7)).toBe(180);
    expect(settings!.get(7)).toBe(180);
    expect(sent(sim, C.CMD_VIAL_QMK_SETTINGS_SET)).toEqual(["fe0b0700b4000000"]);
    expect(notified).toBe(1);

    await settings!.set(7, 180);
    expect(sent(sim, C.CMD_VIAL_QMK_SETTINGS_SET)).toHaveLength(1);

    // Booleans toggle one bit and keep the others.
    await settings!.setBit(21, 9, true);
    expect(fw!.values.get(21)).toBe(0x281);
    await settings!.setBit(21, 0, false);
    expect(fw!.values.get(21)).toBe(0x280);
    await settings!.setBit(21, 0, false);
    expect(sent(sim, C.CMD_VIAL_QMK_SETTINGS_SET)).toEqual([
      "fe0b0700b4000000",
      "fe0b150081020000",
      "fe0b150080020000",
    ]);
    expect(asked).toBe(false);
    expect(sim.unlocked).toBe(false);
  });

  it("rejects bad values and reports a refused write without changing state", async () => {
    const { sim, fw, settings } = await board();
    await expect(settings!.set(20, 256)).rejects.toBeInstanceOf(QmkSettingsError);
    await expect(settings!.set(99, 1)).rejects.toBeInstanceOf(QmkSettingsError);
    sim.handlers.unshift((msg) => {
      if (msg[0] !== 0xfe || msg[1] !== C.CMD_VIAL_QMK_SETTINGS_SET) return false;
      msg[0] = 0xff;
      return true;
    });
    await expect(settings!.set(7, 100)).rejects.toThrow(/rejected Tapping Term = 100 \(status 255\)/);
    expect(settings!.get(7)).toBe(200);
    expect(fw!.values.get(7)).toBe(200);
  });

  it("resets to the firmware defaults and reads them back", async () => {
    const { sim, kb, settings } = await board({ settings: { 7: 300, 21: 4 }, defaults: { 7: 200, 21: 0 } });
    let notified = 0;
    kb.subscribe(() => notified++);
    await settings!.reset();
    expect(notified).toBeGreaterThan(0);
    expect(sent(sim, C.CMD_VIAL_QMK_SETTINGS_RESET)).toEqual(["fe0c000000000000"]);
    expect([...settings!.values]).toEqual([
      [7, 200],
      [21, 0],
    ]);
  });

  it("saves the settings dict the way vial-gui's json.dumps does", async () => {
    const { kb } = await board();
    const text = saveVil(kb);
    // json.dumps({1: 0, 2: 50, ...}) writes the int keys as strings.
    expect(text).toContain('"settings": {"1": 0, "2": 50, "7": 200, "20": 5, "21": 129, "22": 0}');
    // Same place as save_layout(): after via_protocol (and the dynamic fields vial-ts leaves out).
    expect(text.indexOf('"via_protocol"')).toBeLessThan(text.indexOf('"settings"'));
    expect(text.endsWith("}}")).toBe(true);
  });

  it("restores a vial-gui .vil: one step per differing setting, then saves it back identically", async () => {
    const { sim, kb, fw } = await board();
    // A file as vial-gui's save_layout() writes it (json.dumps of the dict built
    // there), for the same board with some settings changed; it also carries a
    // qsid this board lacks (8) and one qmk_settings.json does not describe (99).
    const layout = JSON.parse(saveVil(kb)) as Record<string, unknown>;
    const vialGui =
      `{"version": 1, "uid": ${kb.uid}, "layout": ${JSON.stringify(layout.layout).replaceAll(",", ", ")}, ` +
      `"encoder_layout": ${JSON.stringify(layout.encoder_layout).replaceAll(",", ", ")}, "layout_options": -1, ` +
      `"macro": [], "vial_protocol": 6, "via_protocol": 9, "tap_dance": [], "combo": [], ` +
      `"key_override": [], "alt_repeat_key": [], ` +
      `"settings": {"1": 0, "2": 40, "7": 175, "8": 1, "20": 5, "21": 640, "22": 1, "99": 7}}`;
    const settingsField = vialGui.slice(vialGui.indexOf('"settings"'), -1);

    const plan = planVilRestore(kb, parseVil(vialGui));
    expect(plan.skippedFeatures).toEqual([]);
    expect(plan.ops.map((op) => (op.kind === "extension" ? op.description : op.kind))).toEqual([
      'Set QMK setting "Time out period for combos" to 40',
      'Set QMK setting "Tapping Term" to 175',
      'Set QMK setting "Magic options" to 640',
      'Set QMK setting "Permissive Hold" to 1',
    ]);
    for (const op of plan.ops) if (op.kind === "extension") await op.apply();
    expect(Object.fromEntries(fw!.values)).toEqual({ 1: 0, 2: 40, 7: 175, 20: 5, 21: 640, 22: 1, 99: 3 });
    expect(sim.unlocked).toBe(false);

    // Nothing left to do, and the field saves back as it was (minus what this board lacks).
    expect(planVilRestore(kb, parseVil(vialGui)).ops).toEqual([]);
    const saved = saveVil(kb);
    expect(saved).toContain('"settings": {"1": 0, "2": 40, "7": 175, "20": 5, "21": 640, "22": 1}');
    const ownFile = `{"version": 1, "layout": [], "settings": {"1": 0, "2": 40, "7": 175, "20": 5, "21": 640, "22": 1}}`;
    expect(planVilRestore(kb, parseVil(ownFile)).ops).toEqual([]);
    expect(saved.slice(saved.indexOf('"settings"'), -1)).toBe(
      settingsField.replace(', "8": 1', "").replace(', "99": 7', ""),
    );
  });

  it("ignores malformed settings in a file", async () => {
    const { kb } = await board();
    const file = parseVil(
      '{"layout": [], "settings": {"x": 1, "7": "fast", "2": 1.5, "20": true, "-3": 1, "1": null}}',
    );
    // Python's json gives True for true, and bool is an int: tapping toggle 5 → 1.
    expect(
      planVilRestore(kb, file).ops.map((op) => (op.kind === "extension" ? op.description : op.kind)),
    ).toEqual(['Set QMK setting "Tapping Toggle" to 1']);
    expect(planVilRestore(kb, parseVil('{"layout": [], "settings": [1, 2]}')).ops).toEqual([]);
  });

  it("reports settings in a file as skipped when the board has none", async () => {
    const { kb } = await board({ settings: null });
    const plan = planVilRestore(kb, parseVil('{"uid": 1, "layout": [], "settings": {"7": 200}}'));
    expect(plan.skippedFeatures).toEqual(["QMK settings"]);
    expect(saveVil(kb)).not.toContain('"settings"');
  });
});
