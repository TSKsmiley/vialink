// SPDX-License-Identifier: GPL-2.0-or-later
// Top bar of the app shell (design board 1): logo, device pill, lock
// state, Undo/Redo, Layouts, Extensions and a "More" menu with the theme
// switch and Disconnect. Clicking the logo disconnects too, back to the start
// screen, as a site's logo goes home.
//
// The device pill opens the device side bar with the HID log (DevicePanel).
// The bar stays at the top while the page scrolls, and publishes its height
// as --vl-top-bar so the device panel can sit right under it.

import {
  ArrowArcLeftIcon,
  ArrowArcRightIcon,
  CaretRightIcon,
  DotsThreeIcon,
  LockSimpleIcon,
  LockSimpleOpenIcon,
} from "@phosphor-icons/react";
import { useEffect, useRef, type ReactNode } from "react";
import type { Keyboard } from "../../core/keyboard.ts";
import { errorMessage, useKeyboardVersion } from "../hooks.ts";
import { KEYBOARD_LAYOUTS } from "../../core/keycodes/keymaps.ts";
import { setKeyboardLayout, useKeyboardLayout } from "../keyboardLayout.ts";
import { setThemeChoice, useThemeChoice, type ThemeChoice } from "../theme.ts";
import { ExtensionSlot } from "../extensions/ExtensionSlot.tsx";
import { Button, DropdownMenu } from "../ui/index.ts";
import type { HistoryControls } from "./useHistory.ts";
import type { Updater } from "../updates.ts";
import { useUpdater } from "./useUpdater.ts";
import { Logo } from "./Logo.tsx";

interface Props {
  keyboard: Keyboard | null;
  history: HistoryControls;
  /** Layout load/save menu, rendered when a keyboard is connected. */
  layouts?: ReactNode;
  showLog: boolean;
  onToggleLog: () => void;
  onExtensions: () => void;
  onDisconnect: () => void;
  onError: (message: string) => void;
  /** The desktop app's updater; null in the browser. */
  updater?: Updater | null;
}

export function TopBar({
  keyboard,
  history,
  layouts,
  showLog,
  onToggleLog,
  onExtensions,
  onDisconnect,
  onError,
  updater = null,
}: Props) {
  const bar = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = bar.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement;
    const publish = () => root.style.setProperty("--vl-top-bar", `${el.offsetHeight}px`);
    publish();
    const watch = new ResizeObserver(publish);
    watch.observe(el);
    return () => {
      watch.disconnect();
      root.style.removeProperty("--vl-top-bar");
    };
  }, []);
  return (
    <header
      ref={bar}
      className="sticky top-0 z-20 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-kumo-line bg-kumo-elevated px-4 py-3 md:px-5"
    >
      {keyboard ? (
        <button
          type="button"
          onClick={onDisconnect}
          title="Disconnect and go back to the start screen"
          className="flex cursor-pointer items-center gap-2 rounded-md text-[17px] font-bold tracking-tight hover:text-accent-link"
        >
          <Logo />
          ViaLink
        </button>
      ) : (
        <span className="flex items-center gap-2 text-[17px] font-bold tracking-tight">
          <Logo />
          ViaLink
        </span>
      )}
      {keyboard ? (
        <>
          <DevicePill keyboard={keyboard} pressed={showLog} onClick={onToggleLog} />
          <LockControls keyboard={keyboard} onError={onError} />
        </>
      ) : (
        <Button variant="ghost" size="sm" aria-pressed={showLog} onClick={onToggleLog}>
          HID log
        </Button>
      )}
      <div className="flex-1" />
      {keyboard && <HistoryButtons controls={history} />}
      {keyboard && layouts}
      {keyboard && <ExtensionSlot keyboard={keyboard} name="topBar.item" />}
      <Button onClick={onExtensions}>Extensions</Button>
      <DropdownMenu>
        <DropdownMenu.Trigger render={<Button shape="square" icon={DotsThreeIcon} aria-label="More" />} />
        <DropdownMenu.Content>
          <ThemeItems />
          <DropdownMenu.Separator />
          <KeyboardLayoutItems />
          {updater && <UpdateItems updater={updater} />}
          {keyboard && (
            <>
              <DropdownMenu.Separator />
              <DropdownMenu.Item onClick={onDisconnect}>Disconnect</DropdownMenu.Item>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu>
    </header>
  );
}

/**
 * The layout the user types with (vial-gui: View > Keyboard layout). Relabels key caps only, so it
 * is shown even without a keyboard.
 */
function KeyboardLayoutItems() {
  const layout = useKeyboardLayout();
  return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger>
        <span className="flex flex-col">
          Keyboard layout
          <span className="text-xs text-kumo-subtle">
            {layout.name === "QWERTY" ? "US (QWERTY)" : layout.name}
          </span>
        </span>
      </DropdownMenu.SubTrigger>
      <DropdownMenu.SubContent className="max-h-[70vh] overflow-y-auto">
        <DropdownMenu.RadioGroup value={layout.name} onValueChange={(v: string) => setKeyboardLayout(v)}>
          <DropdownMenu.Label>Your computer's layout</DropdownMenu.Label>
          {KEYBOARD_LAYOUTS.map((l) => (
            <DropdownMenu.RadioItem key={l.name} value={l.name} closeOnClick={false}>
              {l.name === "QWERTY" ? "US (QWERTY)" : l.name}
              <DropdownMenu.RadioItemIndicator />
            </DropdownMenu.RadioItem>
          ))}
        </DropdownMenu.RadioGroup>
      </DropdownMenu.SubContent>
    </DropdownMenu.Sub>
  );
}

