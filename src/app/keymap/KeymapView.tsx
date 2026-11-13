// SPDX-License-Identifier: GPL-2.0-or-later
// The keymap view (design board 1): layer rail, keyboard, key inspector.
// ViaLink's own layout; vial-gui has layer tabs over the keyboard and the
// tabbed picker under it. Differences from vial-gui:
// - Assigning a key does not move to the next key unless "Move to the next
//   key after assigning" is ticked (off by default; remembered per browser).
// - Shift-click selects several keys; an assignment sets all of them as one
//   undo step.
// - Transparent keys show the key they fall through to, dimmed (a toggle turns it off: ▽).
// - Layer operations (design board 5): copy, paste with a preview and three
//   modes, duplicate, swap (menu or drag), clear; Ctrl+C / Ctrl+V copy the
//   selected keys, or the whole layer when nothing is selected.

import { useEffect, useState } from "react";
import type { Keyboard } from "../../core/keyboard.ts";
import { keyCount, reachSummary, visiblePositions } from "../../core/layerInfo.ts";
import {
  applyLayerWrites,
  firstEmptyLayer,
  planClear,
  planPaste,
  snapshotCounts,
  snapshotLayer,
  swapLayers,
} from "../../core/layers.ts";
import { KeyboardView, type Selection } from "../components/KeyboardView.tsx";
import { LayoutOptionsPanel } from "../components/LayoutOptionsPanel.tsx";
import { errorMessage, pickerInfoOf, useKeyboardVersion } from "../hooks.ts";
import { KeyInspector } from "./KeyInspector.tsx";
import { LayerRail } from "./LayerRail.tsx";
import { PasteFromText } from "./PasteFromText.tsx";
import { PastePreview, type PasteSource } from "./PastePreview.tsx";
import { layerSharingExtension } from "../../core/extensions/layer-sharing.ts";
import { layerNamesExtension } from "../../core/extensions/layerNames.ts";
import { encodeLayer, isShareText } from "../../core/layer-share.ts";

type Target = NonNullable<Selection>;

const ADVANCE_KEY = "vialink.autoAdvance";
const THROUGH_KEY = "vialink.showThrough";
const RECENT_KEY = "vialink.recentKeys";
const RECENT_MAX = 8;

