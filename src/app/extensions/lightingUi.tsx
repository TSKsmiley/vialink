// SPDX-License-Identifier: GPL-2.0-or-later
// Lighting view, after vial-gui's editor/rgb_configurator.py: a card for each
// lighting kind the board has (QMK backlight, QMK rgblight underglow,
// VialRGB), and a Save button that stores the lighting in EEPROM.
// Deviations: changes are shown on the keyboard while a slider is dragged
// and recorded for undo when it is let go; the colour is a hue and a
// saturation slider (the board takes hue and saturation, brightness has its own
// slider) instead of a colour dialog; underglow speed is editable; the view
// says when there are changes the keyboard would forget when unplugged.

import { useState } from "react";
import {
  hsvCss,
  lightingExtension,
  type Lighting,
  type LightingKind,
} from "../../core/extensions/lighting.ts";
import { Button } from "../ui/index.ts";
import { errorMessage } from "../hooks.ts";
import { panel, type AppExtension, type PanelProps } from "./registry.tsx";

const HUE_TRACK = `linear-gradient(to right, ${[0, 43, 85, 128, 170, 213, 255].map((h) => hsvCss(h, 255)).join(", ")})`;

interface SliderProps {
  id: string;
  label: string;
  value: number;
  max: number;
  /** Sent while dragging (not recorded). */
  onPreview(value: number): void;
  /** Sent when let go (one undo step). */
  onCommit(value: number): void;
  /** A gradient for the track (hue, saturation). */
  track?: string;
  hint?: string;
}

function Slider({ id, label, value, max, onPreview, onCommit, track, hint }: SliderProps) {
  const [draft, setDraft] = useState<number | null>(null);
  const shown = draft ?? value;
  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    onCommit(draft);
  };
  return (
    <div className="grid grid-cols-[8rem_1fr_3.5rem] items-center gap-3 max-sm:grid-cols-[1fr_3.5rem]">
      <label htmlFor={id} className="text-sm max-sm:col-span-2">
        {label}
      </label>
      <input
        id={id}
        type="range"
        min={0}
        max={max}
        value={shown}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(e) => {
          const v = Number(e.target.value);
          setDraft(v);
          onPreview(v);
        }}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        className="w-full accent-accent"
        style={track ? { background: track, borderRadius: 999, height: 8, appearance: "none" } : undefined}
      />
      <output htmlFor={id} className="text-right font-mono text-sm tabular-nums text-kumo-subtle">
        {shown}
      </output>
      {hint && (
        <span id={`${id}-hint`} className="col-span-full -mt-2 text-xs text-kumo-subtle sm:col-start-2">
          {hint}
        </span>
      )}
    </div>
  );
}

const TITLES: Record<LightingKind, { title: string; about: string }> = {
  backlight: { title: "Backlight", about: "Single-colour LEDs under the keys." },
  rgblight: { title: "Underglow", about: "RGB LEDs on the board (QMK rgblight)." },
  vialrgb: { title: "RGB", about: "Per-key RGB effects (VialRGB)." },
};

function Card({ kind, children }: { kind: LightingKind; children: React.ReactNode }) {
  const { title, about } = TITLES[kind];
  return (
    <section
      aria-label={title}
      className="flex flex-col gap-4 rounded-xl border border-kumo-line bg-kumo-base p-4"
    >
      <header>
        <h2 className="m-0 text-base font-semibold">{title}</h2>
        <p className="m-0 text-sm text-kumo-subtle">{about}</p>
      </header>
      {children}
    </section>
  );
}

function ColorRow({ hue, sat, val }: { hue: number; sat: number; val?: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-32 text-sm max-sm:w-auto">Colour</span>
      <span
        role="img"
        aria-label="Current colour"
        className="h-7 w-14 rounded-md border border-kumo-line"
        style={{ background: hsvCss(hue, sat, val) }}
      />
    </div>
  );
}

