// Client.txt: the tail at startup, the whole file (history) in batches, and new lines as they are
// written. Only files named Client.txt can be read.
use serde::Serialize;
use std::{
    collections::HashMap,
    fs::File,
    io::{BufRead, BufReader, Read, Seek, SeekFrom},
    path::Path,
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};
use tauri::{ipc::Channel, State};

const SCAN_BATCH: usize = 5000;
const POLL: Duration = Duration::from_millis(250);

fn check(path: &str) -> Result<(), String> {
    let name = Path::new(path).file_name().and_then(|n| n.to_str()).unwrap_or("");
    if name.eq_ignore_ascii_case("Client.txt") || name.eq_ignore_ascii_case("LatestClient.txt") {
        Ok(())
    } else {
        Err("só o Client.txt do jogo pode ser lido".into())
    }
}

/// The last `bytes` of the file as lines (first, probably cut, line dropped); [] when missing.
#[tauri::command]
pub async fn log_tail(path: String, bytes: u64) -> Result<Vec<String>, String> {
    check(&path)?;
    tauri::async_runtime::spawn_blocking(move || {
        let Ok(mut f) = File::open(&path) else { return Ok(vec![]) };
        let size = f.metadata().map_err(|e| e.to_string())?.len();
        let start = size.saturating_sub(bytes);
        f.seek(SeekFrom::Start(start)).map_err(|e| e.to_string())?;
        let mut buf = Vec::with_capacity((size - start) as usize);
        f.take(size - start).read_to_end(&mut buf).map_err(|e| e.to_string())?;
        let mut lines: Vec<String> = String::from_utf8_lossy(&buf).split('\n').map(str::to_owned).collect();
        if start > 0 && !lines.is_empty() {
            lines.remove(0);
        }
        Ok(lines)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Every line from the start up to the current size, sent in batches; returns how many were sent.
#[tauri::command]
pub async fn log_scan(path: String, on_lines: Channel<Vec<String>>) -> Result<u64, String> {
    check(&path)?;
    tauri::async_runtime::spawn_blocking(move || {
        let f = File::open(&path).map_err(|e| e.to_string())?;
        let size = f.metadata().map_err(|e| e.to_string())?.len();
        let mut r = BufReader::with_capacity(1 << 20, f.take(size));
        let mut batch = Vec::with_capacity(SCAN_BATCH);
        let mut raw = Vec::new();
        let mut total: u64 = 0;
        loop {
            raw.clear();
            if r.read_until(b'\n', &mut raw).map_err(|e| e.to_string())? == 0 {
                break;
            }
            if raw.last() == Some(&b'\n') {
                raw.pop();
            }
            batch.push(String::from_utf8_lossy(&raw).into_owned());
            total += 1;
            if batch.len() >= SCAN_BATCH {
                on_lines.send(std::mem::take(&mut batch)).map_err(|e| e.to_string())?;
            }
        }
        if !batch.is_empty() {
            on_lines.send(batch).map_err(|e| e.to_string())?;
        }
        Ok(total)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FollowMsg {
    lines: Vec<String>,
    file_seen: bool,
    error: Option<String>,
}

#[derive(Default)]
pub struct Followers {
    next: AtomicU32,
    stops: Mutex<HashMap<u32, Arc<AtomicBool>>>,
}

/// Polls the file and sends complete new lines. Survives truncation and late creation.
#[tauri::command]
pub fn log_follow(path: String, on_msg: Channel<FollowMsg>, state: State<'_, Followers>) -> Result<u32, String> {
    check(&path)?;
    let id = state.next.fetch_add(1, Ordering::SeqCst) + 1;
    let stop = Arc::new(AtomicBool::new(false));
    state.stops.lock().unwrap().insert(id, stop.clone());
    thread::spawn(move || {
        // only lines written from now on; a file that appears later is read from the start
        let (mut pos, mut seen) = match std::fs::metadata(&path) {
            Ok(m) => (m.len(), true),
            Err(_) => (0, false),
        };
        let mut pending: Vec<u8> = Vec::new();
        let mut last_error: Option<String> = None;
        if seen {
            let _ = on_msg.send(FollowMsg { lines: vec![], file_seen: true, error: None });
        }
        while !stop.load(Ordering::SeqCst) {
            thread::sleep(POLL);
            let Ok(meta) = std::fs::metadata(&path) else { continue };
            let newly_seen = !seen;
            seen = true;
            let size = meta.len();
            if size < pos {
                pos = 0; // truncated or rotated
                pending.clear();
            }
            let mut lines = Vec::new();
            let mut error = None;
            if size > pos {
                match File::open(&path).and_then(|mut f| {
                    f.seek(SeekFrom::Start(pos))?;
                    let mut buf = Vec::new();
                    f.take(size - pos).read_to_end(&mut buf)?;
                    Ok(buf)
                }) {
                    Ok(buf) => {
                        pos += buf.len() as u64;
                        pending.extend_from_slice(&buf);
                        if let Some(nl) = pending.iter().rposition(|&b| b == b'\n') {
                            let text = String::from_utf8_lossy(&pending[..nl]).into_owned();
                            pending.drain(..=nl);
                            lines.extend(text.split('\n').map(str::to_owned));
                        }
                    }
                    Err(e) => error = Some(e.to_string()),
                }
            }
            if !lines.is_empty() || newly_seen || error != last_error {
                last_error = error.clone();
                if on_msg.send(FollowMsg { lines, file_seen: true, error }).is_err() {
                    break; // the webview went away
                }
            }
        }
    });
    Ok(id)
}

#[tauri::command]
pub fn log_unfollow(id: u32, state: State<'_, Followers>) {
    if let Some(stop) = state.stops.lock().unwrap().remove(&id) {
        stop.store(true, Ordering::SeqCst);
    }
}
