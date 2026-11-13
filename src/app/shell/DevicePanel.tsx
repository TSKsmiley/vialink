// SPDX-License-Identifier: GPL-2.0-or-later
// Device side bar (design board 6), opened from the device pill: what the
// keyboard is (USB id, protocols, Vial keyboard id, lock state) and the HID
// log of every request through the queue, with readable names
// (core/protocol/describe.ts), read/write/error tags, filters, a switch to
// hide polling, pause, copy, export as a replayable trace
// (core/transport/trace.ts) and clear. Replaces the old DebugPanel.

import { XIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { Keyboard } from "../../core/keyboard.ts";
import { CUSTOM_COMMANDS } from "../../core/extensions/index.ts";
import { ExtensionSlot } from "../extensions/ExtensionSlot.tsx";
import { describeRequest, isRejected, type CommandKind } from "../../core/protocol/describe.ts";
import type { QueueEvent, RequestQueue } from "../../core/transport/queue.ts";
import { toTrimmedHex } from "../../core/util/bytes.ts";
import { downloadText, useKeyboardVersion } from "../hooks.ts";
import { Button } from "../ui/index.ts";

const MAX_ROWS = 600;
let nextRowId = 0;

type RowKind = CommandKind | "error";

interface Row {
  id: number;
  at: number;
  request: Uint8Array;
  reply: Uint8Array | null;
  name: string;
  kind: RowKind;
  /** "OK · 4 ms", "rejected", "failed: timeout", "waiting…" */
  result: string;
}

type Filter = "all" | "writes" | "errors" | "unlock";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "writes", label: "Writes" },
  { id: "errors", label: "Errors" },
  { id: "unlock", label: "Unlock" },
];

const spaced = (b: Uint8Array) => toTrimmedHex(b).replace(/(..)(?=.)/g, "$1 ") || "00";
const time = (at: number) => {
  const d = new Date(at);
  return `${d.toLocaleTimeString([], { hour12: false })}.${String(d.getMilliseconds()).padStart(3, "0")}`;
};

interface Props {
  queue: RequestQueue | null;
  keyboard: Keyboard | null;
  onClose: () => void;
}

