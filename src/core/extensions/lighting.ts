// SPDX-License-Identifier: GPL-2.0-or-later
// Lighting: QMK backlight, QMK rgblight (underglow) and VialRGB, ported from
// vial-gui's editor/rgb_configurator.py (the effect tables, which controls
// each kind shows) and protocol/keyboard_comm.py (reload_persistent_rgb,
// reload_rgb, the set_* methods, save_rgb). Wire format: core/protocol/lighting.ts.
//
// Deviations from vial-gui, all deliberate:
// - Every change is recorded for undo; a slider drag is one undo step
//   (preview() while dragging, commit() on release). vial-gui has no undo here.
// - The rgblight effect speed is editable (vial-gui reads it but shows no control).
// - The rgblight colour sets hue and saturation only; brightness has its own
//   slider. vial-gui's colour dialog also sends the dialog's value as brightness.
// - VialRGB effects the board reports but vial-gui's table doesn't name are
//   listed as "Effect <id>" (vial-gui leaves them out).
// - The supported-effects query stops when a reply adds nothing new, so a
//   firmware that echoes the request can't loop forever (vial-gui would).
// - A lighting kind whose first read comes back unhandled (0xFF), or a VialRGB
//   protocol other than 1, turns that kind off with a notice instead of
//   failing the whole connect (vial-gui raises).
// - `unsaved` tracks changes not yet stored with Save, so the UI can say so.
// - Lighting is not part of .vil files, as in vial-gui.

import {
  lightingSave,
  qmkLightingGet,
  qmkLightingSet,
  qmkRgblightGetColor,
  qmkRgblightSetColor,
  QMK_BACKLIGHT_BRIGHTNESS,
  QMK_BACKLIGHT_EFFECT,
  QMK_RGBLIGHT_BRIGHTNESS,
  QMK_RGBLIGHT_EFFECT,
  QMK_RGBLIGHT_EFFECT_SPEED,
  vialRgbGetInfo,
  vialRgbGetMode,
  vialRgbGetSupported,
  vialRgbSetMode,
  VIALRGB_PROTOCOL_VERSION,
} from "../protocol/lighting.ts";
import type { DeviceContext, StandardExtension } from "./types.ts";

// ── Effect tables (rgb_configurator.py) ─────────────────────────────────────

export interface LightingEffect {
  readonly id: number;
  readonly name: string;
  /** QMK rgblight only: whether the effect uses the colour (QmkRgblightEffect.color_picker). */
  readonly usesColor?: boolean;
}

const rgblight = (id: number, name: string, usesColor: boolean): LightingEffect => ({ id, name, usesColor });

/** QMK_RGBLIGHT_EFFECTS: rgblight modes by index. */
export const QMK_RGBLIGHT_EFFECTS: readonly LightingEffect[] = [
  rgblight(0, "All Off", false),
  rgblight(1, "Solid Color", true),
  ...[1, 2, 3, 4].map((n, i) => rgblight(2 + i, `Breathing ${n}`, true)),
  ...[1, 2, 3].map((n, i) => rgblight(6 + i, `Rainbow Mood ${n}`, false)),
  ...[1, 2, 3, 4, 5, 6].map((n, i) => rgblight(9 + i, `Rainbow Swirl ${n}`, false)),
  ...[1, 2, 3, 4, 5, 6].map((n, i) => rgblight(15 + i, `Snake ${n}`, true)),
  ...[1, 2, 3].map((n, i) => rgblight(21 + i, `Knight ${n}`, true)),
  rgblight(24, "Christmas", true),
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n, i) => rgblight(25 + i, `Gradient ${n}`, true)),
  rgblight(35, "RGB Test", true),
  rgblight(36, "Alternating", true),
];

