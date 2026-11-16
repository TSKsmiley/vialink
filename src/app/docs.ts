// SPDX-License-Identifier: GPL-2.0-or-later
// Links to the docs pages the website serves next to the app (docs/*.html, rendered from
// docs/*.md at build time). The desktop app links to the website, since its window shows only
// the app.
import { isDesktop } from "./desktop.ts";

const SITE = "https://tsksmiley.github.io/vialink/";

/** The URL of a docs page, e.g. docsUrl("extensions"). */
export function docsUrl(page: "extensions"): string {
  return `${isDesktop() ? SITE : import.meta.env.BASE_URL}docs/${page}.html`;
}
