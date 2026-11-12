// SPDX-License-Identifier: GPL-2.0-or-later
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig(({ command, isPreview }) => ({
  // GitHub Pages serves the site from https://tsksmiley.github.io/vialink/.
  base: command === "build" || isPreview ? "/vialink/" : "/",
  plugins: [react()],
  test: {
    // Core tests run under Node; component tests opt into jsdom with a
    // `// @vitest-environment jsdom` comment at the top of the file.
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
}));
