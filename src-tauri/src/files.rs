// App data (bundled resources) and the per-user folder. The user folder is the same one the
// Electron build used (%APPDATA%\exile-hub), so settings, progress and caches carry over.
use serde::Serialize;
use std::{
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};
use tauri::{AppHandle, Manager};

pub fn user_dir() -> PathBuf {
    PathBuf::from(std::env::var("APPDATA").unwrap_or_default()).join("exile-hub")
}

fn user_path(name: &str) -> Result<PathBuf, String> {
    if name.is_empty() || name.contains(['/', '\\', ':']) || name.contains("..") {
        return Err(format!("invalid file name: {name}"));
    }
    Ok(user_dir().join(name))
}

fn resources(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().resource_dir().map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    version: String,
    packaged: bool,
    /// started by Windows at login: stay in the tray
    hidden: bool,
    user_dir: String,
}

#[tauri::command]
pub fn app_info(app: AppHandle) -> Result<AppInfo, String> {
    Ok(AppInfo {
        version: app.package_info().version.to_string(),
        packaged: !cfg!(debug_assertions),
        hidden: std::env::args().any(|a| a == "--hidden"),
        user_dir: user_dir().to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub fn read_data(app: AppHandle, rel: String) -> Result<String, String> {
    if rel.contains("..") || rel.contains(':') {
        return Err(format!("invalid data path: {rel}"));
    }
    fs::read_to_string(resources(&app)?.join("data").join(rel)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_user_file(name: String) -> Result<Option<String>, String> {
    match fs::read_to_string(user_path(&name)?) {
        Ok(t) => Ok(Some(t)),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Written to a temporary file first, then renamed: a crash never leaves half a file.
#[tauri::command]
pub fn write_user_file(name: String, text: String) -> Result<(), String> {
    let path = user_path(&name)?;
    fs::create_dir_all(user_dir()).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

/// Last modification time (ms since 1970) or null when missing.
#[tauri::command]
pub fn user_file_age(name: String) -> Result<Option<f64>, String> {
    let Ok(meta) = fs::metadata(user_path(&name)?) else { return Ok(None) };
    Ok(meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as f64))
}

#[tauri::command]
pub fn first_existing(paths: Vec<String>) -> Option<String> {
    paths.into_iter().find(|p| Path::new(p).is_file())
}
