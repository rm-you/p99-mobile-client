fn main() {
    // iOS supplies lifecycle, local alerts and sharing; the service is Android-only.
    tauri_plugin::Builder::new(&[])
        .android_path("android")
        .ios_path("ios")
        .build();
}
