// SPDX-License-Identifier: GPL-2.0-or-later
// Asks the questions extensions raise before an operation (requireConfirm in
// a before hook; core/extensions/hooks.ts), all together, as the plan doc's
// "Vetoes" section asks. ViaLink-only.

import { useEffect } from "react";

interface Props {
  messages: readonly string[];
  onAnswer: (ok: boolean) => void;
}

export function ConfirmDialog({ messages, onAnswer }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onAnswer(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onAnswer]);

  return (
    <div className="dialog-backdrop" role="presentation">
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
        <h2 id="confirm-title">{messages.length === 1 ? messages[0] : "Go ahead?"}</h2>
        {messages.length > 1 && (
          <ul>
            {messages.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}
        <div className="dialog-actions">
          <button onClick={() => onAnswer(false)}>Cancel</button>
          <button className="primary" autoFocus onClick={() => onAnswer(true)}>
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
