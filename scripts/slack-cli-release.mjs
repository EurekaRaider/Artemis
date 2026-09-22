import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export const slackCliLockPath = new URL(
  "../slack-cli.lock.json",
  import.meta.url,
);
const repository = "slackapi/slack-cli";
const api = `https://api.github.com/repos/${repository}/releases`;
export const slackCliTargets = {
  "darwin-arm64": { suffix: "macOS_arm64.zip", executable: "slack" },
  "darwin-x64": { suffix: "macOS_amd64.zip", executable: "slack" },
  "win32-x64": { suffix: "windows_64-bit.zip", executable: "bin/slack.exe" },
};
const stableTag = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const digest = /^[a-f0-9]{64}$/u;
export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");

export function latestStableRelease(releases) {
  const stable = releases.filter(
    (release) =>
      !release.draft && !release.prerelease && stableTag.test(release.tag_name),
  );
  stable.sort((a, b) => {
    const left = a.tag_name.slice(1).split(".").map(Number);
    const right = b.tag_name.slice(1).split(".").map(Number);
    return right[0] - left[0] || right[1] - left[1] || right[2] - left[2];
  });
  if (!stable[0])
    throw new Error(
      "Slack CLI: no official stable release could be confirmed.",
    );
  return stable[0];
}

// Every invocation contacts upstream. Neither a cached success nor an offline
// environment can satisfy the release gate. Retries and response sizes are bounded.
export async function fetchSlackBytes(
  url,
  {
    fetchImpl = fetch,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    limit = 64 * 1024 * 1024,
  } = {},
) {
  const headers = {
    "User-Agent": "Artemis-Slack-CLI-Gate",
    "Cache-Control": "no-cache",
    Accept: "application/vnd.github+json",
  };
  if (url.startsWith("https://api.github.com/") && process.env.GITHUB_TOKEN)
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  let reason = "network failure";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetchImpl(url, {
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) {
        reason = `HTTP ${response.status}`;
        await response.body?.cancel();
        if (![403, 408, 429].includes(response.status) && response.status < 500)
          break;
      } else {
        if (Number(response.headers.get("content-length")) > limit)
          throw new Error("response too large");
        const chunks = [];
        let size = 0;
        for await (const chunk of response.body) {
          size += chunk.length;
          if (size > limit) throw new Error("response too large");
          chunks.push(chunk);
        }
        return Buffer.concat(chunks);
      }
    } catch {
      reason = "network failure or invalid response";
    }
    if (attempt < 2) await sleep(1000 * (attempt + 1));
  }
  throw new Error(
    `Slack CLI: cannot confirm upstream (${reason}). Packaging and release are blocked.`,
  );
}

export async function fetchLatestSlackRelease(options) {
  const latest = JSON.parse(await fetchSlackBytes(`${api}/latest`, options));
  const releases = JSON.parse(
    await fetchSlackBytes(`${api}?per_page=100`, options),
  );
  if (!Array.isArray(releases))
    throw new Error("Slack CLI: invalid official release list.");
  const stable = latestStableRelease(releases);
  if (
    latestStableRelease([latest]).tag_name !== stable.tag_name ||
    latest.id !== stable.id
  )
    throw new Error(
      "Slack CLI: official latest release and stable release list disagree.",
    );
  return latest;
}

export function slackReleaseAssets(release) {
  if (latestStableRelease([release]) !== release)
    throw new Error("Invalid Slack CLI release.");
  const version = release.tag_name.slice(1);
  return Object.fromEntries(
    Object.entries(slackCliTargets).map(([target, { suffix, executable }]) => {
      const name = `slack_cli_${version}_${suffix}`;
      const matches =
        release.assets?.filter((asset) => asset.name === name) ?? [];
      const asset = matches[0];
      const url = `https://github.com/${repository}/releases/download/v${version}/${name}`;
      if (
        matches.length !== 1 ||
        asset.browser_download_url !== url ||
        !/^sha256:[a-f0-9]{64}$/u.test(asset.digest) ||
        !Number.isSafeInteger(asset.size) ||
        asset.size <= 0
      )
        throw new Error(
          `Slack CLI: missing or invalid official asset for ${target}.`,
        );
      return [
        target,
        {
          url,
          sha256: asset.digest.slice(7),
          archiveBytes: asset.size,
          executable,
        },
      ];
    }),
  );
}

export function assertSlackLock(lock, release) {
  if (
    lock.schemaVersion !== 1 ||
    lock.repository !== repository ||
    !stableTag.test(`v${lock.version}`)
  )
    throw new Error("Slack CLI: invalid lock manifest.");
  if (
    lock.version !== release.tag_name.slice(1) ||
    lock.releaseId !== release.id
  )
    throw new Error(
      `Slack CLI ${lock.version} is not the latest stable ${release.tag_name}. Run npm run update:slack-cli, review and validate all platforms, then rebuild.`,
    );
  const assets = slackReleaseAssets(release);
  if (
    Object.keys(lock.targets ?? {})
      .sort()
      .join() !== Object.keys(assets).sort().join()
  )
    throw new Error(
      "Slack CLI: lock must contain exactly the three supported platforms.",
    );
  for (const [target, expected] of Object.entries(assets)) {
    const pinned = lock.targets[target];
    for (const key of Object.keys(expected)) {
      if (pinned[key] !== expected[key])
        throw new Error(
          `Slack CLI: ${target} ${key} does not match the official release.`,
        );
    }
    if (
      !digest.test(pinned.binarySha256) ||
      !digest.test(pinned.contentSha256) ||
      !Number.isSafeInteger(pinned.binaryBytes) ||
      pinned.binaryBytes <= 0
    )
      throw new Error(`Slack CLI: invalid executable identity for ${target}.`);
  }
}

