// SPDX-License-Identifier: GPL-2.0-or-later
// Matrix tester, after vial-gui's editor/matrix_test.py: while the board is
// unlocked, poll the switch matrix and light up keys that are down now and
// keys that have been pressed at least once. Like vial-gui (grabKeyboard while
// the tab is shown), the page ignores key presses while testing, so Tab, Space,
// arrows or Ctrl+Z don't move focus, scroll or undo.
// Deviations:
// - capturing can be switched off, and holding Esc switches it off, so someone
//   using only the keyboard can leave the tester;
// - a page can't stop the browser's and the system's own shortcuts (Ctrl+W,
//   Alt+Tab, the Super key); Full screen asks the browser for them too
//   (Keyboard Lock API, Chromium only, page-requested full screen only), and
//   leaving capture leaves it;
// - progress (tested of all keys), the keys not tested yet by name, and the
//   recent presses with their matrix row and column and how long they were held.

import {
  ArrowCounterClockwiseIcon,
  CornersInIcon,
  CornersOutIcon,
  KeyboardIcon,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { Keyboard } from "../../core/keyboard.ts";
import { errorMessage, useKeyboardVersion } from "../hooks.ts";
import { Button, Switch } from "../ui/index.ts";
import { KeyboardView } from "./KeyboardView.tsx";

interface Props {
  keyboard: Keyboard;
  onError: (message: string) => void;
  /** Delay between polls; vial-gui uses a 20 ms timer. */
  intervalMs?: number;
  /** How long Esc must be held to stop capturing keys. */
  releaseHoldMs?: number;
}

const KEY_EVENTS = ["keydown", "keyup", "keypress"] as const;
/** How many presses the Recent presses list keeps. */
const RECENT = 6;

/** navigator.keyboard (Keyboard Lock API); not in TypeScript's DOM types. */
interface KeyboardLock {
  lock(keyCodes?: string[]): Promise<void>;
  unlock(): void;
}

const keyboardLock = (): KeyboardLock | undefined =>
  (navigator as Navigator & { keyboard?: Partial<KeyboardLock> }).keyboard?.lock
    ? (navigator as Navigator & { keyboard: KeyboardLock }).keyboard
    : undefined;

const canLockSystemKeys = () => document.fullscreenEnabled === true && keyboardLock() !== undefined;

interface Press {
  id: string;
  row: number;
  col: number;
  at: number;
  /** How long it was held; null while it is still down. */
  ms: number | null;
}

export function MatrixTester({ keyboard, onError, intervalMs = 30, releaseHoldMs = 1500 }: Props) {
  useKeyboardVersion(keyboard);
  const [pressed, setPressed] = useState<Set<string>>(new Set());
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [recent, setRecent] = useState<Press[]>([]);
  const [capturing, setCapturing] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const section = useRef<HTMLElement>(null);
  const unlocked = keyboard.unlocked === true;
  const capture = unlocked && capturing && keyboard.matrixTesterSupported;

  useEffect(() => {
    if (!capture) return;
    let escHeld: number | undefined;
    // Window, capture phase: runs before every other key handler on the page.
    const swallow = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key !== "Escape") return;
      if (e.type === "keydown" && !e.repeat) {
        window.clearTimeout(escHeld);
        escHeld = window.setTimeout(() => setCapturing(false), releaseHoldMs);
      } else if (e.type === "keyup") {
        window.clearTimeout(escHeld);
      }
    };
    for (const type of KEY_EVENTS) window.addEventListener(type, swallow, true);
    return () => {
      window.clearTimeout(escHeld);
      for (const type of KEY_EVENTS) window.removeEventListener(type, swallow, true);
    };
  }, [capture, releaseHoldMs]);

  useEffect(() => {
    const onChange = () => {
      const ours = document.fullscreenElement !== null && document.fullscreenElement === section.current;
      setFullscreen(ours);
      if (!ours) keyboardLock()?.unlock();
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      keyboardLock()?.unlock(); // the browser leaves full screen when the section goes
    };
  }, []);

  useEffect(() => {
    if (fullscreen && !capture) void document.exitFullscreen().catch(() => undefined);
  }, [fullscreen, capture]);

  const enterFullscreen = async () => {
    setCapturing(true);
    try {
      await section.current?.requestFullscreen();
      await keyboardLock()?.lock();
    } catch (err) {
      onError(errorMessage(err));
    }
  };

  useEffect(() => {
    if (!keyboard.matrixTesterSupported) return;
    if (keyboard.unlocked === null) void keyboard.isUnlocked().catch(() => undefined);
  }, [keyboard]);

  // Presses, newest first, and the keys down now: refs, so the poller sees the latest.
  const presses = useRef<Press[]>([]);
  const down = useRef(new Map<string, Press>());

  useEffect(() => {
    if (!unlocked || !keyboard.matrixTesterSupported) return;
    // On the keyboard's scheduler: no pile-up, pauses while the tab is hidden or
    // an operation writes, and its polls go behind the user's own requests.
    const task = keyboard.scheduler.every(
      intervalMs,
      async () => {
        try {
          const matrix = await keyboard.pollMatrix({ priority: "low" });
          if (matrix === null) {
            task.stop();
            keyboard.setUnlocked(false); // locked elsewhere (replug, Lock)
            return;
          }
          const at = performance.now();
          const now = new Set<string>();
          matrix.forEach((row, r) => row.forEach((on, c) => on && now.add(`${r},${c}`)));
          let changed = false;
          for (const id of now) {
            if (down.current.has(id)) continue;
            const [row, col] = id.split(",").map(Number);
            const press: Press = { id, row, col, at, ms: null };
            down.current.set(id, press);
            presses.current = [press, ...presses.current].slice(0, RECENT);
            changed = true;
          }
          for (const [id, press] of down.current) {
            if (now.has(id)) continue;
            down.current.delete(id);
            const ms = Math.round(at - press.at);
            presses.current = presses.current.map((p) => (p === press ? { ...p, ms } : p));
            changed = true;
          }
          if (changed) setRecent(presses.current);
          setPressed(now);
          if (now.size > 0) setSeen((prev) => (hasAll(prev, now) ? prev : new Set([...prev, ...now])));
        } catch (err) {
          task.stop();
          onError(errorMessage(err));
        }
      },
      { name: "matrix tester", kind: "live", owner: "app" },
    );
    return () => task.stop();
  }, [keyboard, unlocked, intervalMs, onError]);

  const startOver = () => {
    setSeen(new Set());
    presses.current = [];
    down.current.clear();
    setRecent([]);
  };

  if (!keyboard.matrixTesterSupported) {
    return (
      <section aria-label="Matrix tester" className="flex max-w-2xl flex-col gap-1">
        <h1 className="m-0 text-xl font-semibold">Matrix tester</h1>
        <p className="m-0 text-sm text-kumo-subtle">
          The matrix tester needs Vial protocol 3 or later and a matrix small enough for one HID report; this
          keyboard has neither.
        </p>
      </section>
    );
  }

  const positions = keyboard.matrixPositions;
  const total = positions.length;
  const tested = positions.filter((p) => seen.has(`${p.row},${p.col}`)).length;
  const name = (row: number, col: number) => keyName(keyboard, row, col);
  const untested = positions.filter((p) => !seen.has(`${p.row},${p.col}`));
  const untestedNames = untested.map((p) => name(p.row, p.col));
  const hasKnobs = keyboard.encoders.length > 0;

  return (
    <section
      ref={section}
      aria-label="Matrix tester"
      // Fills the editor area edge to edge (cancelling its padding), so the side
      // panel runs down the right edge as in the design.
      className="matrix-tester -m-4 flex min-w-0 flex-1 flex-col bg-kumo-canvas md:-m-5 xl:flex-row"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 md:p-6">
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-1">
            <h1 className="m-0 text-xl font-semibold">Matrix tester</h1>
            <p className="m-0 text-sm leading-snug text-kumo-subtle">
              Press every key once. A key lights up while you hold it and stays marked once it has worked.
            </p>
          </div>
          {unlocked && (
            <div className="flex items-center gap-3.5">
              <div className="flex w-52 flex-col gap-1.5">
                <span className="flex justify-between gap-2 text-sm">
                  <strong className="font-semibold">
                    {tested} of {total} tested
                  </strong>
                  <span className="text-kumo-subtle">
                    {tested === total ? "All done" : `${total - tested} to go`}
                  </span>
                </span>
                <div
                  role="progressbar"
                  aria-label="Keys tested"
                  aria-valuemin={0}
                  aria-valuemax={total}
                  aria-valuenow={tested}
                  className="h-1.5 overflow-hidden rounded-full bg-kumo-line"
                >
                  <div
                    className="h-full rounded-full bg-success transition-[width]"
                    style={{ width: `${total === 0 ? 0 : (tested / total) * 100}%` }}
                  />
                </div>
              </div>
              <Button
                icon={ArrowCounterClockwiseIcon}
                onClick={startOver}
                disabled={seen.size === 0 && recent.length === 0}
              >
                Start over
              </Button>
            </div>
          )}
        </div>

        {unlocked ? (
          <CaptureBanner
            capturing={capturing}
            fullscreen={fullscreen}
            canFullscreen={canLockSystemKeys()}
            onCapture={setCapturing}
            onFullscreen={() => void enterFullscreen()}
            onExitFullscreen={() => void document.exitFullscreen().catch(() => undefined)}
          />
        ) : (
          <div className="flex flex-wrap items-center gap-3.5 rounded-xl border border-kumo-line bg-kumo-elevated px-4 py-3">
            <p className="m-0 flex-[1_1_320px] text-sm">
              The keyboard must be unlocked to read its switch matrix.
            </p>
            <Button
              variant="primary"
              onClick={() =>
                void keyboard.ensureUnlocked("The matrix tester").catch((e) => onError(errorMessage(e)))
              }
            >
              Unlock
            </Button>
          </div>
        )}

        <div className="flex min-w-0 flex-col gap-3">
          <div className="board-wrap matrix-board rounded-xl border border-kumo-line bg-kumo-elevated p-3 md:px-5 md:pt-8 md:pb-7">
            <KeyboardView
              keyboard={keyboard}
              layer={0}
              label="Matrix tester"
              highlight={(r, c) => {
                const id = `${r},${c}`;
                if (pressed.has(id)) return "held";
                if (seen.has(id)) return "tested";
                return null;
              }}
              tick={(r, c) => seen.has(`${r},${c}`) && !pressed.has(`${r},${c}`)}
            />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-kumo-subtle">
            <Swatch className="border-(--key-stroke) bg-(--key)">Not tested yet</Swatch>
            <Swatch className="border-accent-link bg-accent">Held now</Swatch>
            <Swatch className="border-success bg-success-tint">Tested</Swatch>
            {hasKnobs && (
              <Swatch className="rounded-full border-dashed border-kumo-line">
                Knob turns aren&apos;t in the switch matrix: press the knob to test it
              </Swatch>
            )}
          </div>
        </div>
      </div>

      {unlocked && (
        <aside
          aria-label="Test details"
          className="flex min-w-0 flex-col gap-7 border-t border-kumo-line bg-kumo-elevated px-5 py-6 xl:w-80 xl:shrink-0 xl:border-t-0 xl:border-l"
        >
          <section aria-labelledby="mt-untested" className="flex flex-col gap-2.5">
            <div className="flex items-baseline justify-between">
              <h2 id="mt-untested" className={HEADING}>
                Not tested yet
              </h2>
              <span className="text-xs text-kumo-subtle">{untested.length}</span>
            </div>
            {untested.length === 0 ? (
              <p className="m-0 text-sm">Every key has worked.</p>
            ) : (
              <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                {untested.map((p, i) => {
                  const label = untestedNames[i];
                  const twin = untestedNames.indexOf(label) !== untestedNames.lastIndexOf(label);
                  return (
                    <li
                      key={`${p.row},${p.col}`}
                      title={`Row ${p.row}, column ${p.col}`}
                      className="rounded-md border border-kumo-line bg-kumo-control px-2 py-1 text-xs"
                    >
                      {label}
                      {twin && (
                        <span className="ml-1 font-mono text-kumo-subtle">
                          {p.row},{p.col}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section aria-labelledby="mt-recent" className="flex flex-col gap-2.5">
            <h2 id="mt-recent" className={HEADING}>
              Recent presses
            </h2>
            {recent.length === 0 ? (
              <p className="m-0 text-sm text-kumo-subtle">Nothing pressed yet.</p>
            ) : (
              <ol className="m-0 flex list-none flex-col p-0">
                {recent.map((p) => (
                  <li
                    key={`${p.id}@${p.at}`}
                    className="grid grid-cols-[minmax(3.5rem,auto)_minmax(0,1fr)_auto] items-center gap-2.5 border-t border-kumo-line py-2"
                  >
                    <strong className="max-w-28 truncate font-semibold">{name(p.row, p.col)}</strong>
                    <span className="font-mono text-xs text-kumo-subtle">
                      row {p.row} · col {p.col}
                    </span>
                    {p.ms === null ? (
                      <span className="text-xs font-semibold text-accent-link">held now</span>
                    ) : (
                      <span className="text-xs text-kumo-subtle tabular-nums">{p.ms} ms</span>
                    )}
                  </li>
                ))}
              </ol>
            )}
            <p className="m-0 text-xs leading-snug text-kumo-subtle">
              Row and column are the switch&apos;s place in the keyboard&apos;s wiring, useful when a key
              doesn&apos;t register. Hold times are rounded to the {intervalMs} ms check.
            </p>
          </section>
        </aside>
      )}
    </section>
  );
}

const HEADING = "m-0 text-[13px] font-semibold tracking-[0.06em] text-kumo-subtle uppercase";

interface BannerProps {
  capturing: boolean;
  fullscreen: boolean;
  canFullscreen: boolean;
  onCapture(on: boolean): void;
  onFullscreen(): void;
  onExitFullscreen(): void;
}

function CaptureBanner({
  capturing,
  fullscreen,
  canFullscreen,
  onCapture,
  onFullscreen,
  onExitFullscreen,
}: BannerProps) {
  const Icon = fullscreen ? CornersOutIcon : KeyboardIcon;
  const esc = <kbd className="rounded border border-current px-1 font-mono text-[11px]">Esc</kbd>;
  return (
    <div
      className={
        "flex flex-wrap items-center gap-3.5 rounded-xl border px-4 py-3 " +
        (capturing ? "border-accent/40 bg-accent-tint" : "border-kumo-line bg-kumo-elevated")
      }
    >
      <span
        aria-hidden="true"
        className={
          "grid size-9 shrink-0 place-items-center rounded-lg " +
          (capturing ? "bg-accent/20 text-accent-link" : "bg-kumo-control text-kumo-subtle")
        }
      >
        <Icon size={18} />
      </span>
      <div aria-live="polite" className="flex min-w-0 flex-[1_1_360px] flex-col gap-0.5">
        {fullscreen ? (
          <>
            <strong className="font-semibold">Full screen: every key reaches only the tester</strong>
            <span className="text-sm leading-snug text-accent-link">
              Super and Alt+Tab are caught too. Hold {esc} to leave full screen.
            </span>
          </>
        ) : capturing ? (
          <>
            <strong className="font-semibold">Your keys only reach the tester</strong>
            <span className="text-sm leading-snug text-accent-link">
              Tab, Space and shortcuts do nothing on the page while you test. Super and Alt+Tab still reach
              your system{canFullscreen ? ": use Full screen to catch those too" : ""}. Hold {esc} to stop.
            </span>
          </>
        ) : (
          <>
            <strong className="font-semibold">Keys also reach the page</strong>
            <span className="text-sm leading-snug text-kumo-subtle">
              Presses still light up here, but Tab, Space and shortcuts work on the page too.
            </span>
          </>
        )}
      </div>
      {fullscreen ? (
        <Button variant="outline" icon={CornersInIcon} onClick={onExitFullscreen}>
          Exit full screen
        </Button>
      ) : (
        <>
          {capturing && canFullscreen && (
            <Button
              variant="outline"
              icon={CornersOutIcon}
              onClick={onFullscreen}
              title="Also catches Super and Alt+Tab"
            >
              Full screen
            </Button>
          )}
          <Switch label="Capture keys" checked={capturing} onCheckedChange={onCapture} />
        </>
      )}
    </div>
  );
}

function Swatch({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className={`size-3 shrink-0 rounded-[3px] border ${className}`} />
      {children}
    </span>
  );
}

/** A key's name for lists: its label on layer 0, on one line; "Empty" for KC_NO. */
function keyName(keyboard: Keyboard, row: number, col: number): string {
  const code = keyboard.getKey(0, row, col) ?? 0;
  if (code === 0) return "Empty";
  const label = keyboard.keycodes.label(code);
  const text = [label.text.replace(/\n+/g, " "), label.inner].filter(Boolean).join(" ").trim();
  return text || keyboard.keycodes.serialize(code);
}

function hasAll(set: Set<string>, items: Set<string>): boolean {
  for (const i of items) if (!set.has(i)) return false;
  return true;
}
