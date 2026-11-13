// SPDX-License-Identifier: GPL-2.0-or-later
// Per-keyboard keycode table: number ↔ QMK name, labels, and the keycode lists
// the picker shows. A port of vial-gui's keycodes/keycodes.py (Keycode class,
// recreate_keyboard_keycodes) and any_keycode.py, except that vial-gui keeps
// this state in module globals while here every keyboard builds its own table.

import type { CustomKeycode } from "../definition/definition.ts";
import { LISTS, VERSION_TABLES, type KeycodeDef, type VersionTable } from "./data.ts";
import { evaluateKeycodeExpression, keycodeFunctions, type ExpressionScope } from "./expression.ts";

export interface KeycodeTableConfig {
  /** Vial protocol of the board; 6 selects the v6 table, anything else v5 (as in vial-gui). */
  vialProtocol: number;
  layers: number;
  macroCount: number;
  tapDanceCount: number;
  customKeycodes?: CustomKeycode[] | null;
  /** "basic" | "advanced" from vial.json's vial.midi; anything else hides MIDI keycodes. */
  midi?: string | null;
  /** Features the board reported, e.g. "caps_word", "layer_lock", "repeat_key". */
  supportedFeatures?: Iterable<string>;
}

export interface Keycode extends KeycodeDef {
  /** Integer value for this board's protocol (for masked ids, the outer part). */
  value: number;
  /** False when the board lacks the feature this keycode needs. */
  supported: boolean;
}

export interface KeycodeGroup {
  id: string;
  title: string;
  keycodes: Keycode[];
}

export interface KeycodeLabel {
  /** Text for the key cap; may contain "\n". For masked keycodes only the first line of the outer label. */
  text: string;
  /** Label of the inner keycode of a masked keycode, e.g. "A" for LSFT(KC_A). */
  inner: string | null;
  /** "QMK_ID: description", as vial-gui's tooltip. */
  tooltip: string | null;
  /** True when the keyboard layout (e.g. Danish) replaced `text`; vial-gui draws it in the link colour. */
  overridden: boolean;
  /** Same for `inner`. */
  innerOverridden: boolean;
}

export const RESET_KEYCODE = "QK_BOOT";

export class KeycodeTable {
  readonly protocolTable: VersionTable;
  readonly config: Readonly<KeycodeTableConfig>;
  /** Picker lists, in vial-gui's grouping. */
  readonly special: Keycode[];
  readonly basic: Keycode[];
  readonly shifted: Keycode[];
  readonly iso: Keycode[];
  readonly layers: Keycode[];
  readonly boot: Keycode[];
  readonly modifiers: Keycode[];
  readonly quantum: Keycode[];
  readonly backlight: Keycode[];
  readonly media: Keycode[];
  readonly tapDance: Keycode[];
  readonly macro: Keycode[];
  readonly user: Keycode[];
  readonly midi: Keycode[];

  /** Every keycode, in recreate_keycodes() order (later entries win lookups). */
  private readonly all: Keycode[];
  /** KEYCODES_MAP: qmk_id without "(kc)" → keycode. */
  private readonly byName = new Map<string, Keycode>();
  /** RAWCODES_MAP: integer → keycode. */
  private readonly byValue = new Map<number, Keycode>();
  /** Keycode.qmk_id_to_keycode: exact qmk_ids that deserialize directly. */
  private readonly qmkIds = new Set<string>();
  /** Keycode.masked_keycodes: names like "LSFT" whose ids take an inner keycode. */
  private readonly maskedNames = new Set<string>();
  private readonly maskedValues: Set<number>;
  private readonly scope: ExpressionScope;
  private readonly features: Set<string>;
  /** Keyboard layout labels by canonical QMK id (keymaps.ts); empty for US QWERTY. */
  private overrides: Readonly<Record<string, string>> = {};

