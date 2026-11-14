// SPDX-License-Identifier: GPL-2.0-or-later
// ViaLink's switch: Kumo's Switch in the accent colour. Kumo's is hard-coded
// blue when on; theme.css recolours anything with .vl-switch.

import { Switch as KumoSwitch, type SwitchProps } from "@cloudflare/kumo/components/switch";

export type { SwitchProps };

export function Switch({ className, ...props }: SwitchProps) {
  return <KumoSwitch {...props} className={[className, "vl-switch"].filter(Boolean).join(" ")} />;
}
