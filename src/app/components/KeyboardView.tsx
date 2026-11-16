// SPDX-License-Identifier: GPL-2.0-or-later
// Draws the physical layout as SVG. Placement comes from core/definition/geometry.ts;
// each shape is drawn at its KLE position, rotated about its rotation origin,
// then shifted by the placement offset.
//
// Selecting, as file managers do: a click selects one key, Ctrl+click (⌘ on a
// Mac) adds or removes one, Shift+click selects a block. With `onSelectArea`,
// dragging across the board selects what the box touches (with Ctrl, ⌘ or
// Shift held it adds to the selection), and a click between keys clears it.

import { useMemo, useRef, useState } from "react";
import { keyBoxes, targetsInBox } from "../../core/keyPaste.ts";
import { placeLayout } from "../../core/definition/geometry.ts";
import { hasSecondRect } from "../../core/definition/geometry.ts";
import type { PhysicalShape } from "../../core/definition/definition.ts";
import type { KeyMark } from "../extensions/commands.ts";
import type { Keyboard } from "../../core/keyboard.ts";
import { KC_TRNS, layerKeyOf } from "../../core/layerInfo.ts";
import { useKeyboardVersion } from "../hooks.ts";

export type Selection =
  { kind: "key"; row: number; col: number } | { kind: "encoder"; index: number; direction: 0 | 1 } | null;

/** How a click selects: just this key, add or remove it (Ctrl/⌘), or the block up to it (Shift). */
export type SelectHow = "only" | "toggle" | "range";

const howOf = (e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): SelectHow =>
  e.ctrlKey || e.metaKey ? "toggle" : e.shiftKey ? "range" : "only";

const U = 56; // pixels per key unit
const GAP = 3;

interface Props {
  keyboard: Keyboard;
  layer: number;
  selection?: Selection;
  /** Several selected keys (shift-click); overrides `selection` for drawing when given. */
  isSelected?: (s: NonNullable<Selection>) => boolean;
  /** A key was clicked (or Enter pressed on it); null for a click between keys (with `onSelectArea`). */
  onSelect?: (s: Selection, how: SelectHow) => void;
  /** Dragging a box over the board selected these; `add` when Ctrl, ⌘ or Shift was held. */
  onSelectArea?: (targets: NonNullable<Selection>[], add: boolean) => void;
  /**
   * Transparent keys show the key they fall through to (the next lower layer
   * that sets one), dimmed. ViaLink addition; vial-gui shows ▽.
   */
  fallthrough?: boolean;
  /** Code to draw instead of the keyboard's (a paste preview); undefined keeps the stored one. */
  codeAt?: (row: number, col: number) => number | undefined;
  /** Extra words for a key's label and tooltip, e.g. "was KC_B". */
  note?: (row: number, col: number) => string | null;
  /** Extra CSS class per matrix position, e.g. "pressed" in the matrix tester or "target" when unlocking. */
  highlight?: (row: number, col: number) => string | null;
  /** Extensions' mark on a key (decorations): a dot and words for its tooltip. */
  mark?: (row: number, col: number) => KeyMark | null;
  /** A small tick in the key's top-right corner, e.g. a key the matrix tester has seen work. */
  tick?: (row: number, col: number) => boolean;
  /** Label for the whole view; defaults to "Layer n keymap". */
  label?: string;
}

