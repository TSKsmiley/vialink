// SPDX-License-Identifier: GPL-2.0-or-later
// Draws one extension view (AppExtension.panels) with what views get: the
// extension's own ctx and state, and the UI kit; never the Keyboard. Inside an
// error boundary, so a crashing view doesn't take ViaLink down.

import type { Keyboard } from "../../core/keyboard.ts";
import { useKeyboardVersion } from "../hooks.ts";
import { ExtensionErrorBoundary } from "./ErrorBoundary.tsx";
import { kitFor } from "./kit.tsx";
import { activePanels } from "./registry.tsx";

interface Props {
  keyboard: Keyboard;
  /** The view's id, e.g. "macros". */
  view: string;
  onOpen?: (view: string) => void;
}

export function ExtensionView({ keyboard, view, onOpen }: Props) {
  useKeyboardVersion(keyboard);
  const found = activePanels(keyboard).find((p) => p.panel.id === view);
  if (!found) return null;
  const { panel, owner } = found;
  return (
    <ExtensionErrorBoundary key={panel.id} name={owner.extension.name}>
      <panel.Component
        ctx={keyboard.contextOf(owner.extension)}
        state={owner.state}
        ui={kitFor(keyboard)}
        onOpen={onOpen}
      />
    </ExtensionErrorBoundary>
  );
}
