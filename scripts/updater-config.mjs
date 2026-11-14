// SPDX-License-Identifier: GPL-2.0-or-later
// Writes src-tauri/tauri.updater.conf.json for a desktop build that carries the
// updater: the public key from VIALINK_UPDATER_PUBKEY (the app checks every
// update against it) and signed update files (TAURI_SIGNING_PRIVATE_KEY signs
// them). Pass the file to `pnpm tauri build --config`. Without that file the
// app has no updater (src-tauri/src/lib.rs). README: "Releasing the desktop app".
import { writeFileSync } from "node:fs";

const pubkey = process.env.VIALINK_UPDATER_PUBKEY?.trim();
if (!pubkey) {
  console.error("VIALINK_UPDATER_PUBKEY is empty: set it to the contents of the updater key's .pub file.");
  process.exit(1);
}
const config = { bundle: { createUpdaterArtifacts: true }, plugins: { updater: { pubkey } } };
writeFileSync(
  new URL("../src-tauri/tauri.updater.conf.json", import.meta.url),
  JSON.stringify(config, null, 2) + "\n",
);
console.log("wrote src-tauri/tauri.updater.conf.json");