/** VIALRGB_EFFECTS: VialRGB effect ids and names. */
export const VIALRGB_EFFECTS: readonly LightingEffect[] = [
  "Disable",
  "Direct Control",
  "Solid Color",
  "Alphas Mods",
  "Gradient Up Down",
  "Gradient Left Right",
  "Breathing",
  "Band Sat",
  "Band Val",
  "Band Pinwheel Sat",
  "Band Pinwheel Val",
  "Band Spiral Sat",
  "Band Spiral Val",
  "Cycle All",
  "Cycle Left Right",
  "Cycle Up Down",
  "Rainbow Moving Chevron",
  "Cycle Out In",
  "Cycle Out In Dual",
  "Cycle Pinwheel",
  "Cycle Spiral",
  "Dual Beacon",
  "Rainbow Beacon",
  "Rainbow Pinwheels",
  "Raindrops",
  "Jellybean Raindrops",
  "Hue Breathing",
  "Hue Pendulum",
  "Hue Wave",
  "Typing Heatmap",
  "Digital Rain",
  "Solid Reactive Simple",
  "Solid Reactive",
  "Solid Reactive Wide",
  "Solid Reactive Multiwide",
  "Solid Reactive Cross",
  "Solid Reactive Multicross",
  "Solid Reactive Nexus",
  "Solid Reactive Multinexus",
  "Splash",
  "Multisplash",
  "Solid Splash",
  "Solid Multisplash",
  "Pixel Rain",
  "Pixel Fractal",
].map((name, id) => ({ id, name }));

export function rgblightEffectName(id: number): string {
  return QMK_RGBLIGHT_EFFECTS[id]?.name ?? `Effect ${id}`;
}

export function vialRgbEffectName(id: number): string {
  return VIALRGB_EFFECTS[id]?.name ?? `Effect ${id}`;
}

/** CSS colour of a QMK HSV triple (each 0–255), for previews. */
export function hsvCss(hue: number, sat: number, val = 255): string {
  const h = (hue / 255) * 6;
  const s = sat / 255;
  const v = val / 255;
  const f = (n: number) => {
    const k = (n + h) % 6;
    return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return `rgb(${f(5)} ${f(3)} ${f(1)})`;
}

// ── State ───────────────────────────────────────────────────────────────────

export interface BacklightSettings {
  /** 0–255; the firmware maps it onto its BACKLIGHT_LEVELS steps. */
  brightness: number;
  breathing: boolean;
}

export interface RgblightSettings {
  brightness: number;
  /** Index into QMK_RGBLIGHT_EFFECTS. */
  effect: number;
  speed: number;
  hue: number;
  sat: number;
}

export interface VialRgbSettings {
  /** VialRGB effect id; 0 is off. */
  effect: number;
  speed: number;
  hue: number;
  sat: number;
  /** Brightness, 0 to maxBrightness. */
  brightness: number;
}

export interface VialRgbInfo {
  readonly version: number;
  readonly maxBrightness: number;
  /** Effect ids the board supports, ascending; always includes 0 (off). */
  readonly effects: readonly number[];
}

export type LightingKind = "backlight" | "rgblight" | "vialrgb";

interface Settings {
  backlight: BacklightSettings;
  rgblight: RgblightSettings;
  vialrgb: VialRgbSettings;
}

export class LightingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LightingError";
  }
}

const KIND_NAMES: Record<LightingKind, string> = {
  backlight: "Backlight",
  rgblight: "Underglow",
  vialrgb: "RGB",
};

const FIELD_NAMES: Record<string, string> = {
  brightness: "brightness",
  breathing: "breathing",
  effect: "effect",
  speed: "speed",
  hue: "colour",
  sat: "colour",
};

type Partial2<K extends LightingKind> = Partial<Settings[K]>;

export class Lighting {
  private readonly ctx: DeviceContext;
  /** What the board holds now (previews included). */
  private readonly current: Partial<Settings>;
  /** What the last recorded change left; previews start from here. */
  private readonly committed: Partial<Settings>;
  /** VialRGB facts read once at connect. */
  readonly vialRgbInfo: VialRgbInfo | null;
  private dirty = false;
  private previewing: Promise<void> | null = null;
  private queued: { [K in LightingKind]?: Partial2<K> } = {};

