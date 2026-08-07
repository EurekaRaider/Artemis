import { mkdtemp, mkdir, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { spawn as spawnPty } from "node-pty";
import { buildSeatbeltLaunch } from "../../../packages/platform/dist/index.js";

if (process.platform !== "darwin") {
  throw new Error("macOS native verification must run on a real macOS host");
}
if (process.arch !== "arm64" && process.arch !== "x64") {
  throw new Error(
    `Unsupported macOS verification architecture: ${process.arch}`,
  );
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`,
    );
  }
  return result.stdout;
}

const defaultAppPath =
  process.arch === "arm64"
    ? resolve("release", "mac-arm64", "Artemis.app")
    : resolve("release", "mac", "Artemis.app");
const appPath = resolve(process.env.ARTEMIS_MAC_APP_PATH ?? defaultAppPath);
const executablePath = join(appPath, "Contents", "MacOS", "Artemis");

run("/usr/bin/codesign", [
  "--verify",
  "--deep",
  "--strict",
  "--verbose=2",
  appPath,
]);
run("/usr/sbin/spctl", [
  "--assess",
  "--type",
  "execute",
  "--verbose=4",
  appPath,
]);
run("/usr/bin/xcrun", ["stapler", "validate", appPath]);
const architectures = run("/usr/bin/lipo", ["-archs", executablePath]);
if (!architectures.split(/\s+/u).includes(process.arch)) {
  throw new Error(`Packaged app does not contain ${process.arch}`);
}

const temporaryRoot = await mkdtemp(
  join(tmpdir(), "artemis-native-validation-"),
);
try {
  const workspacePath = join(temporaryRoot, "workspace");
  const outsidePath = join(temporaryRoot, "outside");
  await mkdir(workspacePath);
  await mkdir(outsidePath);
  const insideLaunch = buildSeatbeltLaunch(
    {
      executable: "/usr/bin/touch",
      args: [join(workspacePath, "inside")],
      cwd: workspacePath,
    },
    { workspacePath, mode: "execute", network: "deny" },
  );
  run(insideLaunch.executable, insideLaunch.args, { cwd: insideLaunch.cwd });

  const outsideLaunch = buildSeatbeltLaunch(
    {
      executable: "/usr/bin/touch",
      args: [join(homedir(), ".artemis-sandbox-escape")],
      cwd: workspacePath,
    },
    { workspacePath, mode: "execute", network: "deny" },
  );
  const outsideResult = spawnSync(
    outsideLaunch.executable,
    outsideLaunch.args,
    {
      cwd: outsideLaunch.cwd,
      encoding: "utf8",
    },
  );
  if (outsideResult.status === 0) {
    await rm(join(homedir(), ".artemis-sandbox-escape"), {
      force: true,
    });
    throw new Error("Seatbelt allowed a write outside the workspace");
  }

  const networkLaunch = buildSeatbeltLaunch(
    {
      executable: "/usr/bin/curl",
      args: ["--max-time", "5", "https://example.com"],
      cwd: workspacePath,
    },
    { workspacePath, mode: "execute", network: "deny" },
  );
  const networkResult = spawnSync(
    networkLaunch.executable,
    networkLaunch.args,
    {
      cwd: networkLaunch.cwd,
      encoding: "utf8",
    },
  );
  if (networkResult.status === 0) {
    throw new Error("Seatbelt allowed outbound network access");
  }

  const ptyLaunch = buildSeatbeltLaunch(
    {
      executable: "/bin/zsh",
      args: ["-lc", "printf ARTEMIS_PTY_OK"],
      cwd: workspacePath,
    },
    { workspacePath, mode: "execute", network: "deny" },
  );
  const ptyOutput = await new Promise((resolvePromise, reject) => {
    const pty = spawnPty(ptyLaunch.executable, ptyLaunch.args, {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: ptyLaunch.cwd,
      env: { ...process.env, ...ptyLaunch.env },
    });
    let output = "";
    pty.onData((data) => {
      output += data;
    });
    pty.onExit(({ exitCode }) => {
      if (exitCode !== 0) reject(new Error(`PTY exited with ${exitCode}`));
      else resolvePromise(output);
    });
  });
  if (!ptyOutput.includes("ARTEMIS_PTY_OK")) {
    throw new Error("macOS PTY output marker was not observed");
  }

  const rollbackRoot = join(temporaryRoot, "rollback");
  const rollbackTarget = join(rollbackRoot, "Artemis.app");
  const rollbackArchive = join(rollbackRoot, "previous.zip");
  const healthMarker = join(rollbackRoot, "healthy.marker");
  await mkdir(rollbackRoot);
  run("/usr/bin/ditto", [appPath, rollbackTarget]);
  run("/usr/bin/ditto", ["-c", "-k", "--keepParent", appPath, rollbackArchive]);
  const rollbackResult = spawnSync(
    "/bin/bash",
    [
      resolve("resources", "update-rollback.sh"),
      healthMarker,
      rollbackArchive,
      rollbackTarget,
      "999999",
      "10",
    ],
    {
      cwd: resolve("."),
      encoding: "utf8",
      env: { ...process.env, ARTEMIS_ROLLBACK_NO_LAUNCH: "1" },
    },
  );
  if (rollbackResult.status !== 2) {
    throw new Error(
      `macOS rollback watchdog failed:\n${rollbackResult.stderr || rollbackResult.stdout}`,
    );
  }
  run("/usr/bin/codesign", ["--verify", "--deep", "--strict", rollbackTarget]);
  if (!(await stat(`${rollbackTarget}.failed-update`)).isDirectory()) {
    throw new Error("macOS rollback did not retain the failed application");
  }
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log(
  `macOS ${process.arch} native validation passed: signature, notarization, stapling, Seatbelt PTY and rollback.`,
);
