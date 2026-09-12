import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const icons = join(root, "src-tauri", "icons");

/** Update already initialized platform projects without replacing their project settings. */
function syncMobileIcons() {
  for (const [source, target] of [
    ["android", "android/app/src/main/res"],
    ["ios", "apple/Assets.xcassets/AppIcon.appiconset"],
  ]) {
    const destination = join(root, "src-tauri", "gen", target);
    if (existsSync(destination)) {
      cpSync(join(icons, source), destination, { recursive: true });
    }
  }
}

if (process.argv.includes("--sync")) {
  syncMobileIcons();
} else {
  // Tauri otherwise writes mobile icons only into an existing generated project.
  // Stage outside it so the complete, reproducible set always lands in the repo.
  const staging = mkdtempSync(join(tmpdir(), "p99-chat-icons-"));
  try {
    const output = join(staging, "icons");
    execFileSync(
      process.execPath,
      [
        join(root, "node_modules", "@tauri-apps", "cli", "tauri.js"),
        "icon",
        join(icons, "source", "icon.json"),
        "--output",
        output,
      ],
      { cwd: root, stdio: "inherit" },
    );
    // Round-icon launchers should use the same adaptive layers on Android 8+.
    // Keep Tauri's round PNGs as the fallback for older Android versions.
    const adaptive = join(output, "android", "mipmap-anydpi-v26");
    cpSync(join(adaptive, "ic_launcher.xml"), join(adaptive, "ic_launcher_round.xml"));
    cpSync(output, icons, { recursive: true });
    mkdirSync(join(root, "public"), { recursive: true });
    cpSync(join(icons, "64x64.png"), join(root, "public", "icon.png"));
    syncMobileIcons();
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
