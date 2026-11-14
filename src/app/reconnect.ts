// SPDX-License-Identifier: GPL-2.0-or-later
// Connecting without the device chooser (plan Phase 10, lifecycle): the
// raw-HID keyboards the browser already lets this site open
// (navigator.hid.getDevices), kept up to date as they are plugged in and out,
// and a test for "the same kind of keyboard as the one that was unplugged".

import { useEffect, useRef, useState } from "react";
import type { DeviceInfo } from "../core/transport/types.ts";
import { isRawHid } from "./connection.ts";

/**
 * The raw-HID keyboards this site may open without asking; null until known,
 * or when not enabled. `onFound` hears each fresh list (at the start and after
 * every plug and unplug), never a remembered one.
 */
export function usePermittedKeyboards(
  enabled: boolean,
  onFound?: (devices: HIDDevice[]) => void,
): HIDDevice[] | null {
  const [devices, setDevices] = useState<HIDDevice[] | null>(null);
  const latest = useRef(onFound);
  useEffect(() => {
    latest.current = onFound;
  });
  useEffect(() => {
    if (!enabled || typeof navigator === "undefined" || !("hid" in navigator)) return;
    let alive = true;
    const refresh = () =>
      void navigator.hid.getDevices().then(
        (found) => {
          if (!alive) return;
          const raw = found.filter(isRawHid);
          setDevices(raw);
          latest.current?.(raw);
        },
        () => alive && setDevices([]),
      );
    refresh();
    navigator.hid.addEventListener("connect", refresh);
    navigator.hid.addEventListener("disconnect", refresh);
    return () => {
      alive = false;
      // A list from before (say, an unplug) must not be taken as current next time.
      setDevices(null);
      navigator.hid.removeEventListener("connect", refresh);
      navigator.hid.removeEventListener("disconnect", refresh);
    };
  }, [enabled]);
  return enabled ? devices : null;
}

/** Same USB vendor and product id: the keyboard that was unplugged, plugged back in. */
export function sameKind(
  a: Pick<DeviceInfo, "vendorId" | "productId">,
  b: Pick<DeviceInfo, "vendorId" | "productId">,
) {
  return a.vendorId === b.vendorId && a.productId === b.productId;
}
