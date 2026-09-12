"""Launch a packaged Simulator build without a development server or game login."""

import json
from pathlib import Path
import plistlib
import subprocess
import time


def simctl(*args):
    return subprocess.check_output(["xcrun", "simctl", *args], text=True).strip()


def main():
    output = Path("ios-test-output")
    output.mkdir(exist_ok=True)
    candidates = []
    for app in Path("src-tauri/gen/apple/build").rglob("*.app"):
        info = app / "Info.plist"
        if info.is_file():
            data = plistlib.loads(info.read_bytes())
            if data.get("DTPlatformName") == "iphonesimulator":
                candidates.append((app, data))
    if not candidates:
        raise RuntimeError("No packaged iOS Simulator application found")
    app, info = candidates[0]
    bundle = info["CFBundleIdentifier"]
    runtimes = json.loads(simctl("list", "runtimes", "--json"))["runtimes"]
    runtime = next(
        r for r in reversed(runtimes)
        if r.get("isAvailable") and r["name"].startswith("iOS ")
    )
    device = simctl(
        "create", "P99 iOS smoke", "com.apple.CoreSimulator.SimDeviceType.iPhone-15-Pro-Max",
        runtime["identifier"],
    )
    try:
        simctl("boot", device)
        simctl("bootstatus", device, "-b")
        simctl("install", device, str(app.resolve()))
        launch = simctl("launch", device, bundle)
        (output / "launch.txt").write_text(launch + "\n")
        time.sleep(10)
        processes = simctl("spawn", device, "launchctl", "list")
        running = [row for row in processes.splitlines() if bundle in row and row.split()[0].isdigit()]
        if not running:
            raise RuntimeError("Application did not remain running after launch")
        simctl("io", device, "screenshot", str(output / "launch.png"))
        (output / "build.json").write_text(json.dumps({
            "bundle": bundle, "version": info["CFBundleShortVersionString"],
            "runtime": runtime["name"], "process_alive": True,
            "game_login_attempted": False,
        }, indent=2) + "\n")
        print("Packaged iOS app installed and remained running; no game login attempted.")
    finally:
        simctl("shutdown", device)
        simctl("delete", device)


if __name__ == "__main__":
    main()
