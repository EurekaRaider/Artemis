import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { buildComputerPreview } from "./build-computer-preview.mjs";

export function buildComputerUse(arch = process.arch, development = false) {
  if (!["darwin", "win32"].includes(process.platform)) return;
  if (!["arm64", "x64"].includes(arch))
    throw new Error("Unsupported Computer Use architecture");
  if (process.platform === "win32" && arch !== "x64")
    throw new Error("Windows Computer Use requires x64");
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const output = join(
    root,
    "build",
    "computer-use",
    development ? "development" : arch,
  );
  mkdirSync(output, { recursive: true });
  buildComputerPreview(output, arch);
  if (process.platform === "win32") {
    const nativeBuild = join(output, "helper-build");
    const configuration = development ? "Debug" : "Release";
    execFileSync(
      "cmake",
      [
        "-S",
        join(root, "native/computer-use/windows"),
        "-B",
        nativeBuild,
        "-A",
        "x64",
      ],
      { stdio: "inherit" },
    );
    execFileSync(
      "cmake",
      [
        "--build",
        nativeBuild,
        "--config",
        configuration,
        "--target",
        "artemis-computer-use",
      ],
      { stdio: "inherit" },
    );
    copyFileSync(
      join(nativeBuild, configuration, "artemis-computer-use.exe"),
      join(output, "artemis-computer-use.exe"),
    );
    return;
  }
  execFileSync(
    "xcrun",
    [
      "swiftc",
      "-parse-as-library",
      "-swift-version",
      "5",
      "-O",
      ...(development ? ["-D", "DEBUG"] : []),
      "-target",
      `${arch === "x64" ? "x86_64" : "arm64"}-apple-macosx14.0`,
      "-module-cache-path",
      join(root, "build", "swift-module-cache"),
      ...readdirSync(join(root, "native", "computer-use", "macos"))
        .filter((name) => name.endsWith(".swift"))
        .sort()
        .map((name) => join(root, "native", "computer-use", "macos", name)),
      "-o",
      join(output, "artemis-computer-use"),
    ],
    { stdio: "inherit" },
  );
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  buildComputerUse(
    process.argv[2] ?? process.arch,
    process.argv.includes("--development"),
  );
