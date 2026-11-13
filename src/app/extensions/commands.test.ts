// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from "vitest";
import { normalizeShortcut, resolveShortcuts, shortcutOf, type LayerCommand } from "./commands.ts";
import { layerSharingUi } from "./layerSharingUi.tsx";

const cmd = (id: string, shortcut?: string): LayerCommand => ({
  id,
  title: id,
  shortcut,
  run: () => undefined,
});
const ext = (id: string) => ({ id, name: id });

describe("command shortcuts", () => {
  it("normalize and read key presses the same way", () => {
    expect(normalizeShortcut("shift+ctrl+c")).toBe("Ctrl+Shift+C");
    expect(normalizeShortcut("Cmd+K")).toBe("Ctrl+K");
    expect(shortcutOf({ key: "c", ctrlKey: false, metaKey: true, altKey: false, shiftKey: true })).toBe(
      "Ctrl+Shift+C",
    );
  });

  it("keep ViaLink's own and the first extension's, and refuse the rest", () => {
    const sharing = layerSharingUi.layerCommands!;
    const notes = [cmd("note", "ctrl+shift+c"), cmd("undo-all", "Ctrl+Z"), cmd("free", "Ctrl+K")];
    const { shortcuts, conflicts } = resolveShortcuts([
      { extension: { id: "layer-sharing", name: "Layer copy and sharing" }, commands: sharing },
      { extension: ext("Key notes"), commands: notes },
    ]);
    expect(shortcuts.get(sharing.find((c) => c.id === "copy-text")!)).toBe("Ctrl+Shift+C");
    expect(shortcuts.get(notes[0])).toBeNull();
    expect(shortcuts.get(notes[1])).toBeNull();
    expect(shortcuts.get(notes[2])).toBe("Ctrl+K");
    expect(conflicts).toEqual([
      { shortcut: "Ctrl+Shift+C", keptBy: "Layer copy and sharing", refused: "Key notes", command: "note" },
      { shortcut: "Ctrl+Z", keptBy: "ViaLink", refused: "Key notes", command: "undo-all" },
    ]);
  });
});
