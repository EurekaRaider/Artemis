import { execFile } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  assertSlackBinary,
  downloadSlackAsset,
  sha256,
  slackBinaryIdentity,
  slackCliLockPath,
} from "./slack-cli-release.mjs";

const exec = promisify(execFile);
export const slackCliStagingRoot = fileURLToPath(
  new URL("../artifacts/slack-cli/", import.meta.url),
);

export function lockedSlackLicense(bytes, expectedSha256) {
  if (sha256(bytes) === expectedSha256) return bytes;
  const normalized = Buffer.from(
    bytes.toString("utf8").replaceAll("\r\n", "\n"),
  );
  if (sha256(normalized) !== expectedSha256)
    throw new Error("Slack CLI: license does not match the lock.");
  return normalized;
}

export async function unpackSlackAsset(asset, bytes, operation) {
  const directory = await mkdtemp(join(tmpdir(), "artemis-slack-cli-"));
  try {
    const archive = join(directory, "cli.zip");
    await writeFile(archive, bytes);
    const { extract } = await import("@electron-internal/extract-zip");
    const destination = join(directory, "unpacked");
    await extract(archive, { dir: destination });
    const executable = join(destination, asset.executable);
    return await operation(executable, await readFile(executable));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function stageSlackCli(target, lock) {
  const asset = lock.targets[target];
  if (!asset) throw new Error(`Unsupported Slack CLI target: ${target}`);
  const archive = await downloadSlackAsset(asset);
  const directory = join(slackCliStagingRoot, target);
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  await unpackSlackAsset(asset, archive, async (file, bytes) => {
    assertSlackBinary(bytes, target, lock, { unsigned: true });
    const executable = join(
      directory,
      target.startsWith("win32") ? "slack.exe" : "slack",
    );
    await copyFile(file, executable);
    await chmod(executable, 0o755);
  });
  const license = lockedSlackLicense(
    await readFile(
      new URL("../third-party/slack-cli-LICENSE.txt", import.meta.url),
    ),
    lock.licenseSha256,
  );
  await writeFile(join(directory, "LICENSE.txt"), license);
  await writeFile(
    join(directory, "slack-cli.lock.json"),
    JSON.stringify(lock, null, 2) + "\n",
  );
  return directory;
}

export async function verifyPackagedSlackCli(
  directory,
  target,
  { native = true } = {},
) {
  const lock = JSON.parse(await readFile(slackCliLockPath, "utf8"));
  const embedded = JSON.parse(
    await readFile(join(directory, "slack-cli.lock.json"), "utf8"),
  );
  if (JSON.stringify(embedded) !== JSON.stringify(lock))
    throw new Error("Slack CLI: packaged lock differs from the source lock.");
  const binaryName = target.startsWith("win32") ? "slack.exe" : "slack";
  const files = (await readdir(directory)).sort();
  if (
    files.join() !==
    ["LICENSE.txt", binaryName, "slack-cli.lock.json"].sort().join()
  )
    throw new Error(
      "Slack CLI: unexpected packaged files or multiple platform binaries.",
    );
  const executable = resolve(directory, binaryName),
    bytes = await readFile(executable);
  assertSlackBinary(bytes, target, lock);
  if (
    sha256(await readFile(join(directory, "LICENSE.txt"))) !==
    lock.licenseSha256
  )
    throw new Error("Slack CLI: packaged license mismatch.");
  if (native) {
    if (`${process.platform}-${process.arch}` !== target)
      throw new Error(
        "Slack CLI: native verification requires the target OS and architecture.",
      );
    const versionCommand = exec(executable, ["--version"], {
      timeout: process.platform === "win32" ? 60000 : 15000,
      maxBuffer: 16384,
      windowsHide: true,
    });
    versionCommand.child.stdin.end();
    const { stdout } = await versionCommand;
    if (stdout.trim() !== `Using slack v${lock.version}`)
      throw new Error(
        "Slack CLI: packaged executable reports the wrong version.",
      );
  }
  return {
    target,
    version: lock.version,
    bytes: bytes.length,
    ...slackBinaryIdentity(bytes),
  };
}