export function KeyboardView({
  keyboard,
  layer,
  selection = null,
  isSelected,
  onSelect,
  onSelectArea,
  highlight,
  mark,
  tick,
  label: viewLabel,
  fallthrough = false,
  codeAt,
  note,
}: Props) {
  const interactive = onSelect !== undefined;
  const version = useKeyboardVersion(keyboard);
  const choices = keyboard.layoutChoices;
  const placed = useMemo(
    () => placeLayout(keyboard.keys, keyboard.encoders, choices),
    // choices is derived from layoutOptions, which bumps the version.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [keyboard, version],
  );

  const transform = (s: PhysicalShape, shiftX: number, shiftY: number) =>
    `translate(${shiftX * U} ${shiftY * U}) rotate(${s.rotationAngle} ${s.rotationX * U} ${s.rotationY * U})`;

  // Drag to select: a box from where the pointer went down, once it has moved a few pixels.
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; add: boolean; active: boolean } | null>(null);
  const dragged = useRef(false);
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number; add: boolean } | null>(
    null,
  );
  const area = onSelectArea !== undefined;
  const boxes = useMemo(
    () => (area ? keyBoxes(keyboard) : []),
    // version: the layout options changed (as for `placed` above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [keyboard, version, area],
  );
  const toUnits = (clientX: number, clientY: number): [number, number] | null => {
    const m = svg.current?.getScreenCTM();
    if (!m) return null;
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return [p.x / U, p.y / U];
  };
  const inBox = box ? targetsInBox(boxes, box.x0, box.y0, box.x1, box.y1) : null;
  const boxed = (s: NonNullable<Selection>) =>
    !!inBox?.some((t) =>
      t.kind === "key" && s.kind === "key"
        ? t.row === s.row && t.col === s.col
        : t.kind === "encoder" && s.kind === "encoder" && t.index === s.index && t.direction === s.direction,
    );
  // While dragging, the box shows what it will select (added to the selection with a modifier).
  const shownSelected = (s: NonNullable<Selection>, selected: boolean) =>
    box ? (box.add && selected) || boxed(s) : selected;
  const areaHandlers =
    interactive && onSelectArea
      ? {
          onPointerDown: (e: React.PointerEvent<SVGSVGElement>) => {
            dragged.current = false;
            if (e.button !== 0 || e.pointerType === "touch") return;
            drag.current = {
              id: e.pointerId,
              x: e.clientX,
              y: e.clientY,
              add: howOf(e) !== "only",
              active: false,
            };
          },
          onPointerMove: (e: React.PointerEvent<SVGSVGElement>) => {
            const d = drag.current;
            if (!d || d.id !== e.pointerId) return;
            if (!d.active) {
              if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) return;
              d.active = true;
              e.currentTarget.setPointerCapture(e.pointerId);
            }
            const a = toUnits(d.x, d.y);
            const b = toUnits(e.clientX, e.clientY);
            if (a && b) setBox({ x0: a[0], y0: a[1], x1: b[0], y1: b[1], add: d.add });
          },
          onPointerUp: (e: React.PointerEvent<SVGSVGElement>) => {
            const d = drag.current;
            drag.current = null;
            if (!d?.active) return;
            dragged.current = true; // the click that follows ends the drag, not a selection
            if (e.currentTarget.hasPointerCapture(e.pointerId))
              e.currentTarget.releasePointerCapture(e.pointerId);
            const picked = inBox ?? [];
            setBox(null);
            onSelectArea?.(picked, d.add);
          },
          onPointerCancel: () => {
            drag.current = null;
            setBox(null);
          },
          onClick: (e: React.MouseEvent<SVGSVGElement>) => {
            if (dragged.current) {
              dragged.current = false;
              return;
            }
            if (e.target === e.currentTarget) onSelect?.(null, "only");
          },
        }
      : {};

  return (
    <svg
      ref={svg}
      className="keyboard"
      viewBox={`-4 -4 ${placed.width * U + 8} ${placed.height * U + 8}`}
      width={placed.width * U + 8}
      role="group"
      aria-label={viewLabel ?? `Layer ${layer} keymap`}
      {...areaHandlers}
    >
      {placed.keys.map(({ shape: k, shiftX, shiftY }, i) => {
        const code = codeAt?.(k.row, k.col) ?? keyboard.getKey(layer, k.row, k.col) ?? 0;
        const keyMark = mark?.(k.row, k.col) ?? null;
        const extraNote = [note?.(k.row, k.col), keyMark?.title].filter(Boolean).join(", ") || null;
        let shownCode = code;
        let through = false;
        if (fallthrough && code === KC_TRNS) {
          for (let below = layer - 1; below >= 0; below--) {
            const c = keyboard.getKey(below, k.row, k.col) ?? 0;
            if (c !== KC_TRNS) {
              shownCode = c;
              through = true;
              break;
            }
          }
        }
        const label = keyboard.keycodes.label(shownCode);
        const sel = { kind: "key" as const, row: k.row, col: k.col };
        const selected = shownSelected(
          sel,
          isSelected
            ? isSelected(sel)
            : selection?.kind === "key" && selection.row === k.row && selection.col === k.col,
        );
        const layerKey = !through && layerKeyOf(keyboard.keycodes, keyboard.layers, code) !== null;
        const extra = [highlight?.(k.row, k.col), through ? "through" : null, layerKey ? "layer-key" : null]
          .filter(Boolean)
          .join(" ");
        return (
          <g
            key={`k${i}`}
            className={`key${selected ? " selected" : ""}${code === 0 ? " empty" : ""}${extra ? ` ${extra}` : ""}${interactive ? "" : " static"}`}
            transform={transform(k, shiftX, shiftY)}
            {...(interactive
              ? {
                  onClick: (e: React.MouseEvent) => {
                    if (dragged.current) return;
                    onSelect(sel, howOf(e));
                  },
                  role: "button",
                  tabIndex: 0,
                  "aria-pressed": selected,
                  onKeyDown: (e: React.KeyboardEvent) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect(sel, howOf(e) === "only" ? "only" : "toggle");
                    }
                  },
                }
              : {})}
            aria-label={`Key ${k.row},${k.col}: ${keyboard.keycodes.serialize(code)}${through ? ` (shows ${keyboard.keycodes.serialize(shownCode)} from below)` : ""}${highlight?.(k.row, k.col) ? ` (${highlight(k.row, k.col)})` : ""}${extraNote ? `, ${extraNote}` : ""}`}
          >
            <title>
              {(label.tooltip ?? keyboard.keycodes.serialize(code)) + (extraNote ? ` (${extraNote})` : "")}
            </title>
            {hasSecondRect(k) && (
              <rect
                x={(k.x + k.x2) * U + GAP}
                y={(k.y + k.y2) * U + GAP}
                width={k.width2 * U - 2 * GAP}
                height={k.height2 * U - 2 * GAP}
                rx={6}
              />
            )}
            <rect
              x={k.x * U + GAP}
              y={k.y * U + GAP}
              width={k.width * U - 2 * GAP}
              height={k.height * U - 2 * GAP}
              rx={6}
            />
            {keyMark?.dot && (
              <circle className="key-mark" cx={(k.x + k.width) * U - GAP - 7} cy={k.y * U + GAP + 7} r={3} />
            )}
            {tick?.(k.row, k.col) && (
              <path
                className="key-tick"
                aria-hidden="true"
                d={`M${(k.x + k.width) * U - GAP - 13} ${k.y * U + GAP + 8}l3 3l5.5-5.5`}
              />
            )}
            <KeyLabel
              x={k.x * U}
              y={k.y * U}
              w={k.width * U}
              h={k.height * U}
              text={label.text}
              inner={label.inner}
              overridden={label.overridden}
              innerOverridden={label.innerOverridden}
            />
          </g>
        );
      })}
      {placed.encoders.map(({ shape: e, shiftX, shiftY }, i) => {
        const code = keyboard.getEncoder(layer, e.index, e.direction) ?? 0;
        const label = keyboard.keycodes.label(code);
        const encSel = { kind: "encoder" as const, index: e.index, direction: e.direction };
        const selected = shownSelected(
          encSel,
          isSelected
            ? isSelected(encSel)
            : selection?.kind === "encoder" &&
                selection.index === e.index &&
                selection.direction === e.direction,
        );
        const cx = (e.x + e.width / 2) * U;
        const cy = (e.y + e.height / 2) * U;
        const r = (Math.min(e.width, e.height) * U) / 2 - GAP;
        return (
          <g
            key={`e${i}`}
            className={`key encoder${selected ? " selected" : ""}${interactive ? "" : " static"}`}
            transform={transform(e, shiftX, shiftY)}
            {...(interactive
              ? {
                  onClick: (ev: React.MouseEvent) => {
                    if (dragged.current) return;
                    onSelect(encSel, howOf(ev));
                  },
                  role: "button",
                  tabIndex: 0,
                  "aria-pressed": selected,
                  onKeyDown: (ev: React.KeyboardEvent) => {
                    if (ev.key === "Enter" || ev.key === " ") {
                      ev.preventDefault();
                      onSelect(encSel, howOf(ev) === "only" ? "only" : "toggle");
                    }
                  },
                }
              : {})}
            aria-label={`Encoder ${e.index} ${e.direction === 0 ? "counter-clockwise" : "clockwise"}: ${keyboard.keycodes.serialize(code)}`}
          >
            <title>{`Encoder ${e.index} ${e.direction === 0 ? "↺" : "↻"}: ${label.tooltip ?? ""}`}</title>
            <circle cx={cx} cy={cy} r={r} />
            <text className="encoder-dir" x={cx} y={cy - r * 0.45} textAnchor="middle">
              {e.direction === 0 ? "↺" : "↻"}
            </text>
            <KeyLabel
              x={e.x * U}
              y={e.y * U + 8}
              w={e.width * U}
              h={e.height * U}
              text={label.text}
              inner={label.inner}
              overridden={label.overridden}
              innerOverridden={label.innerOverridden}
            />
          </g>
        );
      })}
      {box && (
        <rect
          className="marquee"
          x={Math.min(box.x0, box.x1) * U}
          y={Math.min(box.y0, box.y1) * U}
          width={Math.abs(box.x1 - box.x0) * U}
          height={Math.abs(box.y1 - box.y0) * U}
        />
      )}
    </svg>
  );
}

