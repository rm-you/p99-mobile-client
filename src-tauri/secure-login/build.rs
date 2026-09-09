fn main() {
    // Only Rust can call these methods; no credential-reading webview command.
    tauri_plugin::Builder::new(&[])
        .android_path("android")
        .ios_path("ios")
        .build();
}
