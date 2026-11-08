// Path of Building's engine in a child process (this same exe with --pob-worker): finds the
// user's PoB install, starts the worker and passes requests to it, one line of JSON each way.
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    sync::Mutex,
};
use tauri::{AppHandle, Manager, State};

pub const WORKER_ARG: &str = "--pob-worker";
/// Lines from the worker that carry a reply start with this; anything else (stray prints) is ignored.
pub const REPLY_PREFIX: &str = "EH:";

#[derive(Serialize)]
pub struct PobInstall {
    dir: String,
    version: Option<String>,
}

/// The user's Path of Building Community folder (version from manifest.xml: the registry lags).
#[tauri::command]
pub fn pob_find() -> Option<PobInstall> {
    let env = |k: &str| PathBuf::from(std::env::var(k).unwrap_or_default());
    let dirs = [
        env("APPDATA").join("Path of Building Community"),
        env("LOCALAPPDATA").join("Programs").join("Path of Building Community"),
        PathBuf::from(r"C:\Program Files\Path of Building Community"),
        PathBuf::from(r"C:\Program Files (x86)\Path of Building Community"),
    ];
    for dir in dirs {
        if !dir.join("lua51.dll").is_file() || !dir.join("Launch.lua").is_file() {
            continue;
        }
        let version = std::fs::read_to_string(dir.join("manifest.xml")).ok().and_then(|m| manifest_version(&m));
        return Some(PobInstall { dir: dir.to_string_lossy().into_owned(), version });
    }
    None
}

fn manifest_version(xml: &str) -> Option<String> {
    let at = xml.find("<Version")?;
    let tag = &xml[at..at + xml[at..].find('>')?];
    let start = tag.find("number=\"")? + 8;
    let len = tag[start..].find('"')?;
    let v = &tag[start..start + len];
    v.chars().all(|c| c.is_ascii_digit() || c == '.').then(|| v.to_owned())
}

type Io = (ChildStdin, BufReader<ChildStdout>);

#[derive(Default)]
pub struct PobState {
    child: Mutex<Option<Child>>,
    /// held for a whole request/reply: one call at a time
    io: Mutex<Option<Io>>,
}

impl PobState {
    pub fn stop(&self) {
        if let Some(mut c) = self.child.lock().unwrap().take() {
            let _ = c.kill();
            let _ = c.wait();
        }
        if let Ok(mut io) = self.io.try_lock() {
            *io = None;
        }
    }
}

fn exchange(io: &mut Io, msg: &Value) -> Result<Value, String> {
    writeln!(io.0, "{msg}").and_then(|_| io.0.flush()).map_err(|_| "o motor do PoB fechou".to_string())?;
    let mut line = String::new();
    loop {
        line.clear();
        if io.1.read_line(&mut line).map_err(|e| e.to_string())? == 0 {
            return Err("o motor do PoB fechou".into());
        }
        if let Some(rest) = line.trim_end().strip_prefix(REPLY_PREFIX) {
            return serde_json::from_str(rest).map_err(|e| e.to_string());
        }
    }
}

fn start(state: &PobState, pob_dir: String, wrapper_path: String, driver_path: String) -> Result<(), String> {
    let mut io = state.io.lock().unwrap();
    if io.is_some() {
        return Ok(());
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let mut cmd = Command::new(exe);
    cmd.arg(WORKER_ARG).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let mut pipes: Io = (child.stdin.take().unwrap(), BufReader::new(child.stdout.take().unwrap()));
    *state.child.lock().unwrap() = Some(child);
    let reply = exchange(
        &mut pipes,
        &json!({ "type": "init", "pobDir": pob_dir, "wrapperPath": wrapper_path, "driverPath": driver_path }),
    );
    match reply {
        Ok(v) if v["type"] == "ready" => {
            *io = Some(pipes);
            Ok(())
        }
        other => {
            drop(io);
            state.stop();
            Err(match other {
                Ok(v) => v["error"].as_str().unwrap_or("o motor do PoB não iniciou").to_owned(),
                Err(e) => e,
            })
        }
    }
}

/// Blocking pipe work on the blocking thread pool (never on the main/UI thread).
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn pob_start(app: AppHandle, pob_dir: String, wrapper_path: String, driver_path: String) -> Result<(), String> {
    blocking(move || start(&app.state::<PobState>(), pob_dir, wrapper_path, driver_path)).await
}

/// One ranking: `req` is the JSON request for ehSuggest; the reply is its JSON text.
#[tauri::command]
pub async fn pob_call(app: AppHandle, req: String) -> Result<String, String> {
    let req: Value = serde_json::from_str(&req).map_err(|e| e.to_string())?;
    blocking(move || {
        let st = app.state::<PobState>();
        let mut io = st.io.lock().unwrap();
        let Some(pipes) = io.as_mut() else { return Err("need-start".to_string()) };
        match exchange(pipes, &json!({ "type": "suggest", "req": req })) {
            Ok(v) if v["type"] == "result" => Ok(v["json"].as_str().unwrap_or("").to_owned()),
            Ok(v) => Err(v["error"].as_str().unwrap_or("erro no motor do PoB").to_owned()),
            Err(e) => {
                *io = None;
                Err(e)
            }
        }
    })
    .await
}

#[tauri::command]
pub fn pob_stop(state: State<'_, PobState>) {
    state.stop();
}