  constructor(ctx: DeviceContext, settings: Partial<Settings>, vialRgbInfo: VialRgbInfo | null) {
    this.ctx = ctx;
    this.current = clone(settings);
    this.committed = clone(settings);
    this.vialRgbInfo = vialRgbInfo;
  }

  get backlight(): Readonly<BacklightSettings> | null {
    return this.current.backlight ?? null;
  }

  get rgblight(): Readonly<RgblightSettings> | null {
    return this.current.rgblight ?? null;
  }

  get vialrgb(): Readonly<VialRgbSettings> | null {
    return this.current.vialrgb ?? null;
  }

  /** The kinds this board has, in vial-gui's order. */
  get kinds(): LightingKind[] {
    return (["backlight", "rgblight", "vialrgb"] as const).filter((k) => this.current[k] !== undefined);
  }

  /** True when the board's lighting changed since connect or the last save. */
  get unsaved(): boolean {
    return this.dirty;
  }

  /**
   * Sends a change without recording it, for a control being dragged. Changes
   * sent while one is on its way are merged and sent once it is done. Follow
   * with {@link commit} when the drag ends.
   */
  preview<K extends LightingKind>(kind: K, patch: Partial2<K>): Promise<void> {
    this.check(kind, patch);
    this.queued[kind] = { ...this.queued[kind], ...patch } as never;
    this.previewing ??= this.flushPreviews().finally(() => {
      this.previewing = null;
    });
    return this.previewing;
  }

  /** Sends a change (if the board doesn't hold it yet) and records it as one undo step. */
  async commit<K extends LightingKind>(kind: K, patch: Partial2<K>): Promise<void> {
    this.check(kind, patch);
    while (this.previewing) await this.previewing;
    await this.write(kind, patch);
    const before = { ...this.committed[kind] } as Settings[K];
    const after = { ...this.current[kind] } as Settings[K];
    this.committed[kind] = { ...after } as never;
    const changed = (Object.keys(after) as (keyof Settings[K])[]).filter((f) => after[f] !== before[f]);
    if (changed.length === 0) return;
    this.ctx.history.record({
      label: this.label(kind, changed as string[], before, after),
      undo: () => this.restore(kind, before),
      redo: () => this.restore(kind, after),
      isCurrent: () => sameFields(this.current[kind], after, changed as string[]),
    });
  }

  /** Stores the current lighting in the keyboard's EEPROM (save_rgb). */
  async save(): Promise<void> {
    while (this.previewing) await this.previewing;
    await this.ctx.device.request(lightingSave.encode());
    this.dirty = false;
    this.ctx.changed();
  }

  /** The effects the user can pick for a kind (VialRGB: the board's own list). */
  effects(kind: "rgblight" | "vialrgb"): LightingEffect[] {
    if (kind === "rgblight") return [...QMK_RGBLIGHT_EFFECTS];
    return (this.vialRgbInfo?.effects ?? []).map((id) => ({ id, name: vialRgbEffectName(id) }));
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private async restore<K extends LightingKind>(kind: K, values: Settings[K]): Promise<void> {
    await this.write(kind, values);
    this.committed[kind] = { ...values } as never;
  }

  private async flushPreviews(): Promise<void> {
    for (;;) {
      const kind = (Object.keys(this.queued) as LightingKind[])[0];
      if (!kind) return;
      const patch = this.queued[kind]!;
      delete this.queued[kind];
      await this.write(kind, patch);
    }
  }

  private check<K extends LightingKind>(kind: K, patch: Partial2<K>): void {
    const settings = this.current[kind];
    if (!settings) throw new LightingError(`this keyboard has no ${KIND_NAMES[kind].toLowerCase()} lighting`);
    for (const [field, value] of Object.entries(patch)) {
      if (!(field in settings)) throw new LightingError(`unknown lighting setting ${kind}.${field}`);
      if (typeof value === "boolean") continue;
      const max =
        kind === "vialrgb" && field === "brightness"
          ? (this.vialRgbInfo?.maxBrightness ?? 255)
          : kind === "vialrgb" && field === "effect"
            ? 0xffff
            : 255;
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > max) {
        throw new LightingError(`${String(value)} is not a valid ${KIND_NAMES[kind].toLowerCase()} ${field}`);
      }
      if (kind === "vialrgb" && field === "effect" && !this.vialRgbInfo?.effects.includes(value)) {
        throw new LightingError(`this keyboard has no RGB effect ${value}`);
      }
      if (kind === "rgblight" && field === "effect" && value >= QMK_RGBLIGHT_EFFECTS.length) {
        throw new LightingError(`there is no underglow effect ${value}`);
      }
    }
  }

