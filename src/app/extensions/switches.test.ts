// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from "vitest";
import type { KeyboardExtension } from "../../core/extensions/types.ts";
import { nameList, planTurnOff, planTurnOn } from "./switches.ts";

const ext = (
  id: string,
  name: string,
  manifest: Partial<Pick<KeyboardExtension, "requires" | "conflicts">> = {},
): KeyboardExtension<unknown> => ({ id, name, description: "", ...manifest, probe: async () => ({}) });

const sharing = ext("sharing", "Layer sharing");
const whole = ext("whole", "Share whole keymap", { requires: ["sharing"] });
const macros = ext("macros", "Macros");
const editor = ext("editor", "Macro editor", { requires: ["macros"] });
const recorder = ext("recorder", "Macro recorder", { conflicts: ["macros"] });
const all = [sharing, whole, macros, editor, recorder];
const yes = () => true;
const no = () => false;

describe("extension switches", () => {
  it("lists names", () => {
    expect([nameList([]), nameList(["A"]), nameList(["A", "B"]), nameList(["A", "B", "C"])]).toEqual([
      "",
      "A",
      "A and B",
      "A, B and C",
    ]);
  });

  it("turns on without asking when nothing else changes", () => {
    expect(planTurnOn(whole, all, new Set(["whole"]), no, yes)).toEqual({
      changes: [{ id: "whole", on: true }],
      question: null,
    });
  });

  it("offers to turn a switched-off requirement on too", () => {
    expect(planTurnOn(whole, all, new Set(["whole", "sharing"]), no, yes)).toEqual({
      changes: [
        { id: "whole", on: true },
        { id: "sharing", on: true },
      ],
      question: "Share whole keymap needs Layer sharing. Turn Layer sharing on too?",
    });
  });

  it("asks to turn a running conflicting extension off, with what needs it", () => {
    const plan = planTurnOn(
      recorder,
      all,
      new Set(["recorder"]),
      (id) => id === "macros" || id === "editor",
      yes,
    );
    expect(plan.changes).toEqual([
      { id: "recorder", on: true },
      { id: "macros", on: false },
      { id: "editor", on: false },
    ]);
    expect(plan.question).toBe(
      "Macro recorder doesn't work with Macros. Macro editor needs Macros. Turn Macros and Macro editor off?",
    );
  });

  it("doesn't ask about a conflict that changes nothing on this keyboard", () => {
    // Macros doesn't run here (unsupported, or no keyboard).
    expect(planTurnOn(recorder, all, new Set(["recorder"]), no, yes).question).toBeNull();
    // The recorder itself isn't supported here, so Macros keeps running.
    expect(planTurnOn(recorder, all, new Set(["recorder"]), (id) => id === "macros", no).question).toBeNull();
  });

  it("asks before turning off extensions that need the one turned off", () => {
    expect(planTurnOff(sharing, all, new Set())).toEqual({
      changes: [
        { id: "sharing", on: false },
        { id: "whole", on: false },
      ],
      question: "Share whole keymap needs Layer sharing. Turn Share whole keymap off too?",
    });
    expect(planTurnOff(sharing, all, new Set(["whole"])).question).toBeNull();
  });
});
