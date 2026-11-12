// SPDX-License-Identifier: GPL-2.0-or-later
// Layouts saved in this browser: load onto the board, download as .vil,
// rename or delete (undoable from the dialog: the delete puts the record
// back). Layouts from this keyboard (same UID) are listed first.

import { useEffect, useState } from "react";
import type { Keyboard } from "../../core/keyboard.ts";
import { downloadText, errorMessage, fileNameFor } from "../hooks.ts";
import { layoutStore, type SavedLayout } from "../storage/savedLayouts.ts";

interface Props {
  keyboard: Keyboard;
  onLoad: (layout: SavedLayout) => void;
  onError: (message: string) => void;
  onClose: () => void;
}

export function SavedLayoutsDialog({ keyboard, onLoad, onError, onClose }: Props) {
  const [layouts, setLayouts] = useState<SavedLayout[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  /** The layout deleted last, kept so the delete can be undone. */
  const [deleted, setDeleted] = useState<SavedLayout | null>(null);

  const [reload, setReload] = useState(0);
  const refresh = () => setReload((n) => n + 1);

  useEffect(() => {
    let live = true;
    layoutStore()
      .list()
      .then(
        (list) => {
          if (!live) return;
          setLayouts(list);
          setFailure(null);
        },
        (err: unknown) => live && setFailure(errorMessage(err)),
      );
    return () => {
      live = false;
    };
  }, [reload]);

  const uid = keyboard.uid.toString();
  const mine = layouts?.filter((l) => l.uid === uid) ?? [];
  const others = layouts?.filter((l) => l.uid !== uid) ?? [];

  const act = async (fn: () => Promise<void>) => {
    try {
      await fn();
      refresh();
    } catch (err) {
      onError(errorMessage(err));
    }
  };

  const row = (l: SavedLayout) => (
    <li key={l.id} className="saved-layout">
      {renaming?.id === l.id ? (
        <form
          className="rename"
          onSubmit={(e) => {
            e.preventDefault();
            const name = renaming.name.trim();
            if (!name) return;
            void act(async () => {
              await layoutStore().put({ ...l, name });
              setRenaming(null);
            });
          }}
        >
          <input
            aria-label={`New name for ${l.name}`}
            value={renaming.name}
            autoFocus
            onChange={(e) => setRenaming({ id: l.id, name: e.target.value })}
          />
          <button type="submit" className="primary">
            Rename
          </button>
          <button type="button" onClick={() => setRenaming(null)}>
            Cancel
          </button>
        </form>
      ) : (
        <>
          <div className="saved-meta">
            <strong>{l.name}</strong>
            <span className="hint">
              {new Date(l.savedAt).toLocaleString()}
              {l.uid !== uid && ` · ${l.keyboardName}`}
            </span>
          </div>
          <div className="saved-actions">
            <button className="primary" onClick={() => onLoad(l)} aria-label={`Load ${l.name}`}>
              Load
            </button>
            <button
              onClick={() => downloadText(fileNameFor(l.name), l.vil)}
              aria-label={`Download ${l.name}`}
            >
              Download
            </button>
            <button onClick={() => setRenaming({ id: l.id, name: l.name })} aria-label={`Rename ${l.name}`}>
              Rename
            </button>
            {confirmDelete === l.id ? (
              <button
                className="danger"
                onClick={() =>
                  void act(async () => {
                    await layoutStore().delete(l.id);
                    setDeleted(l);
                  })
                }
                aria-label={`Confirm delete ${l.name}`}
              >
                Really delete?
              </button>
            ) : (
              <button onClick={() => setConfirmDelete(l.id)} aria-label={`Delete ${l.name}`}>
                Delete
              </button>
            )}
          </div>
        </>
      )}
    </li>
  );

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="dialog wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="saved-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="saved-title">Saved layouts</h2>
        {failure && (
          <p className="error" role="alert">
            {failure}
          </p>
        )}
        {deleted && (
          <p className="saved-undo" role="status">
            Deleted “{deleted.name}”.{" "}
            <button
              onClick={() =>
                void act(async () => {
                  await layoutStore().put(deleted);
                  setDeleted(null);
                })
              }
            >
              Undo
            </button>
          </p>
        )}
        {layouts === null && !failure && <p className="hint">Loading…</p>}
        {layouts !== null && layouts.length === 0 && (
          <p className="hint">
            Nothing saved in this browser yet. Use Save in browser to keep a layout here.
          </p>
        )}
        {mine.length > 0 && (
          <>
            <h3>This keyboard</h3>
            <ul className="saved-list">{mine.map(row)}</ul>
          </>
        )}
        {others.length > 0 && (
          <>
            <h3>Other keyboards</h3>
            <ul className="saved-list">{others.map(row)}</ul>
          </>
        )}
        <div className="dialog-actions">
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
