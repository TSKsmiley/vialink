// SPDX-License-Identifier: GPL-2.0-or-later
// Draws the physical layout as SVG. Placement comes from core/definition/geometry.ts;
// each shape is drawn at its KLE position, rotated about its rotation origin,
// then shifted by the placement offset.

import { useMemo } from "react";
import { placeLayout } from "../../core/definition/geometry.ts";
import { hasSecondRect } from "../../core/definition/geometry.ts";
import type { PhysicalShape } from "../../core/definition/definition.ts";
import type { Keyboard } from "../../core/keyboard.ts";
import { useKeyboardVersion } from "../hooks.ts";

export type Selection =
  { kind: "key"; row: number; col: number } | { kind: "encoder"; index: number; direction: 0 | 1 } | null;

const U = 56; // pixels per key unit
const GAP = 3;

interface Props {
  keyboard: Keyboard;
  layer: number;
  selection: Selection;
  onSelect: (s: Selection) => void;
}

export function KeyboardView({ keyboard, layer, selection, onSelect }: Props) {
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

  return (
    <svg
      className="keyboard"
      viewBox={`-4 -4 ${placed.width * U + 8} ${placed.height * U + 8}`}
      width={placed.width * U + 8}
      role="group"
      aria-label={`Layer ${layer} keymap`}
    >
      {placed.keys.map(({ shape: k, shiftX, shiftY }, i) => {
        const code = keyboard.getKey(layer, k.row, k.col) ?? 0;
        const label = keyboard.keycodes.label(code);
        const selected = selection?.kind === "key" && selection.row === k.row && selection.col === k.col;
        return (
          <g
            key={`k${i}`}
            className={`key${selected ? " selected" : ""}${code === 0 ? " empty" : ""}`}
            transform={transform(k, shiftX, shiftY)}
            onClick={() => onSelect({ kind: "key", row: k.row, col: k.col })}
            role="button"
            tabIndex={0}
            aria-label={`Key ${k.row},${k.col}: ${keyboard.keycodes.serialize(code)}`}
            aria-pressed={selected}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect({ kind: "key", row: k.row, col: k.col });
              }
            }}
          >
            <title>{label.tooltip ?? keyboard.keycodes.serialize(code)}</title>
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
            <KeyLabel
              x={k.x * U}
              y={k.y * U}
              w={k.width * U}
              h={k.height * U}
              text={label.text}
              inner={label.inner}
            />
          </g>
        );
      })}
      {placed.encoders.map(({ shape: e, shiftX, shiftY }, i) => {
        const code = keyboard.getEncoder(layer, e.index, e.direction) ?? 0;
        const label = keyboard.keycodes.label(code);
        const selected =
          selection?.kind === "encoder" && selection.index === e.index && selection.direction === e.direction;
        const cx = (e.x + e.width / 2) * U;
        const cy = (e.y + e.height / 2) * U;
        const r = (Math.min(e.width, e.height) * U) / 2 - GAP;
        return (
          <g
            key={`e${i}`}
            className={`key encoder${selected ? " selected" : ""}`}
            transform={transform(e, shiftX, shiftY)}
            onClick={() => onSelect({ kind: "encoder", index: e.index, direction: e.direction })}
            role="button"
            tabIndex={0}
            aria-label={`Encoder ${e.index} ${e.direction === 0 ? "counter-clockwise" : "clockwise"}: ${keyboard.keycodes.serialize(code)}`}
            aria-pressed={selected}
            onKeyDown={(ev) => {
              if (ev.key === "Enter" || ev.key === " ") {
                ev.preventDefault();
                onSelect({ kind: "encoder", index: e.index, direction: e.direction });
              }
            }}
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
            />
          </g>
        );
      })}
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
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  inner: string | null;
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
          className={inner !== null && i === all.length - 1 ? "inner" : undefined}
        >
          {line}
        </tspan>
      ))}
    </text>
  );
}
