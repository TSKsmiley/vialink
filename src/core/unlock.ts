// SPDX-License-Identifier: GPL-2.0-or-later
// The unlock flow of vial-gui's unlocker.py: read the unlock keys, start the
// unlock, then poll every 200 ms while the user holds those keys until the
// firmware's counter reaches zero. All requests go through the keyboard's
// queue, so polling never interleaves with other commands. The polls run on
// the keyboard's scheduler (ViaLink-only), as an essential task that keeps
// going while an operation waits for the unlock.
//
// The firmware has no "cancel": stopping the polls leaves the unlock in
// progress, and starting again resets the counter. vial-gui forces a pending
// unlock to finish on connect; ViaLink offers it but lets the user cancel.

import { vialGetUnlockStatus, vialUnlockPoll, vialUnlockStart } from "./protocol/commands.ts";
import { Scheduler } from "./scheduler.ts";
import type { RequestQueue } from "./transport/queue.ts";

/** VIAL_UNLOCK_COUNTER_MAX in vial-qmk's vial.c. */
export const UNLOCK_COUNTER_MAX = 50;

export interface UnlockProgress {
  /** Matrix positions to hold. Empty on VIAL_INSECURE boards. */
  keys: { row: number; col: number }[];
  /** 0 to 1. Falls back to 0 whenever the keys are released. */
  fraction: number;
}

export interface UnlockOptions {
  onProgress?: (p: UnlockProgress) => void;
  signal?: AbortSignal;
  pollIntervalMs?: number;
  /** The keyboard's scheduler, which runs the polls (a private one when absent, e.g. in tests). */
  scheduler?: Scheduler;
}

/** Resolves true once unlocked, false when aborted through `signal`. */
export async function runUnlock(queue: RequestQueue, options: UnlockOptions = {}): Promise<boolean> {
  const interval = options.pollIntervalMs ?? 200;
  const status = vialGetUnlockStatus.decode(await queue.request(vialGetUnlockStatus.encode()));
  if (status.unlocked) return true;
  const keys = status.keys;
  options.onProgress?.({ keys, fraction: 0 });
  if (options.signal?.aborted) return false;

  await queue.request(vialUnlockStart.encode());
  if (options.signal?.aborted) return false;
  const scheduler = options.scheduler ?? new Scheduler();
  return new Promise<boolean>((resolve, reject) => {
    const finish = (result: boolean | Error) => {
      task.stop();
      options.signal?.removeEventListener("abort", abort);
      if (result instanceof Error) reject(result);
      else resolve(result);
    };
    const abort = () => finish(false);
    // Essential: an operation (e.g. a .vil load) may be waiting for this unlock.
    const task = scheduler.every(
      interval,
      async () => {
        let poll;
        try {
          poll = vialUnlockPoll.decode(await queue.request(vialUnlockPoll.encode()));
        } catch (err) {
          finish(err instanceof Error ? err : new Error(String(err)));
          return;
        }
        if (options.signal?.aborted) return;
        if (poll.unlocked) {
          options.onProgress?.({ keys, fraction: 1 });
          finish(true);
          return;
        }
        const fraction = Math.max(0, Math.min(1, (UNLOCK_COUNTER_MAX - poll.counter) / UNLOCK_COUNTER_MAX));
        options.onProgress?.({ keys, fraction });
      },
      { name: "unlock", owner: "core", kind: "live", essential: true },
    );
    options.signal?.addEventListener("abort", abort, { once: true });
  });
}
