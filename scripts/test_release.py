"""Synthetic release fixtures: malformed tags and wrong builds never reach signing."""
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import release


class ReleaseTests(unittest.TestCase):
    def test_versions_and_tag_must_match(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "src-tauri").mkdir()
            files = ["package.json", "package-lock.json", "src-tauri/tauri.conf.json", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock", "release-signing.json"]
            for name in files:
                (root / name).write_bytes((release.ROOT / name).read_bytes())
            with patch("release.subprocess.check_output", return_value=b"src/App.tsx\0"):
                version = release.manifest(root)["version"]
                tag = "v" + version
                self.assertEqual(release.check(tag, root)["version"], version)
                for bad_tag in [tag + ".1", tag + "-rc.999", tag + "\nBAD=value", "v0" + version, tag + ";echo BAD"]:
                    with self.subTest(tag=bad_tag), self.assertRaises(release.ReleaseError):
                        release.check(bad_tag, root)
                package = json.loads((root / "package.json").read_text())
                package["version"] = version + ".invalid"
                (root / "package.json").write_text(json.dumps(package))
                with self.assertRaises(release.ReleaseError):
                    release.check(tag, root)

    def test_private_paths_are_rejected(self):
        for name in ["release.p12", "credentials/p99.json", ".local/file", "trace.pcapng", "logs/history.jsonl", "assets/settings.json"]:
            self.assertTrue(release.private_path(name), name)
        for name in ["assets/tauri.conf.json", "src/experience.ts", "LICENSE"]:
            self.assertFalse(release.private_path(name), name)

    def test_wrong_certificate_and_debug_build_fail(self):
        identity = release.signing_identity()
        valid = release.manifest()
        badge = f"package: name='{valid['identifier']}' versionCode='{valid['bundle']['android']['versionCode']}' versionName='{valid['version']}'"
        with patch("release.android_tool", side_effect=lambda x: x):
            with patch("release.run", return_value="Signer #1 certificate SHA-256 digest: " + "0" * 64):
                with self.assertRaisesRegex(release.ReleaseError, "certificate"):
                    release.verify(Path("synthetic.apk"))
            for suffix in ["\napplication-debuggable", ""]:
                signature = "Signer #1 certificate SHA-256 digest: " + identity["certificate_sha256"]
                with patch("release.run", side_effect=[signature, "", badge + suffix]), patch("release.inspect_zip") as inspect:
                    if suffix:
                        with self.assertRaisesRegex(release.ReleaseError, "Debuggable"):
                            release.verify(Path("synthetic.apk"))
                        inspect.assert_not_called()
                    else:
                        release.verify(Path("synthetic.apk"))
                        inspect.assert_called_once()

    def test_elf_alignment_and_archive_private_files(self):
        data = bytearray(120)
        data[:6] = b"\x7fELF\x02\x01"
        struct.pack_into("<H", data, 18, 183)
        struct.pack_into("<Q", data, 32, 64)
        struct.pack_into("<HH", data, 54, 56, 1)
        struct.pack_into("<I", data, 64, 1)
        with tempfile.TemporaryDirectory() as directory:
            for alignment, private in [(16384, False), (4096, False), (16384, True)]:
                struct.pack_into("<Q", data, 112, alignment)
                apk = Path(directory) / "synthetic.apk"
                with zipfile.ZipFile(apk, "w") as archive:
                    archive.writestr("lib/arm64-v8a/libp99_mobile_client_lib.so", data)
                    if private:
                        archive.writestr("assets/p99.json", "{}")
                if alignment == 16384 and not private:
                    release.inspect_zip(apk)
                else:
                    with self.assertRaises(release.ReleaseError):
                        release.inspect_zip(apk)


if __name__ == "__main__":
    unittest.main()
