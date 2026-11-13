// SPDX-License-Identifier: GPL-2.0-or-later
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

export default defineConfig(({ command, isPreview }) => ({
  // GitHub Pages serves the site from https://tsksmiley.github.io/vialink/.
  base: command === "build" || isPreview ? "/vialink/" : "/",
  plugins: [react(), tailwindcss()],
  // ViaLink's version, written into .vialink files (manifest.app).
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  test: {
    // Core tests run under Node; component tests opt into jsdom with a
    // `// @vitest-environment jsdom` comment at the top of the file.
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
}));
