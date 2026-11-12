// SPDX-License-Identifier: GPL-2.0-or-later
// Top bar of the app shell (design board 1): wordmark, device pill, lock
// state, Undo/Redo, Layouts, Extensions and a "More" menu with the theme
// switch and Disconnect.
//
// Phase 0 of the redesign: the device pill toggles the existing HID log (the
// device side bar comes in phase 6), and Undo/Redo stay disabled until the
// history lands in phase 1.

import {
  ArrowArcLeftIcon,
  ArrowArcRightIcon,
  CaretRightIcon,
  DotsThreeIcon,
  LockSimpleIcon,
  LockSimpleOpenIcon,
} from "@phosphor-icons/react";
import { useEffect, type ReactNode } from "react";
import type { Keyboard } from "../../core/keyboard.ts";
import { errorMessage, useKeyboardVersion } from "../hooks.ts";
import { setThemeChoice, useThemeChoice, type ThemeChoice } from "../theme.ts";
import { Button, DropdownMenu } from "../ui/index.ts";

interface Props {
  keyboard: Keyboard | null;
  /** Layout load/save menu, rendered when a keyboard is connected. */
  layouts?: ReactNode;
  showLog: boolean;
  onToggleLog: () => void;
  onExtensions: () => void;
  onDisconnect: () => void;
  onError: (message: string) => void;
}

export function TopBar({
  keyboard,
  layouts,
  showLog,
  onToggleLog,
  onExtensions,
  onDisconnect,
  onError,
}: Props) {
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-kumo-line bg-kumo-elevated px-4 py-3 md:px-5">
      <strong className="text-[17px] tracking-tight">ViaLink</strong>
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
      {keyboard && <HistoryButtons />}
      {keyboard && layouts}
      <Button onClick={onExtensions}>Extensions</Button>
      <DropdownMenu>
        <DropdownMenu.Trigger render={<Button shape="square" icon={DotsThreeIcon} aria-label="More" />} />
        <DropdownMenu.Content>
          <ThemeItems />
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
      title="HID log"
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

/** Undo and Redo: placeholders until the history (phase 1) exists. */
function HistoryButtons() {
  return (
    <div role="group" aria-label="History" className="inline-flex items-center gap-1">
      <Button icon={ArrowArcLeftIcon} disabled title="Nothing to undo (Ctrl+Z)">
        <span className="max-sm:sr-only">Undo</span>
      </Button>
      <Button
        shape="square"
        icon={ArrowArcRightIcon}
        disabled
        aria-label="Redo"
        title="Nothing to redo (Ctrl+Shift+Z)"
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
  return keyboard.unlocked ? (
    <Button
      variant="ghost"
      icon={LockSimpleOpenIcon}
      onClick={() => void keyboard.lock().catch((e) => onError(errorMessage(e)))}
      title="The keyboard is unlocked. Click to lock it again."
    >
      Unlocked
    </Button>
  ) : (
    <Button
      variant="ghost"
      icon={LockSimpleIcon}
      onClick={() => void keyboard.ensureUnlocked("Unlocking").catch(() => undefined)}
      title="The keyboard is locked. Click to unlock it."
    >
      Locked
    </Button>
  );
}
