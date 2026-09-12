#!/usr/bin/env python3
"""Collect shipped license texts and public source references without private build paths."""

import argparse
import hashlib
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def local_path(value):
    """Also allow a WSL maintainer to read metadata produced by Windows Cargo."""
    value = value.replace("\\", "/")
    if os.name != "nt" and len(value) > 2 and value[1] == ":":
        value = "/mnt/" + value[0].lower() + value[2:]
    return Path(value)


def license_files(directory, explicit=None):
    files = {p for p in directory.iterdir() if p.is_file() and p.name.lower().startswith(("license", "copying", "notice", "copyright", "unlicense"))}
    for name in ("LICENSES", "licenses"):
        if (directory / name).is_dir():
            files.update(p for p in (directory / name).rglob("*") if p.is_file())
    if explicit and (directory / explicit).is_file():
        files.add(directory / explicit)
    return sorted(files)


def collect(metadata, node_modules):
    """Follow normal Cargo dependencies and npm production packages from their lockfiles."""
    packages = {p["id"]: p for p in metadata["packages"]}
    nodes = {p["id"]: p for p in metadata["resolve"]["nodes"]}
    todo = [metadata["resolve"]["root"]]
    seen = set()
    components = []
    while todo:
        key = todo.pop()
        if key in seen:
            continue
        seen.add(key)
        todo.extend(d["pkg"] for d in nodes[key]["deps"] if any(k["kind"] is None for k in d["dep_kinds"]))
        package = packages[key]
        if not package.get("source"):
            continue  # The application and its local plugins share the root MIT license.
        source = package["source"]
        if source.startswith("registry+"):
            source = f"https://crates.io/crates/{package['name']}/{package['version']}"
        components.append((
            "Rust: " + package["name"] + " " + package["version"],
            package.get("license") or "Not declared in this upstream package; see DEPENDENCIES.md",
            source,
            license_files(local_path(package["manifest_path"]).parent, package.get("license_file")),
        ))
    npm = json.loads((ROOT / "package-lock.json").read_text())
    for name, package in npm["packages"].items():
        if not name or package.get("dev"):
            continue
        relative = name.removeprefix("node_modules/")
        components.append((
            "JavaScript: " + relative + " " + package["version"],
            package.get("license", "See upstream source"),
            "https://www.npmjs.com/package/" + relative + "/v/" + package["version"],
            license_files(node_modules / relative),
        ))
    app_license = (ROOT / "LICENSE").read_text().strip()
    texts = {hashlib.sha256(app_license.encode()).hexdigest(): app_license}
    sections = []
    for name, license_name, source, paths in sorted(components):
        references = []
        for path in paths:
            text = path.read_text(encoding="utf-8", errors="replace").replace("\r\n", "\n").strip()
            digest = hashlib.sha256(text.encode()).hexdigest()
            texts[digest] = text
            references.append(digest)
        section = [name, "Declared license: " + license_name, "Source: " + source]
        if references:
            section.append("License texts: " + ", ".join(references))
        else:
            section.append("The published package omits a separate license file; refer to the source and declared license above.")
        sections.append("\n".join(section))
    preamble = """P99 Mobile Chat - third-party notices

This file records normal Cargo dependencies (including proc-macro dependencies)
and npm production dependencies resolved by the committed lockfiles. Some code
is used only while compiling; this list intentionally retains its attribution.
License expressions below are upstream declarations, not relicensing by this app.
Available original license files are reproduced below, deduplicated by SHA-256.
The exact upstream package/source links identify corresponding source code.
MPL-2.0 components remain available under MPL-2.0 at those versioned source links;
the application license does not restrict your rights to those components.

AndroidX and Google Material Components are Apache-2.0 projects from the Android
Open Source Project / Google. See https://android.googlesource.com/platform/frameworks/support/
and https://github.com/material-components/material-components-android . The full
Apache-2.0 text is included in the license-text collection below.

The application and its local native plugins use the root MIT license.
The offline item snapshot is separately attributed to P99 Gear Planner, Wermhat,
the Project 1999 Wiki community, and EQEmu/PEQ. See DEPENDENCIES.md and
src-tauri/data/README.md for provenance and unresolved redistribution terms.
Game content and trademarks are not relicensed by the application MIT license.

COMPONENTS
"""
    output = preamble + "\n\n".join(sections) + "\n\nLICENSE TEXTS\n"
    for digest, text in sorted(texts.items()):
        output += "\n===== " + digest + " =====\n" + text + "\n"
    return output, len(components), len(texts)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("metadata", type=Path)
    parser.add_argument("--node-modules", type=Path, default=ROOT / "node_modules")
    args = parser.parse_args()
    output, components, texts = collect(json.loads(args.metadata.read_text(encoding="utf-8")), args.node_modules)
    (ROOT / "public/THIRD-PARTY-NOTICES.txt").write_text(output, encoding="utf-8")
    print(f"Collected {components} component references and {texts} license texts")


if __name__ == "__main__":
    main()
