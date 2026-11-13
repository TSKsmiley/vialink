// SPDX-License-Identifier: GPL-2.0-or-later
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

const NO_REACT = { group: ["react", "react-dom", "react/*", "../app/*", "../../app/*"] };

// The extension modules themselves; their framework neighbours and *.api.ts stay importable.
const ONE_WAY_IN = {
  group: [
    "**/core/extensions/*",
    "!**/core/extensions/*.api.ts",
    ...["index", "types", "hooks", "services", "manifest", "state"].map((m) => `!**/core/extensions/${m}.ts`),
    "**/app/extensions/*Ui.tsx",
  ],
  message:
    "Reach an extension through the registry, a service or hook point, or its *.api.ts; not its module (one way in).",
};

const TIMER_MESSAGE = "Extensions don't run their own timers; use ctx.schedule (every, once, idle).";
const NO_TIMERS = ["setInterval", "setTimeout", "requestAnimationFrame"].map((name) => ({
  name,
  message: TIMER_MESSAGE,
}));
const NO_TIMER_PROPERTIES = ["setInterval", "setTimeout", "requestAnimationFrame"].map((property) => ({
  object: "window",
  property,
  message: TIMER_MESSAGE,
}));

export default tseslint.config(
  { ignores: ["dist", "node_modules", "scripts", ".claude", ".memory"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  // ── Import rules (plan doc, Extension API, "Rules that keep it honest") ──
  // A later block replaces an earlier block's no-restricted-imports, so each
  // block lists every pattern that applies to its files.
  {
    // The core must stay framework-free so it runs under Node and in a future desktop wrapper.
    // One way in: outside the extension folders, code reaches extensions through the
    // registry and the framework modules, or an extension's public *.api.ts.
    files: ["src/core/**/*.ts"],
    ignores: ["src/core/extensions/**", "src/core/sim/**", "**/*.test.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [NO_REACT, ONE_WAY_IN] }],
    },
  },
  {
    files: ["src/app/**/*.{ts,tsx}"],
    ignores: ["src/app/extensions/**", "**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [ONE_WAY_IN] }],
    },
  },
  {
    // Extension code: framework-free in the core; no private timers anywhere (ctx.schedule).
    files: ["src/core/extensions/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [NO_REACT] }],
      "no-restricted-globals": ["error", ...NO_TIMERS],
      "no-restricted-properties": ["error", ...NO_TIMER_PROPERTIES],
    },
  },
  {
    // Extension views get ctx, state and the UI kit; never the Keyboard.
    files: ["src/app/extensions/*Ui.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["**/core/keyboard.ts"], message: "Views use ctx, state and ui, not the Keyboard." },
          ],
        },
      ],
      "no-restricted-globals": ["error", ...NO_TIMERS],
      "no-restricted-properties": ["error", ...NO_TIMER_PROPERTIES],
    },
  },
  {
    // "Standard Vial compatible" extensions have no device access (plan doc, Extension
    // groups): they may not import the protocol either. List each one here.
    files: ["src/core/extensions/layer-sharing.ts", "src/core/extensions/layer-sharing.api.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            NO_REACT,
            {
              group: ["../protocol/*", "**/core/protocol/*"],
              message: "Compatible extensions have no device access.",
            },
          ],
        },
      ],
    },
  },
);
