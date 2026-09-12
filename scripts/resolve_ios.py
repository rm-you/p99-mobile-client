"""Resolve Tauri's shared Swift dependency before concurrent Cargo build scripts."""

import json
from pathlib import Path
import subprocess


if __name__ == "__main__":
    metadata = json.loads(subprocess.check_output([
        "cargo", "metadata", "--locked", "--format-version", "1",
        "--manifest-path", "src-tauri/Cargo.toml", "--filter-platform", "aarch64-apple-ios",
    ]))
    packages = [package for package in metadata["packages"] if package["name"] == "tauri"]
    if len(packages) != 1:
        raise RuntimeError("Expected one resolved Tauri dependency")
    package = Path(packages[0]["manifest_path"]).parent / "mobile/ios-api"
    # Each plugin builds Tauri's Swift API separately. Seed the shared Git cache
    # serially, including on runners that restored only the Rust build products.
    subprocess.run(["swift", "package", "--package-path", str(package), "resolve"], check=True)
