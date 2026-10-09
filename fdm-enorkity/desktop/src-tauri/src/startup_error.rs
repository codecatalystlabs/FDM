use std::fs;
use std::io::Write;
use std::panic;
use std::time::SystemTime;

const LOG_BASENAME: &str = "fdm-enorkity-startup-error.txt";
const LAUNCH_LOG: &str = "fdm-enorkity-launch.log";
const PANIC_LOG: &str = "fdm-enorkity-panic.txt";

/// Call at the very start of `main` (before Tauri). Survives silent GUI exits.
pub fn log_process_start() {
    let path = std::env::temp_dir().join(LAUNCH_LOG);
    let line = format!("{:?} FDM-Enorkity exe started\n", SystemTime::now());
    let _ = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .and_then(|mut f| f.write_all(line.as_bytes()));
}

/// Catches panics (including failed `.expect` after setup) when the app has no console.
pub fn install_panic_hook() {
    panic::set_hook(Box::new(|info| {
        let payload = info
            .payload()
            .downcast_ref::<&str>()
            .copied()
            .or_else(|| info.payload().downcast_ref::<String>().map(|s| s.as_str()))
            .unwrap_or("(non-string panic payload)");
        let loc = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "unknown location".into());
        let body = format!("Panic at {loc}\n{payload}\n");
        let path = std::env::temp_dir().join(PANIC_LOG);
        let _ = fs::write(&path, &body);
        show_panic_alert(PANIC_LOG);
    }));
}

/// `tauri::Builder::build()` failed at **runtime** (often WebView2 missing or misconfigured — not a Rust compile error).
pub fn report_tauri_shell_failure(summary: &str) {
    let path = std::env::temp_dir().join(LOG_BASENAME);
    let s = summary.trim();
    let mut extra = String::new();
    let lower = s.to_lowercase();
    if lower.contains("webview") || lower.contains("0x80070002") {
        extra.push_str(
            "\n--- WebView2 (0x80070002 = file not found)\n\
• If you installed a build made with **offline-webview** (`tauri.fixedruntime.conf.json`), the installer expects a **full** \
Microsoft WebView2 **Fixed Version** tree under `webview2-runtime/` at build time. An empty or partial folder causes this error.\n\
  Fix: rebuild with `npm run tauri:build` (uses the normal Evergreen WebView2 on the PC), **or** extract the official Fixed Runtime \
into `desktop/src-tauri/webview2-runtime/` then run `npm run tauri:build:offline-webview` again.\n\
• If you used the normal build, install/update **Evergreen WebView2 Runtime** from Microsoft:\n\
  https://developer.microsoft.com/microsoft-edge/webview2/\n",
        );
    }
    let body = format!(
        "FDM-Enorkity could not create the desktop window (Tauri shell).\n\n{}\n{}{}\
(See also %TEMP%\\{} for launch order.)\n",
        s,
        extra,
        if extra.is_empty() { "\n" } else { "" },
        LAUNCH_LOG
    );
    let _ = fs::write(&path, body.as_bytes());
    show_alert(LOG_BASENAME);
}

/// Writes a troubleshooting log beside %TEMP%, then optionally surfaces a GUI hint on Windows.
pub fn report_failure(summary: &str) {
    let path = std::env::temp_dir().join(LOG_BASENAME);

    let body = format!(
        "FDM-Enorkity failed to initialize.\n\n{}\n\n\
---\nTypical fixes on Windows\n\
• If you packaged with fixedRuntime (offline WebView2), the desktop/src-tauri/webview2-runtime/\n\
  folder must contain a full extracted Microsoft Fixed Version runtime before npm run tauri:build.\n\
  An empty placeholder folder installs but the app exits immediately.\n\
  Rebuild using the normal `npm run tauri:build`, or populate webview2-runtime then `npm run tauri:build:offline-webview`.\n\
• Confirm Windows WebView2 is available when not using fixedRuntime.\n\
• Confirm antivirus is not blocking the embedded Go helper (fdm-enorkity-server).\n",
        summary.trim()
    );

    if let Err(e) = fs::write(&path, body.as_bytes()) {
        eprintln!("[fdm-enorkity] could not write {}: {}", path.display(), e);
    }

    show_alert(LOG_BASENAME);
}

#[cfg(windows)]
fn show_panic_alert(log_base: &str) {
    let caption = b"FDM-Enorkity - error\0";
    let message = format!(
        "The app crashed.\n\nDetails: \"%TEMP%\\{}\"\n\nPaste %TEMP% in Explorer's address bar.",
        log_base
    );
    let message_c = match std::ffi::CString::new(message) {
        Ok(s) => s,
        Err(_) => std::ffi::CString::new("FDM-Enorkity crashed; see %TEMP% for logs.")
            .expect("static panic message"),
    };
    unsafe {
        extern "system" {
            fn MessageBoxA(hwnd: isize, text: *const i8, caption: *const i8, flags: u32) -> i32;
        }
        MessageBoxA(
            0,
            message_c.as_ptr(),
            caption.as_ptr() as *const i8,
            0x0000_0010,
        );
    }
}

#[cfg(not(windows))]
fn show_panic_alert(log_base: &str) {
    let _ = log_base;
    eprintln!(
        "[fdm-enorkity] panic — see {}",
        std::env::temp_dir().join(PANIC_LOG).display()
    );
}

#[cfg(windows)]
fn show_alert(log_base: &str) {
    let caption = b"FDM-Enorkity\0";

    let message = format!(
        "FDM-Enorkity could not start.\n\nDetails were written to \"%TEMP%\\{}\"\
         \n(Open Explorer and paste %TEMP% in the address bar.)",
        log_base
    );
    let message_c = match std::ffi::CString::new(message) {
        Ok(s) => s,
        Err(_) => std::ffi::CString::new("FDM-Enorkity could not start.")
            .expect("literal has no NUL"),
    };

    unsafe {
        extern "system" {
            fn MessageBoxA(hwnd: isize, text: *const i8, caption: *const i8, flags: u32) -> i32;
        }

        MessageBoxA(
            0,
            message_c.as_ptr(),
            caption.as_ptr() as *const i8,
            0x0000_0010 /* MB_ICONHAND */,
        );
    }
}

#[cfg(not(windows))]
fn show_alert(log_base: &str) {
    let _ = log_base;
    eprintln!(
        "[fdm-enorkity] startup failed — see {}",
        std::env::temp_dir().join(LOG_BASENAME).display()
    );
}