function KeyLabel({
  x,
  y,
  w,
  h,
  text,
  inner,
  overridden = false,
  innerOverridden = false,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  inner: string | null;
  /** The keyboard layout (e.g. Danish) replaced the label: drawn in the link colour, as vial-gui does. */
  overridden?: boolean;
  innerOverridden?: boolean;
}) {
  const lines = text.split("\n").filter((l, _i, all) => l !== "" || all.length === 1);
  const all = inner !== null ? [...lines, inner] : lines;
  const longest = Math.max(1, ...all.map((l) => [...l].length));
  const size = Math.max(8, Math.min(14, (w - 10) / (longest * 0.62), (h - 10) / (all.length * 1.25)));
  const startY = y + h / 2 - ((all.length - 1) * size * 1.15) / 2;
  return (
    <text className="key-label" x={x + w / 2} fontSize={size} textAnchor="middle" dominantBaseline="central">
      {all.map((line, i) => (
        <tspan
          key={i}
          x={x + w / 2}
          y={startY + i * size * 1.15}
          className={
            [
              inner !== null && i === all.length - 1 ? "inner" : "",
              (inner !== null && i === all.length - 1 ? innerOverridden : overridden) ? "layout-label" : "",
            ]
              .filter(Boolean)
              .join(" ") || undefined
          }
        >
          {line}
        </tspan>
      ))}
    </text>
  );
}
