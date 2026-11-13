// SPDX-License-Identifier: GPL-2.0-or-later
// Services: what one extension offers others (plan doc, Extension API, host
// API and "Dependencies"). ViaLink-only.
//
// A service is declared once with defineService<T>(id). Ids start with the
// owning extension's id ("layer-sharing.…"), or with "core." for services
// ViaLink itself defines and any extension may provide (keycode descriptions,
// layer names). An extension lists what it offers in `provides`, each built
// from its own state. Extensions reach another extension's service through
// ctx.use(service), and only if they list that extension in requires or
// optional; ViaLink's own code reads every provider through
// Keyboard.provided(service).

import type { DeviceContext } from "./types.ts";

export interface Service<T> {
  readonly id: string;
  /** Types only; never set. */
  readonly _type?: T;
}

/** An extension's offer of one service, built from its state. */
export interface Provision<T = unknown> {
  readonly id: string;
  readonly service: Service<T>;
  create(state: unknown, ctx: DeviceContext): T;
}

export function defineService<T>(id: string): Service<T> {
  return { id };
}

/** For an extension's `provides`: offers `service`, built from the extension's state. */
export function provide<T, State = unknown>(
  service: Service<T>,
  create: (state: State, ctx: DeviceContext) => T,
): Provision<T> {
  return { id: service.id, service, create: create as Provision<T>["create"] };
}

/** True for services ViaLink defines, which several extensions may provide. */
export const isCoreService = (id: string) => id.startsWith("core.");

/** The extension that owns a service, by its id; null for core services. */
export function serviceOwner(id: string): string | null {
  if (isCoreService(id)) return null;
  const dot = id.indexOf(".");
  return dot > 0 ? id.slice(0, dot) : null;
}

// ── Core services ───────────────────────────────────────────────────────────

/** What ViaLink shows for a keycode an extension owns (TD(0), M3). */
export interface KeycodeDescription {
  /** One line for the picker and key panel; null when the entry is empty. */
  readonly text: string | null;
  /** True when the entry does nothing yet (paste warnings). */
  readonly empty: boolean;
}

export interface KeycodeDescriber {
  /** A description of `code`, or null when this extension doesn't own it. */
  describe(code: number): KeycodeDescription | null;
}

/** Extensions explain the keycodes they own (tap dance: TD(n), macros: Mn). */
export const keycodeDescriptions = defineService<KeycodeDescriber>("core.keycode-descriptions");

export interface LayerNameProvider {
  /** The layer's name, or null when it has none. */
  name(layer: number): string | null;
  /** The name a copied layer carries (its share data, by extension id), or null. */
  fromShared?(ext: Readonly<Record<string, unknown>>): string | null;
}

/** Any extension can supply layer names (layer names reads them from the keyboard). */
export const layerNames = defineService<LayerNameProvider>("core.layer-names");
