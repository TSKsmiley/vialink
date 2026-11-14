// SPDX-License-Identifier: GPL-2.0-or-later
// The desktop app's end of the native HID bridge: Tauri commands and the
// hid-disconnected event from src-tauri/src/hid.rs. In a browser nothing here
// runs; isDesktop() is false and the app uses WebHID.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { NativeHidBridge, NativeKeyboard } from "../core/transport/native.ts";
import { BatchError, DeviceDisconnectedError, TransportTimeoutError } from "../core/transport/types.ts";

/** True inside the Tauri desktop app. */
export function isDesktop(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** hid.rs HidError as it arrives: `{ kind: "timeout" }`, `{ kind: "other", message }`, ... */
function hostError(err: unknown): Error {
  const e = (typeof err === "object" && err !== null ? err : {}) as { kind?: unknown; message?: unknown };
  if (e.kind === "timeout") return new TransportTimeoutError();
  if (e.kind === "disconnected") return new DeviceDisconnectedError();
  if (typeof e.message === "string") return new Error(e.message);
  return err instanceof Error ? err : new Error(String(err));
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (err) {
    throw hostError(err);
  }
}

export const tauriHid: NativeHidBridge = {
  list: () => call<NativeKeyboard[]>("hid_list"),
  open: (path) => call<number>("hid_open", { path }),
  request: async (handle, report, timeoutMs) =>
    new Uint8Array(await call<number[]>("hid_request", { handle, report: Array.from(report), timeoutMs })),
  requestMany: async (handle, reports, timeoutMs) => {
    try {
      const replies = await invoke<number[][]>("hid_request_many", {
        handle,
        reports: reports.map((r) => Array.from(r)),
        timeoutMs,
      });
      return replies.map((r) => new Uint8Array(r));
    } catch (err) {
      // hid.rs BatchFailure: { error: HidError, replies }.
      const e = (typeof err === "object" && err !== null ? err : {}) as {
        error?: unknown;
        replies?: unknown;
      };
      if (e.error !== undefined && Array.isArray(e.replies)) {
        throw new BatchError(
          hostError(e.error),
          (e.replies as number[][]).map((r) => new Uint8Array(r)),
        );
      }
      throw hostError(err);
    }
  },
  close: (handle) => call<void>("hid_close", { handle }),
  onDisconnect: (cb) => {
    let stopped = false;
    let unlisten: (() => void) | null = null;
    void listen<number>("hid-disconnected", (event) => cb(event.payload)).then((stop) => {
      if (stopped) stop();
      else unlisten = stop;
    });
    return () => {
      stopped = true;
      unlisten?.();
    };
  },
};
