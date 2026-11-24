// The clipboard is read in one place only: once, right after the price key made the game copy an item
// (game.rs). GGG's overlay rules allow one clipboard read per manual key press; nothing is watched.
use std::{thread, time::Duration};

/// Windows bumps this number on every clipboard change (it says nothing about the content).
#[cfg(windows)]
pub fn sequence() -> u32 {
    unsafe { windows_sys::Win32::System::DataExchange::GetClipboardSequenceNumber() }
}

/// The clipboard text; opening is retried briefly because the game may still hold it open.
pub fn read_text() -> Option<String> {
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
