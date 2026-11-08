// Exile Hub on Tauri. The app logic (TypeScript, src/app + src/core) runs in the dashboard webview;
// this side gives it what a webview cannot do: read Client.txt, user files, run Path of Building's
// engine in a separate process, show windows without stealing focus.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

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

/// Shows a window without activating it (the game keeps the keyboard).
#[tauri::command]
fn show_inactive(app: tauri::AppHandle, label: String) -> Result<(), String> {
    let w = app.get_webview_window(&label).ok_or("no such window")?;
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_SHOWNOACTIVATE};
        let hwnd = w.hwnd().map_err(|e| e.to_string())?;
        unsafe { ShowWindow(hwnd.0 as _, SW_SHOWNOACTIVATE) };
    }
    #[cfg(not(windows))]
    w.show().map_err(|e| e.to_string())?;
    Ok(())
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
            if let Some(w) = app.get_webview_window("dashboard") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
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
        .manage(pob::PobState::default())
        .manage(logfile::Followers::default())
        .invoke_handler(tauri::generate_handler![
            app_quit,
            show_inactive,
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
                    let _ = window.hide();
                    use tauri::Emitter;
                    let _ = window.emit_to("dashboard", "dashboard-hidden", ());
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Exile Hub");
}
