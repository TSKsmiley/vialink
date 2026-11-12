// SPDX-License-Identifier: GPL-2.0-or-later
// Paste a layer from text (design board 7). The text box decodes as you type
// or paste; checks say whether it fits this keyboard; then the normal paste
// preview takes over, with keys that have no spot on this layout listed to
// place by hand. Text from another keyboard, or cut-off text, is refused.

import { useEffect, useId, useState } from "react";
import { macrosExtension } from "../../core/extensions/macros.ts";
import { tapDanceExtension } from "../../core/extensions/tap-dance.ts";
import type { Keyboard } from "../../core/keyboard.ts";
import {
  decodeLayer,
  describeLayout,
  layoutOptionsOf,
  matchShared,
  type ShareMatch,
  type SharedLayer,
} from "../../core/layer-share.ts";
import { TAP_DANCE_KEY_FIELDS } from "../../core/protocol/tap-dance.ts";
import { errorMessage } from "../hooks.ts";
import { Button } from "../ui/index.ts";
import { PastePreview } from "./PastePreview.tsx";

interface Props {
  keyboard: Keyboard;
  /** Text pasted with Ctrl+V, if that is how this opened. */
  initialText: string;
  /** Layer to paste onto at first. */
  defaultTarget: number;
  layerName: (layer: number) => string;
  setLayerName?: (layer: number, name: string) => Promise<void>;
  onClose: (pastedOnto: number | null) => void;
  onError: (message: string) => void;
}

type Decoded = { shared: SharedLayer; match: ShareMatch } | { error: string } | null;

interface Check {
  ok: boolean;
  title: string;
  detail: string;
}

