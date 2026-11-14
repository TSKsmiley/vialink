// SPDX-License-Identifier: GPL-2.0-or-later
//! Raw HID for the desktop app, where the webview has no WebHID (WebKit on
//! macOS and Linux). The page talks to it through src/core/transport/native.ts.
//!
//! Follows vial-gui's util.py `hid_send`: write report ID 0 plus the 32-byte
//! message, read the 32-byte reply with a 500 ms timeout. Retries stay in the
//! page's RequestQueue. Deviation from vial-gui: replies are matched to reports
//! by count, the same rule as transport/webhid.ts, so a late reply to a report
//! that timed out is dropped instead of being taken as the next one's answer.
//!
//! `hid_request_many` sends a run of reports back to back, each once the
//! previous one is answered, so a keymap load is not held to one round trip
//! through the page per report (that misses a USB frame each time).
//!
//! One thread owns hidapi and every open device (`HidDevice` is not `Sync`);
//! commands reach it over a channel. At startup it opens a lone keyboard
//! while the window still loads the page, since opening can take ~50 ms (the
//! USB device waking up) and the page connects to a lone keyboard at once. While a device is open the thread looks
//! for it once a second and emits `hid-disconnected` with its handle when it
//! is gone, which is how an idle unplug is noticed.

use std::collections::{HashMap, HashSet};
use std::ffi::CString;
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::time::{Duration, Instant};

use hidapi::{HidApi, HidDevice};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::oneshot;

/// The raw-HID interface VIA and Vial share (vial-gui util.py).
const RAW_HID_USAGE_PAGE: u16 = 0xFF60;
const RAW_HID_USAGE: u16 = 0x61;
/// Every VIA/Vial report is exactly this long, in both directions.
const MSG_LEN: usize = 32;
const UNPLUG_CHECK: Duration = Duration::from_secs(1);
pub const DISCONNECTED_EVENT: &str = "hid-disconnected";

#[cfg(target_os = "linux")]
const OPEN_FAILED: &str = "could not open the keyboard (on Linux its hidraw device needs Vial's udev rule, see get.vial.today/manual/linux-udev.html)";
#[cfg(not(target_os = "linux"))]
const OPEN_FAILED: &str = "could not open the keyboard";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyboardInfo {
    path: String,
    product_name: String,
    vendor_id: u16,
    product_id: u16,
    serial: String,
}

/// Errors as the page sees them: `{ kind: "timeout" }`, `{ kind: "other", message }`, ...
#[derive(Debug, Serialize)]
#[serde(tag = "kind", content = "message", rename_all = "camelCase")]
pub enum HidError {
    Timeout,
    Disconnected,
    Other(String),
}

impl HidError {
    fn other(context: &str, err: impl std::fmt::Display) -> Self {
        HidError::Other(format!("{context}: {err}"))
    }
}

/// A batch that failed partway: the replies so far and why the next report failed.
#[derive(Debug, Serialize)]
pub struct BatchFailure {
    error: HidError,
    replies: Vec<Vec<u8>>,
}

impl From<HidError> for BatchFailure {
    fn from(error: HidError) -> Self {
        BatchFailure {
            error,
            replies: Vec::new(),
        }
    }
}

type Reply<T, E = HidError> = oneshot::Sender<Result<T, E>>;

enum Cmd {
    List(Reply<Vec<KeyboardInfo>>),
    Open(String, Reply<u32>),
    Request {
        handle: u32,
        report: Vec<u8>,
        timeout_ms: u32,
        reply: Reply<Vec<u8>>,
    },
    RequestMany {
        handle: u32,
        reports: Vec<Vec<u8>>,
        timeout_ms: u32,
        reply: Reply<Vec<Vec<u8>>, BatchFailure>,
    },
    Close(u32, Reply<()>),
}

/// Managed state: the way into the HID thread.
pub struct HidState(Sender<Cmd>);

pub fn start(app: AppHandle) -> HidState {
    let (tx, rx) = channel();
    std::thread::Builder::new()
        .name("vialink-hid".into())
        .spawn(move || Worker::new(app).run(rx))
        .expect("could not start the HID thread");
    HidState(tx)
}

struct OpenDevice {
    path: String,
    device: HidDevice,
    sent: u64,
    received: u64,
}

struct Worker {
    app: AppHandle,
    api: Result<HidApi, String>,
    open: HashMap<u32, OpenDevice>,
    next_handle: u32,
    /// A lone keyboard opened at startup, until the page opens it (or another).
    early: Option<u32>,
    /// VIALINK_TRACE=1 logs every request's timing to stderr.
    trace: bool,
    started: Instant,
}

impl Worker {
    fn new(app: AppHandle) -> Self {
        Worker {
            app,
            api: HidApi::new().map_err(|e| e.to_string()),
            open: HashMap::new(),
            next_handle: 1,
            early: None,
            trace: std::env::var_os("VIALINK_TRACE").is_some(),
            started: Instant::now(),
        }
    }

