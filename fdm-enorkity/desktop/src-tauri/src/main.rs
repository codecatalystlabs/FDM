#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backend_config;
mod sidecar;
mod startup_error;

use backend_config::{load_or_create_backend_config, resolve_data_paths};
use std::sync::{Arc, Mutex};
use tauri::api::process::CommandChild;
use tauri::{Manager, RunEvent, State};

#[derive(Clone)]
pub struct ApiBaseUrl(pub String);

#[tauri::command]
fn get_api_base_url(state: State<'_, ApiBaseUrl>) -> String {
    state.0.clone()
}

fn run_setup(app: &mut tauri::App, backend_process: Arc<Mutex<Option<CommandChild>>>) -> Result<(), String> {
    let persist =
        load_or_create_backend_config(&app.handle()).map_err(|e| format!("backend config: {e}"))?;
    let port = persist.api_port;
    let api_base = format!("http://127.0.0.1:{}", port);
    app.manage(ApiBaseUrl(api_base));

    let paths = resolve_data_paths(&app.handle()).map_err(|e| format!("data paths: {e}"))?;

    if let Some(child) = sidecar::try_spawn(port, &paths)? {
        *backend_process.lock().unwrap() = Some(child);
    }

    Ok(())
}

fn main() {
    startup_error::log_process_start();
    startup_error::install_panic_hook();

    let backend_process: Arc<Mutex<Option<CommandChild>>> = Arc::new(Mutex::new(None));

    let app = tauri::Builder::default()
        .setup({
            let backend_process = Arc::clone(&backend_process);
            move |app| {
                match run_setup(app, backend_process.clone()) {
                    Ok(()) => Ok(()),
                    Err(e) => {
                        startup_error::report_failure(&e);
                        Err(Box::new(std::io::Error::new(
                            std::io::ErrorKind::Other,
                            e,
                        ))
                            as Box<dyn std::error::Error>)
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![get_api_base_url])
        .build(tauri::generate_context!());

    let app = match app {
        Ok(a) => a,
        Err(e) => {
            startup_error::report_tauri_shell_failure(&format!("{e}"));
            std::process::exit(1);
        }
    };

    app.run({
        let backend_process = Arc::clone(&backend_process);
        move |_app_handle, event| {
            match event {
                RunEvent::Exit => {
                    if let Ok(mut guard) = backend_process.lock() {
                        if let Some(child) = guard.take() {
                            let _ = child.kill();
                        }
                    }
                }
                _ => {}
            }
        }
    });
}
