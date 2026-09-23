from pathlib import Path
import plistlib
import tempfile
import unittest
import zipfile

from verify_ios import verify


class VerifyIOSTests(unittest.TestCase):
    def candidate(self, directory, *, platform="iphoneos", manifest=True, simulator_identity=False,
                  extra_info=None):
        path = Path(directory) / "candidate.ipa"
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr("Payload/Example.app/Info.plist", plistlib.dumps({
                "CFBundleIdentifier": "io.github.rmyou.p99mobile",
                "CFBundleExecutable": "Example",
                "CFBundleVersion": "12", "DTPlatformName": platform,
                "NSFaceIDUsageDescription": "Unlock a saved character.",
                **(extra_info or {}),
            }))
            archive.writestr("Payload/Example.app/Example",
                             b"P99SIMTEST" if simulator_identity else b"example executable")
            if manifest:
                archive.writestr("Payload/Example.app/PrivacyInfo.xcprivacy", plistlib.dumps({}))
        return path

    def test_pending_declaration_rejects_an_embedded_compliance_claim(self):
        with tempfile.TemporaryDirectory() as directory:
            verify(self.candidate(directory), encryption="")
            for declaration in ({"ITSAppUsesNonExemptEncryption": False},
                                {"ITSEncryptionExportComplianceCode": "old-approval"}):
                with self.subTest(declaration=declaration), self.assertRaisesRegex(ValueError, "compliance claim"):
                    verify(self.candidate(directory, extra_info=declaration), encryption="")

    def test_explicit_declaration_must_match_the_packaged_boolean(self):
        with tempfile.TemporaryDirectory() as directory:
            for value in ("true", "false"):
                path = self.candidate(directory, extra_info={"ITSAppUsesNonExemptEncryption": value == "true"})
                verify(path, encryption=value)
                with self.assertRaisesRegex(ValueError, "does not match"):
                    verify(path, encryption="false" if value == "true" else "true")

    def test_unsigned_candidate_does_not_pass_distribution_verification(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self.candidate(directory)
            verify(path, "12")
            with self.assertRaisesRegex(ValueError, "Provisioning"):
                verify(path, "12", signed=True)

    def test_missing_manifest_wrong_platform_and_wrong_build_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "privacy"):
                verify(self.candidate(directory, manifest=False))
            with self.assertRaisesRegex(ValueError, "device build"):
                verify(self.candidate(directory, platform="iphonesimulator"))
            with self.assertRaisesRegex(ValueError, "build number"):
                verify(self.candidate(directory), "13")
            with self.assertRaisesRegex(ValueError, "Simulator test identity"):
                verify(self.candidate(directory, simulator_identity=True))
