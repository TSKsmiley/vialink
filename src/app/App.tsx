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
import { errorMessage } from "./hooks.ts";

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

  const start = useCallback(async (demo: boolean) => {
    setError(null);
    setNotice(null);
    try {
      const transport = demo ? await demoTransport() : webHidTransport(await requestDevice());
      setStatus({ kind: "connecting", progress: null });
      const connection = await connect(transport, {
        demo,
        onQueue: setQueue,
        onProgress: (progress) => setStatus({ kind: "connecting", progress }),
      });
      setStatus({ kind: "connected", connection });
    } catch (err) {
      setStatus({ kind: "idle" });
      if (
        err instanceof NoDeviceSelectedError ||
        (err instanceof DOMException && err.name === "NotFoundError")
      )
        return;
      setError(errorMessage(err));
    }
  }, []);

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
        <h1>vial-ts</h1>
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
          <button onClick={() => setShowLog((s) => !s)} aria-pressed={showLog}>
            HID log
          </button>
          {kb && <button onClick={() => void disconnect()}>Disconnect</button>}
        </div>
      </header>

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
