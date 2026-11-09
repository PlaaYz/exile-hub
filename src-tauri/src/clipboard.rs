// Clipboard watch without polling the clipboard itself: Windows bumps a sequence number on every
// change, so the text is only read (clipboard opened) when something was actually copied.
use std::{
    sync::atomic::{AtomicU32, Ordering},
    thread,
    time::Duration,
};
use tauri::ipc::Channel;

/// Bumped to stop the current watcher (a new watch or unwatch).
static GENERATION: AtomicU32 = AtomicU32::new(0);
const POLL: Duration = Duration::from_millis(150);

#[cfg(windows)]
fn sequence() -> u32 {
    unsafe { windows_sys::Win32::System::DataExchange::GetClipboardSequenceNumber() }
}
#[cfg(not(windows))]
fn sequence() -> u32 {
    0
}

/// The clipboard text; retried briefly because the app that just copied may still hold it open.
fn read_text() -> Option<String> {
    for _ in 0..5 {
        if let Ok(mut cb) = arboard::Clipboard::new() {
            match cb.get_text() {
                Ok(t) => return Some(t),
                Err(arboard::Error::ContentNotAvailable) => return None, // an image, files...
                Err(_) => {}
            }
        }
        thread::sleep(Duration::from_millis(40));
    }
    None
}

/// Sends the clipboard text each time it changes (not the text that is there now).
#[tauri::command]
pub fn clipboard_watch(on_text: Channel<String>) {
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    thread::spawn(move || {
        let mut last = sequence();
        while GENERATION.load(Ordering::SeqCst) == generation {
            thread::sleep(POLL);
            let seq = sequence();
            if seq == last {
                continue;
            }
            last = seq;
            if let Some(text) = read_text() {
                if on_text.send(text).is_err() {
                    break; // the webview went away
                }
            }
        }
    });
}

#[tauri::command]
pub fn clipboard_unwatch() {
    GENERATION.fetch_add(1, Ordering::SeqCst);
}
