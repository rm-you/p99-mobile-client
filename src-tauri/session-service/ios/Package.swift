// swift-tools-version:5.3
import PackageDescription
let package = Package(
    name: "tauri-plugin-session-service",
    platforms: [.iOS(.v15)],
    products: [.library(name: "tauri-plugin-session-service", type: .static, targets: ["tauri-plugin-session-service"])],
    dependencies: [.package(name: "Tauri", path: "../.tauri/tauri-api")],
    targets: [.target(name: "tauri-plugin-session-service", dependencies: [.byName(name: "Tauri")], path: "Sources")]
)
