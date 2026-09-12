fn main() {
    // iOS supplies sharing utilities; the connection service remains Android-only.
    tauri_plugin::Builder::new(&[])
        .android_path("android")
        .ios_path("ios")
        .build();
}
