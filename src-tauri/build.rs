fn main() {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    println!("cargo:rustc-env=P99_BUILD_ID={stamp}");
    let lock = std::fs::read_to_string("Cargo.lock").unwrap_or_default();
    let revision = lock
        .lines()
        .find(|line| line.contains("github.com/rm-you/p99-logger-client?branch=main#"))
        .and_then(|line| line.split('#').nth(1))
        .map(|line| line.trim_end_matches('"'))
        .unwrap_or("unknown");
    println!("cargo:rustc-env=P99_NETWORK_REVISION={revision}");
    println!("cargo:rerun-if-changed=Cargo.lock");
    for path in [
        "src",
        "../src",
        "session-service/src",
        "session-service/android/src",
        "session-service/ios/Sources",
        "secure-login/src",
    ] {
        println!("cargo:rerun-if-changed={path}");
    }
    tauri_build::build()
}
