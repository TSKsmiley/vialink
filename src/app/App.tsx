// SPDX-License-Identifier: GPL-2.0-or-later
import { useCallback, useEffect, useState } from "react";
import type { LoadProgress } from "../core/keyboard.ts";
import type { RequestQueue } from "../core/transport/queue.ts";
import {
  connect,
  demoTransport,
  NoDeviceSelectedError,
  requestDevice,
  webHidSupported,
  webHidTransport,
  type Connection,
} from "./connection.ts";
import { WarningIcon } from "@phosphor-icons/react";
import { Editor } from "./components/Editor.tsx";
import { ExtensionsDialog } from "./components/ExtensionsDialog.tsx";
import { UnlockDialog } from "./components/UnlockDialog.tsx";
import { VilControls } from "./components/VilControls.tsx";
import { enabledExtensions, loadDisabledExtensions, saveDisabledExtensions } from "./extensions/registry.tsx";
import { errorMessage } from "./hooks.ts";
import { DevicePanel } from "./shell/DevicePanel.tsx";
import { TopBar } from "./shell/TopBar.tsx";
import { UndoToast } from "./shell/UndoToast.tsx";
import { useHistory } from "./shell/useHistory.ts";
import { Banner, Button, TooltipProvider } from "./ui/index.ts";

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
  const [unlockRequest, setUnlockRequest] = useState<{
    reason: string;
    resolve: (ok: boolean) => void;
  } | null>(null);

  const start = useCallback(
    async (demo: boolean) => {
      setError(null);
      setNotice(null);
      try {
        const transport = demo ? await demoTransport() : webHidTransport(await requestDevice());
        setStatus({ kind: "connecting", progress: null });
        const connection = await connect(transport, {
          demo,
          onQueue: setQueue,
          onProgress: (progress) => setStatus({ kind: "connecting", progress }),
          extensions: enabledExtensions(disabledExtensions),
        });
        const kb = connection.keyboard;
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

  const disconnect = useCallback(async () => {
    if (status.kind === "connected") await status.connection.queue.close().catch(() => undefined);
    setStatus({ kind: "idle" });
  }, [status]);

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
  const history = useHistory(kb, setError);

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
              />
            )
          }
          showLog={showLog}
          onToggleLog={() => setShowLog((s) => !s)}
          onExtensions={() => setShowExtensions(true)}
          onDisconnect={() => void disconnect()}
          onError={setError}
        />

        <div className="flex flex-col gap-2 px-4 pt-3 empty:hidden md:px-5">
          {!kb && (
            <Banner
              variant="alert"
              size="sm"
              icon={<WarningIcon weight="fill" aria-hidden="true" />}
              description={
                <>
                  Experimental: ViaLink is vibe coded (written largely by an AI coding assistant) and has only
                  been tested on one keyboard, the{" "}
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
        {showExtensions && (
          <ExtensionsDialog
            disabled={disabledExtensions}
            keyboard={kb}
            onError={setError}
            onChange={(next) => {
              setDisabledExtensions(next);
              saveDisabledExtensions(next);
            }}
            onClose={() => setShowExtensions(false)}
          />
        )}

        <main className="flex min-h-0 flex-1 flex-col">
          {status.kind === "idle" && <ConnectScreen onConnect={(demo) => void start(demo)} />}
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
        </main>

        <UndoToast keyboard={kb} controls={history} />

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
          . Licensed under GPL-2.0.
        </footer>
      </div>
    </TooltipProvider>
  );
}

function ConnectScreen({ onConnect }: { onConnect: (demo: boolean) => void }) {
  const supported = webHidSupported();
  return (
    <section className="mx-auto my-10 flex max-w-xl flex-col items-center gap-3 px-4 text-center">
      <h2 className="m-0 text-xl font-semibold">Connect a Vial keyboard</h2>
      {supported ? (
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
        <Button variant="primary" disabled={!supported} onClick={() => onConnect(false)}>
          Connect keyboard
        </Button>
        <Button onClick={() => onConnect(true)}>Try the demo keyboard</Button>
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
