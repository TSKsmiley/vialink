// SPDX-License-Identifier: GPL-2.0-or-later
// Keycode search for the key inspector ("Replace with any key"). ViaLink-only:
// vial-gui has no search. Covers every keycode of the picker groups, so any
// key the tabbed picker offers can also be found by typing, and understands
// shortcuts such as "ctrl+c" (LCTL(KC_C)) and keycode expressions
// ("LT(1, KC_SPC)").

import type { Keycode, KeycodeTable } from "./table.ts";

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[_\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

interface Indexed {
  keycode: Keycode;
  /** Ids and aliases, lower case, with and without the KC_ prefix. */
  ids: string[];
  label: string;
  tooltip: string;
}

// Rebuilt when the keyboard layout changes, since labels are searched as shown.
const cache = new WeakMap<KeycodeTable, { overrides: object; items: Indexed[] }>();

function index(table: KeycodeTable): Indexed[] {
  const hit = cache.get(table);
  if (hit && hit.overrides === table.labelOverrides) return hit.items;
  const seen = new Set<string>();
  const out: Indexed[] = [];
  for (const group of table.groups()) {
    for (const kc of group.keycodes) {
      if (seen.has(kc.qmk_id)) continue;
      seen.add(kc.qmk_id);
      const ids = [kc.qmk_id, ...(kc.alias ?? [])].flatMap((id) => {
        const low = id.toLowerCase();
        return low.startsWith("kc_") ? [low, low.slice(3)] : [low];
      });
      // With a keyboard layout (e.g. Danish) the shown label is searched first; the US one still matches.
      const shown = table.display(kc);
      const tooltip = [kc.tooltip ?? "", shown.overridden ? kc.label : ""].join(" ");
      out.push({ keycode: kc, ids, label: words(shown.text), tooltip: words(tooltip) });
    }
  }
  cache.set(table, { overrides: table.labelOverrides, items: out });
  return out;
}

/** Lower is better; null = no match. */
function score(item: Indexed, q: string, qWords: string): number | null {
  if (item.ids.includes(q)) return 0;
  if (item.label === qWords) return 1;
  if (item.tooltip === qWords) return 2;
  if (item.ids.some((id) => id.startsWith(q))) return 3;
  if (item.label.startsWith(qWords)) return 4;
  if (item.tooltip.split(" ").some((_, i, all) => all.slice(i).join(" ").startsWith(qWords))) return 5;
  if (item.ids.some((id) => id.includes(q)) || item.label.includes(qWords) || item.tooltip.includes(qWords))
    return 6;
  return null;
}

/**
 * Keycodes matching `query`, best first: exact id or alias ("esc", "KC_ESC"),
 * exact label or description, then prefixes, then anywhere.
 */
export function searchKeycodes(table: KeycodeTable, query: string, limit = Infinity): Keycode[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const qWords = words(q);
  const hits: { kc: Keycode; s: number; i: number }[] = [];
  index(table).forEach((item, i) => {
    const s = score(item, q, qWords);
    if (s !== null) hits.push({ kc: item.keycode, s, i });
  });
  hits.sort((a, b) => a.s - b.s || a.i - b.i);
  return hits.slice(0, limit).map((h) => h.kc);
}

const MOD_NAMES: Record<string, string> = {
  ctrl: "LCTL",
  control: "LCTL",
  ctl: "LCTL",
  shift: "LSFT",
  sft: "LSFT",
  alt: "LALT",
  opt: "LALT",
  option: "LALT",
  gui: "LGUI",
  win: "LGUI",
  cmd: "LGUI",
  command: "LGUI",
  meta: "LGUI",
  super: "LGUI",
};

/**
 * A typed key combination or expression as one keycode, or null:
 * "ctrl+c" → LCTL(KC_C), "ctrl+shift+esc" → LCTL(LSFT(KC_ESCAPE)),
 * "LT(1, KC_SPC)" → that keycode. The key part must match a basic keycode exactly.
 */
export function parseTypedKey(table: KeycodeTable, text: string): { code: number; qmkId: string } | null {
  const raw = text.trim();
  if (!raw) return null;
  const parts = raw.split("+").map((p) => p.trim().toLowerCase());
  if (parts.length > 1 && parts.every((p) => p !== "")) {
    const mods = parts.slice(0, -1).map((p) => MOD_NAMES[p]);
    if (mods.every(Boolean)) {
      const key = searchKeycodes(table, parts.at(-1)!, 1)[0];
      const exact =
        key &&
        index(table)
          .find((i) => i.keycode === key)!
          .ids.includes(parts.at(-1)!);
      if (key && exact && table.isBasic(key.value)) {
        const expr = mods.reduceRight((inner, m) => `${m}(${inner})`, key.qmk_id);
        try {
          const code = table.parse(expr);
          return { code, qmkId: table.serialize(code) };
        } catch {
          return null;
        }
      }
    }
    return null;
  }
  // Expressions and ids typed in full; a bare word is a search, not a keycode.
  if (!/[()]/.test(raw) && !/^0x[0-9a-f]+$/i.test(raw) && !/^[A-Z][A-Z0-9_]*$/.test(raw)) return null;
  try {
    const code = table.parse(raw);
    return { code, qmkId: table.serialize(code) };
  } catch {
    return null;
  }
}
