// SPDX-License-Identifier: GPL-2.0-or-later
//! ViaLink desktop app: the web app in a native window, with raw HID from the
//! host process (hid.rs) instead of WebHID.

mod hid;

use tauri::window::Color;
use tauri::{AppHandle, Manager, Theme};

/// The page's background (theme.css, --color-kumo-canvas) in light and dark mode.
const CANVAS_LIGHT: Color = Color(251, 251, 251, 255);
const CANVAS_DARK: Color = Color(3, 3, 3, 255);

/// The window starts hidden (tauri.conf.json) and is shown here, painted in the
/// page's background for the system theme, so it never flashes white before
/// the page draws (the page picks light or dark from the same system setting).
fn show_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let dark = matches!(window.theme(), Ok(Theme::Dark));
    if std::env::var_os("VIALINK_TRACE").is_some() {
        eprintln!("[app] showing the window, dark={dark}");
    }
    let _ = window.set_background_color(Some(if dark { CANVAS_DARK } else { CANVAS_LIGHT }));
    let _ = window.show();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let state = hid::start(app.handle().clone());
            app.manage(state);
            show_main_window(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            hid::hid_list,
            hid::hid_open,
            hid::hid_request,
            hid::hid_request_many,
            hid::hid_close
        ])
        .run(tauri::generate_context!())
        .expect("error while running ViaLink");
}
