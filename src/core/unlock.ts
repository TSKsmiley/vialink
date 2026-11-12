// SPDX-License-Identifier: GPL-2.0-or-later
// The unlock flow of vial-gui's unlocker.py: read the unlock keys, start the
// unlock, then poll every 200 ms while the user holds those keys until the
// firmware's counter reaches zero. All requests go through the keyboard's
// queue, so polling never interleaves with other commands.
//
// The firmware has no "cancel": stopping the polls leaves the unlock in
// progress, and starting again resets the counter. vial-gui forces a pending
// unlock to finish on connect; vial-ts offers it but lets the user cancel.

import { vialGetUnlockStatus, vialUnlockPoll, vialUnlockStart } from "./protocol/commands.ts";
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
  for (;;) {
    if (options.signal?.aborted) return false;
    await sleep(interval, options.signal);
    if (options.signal?.aborted) return false;
    const poll = vialUnlockPoll.decode(await queue.request(vialUnlockPoll.encode()));
    if (poll.unlocked) {
      options.onProgress?.({ keys, fraction: 1 });
      return true;
    }
    const fraction = Math.max(0, Math.min(1, (UNLOCK_COUNTER_MAX - poll.counter) / UNLOCK_COUNTER_MAX));
    options.onProgress?.({ keys, fraction });
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}