export function PasteFromText({
  keyboard,
  initialText,
  defaultTarget,
  layerName,
  setLayerName,
  onClose,
  onError,
}: Props) {
  const id = useId();
  const [text, setText] = useState(initialText);
  // Each result remembers the text it belongs to; a stale one counts as not decoded yet.
  const [result, setResult] = useState<{ text: string; decoded: Decoded }>({ text: "", decoded: null });
  const decoded = result.text === text && text.trim() ? result.decoded : null;
  const [target, setTarget] = useState(defaultTarget);

  useEffect(() => {
    let live = true;
    if (!text.trim()) return;
    decodeLayer(text)
      .then((shared) => {
        const macros = keyboard.extension(macrosExtension);
        const tds = keyboard.extension(tapDanceExtension);
        const match = matchShared(keyboard, shared, {
          macroEmpty: (n) => !macros || (macros.pieces[n]?.length ?? 0) === 0,
          tapDanceEmpty: (n) => {
            const e = tds?.entries[n];
            return !e || TAP_DANCE_KEY_FIELDS.every((f) => e[f] === 0);
          },
        });
        if (live) setResult({ text, decoded: { shared, match } });
      })
      .catch((err) => live && setResult({ text, decoded: { error: errorMessage(err) } }));
    return () => {
      live = false;
    };
  }, [text, keyboard]);

  const box = (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold">
        Layer text from a friend
      </label>
      <textarea
        id={id}
        rows={3}
        spellCheck={false}
        autoFocus={!initialText}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="vialink:layer:1:…"
        className="resize-y rounded-lg border border-kumo-line bg-kumo-control px-3 py-2.5 font-mono text-xs leading-relaxed break-all"
      />
      {decoded && "shared" in decoded && (
        <span className="text-xs text-kumo-subtle">
          Decoded: {decoded.shared.name ? `layer “${decoded.shared.name}”` : "a layer"} from a{" "}
          {decoded.shared.slug} with {describeLayout(decoded.shared.layout)}. Pasting this text anywhere in
          ViaLink with Ctrl+V opens this screen.
        </span>
      )}
    </div>
  );

  if (!decoded || "error" in decoded) {
    return (
      <>
        <section
          aria-label="Paste a layer from text"
          className="flex min-w-0 flex-col gap-4 [grid-area:board]"
        >
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="m-0 text-xl font-semibold">Paste a layer from text</h1>
            <span className="text-sm text-kumo-subtle">
              Works like Paste: the text is the copied layer. Nothing is written until you press Paste.
            </span>
          </div>
          {box}
          {decoded && "error" in decoded && (
            <p role="alert" className="m-0 rounded-lg border border-kumo-line bg-kumo-tint px-3 py-2 text-sm">
              {decoded.error}
            </p>
          )}
        </section>
        <aside
          aria-label="Paste options"
          className="flex flex-col gap-3 rounded-xl border border-kumo-line bg-kumo-elevated p-5 [grid-area:insp]"
        >
          <p className="m-0 text-sm text-kumo-subtle">
            A friend uses “Copy layer as text” in the layer menu and sends you the line. It holds the
            keyboard, its layout options and every key by its switch, so it fits this keyboard even with other
            layout options. Text from a different keyboard is refused.
          </p>
          <Button onClick={() => onClose(null)}>Cancel</Button>
        </aside>
      </>
    );
  }

  const { shared, match } = decoded;
  const info = keyboard.queue.transport.info;
  const hex = (n: number) => n.toString(16).padStart(4, "0");
  const checks: Check[] = [
    {
      ok: true,
      title: "Same keyboard.",
      detail: `${keyboard.name}, USB ${hex(info.vendorId)}:${hex(info.productId)}, same Vial keyboard id.`,
    },
    match.sameLayout
      ? { ok: true, title: "Same layout options.", detail: describeLayout(shared.layout) + "." }
      : {
          ok: false,
          title: "Different layout options.",
          detail: `Text: ${describeLayout(shared.layout)}. This keyboard: ${describeLayout(layoutOptionsOf(keyboard))}. Keys are matched by switch position.`,
        },
    ...match.emptyMacros.map((n) => ({
      ok: false,
      title: `A key uses macro M${n},`,
      detail: `which is empty on this keyboard. It is pasted as it is; set up M${n} under Macros.`,
    })),
    ...match.emptyTapDances.map((n) => ({
      ok: false,
      title: `A key uses tap dance TD(${n}),`,
      detail: `which is not set up on this keyboard. It is pasted as it is; set it up under Tap dance.`,
    })),
    match.unknown.length > 0
      ? {
          ok: false,
          title: `${match.unknown.length} ${match.unknown.length === 1 ? "keycode is" : "keycodes are"} unknown`,
          detail: `to this firmware and left out: ${match.unknown.slice(0, 6).join(", ")}.`,
        }
      : {
          ok: true,
          title: "All keycodes are known",
          detail: `to this firmware (Vial protocol ${keyboard.vialProtocol}).`,
        },
  ];

  const name = shared.name ? `“${shared.name}” from the text` : "the shared layer";
  const fromLabel = (row: number, col: number) => `Text's layout: row ${row}, column ${col}`;

  return (
    <PastePreview
      key={text}
      keyboard={keyboard}
      source={{
        snapshot: match.snapshot,
        name,
        mode: "replace",
        rename: shared.name ? `${shared.name} (imported)` : undefined,
        unplaced: match.unplaced.map((u) => ({ ...u, from: fromLabel(u.row, u.col) })),
      }}
      target={target}
      onTarget={setTarget}
      layerName={layerName}
      setLayerName={setLayerName}
      onClose={onClose}
      onError={onError}
      before={
        <div className="flex flex-col gap-3">
          {box}
          <ul aria-label="Checks" className="m-0 flex list-none flex-col gap-1.5 p-0">
            {checks.map((c, i) => (
              <li
                key={i}
                className={
                  "flex items-start gap-2.5 rounded-lg border px-3 py-2 text-sm leading-snug " +
                  (c.ok ? "border-success bg-success-tint" : "border-(--vl-layer-key) bg-(--vl-layer-key-bg)")
                }
              >
                <span
                  aria-hidden="true"
                  className={
                    "mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full text-[11px] font-bold text-black " +
                    (c.ok ? "bg-success" : "bg-(--vl-layer-key)")
                  }
                >
                  {c.ok ? "✓" : "!"}
                </span>
                <span>
                  <strong className="font-semibold">{c.title}</strong>{" "}
                  <span className="text-kumo-subtle">{c.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      }
    />
  );
}
