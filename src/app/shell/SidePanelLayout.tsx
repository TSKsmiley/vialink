// SPDX-License-Identifier: GPL-2.0-or-later
// A view with a panel down the right edge of the editor area, full height
// with a line on its left, as in design boards 1 (the key inspector) and 10
// (the matrix tester's details). It fills the editor area edge to edge,
// cancelling the area's padding, and pads the main part itself. Below the
// breakpoint the panel goes under the main part. While the device panel is
// open it takes the slot (sidePanelSlot.ts) and the view's panel is left out.

import { forwardRef, useContext, type ReactNode } from "react";
import { SidePanelTaken } from "./sidePanelSlot.ts";

interface Props {
  children: ReactNode;
  /** The side panel; nothing draws the main part full width. */
  panel?: ReactNode;
  /** Width from which the panel sits beside the main part. */
  at?: "lg" | "xl";
  /** Accessible name of the whole view (a region). */
  label?: string;
  className?: string;
}

// Literal class names, so Tailwind sees them. Beside the main part, the panel
// stays in view under the sticky top bar, one window tall, and scrolls on its
// own: its last part (the key search) sits at the window's bottom however
// long the page is, instead of at the bottom of the page.
const ROW = { lg: "lg:flex-row", xl: "xl:flex-row" };
const PANEL = {
  lg:
    "lg:sticky lg:top-[var(--vl-top-bar,0px)] lg:h-[calc(100dvh-var(--vl-top-bar,0px))] lg:self-start lg:overflow-y-auto " +
    "lg:w-[340px] lg:shrink-0 lg:border-t-0 lg:border-l min-[1600px]:w-[380px]",
  xl:
    "xl:sticky xl:top-[var(--vl-top-bar,0px)] xl:h-[calc(100dvh-var(--vl-top-bar,0px))] xl:self-start xl:overflow-y-auto " +
    "xl:w-80 xl:shrink-0 xl:border-t-0 xl:border-l",
};

export const SidePanelLayout = forwardRef<HTMLElement, Props>(function SidePanelLayout(
  { children, panel, at = "lg", label, className = "" },
  ref,
) {
  const taken = useContext(SidePanelTaken);
  return (
    <section
      ref={ref}
      aria-label={label}
      className={`-m-4 flex min-w-0 flex-1 flex-col bg-kumo-canvas md:-m-5 ${ROW[at]} ${className}`}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 md:p-5">{children}</div>
      {panel && !taken && (
        <div className={`flex min-w-0 flex-col border-t border-kumo-line bg-kumo-elevated p-5 ${PANEL[at]}`}>
          {panel}
        </div>
      )}
    </section>
  );
});