/** Desktop app only, in builds that can update themselves. */
function UpdateItems({ updater }: { updater: Updater }) {
  useUpdater(updater);
  if (!updater.enabled) return null;
  const ready = updater.readyInBackground;
  // A menu label must sit in a group: Base UI throws otherwise, and that
  // took the whole app down when the menu opened (TopBar.test.tsx).
  return (
    <>
      <DropdownMenu.Separator />
      <DropdownMenu.Group>
        <DropdownMenu.Label>ViaLink {__APP_VERSION__}</DropdownMenu.Label>
        {ready ? (
          <DropdownMenu.Item onClick={() => updater.showReady()}>
            Restart to update to {ready}
          </DropdownMenu.Item>
        ) : (
          <DropdownMenu.Item onClick={() => void updater.check(true)}>Check for updates</DropdownMenu.Item>
        )}
        <DropdownMenu.CheckboxItem
          checked={updater.autoCheck}
          onCheckedChange={(on: boolean) => updater.setAutoCheck(on)}
          closeOnClick={false}
        >
          Check for updates at launch
        </DropdownMenu.CheckboxItem>
      </DropdownMenu.Group>
    </>
  );
}

function ThemeItems() {
  const choice = useThemeChoice();
  const options: { value: ThemeChoice; label: string }[] = [
    { value: "system", label: "Same as system" },
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
  ];
  return (
    <DropdownMenu.RadioGroup value={choice} onValueChange={(v: ThemeChoice) => setThemeChoice(v)}>
      <DropdownMenu.Label>Theme</DropdownMenu.Label>
      {options.map((o) => (
        <DropdownMenu.RadioItem key={o.value} value={o.value} closeOnClick={false}>
          {o.label}
          <DropdownMenu.RadioItemIndicator />
        </DropdownMenu.RadioItem>
      ))}
    </DropdownMenu.RadioGroup>
  );
}

/** Keyboard name and protocol; opens the HID log. Green dot = connected. */
function DevicePill({
  keyboard,
  pressed,
  onClick,
}: {
  keyboard: Keyboard;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      title="Device details and HID log"
      onClick={onClick}
      className="inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-full border border-kumo-line bg-kumo-control px-3 py-1.5 hover:bg-kumo-tint aria-pressed:border-accent"
    >
      <span className="size-2 rounded-full bg-connected" aria-hidden="true" />
      <span>{keyboard.name}</span>
      {keyboard.vialProtocol >= 0 && <span className="text-kumo-subtle">Vial {keyboard.vialProtocol}</span>}
      <CaretRightIcon aria-hidden="true" className="text-kumo-subtle" size={12} />
    </button>
  );
}

/** Undo and Redo, labelled with what they would change. */
function HistoryButtons({ controls }: { controls: HistoryControls }) {
  return (
    <div role="group" aria-label="History" className="inline-flex items-center gap-1">
      <Button
        icon={ArrowArcLeftIcon}
        disabled={!controls.canUndo}
        aria-label={controls.undoLabel ? `Undo: ${controls.undoLabel}` : "Undo"}
        title={controls.undoLabel ? `Undo: ${controls.undoLabel} (Ctrl+Z)` : "Nothing to undo (Ctrl+Z)"}
        onClick={controls.undo}
      >
        <span className="max-sm:sr-only">Undo</span>
      </Button>
      <Button
        shape="square"
        icon={ArrowArcRightIcon}
        disabled={!controls.canRedo}
        aria-label={controls.redoLabel ? `Redo: ${controls.redoLabel}` : "Redo"}
        title={
          controls.redoLabel ? `Redo: ${controls.redoLabel} (Ctrl+Shift+Z)` : "Nothing to redo (Ctrl+Shift+Z)"
        }
        onClick={controls.redo}
      />
    </div>
  );
}

/** Lock state with Unlock/Lock actions (vial-gui's Security menu). */
function LockControls({ keyboard, onError }: { keyboard: Keyboard; onError: (m: string) => void }) {
  useKeyboardVersion(keyboard);
  useEffect(() => {
    if (keyboard.unlocked === null) void keyboard.isUnlocked().catch(() => undefined);
  }, [keyboard]);
  if (keyboard.vialProtocol < 0 || keyboard.unlocked === null) return null;
  if (keyboard.insecure && keyboard.unlocked) {
    // VIAL_INSECURE firmware ignores Lock, so there is nothing to click.
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2 text-sm text-kumo-subtle"
        title="This keyboard's firmware was built with VIAL_INSECURE: it is always unlocked and can't be locked. Rebuild it without VIAL_INSECURE to use Vial's unlock keys."
      >
        <LockSimpleOpenIcon aria-hidden="true" />
        Always unlocked
      </span>
    );
  }
  return keyboard.unlocked ? (
    <Button
      variant="ghost"
      icon={LockSimpleOpenIcon}
      onClick={() => void keyboard.lock().catch((e) => onError(errorMessage(e)))}
      title="The keyboard is unlocked. Click to lock it again (not part of undo)."
    >
      Unlocked
    </Button>
  ) : (
    <Button
      variant="ghost"
      icon={LockSimpleIcon}
      onClick={() => void keyboard.ensureUnlocked("Unlocking").catch(() => undefined)}
      title="The keyboard is locked. Click to unlock it (not part of undo)."
    >
      Locked
    </Button>
  );
}