  constructor(config: KeycodeTableConfig) {
    this.config = { ...config };
    this.protocolTable = config.vialProtocol === 6 ? VERSION_TABLES[6] : VERSION_TABLES[5];
    this.maskedValues = new Set(this.protocolTable.masked);
    this.features = new Set(config.supportedFeatures ?? []);

    const make = (def: KeycodeDef): Keycode => {
      const kc: Keycode = { ...def, value: this.resolve(def.qmk_id), supported: true };
      kc.supported = !def.requires_feature || this.features.has(def.requires_feature);
      this.qmkIds.add(def.qmk_id);
      if (def.masked) this.maskedNames.add(def.qmk_id.replace("(kc)", ""));
      return kc;
    };
    const list = (defs: KeycodeDef[]) => defs.map(make);

    this.special = list(LISTS.KEYCODES_SPECIAL);
    this.basic = list(LISTS.KEYCODES_BASIC);
    this.shifted = list(LISTS.KEYCODES_SHIFTED);
    this.iso = list(LISTS.KEYCODES_ISO);
    this.boot = list(LISTS.KEYCODES_BOOT);
    this.modifiers = list(LISTS.KEYCODES_MODIFIERS);
    this.quantum = list(LISTS.KEYCODES_QUANTUM);
    this.backlight = list(LISTS.KEYCODES_BACKLIGHT);
    this.media = list(LISTS.KEYCODES_MEDIA);
    this.layers = list(layerKeycodes(config.layers));
    this.macro = list([
      ...range(config.macroCount).map((x) => ({ qmk_id: `M${x}`, label: `M${x}` })),
      ...LISTS.KEYCODES_MACRO_BASE,
    ]);
    this.tapDance = list(
      range(config.tapDanceCount).map((x) => ({
        qmk_id: `TD(${x})`,
        label: `TD(${x})`,
        tooltip: "Tap dance keycode",
      })),
    );
    this.user = list(userKeycodes(config.customKeycodes));
    const midiLevel = config.midi;
    this.midi = list([
      ...(midiLevel === "basic" || midiLevel === "advanced" ? LISTS.KEYCODES_MIDI_BASIC : []),
      ...(midiLevel === "advanced" ? LISTS.KEYCODES_MIDI_ADVANCED : []),
    ]);
    const hidden = list(range(256).map((x) => ({ qmk_id: `TD(${x})`, label: `TD(${x})` })));

    // vial-gui's qmk_id_to_keycode also knows every MIDI keycode, enabled or not.
    for (const def of [...LISTS.KEYCODES_MIDI_BASIC, ...LISTS.KEYCODES_MIDI_ADVANCED])
      this.qmkIds.add(def.qmk_id);

    this.all = [
      ...this.special,
      ...this.basic,
      ...this.shifted,
      ...this.iso,
      ...this.layers,
      ...this.boot,
      ...this.modifiers,
      ...this.quantum,
      ...this.backlight,
      ...this.media,
      ...this.tapDance,
      ...this.macro,
      ...this.user,
      ...hidden,
      ...this.midi,
    ];
    for (const kc of this.all) {
      this.byName.set(kc.qmk_id.replace("(kc)", ""), kc);
      this.byValue.set(kc.value, kc);
    }

    // any_keycode.py: names usable in expressions are the aliases of these lists, plus MOD_* masks.
    const names = new Map<string, number>();
    for (const kc of [
      ...this.special,
      ...this.basic,
      ...this.shifted,
      ...this.iso,
      ...this.backlight,
      ...this.media,
      ...this.user,
    ]) {
      for (const alias of [kc.qmk_id, ...(kc.alias ?? [])]) names.set(alias, kc.value);
    }
    for (const m of [
      "MOD_LCTL",
      "MOD_LSFT",
      "MOD_LALT",
      "MOD_LGUI",
      "MOD_RCTL",
      "MOD_RSFT",
      "MOD_RALT",
      "MOD_RGUI",
      "MOD_MEH",
      "MOD_HYPR",
    ]) {
      names.set(m, this.resolve(m));
    }
    this.scope = { names, functions: keycodeFunctions((n) => this.resolve(n)) };
  }

