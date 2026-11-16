// SPDX-License-Identifier: GPL-2.0-or-later
// The start page's keyboard: the demo KLOR's keymap, drawn as the editor draws
// it. Clicking a key says what it does in words, as the key panel does, and
// the layer buttons show what Lower, Raise and Adjust put on the keys. It is
// a look, not the editor: nothing can be changed here ("Try the demo
// keyboard" opens the real thing). The keyboard is a separate simulated one,
// loaded once for this view.

import { useEffect, useState } from "react";
import { Keyboard } from "../../core/keyboard.ts";
import { RequestQueue } from "../../core/transport/queue.ts";
import { KeyboardView, type Selection } from "../components/KeyboardView.tsx";
import { demoTransport } from "../connection.ts";
import { DEMO_LAYER_NAMES } from "../demoKeymap.ts";
import { describeKey } from "../keymap/KeyInspector.tsx";

async function loadDemo(): Promise<Keyboard> {
  const transport = await demoTransport();
  await transport.open();
  return Keyboard.load(new RequestQueue(transport));
}

const layerName = (l: number) => DEMO_LAYER_NAMES[l] ?? `Layer ${l}`;

export function KeyboardPreview({ load = loadDemo }: { load?: () => Promise<Keyboard> }) {
  const [keyboard, setKeyboard] = useState<Keyboard | null>(null);
  const [layer, setLayer] = useState(0);
  const [selection, setSelection] = useState<Selection>(null);

  useEffect(() => {
    let alive = true;
    load().then(
      (kb) => alive && setKeyboard(kb),
      () => undefined, // without it the page simply has no picture
    );
    return () => {
      alive = false;
    };
  }, [load]);

  const code =
    keyboard && selection
      ? selection.kind === "key"
        ? keyboard.getKey(layer, selection.row, selection.col)
        : keyboard.getEncoder(layer, selection.index, selection.direction)
      : undefined;
  const said =
    keyboard && code !== undefined ? describeKey(keyboard.keycodes, keyboard.layers, code, layerName) : null;

  return (
    <figure className="m-0 flex flex-col gap-3" aria-label="The demo keyboard's keymap">
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Layer">
        {DEMO_LAYER_NAMES.map((name, i) => (
          <button
            key={name}
            type="button"
            aria-pressed={layer === i}
            onClick={() => setLayer(i)}
            className={
              "cursor-pointer rounded-md px-2.5 py-1 text-[13px] " +
              (layer === i
                ? "bg-accent-tint font-semibold text-accent-link"
                : "text-kumo-subtle hover:text-kumo-default")
            }
          >
            {name}
          </button>
        ))}
      </div>
      {/* The KLOR is about 17 by 6 keys: hold that shape while it loads. */}
      <div className="aspect-[17.4/6.4] w-full">
        {keyboard && (
          <KeyboardView
            keyboard={keyboard}
            layer={layer}
            fallthrough={layer > 0}
            selection={selection}
            onSelect={(s) => setSelection(s)}
            label={`Demo keyboard, ${layerName(layer)} layer`}
          />
        )}
      </div>
      <figcaption className="min-h-[1.5em] text-[15px] text-kumo-subtle" aria-live="polite">
        {said ? (
          <>
            <span className="font-semibold text-kumo-default">{said}</span>
            {layer > 0 ? ` on ${layerName(layer)}` : ""}
          </>
        ) : (
          "The demo keyboard, a KLOR. Click a key to see what it does."
        )}
      </figcaption>
    </figure>
  );
}
