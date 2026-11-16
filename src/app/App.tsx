// SPDX-License-Identifier: GPL-2.0-or-later
import { useCallback, useEffect, useRef, useState } from "react";
import type { LoadProgress } from "../core/keyboard.ts";
import type { NativeKeyboard } from "../core/transport/native.ts";
import type { RequestQueue } from "../core/transport/queue.ts";
import {
  connect,
  demoTransport,
  listNativeKeyboards,
  nativeTransport,
  NoDeviceSelectedError,
  requestDevice,
  webHidSupported,
  webHidTransport,
  type Connection,
  type ConnectTarget,
} from "./connection.ts";
import { isDesktop, tauriUpdater } from "./desktop.ts";
import { browserPrefs, Updater } from "./updates.ts";
import { WarningIcon } from "@phosphor-icons/react";
import { Editor } from "./components/Editor.tsx";
import { ConfirmDialog } from "./components/ConfirmDialog.tsx";
import { ExtensionOverlays } from "./extensions/ExtensionSlot.tsx";
import { ExtensionsDialog } from "./components/ExtensionsDialog.tsx";
import { UnlockDialog } from "./components/UnlockDialog.tsx";
import { VilControls } from "./components/VilControls.tsx";
import {
  enabledExtensions,
  extensionBrowserStorage,
  extensionRecency,
  loadDisabledExtensions,
  markTurnedOn,
  saveDisabledExtensions,
} from "./extensions/registry.tsx";
import { planTurnOnFor, switchedOff, switchesFor } from "./extensions/switches.ts";
import { errorMessage } from "./hooks.ts";
import { useKeyboardLayoutLabels } from "./keyboardLayout.ts";
import { DevicePanel } from "./shell/DevicePanel.tsx";
import { SidePanelTaken } from "./shell/sidePanelSlot.ts";
import { TopBar } from "./shell/TopBar.tsx";
import { UndoToast } from "./shell/UndoToast.tsx";
import { UpdateNotice } from "./shell/UpdateNotice.tsx";
import { useHistory } from "./shell/useHistory.ts";
import { docsUrl } from "./docs.ts";
import { Banner, Button, TooltipProvider } from "./ui/index.ts";
import { BUILTIN_EXTENSIONS } from "../core/extensions/index.ts";

/** The desktop app's updater (offered, never forced); none in the browser. */
const updater = isDesktop() ? new Updater(tauriUpdater, browserPrefs) : null;
/** The quiet update check waits this long after launch, so it never competes with startup. */
const UPDATE_CHECK_DELAY_MS = 5000;

type Status =
  | { kind: "idle" }
  | { kind: "connecting"; progress: LoadProgress | null }
  | { kind: "connected"; connection: Connection };

