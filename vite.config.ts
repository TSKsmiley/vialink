// SPDX-License-Identifier: GPL-2.0-or-later
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import { renderMarkdown } from "./src/docs/markdown.ts";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

/**
 * Docs pages: an HTML page (docs/*.html) with `<!-- vialink:markdown docs/x.md -->` gets that
 * Markdown file rendered in its place, at build time and in the dev server (which reloads the
 * page when the file changes).
 */
function docsPages(): Plugin {
  const MARKER = /<!--\s*vialink:markdown\s+(\S+)\s*-->/g;
  const root = import.meta.dirname;
  return {
    name: "vialink-docs",
    transformIndexHtml: {
      order: "pre",
      handler: (html) =>
        html.replace(MARKER, (_, file: string) => renderMarkdown(readFileSync(resolve(root, file), "utf8"))),
    },
    configureServer(server) {
      server.watcher.add(resolve(root, "docs"));
      server.watcher.on("change", (file) => {
        if (file.endsWith(".md") && file.startsWith(resolve(root, "docs")))
          server.ws.send({ type: "full-reload" });
      });
    },
  };
}

export default defineConfig(() => ({
  // The site and the desktop app both serve from their root: GitHub Pages at
  // https://vialink.dev/ (tsksmiley.github.io/vialink/ redirects there).
  base: "/",
  plugins: [react(), tailwindcss(), docsPages()],
  build: {
    rolldownOptions: {
      // The app, and the docs pages next to it (https://vialink.dev/docs/…).
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        extensions: resolve(import.meta.dirname, "docs/extensions.html"),
      },
    },
  },
  // ViaLink's version, written into .vialink files (manifest.app).
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  test: {
    // Core tests run under Node; component tests opt into jsdom with a
    // `// @vitest-environment jsdom` comment at the top of the file.
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
}));