    fn run(mut self, rx: Receiver<Cmd>) {
        self.open_early();
        loop {
            match rx.recv_timeout(UNPLUG_CHECK) {
                Ok(Cmd::List(reply)) => {
                    let begun = Instant::now();
                    let result = self.list();
                    self.log("list", begun);
                    let _ = reply.send(result);
                }
                Ok(Cmd::Open(path, reply)) => {
                    let begun = Instant::now();
                    let result = self.open(path);
                    self.log("open", begun);
                    let _ = reply.send(result);
                }
                Ok(Cmd::Request {
                    handle,
                    report,
                    timeout_ms,
                    reply,
                }) => {
                    let _ = reply.send(self.request(handle, &report, timeout_ms));
                }
                Ok(Cmd::RequestMany {
                    handle,
                    reports,
                    timeout_ms,
                    reply,
                }) => {
                    let _ = reply.send(self.request_many(handle, &reports, timeout_ms));
                }
                Ok(Cmd::Close(handle, reply)) => {
                    self.open.remove(&handle);
                    let _ = reply.send(Ok(()));
                }
                Err(RecvTimeoutError::Timeout) => self.check_unplugged(),
                Err(RecvTimeoutError::Disconnected) => return,
            }
        }
    }

    fn log(&self, what: &str, begun: Instant) {
        if self.trace {
            eprintln!(
                "[hid] t={:.1}ms {what} took={:.2}ms",
                self.started.elapsed().as_secs_f64() * 1000.0,
                begun.elapsed().as_secs_f64() * 1000.0
            );
        }
    }

    fn api(&mut self) -> Result<&mut HidApi, HidError> {
        self.api
            .as_mut()
            .map_err(|e| HidError::other("HID is unavailable", e))
    }

    fn list(&mut self) -> Result<Vec<KeyboardInfo>, HidError> {
        let api = self.api()?;
        api.refresh_devices()
            .map_err(|e| HidError::other("listing devices failed", e))?;
        let mut seen = HashSet::new();
        let mut found = Vec::new();
        for info in api.device_list() {
            if info.usage_page() != RAW_HID_USAGE_PAGE || info.usage() != RAW_HID_USAGE {
                continue;
            }
            let path = info.path().to_string_lossy().into_owned();
            if !seen.insert(path.clone()) {
                continue;
            }
            found.push(KeyboardInfo {
                path,
                product_name: info
                    .product_string()
                    .unwrap_or("Unknown keyboard")
                    .to_string(),
                vendor_id: info.vendor_id(),
                product_id: info.product_id(),
                serial: info.serial_number().unwrap_or("").to_string(),
            });
        }
        Ok(found)
    }

    /// With exactly one keyboard plugged in, opens it now (see the header).
    fn open_early(&mut self) {
        let begun = Instant::now();
        if let Ok(found) = self.list() {
            if let [only] = found.as_slice() {
                self.early = self.open_device(only.path.clone()).ok();
            }
        }
        self.log("open early", begun);
    }

    fn open(&mut self, path: String) -> Result<u32, HidError> {
        if let Some(handle) = self.early.take() {
            match self.open.get(&handle) {
                Some(dev) if dev.path == path => return Ok(handle),
                _ => {
                    self.open.remove(&handle);
                }
            }
        }
        self.open_device(path)
    }

    fn open_device(&mut self, path: String) -> Result<u32, HidError> {
        let c_path =
            CString::new(path.clone()).map_err(|e| HidError::other("bad device path", e))?;
        let device = self
            .api()?
            .open_path(&c_path)
            .map_err(|e| HidError::other(OPEN_FAILED, e))?;
        let handle = self.next_handle;
        self.next_handle += 1;
        self.open.insert(
            handle,
            OpenDevice {
                path,
                device,
                sent: 0,
                received: 0,
            },
        );
        Ok(handle)
    }

    fn request(
        &mut self,
        handle: u32,
        report: &[u8],
        timeout_ms: u32,
    ) -> Result<Vec<u8>, HidError> {
        if report.len() != MSG_LEN {
            return Err(HidError::Other(format!(
                "reports must be {MSG_LEN} bytes, got {}",
                report.len()
            )));
        }
        let begun = Instant::now();
        let result = self.exchange(handle, report, timeout_ms);
        if self.trace {
            eprintln!(
                "[hid] t={:.1}ms cmd={:02x} {:02x} took={:.2}ms ok={}",
                self.started.elapsed().as_secs_f64() * 1000.0,
                report[0],
                report[1],
                begun.elapsed().as_secs_f64() * 1000.0,
                result.is_ok()
            );
        }
        if matches!(result, Err(HidError::Disconnected)) {
            self.drop_device(handle);
        }
        result
    }