export function DevicePanel({ queue, keyboard, onClose }: Props) {
  useKeyboardVersion(keyboard);
  const [rows, setRows] = useState<Row[]>([]);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [hidePolling, setHidePolling] = useState(true);
  const [open, setOpen] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => closeButton.current?.focus(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!queue || paused) return;
    const name = (code: number) => keyboard?.codeName(code) ?? `0x${code.toString(16)}`;
    return queue.subscribe((e: QueueEvent) => {
      setRows((prev) => {
        let out = prev;
        if (e.kind === "request") {
          if (e.attempt > 1) return prev; // a retry: the row stays, its result says so later
          const d = describeRequest(e.data, name, CUSTOM_COMMANDS);
          out = [
            ...prev,
            {
              id: nextRowId++,
              at: e.at,
              request: e.data,
              reply: null,
              name: d.name,
              kind: d.kind,
              result: "waiting…",
            },
          ];
        } else if (e.kind === "reply" || e.kind === "failed" || e.kind === "retry") {
          let i = prev.length - 1;
          while (i >= 0 && !(prev[i].request === e.request && prev[i].reply === null)) i--;
          if (i === -1) return prev;
          const row = { ...prev[i] };
          if (e.kind === "reply") {
            row.reply = e.data;
            const rejected = isRejected(row.request, e.data);
            row.result = rejected
              ? `rejected (status ${e.data[0]})`
              : `OK · ${Math.max(0, e.at - row.at)} ms`;
            if (rejected) row.kind = "error";
          } else if (e.kind === "retry") {
            row.result = `retrying (${e.error})`;
          } else {
            row.result = `failed: ${e.error}`;
            row.kind = "error";
          }
          out = [...prev.slice(0, i), row, ...prev.slice(i + 1)];
        } else if (e.kind === "disconnected") {
          out = [
            ...prev,
            {
              id: nextRowId++,
              at: e.at,
              request: new Uint8Array(),
              reply: null,
              name: "Keyboard disconnected",
              kind: "error",
              result: "",
            },
          ];
        }
        return out.length > MAX_ROWS ? out.slice(out.length - MAX_ROWS) : out;
      });
    });
  }, [queue, paused, keyboard]);

  const shown = rows
    .filter((r) => !(hidePolling && r.kind === "poll"))
    .filter((r) =>
      filter === "all"
        ? true
        : filter === "writes"
          ? r.kind === "write" ||
            (r.kind === "error" && describeRequest(r.request, undefined, CUSTOM_COMMANDS).kind === "write")
          : filter === "errors"
            ? r.kind === "error"
            : r.kind === "unlock" || describeRequest(r.request, undefined, CUSTOM_COMMANDS).kind === "unlock",
    )
    .reverse();

  const asText = () =>
    shown
      .map(
        (r) =>
          `${time(r.at)}  ${r.kind.padEnd(6)}  ${r.name}  ${r.result}\n    → ${spaced(r.request)}${r.reply ? `\n    ← ${spaced(r.reply)}` : ""}`,
      )
      .join("\n");

  const exportTrace = () => {
    if (!queue) return;
    const note = window.prompt("Describe what this session did (optional):") ?? undefined;
    const trace = queue.exportTrace(note || undefined);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    downloadText(`vialink-trace-${stamp}.json`, JSON.stringify(trace, null, 1));
  };

  const info = queue?.transport.info;
  const hex4 = (n: number) => n.toString(16).padStart(4, "0");
  const uid = keyboard ? keyboard.uid.toString(16).padStart(16, "0") : null;

  return (
    <aside
      aria-label="Device and HID log"
      className="fixed top-0 right-0 bottom-0 z-30 flex w-[min(440px,100vw)] flex-col border-l border-kumo-line bg-kumo-elevated shadow-2xl"
    >
      <div className="flex items-center gap-3 border-b border-kumo-line px-5 py-4">
        <span className="size-2.5 rounded-full bg-connected" aria-hidden="true" />
        <h2 className="m-0 flex-1 text-lg font-semibold">
          {keyboard?.name ?? info?.productName ?? "No keyboard"}
        </h2>
        <button
          ref={closeButton}
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="grid size-8 cursor-pointer place-items-center rounded-md hover:bg-kumo-tint"
        >
          <XIcon size={16} />
        </button>
      </div>

      {info && (
        <dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 border-b border-kumo-line px-5 py-4 text-sm">
          <dt className="text-kumo-subtle">USB</dt>
          <dd className="m-0 font-mono">
            {hex4(info.vendorId)}:{hex4(info.productId)}
          </dd>
          {keyboard && (
            <>
              <dt className="text-kumo-subtle">Protocol</dt>
              <dd className="m-0">
                VIA {keyboard.viaProtocol} · Vial {keyboard.vialProtocol}
              </dd>
              <dt className="text-kumo-subtle">Keyboard ID</dt>
              <dd className="m-0 font-mono" title={uid ?? undefined}>
                0x{uid}
              </dd>
              <dt className="text-kumo-subtle">Status</dt>
              <dd className="m-0">
                Connected
                {keyboard.unlocked === null ? "" : keyboard.unlocked ? " · unlocked" : " · locked"}
              </dd>
            </>
          )}
        </dl>
      )}

      <div className="flex items-center gap-2 px-5 pt-4">
        <strong className="flex-1">HID log</strong>
        <span className="text-xs text-kumo-subtle">
          {rows.length} {rows.length === 1 ? "message" : "messages"}
        </span>
        <Button size="sm" onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
          {paused ? "Resume" : "Pause"}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 px-5 py-3">
        <div role="group" aria-label="Show" className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={
                "min-h-8 cursor-pointer rounded-lg border px-2.5 text-sm " +
                (filter === f.id
                  ? "border-accent bg-accent-tint font-semibold"
                  : "border-kumo-line hover:bg-kumo-tint")
              }
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={hidePolling}
            onChange={(e) => setHidePolling(e.target.checked)}
            className="size-4 accent-accent"
          />
          Hide polling
        </label>
      </div>

      <ol
        aria-label="HID messages"
        className="m-0 flex min-h-0 flex-1 list-none flex-col gap-1.5 overflow-y-auto px-5 pb-3"
      >
        {shown.length === 0 && (
          <li className="py-6 text-center text-sm text-kumo-subtle">No messages yet.</li>
        )}
        {shown.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              aria-expanded={open === r.id}
              onClick={() => setOpen(open === r.id ? null : r.id)}
              className={
                "flex w-full cursor-pointer flex-col gap-1 rounded-lg border px-3 py-2 text-left " +
                (r.kind === "error"
                  ? "border-kumo-danger bg-kumo-danger-tint"
                  : r.kind === "write"
                    ? "border-kumo-line bg-kumo-base"
                    : "border-kumo-hairline")
              }
            >
              <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
                <span className="font-mono text-[11px] text-kumo-subtle">{time(r.at)}</span>
                <span
                  className={
                    "rounded px-1.5 text-[11px] font-semibold " +
                    (r.kind === "error"
                      ? "bg-kumo-danger text-white"
                      : r.kind === "write"
                        ? "bg-accent-tint text-accent-link"
                        : "bg-kumo-tint text-kumo-subtle")
                  }
                >
                  {r.kind}
                </span>
                <strong className="font-medium">{r.name}</strong>
                <span
                  className={
                    "ml-auto text-xs " + (r.kind === "error" ? "text-kumo-danger" : "text-success-text")
                  }
                >
                  {r.result}
                </span>
              </span>
              <code className="truncate font-mono text-[11px] text-kumo-subtle">
                {open === r.id ? "→ " : ""}
                {spaced(r.request)}
              </code>
              {open === r.id && r.reply && (
                <code className="font-mono text-[11px] break-all text-kumo-subtle">← {spaced(r.reply)}</code>
              )}
            </button>
          </li>
        ))}
      </ol>

      <div className="flex flex-col gap-2 border-t border-kumo-line px-5 py-4">
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={shown.length === 0}
            onClick={() =>
              void navigator.clipboard?.writeText(asText()).then(
                () => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                },
                () => undefined,
              )
            }
          >
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button size="sm" disabled={!queue} onClick={exportTrace}>
            Export trace (.json)
          </Button>
          <Button size="sm" onClick={() => setRows([])}>
            Clear
          </Button>
        </div>
        <span className="text-xs leading-snug text-kumo-subtle">
          Click a message to see every byte. The exported trace can be replayed to reproduce a bug without the
          keyboard.
        </span>
      </div>
      {keyboard && (
        <div className="flex flex-col gap-3 border-t border-kumo-line p-4">
          <ExtensionSlot keyboard={keyboard} name="devicePanel.section" headings />
        </div>
      )}
    </aside>
  );
}
