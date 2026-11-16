// SPDX-License-Identifier: GPL-2.0-or-later
// ViaLink's button: Kumo's Button with dark text on mint primary buttons.
// Kumo forces white text on primary; ViaLink's accent needs #04201c in dark mode.

import {
  Button as KumoButton,
  LinkButton as KumoLinkButton,
  type ButtonProps,
  type LinkButtonProps,
} from "@cloudflare/kumo/components/button";
import { forwardRef } from "react";

export type { ButtonProps, LinkButtonProps };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(props, ref) {
  const { className, variant } = props;
  const extra = variant === "primary" ? "vl-on-accent" : "";
  return <KumoButton ref={ref} {...props} className={[className, extra].filter(Boolean).join(" ")} />;
});

/** A link that looks like a button, with the same primary colours as Button. */
export function LinkButton(props: LinkButtonProps) {
  const { className, variant } = props;
  const extra = variant === "primary" ? "vl-on-accent" : "";
  return <KumoLinkButton {...props} className={[className, extra].filter(Boolean).join(" ")} />;
}
