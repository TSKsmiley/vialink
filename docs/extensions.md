# Writing a ViaLink extension

Every feature beyond the keymap (macros, tap dance, combos, lighting, layer names, layer copy and
sharing, …) is an extension. They are all written against one API: a context (`ctx`) the
extension calls, and hooks ViaLink calls. This guide walks through that API and builds a small
extension from start to finish. The design and the reasons behind it are in the plan doc's
"Extension API" tab.

Extensions live in this repository only. Loading third-party code needs a security design first:
anything running in the page has full WebHID access.

- [The two halves](#the-two-halves)
- [Worked example: key memos](#worked-example-key-memos)
- [The core part](#the-core-part)
  - [Groups: what an extension may send](#groups-what-an-extension-may-send)
  - [probe](#probe)
  - [The context (`ctx`)](#the-context-ctx)
  - [State](#state)
  - [Background work](#background-work)
- [Manifest: dependencies, services, conflicts](#manifest-dependencies-services-conflicts)
- [Hooks](#hooks)
- [Saving to files](#saving-to-files)
- [The UI part](#the-ui-part)
- [Public API (`*.api.ts`)](#public-api-apits)
- [Rules ESLint and tests enforce](#rules-eslint-and-tests-enforce)
- [Testing](#testing)
- [Checklist](#checklist)

## The two halves

| Part          | File                            | Listed in                                             | May import                                                           |
| ------------- | ------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------- |
| Core          | `src/core/extensions/<id>.ts`   | `BUILTIN_EXTENSIONS` (`src/core/extensions/index.ts`) | core code; never React or the DOM                                    |
| UI (optional) | `src/app/extensions/<id>Ui.tsx` | `APP_EXTENSIONS` (`src/app/extensions/registry.tsx`)  | its own core part, the registry and the UI kit; never the `Keyboard` |

The core part decides whether the extension runs on the connected keyboard, holds its state and
does the reads and writes. The UI part says what to draw; ViaLink draws it, each piece inside an
error boundary, and only while the core part runs on the keyboard. The two are matched by `id`.

## Worked example: key memos

A "compatible" extension (it never talks to the keyboard) that lets the user write a memo on any
key. Keys with a memo get a dot, the key inspector gets a "Memo" tab, the memos are saved in
`.vialink` files and are undoable, and clearing a layer removes its memos in the same undo step.

`src/core/extensions/key-memos.ts`:

```ts
// SPDX-License-Identifier: GPL-2.0-or-later
// Key memos: a short note on any key. A ViaLink extra (no device access).
import { layerClear } from "../layers.ts";
import { on } from "./hooks.ts";
import type { StateHandle } from "./state.ts";
import type { KeyboardExtension } from "./types.ts";

/** Memos by key, "layer,row,col" → text. */
export type Memos = Record<string, string>;

export interface KeyMemos {
  readonly memos: StateHandle<Memos>;
}

export const keyOf = (layer: number, row: number, col: number) => `${layer},${row},${col}`;

export const keyMemosExtension: KeyboardExtension<KeyMemos> = {
  id: "key-memos",
  group: "compatible",
  name: "Key memos",
  description: "Write a short memo on any key; keys with a memo get a dot.",
  async probe(ctx) {
    return { memos: ctx.state<Memos>("memos", { default: {} }) };
  },
  hooks: [
    // A cleared layer loses its memos too, in the same undo step.
    on(layerClear.after, (e, _ctx, s: KeyMemos) => {
      const kept = Object.entries(s.memos.get()).filter(([key]) => !key.startsWith(`${e.layer},`));
      s.memos.set(Object.fromEntries(kept));
    }),
  ],
};
```

`src/app/extensions/key-memosUi.tsx`:

```tsx
// SPDX-License-Identifier: GPL-2.0-or-later
import { keyMemosExtension, keyOf, type KeyMemos } from "../../core/extensions/key-memos.ts";
import { decorations, slots, type AppExtension } from "./registry.tsx";

export const keyMemosUi: AppExtension = {
  id: keyMemosExtension.id,
  decorations: decorations<KeyMemos>({
    keycap: ({ layer, row, col }, s) => {
      const memo = s.memos.get()[keyOf(layer, row, col)];
      return memo ? { dot: true, title: memo } : null;
    },
  }),
  slots: slots<KeyMemos>({
    "keyInspector.tab": {
      title: "Memo",
      Component: ({ state, layer, keys }) => {
        if (keys.length !== 1) return <p>Select one key to write a memo.</p>;
        const key = keyOf(layer, keys[0].row, keys[0].col);
        const memos = state.memos.get();
        return (
          <textarea
            aria-label="Memo"
            value={memos[key] ?? ""}
            onChange={(e) => state.memos.set({ ...memos, [key]: e.target.value })}
          />
        );
      },
    },
  }),
};
```

Then add `keyMemosExtension` to `BUILTIN_EXTENSIONS` and `keyMemosUi` to `APP_EXTENSIONS`. That is
the whole extension: it shows up in the Extensions dialog, can be turned off there, and its memos
travel with `.vialink` files under `extensions["key-memos"].state`.

The rest of this guide explains each piece.

## The core part

A `KeyboardExtension<State>` (`src/core/extensions/types.ts`) has:

| Field                                           |                                                                                                                |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `id`                                            | Stable identifier: settings, file sections, service and hook ids all key off it. Never change it once shipped. |
| `name`, `description`                           | Shown in the Extensions dialog. Say what it does for the user.                                                 |
| `group`                                         | `"standard"`, `"compatible"` or `"nonstandard"`; see below.                                                    |
| `probe(ctx)`                                    | Returns the extension's state, or `null` when the keyboard lacks the feature.                                  |
| `firmware`                                      | `{ label, url }`: where to get firmware that supports it. Required for `"nonstandard"`.                        |
| `commands`                                      | `"nonstandard"` only: the custom commands it sends.                                                            |
| `requires`, `optional`, `conflicts`, `provides` | The manifest; see [Manifest](#manifest-dependencies-services-conflicts).                                       |
| `hooks`                                         | Handlers for hook points; see [Hooks](#hooks).                                                                 |
| `vil`, `saves`, `layoutFile`                    | File support; see [Saving to files](#saving-to-files).                                                         |

### Groups: what an extension may send

The group is shown in the Extensions dialog and decides what the extension's `ctx.device` lets
through:

- **`"standard"`**: a feature of standard Vial firmware (macros, tap dance, combos, …). It may send
  Vial's standard commands (`src/core/protocol/standard.ts`), nothing else.
- **`"compatible"`**: a ViaLink extra that works on every Vial keyboard because it has no device
  access at all: its context has no `device`. It works through `ctx.keymap`, state and hooks.
  ESLint also stops a compatible extension from importing the protocol modules; add its files
  to the compatible block in `eslint.config.js`.
- **`"nonstandard"`**: needs firmware beyond standard Vial. It may send standard commands plus the
  `commands` it declares, and must link its `firmware`. Each `CustomCommand` has a `name` and
  `kind` (`"read"`/`"write"`) for the HID log, the request's leading `bytes` that identify it, a
  `reply` decoder, and optionally `describe(request)` for a more specific log line. Its probe must
  confirm the firmware actually answers those commands (layer names checks the status byte, since
  stock Vial leaves the reply untouched).

Anything else sent through `ctx.device` throws `ExtensionCommandError` before it reaches the
keyboard.

### probe

`probe(ctx)` runs once the keymap is loaded, after the extensions it requires or optionally uses.
Return the state the rest of the extension works with (a class instance holding `ctx` is common,
see `layerNames.ts` or `alt-repeat-key.ts`), or `null` when the keyboard doesn't support the
feature: the extension then stays inactive and the Extensions dialog says so.

Reads of many entries belong in one `ctx.device.requestMany` call, not a loop of `request`: the
desktop app sends them back to back, which is much faster.

### The context (`ctx`)

Every extension gets its own context. A `"compatible"` extension gets a `HostContext`; the other
two get a `DeviceContext`, which adds `device`.

| Member                 |                                                                                                                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `board`                | Read-only facts, live: protocol versions, `rows`/`cols`/`layers`, `keys`, `encoders`, layout options, macro count and memory, `capabilities`, the `keycodes` table, `codeName(code)`.                         |
| `keymap`               | `get`/`set` keys and `getEncoder`/`setEncoder`. Writes are checked, queued and recorded for undo.                                                                                                             |
| `device`               | `request(data, options)`, `requestMany(data[], options)` and `ensureUnlocked(reason)`. Everything goes through the keyboard's one `RequestQueue`. Pass `{ priority: "low" }` for background reads.            |
| `history`              | `record(write)` after every write the user can take back (undo/redo must go through the same write method, so validation, unlock checks and the queue apply); `group(label, action)` for one undo step.       |
| `state(name, options)` | State ViaLink saves, loads and re-renders; see [State](#state).                                                                                                                                               |
| `schedule`             | `every`, `once`, `idle`; see [Background work](#background-work).                                                                                                                                             |
| `use(service)`         | Another extension's service, or `null` when nothing running provides it.                                                                                                                                      |
| `notify`               | `info(message)` and `error(message)`, shown as ViaLink's own notices. Say what happened in full.                                                                                                              |
| `ui`                   | `confirm(message)` resolves true for yes; `overlay({ anchor, title, body })` points at a named element (`"keymap.layerRail"`, `"keymap.board"`, `"keymap.keyInspector"`, `"sidebar.<view id>"`) until closed. |
| `changed()`            | Tells the UI that extension state changed (for state you keep yourself rather than in `ctx.state`).                                                                                                           |

### State

Plain variables in your state object need no API, but anything the user should get back after a
reload, in a file, or with undo goes in `ctx.state`:

```ts
const memos = ctx.state<Memos>("memos", {
  default: {},
  persist: "layout", // the default
  version: 2,
  // Turns a value saved by an older version into the current shape.
  upgrade: (old, fromVersion) => (fromVersion === 1 ? fromList(old as string[]) : {}),
});
memos.get();
memos.set(next); // re-renders the UI
```

- **`persist: "layout"`** (default): belongs to the layout. Saved in `.vialink` files, so it moves
  to other computers and comes back from backups, and every `set` is an undo step. If you are
  unsure, use this.
- **`persist: "browser"`**: a private room in this browser (`localStorage`). Not in files, not
  undoable, lost when site data is cleared. Good for view preferences.
- Bump `version` when the shape changes and give `upgrade`; a saved value newer than the
  extension, or unreadable, falls back to `default`.
- Names are scoped by extension id: an extension only ever sees its own state. The handle is the
  same on every call, with the options of the first.
- Setting state inside a `before` or `filter` hook handler throws; see [Hooks](#hooks).

### Background work

Never start your own timers (`setTimeout`, `setInterval`, `requestAnimationFrame`; ESLint refuses
them in extension code). Use `ctx.schedule`:

```ts
const task = ctx.schedule.every(1000, poll, { name: "battery", kind: "background" });
task.stop(); // see TaskHandle in src/core/scheduler.ts
```

Scheduled tasks don't pile up, pause while the tab is hidden or an operation is writing, stop when
the extension is turned off, and their device requests wait behind the user's own. `kind: "live"`
is for work a view shows as it happens (the matrix tester); everything else is `"background"`.

## Manifest: dependencies, services, conflicts

- **`requires: ["other-id"]`**: the other extension must run for this one to run. It probes first;
  without it this one stays off and the Extensions dialog says "Needs …". Turning it off turns
  this one off too, after asking.
- **`optional: ["other-id"]`**: used when it runs, fine without. It probes first.
- **`conflicts: ["other-id"]`**: can't run together. Turning this one on while the other runs asks
  to turn that one off. When both are on and supported, the one turned on most recently wins.
- **`provides: [...]`**: services and hook points this extension offers others. Their ids start
  with the extension's id (`"layer-sharing.paste"`).

### Services

A service is a typed object one extension offers others:

```ts
// in the owner (or its *.api.ts)
export const batteryLevel = defineService<{ percent(): number | null }>("battery.level");

// in the owner's manifest: built from its probe state
provides: [provide(batteryLevel, (state: Battery) => ({ percent: () => state.percent }))],

// in another extension, which lists "battery" in requires or optional
const battery = ctx.use(batteryLevel); // null when battery isn't running
```

ViaLink defines **core services** (ids starting `core.`) that any extension may provide and
ViaLink itself reads (`src/core/extensions/services.ts`):

- `keycodeDescriptions` (`core.keycode-descriptions`): explain keycodes your extension owns
  (`TD(0)`, `M3`) in the picker and key panel; `describe(code)` returns `null` for codes that
  aren't yours.
- `layerNames` (`core.layer-names`): supply layer names, optionally `rename` and `fromShared`
  (the name a copied layer carries).

## Hooks

A hook point is a named operation an owner (ViaLink's core or an extension) announces, and any
extension can join. Every operation runs in four phases:

1. **before**: handlers may veto with `event.preventDefault(reason)` or ask the user with
   `event.requireConfirm(message)`. Writing throws. Every before handler runs, so the user sees all
   reasons, and all questions are asked together.
2. **filter**: handlers adjust the plan and may add warnings: return the plan, or
   `{ plan, warnings }`. No writes.
3. **write**: ViaLink writes the plan.
4. **after**: handlers make their own writes, in the same undo step. If anything fails, the whole
   operation rolls back.

Undo and redo replay the recorded writes; they never run hooks again. Handlers run in load order
(dependencies first).

```ts
hooks: [
  on(layerClear.before, (e, ctx, s: MyState) => {
    if (s.isLocked(e.layer)) e.preventDefault(`layer ${e.layer} is locked`);
  }),
  on(layerSwap.after, async (e, ctx, s: MyState) => s.swap(e.a, e.b)),
],
```

`state` is the handling extension's own probe state; annotate its type in the handler.

Hook points today:

| Id                                                               | Owner         | Event                                 | Plan           |
| ---------------------------------------------------------------- | ------------- | ------------------------------------- | -------------- |
| `layer.clear` (`layerClear`, `src/core/layers.ts`)               | core          | `{ layer }`                           | the key writes |
| `layer.swap` (`layerSwap`, `src/core/layers.ts`)                 | core          | `{ a, b }`                            | `{ toA, toB }` |
| `layer-sharing.paste` (`paste`, `layer-sharing.api.ts`)          | layer-sharing | `{ source, target, mode, name, ext }` | the key writes |
| `layer-sharing.share-text` (`shareText`, `layer-sharing.api.ts`) | layer-sharing | `{ layer, put(value) }`               | none           |

Handling another extension's hook point needs that extension in `requires` or `optional`.

To offer a hook point, declare it once with `defineHook<Event, Plan>("<your-id>.<name>")` in your
`*.api.ts`, list it in `provides`, and run the operation through `Keyboard.runOperation` (see
`pasteLayer` in `layer-sharing.api.ts`). For collecting data from every handler without writes,
`Keyboard.collect` is what `shareData` uses.

## Saving to files

ViaLink saves `.vialink` files by default and can export and import Vial's `.vil`.

- **`ctx.state` with `persist: "layout"`** is saved automatically in the extension's section of
  the `.vialink` file, under `"state"`. Nothing else to do.
- **`saves: "layout-file"` plus `layoutFile`**: for data that lives on the keyboard (layer names
  are stored in firmware). `save(state)` returns your fields; `restore(state, data, fromVersion)`
  returns the writes needed to make the board match, each as `{ description, apply }`, shown in
  the load confirmation. Bump `version` when your fields' shape changes. The two fields go
  together (`manifest.test.ts` checks).
- **`vil`**: only for standard Vial features that desktop Vial also saves. `keys` lists the
  top-level `.vil` keys you own; `save` and `restore` must match vial-gui's format exactly, so files
  keep working in desktop Vial.

Loading a file with a section for an extension that is switched off offers a "Turn on …" button.
Sections for unknown or unsupported extensions are kept and written back on the next save.

## The UI part

An `AppExtension` (`src/app/extensions/registry.tsx`) matches its core part by `id` and may give:

- **`panels`**: whole editor views, shown as tabs next to Keymap. Each is
  `panel<State>({ id, title, Component, count?, modern? })`. The component gets `PanelProps`:
  `ctx`, `state` (the probe state), `ui` (the UI kit), and `onOpen(view)` / `onPlace(code, what)`
  to jump to another view or to put a keycode on the next key the user clicks. `count(state)` shows
  a number next to the title in the sidebar.
- **`layerCommands`**: entries for the layer card's ⋯ menu and right-click: `id`, `title`,
  optional `shortcut` (`"Ctrl+Shift+C"`; Ctrl means Cmd on a Mac), `section`, `danger`, `enabled`,
  `choices` for a submenu, and `run(layer, env, choice)`. A shortcut that is already taken (by
  ViaLink or an extension earlier in load order) is refused; the command stays in its menu without
  one, and the Extensions dialog names both extensions.
- **`decorations`**: `decorations<State>({ keycap, layerCard })`. `keycap` returns a dot and/or a
  title for a key's tooltip and accessible name; `layerCard` returns a line of text under a layer
  card's details.
- **`slots`**: `slots<State>({ ... })` fills named spots in ViaLink's screens:
  - `"keyInspector.tab"`: a tab in the selected key's panel; also gets `layer`, `keys` and
    `current`.
  - `"devicePanel.section"`: a section in the device panel, with a title.
  - `"topBar.item"`: an item in the top bar, before Extensions.

Views never get the `Keyboard`. The UI kit (`ui`) gives what they need of it:
`ui.KeyboardView` (the keyboard drawing, for picking keys), `ui.pickerInfo()` (for the keycode
picker) and `ui.placementsOf(code)` (where a keycode sits). Components that only need the keycode
table take `ctx.board.keycodes` directly.

An extension needs no UI part at all if it has nothing to draw: layer names shows its names through
the `layerNames` service, and `layerNamesUi.tsx` is just `{ id }`.

## Public API (`*.api.ts`)

Code outside `src/core/extensions/` and `src/app/extensions/` never imports an extension module.
Anything it may use (hook points, their event types, operations other code starts) goes in
`<id>.api.ts`, next to the extension. `layer-sharing.api.ts` is the example: the keymap view starts
pastes through `pasteLayer`, and layer names handles `paste` and `shareText`.

## Rules ESLint and tests enforce

- `src/core/` never imports React or the DOM.
- **One way in**: outside the extension folders, code imports only the registry, the framework
  modules (`index`, `types`, `hooks`, `services`, `manifest`, `state`) or an extension's
  `*.api.ts`.
- **Views never get the Keyboard**: `*Ui.tsx` files may not import it.
- **No timers** in extension code: use `ctx.schedule`.
- **Compatible extensions have no device access**: they may not import the protocol.
- `manifest.test.ts` checks every built-in manifest: known ids, no dependency cycles, ids of
  services and hook points prefixed with the owner's id, hook dependencies declared, groups
  consistent, `saves` and `layoutFile` together.

Run `pnpm lint` and `pnpm test` before opening a pull request.

## Testing

Core parts run under Node with the simulated keyboard (`src/core/sim/`), which answers commands
like the firmware. A typical test builds a `SimulatedKeyboard` from a fixture definition, installs
the feature's simulation if it has one, loads a `Keyboard` over a `RequestQueue` and checks the
extension through `kb.extension(yourExtension)`; see `layerNames.test.ts` and `macros.test.ts`.
UI parts are tested with Testing Library under jsdom by rendering the `Editor`; see
`alt-repeat-keyUi.test.tsx`.

A new `"compatible"` extension runs on every keyboard, so tests that list the extensions running
on stock Vial (for example in `layerNames.test.ts`) need its id added.

## Checklist

- [ ] `src/core/extensions/<id>.ts` with an SPDX header, a header comment saying what it does,
      and, for ported code, its upstream vial-gui file and any deviations.
- [ ] Added to `BUILTIN_EXTENSIONS`.
- [ ] Right `group`; `firmware` and `commands` for non-standard.
- [ ] `probe` returns `null` when the keyboard lacks the feature; bulk reads use `requestMany`.
- [ ] Every user-visible write is undoable (`ctx.keymap`, `ctx.state` or `ctx.history.record`).
- [ ] Manifest: `requires`/`optional` for every service used and hook point handled.
- [ ] Files: `ctx.state`, `layoutFile` or `vil` as fits; `.vil` output matches vial-gui.
- [ ] `src/app/extensions/<id>Ui.tsx` added to `APP_EXTENSIONS`, if it has UI.
- [ ] Anything other code needs is in `<id>.api.ts`.
- [ ] Tests for the core part (and the UI part if it has one); `pnpm check`, `pnpm lint`,
      `pnpm test` pass.
