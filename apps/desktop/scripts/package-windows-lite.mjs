import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const workspaceRoot = join(desktopRoot, "..", "..");
const release = process.argv.includes("--release");

if (release && (process.platform !== "win32" || process.arch !== "x64")) {
  throw new Error("A signed Windows release requires a real Windows x64 host.");
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

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run this script through npm.");

await run(
  process.execPath,
  [npmCli, "run", "build:core"],
  process.env,
  workspaceRoot,
);
await run(process.execPath, [npmCli, "run", "verify:bundled-plugins"]);
await run(process.execPath, [npmCli, "run", "build"]);

const builderArgs = [];
if (release) {
  builderArgs.push("--config", "scripts/release-builder.config.cjs");
}
builderArgs.push("--win", "zip", "--x64", "--publish", "never");
await run(
  process.execPath,
  [
    join(desktopRoot, "..", "..", "node_modules", "electron-builder", "cli.js"),
    ...builderArgs,
  ],
  {
    ...process.env,
    ...(release ? {} : { ARTEMIS_ALLOW_CROSS_WINDOWS_ZIP: "1" }),
  },
);
