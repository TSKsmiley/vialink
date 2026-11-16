// SPDX-License-Identifier: GPL-2.0-or-later
// Links to the docs pages the website serves next to the app (docs/*.html, rendered from
// docs/*.md at build time), and to the desktop app's downloads. The desktop app links to the
// website, since its window shows only the app.
import { isDesktop } from "./desktop.ts";

const SITE = "https://tsksmiley.github.io/vialink/";

/** The URL of a docs page, e.g. docsUrl("extensions"). */
export function docsUrl(page: "extensions"): string {
  return `${isDesktop() ? SITE : import.meta.env.BASE_URL}docs/${page}.html`;
}

/** The newest desktop app release, with its installers for each system. */
export const DESKTOP_DOWNLOADS = "https://github.com/TSKsmiley/vialink/releases/latest";

/** Vial's udev rule, which Linux needs before a browser or the desktop app may open the keyboard. */
export const VIAL_UDEV_RULE = "https://get.vial.today/manual/linux-udev.html";
