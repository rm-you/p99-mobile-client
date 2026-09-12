#!/usr/bin/env python3
"""Validate versioned sources and sign/audit direct-download Android releases."""

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import subprocess
import tempfile
import tomllib
import zipfile

ROOT = Path(__file__).resolve().parents[1]
TAG = re.compile(r"v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.([1-9]\d*))?")
PRIVATE_SUFFIXES = (".jks", ".keystore", ".p12", ".pfx", ".pcap", ".pcapng", ".jsonl", ".log")
PRIVATE_NAMES = {"keystore.properties", "settings.json", "profiles.json", "p99.json", "p99-login.json", "chat-history.sqlite", ".env"}


class ReleaseError(ValueError):
    """A safe diagnostic containing no private file contents or tool arguments."""


def require(condition, message):
    if not condition:
        raise ReleaseError(message)


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def manifest(root=ROOT):
    """Keep every app version and the explicit Android update counter consistent."""
    config = read_json(root / "src-tauri/tauri.conf.json")
    package = read_json(root / "package.json")
    npm_lock = read_json(root / "package-lock.json")
    cargo = tomllib.loads((root / "src-tauri/Cargo.toml").read_text())
    cargo_lock = tomllib.loads((root / "src-tauri/Cargo.lock").read_text())
    locked = next(p for p in cargo_lock["package"] if p["name"] == "p99-mobile-client")
    version = config["version"]
    require(all(v == version for v in [package["version"], npm_lock["version"], npm_lock["packages"][""]["version"], cargo["package"]["version"], locked["version"]]), "App versions differ between manifests or lockfiles")
    require(TAG.fullmatch("v" + version), "Unsupported release version; use X.Y.Z or X.Y.Z-rc.N")
    code = config["bundle"]["android"]["versionCode"]
    require(type(code) is int and 0 < code <= 2100000000, "Invalid Android versionCode")
    require(config["identifier"] == "io.github.rmyou.p99mobile", "The production application ID changed")
    return config


def signing_identity(root=ROOT):
    identity = read_json(root / "release-signing.json")
    require(re.fullmatch(r"[0-9a-f]{64}", identity["certificate_sha256"]), "Invalid release certificate fingerprint")
    require(re.fullmatch(r"[a-z0-9-]+", identity["key_alias"]), "Invalid signing key alias")
    return identity


def private_path(name):
    path = Path(name)
    return path.name in PRIVATE_NAMES or path.name.endswith(PRIVATE_SUFFIXES) or ".local" in path.parts


def check(tag, root=ROOT):
    """Reject mismatched tags and private build artifacts before release work starts."""
    config = manifest(root)
    require(TAG.fullmatch(tag) and tag == "v" + config["version"], "Tag must exactly match the configured app version")
    signing_identity(root)
    tracked = subprocess.check_output(["git", "ls-files", "-z"], cwd=root).decode().split("\0")
    require(not any(private_path(p) for p in tracked if p), "Private artifacts are tracked in Git")
    return {"version": config["version"], "version_code": config["bundle"]["android"]["versionCode"], "prerelease": "-rc." in tag}


def android_tool(name):
    sdk = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")
    require(sdk, "Set ANDROID_HOME to the Android SDK")
    suffix = (".bat" if name == "apksigner" else ".exe") if os.name == "nt" else ""
    tool = Path(sdk) / "build-tools" / "36.0.0" / (name + suffix)
    require(tool.is_file(), "Install Android build-tools 36.0.0")
    return str(tool)


def run(*args):
    """Capture SDK output; never echo arguments or signing secrets on failure."""
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    require(result.returncode == 0, Path(args[0]).stem + " failed; signing secrets were not logged")
    return result.stdout


def inspect_zip(apk):
    """Check release contents and every ARM64 ELF load segment without extracting files."""
    with zipfile.ZipFile(apk) as archive:
        names = archive.namelist()
        require(not any(private_path(n) for n in names), "APK contains private runtime or signing files")
        libraries = [n for n in names if n.endswith(".so")]
        require("lib/arm64-v8a/libp99_mobile_client_lib.so" in libraries, "ARM64 client library is missing")
        for name in libraries:
            require(name.startswith("lib/arm64-v8a/"), "Unexpected APK architecture")
            data = archive.read(name)
            require(data[:6] == b"\x7fELF\x02\x01" and struct.unpack_from("<H", data, 18)[0] == 183, "Invalid ARM64 ELF library")
            offset = struct.unpack_from("<Q", data, 32)[0]
            stride, count = struct.unpack_from("<HH", data, 54)
            alignments = [struct.unpack_from("<Q", data, offset + i * stride + 48)[0] for i in range(count) if struct.unpack_from("<I", data, offset + i * stride)[0] == 1]
            require(alignments and all(a >= 16384 for a in alignments), "Native library lacks 16 KiB page alignment")


