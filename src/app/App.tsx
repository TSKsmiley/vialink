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
import { DebugPanel } from "./components/DebugPanel.tsx";
import { Editor } from "./components/Editor.tsx";
import { ExtensionsDialog } from "./components/ExtensionsDialog.tsx";
import { UnlockDialog } from "./components/UnlockDialog.tsx";
import { enabledExtensions, loadDisabledExtensions, saveDisabledExtensions } from "./extensions/registry.tsx";
import { errorMessage, useKeyboardVersion } from "./hooks.ts";
import type { Keyboard } from "../core/keyboard.ts";

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

  return (
    <div className="app">
      <header>
        <h1>ViaLink</h1>
        {kb && (
          <dl className="device-info">
            <dt>Keyboard</dt>
            <dd>{kb.name}</dd>
            <dt>VIA</dt>
            <dd>{kb.viaProtocol}</dd>
            <dt>Vial</dt>
            <dd>{kb.vialProtocol}</dd>
            <dt>UID</dt>
            <dd>
              <code>{kb.uid.toString(16).padStart(16, "0")}</code>
            </dd>
          </dl>
        )}
        <div className="header-actions">
          {kb && <LockControls keyboard={kb} onError={setError} />}
          <button onClick={() => setShowExtensions(true)}>Extensions</button>
          <button onClick={() => setShowLog((s) => !s)} aria-pressed={showLog}>
            HID log
          </button>
          {kb && <button onClick={() => void disconnect()}>Disconnect</button>}
        </div>
      </header>
      <p className="banner warning experimental" role="note">
        Experimental: ViaLink is vibe coded (written largely by an AI coding assistant) and has only been
        tested on one keyboard, the{" "}
        <a href="https://github.com/GEIGEIGEIST/KLOR" target="_blank" rel="noreferrer">
          KLOR by GEIGEIGEIST
        </a>
        . Save a backup of your layout before changing anything.
      </p>

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
          onChange={(next) => {
            setDisabledExtensions(next);
            saveDisabledExtensions(next);
          }}
          onClose={() => setShowExtensions(false)}
        />
      )}
      {error && (
        <div className="banner error" role="alert">
          {error}
          <button onClick={() => setError(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
      {notice && (
        <div className="banner notice" role="status">
          {notice}
        </div>
      )}
      {kb?.isExampleUid() && (
        <div className="banner warning" role="alert">
          This keyboard uses an example UID from vial-qmk. Give it a unique UID before shipping it.
        </div>
      )}

      <main>
        {status.kind === "idle" && <ConnectScreen onConnect={(demo) => void start(demo)} />}
        {status.kind === "connecting" && <Connecting progress={status.progress} />}
        {status.kind === "connected" && (
          <Editor keyboard={status.connection.keyboard} onError={setError} onNotice={setNotice} />
        )}
        {showLog && <DebugPanel queue={queue} />}
      </main>

      <footer>
        Built on <a href="https://github.com/vial-kb/vial-gui">vial-gui</a> and{" "}
        <a href="https://github.com/tcyeee/vialite">Vialite</a>. Licensed under GPL-2.0.
      </footer>
    </div>
  );
}

function ConnectScreen({ onConnect }: { onConnect: (demo: boolean) => void }) {
  const supported = webHidSupported();
  return (
    <section className="connect">
      <h2>Connect a Vial keyboard</h2>
      {supported ? (
        <p>Plug in your keyboard and choose it in the browser's device list.</p>
      ) : (
        <p className="warning">
          This browser does not support WebHID. Use a Chromium-based browser such as Chrome, Edge or Opera. On
          Linux the keyboard's hidraw device also needs a udev rule that grants your user access.
        </p>
      )}
      <div className="connect-actions">
        <button className="primary" disabled={!supported} onClick={() => onConnect(false)}>
          Connect keyboard
        </button>
        <button onClick={() => onConnect(true)}>Try the demo keyboard</button>
      </div>
    </section>
  );
}

function Connecting({ progress }: { progress: LoadProgress | null }) {
  return (
    <section className="connect" aria-busy="true">
      <h2>Loading keyboard…</h2>
      <p>
        {progress ? `Reading ${progress.stage}` : "Opening device"}
        {progress && progress.total > 1 ? ` (${progress.done}/${progress.total})` : ""}
      </p>
      <progress max={progress?.total || 1} value={progress?.done ?? 0} />
    </section>
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
    <button
      onClick={() => void keyboard.lock().catch((e) => onError(errorMessage(e)))}
      title="The keyboard is unlocked. Lock it again."
    >
      🔓 Lock
    </button>
  ) : (
    <button
      onClick={() => void keyboard.ensureUnlocked("Unlocking").catch(() => undefined)}
      title="The keyboard is locked."
    >
      🔒 Unlock
    </button>
  );
}
