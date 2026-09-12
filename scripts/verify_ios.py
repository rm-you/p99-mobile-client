"""Check a built device IPA's identity, packaged resources, and release entitlements."""

import argparse
from pathlib import Path
import plistlib
import subprocess
import tempfile
import zipfile


def verify(path, build_number=None, signed=False):
    with zipfile.ZipFile(path) as archive:
        infos = [n for n in archive.namelist() if n.startswith("Payload/")
                 and n.count("/") == 2 and n.endswith(".app/Info.plist")]
        if len(infos) != 1:
            raise ValueError("Expected one application in the IPA")
        root = infos[0].rsplit("/", 1)[0]
        info = plistlib.loads(archive.read(infos[0]))
        if info.get("CFBundleIdentifier") != "io.github.rmyou.p99mobile":
            raise ValueError("Unexpected application identity")
        if info.get("DTPlatformName") != "iphoneos":
            raise ValueError("Expected a device build, not a Simulator build")
        if build_number and info.get("CFBundleVersion") != build_number:
            raise ValueError("Unexpected iOS build number")
        if not info.get("NSFaceIDUsageDescription"):
            raise ValueError("Face ID purpose string is missing")
        if root + "/PrivacyInfo.xcprivacy" not in archive.namelist():
            raise ValueError("App privacy manifest is missing")
        if signed:
            if root + "/embedded.mobileprovision" not in archive.namelist():
                raise ValueError("Provisioning profile is missing")
            with tempfile.TemporaryDirectory() as directory:
                # Build output is trusted, but reject unexpected paths before extracting it.
                for entry in archive.namelist():
                    if Path(entry).is_absolute() or ".." in Path(entry).parts:
                        raise ValueError("Invalid IPA path")
                # Preserve executable permissions and framework symlinks for codesign.
                subprocess.run(["ditto", "-x", "-k", str(path), directory], check=True)
                app = str(Path(directory) / root)
                subprocess.run(["codesign", "--verify", "--deep", "--strict", app], check=True)
                entitlements = plistlib.loads(subprocess.check_output(
                    ["codesign", "-d", "--entitlements", ":-", app], stderr=subprocess.DEVNULL))
                if entitlements.get("get-task-allow"):
                    raise ValueError("A distribution build must not allow debugging")
                identity = entitlements.get("application-identifier", "")
                if not identity.endswith("." + info["CFBundleIdentifier"]):
                    raise ValueError("Signed application identity is missing or incorrect")
    print("Device IPA identity and resources verified" + ("; distribution signature verified." if signed else "; unsigned candidate only."))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("ipa", type=Path)
    parser.add_argument("--build-number")
    parser.add_argument("--signed", action="store_true")
    args = parser.parse_args()
    verify(args.ipa, args.build_number, args.signed)
