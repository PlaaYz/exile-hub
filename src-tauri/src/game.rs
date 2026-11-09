// Price check on a key (like Awakened PoE Trade): copy the item under the mouse with the game's own
// advanced copy (Ctrl+Alt+C, one key press = one copy, owner-approved 2026-11-09), remember the game
// window so the price popup can hand the focus back, and tell where the mouse is.
use std::sync::atomic::{AtomicIsize, Ordering};

/// The game window that was in front at the last copy (0 = none).
static GAME_HWND: AtomicIsize = AtomicIsize::new(0);

#[tauri::command]
pub async fn copy_item() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        #[cfg(windows)]
        {
            use crate::chat::{is_game, win};
            use windows_sys::Win32::UI::{
                Input::KeyboardAndMouse::{VK_C, VK_CONTROL, VK_MENU},
                WindowsAndMessaging::GetForegroundWindow,
            };
            if !is_game(&win::foreground_exe().unwrap_or_default()) {
                return Err("o jogo não está em primeiro plano".to_string());
            }
            GAME_HWND.store(unsafe { GetForegroundWindow() } as isize, Ordering::SeqCst);
            // Ctrl may still be held from the hotkey (Ctrl+D): pressing it again is harmless
            let inputs = [
                win::key(VK_CONTROL, false),
                win::key(VK_MENU, false),
                win::key(VK_C, false),
                win::key(VK_C, true),
                win::key(VK_MENU, true),
                win::key(VK_CONTROL, true),
            ];
            if !win::send(&inputs) {
                return Err("o Windows bloqueou o envio de teclas".to_string());
            }
            Ok(())
        }
        #[cfg(not(windows))]
        Err("só no Windows".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Gives the keyboard back to the game after the price popup closes.
#[tauri::command]
pub fn focus_game() {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{IsWindow, SetForegroundWindow};
        let h = GAME_HWND.load(Ordering::SeqCst) as windows_sys::Win32::Foundation::HWND;
        if !h.is_null() && unsafe { IsWindow(h) } != 0 {
            unsafe { SetForegroundWindow(h) };
        }
    }
}

/// Mouse position in physical screen pixels.
#[tauri::command]
pub fn cursor_pos() -> (i32, i32) {
    #[cfg(windows)]
    {
        use windows_sys::Win32::{Foundation::POINT, UI::WindowsAndMessaging::GetCursorPos};
        let mut p = POINT { x: 0, y: 0 };
        unsafe { GetCursorPos(&mut p) };
        (p.x, p.y)
    }
    #[cfg(not(windows))]
    (0, 0)
}