  /** Keycode.resolve: a QMK constant to this protocol's integer. */
  resolve(name: string): number {
    const value = this.protocolTable.kc[name];
    if (value === undefined) throw new Error(`unable to resolve qmk_id=${name}`);
    return value;
  }

  /** Keycode.serialize: integer to QMK id, "LSFT(KC_A)" for masked codes, "0x..." when unknown. */
  serialize(code: number): string {
    if (!this.maskedValues.has(code & 0xff00)) {
      const kc = this.byValue.get(code);
      if (kc) return kc.qmk_id;
    } else {
      const outer = this.byValue.get(code & 0xff00);
      const inner = this.byValue.get(code & 0x00ff);
      if (outer && inner) return outer.qmk_id.split("kc").join(inner.qmk_id);
    }
    return "0x" + code.toString(16);
  }

  /**
   * Keycode.deserialize: QMK id, alias, "0x..." or expression to an integer.
   * Returns 0 (KC_NO) for anything it cannot parse, as vial-gui does.
   */
  deserialize(value: string | number): number {
    try {
      return this.parse(value);
    } catch {
      return 0;
    }
  }

  /** Like {@link deserialize}, but throws a descriptive error instead of returning 0. */
  parse(value: string | number): number {
    if (typeof value === "number") return value;
    if (this.qmkIds.has(value)) return this.resolve(value);
    const result = evaluateKeycodeExpression(value, this.scope);
    if (!Number.isInteger(result) || result < 0 || result > 0xffff) {
      throw new Error(`"${value}" evaluates to ${result}, which is not a 16-bit keycode`);
    }
    return result;
  }

  /** Keycode.normalize: e.g. "KC_PERC" → "LSFT(KC_5)". */
  normalize(value: string | number): string {
    return this.serialize(this.deserialize(value));
  }

  /** Keycode.is_mask on the serialized form. */
  isMasked(code: number): boolean {
    return this.isMaskId(this.serialize(code));
  }

  isBasic(code: number): boolean {
    return code < 0x00ff;
  }

  /** Looks a keycode up by QMK id (KEYCODES_MAP; "(kc)" stripped). */
  find(qmkId: string): Keycode | undefined {
    return this.byName.get(qmkId === "kc" ? "KC_NO" : qmkId);
  }

  findOuter(qmkId: string): Keycode | undefined {
    return this.find(this.isMaskId(qmkId) ? qmkId.slice(0, qmkId.indexOf("(")) : qmkId);
  }

  findInner(qmkId: string): Keycode | undefined {
    return this.find(this.isMaskId(qmkId) ? qmkId.slice(qmkId.indexOf("(") + 1, -1) : qmkId);
  }

  /**
   * Picks the keyboard layout whose labels replace the US ones (KeycodeDisplay.set_keymap_override).
   * Labels only: keycodes on the wire do not change.
   */
  setLabelOverrides(labels: Readonly<Record<string, string>>): void {
    this.overrides = labels;
  }

  get labelOverrides(): Readonly<Record<string, string>> {
    return this.overrides;
  }

  /** A picker button's text: the layout's label when it has one (KeycodeDisplay.relabel_buttons). */
  display(kc: Pick<Keycode, "qmk_id" | "label">): { text: string; overridden: boolean } {
    const o = Object.hasOwn(this.overrides, kc.qmk_id) ? this.overrides[kc.qmk_id] : undefined;
    return o === undefined ? { text: kc.label, overridden: false } : { text: o, overridden: true };
  }

  /** What a key cap shows, following vial-gui's util.py::KeycodeDisplay. */
  label(code: number): KeycodeLabel {
    const qmkId = this.serialize(code);
    const outer = this.findOuter(qmkId);
    const shown = outer ? this.display(outer) : { text: qmkId, overridden: false };
    let text = shown.text;
    const masked = this.isMaskId(qmkId);
    if (masked) text = text.split("\n")[0];
    const innerKc = masked ? this.findInner(qmkId) : undefined;
    const inner = innerKc ? this.display(innerKc) : null;
    let tooltip: string | null = null;
    if (outer) tooltip = outer.tooltip ? `${outer.qmk_id}: ${outer.tooltip}` : outer.qmk_id;
    return {
      text,
      inner: inner ? inner.text : null,
      tooltip,
      overridden: shown.overridden,
      innerOverridden: inner?.overridden ?? false,
    };
  }

