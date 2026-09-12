"""Include the app privacy manifest in Tauri's generated Xcode application target."""

import argparse
from pathlib import Path
import plistlib
import subprocess


def configure_project(source):
    before, separator, targets = source.partition("\ntargets:\n")
    if not separator:
        raise ValueError("Generated Xcode project has no targets section")
    resource = "      - path: ../../PrivacyInfo.xcprivacy\n        buildPhase: resources\n"
    if resource in targets:
        return source
    marker = "    sources:\n"
    if targets.count(marker) != 1:
        raise ValueError("Expected one generated iOS application target")
    return before + separator + targets.replace(marker, marker + resource, 1)


def configure_simulator(source):
    """Embed simulated Keychain identity separately from the Mac host signature."""
    before, separator, targets = source.partition("\ntargets:\n")
    marker = "    settings:\n      base:\n"
    key = '        "OTHER_LDFLAGS[sdk=iphonesimulator*]":\n'
    if key in targets:
        return source
    if not separator or targets.count(marker) != 1:
        raise ValueError("Expected one iOS application build settings section")
    flags = ["$(inherited)", "-Xlinker", "-sectcreate", "-Xlinker", "__TEXT",
             "-Xlinker", "__entitlements", "-Xlinker",
             "$(PROJECT_DIR)/simulator-entitlements.plist"]
    settings = key + "".join('          - "' + flag + '"\n' for flag in flags)
    return before + separator + targets.replace(marker, marker + settings, 1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--simulator", action="store_true")
    args = parser.parse_args()
    project = Path("src-tauri/gen/apple/project.yml")
    source = configure_project(project.read_text())
    if args.simulator:
        source = configure_simulator(source)
        (project.parent / "simulator-entitlements.plist").write_bytes(plistlib.dumps({
            "application-identifier": "P99SIMTEST.io.github.rmyou.p99mobile",
            "keychain-access-groups": ["P99SIMTEST.io.github.rmyou.p99mobile"],
        }))
    project.write_text(source)
    subprocess.run(["xcodegen", "generate", "--spec", str(project)], check=True)
