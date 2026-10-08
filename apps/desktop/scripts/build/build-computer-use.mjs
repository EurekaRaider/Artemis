import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

export function buildComputerUse(arch = process.arch, development = false) {
  if (process.platform !== "darwin") return;
  if (!["arm64", "x64"].includes(arch))
    throw new Error("Unsupported Computer Use architecture");
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const output = join(
    root,
    "build",
    "computer-use",
    development ? "development" : arch,
  );
  mkdirSync(output, { recursive: true });
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