function LightingPanel({ ctx, state: lighting }: PanelProps<Lighting>) {
  const [saving, setSaving] = useState(false);
  const fail = (err: unknown) => ctx.notify.error(errorMessage(err));
  const preview =
    <K extends LightingKind>(kind: K, field: string) =>
    (value: number) =>
      void lighting.preview(kind, { [field]: value } as never).catch(fail);
  const commit =
    <K extends LightingKind>(kind: K, field: string) =>
    (value: number) =>
      void lighting.commit(kind, { [field]: value } as never).catch(fail);
  const slider = (
    kind: LightingKind,
    field: string,
    label: string,
    max = 255,
    extra: Partial<SliderProps> = {},
  ) => {
    const settings = lighting[kind] as unknown as Record<string, number>;
    return (
      <Slider
        id={`lighting-${kind}-${field}`}
        label={label}
        value={settings[field]}
        max={max}
        onPreview={preview(kind, field)}
        onCommit={commit(kind, field)}
        {...extra}
      />
    );
  };
  const colour = (kind: "rgblight" | "vialrgb", hue: number, sat: number) => (
    <>
      <ColorRow hue={hue} sat={sat} />
      {slider(kind, "hue", "Hue", 255, { track: HUE_TRACK })}
      {slider(kind, "sat", "Saturation", 255, {
        track: `linear-gradient(to right, ${hsvCss(hue, 0)}, ${hsvCss(hue, 255)})`,
      })}
    </>
  );
  const effectSelect = (kind: "rgblight" | "vialrgb", value: number) => (
    <div className="grid grid-cols-[8rem_1fr] items-center gap-3 max-sm:grid-cols-1">
      <label htmlFor={`lighting-${kind}-effect`} className="text-sm">
        Effect
      </label>
      <select
        id={`lighting-${kind}-effect`}
        value={value}
        onChange={(e) => commit(kind, "effect")(Number(e.target.value))}
        className="max-w-xs rounded-md border border-kumo-line bg-kumo-control px-2 py-1"
      >
        {lighting.effects(kind).map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
          </option>
        ))}
      </select>
    </div>
  );

  const save = async () => {
    setSaving(true);
    try {
      await lighting.save();
      ctx.notify.info("Lighting saved on the keyboard.");
    } catch (err) {
      fail(err);
    } finally {
      setSaving(false);
    }
  };

  const { backlight, rgblight, vialrgb, vialRgbInfo } = lighting;
  const rgblightColour = rgblight
    ? lighting.effects("rgblight")[rgblight.effect]?.usesColor !== false
    : false;

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div>
        <h1 className="m-0 text-xl font-semibold">Lighting</h1>
        <p className="m-0 mt-1 leading-snug text-kumo-subtle">
          Changes show on the keyboard straight away. Save stores them so they stay after it is unplugged.
        </p>
      </div>

      {backlight && (
        <Card kind="backlight">
          {slider("backlight", "brightness", "Brightness", 255, {
            hint: "The keyboard rounds this to its own number of steps.",
          })}
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={backlight.breathing}
              onChange={(e) => void lighting.commit("backlight", { breathing: e.target.checked }).catch(fail)}
              className="size-4 accent-accent"
            />
            Breathing
          </label>
        </Card>
      )}

      {rgblight && (
        <Card kind="rgblight">
          {effectSelect("rgblight", rgblight.effect)}
          {slider("rgblight", "brightness", "Brightness")}
          {slider("rgblight", "speed", "Speed")}
          {rgblightColour && colour("rgblight", rgblight.hue, rgblight.sat)}
        </Card>
      )}

      {vialrgb && (
        <Card kind="vialrgb">
          {effectSelect("vialrgb", vialrgb.effect)}
          {slider("vialrgb", "brightness", "Brightness", vialRgbInfo?.maxBrightness ?? 255)}
          {slider("vialrgb", "speed", "Speed")}
          {colour("vialrgb", vialrgb.hue, vialrgb.sat)}
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant={lighting.unsaved ? "primary" : "secondary"}
          onClick={() => void save()}
          disabled={saving}
        >
          Save to keyboard
        </Button>
        <span aria-live="polite" className="text-sm text-kumo-subtle">
          {lighting.unsaved ? "Not saved: the keyboard goes back to its saved lighting when unplugged." : ""}
        </span>
      </div>
    </div>
  );
}

export const lightingUi: AppExtension = {
  id: lightingExtension.id,
  panels: [panel<Lighting>({ id: "lighting", title: "Lighting", Component: LightingPanel, modern: true })],
};