  /** Sends only what differs from the board, then updates the state. */
  private async write<K extends LightingKind>(kind: K, patch: Partial2<K>): Promise<void> {
    const now = this.current[kind] as unknown as Record<string, number | boolean>;
    const next = { ...now, ...patch } as Record<string, number | boolean>;
    const changed = new Set(Object.keys(next).filter((f) => next[f] !== now[f]));
    if (changed.size === 0) return;
    const send = (data: Uint8Array) => this.ctx.device.request(data);

    if (kind === "backlight") {
      const b = next as unknown as BacklightSettings;
      if (changed.has("brightness"))
        await send(qmkLightingSet.encode(QMK_BACKLIGHT_BRIGHTNESS, b.brightness));
      if (changed.has("breathing"))
        await send(qmkLightingSet.encode(QMK_BACKLIGHT_EFFECT, b.breathing ? 1 : 0));
    } else if (kind === "rgblight") {
      const r = next as unknown as RgblightSettings;
      if (changed.has("effect")) await send(qmkLightingSet.encode(QMK_RGBLIGHT_EFFECT, r.effect));
      if (changed.has("speed")) await send(qmkLightingSet.encode(QMK_RGBLIGHT_EFFECT_SPEED, r.speed));
      if (changed.has("hue") || changed.has("sat")) await send(qmkRgblightSetColor.encode(r.hue, r.sat));
      if (changed.has("brightness")) await send(qmkLightingSet.encode(QMK_RGBLIGHT_BRIGHTNESS, r.brightness));
    } else {
      // _vialrgb_set_mode: every change sends the whole mode.
      const v = next as unknown as VialRgbSettings;
      await send(
        vialRgbSetMode.encode({ mode: v.effect, speed: v.speed, hue: v.hue, sat: v.sat, val: v.brightness }),
      );
    }
    this.current[kind] = next as never;
    this.dirty = true;
    this.ctx.changed();
  }

  private label<K extends LightingKind>(
    kind: K,
    fields: string[],
    before: Settings[K],
    after: Settings[K],
  ): string {
    const names = [...new Set(fields.map((f) => FIELD_NAMES[f] ?? f))];
    if (names.length === 1 && fields.length === 1) {
      const f = fields[0] as keyof Settings[K];
      return `${KIND_NAMES[kind]} ${names[0]}: ${this.show(kind, f as string, before[f])} → ${this.show(kind, f as string, after[f])}`;
    }
    return `${KIND_NAMES[kind]} ${names.join(" and ")}`;
  }

  private show(kind: LightingKind, field: string, value: unknown): string {
    if (field === "effect")
      return kind === "rgblight" ? rgblightEffectName(Number(value)) : vialRgbEffectName(Number(value));
    if (typeof value === "boolean") return value ? "on" : "off";
    return String(value);
  }
}

function clone(settings: Partial<Settings>): Partial<Settings> {
  return Object.fromEntries(Object.entries(settings).map(([k, v]) => [k, { ...v }])) as Partial<Settings>;
}

function sameFields(a: object | undefined, b: object, fields: string[]): boolean {
  if (!a) return false;
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  return fields.every((f) => x[f] === y[f]);
}

// ── Probe (reload_persistent_rgb + reload_rgb) ──────────────────────────────

async function read(ctx: DeviceContext, data: Uint8Array): Promise<Uint8Array> {
  return ctx.device.request(data);
}