export async function downloadSlackAsset(asset, options) {
  const bytes = await fetchSlackBytes(asset.url, options);
  if (bytes.length !== asset.archiveBytes || sha256(bytes) !== asset.sha256)
    throw new Error("Slack CLI: official archive SHA-256 or size mismatch.");
  return bytes;
}

export async function verifySlackCliRelease(options) {
  const lock = JSON.parse(await readFile(slackCliLockPath, "utf8"));
  const release = await fetchLatestSlackRelease(options);
  assertSlackLock(lock, release);
  for (const asset of Object.values(lock.targets))
    await downloadSlackAsset(asset, options);
  return lock;
}

// Code signatures are intentionally excluded: Artemis signs nested executables
// during packaging. All load commands and executable data remain authenticated.
export function slackBinaryIdentity(bytes) {
  if (bytes.length < 64) throw new Error("Slack CLI: truncated executable.");
  if (bytes.readUInt32LE(0) === 0xfeedfacf) {
    const cpu = bytes.readUInt32LE(4);
    const target =
      cpu === 0x100000c
        ? "darwin-arm64"
        : cpu === 0x1000007
          ? "darwin-x64"
          : undefined;
    if (!target) throw new Error("Slack CLI: unsupported Mach-O architecture.");
    const count = bytes.readUInt32LE(16),
      commandsEnd = 32 + bytes.readUInt32LE(20);
    if (commandsEnd > bytes.length)
      throw new Error("Slack CLI: invalid Mach-O header.");
    const header = Buffer.from(bytes.subarray(0, 32));
    header.fill(0, 16, 24);
    const commands = [];
    let offset = 32,
      signatureStart = bytes.length;
    for (let i = 0; i < count; i++) {
      const command = bytes.readUInt32LE(offset),
        size = bytes.readUInt32LE(offset + 4);
      if (size < 8 || offset + size > commandsEnd)
        throw new Error("Slack CLI: invalid Mach-O command.");
      const data = Buffer.from(bytes.subarray(offset, offset + size));
      if (command === 0x1d) {
        signatureStart = data.readUInt32LE(8);
        if (
          signatureStart < commandsEnd ||
          signatureStart + data.readUInt32LE(12) !== bytes.length
        )
          throw new Error("Slack CLI: invalid code signature range.");
      } else {
        if (
          command === 0x19 &&
          data.toString("ascii", 8, 24).replaceAll("\0", "") === "__LINKEDIT"
        ) {
          data.fill(0, 32, 40); // vmsize includes the signature
          data.fill(0, 48, 56); // filesize includes the signature
        }
        commands.push(data);
      }
      offset += size;
    }
    if (offset !== commandsEnd)
      throw new Error("Slack CLI: invalid Mach-O commands length.");
    let dataStart = commandsEnd,
      dataEnd = signatureStart;
    while (dataStart < dataEnd && bytes[dataStart] === 0) dataStart++;
    while (dataEnd > dataStart && bytes[dataEnd - 1] === 0) dataEnd--;
    return {
      target,
      contentSha256: sha256(
        Buffer.concat([
          header,
          ...commands,
          bytes.subarray(dataStart, dataEnd),
        ]),
      ),
    };
  }
  if (bytes.readUInt16LE(0) === 0x5a4d) {
    const offset = bytes.readUInt32LE(0x3c);
    if (
      offset + 264 > bytes.length ||
      bytes.toString("ascii", offset, offset + 4) !== "PE\0\0" ||
      bytes.readUInt16LE(offset + 4) !== 0x8664 ||
      bytes.readUInt16LE(offset + 24) !== 0x20b
    )
      throw new Error("Slack CLI: expected a Windows x64 PE executable.");
    const data = Buffer.from(bytes),
      certificateDirectory = offset + 24 + 112 + 4 * 8;
    const certificateStart = data.readUInt32LE(certificateDirectory),
      certificateSize = data.readUInt32LE(certificateDirectory + 4);
    if (certificateStart && certificateStart + certificateSize !== data.length)
      throw new Error("Slack CLI: invalid PE certificate range.");
    data.fill(0, offset + 24 + 64, offset + 24 + 68);
    data.fill(0, certificateDirectory, certificateDirectory + 8);
    let end = certificateStart || data.length;
    while (end > 0 && data[end - 1] === 0) end--;
    return {
      target: "win32-x64",
      contentSha256: sha256(data.subarray(0, end)),
    };
  }
  throw new Error("Slack CLI: unsupported executable format.");
}

export function assertSlackBinary(
  bytes,
  target,
  lock,
  { unsigned = false } = {},
) {
  const identity = slackBinaryIdentity(bytes),
    expected = lock.targets[target];
  if (
    identity.target !== target ||
    identity.contentSha256 !== expected?.contentSha256 ||
    (unsigned &&
      (sha256(bytes) !== expected.binarySha256 ||
        bytes.length !== expected.binaryBytes))
  )
    throw new Error(
      `Slack CLI: packaged executable content or architecture does not match ${target} ${lock.version}.`,
    );
}
