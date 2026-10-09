use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;

pub const DEFAULT_API_PORT: u16 = 8765;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BackendPersist {
    /// Local API port (127.0.0.1 only). Extension and UI use the same value.
    #[serde(default = "default_api_port")]
    pub api_port: u16,
}

fn default_api_port() -> u16 {
    DEFAULT_API_PORT
}

impl Default for BackendPersist {
    fn default() -> Self {
        Self {
            api_port: DEFAULT_API_PORT,
        }
    }
}

fn backend_config_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path_resolver().app_config_dir()?;
    Some(dir.join("backend.json"))
}

pub fn load_or_create_backend_config(app: &AppHandle) -> Result<BackendPersist, String> {
    let Some(path) = backend_config_path(app) else {
        return Ok(BackendPersist::default());
    };
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    if !path.exists() {
        let default = BackendPersist::default();
        let raw = serde_json::to_string_pretty(&default).map_err(|e| e.to_string())?;
        fs::write(&path, raw).map_err(|e| e.to_string())?;
        return Ok(default);
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let cfg: BackendPersist = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    if cfg.api_port == 0 {
        return Err("invalid api_port in backend.json".into());
    }
    Ok(cfg)
}

pub struct DataPaths {
    pub root: PathBuf,
    pub storage: PathBuf,
    pub downloads: PathBuf,
    pub logs: PathBuf,
    pub database: PathBuf,
}

pub fn resolve_data_paths(app: &AppHandle) -> Result<DataPaths, String> {
    let Some(base) = app.path_resolver().app_data_dir() else {
        return Err("app_data_dir unavailable".into());
    };
    let root = base.join("FDM-Enorkity");
    let storage = root.join("storage");
    let downloads = storage.join("downloads");
    let logs = root.join("logs");
    let database = storage.join("fdm.db");
    fs::create_dir_all(&downloads).map_err(|e| e.to_string())?;
    fs::create_dir_all(&logs).map_err(|e| e.to_string())?;
    fs::create_dir_all(&storage).map_err(|e| e.to_string())?;
    Ok(DataPaths {
        root,
        storage,
        downloads,
        logs,
        database,
    })
}
