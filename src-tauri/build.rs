fn main() {
    // tauri.conf.json takes its version from package.json: rebuild the exe's version info when it changes
    println!("cargo:rerun-if-changed=../package.json");
    tauri_build::build()
}
