// SPDX-License-Identifier: GPL-2.0-or-later
// Every extension component draws inside one of these (plan doc, "User
// interface": crash-safe). A crash shows "<Name> failed to draw" with the
// error in place of that part only; the rest of ViaLink keeps working.

import { Component, type ReactNode } from "react";

interface Props {
  /** The extension's name, e.g. "Macros". */
  name: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ExtensionErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" className="flex flex-col items-start gap-2 p-2">
        <p className="font-semibold">{this.props.name} failed to draw</p>
        <p className="hint">{error.message}</p>
        <button onClick={() => this.setState({ error: null })}>Try again</button>
      </div>
    );
  }
}