    fn request_many(
        &mut self,
        handle: u32,
        reports: &[Vec<u8>],
        timeout_ms: u32,
    ) -> Result<Vec<Vec<u8>>, BatchFailure> {
        let mut replies = Vec::with_capacity(reports.len());
        for report in reports {
            match self.request(handle, report, timeout_ms) {
                Ok(reply) => replies.push(reply),
                Err(error) => return Err(BatchFailure { error, replies }),
            }
        }
        Ok(replies)
    }

    fn exchange(
        &mut self,
        handle: u32,
        report: &[u8],
        timeout_ms: u32,
    ) -> Result<Vec<u8>, HidError> {
        let dev = self.open.get_mut(&handle).ok_or(HidError::Disconnected)?;
        // Replies can only overtake reports if something unsolicited arrived;
        // realign so the count check can succeed (as transport/webhid.ts).
        if dev.received > dev.sent {
            dev.received = dev.sent;
        }
        let mut out = [0u8; MSG_LEN + 1]; // report ID 0, then the message
        out[1..].copy_from_slice(report);
        // A failed write never reached the board, so no reply will come for it.
        dev.device.write(&out).map_err(|_| HidError::Disconnected)?;
        dev.sent += 1;
        let seq = dev.sent;

        let deadline = Instant::now() + Duration::from_millis(timeout_ms.into());
        let mut buf = [0u8; 64];
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return Err(HidError::Timeout);
            }
            let wait = i32::try_from(left.as_millis()).unwrap_or(i32::MAX).max(1);
            match dev.device.read_timeout(&mut buf, wait) {
                Ok(0) => continue,
                Ok(n) => {
                    dev.received += 1;
                    if dev.received == seq {
                        let mut reply = vec![0u8; MSG_LEN];
                        let len = n.min(MSG_LEN);
                        reply[..len].copy_from_slice(&buf[..len]);
                        return Ok(reply);
                    }
                    // A late reply to a report that already timed out: drop it.
                }
                Err(_) => return Err(HidError::Disconnected),
            }
        }
    }

    fn check_unplugged(&mut self) {
        if self.open.is_empty() {
            return;
        }
        let Ok(api) = self.api.as_mut() else { return };
        if api.refresh_devices().is_err() {
            return;
        }
        let present: HashSet<String> = api
            .device_list()
            .map(|d| d.path().to_string_lossy().into_owned())
            .collect();
        let gone: Vec<u32> = self
            .open
            .iter()
            .filter(|(_, d)| !present.contains(&d.path))
            .map(|(h, _)| *h)
            .collect();
        for handle in gone {
            self.drop_device(handle);
        }
    }

    fn drop_device(&mut self, handle: u32) {
        if self.open.remove(&handle).is_some() {
            let _ = self.app.emit(DISCONNECTED_EVENT, handle);
        }
    }
}

async fn ask<T, E: From<HidError>>(
    state: &HidState,
    make: impl FnOnce(Reply<T, E>) -> Cmd,
) -> Result<T, E> {
    let stopped = || E::from(HidError::Other("the HID thread stopped".into()));
    let (tx, rx) = oneshot::channel();
    state.0.send(make(tx)).map_err(|_| stopped())?;
    rx.await.map_err(|_| stopped())?
}

/// Keyboards with the VIA/Vial raw-HID interface.
#[tauri::command]
pub async fn hid_list(state: State<'_, HidState>) -> Result<Vec<KeyboardInfo>, HidError> {
    ask(&state, Cmd::List).await
}

#[tauri::command]
pub async fn hid_open(state: State<'_, HidState>, path: String) -> Result<u32, HidError> {
    ask(&state, |reply| Cmd::Open(path, reply)).await
}

/// Sends one 32-byte report and resolves with the 32-byte reply to it.
#[tauri::command]
pub async fn hid_request(
    state: State<'_, HidState>,
    handle: u32,
    report: Vec<u8>,
    timeout_ms: u32,
) -> Result<Vec<u8>, HidError> {
    ask(&state, |reply| Cmd::Request {
        handle,
        report,
        timeout_ms,
        reply,
    })
    .await
}

/// Sends the reports back to back and resolves with their replies, in order.
#[tauri::command]
pub async fn hid_request_many(
    state: State<'_, HidState>,
    handle: u32,
    reports: Vec<Vec<u8>>,
    timeout_ms: u32,
) -> Result<Vec<Vec<u8>>, BatchFailure> {
    ask(&state, |reply| Cmd::RequestMany {
        handle,
        reports,
        timeout_ms,
        reply,
    })
    .await
}

#[tauri::command]
pub async fn hid_close(state: State<'_, HidState>, handle: u32) -> Result<(), HidError> {
    ask(&state, |reply| Cmd::Close(handle, reply)).await
}
