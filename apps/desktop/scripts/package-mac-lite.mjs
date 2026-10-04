import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifySlackCliRelease } from "../../../scripts/slack-cli-release.mjs";
import { verifyPackagedSlackCli } from "../../../scripts/slack-cli-package.mjs";
import { loadMacSigningEnvironment } from "./macos-signing-config.mjs";
import { notarizeExistingMacApp } from "./notarize-macos-app.mjs";
import { buildComputerUse } from "./build-computer-use.mjs";
import {
  collectMacUpdateMetadata,
  writeMacUpdateMetadata,
} from "./macos-update-metadata.mjs";

const desktopRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const workspaceRoot = join(desktopRoot, "..", "..");
const targetArch = process.argv[2] ?? "all";
const additionalArguments = process.argv.slice(3);
const releaseMode =
  additionalArguments.length === 1 && additionalArguments[0] === "--release";
const signOnly =
  additionalArguments.length === 1 && additionalArguments[0] === "--sign-only";
const notarizeOnly =
  additionalArguments.length === 1 &&
  additionalArguments[0] === "--notarize-only";
const signedMode = releaseMode || signOnly || notarizeOnly;
const targetArchitectures =
  targetArch === "all" || targetArch === "arm64" ? ["arm64"] : undefined;

if (!targetArchitectures) {
  throw new Error(
    `Unsupported macOS package architecture: ${targetArch}. Expected arm64 (all is an alias for arm64).`,
  );
}
if (additionalArguments.length > 0 && !signedMode) {
  throw new Error(
    "Supported packaging options: --release, --sign-only, --notarize-only.",
  );
}

if (process.platform !== "darwin") {
  throw new Error("macOS packages must be built on macOS.");
}

function run(
  command,
  args,
  environment = process.env,
  cwd = desktopRoot,
  stdio = "inherit",
) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: environment,
      stdio,
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
// Reuse an existing local GitHub login for the required upstream version gate.
// Keep the token in memory only; CI supplies its own credentials.
if (signedMode && !process.env.CI && !process.env.GITHUB_TOKEN) {
  try {
    const token = execFileSync("gh", ["auth", "token"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10000,
    }).trim();
    if (token) process.env.GITHUB_TOKEN = token;
  } catch {
    // Without gh, the upstream gate still runs using unauthenticated requests.
  }
}
// CI remains controlled by its environment; interactive builds remember setup.
const localSigning =
  process.env.CI || !signedMode ? undefined : await loadMacSigningEnvironment();
const packageEnvironment = {
  ...localSigning,
  ...process.env,
  ARTEMIS_PACKAGE_BUILD: "1",
};

if (signedMode) {
  await run(
    process.execPath,
    signOnly
      ? ["scripts/validate-release-env.mjs", "mac", "--sign-only"]
      : ["scripts/validate-release-env.mjs", "mac"],
    packageEnvironment,
  );
  if (!signOnly && packageEnvironment.APPLE_KEYCHAIN_PROFILE) {
    await run(
      "/usr/bin/xcrun",
      [
        "notarytool",
        "history",
        "--keychain-profile",
        packageEnvironment.APPLE_KEYCHAIN_PROFILE,
        ...(packageEnvironment.APPLE_KEYCHAIN
          ? ["--keychain", packageEnvironment.APPLE_KEYCHAIN]
          : []),
      ],
      packageEnvironment,
      desktopRoot,
      ["ignore", "ignore", "inherit"],
    );
  }
  console.log(
    signOnly
      ? "Signing only; Apple notarization is not requested."
      : "Apple notarization is required.",
  );
}

await verifySlackCliRelease();
if (!notarizeOnly)
  await run(process.execPath, ["scripts/build-macos-icon.mjs"]);

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

if (!notarizeOnly) {
  for (const arch of targetArchitectures) buildComputerUse(arch);
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
        signedMode
          ? "scripts/release-builder.config.cjs"
          : "scripts/engineering-builder.config.cjs",
        "--mac",
        "dmg",
        "zip",
        ...targetArchitectures.map((architecture) => `--${architecture}`),
        "--publish",
        "never",
        ...(signOnly ? ["-c.mac.notarize=false"] : []),
      ],
      packageEnvironment,
    );
  } finally {
    await cleanupStagedDependencies();
  }
} else {
  const { version } = JSON.parse(
    await readFile(join(desktopRoot, "package.json"), "utf8"),
  );
  const metadata = new Map();
  for (const arch of targetArchitectures) {
    const appPath = join(
      desktopRoot,
      "release",
      arch === "arm64" ? "mac-arm64" : "mac",
      "Artemis.app",
    );
    await notarizeExistingMacApp(appPath, version, packageEnvironment);
    // Stapling does not necessarily change the app directory mtime used by
    // electron-builder's archive cache. Always rebuild the pre-notarization ZIP.
    await rm(
      join(desktopRoot, "release", `Artemis-macOS-${arch}-${version}.zip`),
      { force: true },
    );
    await run(
      process.execPath,
      [
        join(workspaceRoot, "node_modules", "electron-builder", "cli.js"),
        "--config",
        "scripts/release-builder.config.cjs",
        "--prepackaged",
        appPath,
        "--mac",
        "dmg",
        "zip",
        `--${arch}`,
        "--publish",
        "never",
      ],
      packageEnvironment,
    );
    await collectMacUpdateMetadata(
      join(desktopRoot, "release"),
      metadata,
      version,
    );
  }
  await writeMacUpdateMetadata(join(desktopRoot, "release"), metadata);
}

for (const arch of targetArchitectures) {
  await verifyPackagedSlackCli(
    join(
      desktopRoot,
      "release",
      arch === "arm64" ? "mac-arm64" : "mac",
      "Artemis.app",
      "Contents",
      "Resources",
      "slack-cli",
    ),
    `darwin-${arch}`,
    { native: process.arch === arch },
  );
}
await verifySlackCliRelease();

if (signedMode) {
  for (const arch of targetArchitectures) {
    const appPath = join(
      desktopRoot,
      "release",
      arch === "arm64" ? "mac-arm64" : "mac",
      "Artemis.app",
    );
    await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", appPath]);
    if (!signOnly) {
      await run("/usr/bin/xcrun", ["stapler", "validate", appPath]);
      await run("/usr/sbin/spctl", ["--assess", "--type", "execute", appPath]);
    }
  }
  await run(
    process.execPath,
    ["scripts/finalize-release.mjs"],
    packageEnvironment,
  );
}
