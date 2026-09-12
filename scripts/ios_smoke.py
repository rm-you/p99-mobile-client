"""Launch a packaged Simulator build without a development server or game login."""

import json
from pathlib import Path
import plistlib
import subprocess
import time


def simctl(*args):
    return subprocess.check_output(["xcrun", "simctl", *args], text=True, timeout=300).strip()


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
    if not (app / "PrivacyInfo.xcprivacy").is_file():
        raise RuntimeError("App privacy manifest was not packaged")
    # An unsigned Simulator app launches, but lacks the identity needed by Keychain.
    # This ad-hoc identity is only for the disposable Simulator, never a device IPA.
    entitlements = output / "simulator.entitlements"
    entitlements.write_bytes(plistlib.dumps({
        "application-identifier": "P99SIMTEST." + bundle,
        "keychain-access-groups": ["P99SIMTEST." + bundle],
        "com.apple.developer.team-identifier": "P99SIMTEST",
    }))
    subprocess.run(["codesign", "--force", "--sign", "-", "--entitlements", str(entitlements), str(app)], check=True)
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
        print("Booting disposable iPhone simulator...", flush=True)
        simctl("boot", device)
        simctl("bootstatus", device, "-b")
        simctl("install", device, str(app.resolve()))
        print("Launching the packaged application...", flush=True)
        launch = simctl("launch", device, bundle)
        (output / "launch.txt").write_text(launch + "\n")
        time.sleep(10)
        processes = simctl("spawn", device, "launchctl", "list")
        running = [row for row in processes.splitlines() if bundle in row and row.split()[0].isdigit()]
        if not running:
            raise RuntimeError("Application did not remain running after launch")
        simctl("io", device, "screenshot", str(output / "launch.png"))
        subprocess.run(["xcodegen", "generate", "--spec", "scripts/ios-tests/project.yml"], check=True)
        subprocess.run([
            "xcodebuild", "test", "-project", "scripts/ios-tests/P99Smoke.xcodeproj",
            "-scheme", "P99Smoke", "-destination", "id=" + device,
            "-resultBundlePath", str(output / "smoke.xcresult"),
            "CODE_SIGNING_ALLOWED=NO",
        ], check=True, timeout=300)
        (output / "build.json").write_text(json.dumps({
            "bundle": bundle, "version": info["CFBundleShortVersionString"],
            "runtime": runtime["name"], "process_alive": True,
            "game_login_attempted": False,
            "ui_tests_passed": True,
        }, indent=2) + "\n")
        print("Packaged iOS app installed and remained running; no game login attempted.")
    finally:
        try:
            log = simctl("spawn", device, "log", "show", "--last", "10m", "--style", "compact",
                         "--predicate", 'eventMessage CONTAINS "Secure storage"')
            (output / "secure-storage.log").write_text(log)
        finally:
            subprocess.run(["xcrun", "simctl", "shutdown", device], check=False, timeout=30)
            subprocess.run(["xcrun", "simctl", "delete", device], check=False, timeout=30)


if __name__ == "__main__":
    main()
