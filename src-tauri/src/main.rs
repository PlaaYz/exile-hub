// Exile Hub on Tauri. The app logic (TypeScript, src/app + src/core) runs in the dashboard webview;
// this side gives it what a webview cannot do: read Client.txt, user files, run Path of Building's
// engine in a separate process, show windows without stealing focus.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod chat;
mod clipboard;
mod files;
mod logfile;
mod pob;
mod pob_worker;

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Manager, WindowEvent};

/// Set by "Sair": the dashboard's close button only hides it otherwise.
static QUITTING: AtomicBool = AtomicBool::new(false);

#[tauri::command]
fn app_quit(app: tauri::AppHandle) {
    QUITTING.store(true, Ordering::SeqCst);
    app.state::<pob::PobState>().stop();
    app.exit(0);
}

/// How a window is shown or hidden. Every show/hide of our windows goes through here (straight to
/// Windows): mixing it with Tauri's own show()/hide() breaks, because Tauri keeps its own "visible"
/// flag, does not see a window shown here and then skips the hide (the overlay never went away).
#[derive(Clone, Copy)]
enum Show {
    Hide,
    /// visible, the game keeps the keyboard
    NoActivate,
    /// visible and in front (tray click, second launch)
    Activate,
}

fn set_shown(w: &tauri::Window, how: Show) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{IsIconic, ShowWindow, SW_HIDE, SW_RESTORE, SW_SHOW, SW_SHOWNOACTIVATE};
        let hwnd = w.hwnd().map_err(|e| e.to_string())?.0 as _;
        unsafe {
            match how {
                Show::Hide => {
                    ShowWindow(hwnd, SW_HIDE);
                }
                Show::NoActivate => {
                    ShowWindow(hwnd, SW_SHOWNOACTIVATE);
                }
                Show::Activate => {
                    ShowWindow(hwnd, if IsIconic(hwnd) != 0 { SW_RESTORE } else { SW_SHOW });
                }
            }
        }
        if let Show::Activate = how {
            let _ = w.set_focus();
        }
    }
    #[cfg(not(windows))]
    match how {
        Show::Hide => w.hide().map_err(|e| e.to_string())?,
        _ => w.show().map_err(|e| e.to_string())?,
    }
    Ok(())
}

fn window_of(app: &tauri::AppHandle, label: &str) -> Result<tauri::Window, String> {
    app.get_webview_window(label).map(|w| w.as_ref().window()).ok_or_else(|| "no such window".to_string())
}

/// Shows a window; `activate` = bring it to the front, else the game keeps the keyboard.
#[tauri::command]
fn window_show(app: tauri::AppHandle, label: String, activate: bool) -> Result<(), String> {
    set_shown(&window_of(&app, &label)?, if activate { Show::Activate } else { Show::NoActivate })
}

#[tauri::command]
fn window_hide(app: tauri::AppHandle, label: String) -> Result<(), String> {
    set_shown(&window_of(&app, &label)?, Show::Hide)
}

/// Mouse clicks pass through the window (overlay over the game) or not (F10: drag, buttons).
/// Only WS_EX_TRANSPARENT changes: Tauri's own setIgnoreCursorEvents also toggles WS_EX_LAYERED,
/// and the transparent overlay vanished when it came back clickable.
#[tauri::command]
fn set_click_through(app: tauri::AppHandle, label: String, on: bool) -> Result<(), String> {
    let w = window_of(&app, &label)?;
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_LAYERED, WS_EX_TRANSPARENT};
        let hwnd = w.hwnd().map_err(|e| e.to_string())?.0 as _;
        unsafe {
            let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            let next = if on { ex | (WS_EX_TRANSPARENT | WS_EX_LAYERED) as isize } else { ex & !(WS_EX_TRANSPARENT as isize) };
            if next != ex {
                SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next);
            }
        }
    }
    #[cfg(not(windows))]
    w.set_ignore_cursor_events(on).map_err(|e| e.to_string())?;
    Ok(())
}

/// The overlay window is created only when it has to show (its webview costs ~60 MB) from its entry
/// in tauri.conf.json ("create": false), so it gets the same browser args as the dashboard.
#[tauri::command]
async fn overlay_open(app: tauri::AppHandle) -> Result<(), String> {
    if app.get_webview_window("overlay").is_some() {
        return Ok(());
    }
    let cfg = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == "overlay")
        .ok_or("no overlay config")?
        .clone();
    tauri::WebviewWindowBuilder::from_config(&app, &cfg)
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn overlay_close(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("overlay") {
        let _ = w.destroy();
    }
}

fn main() {
    // the same exe hosts Path of Building's engine in a child process
    if std::env::args().any(|a| a == pob::WORKER_ARG) {
        pob_worker::run();
        return;
    }
    tauri::Builder::default()
        // a second launch (desktop shortcut, autostart) just brings the running app forward
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Ok(w) = window_of(app, "dashboard") {
                let _ = set_shown(&w, Show::Activate);
                use tauri::Emitter;
                let _ = w.emit_to("dashboard", "dashboard-shown", ());
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(pob::PobState::default())
        .manage(logfile::Followers::default())
        .invoke_handler(tauri::generate_handler![
            app_quit,
            window_show,
            window_hide,
            set_click_through,
            overlay_open,
            overlay_close,
            clipboard::clipboard_watch,
            clipboard::clipboard_unwatch,
            chat::send_chat,
            files::app_info,
            files::read_data,
            files::read_user_file,
            files::write_user_file,
            files::user_file_age,
            files::first_existing,
            logfile::log_tail,
            logfile::log_scan,
            logfile::log_follow,
            logfile::log_unfollow,
            pob::pob_find,
            pob::pob_start,
            pob::pob_call,
            pob::pob_stop,
        ])
        .on_window_event(|window, event| {
            // closing the dashboard keeps the app in the tray; "Sair" quits
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "dashboard" && !QUITTING.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = set_shown(window, Show::Hide);
                    use tauri::Emitter;
                    let _ = window.emit_to("dashboard", "dashboard-hidden", ());
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Exile Hub");
}
