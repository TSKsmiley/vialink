// SPDX-License-Identifier: GPL-2.0-or-later
// ViaLink's button: Kumo's Button with dark text on mint primary buttons.
// Kumo forces white text on primary; ViaLink's accent needs #04201c in dark mode.

import { Button as KumoButton, type ButtonProps } from "@cloudflare/kumo/components/button";
import { forwardRef } from "react";

export type { ButtonProps };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(props, ref) {
  const { className, variant } = props;
  const extra = variant === "primary" ? "vl-on-accent" : "";
  return <KumoButton ref={ref} {...props} className={[className, extra].filter(Boolean).join(" ")} />;
});
