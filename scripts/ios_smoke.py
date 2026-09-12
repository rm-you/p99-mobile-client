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
    # Keychain's simulated identity is embedded at link time by prepare_ios.py.
    # The Mac host signature gets only its normal debugging entitlement.
    entitlements = output / "simulator.entitlements"
    entitlements.write_bytes(plistlib.dumps({
        "com.apple.security.get-task-allow": True,
    }))
    subprocess.run(["codesign", "--force", "--sign", "-", "--generate-entitlement-der",
                    "--entitlements", str(entitlements), str(app)], check=True)
    subprocess.run(["codesign", "--verify", "--deep", "--strict", str(app)], check=True)
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
        # SpringBoard can briefly reject launch requests after a cold boot.
        for attempt in range(3):
            try:
                launch = simctl("launch", device, bundle)
                break
            except subprocess.CalledProcessError:
                if attempt == 2:
                    raise
                print("Simulator rejected launch; retrying after five seconds...", flush=True)
                time.sleep(5)
        (output / "launch.txt").write_text(launch + "\n")
        time.sleep(10)
        processes = simctl("spawn", device, "launchctl", "list")
        running = [row for row in processes.splitlines() if bundle in row and row.split()[0].isdigit()]
        if not running:
            raise RuntimeError("Application did not remain running after launch")
        simctl("io", device, "screenshot", str(output / "launch.png"))
        subprocess.run(["xcodegen", "generate", "--spec", "scripts/ios-tests/project.yml"], check=True)
        try:
            subprocess.run([
                "xcodebuild", "test", "-project", "scripts/ios-tests/P99Smoke.xcodeproj",
                "-scheme", "P99Smoke", "-destination", "id=" + device,
                "-resultBundlePath", str(output / "smoke.xcresult"),
                "CODE_SIGNING_ALLOWED=NO",
            ], check=True, timeout=300)
        finally:
            result = output / "smoke.xcresult"
            if result.exists():
                with (output / "test-summary.json").open("w") as summary:
                    subprocess.run(["xcrun", "xcresulttool", "get", "test-results", "summary",
                        "--path", str(result)], stdout=summary, check=False, timeout=30)
                subprocess.run(["xcrun", "xcresulttool", "export", "attachments", "--path", str(result),
                    "--output-path", str(output / "attachments")], check=False, timeout=30)
        (output / "build.json").write_text(json.dumps({
            "bundle": bundle, "version": info["CFBundleShortVersionString"],
            "runtime": runtime["name"], "process_alive": True,
            "game_login_attempted": False,
            "ui_tests_passed": True,
        }, indent=2) + "\n")
        print("Packaged iOS app installed and remained running; no game login attempted.")
    finally:
        try:
            # A fresh CI device has no account data; retain native launch failures too.
            predicate = ('eventMessage CONTAINS "Secure storage" OR '
                         'eventMessage CONTAINS "' + bundle + '" OR '
                         'process == "SpringBoard" OR process == "runningboardd" OR '
                         'process == "amfid"')
            log = simctl("spawn", device, "log", "show", "--last", "10m", "--style", "compact",
                         "--predicate", predicate)
            (output / "simulator.log").write_text(log)
            subprocess.run(["xcrun", "simctl", "io", device, "screenshot",
                            str(output / "last-screen.png")], check=False, timeout=30)
        finally:
            subprocess.run(["xcrun", "simctl", "shutdown", device], check=False, timeout=30)
            subprocess.run(["xcrun", "simctl", "delete", device], check=False, timeout=30)


if __name__ == "__main__":
    main()
