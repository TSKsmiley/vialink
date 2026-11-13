// SPDX-License-Identifier: GPL-2.0-or-later
// Hook points: named moments an owner (ViaLink's core or an extension)
// announces and any extension can handle (plan doc, Extension API, "Hooks"
// and "Vetoes: the life of an operation"). ViaLink-only.
//
// Every operation with hooks runs in four phases:
// 1. before: handlers may veto (preventDefault(reason)) or ask the user
//    (requireConfirm(message)); writing anything throws. All before handlers
//    run, so the user sees every reason at once.
// 2. filter: handlers may adjust the plan and add warnings; no writes.
// 3. write: ViaLink writes the plan.
// 4. after: handlers make their own writes, in the same undo step. A failure
//    rolls back the whole operation (Keyboard.runOperation, History.atomic).
// Undo and redo replay recorded writes and never run hooks again. Handlers run
// in load order (dependencies first).

import type { DeviceContext } from "./types.ts";

export type Phase = "before" | "filter" | "after";

/** A phase of a hook point, for {@link on}. */
export interface PhaseRef<P extends Phase, Event, Plan> {
  readonly hook: string;
  readonly phase: P;
  /** Types only; never set. */
  readonly _types?: { event: Event; plan: Plan };
}

export interface HookPoint<Event, Plan = void> {
  readonly id: string;
  readonly before: PhaseRef<"before", Event, Plan>;
  readonly filter: PhaseRef<"filter", Event, Plan>;
  readonly after: PhaseRef<"after", Event, Plan>;
}

/** Declares a hook point once, in its owner; ids start with the owner's id ("layer-sharing.paste") or are core's. */
export function defineHook<Event, Plan = void>(id: string): HookPoint<Event, Plan> {
  return {
    id,
    before: { hook: id, phase: "before" },
    filter: { hook: id, phase: "filter" },
    after: { hook: id, phase: "after" },
  };
}

/** What a before handler gets: the event plus ways to stop it. */
export type BeforeEvent<Event> = Event & {
  /** Stops the operation; `reason` is shown with the extension's name. */
  preventDefault(reason: string): void;
  /** Asks the user first; several are asked together in one question. */
  requireConfirm(message: string): void;
};

/** A filter's answer: the adjusted plan, or the plan with warnings for the user. */
export type FilterResult<Plan> = Plan | { plan: Plan; warnings: readonly string[] };

/**
 * A handler's context. Compatible extensions get no `device` (typed as the
 * full context here so one handler type fits every group; the run-time
 * context still lacks it).
 */
type Ctx = DeviceContext;

export type HookHandler =
  | {
      readonly hook: string;
      readonly phase: "before";
      readonly run: (event: BeforeEvent<unknown>, ctx: Ctx, state: unknown) => void | Promise<void>;
    }
  | {
      readonly hook: string;
      readonly phase: "filter";
      readonly run: (plan: unknown, event: unknown, ctx: Ctx, state: unknown) => FilterResult<unknown>;
    }
  | {
      readonly hook: string;
      readonly phase: "after";
      readonly run: (event: unknown, ctx: Ctx, state: unknown) => void | Promise<void>;
    };

/**
 * Handles one phase of a hook point. `state` is the handling extension's own
 * state (what its probe returned); annotate its type in the handler.
 */
export function on<Event, Plan, State = unknown>(
  phase: PhaseRef<"before", Event, Plan>,
  run: (event: BeforeEvent<Event>, ctx: Ctx, state: State) => void | Promise<void>,
): HookHandler;
export function on<Event, Plan, State = unknown>(
  phase: PhaseRef<"filter", Event, Plan>,
  run: (plan: Plan, event: Event, ctx: Ctx, state: State) => FilterResult<Plan>,
): HookHandler;
export function on<Event, Plan, State = unknown>(
  phase: PhaseRef<"after", Event, Plan>,
  run: (event: Event, ctx: Ctx, state: State) => void | Promise<void>,
): HookHandler;
export function on(
  phase: PhaseRef<Phase, unknown, unknown>,
  run: (...args: never[]) => unknown,
): HookHandler {
  return { hook: phase.hook, phase: phase.phase, run } as HookHandler;
}

/** One or more extensions stopped an operation; the message lists every reason. */
export class OperationVetoedError extends Error {
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join("\n"));
    this.name = "OperationVetoedError";
  }
}

/** The user said no to an extension's question; nothing was written. Not worth an error message. */
export class OperationCancelledError extends Error {
  constructor() {
    super("Cancelled.");
    this.name = "OperationCancelledError";
  }
}

/** A handler wrote during a phase that may not write. */
export class HookPhaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HookPhaseError";
  }
}
