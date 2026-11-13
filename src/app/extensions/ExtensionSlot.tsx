// SPDX-License-Identifier: GPL-2.0-or-later
// Draws what running extensions put in a named spot (registry.tsx Slots) and
// the overlays they show (ctx.ui.overlay). Each slot component draws inside an
// error boundary with the extension's ctx, state and ui; never the Keyboard.

import { useEffect, useState, type ComponentType } from "react";
import type { Keyboard } from "../../core/keyboard.ts";
import { useKeyboardVersion } from "../hooks.ts";
import { ExtensionErrorBoundary } from "./ErrorBoundary.tsx";
import { kitFor } from "./kit.tsx";
import { slotFillers, type PanelProps } from "./registry.tsx";

/** Every running extension's component for `name`, in load order, optionally each under a heading. */
export function ExtensionSlot({
  keyboard,
  name,
  headings = false,
}: {
  keyboard: Keyboard;
  name: "devicePanel.section" | "topBar.item";
  headings?: boolean;
}) {
  useKeyboardVersion(keyboard);
  return (
    <>
      {slotFillers(keyboard, name).map(({ fill, owner }) => {
        const Component = fill.Component as ComponentType<PanelProps>;
        const title = "title" in fill ? fill.title : null;
        return (
          <ExtensionErrorBoundary key={owner.extension.id} name={owner.extension.name}>
            {headings && title ? (
              <section aria-label={title} className="flex flex-col gap-2">
                <h3 className="m-0 text-sm font-semibold">{title}</h3>
                <Component
                  ctx={keyboard.contextOf(owner.extension)}
                  state={owner.state}
                  ui={kitFor(keyboard)}
                />
              </section>
            ) : (
              <Component
                ctx={keyboard.contextOf(owner.extension)}
                state={owner.state}
                ui={kitFor(keyboard)}
              />
            )}
          </ExtensionErrorBoundary>
        );
      })}
    </>
  );
}

/** Popovers extensions show (ctx.ui.overlay), placed under the element with their anchor id. */
export function ExtensionOverlays({ keyboard }: { keyboard: Keyboard }) {
  useKeyboardVersion(keyboard);
  const [, setTick] = useState(0);
  useEffect(() => {
    const again = () => setTick((t) => t + 1);
    window.addEventListener("resize", again);
    window.addEventListener("scroll", again, true);
    return () => {
      window.removeEventListener("resize", again);
      window.removeEventListener("scroll", again, true);
    };
  }, []);
  return (
    <>
      {keyboard.overlays.map((o) => {
        const target = document.querySelector(`[data-anchor="${CSS.escape(o.anchor)}"]`);
        if (!target) return null; // its element isn't on screen right now
        const r = target.getBoundingClientRect();
        return (
          <div
            key={o.id}
            role="dialog"
            aria-label={o.title}
            className="fixed z-50 flex max-w-xs flex-col gap-1 rounded-lg border border-accent bg-kumo-elevated p-3 shadow-lg"
            style={{ left: Math.max(8, r.left), top: r.bottom + 8 }}
          >
            <strong className="text-sm">{o.title}</strong>
            {o.body && <p className="m-0 text-sm text-kumo-subtle">{o.body}</p>}
            <button className="self-end" onClick={() => keyboard.closeOverlay(o.id)}>
              Close
            </button>
          </div>
        );
      })}
    </>
  );
}
