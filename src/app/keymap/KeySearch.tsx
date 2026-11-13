// SPDX-License-Identifier: GPL-2.0-or-later
// "Replace with any key" (design board 1): type a key name, a description, a
// shortcut like ctrl+c or a keycode expression; Enter picks the first result.
// Searches every keycode the tabbed picker offers (core/keycodes/search.ts).

import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { parseTypedKey, searchKeycodes } from "../../core/keycodes/search.ts";
import type { KeycodeTable } from "../../core/keycodes/table.ts";

const MAX_RESULTS = 24;

interface Props {
  table: KeycodeTable;
  label: string;
  onPick: (code: number) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Only basic keycodes (for a tap key or the key under modifiers). */
  basicOnly?: boolean;
  /** Recently used keycodes, newest first, shown as quick picks. */
  recent?: readonly number[];
  /** Focus the field when "/" is pressed outside text fields. */
  slashShortcut?: boolean;
}

export function KeySearch({
  table,
  label,
  onPick,
  disabled = false,
  placeholder = "Type a key: esc, vol up, ctrl+c…",
  basicOnly = false,
  recent,
  slashShortcut = false,
}: Props) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");

  const typed = useMemo(() => (basicOnly ? null : parseTypedKey(table, query)), [table, query, basicOnly]);
  const results = useMemo(() => {
    const hits = searchKeycodes(table, query).filter((kc) => !basicOnly || table.isBasic(kc.value));
    return hits.slice(0, MAX_RESULTS);
  }, [table, query, basicOnly]);

  useEffect(() => {
    if (!slashShortcut) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      input.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [slashShortcut]);

  const pick = (code: number) => {
    onPick(code);
    setQuery("");
  };

  const first = typed?.code ?? results[0]?.value;

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <div className="flex min-h-10 items-center gap-2 rounded-lg border border-kumo-line bg-kumo-control px-3 focus-within:border-accent">
        <MagnifyingGlassIcon aria-hidden="true" className="shrink-0 text-kumo-subtle" size={16} />
        <input
          ref={input}
          id={id}
          type="search"
          autoComplete="off"
          spellCheck={false}
          value={query}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && first !== undefined) {
              e.preventDefault();
              pick(first);
            } else if (e.key === "Escape") setQuery("");
          }}
          className="min-w-0 flex-1 bg-transparent py-2 outline-none placeholder:text-kumo-placeholder"
        />
        {slashShortcut && (
          <kbd className="rounded border border-kumo-line px-1.5 font-mono text-[11px] text-kumo-subtle">
            /
          </kbd>
        )}
      </div>

      {query.trim() !== "" && (
        <div role="group" aria-label={`Results for ${query}`} className="flex flex-wrap gap-1.5">
          {typed && (
            <ResultButton
              disabled={disabled}
              onClick={() => pick(typed.code)}
              label={`Assign ${typed.qmkId}`}
              id=""
            />
          )}
          {results.map((kc) => (
            <ResultButton
              key={kc.qmk_id}
              disabled={disabled}
              onClick={() => pick(kc.value)}
              label={table.display(kc).text.replace(/\n/g, " ").trim() || kc.qmk_id}
              id={kc.qmk_id}
              title={kc.tooltip ? `${kc.qmk_id}: ${kc.tooltip}` : kc.qmk_id}
            />
          ))}
          {results.length === 0 && !typed && (
            <p className="m-0 text-sm text-kumo-subtle">No keys match “{query}”.</p>
          )}
        </div>
      )}

      {recent && recent.length > 0 && query.trim() === "" && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-kumo-subtle">
          <span>Recent:</span>
          {recent.map((code) => (
            <button
              key={code}
              type="button"
              disabled={disabled}
              onClick={() => onPick(code)}
              title={table.serialize(code)}
              className="cursor-pointer rounded-md border border-kumo-line px-2 py-1 text-kumo-default hover:bg-kumo-tint disabled:cursor-default disabled:opacity-50"
            >
              {keyText(table, code)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ResultButton({
  label,
  id,
  title,
  disabled,
  onClick,
}: {
  label: string;
  id: string;
  title?: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      aria-label={label}
      className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-kumo-line bg-kumo-tint px-3 py-1.5 hover:border-accent disabled:cursor-default disabled:opacity-50"
    >
      {label}
      {id && <code className="font-mono text-[11px] text-kumo-subtle">{id}</code>}
    </button>
  );
}

/** A keycode in a few words: "Space", "Ctrl + C", "LT(1, KC_A)" when nothing shorter fits. */
export function keyText(table: KeycodeTable, code: number): string {
  const l = table.label(code);
  const text = l.text.replace(/\n/g, " ").trim();
  if (l.inner !== null) return `${text} ${l.inner.replace(/\n/g, " ")}`.trim();
  return text || table.serialize(code);
}
