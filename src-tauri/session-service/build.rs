fn main() {
    // Android support only; iOS and desktop use the Rust no-op implementation.
    tauri_plugin::Builder::new(&[])
        .android_path("android")
        .build();
}
