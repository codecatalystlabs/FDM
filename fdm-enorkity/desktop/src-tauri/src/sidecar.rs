use crate::backend_config::DataPaths;
use std::collections::HashMap;
use tauri::api::process::{Command, CommandChild, CommandEvent};

fn should_spawn_backend() -> bool {
    use std::env;
    if env::var("FDM_SKIP_SIDECAR").ok().as_deref() == Some("1") {
        return false;
    }
    if cfg!(debug_assertions) {
        return env::var("FDM_FORCE_SIDECAR").ok().as_deref() == Some("1");
    }
    true
}

/// Spawns `fdm-enorkity-server` (Tauri [`externalBin`]) unless debug build without `FDM_FORCE_SIDECAR`.
pub fn try_spawn(port: u16, paths: &DataPaths) -> Result<Option<CommandChild>, String> {
    if !should_spawn_backend() {
        eprintln!(
            "[fdm-enorkity] Skipping Go sidecar (debug dev build). Run go-backend manually, or set FDM_FORCE_SIDECAR=1."
        );
        return Ok(None);
    }

    let mut sidecar = Command::new_sidecar("fdm-enorkity-server").map_err(|e| format!("sidecar binary: {e}"))?;

    let mut envs = HashMap::new();
    envs.insert("FDM_EMBEDDED".to_string(), "1".to_string());
    envs.insert("APP_HOST".to_string(), "127.0.0.1".to_string());
    envs.insert("APP_PORT".to_string(), port.to_string());
    envs.insert(
        "DATABASE_PATH".to_string(),
        paths.database.to_string_lossy().to_string(),
    );
    envs.insert(
        "STORAGE_ROOT".to_string(),
        paths.storage.to_string_lossy().to_string(),
    );
    envs.insert("LOG_DIR".to_string(), paths.logs.to_string_lossy().to_string());
    envs.insert(
        "DEFAULT_DOWNLOAD_DIR".to_string(),
        paths.downloads.to_string_lossy().to_string(),
    );
    envs.insert("LOG_LEVEL".to_string(), "info".to_string());
    sidecar = sidecar.envs(envs);

    let (mut rx, child) = sidecar.spawn().map_err(|e| format!("spawn sidecar: {e}"))?;

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => eprintln!("[backend] {}", line),
                CommandEvent::Stderr(line) => eprintln!("[backend] {}", line),
                CommandEvent::Error(err) => eprintln!("[backend] command error: {err}"),
                CommandEvent::Terminated(payload) => {
                    eprintln!("[backend] terminated: code {:?} sig {:?}", payload.code, payload.signal);
                    break;
                }
                _ => {}
            }
        }
    });

    eprintln!(
        "[fdm-enorkity] Started backend sidecar on 127.0.0.1:{} (data: {})",
        port,
        paths.root.display()
    );

    Ok(Some(child))
}