async function probeBacklight(ctx: DeviceContext): Promise<BacklightSettings | null> {
  const brightness = qmkLightingGet.decode(await read(ctx, qmkLightingGet.encode(QMK_BACKLIGHT_BRIGHTNESS)));
  if (brightness === null) return null;
  const effect = qmkLightingGet.decode(await read(ctx, qmkLightingGet.encode(QMK_BACKLIGHT_EFFECT)));
  // rgb_configurator.py: breathing is checked when backlight_effect == 1.
  return { brightness, breathing: effect === 1 };
}

async function probeRgblight(ctx: DeviceContext): Promise<RgblightSettings | null> {
  const brightness = qmkLightingGet.decode(await read(ctx, qmkLightingGet.encode(QMK_RGBLIGHT_BRIGHTNESS)));
  if (brightness === null) return null;
  const effect = qmkLightingGet.decode(await read(ctx, qmkLightingGet.encode(QMK_RGBLIGHT_EFFECT))) ?? 0;
  const speed = qmkLightingGet.decode(await read(ctx, qmkLightingGet.encode(QMK_RGBLIGHT_EFFECT_SPEED))) ?? 0;
  const color = qmkRgblightGetColor.decode(await read(ctx, qmkRgblightGetColor.encode()));
  return { brightness, effect, speed, hue: color?.hue ?? 0, sat: color?.sat ?? 0 };
}

async function probeVialRgb(
  ctx: DeviceContext,
): Promise<{ info: VialRgbInfo; settings: VialRgbSettings } | null> {
  const info = vialRgbGetInfo.decode(await read(ctx, vialRgbGetInfo.encode()));
  if (info === null) return null;
  if (info.version !== VIALRGB_PROTOCOL_VERSION) {
    ctx.notify.error(
      `This keyboard speaks VialRGB protocol ${info.version}; ViaLink knows only version ${VIALRGB_PROTOCOL_VERSION}, so RGB lighting is hidden. Updating the keyboard's Vial firmware should fix this.`,
    );
    return null;
  }
  const effects = new Set([0]);
  let max = 0;
  while (max < 0xffff) {
    const ids = vialRgbGetSupported.decode(await read(ctx, vialRgbGetSupported.encode(max)));
    const above = ids.filter((id) => id > max);
    if (above.length === 0) break;
    for (const id of above) effects.add(id);
    max = Math.max(...above);
  }
  const mode = vialRgbGetMode.decode(await read(ctx, vialRgbGetMode.encode()));
  return {
    info: {
      version: info.version,
      maxBrightness: info.maxBrightness,
      effects: [...effects].sort((a, b) => a - b),
    },
    settings: { effect: mode.mode, speed: mode.speed, hue: mode.hue, sat: mode.sat, brightness: mode.val },
  };
}

export const lightingExtension: StandardExtension<Lighting> = {
  id: "lighting",
  group: "standard",
  name: "Lighting",
  description:
    "Backlight, underglow and VialRGB effects, brightness, speed and colour, saved to the keyboard on request.",

  async probe(ctx) {
    // reload_persistent_rgb: which kinds the definition's "lighting" names.
    const lighting = ctx.board.capabilities.lighting;
    const settings: Partial<Settings> = {};
    let info: VialRgbInfo | null = null;
    if (lighting === "qmk_backlight" || lighting === "qmk_backlight_rgblight") {
      const backlight = await probeBacklight(ctx);
      if (backlight) settings.backlight = backlight;
    }
    if (lighting === "qmk_rgblight" || lighting === "qmk_backlight_rgblight") {
      const rgb = await probeRgblight(ctx);
      if (rgb) settings.rgblight = rgb;
    }
    if (lighting === "vialrgb") {
      const vialrgb = await probeVialRgb(ctx);
      if (vialrgb) {
        settings.vialrgb = vialrgb.settings;
        info = vialrgb.info;
      }
    }
    return Object.keys(settings).length > 0 ? new Lighting(ctx, settings, info) : null;
  },
};
