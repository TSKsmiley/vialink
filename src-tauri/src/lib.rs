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

/// Whether this build carries the updater: tauri.conf.json leaves its public
/// key empty, and a release build fills it in (scripts/updater-config.mjs,
/// with signed update files). Without a key the app has no updater at all, so
/// it can never install anything.
fn has_updater(config: &tauri::Config) -> bool {
    cfg!(desktop)
        && config
            .plugins
            .0
            .get("updater")
            .and_then(|updater| updater.get("pubkey"))
            .and_then(|key| key.as_str())
            .is_some_and(|key| !key.trim().is_empty())
}

/// Whether this build can update itself; the page offers updates only then.
#[tauri::command]
fn updater_enabled(app: AppHandle) -> bool {
    has_updater(app.config())
}

/// Restarts into the version the updater just installed. Only reached on
/// macOS and Linux: on Windows the installer closes the app and starts it again.
#[tauri::command]
fn restart_app(app: AppHandle) {
    app.restart();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = tauri::generate_context!();
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();
    // Updates are offered by the page and installed only when the user asks
    // (src/app/updates.ts); the plugin checks each one against the key.
    #[cfg(desktop)]
    if has_updater(context.config()) {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }
    builder
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
            hid::hid_close,
            updater_enabled,
            restart_app
        ])
        .run(context)
        .expect("error while running ViaLink");
}
