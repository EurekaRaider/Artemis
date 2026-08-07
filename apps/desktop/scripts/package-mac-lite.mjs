import { spawn } from "node:child_process";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const workspaceRoot = join(desktopRoot, "..", "..");
const targetArch = process.argv[2] ?? "arm64";

if (process.platform !== "darwin") {
  throw new Error("macOS packages must be built on macOS.");
}
if (targetArch !== "arm64") {
  throw new Error("The Lite macOS package target is arm64 only.");
}

function run(command, args, environment = process.env, cwd = desktopRoot) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: environment,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else {
        reject(
          new Error(
            `Command failed (${code ?? signal ?? "unknown"}): ${command}`,
          ),
        );
      }
    });
  });
}

function output(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: desktopRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise(stdout.trim());
      else {
        reject(
          new Error(
            `Command failed (${code ?? signal ?? "unknown"}): ${command}\n${stderr.trim()}`,
          ),
        );
      }
    });
  });
}

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run this script through npm.");

let actoolPath;
try {
  actoolPath = await output("/usr/bin/xcrun", ["--find", "actool"]);
} catch (error) {
  throw new Error(
    "Xcode 26 or later is required to compile the macOS Icon Composer asset.",
    { cause: error },
  );
}
if (!isAbsolute(actoolPath)) {
  throw new Error("xcrun returned an invalid actool path.");
}

await run(
  process.execPath,
  [npmCli, "run", "build:core"],
  process.env,
  workspaceRoot,
);
await run(process.execPath, [npmCli, "run", "verify:bundled-plugins"]);
await run(process.execPath, [npmCli, "run", "build"]);
await run(
  process.execPath,
  [
    join(desktopRoot, "..", "..", "node_modules", "electron-builder", "cli.js"),
    "--config",
    "scripts/engineering-builder.config.cjs",
    "--mac",
    "dmg",
    "zip",
    `--${targetArch}`,
    "--publish",
    "never",
  ],
  {
    ...process.env,
    PATH: `${dirname(actoolPath)}:${process.env.PATH ?? ""}`,
  },
);