  /** The picker tabs, as vial-gui's tabbed_keycodes.py groups them; unsupported keycodes are left out. */
  groups(): KeycodeGroup[] {
    const visible = (list: Keycode[]) => list.filter((kc) => kc.supported);
    const groups: KeycodeGroup[] = [
      { id: "basic", title: "Basic", keycodes: visible([...this.special, ...this.basic, ...this.shifted]) },
      { id: "iso", title: "ISO/JIS", keycodes: visible(this.iso) },
      { id: "layers", title: "Layers", keycodes: visible(this.layers) },
      {
        id: "quantum",
        title: "Quantum",
        keycodes: visible([...this.boot, ...this.modifiers, ...this.quantum]),
      },
      { id: "backlight", title: "Backlight", keycodes: visible(this.backlight) },
      { id: "media", title: "App, Media and Mouse", keycodes: visible(this.media) },
      { id: "midi", title: "MIDI", keycodes: visible(this.midi) },
      { id: "tapdance", title: "Tap Dance", keycodes: visible(this.tapDance) },
      { id: "user", title: "User", keycodes: visible(this.user) },
      { id: "macro", title: "Macro", keycodes: visible(this.macro) },
    ];
    return groups.filter((g) => g.keycodes.length > 0);
  }

  private isMaskId(qmkId: string): boolean {
    const paren = qmkId.indexOf("(");
    return paren !== -1 && this.maskedNames.has(qmkId.slice(0, paren));
  }
}

function range(n: number): number[] {
  return Array.from({ length: Math.max(0, n) }, (_, i) => i);
}

function layerKeycodes(layers: number): KeycodeDef[] {
  const out: KeycodeDef[] = [
    {
      qmk_id: "QK_LAYER_LOCK",
      label: "Layer\nLock",
      tooltip: "Locks the current layer",
      alias: ["QK_LLCK"],
      requires_feature: "layer_lock",
    },
  ];
  if (layers >= 4) {
    out.push({ qmk_id: "FN_MO13", label: "Fn1\n(Fn3)" }, { qmk_id: "FN_MO23", label: "Fn2\n(Fn3)" });
  }
  const forLayers = (name: string, tooltip: string, requires_feature?: string) => {
    for (const x of range(layers)) {
      const id = `${name}(${x})`;
      out.push({ qmk_id: id, label: id, tooltip, ...(requires_feature ? { requires_feature } : {}) });
    }
  };
  forLayers("MO", "Momentarily turn on layer when pressed (requires KC_TRNS on destination layer)");
  forLayers("DF", "Set the base (default) layer");
  forLayers("PDF", "Persistently set the base (default) layer", "persistent_default_layer");
  forLayers("TG", "Toggle layer on or off");
  forLayers("TT", "Normally acts like MO unless it's tapped multiple times, which toggles layer on");
  forLayers("OSL", "Momentarily activates layer until a key is pressed");
  forLayers("TO", "Turns on layer and turns off all other layers, except the default layer");
  for (const x of range(Math.min(layers, 16))) {
    out.push({
      qmk_id: `LT${x}(kc)`,
      label: `LT ${x}\n(kc)`,
      tooltip: `kc on tap, switch to layer ${x} while held`,
      masked: true,
    });
  }
  return out;
}

function userKeycodes(custom: CustomKeycode[] | null | undefined): KeycodeDef[] {
  const id = (x: number) => `USER${String(x).padStart(2, "0")}`;
  if (custom && custom.length > 0) {
    return custom.map((c, x) => ({
      qmk_id: id(x),
      label: c.shortName ?? id(x),
      tooltip: c.title ?? id(x),
      alias: [c.name ?? id(x)],
    }));
  }
  return range(16).map((x) => ({ qmk_id: id(x), label: `User ${x}`, tooltip: `User keycode ${x}` }));
}
