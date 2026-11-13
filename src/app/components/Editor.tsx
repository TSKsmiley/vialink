// SPDX-License-Identifier: GPL-2.0-or-later
// The editor area: the section sidebar, and beside it the keymap
// (keymap/KeymapView.tsx), the matrix tester or an extension's view. Loading
// and saving layouts lives in the top bar (VilControls).

import { useEffect, useState } from "react";
import type { Keyboard } from "../../core/keyboard.ts";
import { ExtensionView } from "../extensions/ExtensionView.tsx";
import { activePanels } from "../extensions/registry.tsx";
import { useKeyboardVersion } from "../hooks.ts";
import { KeymapView } from "../keymap/KeymapView.tsx";
import { Sidebar, type Section } from "../shell/Sidebar.tsx";
import { MatrixTester } from "./MatrixTester.tsx";

interface Props {
  keyboard: Keyboard;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  /** True while something outside the editor writes to the board (a layout restore). */
  locked?: boolean;
}

export function Editor({ keyboard, onError, onNotice, locked = false }: Props) {
  useKeyboardVersion(keyboard);
  const [view, setView] = useState("keymap");

  // Extensions' notices and errors (ctx.notify) show like the editor's own.
  useEffect(() => {
    keyboard.setNotifyHandler((kind, message) => (kind === "error" ? onError(message) : onNotice(message)));
  }, [keyboard, onError, onNotice]);

  const panels = activePanels(keyboard).map(({ panel, owner }) => ({ ...panel, owner }));
  const sections: Section[] = [
    { id: "keymap", title: "Keymap", group: "edit" },
    ...panels.map((p) => ({
      id: p.id,
      title: p.title,
      group: "edit" as const,
      count: p.count?.(p.owner.state),
    })),
    { id: "matrix", title: "Matrix tester", group: "tools" },
  ];
  // A view whose extension was just turned off falls back to the keymap.
  const shown = sections.some((v) => v.id === view) ? view : "keymap";
  const panel = panels.find((p) => p.id === shown);

  return (
    <div className="flex min-h-0 flex-1 max-md:flex-col">
      <Sidebar sections={sections} current={shown} onSelect={setView} />
      <div
        role="tabpanel"
        aria-label={sections.find((v) => v.id === shown)?.title}
        className={
          "editor min-w-0 flex-1 p-4 md:p-5" + (shown === "keymap" || panel?.modern ? "" : " legacy-view")
        }
      >
        {shown === "matrix" ? (
          <MatrixTester keyboard={keyboard} onError={onError} />
        ) : panel ? (
          <ExtensionView keyboard={keyboard} view={panel.id} onOpen={setView} />
        ) : (
          <KeymapView keyboard={keyboard} onError={onError} onNotice={onNotice} locked={locked} />
        )}
      </div>
    </div>
  );
}