export function App() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [queue, setQueue] = useState<RequestQueue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  /** A layout restore from the Layouts menu is writing to the board. */
  const [restoring, setRestoring] = useState(false);
  const [showExtensions, setShowExtensions] = useState(false);
  const [disabledExtensions, setDisabledExtensions] = useState(loadDisabledExtensions);
  const [confirmRequest, setConfirmRequest] = useState<{
    messages: readonly string[];
    resolve: (ok: boolean) => void;
  } | null>(null);
  const [unlockRequest, setUnlockRequest] = useState<{
    reason: string;
    resolve: (ok: boolean) => void;
  } | null>(null);

  const start = useCallback(
    async (target: ConnectTarget) => {
      setError(null);
      setNotice(null);
      try {
        const transport =
          target.kind === "demo"
            ? await demoTransport()
            : target.kind === "native"
              ? nativeTransport(target.device)
              : webHidTransport(await requestDevice());
        setStatus({ kind: "connecting", progress: null });
        // At most one progress render per frame: a render after every request
        // delays the next one past its USB frame and nearly doubles the load.
        const progress = latestPerFrame((p: LoadProgress) => setStatus({ kind: "connecting", progress: p }));
        let connection: Connection;
        try {
          connection = await connect(transport, {
            demo: target.kind === "demo",
            onQueue: setQueue,
            onProgress: progress.push,
            extensions: enabledExtensions(disabledExtensions),
            recency: extensionRecency,
            browserStorage: extensionBrowserStorage,
          });
        } finally {
          progress.cancel();
        }
        const kb = connection.keyboard;
        kb.notifyHandler = (kind, message) => (kind === "error" ? setError(message) : setNotice(message));
        kb.confirmHandler = (messages) =>
          new Promise<boolean>((resolve) => setConfirmRequest({ messages, resolve }));
        kb.unlockHandler = (reason) =>
          new Promise<boolean>((resolve) => setUnlockRequest({ reason, resolve }));
        setStatus({ kind: "connected", connection });
        // vial-gui finishes an unlock that was started and never completed before
        // doing anything else; offer the same, but let the user cancel.
        const unlock = await kb.unlockStatus().catch(() => null);
        if (unlock?.inProgress && !unlock.unlocked) {
          void kb.ensureUnlocked("Finishing an unlock that was started earlier").catch(() => undefined);
        }
      } catch (err) {
        setStatus({ kind: "idle" });
        if (
          err instanceof NoDeviceSelectedError ||
          (err instanceof DOMException && err.name === "NotFoundError")
        )
          return;
        setError(errorMessage(err));
      }
    },
    [disabledExtensions],
  );

  useEffect(() => {
    void updater?.start(UPDATE_CHECK_DELAY_MS);
  }, []);

  // The desktop app connects on its own when exactly one keyboard is plugged
  // in, so launching it goes straight to the keymap. Only once per launch: after
  // an unplug or a disconnect the connect screen stays put.
  const autoConnectTried = useRef(false);
  useEffect(() => {
    if (!isDesktop() || autoConnectTried.current) return;
    autoConnectTried.current = true;
    void listNativeKeyboards().then(
      (found) => {
        if (found.length === 1) void start({ kind: "native", device: found[0] });
      },
      () => undefined,
    );
  }, [start]);

  const disconnect = useCallback(async () => {
    if (status.kind === "connected") await status.connection.queue.close().catch(() => undefined);
    setStatus({ kind: "idle" });
  }, [status]);

  // Background work pauses while the tab is hidden (core/scheduler.ts).
  const scheduler = status.kind === "connected" ? status.connection.keyboard.scheduler : null;
  useEffect(() => {
    if (!scheduler) return;
    const update = () =>
      document.visibilityState === "hidden" ? scheduler.pause("hidden") : scheduler.resume("hidden");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, [scheduler]);

  // An unplug drops back to the connect screen with an explanation.
  useEffect(() => {
    if (status.kind !== "connected") return;
    return status.connection.queue.transport.onDisconnect(() => {
      setStatus({ kind: "idle" });
      setError("The keyboard was disconnected.");
    });
  }, [status]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const kb = status.kind === "connected" ? status.connection.keyboard : null;
  useKeyboardLayoutLabels(kb);
  const history = useHistory(kb, setError);

  const setSwitches = (next: Set<string>) => {
    setDisabledExtensions(next);
    saveDisabledExtensions(next);
  };

  /** Turns an extension on from outside the Extensions dialog (a layout file's data), asking as it would. */
  const turnOnExtension = async (id: string) => {
    const ext = BUILTIN_EXTENSIONS.find((e) => e.id === id);
    if (!kb || !ext) return;
    const plan = await planTurnOnFor(kb, ext, BUILTIN_EXTENSIONS, disabledExtensions);
    if (plan.question) {
      const ok = await new Promise<boolean>((resolve) =>
        setConfirmRequest({ messages: [plan.question!], resolve }),
      );
      if (!ok) return;
    }
    const turnedOn = plan.changes.filter((c) => c.on).map((c) => c.id);
    if (turnedOn.length > 0) markTurnedOn(turnedOn);
    setSwitches(switchedOff(disabledExtensions, plan.changes));
    // When the keyboard can't run it after all, the load dialog's new plan says why.
    await kb.setExtensionsEnabled(switchesFor(plan.changes, BUILTIN_EXTENSIONS));
  };

  return (
    <TooltipProvider>
      <div className="flex min-h-screen flex-col bg-kumo-canvas text-kumo-default">
        <TopBar
          keyboard={kb}
          history={history}
          layouts={
            kb && (
              <VilControls
                keyboard={kb}
                busy={restoring}
                setBusy={setRestoring}
                onError={setError}
                onNotice={setNotice}
                onTurnOn={turnOnExtension}
              />
            )
          }
          showLog={showLog}
          onToggleLog={() => setShowLog((s) => !s)}
          onExtensions={() => setShowExtensions(true)}
          onDisconnect={() => void disconnect()}
          onError={setError}
          updater={updater}
        />

        {/* The device panel docks under the top bar on the right (board 6): the
            page leaves it room, and views leave their own side panel out. */}
        <SidePanelTaken.Provider value={showLog}>
          <div className={"flex flex-1 flex-col" + (showLog ? " lg:pr-[440px]" : "")}>
            <div className="flex flex-col gap-2 px-4 pt-3 empty:hidden md:px-5">
              {!kb && (
                <Banner
                  variant="alert"
                  size="sm"
                  icon={<WarningIcon weight="fill" aria-hidden="true" />}
                  description={
                    <>
                      Experimental: ViaLink is vibe coded (written largely by an AI coding assistant) and has
                      only been tested on one keyboard, the{" "}
                      <a
                        href="https://github.com/GEIGEIGEIST/KLOR"
                        target="_blank"
                        rel="noreferrer"
                        className="underline"
                      >
                        KLOR by GEIGEIGEIST
                      </a>
                      . Save a backup of your layout before changing anything.
                    </>
                  }
                  role="note"
                />
              )}
              {error && (
                <Banner
                  variant="error"
                  size="sm"
                  role="alert"
                  description={error}
                  action={
                    <Button size="xs" variant="ghost" onClick={() => setError(null)} aria-label="Dismiss">
                      ×
                    </Button>
                  }
                />
              )}
              {notice && <Banner variant="default" size="sm" role="status" description={notice} />}
              {kb?.isExampleUid() && (
                <Banner
                  variant="alert"
                  size="sm"
                  role="alert"
                  description="This keyboard uses an example UID from vial-qmk. Give it a unique UID before shipping it."
                />
              )}
            </div>

            {kb && unlockRequest && (
              <UnlockDialog
                keyboard={kb}
                reason={unlockRequest.reason}
                onFinish={(ok) => {
                  unlockRequest.resolve(ok);
                  setUnlockRequest(null);
                }}
              />
            )}
            {confirmRequest && (
              <ConfirmDialog
                messages={confirmRequest.messages}
                onAnswer={(ok) => {
                  confirmRequest.resolve(ok);
                  setConfirmRequest(null);
                }}
              />
            )}
            {showExtensions && (
              <ExtensionsDialog
                disabled={disabledExtensions}
                keyboard={kb}
                onError={setError}
                onChange={setSwitches}
                onClose={() => setShowExtensions(false)}
              />
            )}

            <main className="flex min-h-0 flex-1 flex-col">
              {status.kind === "idle" && <ConnectScreen onConnect={(target) => void start(target)} />}
              {status.kind === "connecting" && <Connecting progress={status.progress} />}
              {status.kind === "connected" && (
                <Editor
                  keyboard={status.connection.keyboard}
                  onError={setError}
                  onNotice={setNotice}
                  locked={restoring}
                />
              )}
              {showLog && <DevicePanel queue={queue} keyboard={kb} onClose={() => setShowLog(false)} />}
              {kb && <ExtensionOverlays keyboard={kb} />}
            </main>

            <UndoToast keyboard={kb} controls={history} />
            {updater && <UpdateNotice updater={updater} busy={restoring} />}

            {/* The credits show on the launch screen only: in the editor a
                footer would sit under the side panel, which runs down to the
                window's edge. */}
            {status.kind !== "connected" && (
              <footer className="px-4 py-3 text-[13px] text-kumo-subtle md:px-5">
                Built on{" "}
                <a className="underline" href="https://github.com/vial-kb/vial-gui">
                  vial-gui
                </a>
                ,{" "}
                <a className="underline" href="https://github.com/tcyeee/vialite">
                  Vialite
                </a>{" "}
                and{" "}
                <a className="underline" href="https://github.com/cloudflare/kumo">
                  Kumo
                </a>
                . Licensed under GPL-2.0.{" "}
                <a className="underline" href={docsUrl("extensions")} target="_blank" rel="noreferrer">
                  Writing an extension
                </a>
                .
              </footer>
            )}
          </div>
        </SidePanelTaken.Provider>
      </div>
    </TooltipProvider>
  );
}

/** Calls `fn` with the latest pushed value at most once per animation frame, until cancelled. */
function latestPerFrame<T>(fn: (value: T) => void) {
  let latest: { value: T } | null = null;
  let frame = 0;
  return {
    push(value: T) {
      latest = { value };
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const pending = latest;
        latest = null;
        if (pending) fn(pending.value);
      });
    },
    cancel() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      latest = null;
    },
  };
}

