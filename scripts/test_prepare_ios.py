from pathlib import Path
import plistlib
import unittest

from prepare_ios import configure_project, configure_simulator


class PrepareIOSTests(unittest.TestCase):
    def test_manifest_is_a_resource_of_the_app_not_the_template(self):
        source = "name: Example\ntargetTemplates:\n  app:\n    sources:\n      - path: Sources\ntargets:\n  Example_iOS:\n    sources:\n      - path: Sources\n"
        result = configure_project(source)
        self.assertNotIn("PrivacyInfo", result.split("\ntargets:\n")[0])
        self.assertIn("path: ../../PrivacyInfo.xcprivacy\n        buildPhase: resources", result)
        self.assertEqual(configure_project(result), result)

    def test_unrecognized_project_is_rejected(self):
        with self.assertRaises(ValueError):
            configure_project("name: ChangedTemplate")

    def test_simulator_identity_is_scoped_to_simulator_linking(self):
        source = "name: Example\ntargetTemplates:\n  app:\n    settings:\n      base:\n        EXISTING: true\ntargets:\n  Example_iOS:\n    settings:\n      base:\n        EXISTING: true\n"
        result = configure_simulator(source)
        self.assertNotIn("OTHER_LDFLAGS", result.split("\ntargets:\n")[0])
        self.assertIn('"OTHER_LDFLAGS[sdk=iphonesimulator*]"', result)
        self.assertNotIn("CODE_SIGN_ENTITLEMENTS", result)
        self.assertEqual(configure_simulator(result), result)

    def test_committed_manifest_is_valid_and_does_not_declare_tracking(self):
        manifest = Path(__file__).resolve().parents[1] / "src-tauri/PrivacyInfo.xcprivacy"
        privacy = plistlib.loads(manifest.read_bytes())
        self.assertFalse(privacy["NSPrivacyTracking"])
        self.assertEqual(privacy["NSPrivacyTrackingDomains"], [])
        self.assertEqual(len(privacy["NSPrivacyAccessedAPITypes"]), 2)
