"""Prepare iOS signing metadata without inventing an encryption declaration."""

import argparse
import json
from pathlib import Path
import plistlib
import re


def create_config(build_number, encryption, directory, source=Path("src-tauri/Info.plist")):
    """Preserve app permissions; omit compliance claims while an answer is pending."""
    if not re.fullmatch(r"[1-9][0-9]{0,3}", build_number):
        raise ValueError("Use a new build number from 1 to 9999.")
    if encryption not in ("", "true", "false"):
        raise ValueError("Encryption declaration must be empty, true, or false.")
    info = plistlib.loads(source.read_bytes())
    info.pop("ITSAppUsesNonExemptEncryption", None)
    approval = info.pop("ITSEncryptionExportComplianceCode", None)
    if encryption:
        info["ITSAppUsesNonExemptEncryption"] = encryption == "true"
        if encryption == "true" and approval:
            info["ITSEncryptionExportComplianceCode"] = approval
    directory = directory.resolve()
    directory.mkdir(parents=True, exist_ok=True)
    plist = directory / "Info.upload.plist"
    plist.write_bytes(plistlib.dumps(info))
    config = directory / "ios-upload.json"
    config.write_text(json.dumps({"bundle": {"iOS": {
        "bundleVersion": build_number, "infoPlist": str(plist),
    }}}) + "\n")
    return config


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--build-number", required=True)
    parser.add_argument("--encryption", default="", choices=("", "true", "false"))
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()
    create_config(args.build_number, args.encryption, args.output_dir)
    if not args.encryption:
        print("Encryption declaration pending: complete it in App Store Connect before testing.")