def verify(apk):
    """Verify app identity, version, release certificate, and non-debuggable packaging."""
    config = manifest()
    identity = signing_identity()
    signature = run(android_tool("apksigner"), "verify", "--verbose", "--print-certs", str(apk))
    certificates = re.findall(r"Signer #\d+ certificate SHA-256 digest: ([0-9a-fA-F]+)", signature)
    require([c.lower() for c in certificates] == [identity["certificate_sha256"]], "APK is not signed with the pinned production certificate")
    run(android_tool("zipalign"), "-c", "-P", "16", "4", str(apk))
    badging = run(android_tool("aapt"), "dump", "badging", str(apk))
    require("application-debuggable" not in badging, "Debuggable APK cannot be released")
    require("package: name='" + config["identifier"] + "'" in badging, "APK application ID mismatch")
    require("versionName='" + config["version"] + "'" in badging, "APK version mismatch")
    require("versionCode='" + str(config["bundle"]["android"]["versionCode"]) + "'" in badging, "APK versionCode mismatch")
    inspect_zip(apk)


def sign(unsigned, output, keystore=None):
    """Use an external keystore or a CI secret; passwords travel only in the environment."""
    identity = signing_identity()
    require(os.environ.get("ANDROID_KEYSTORE_PASSWORD"), "ANDROID_KEYSTORE_PASSWORD is missing")
    require(not output.exists(), "Refusing to overwrite an existing signed APK")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="p99-sign-") as directory:
        temporary = Path(directory)
        if keystore is None:
            encoded = os.environ.get("ANDROID_KEYSTORE_BASE64")
            require(encoded, "ANDROID_KEYSTORE_BASE64 is missing")
            keystore = temporary / "release.p12"
            with keystore.open("xb") as handle:
                os.chmod(keystore, 0o600)
                handle.write(base64.b64decode(encoded, validate=True))
        aligned = temporary / "aligned.apk"
        run(android_tool("zipalign"), "-P", "16", "4", str(unsigned), str(aligned))
        run(android_tool("apksigner"), "sign", "--ks", str(keystore), "--ks-key-alias", identity["key_alias"], "--ks-pass", "env:ANDROID_KEYSTORE_PASSWORD", "--key-pass", "env:ANDROID_KEYSTORE_PASSWORD", "--out", str(output), str(aligned))
    verify(output)


def bundle(apk, tag):
    """Write public release metadata and checksums only after the APK passes verification."""
    info = check(tag)
    verify(apk)
    info["source_commit"] = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    lock = tomllib.loads((ROOT / "src-tauri/Cargo.lock").read_text())
    info["network_source"] = next(p["source"] for p in lock["package"] if p["name"] == "p99-logger-client")
    info.update(signing_identity())
    info["apk_sha256"] = hashlib.sha256(apk.read_bytes()).hexdigest()
    (apk.parent / "build-info.json").write_text(json.dumps(info, indent=2) + "\n")
    (apk.parent / "SHA256SUMS").write_text(info["apk_sha256"] + "  " + apk.name + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    validate = sub.add_parser("check")
    validate.add_argument("tag")
    validate.add_argument("--github-output", type=Path)
    signer = sub.add_parser("sign")
    signer.add_argument("unsigned", type=Path)
    signer.add_argument("output", type=Path)
    signer.add_argument("--keystore", type=Path)
    audit = sub.add_parser("verify")
    audit.add_argument("apk", type=Path)
    package = sub.add_parser("bundle")
    package.add_argument("apk", type=Path)
    package.add_argument("tag")
    args = parser.parse_args()
    try:
        if args.command == "check":
            info = check(args.tag)
            if args.github_output:
                with args.github_output.open("a") as output:
                    output.write("version=" + info["version"] + "\n")
                    output.write("prerelease=" + str(info["prerelease"]).lower() + "\n")
            print("Release version and tracked-file checks passed")
        elif args.command == "sign":
            sign(args.unsigned, args.output, args.keystore)
            print("Production APK signed and verified")
        elif args.command == "verify":
            verify(args.apk)
            print("Production APK verified")
        else:
            bundle(args.apk, args.tag)
            print("Release metadata and checksums written")
    except ReleaseError as error:
        parser.exit(1, str(error) + "\n")
    except (ValueError, OSError, KeyError, StopIteration, struct.error, zipfile.BadZipFile, subprocess.SubprocessError):
        # Do not serialize exception objects from tools, environment parsing, or private files.
        parser.exit(1, "Release validation failed; check versions, SDK tools, certificate, and required signing secrets.\n")


if __name__ == "__main__":
    main()
