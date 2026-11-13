# ViaLink

Browser-based Vial keyboard configurator: a TypeScript port of vial-gui's protocol and keycode
logic with a React UI, talking to keyboards over WebHID.

## Design and plan

The implementation plan (milestones, phases, decisions, risks) is a claude.ai doc:
https://claude.ai/artifact/ENob8AAvsniFyrA5Jxmu65

Read it with the Claude Docs tools, not a web fetch. Update its Milestone status table and
decisions when work lands, and leave the user's own notes (such as "new extension ideas") alone.

## Session memory

`.memory/` is gitignored and holds handoffs between sessions, one file per day
(`YYYY-MM-DD-handoff.md`). Read the newest one before starting, and write a new one at the end of
a session.

## Commands

```sh
pnpm dev            # http://localhost:5173 (has a demo keyboard, no hardware needed)
pnpm test           # Vitest
pnpm check          # TypeScript (tsc -b)
pnpm lint           # ESLint
pnpm format         # Prettier
pnpm build
```

pnpm lives at `~/.local/bin/pnpm`; there is no system npm.

## Rules of the codebase

- `src/core/` never imports React or the DOM (ESLint enforces it); it runs under Node in tests.
- Every device command goes through the one `RequestQueue` per keyboard.
- Keycode tables and keyboard layouts are generated: never edit `src/core/keycodes/data/*.json` by
  hand; re-run `pnpm vial:dump <vial-gui checkout>` (both dumps; read vial-gui with `ast`, never run it).
- vial-gui's Python source is the spec. Ported files name their upstream file in the header and
  call out deviations.
  - Strict where compatibility depends on it: bytes on the wire (command layouts, byte order,
    struct sizes, status bytes) and the `.vil` format must match vial-gui, so the firmware and
    desktop Vial keep working with what ViaLink reads and writes.
  - Loose above that: UI, validation, error handling, safety checks and code structure may improve
    on vial-gui when something can be better (e.g. cancellable unlock, truncating layer names at a
    character boundary). Note each such difference in the file's header comment.
- Licences: own code `GPL-2.0-or-later`; files adapted from Vialite are `GPL-2.0-only` and listed
  in `NOTICE.md`. Keep SPDX headers and credits accurate when borrowing more.
