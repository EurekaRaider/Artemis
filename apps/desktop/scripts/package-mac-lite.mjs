import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const workspaceRoot = join(desktopRoot, "..", "..");
const targetArch = process.argv[2] ?? "all";
const additionalArguments = process.argv.slice(3);
const releaseMode =
  additionalArguments.length === 1 && additionalArguments[0] === "--release";
const targetArchitectures =
  targetArch === "all"
    ? ["arm64", "x64"]
    : targetArch === "arm64" || targetArch === "x64"
      ? [targetArch]
      : undefined;

if (!targetArchitectures) {
  throw new Error(
    `Unsupported macOS package architecture: ${targetArch}. Expected all, arm64 or x64.`,
  );
}
if (additionalArguments.length > 0 && !releaseMode) {
  throw new Error("The only supported packaging option is --release.");
}

if (process.platform !== "darwin") {
  throw new Error("macOS packages must be built on macOS.");
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
const packageEnvironment = {
  ...process.env,
  ARTEMIS_PACKAGE_BUILD: "1",
};

await run(process.execPath, ["scripts/build-macos-icon.mjs"]);

if (releaseMode) {
  await run(process.execPath, ["scripts/validate-release-env.mjs", "mac"]);
}

async function stageX64CanvasPackage() {
  if (!targetArchitectures.includes("x64")) return async () => {};

  const packageName = "@napi-rs/canvas-darwin-x64";
  const canvasMetadata = JSON.parse(
    await readFile(
      join(workspaceRoot, "node_modules", "@napi-rs", "canvas", "package.json"),
      "utf8",
    ),
  );
  const version = canvasMetadata.optionalDependencies?.[packageName];
  if (typeof version !== "string" || !version) {
    throw new Error(`${packageName} is not pinned by @napi-rs/canvas.`);
  }

  const packageRoot = join(
    workspaceRoot,
    "node_modules",
    "@napi-rs",
    "canvas-darwin-x64",
  );
  try {
    const installed = JSON.parse(
      await readFile(join(packageRoot, "package.json"), "utf8"),
    );
    if (installed.name !== packageName || installed.version !== version) {
      throw new Error(
        `${packageName} ${version} is required, but ${installed.version ?? "an unknown version"} is installed.`,
      );
    }
    return async () => {};
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const stagingRoot = await mkdtemp(
    join(tmpdir(), "artemis-macos-native-dependency-"),
  );
  let packageCreated = false;
  try {
    await run(process.execPath, [
      npmCli,
      "pack",
      `${packageName}@${version}`,
      "--pack-destination",
      stagingRoot,
    ]);
    const archives = (await readdir(stagingRoot)).filter((name) =>
      name.endsWith(".tgz"),
    );
    if (archives.length !== 1) {
      throw new Error(
        `Expected one ${packageName} archive, found ${archives.length}.`,
      );
    }
    await mkdir(packageRoot, { recursive: true });
    packageCreated = true;
    await run("/usr/bin/tar", [
      "-xzf",
      join(stagingRoot, archives[0]),
      "-C",
      packageRoot,
      "--strip-components=1",
    ]);
    const installed = JSON.parse(
      await readFile(join(packageRoot, "package.json"), "utf8"),
    );
    if (installed.name !== packageName || installed.version !== version) {
      throw new Error(`The staged ${packageName} package is invalid.`);
    }
  } catch (error) {
    if (packageCreated) {
      await rm(packageRoot, { recursive: true, force: true });
    }
    await rm(stagingRoot, { recursive: true, force: true });
    throw error;
  }

  return async () => {
    await rm(packageRoot, { recursive: true, force: true });
    await rm(stagingRoot, { recursive: true, force: true });
  };
}

await run(
  process.execPath,
  [npmCli, "run", "build:core"],
  process.env,
  workspaceRoot,
);
await run(process.execPath, [npmCli, "run", "verify:bundled-plugins"]);
await run(process.execPath, [npmCli, "run", "build"], packageEnvironment);
const cleanupStagedDependencies = await stageX64CanvasPackage();
try {
  await run(
    process.execPath,
    [
      join(
        desktopRoot,
        "..",
        "..",
        "node_modules",
        "electron-builder",
        "cli.js",
      ),
      "--config",
      releaseMode
        ? "scripts/release-builder.config.cjs"
        : "scripts/engineering-builder.config.cjs",
      "--mac",
      "dmg",
      "zip",
      ...targetArchitectures.map((architecture) => `--${architecture}`),
      "--publish",
      "never",
    ],
    packageEnvironment,
  );
} finally {
  await cleanupStagedDependencies();
}

if (releaseMode) {
  await run(process.execPath, ["scripts/finalize-release.mjs"]);
}
