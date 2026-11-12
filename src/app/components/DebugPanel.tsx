// SPDX-License-Identifier: GPL-2.0-or-later
// Live HID log of every request and reply through the queue, with export of
// the session as a replayable trace (see core/transport/trace.ts).

import { useEffect, useState } from "react";
import type { QueueEvent, RequestQueue } from "../../core/transport/queue.ts";
import { toTrimmedHex } from "../../core/util/bytes.ts";
import { downloadText } from "../hooks.ts";

const MAX_ROWS = 400;
let nextRowId = 0;

interface Row {
  id: number;
  at: number;
  kind: QueueEvent["kind"];
  text: string;
}

function describe(e: QueueEvent): string {
  switch (e.kind) {
    case "request":
      return (e.attempt > 1 ? `(attempt ${e.attempt}) ` : "") + spaced(toTrimmedHex(e.data));
    case "reply":
      return spaced(toTrimmedHex(e.data));
    case "retry":
      return `attempt ${e.attempt} failed: ${e.error}`;
    case "failed":
      return `gave up on ${spaced(toTrimmedHex(e.request))}: ${e.error}`;
    case "disconnected":
      return "device disconnected";
  }
}

function spaced(hex: string): string {
  return hex.replace(/(..)(?=.)/g, "$1 ") || "(zeros)";
}

export function DebugPanel({ queue }: { queue: RequestQueue | null }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!queue || paused) return;
    return queue.subscribe((e) => {
      setRows((prev) => {
        const row: Row = {
          id: nextRowId++,
          at: e.at,
          kind: e.kind,
          text: describe(e),
        };
        const out = [...prev, row];
        return out.length > MAX_ROWS ? out.slice(out.length - MAX_ROWS) : out;
      });
    });
  }, [queue, paused]);

  const exportTrace = () => {
    if (!queue) return;
    const note = window.prompt("Describe what this session did (optional):") ?? undefined;
    const trace = queue.exportTrace(note || undefined);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    downloadText(`vialink-trace-${stamp}.json`, JSON.stringify(trace, null, 1));
  };

  return (
    <section className="debug" aria-label="HID debug log">
      <div className="debug-head">
        <h2>HID log</h2>
        <button onClick={() => setPaused((p) => !p)}>{paused ? "Resume" : "Pause"}</button>
        <button onClick={() => setRows([])}>Clear</button>
        <button onClick={exportTrace} disabled={!queue}>
          Export trace
        </button>
      </div>
      <ol className="debug-log">
        {rows.map((r) => (
          <li key={r.id} className={r.kind}>
            <span className="time">{new Date(r.at).toLocaleTimeString()}</span>
            <span className="dir">{r.kind === "request" ? "→" : r.kind === "reply" ? "←" : "!"}</span>
            <code>{r.text}</code>
          </li>
        ))}
        {rows.length === 0 && <li className="empty">No traffic yet.</li>}
      </ol>
    </section>
  );
}
