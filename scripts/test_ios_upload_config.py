import json
from pathlib import Path
import plistlib
import tempfile
import unittest

from ios_upload_config import create_config


class UploadConfigTests(unittest.TestCase):
    def prepare(self, directory, encryption, build_number="1"):
        source = Path(directory) / "Info.plist"
        source.write_bytes(plistlib.dumps({
            "NSFaceIDUsageDescription": "Unlock a saved character.",
            "UIUserInterfaceStyle": "Dark",
            "ITSAppUsesNonExemptEncryption": False,
            "ITSEncryptionExportComplianceCode": "previous-declaration",
        }))
        config = create_config(build_number, encryption, Path(directory) / "upload", source)
        settings = json.loads(config.read_text())["bundle"]["iOS"]
        return settings, plistlib.loads(Path(settings["infoPlist"]).read_bytes())

    def test_pending_declaration_cannot_inherit_an_exemption_or_approval(self):
        with tempfile.TemporaryDirectory() as directory:
            settings, info = self.prepare(directory, "")
            self.assertEqual(settings["bundleVersion"], "1")
            self.assertNotIn("ITSAppUsesNonExemptEncryption", info)
            self.assertNotIn("ITSEncryptionExportComplianceCode", info)
            self.assertEqual(info["NSFaceIDUsageDescription"], "Unlock a saved character.")
            self.assertEqual(info["UIUserInterfaceStyle"], "Dark")

    def test_explicit_declarations_are_booleans_and_approval_is_not_used_for_exemption(self):
        for value in ("true", "false"):
            with self.subTest(value=value), tempfile.TemporaryDirectory() as directory:
                _, info = self.prepare(directory, value)
                self.assertIs(info["ITSAppUsesNonExemptEncryption"], value == "true")
                self.assertEqual("ITSEncryptionExportComplianceCode" in info, value == "true")

    def test_invalid_build_numbers_and_answers_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            for number in ("0", "01", "10000", "1.1", "", "-1"):
                with self.subTest(number=number), self.assertRaisesRegex(ValueError, "build number"):
                    self.prepare(directory, "", number)
            with self.assertRaisesRegex(ValueError, "Encryption declaration"):
                self.prepare(directory, "yes")
