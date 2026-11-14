// SPDX-License-Identifier: GPL-2.0-or-later
// Whether the right-edge slot is taken by the device panel (design board 6):
// views then leave their own side panel (the key inspector, the matrix
// tester's details) out, as the board shows the device panel in its place.

import { createContext } from "react";

export const SidePanelTaken = createContext(false);
