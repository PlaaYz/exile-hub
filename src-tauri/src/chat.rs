// Chat commands: types one line in Path of Exile's chat (Enter, select all, text, Enter), like
// Awakened PoE Trade does. Only when the window in front belongs to the game; one call = one line.
use std::{thread, time::Duration};

#[cfg(windows)]
pub(crate) mod win {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, BOOL, HWND, LPARAM},
        System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION},
        UI::{
            Input::KeyboardAndMouse::{
                SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE, VIRTUAL_KEY,
                VK_A, VK_CONTROL, VK_LCONTROL, VK_LMENU, VK_LSHIFT, VK_MENU, VK_RCONTROL, VK_RETURN, VK_RMENU,
                VK_RSHIFT, VK_SHIFT,
            },
            WindowsAndMessaging::{EnumWindows, GetForegroundWindow, GetWindow, GetWindowThreadProcessId, IsWindowVisible, GW_OWNER},
        },
    };

    /// The executable of the foreground window ("PathOfExile.exe", "PathOfExileSteam.exe"...).
    pub fn foreground_exe() -> Option<String> {
        exe_of(unsafe { GetForegroundWindow() })
    }

    /// The game's main window (visible, top-level), if it is running.
    pub fn game_window() -> Option<HWND> {
        unsafe extern "system" fn each(hwnd: HWND, found: LPARAM) -> BOOL {
            if unsafe { IsWindowVisible(hwnd) } != 0 && unsafe { GetWindow(hwnd, GW_OWNER) }.is_null()
                && exe_of(hwnd).is_some_and(|e| super::is_game(&e))
            {
                unsafe { *(found as *mut HWND) = hwnd };
                return 0; // stop
            }
            1
        }
        let mut found: HWND = std::ptr::null_mut();
        unsafe { EnumWindows(Some(each), &mut found as *mut HWND as LPARAM) };
        (!found.is_null()).then_some(found)
    }

    fn exe_of(hwnd: HWND) -> Option<String> {
        unsafe {
            if hwnd.is_null() {
                return None;
            }
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, &mut pid);
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if h.is_null() {
                return None;
            }
            let mut buf = [0u16; 1024];
            let mut len = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(h, 0, buf.as_mut_ptr(), &mut len);
            CloseHandle(h);
            if ok == 0 {
                return None;
            }
            let path = String::from_utf16_lossy(&buf[..len as usize]);
            path.rsplit('\\').next().map(str::to_owned)
        }
    }

    pub fn key(vk: VIRTUAL_KEY, up: bool) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT { wVk: vk, wScan: 0, dwFlags: if up { KEYEVENTF_KEYUP } else { 0 }, time: 0, dwExtraInfo: 0 },
            },
        }
    }

    fn unicode(unit: u16, up: bool) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: 0,
                    wScan: unit,
                    dwFlags: KEYEVENTF_UNICODE | if up { KEYEVENTF_KEYUP } else { 0 },
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    pub fn send(inputs: &[INPUT]) -> bool {
        unsafe { SendInput(inputs.len() as u32, inputs.as_ptr(), std::mem::size_of::<INPUT>() as i32) as usize == inputs.len() }
    }

    /// Modifiers still held from the hotkey (Ctrl+H...) would turn Enter/typing into shortcuts.
    pub fn release_modifiers() -> Vec<INPUT> {
        [VK_CONTROL, VK_LCONTROL, VK_RCONTROL, VK_SHIFT, VK_LSHIFT, VK_RSHIFT, VK_MENU, VK_LMENU, VK_RMENU]
            .iter()
            .map(|&vk| key(vk, true))
            .collect()
    }
    pub fn tap(vk: VIRTUAL_KEY) -> Vec<INPUT> {
        vec![key(vk, false), key(vk, true)]
    }
    pub fn select_all() -> Vec<INPUT> {
        vec![key(VK_CONTROL, false), key(VK_A, false), key(VK_A, true), key(VK_CONTROL, true)]
    }
    pub fn text(s: &str) -> Vec<INPUT> {
        s.encode_utf16().flat_map(|u| [unicode(u, false), unicode(u, true)]).collect()
    }
    pub const ENTER: VIRTUAL_KEY = VK_RETURN;
}

pub(crate) fn is_game(exe: &str) -> bool {
    exe.to_ascii_lowercase().starts_with("pathofexile")
}

#[tauri::command]
pub async fn send_chat(text: String) -> Result<(), String> {
    // 500: the trade site's whispers carry the item name, price, league and stash position
    if text.is_empty() || text.len() > 500 || text.contains(['\r', '\n']) || !(text.starts_with('/') || text.starts_with('@')) {
        return Err("comando inválido".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(windows)]
        {
            let exe = win::foreground_exe().unwrap_or_default();
            if !is_game(&exe) {
                return Err("o jogo não está em primeiro plano".to_string());
            }
            // small pauses between steps: the game reads input per frame
            let steps = [win::release_modifiers(), win::tap(win::ENTER), win::select_all(), win::text(&text), win::tap(win::ENTER)];
            for step in steps {
                if !win::send(&step) {
                    return Err("o Windows bloqueou o envio de teclas".into());
                }
                thread::sleep(Duration::from_millis(30));
            }
            Ok(())
        }
        #[cfg(not(windows))]
        {
            let _ = (text, is_game("x"));
            thread::sleep(Duration::ZERO);
            Err("só no Windows".to_string())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Brings the game window to the front (a click in our own window allows it); false if the game is not
/// running or Windows refused.
#[tauri::command]
pub async fn bring_game_front() -> bool {
    tauri::async_runtime::spawn_blocking(|| {
        #[cfg(windows)]
        {
            use windows_sys::Win32::UI::WindowsAndMessaging::{IsIconic, SetForegroundWindow, ShowWindow, SW_RESTORE};
            if is_game(&win::foreground_exe().unwrap_or_default()) {
                return true;
            }
            let Some(h) = win::game_window() else { return false };
            unsafe {
                if IsIconic(h) != 0 {
                    ShowWindow(h, SW_RESTORE);
                }
                SetForegroundWindow(h);
            }
            // the game takes a moment to accept keys after it gets the focus
            for _ in 0..20 {
                thread::sleep(Duration::from_millis(25));
                if is_game(&win::foreground_exe().unwrap_or_default()) {
                    thread::sleep(Duration::from_millis(100));
                    return true;
                }
            }
            false
        }
        #[cfg(not(windows))]
        false
    })
    .await
    .unwrap_or(false)
}
