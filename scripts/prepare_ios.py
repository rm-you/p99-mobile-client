"""Include the app privacy manifest in Tauri's generated Xcode application target."""

from pathlib import Path
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


if __name__ == "__main__":
    project = Path("src-tauri/gen/apple/project.yml")
    project.write_text(configure_project(project.read_text()))
    subprocess.run(["xcodegen", "generate", "--spec", str(project)], check=True)