/** The desktop app's keyboards, looked up again every second while the connect screen shows. */
function useNativeKeyboards(enabled: boolean): NativeKeyboard[] | null {
  const [keyboards, setKeyboards] = useState<NativeKeyboard[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const refresh = () =>
      listNativeKeyboards().then(
        (found) => alive && setKeyboards(found),
        () => alive && setKeyboards([]),
      );
    void refresh();
    const timer = setInterval(refresh, 1000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [enabled]);
  return keyboards;
}

function ConnectScreen({ onConnect }: { onConnect: (target: ConnectTarget) => void }) {
  const desktop = isDesktop();
  const keyboards = useNativeKeyboards(desktop);
  const supported = webHidSupported();
  return (
    <section className="mx-auto my-10 flex max-w-xl flex-col items-center gap-3 px-4 text-center">
      <h2 className="m-0 text-xl font-semibold">Connect a Vial keyboard</h2>
      {desktop ? (
        <p className="m-0 text-kumo-subtle">
          {keyboards === null
            ? "Looking for keyboards…"
            : keyboards.length === 0
              ? "No keyboard found yet. Plug one in and it shows up here."
              : "Choose a keyboard."}
        </p>
      ) : supported ? (
        <p className="m-0 text-kumo-subtle">
          Plug in your keyboard and choose it in the browser's device list.
        </p>
      ) : (
        <Banner
          variant="alert"
          size="sm"
          description="This browser does not support WebHID. Use a Chromium-based browser such as Chrome, Edge or Opera. On Linux the keyboard's hidraw device also needs a udev rule that grants your user access."
        />
      )}
      <div className="mt-2 flex flex-wrap justify-center gap-3">
        {desktop ? (
          keyboards?.map((device) => (
            <Button key={device.path} variant="primary" onClick={() => onConnect({ kind: "native", device })}>
              Connect {device.productName}
            </Button>
          ))
        ) : (
          <Button variant="primary" disabled={!supported} onClick={() => onConnect({ kind: "webhid" })}>
            Connect keyboard
          </Button>
        )}
        <Button onClick={() => onConnect({ kind: "demo" })}>Try the demo keyboard</Button>
      </div>
    </section>
  );
}

function Connecting({ progress }: { progress: LoadProgress | null }) {
  return (
    <section className="mx-auto my-10 flex w-full max-w-xl flex-col gap-3 px-4 text-center" aria-busy="true">
      <h2 className="m-0 text-xl font-semibold">Loading keyboard…</h2>
      <p className="m-0 text-kumo-subtle">
        {progress ? `Reading ${progress.stage}` : "Opening device"}
        {progress && progress.total > 1 ? ` (${progress.done}/${progress.total})` : ""}
      </p>
      <progress className="w-full accent-accent" max={progress?.total || 1} value={progress?.done ?? 0} />
    </section>
  );
}
