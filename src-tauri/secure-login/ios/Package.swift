// swift-tools-version:5.5
import PackageDescription
let package = Package(
    name: "tauri-plugin-secure-login",
    platforms: [.iOS(.v15)],
    products: [.library(name: "tauri-plugin-secure-login", type: .static, targets: ["tauri-plugin-secure-login"])],
    dependencies: [.package(name: "Tauri", path: "../.tauri/tauri-api")],
    targets: [.target(name: "tauri-plugin-secure-login", dependencies: [.byName(name: "Tauri")], path: "Sources")]
)
