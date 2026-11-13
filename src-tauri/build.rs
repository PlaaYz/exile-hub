fn main() {
    // tauri.conf.json takes its version from package.json: rebuild the exe's version info when it changes
    println!("cargo:rerun-if-changed=../package.json");
    // our commands are allowed only where a capability grants them (the dashboard: capabilities/dashboard.json);
    // the overlay, price, trades and summary windows reach the app through events only
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
        "app_quit",
        "window_show",
        "window_hide",
        "set_click_through",
        "window_open",
        "window_close",
        "copy_item",
        "focus_game",
        "cursor_pos",
        "clipboard_watch",
        "clipboard_unwatch",
        "send_chat",
        "bring_game_front",
        "app_info",
        "read_data",
        "read_user_file",
        "write_user_file",
        "user_file_age",
        "first_existing",
        "log_tail",
        "log_scan",
        "log_follow",
        "log_unfollow",
    ])))
    .expect("tauri build script")
}
