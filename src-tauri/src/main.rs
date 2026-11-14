// SPDX-License-Identifier: GPL-2.0-or-later
// No console window next to the app on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    vialink_lib::run()
}