function load<T>(key: string, fallback: T, valid: (v: unknown) => v is T): T {
  try {
    const raw = localStorage.getItem(key);
    const v = raw === null ? fallback : (JSON.parse(raw) as unknown);
    return valid(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked: the setting lasts for this page only.
  }
}

const sameTarget = (a: Target, b: Target) =>
  a.kind === "key" && b.kind === "key"
    ? a.row === b.row && a.col === b.col
    : a.kind === "encoder" && b.kind === "encoder" && a.index === b.index && a.direction === b.direction;

interface Props {
  keyboard: Keyboard;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  locked: boolean;
}

export function KeymapView({ keyboard, onError, onNotice, locked }: Props) {
  useKeyboardVersion(keyboard);
  const [layer, setLayer] = useState(0);
  const [peek, setPeek] = useState<number | null>(null);
  const [targets, setTargets] = useState<readonly Target[]>([]);
  const [writing, setWriting] = useState(false);
  const busy = writing || locked;
  const [clipboard, setClipboard] = useState<PasteSource | null>(null);
  const [pasting, setPasting] = useState<{ source: PasteSource; target: number } | null>(null);
  const [importing, setImporting] = useState<{ text: string } | null>(null);
  const sharing = keyboard.extension(layerSharingExtension) !== null;
  const names = keyboard.extension(layerNamesExtension);
  const [autoAdvance, setAutoAdvance] = useState(() =>
    load(ADVANCE_KEY, false, (v): v is boolean => typeof v === "boolean"),
  );
  const [showThrough, setShowThrough] = useState(() =>
    load(THROUGH_KEY, true, (v): v is boolean => typeof v === "boolean"),
  );
  const [recent, setRecent] = useState<number[]>(() =>
    load(RECENT_KEY, [], (v): v is number[] => Array.isArray(v) && v.every((n) => Number.isInteger(n))),
  );

  const table = keyboard.keycodes;
  const info = pickerInfoOf(keyboard);
  const named = (l: number) => info.layerNames?.[l]?.trim() || null;
  const layerName = (l: number) => named(l) ?? (l === 0 ? "Base" : `Layer ${l}`);
  const shownLayer = peek ?? layer;

  const codeOf = (t: Target, l = layer) =>
    t.kind === "key" ? keyboard.getKey(l, t.row, t.col) : keyboard.getEncoder(l, t.index, t.direction);
  const codes = targets.map((t) => codeOf(t));
  const current = codes.length > 0 && codes.every((c) => c === codes[0]) ? (codes[0] ?? null) : null;

  // Escape clears the selection (outside text fields).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      setTargets([]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const select = (s: Selection, shift: boolean) => {
    if (!s) return setTargets([]);
    if (!shift) return setTargets([s]);
    setTargets((prev) =>
      prev.some((p) => sameTarget(p, s)) ? prev.filter((p) => !sameTarget(p, s)) : [...prev, s],
    );
  };

  /** Runs a layer operation with the busy flag, reporting errors. */
  const run = async (fn: () => Promise<void>) => {
    setWriting(true);
    try {
      await fn();
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setWriting(false);
    }
  };

  const copy = (l: number, only?: readonly Target[]) => {
    const snapshot = snapshotLayer(keyboard, l, only);
    const n = snapshot.keys.size + snapshot.encoders.size;
    setClipboard({
      snapshot,
      name: only ? `${n} ${n === 1 ? "key" : "keys"} from ${layerName(l)}` : layerName(l),
    });
  };
  const pasteOnto = (l: number) => {
    if (clipboard) {
      setImporting(null);
      setPasting({ source: clipboard, target: l });
    }
  };
  const copyAsText = (l: number) =>
    void (async () => {
      try {
        const text = await encodeLayer(keyboard, l, named(l));
        await navigator.clipboard.writeText(text);
        onNotice(
          `Copied ${layerName(l)} as text (${text.length} characters). Send it in a chat; it pastes into ViaLink with Ctrl+V.`,
        );
      } catch (err) {
        onError(`Could not copy the layer as text: ${errorMessage(err)}`);
      }
    })();
  const emptyLayer = firstEmptyLayer(keyboard, (l) => named(l) !== null);
  const menu = {
    onCopy: (l: number) => copy(l),
    onCopyText: copyAsText,
    onPasteText: () => {
      setPasting(null);
      setImporting({ text: "" });
    },
    onPaste: clipboard ? pasteOnto : undefined,
    canDuplicate: emptyLayer !== null,
    onDuplicate: (l: number) =>
      void run(async () => {
        const to = firstEmptyLayer(keyboard, (x) => named(x) !== null);
        if (to === null) return;
        const plan = planPaste(keyboard, snapshotLayer(keyboard, l), to, "replace", true);
        await applyLayerWrites(keyboard, to, plan.writes, `Duplicate ${layerName(l)} to layer ${to}`);
        setLayer(to);
      }),
    // Swapping moves the layer names along with the keys (layer names extension), in the same undo step.
    onSwap: (a: number, b: number) =>
      void run(async () => {
        const label = `Swap ${layerName(a)} and ${layerName(b)}`;
        await keyboard.history.group(label, async () => {
          await swapLayers(keyboard, a, b, label);
          if (names) {
            const [na, nb] = [names.get(a), names.get(b)];
            if (na !== nb) {
              await names.set(a, nb);
              await names.set(b, na);
            }
          }
        });
      }),
    onClear: (l: number) =>
      void run(() => applyLayerWrites(keyboard, l, planClear(keyboard, l), `Clear ${layerName(l)}`)),
  };

  // Ctrl+C copies the selected keys, or the whole layer; Ctrl+Shift+C copies the layer as text.
  useEffect(() => {
    if (!sharing) return;
    const editable = (t: HTMLElement | null) =>
      !!t &&
      (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || !!t.closest('[role="dialog"]'));
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== "c") return;
      if (editable(e.target as HTMLElement | null)) return;
      if (window.getSelection()?.toString()) return; // copying page text
      e.preventDefault();
      if (e.shiftKey) copyAsText(layer);
      else copy(layer, targets.length > 0 ? targets : undefined);
    };
    // Ctrl+V: shared layer text anywhere opens the import; otherwise the copied layer pastes here.
    // The paste event carries the text without a clipboard permission prompt.
    const onPaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData("text/plain") ?? "";
      const t = e.target as HTMLElement | null;
      if (isShareText(text)) {
        if (t?.id && t.closest('[aria-label="Paste a layer from text"], [aria-label="Paste preview"]'))
          return;
        e.preventDefault();
        setImporting({ text: text.trim() });
        setPasting(null);
      } else if (clipboard && !editable(t)) {
        e.preventDefault();
        pasteOnto(layer);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("paste", onPaste);
    };
  });

  const write = (t: Target, value: number) =>
    t.kind === "key"
      ? keyboard.setKey(layer, t.row, t.col, value)
      : keyboard.setEncoder(layer, t.index, t.direction, value);

  const pick = async (code: number, opts: { fillInner?: boolean } = {}) => {
    if (targets.length === 0 || busy) return;
    const valueFor = (t: Target) => {
      const cur = codeOf(t) ?? null;
      // As vial-gui's picker: a basic keycode picked for a masked key (LSFT(kc)) fills its inner key.
      if (opts.fillInner && cur !== null && table.isMasked(cur) && table.isBasic(code))
        return (cur & 0xff00) | code;
      return code;
    };
    setWriting(true);
    try {
      if (targets.length === 1) await write(targets[0], valueFor(targets[0]));
      else
        await keyboard.history.group(
          `Set ${targets.length} keys on ${layerName(layer)} to ${table.serialize(code)}`,
          async () => {
            for (const t of targets) await write(t, valueFor(t));
          },
        );
      const fillsInner = opts.fillInner && current !== null && table.isMasked(current) && table.isBasic(code);
      if (!fillsInner) {
        const next = [code, ...recent.filter((c) => c !== code)].slice(0, RECENT_MAX);
        setRecent(next);
        save(RECENT_KEY, next);
      }
      // After a masked keycode (LSFT(kc)), stay so its inner key can be picked next.
      const awaitsInner =
        opts.fillInner && table.isMasked(code) && (current === null || !table.isMasked(current));
      if (autoAdvance && targets.length === 1 && targets[0].kind === "key" && !awaitsInner) {
        const order = visiblePositions(keyboard);
        const t = targets[0];
        const i = order.findIndex((p) => p.row === t.row && p.col === t.col);
        const n = order[i + 1];
        setTargets(n ? [{ kind: "key", row: n.row, col: n.col }] : []);
      }
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setWriting(false);
    }
  };

  const setLayout = async (choices: number[]) => {
    setWriting(true);
    try {
      await keyboard.setLayoutChoices(choices);
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setWriting(false);
    }
  };

  const keys = keyCount(keyboard, shownLayer);
  const reach = reachSummary(keyboard, shownLayer);

  return (
    <div
      className={
        "grid items-start gap-5 [grid-template-areas:'rail'_'board'_'insp'] " +
        "lg:grid-cols-[minmax(0,1fr)_340px] lg:[grid-template-areas:'rail_insp'_'board_insp'] " +
        "xl:grid-cols-[200px_minmax(0,1fr)_340px] xl:[grid-template-areas:'rail_board_insp'] " +
        "min-[1600px]:grid-cols-[220px_minmax(0,1fr)_380px]"
      }
    >
      <div className="min-w-0 [grid-area:rail]">
        <LayerRail
          keyboard={keyboard}
          layer={layer}
          onLayer={(l) => {
            setLayer(l);
            setPeek(null);
          }}
          onPeek={setPeek}
          layerName={named}
          rename={names ? (l, n) => names.set(l, n) : undefined}
          onError={onError}
          menu={sharing ? menu : undefined}
          copied={clipboard ? { name: clipboard.name, ...snapshotCounts(clipboard.snapshot) } : null}
          onClearCopied={() => setClipboard(null)}
          pasteTarget={pasting?.target ?? null}
        />
      </div>

      {importing ? (
        <PasteFromText
          key={importing.text}
          keyboard={keyboard}
          initialText={importing.text}
          defaultTarget={firstEmptyLayer(keyboard, (l) => named(l) !== null) ?? layer}
          layerName={layerName}
          setLayerName={names ? (l, n) => names.set(l, n) : undefined}
          onError={onError}
          onClose={(onto) => {
            setImporting(null);
            if (onto !== null) setLayer(onto);
          }}
        />
      ) : pasting ? (
        <PastePreview
          keyboard={keyboard}
          source={pasting.source}
          target={pasting.target}
          onTarget={(t) => setPasting({ ...pasting, target: t })}
          layerName={layerName}
          onError={onError}
          onClose={(onto) => {
            setPasting(null);
            if (onto !== null) setLayer(onto);
          }}
        />
      ) : (
        <>
          <section
            aria-label="Keyboard"
            className="flex min-w-0 flex-col gap-3 [grid-area:board] lg:row-span-1"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="m-0 text-xl font-semibold">{layerName(shownLayer)}</h1>
              <span className="text-sm text-kumo-subtle">
                {peek !== null
                  ? "Peeking: let go of Alt to return"
                  : `${keys} ${keys === 1 ? "key" : "keys"} · ${reach === "default" ? "default layer, on at power-up" : reach}`}
              </span>
              <div className="flex-1" />
              <label
                className="inline-flex items-center gap-2 text-sm"
                title="Off: transparent keys show ▽, so you see only what this layer sets"
              >
                <input
                  type="checkbox"
                  className="size-4 accent-accent"
                  checked={showThrough}
                  onChange={(e) => {
                    setShowThrough(e.target.checked);
                    save(THROUGH_KEY, e.target.checked);
                  }}
                />
                Show keys from layers below
              </label>
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-accent"
                  checked={autoAdvance}
                  onChange={(e) => {
                    setAutoAdvance(e.target.checked);
                    save(ADVANCE_KEY, e.target.checked);
                  }}
                />
                Move to the next key after assigning
              </label>
            </div>
            <div
              className={
                "board-wrap rounded-xl border border-kumo-line bg-kumo-elevated p-2 md:p-3 " +
                (peek !== null ? "outline-2 outline-offset-2 outline-dashed outline-accent" : "")
              }
            >
              <KeyboardView
                keyboard={keyboard}
                layer={shownLayer}
                isSelected={peek !== null ? () => false : (s) => targets.some((t) => sameTarget(t, s))}
                onSelect={peek !== null ? undefined : select}
                fallthrough={showThrough}
              />
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-kumo-subtle">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-3 rounded-[3px] border border-(--vl-layer-key) bg-(--vl-layer-key-bg)" />
                Layer keys
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-3 rounded-[3px] border-2 border-accent bg-accent-tint" />
                Selected
              </span>
              <span>Click a key to edit it. Shift-click to select several. Esc clears the selection.</span>
            </div>
            <div className="legacy-view">
              <LayoutOptionsPanel keyboard={keyboard} onChange={(c) => void setLayout(c)} busy={busy} />
            </div>
          </section>

          <div className="min-w-0 [grid-area:insp] lg:sticky lg:top-4">
            <KeyInspector
              keyboard={keyboard}
              layer={layer}
              targets={targets}
              current={current}
              onPick={(c, o) => void pick(c, o)}
              busy={busy}
              info={info}
              layerName={layerName}
              recent={recent}
            />
          </div>
        </>
      )}
    </div>
  );
}
