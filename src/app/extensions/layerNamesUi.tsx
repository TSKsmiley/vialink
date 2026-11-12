// SPDX-License-Identifier: GPL-2.0-or-later
import { useState } from "react";
import { layerNamesExtension } from "../../core/extensions/layerNames.ts";
import { LAYER_NAME_LEN } from "../../core/protocol/constants.ts";
import { errorMessage } from "../hooks.ts";
import type { AppExtension, LayerActionProps } from "./registry.tsx";

function RenameLayer({ keyboard, layer, onError }: LayerActionProps) {
  const names = keyboard.extension(layerNamesExtension);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  if (!names) return null;

  const bytes = new TextEncoder().encode(value).length;

  if (!editing) {
    return (
      <button
        onClick={() => {
          setValue(names.get(layer));
          setEditing(true);
        }}
      >
        Rename layer
      </button>
    );
  }

  const submit = async () => {
    setBusy(true);
    try {
      await names.set(layer, value.trim());
      setEditing(false);
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="rename-layer"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <input
        aria-label={`Name for layer ${layer}`}
        value={value}
        autoFocus
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setEditing(false);
        }}
      />
      <span className={bytes > LAYER_NAME_LEN ? "error" : "hint"}>
        {bytes}/{LAYER_NAME_LEN} bytes
      </span>
      <button type="submit" className="primary" disabled={busy || bytes > LAYER_NAME_LEN}>
        Save
      </button>
      <button type="button" onClick={() => setEditing(false)} disabled={busy}>
        Cancel
      </button>
    </form>
  );
}

export const layerNamesUi: AppExtension = {
  id: layerNamesExtension.id,
  layerTabLabel(keyboard, layer) {
    const name = keyboard.extension(layerNamesExtension)?.get(layer);
    return name ? `${layer}: ${name}` : null;
  },
  LayerActions: RenameLayer,
};
