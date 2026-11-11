# HID traces

Traces recorded from real keyboards go here. Record one by connecting the keyboard in vial-ts,
opening the HID log, doing the steps below, and pressing **Export trace**. Tests replay them with
`ReplayTransport` (see `src/core/transport/replay.ts`).

Wanted from the KLOR test board (Theis194 layer-names firmware):

- `klor-connect.json`: connect and load only.
- `klor-edit.json`: connect, change one key, change one layout option.
- `klor-layer-names.json`: recorded from the fork's desktop GUI for the layer-name get and set
  (the desktop GUI has no trace export; a USB capture converted to this format will do).

Until these exist, protocol tests use vectors derived from vial-gui's source and a simulated
keyboard (`src/core/sim/simulatedKeyboard.ts`).
