import { minVersion } from "semver";
import {
  validateNativeAcceptance,
  rejectCatalogRegression,
} from "./release-policy.js";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  computerUsePackManifestSchema,
  type ComputerUsePackManifest,
} from "@artemis/protocol";
import { extractCapabilityZip } from "../../apps/desktop/src/main/capabilities/capability-archive.js";
import { verifyCapabilityManifest } from "../../apps/desktop/src/main/capabilities/capability-pack-service.js";
import { verifyComputerUseNative } from "../../apps/desktop/src/main/computer-use/native-verification.js";

const repo = "EurekaRaider/Artemis";
const version = process.env.COMPUTER_USE_VERSION;
if (!/^\d+\.\d+\.\d+$/u.test(version ?? ""))
  throw new Error("COMPUTER_USE_VERSION must be x.y.z");
const pinned = JSON.parse(
  await readFile("apps/desktop/resources/computer-use/catalog.json", "utf8"),
);
const host = JSON.parse(await readFile("apps/desktop/package.json", "utf8"))
  .version as string;
const output = resolve(
  process.env.COMPUTER_USE_OUTPUT ??
    join("artifacts", "computer-use", version!),
);
const tag = "computer-use-v" + version;
const url = "https://github.com/" + repo + "/releases/download/" + tag + "/";
const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
function verified(input: unknown): ComputerUsePackManifest {
  const manifest = computerUsePackManifestSchema.parse(input);
  if (manifest.version !== version)
    throw new Error("Computer Use release version mismatch");
  return verifyCapabilityManifest(manifest, {
    hostVersion: host,
    platform: manifest.platform,
    arch: manifest.arch,
    packId: "computer-use",
    publicKeys: pinned.publicKeys,
  }) as ComputerUsePackManifest;
}
class PublicDownloadError extends Error {
  constructor(readonly status: number) {
    super("Public release download failed: " + status);
  }
}
async function download(url: string, maximum: number): Promise<Buffer> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(120000),
    redirect: "follow",
  });
  if (
    !response.ok ||
    !response.body ||
    new URL(response.url).protocol !== "https:"
  )
    throw new PublicDownloadError(response.status);
  const parts: Buffer[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maximum) throw new Error("Public release exceeds size bound");
    parts.push(Buffer.from(chunk));
  }
  return Buffer.concat(parts);
}
function gh(args: string[]) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}
async function validateArchive(
  manifest: ComputerUsePackManifest,
  bytes: Buffer,
): Promise<void> {
  if (
    bytes.length !== manifest.archive.downloadBytes ||
    sha(bytes) !== manifest.archive.sha256
  )
    throw new Error("Public archive digest mismatch");
  const temporary = await mkdtemp(join(tmpdir(), "computer-public-"));
  try {
    const archive = join(temporary, "pack.zip"),
      root = join(temporary, "payload");
    await writeFile(archive, bytes);
    await extractCapabilityZip(
      archive,
      root,
      manifest,
      AbortSignal.timeout(60000),
    );
    const plugin = JSON.parse(
      await readFile(
        join(root, manifest.pluginRoot, "artemis.plugin.json"),
        "utf8",
      ),
    );
    if (plugin.name !== "computer-use" || plugin.version !== version)
      throw new Error("Plugin and native package differ");
    if (process.platform === manifest.platform)
      await verifyComputerUseNative(root, manifest);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
async function publicCatalog() {
  const catalog = JSON.parse(
    (await download(url + "catalog.json", 16 * 1024 * 1024)).toString("utf8"),
  );
  const manifests = (catalog.manifests as unknown[]).map(verified);
  if (
    manifests.length !== 2 ||
    new Set(
      manifests.map((manifest) => manifest.platform + "-" + manifest.arch),
    ).size !== 2
  )
    throw new Error("Both platform packs are required");
  for (const manifest of manifests)
    await validateArchive(
      manifest,
      await download(manifest.archive.url, manifest.archive.downloadBytes),
    );
  return { schemaVersion: 1, publicKeys: pinned.publicKeys, manifests };
}
await mkdir(output, { recursive: true });
if (process.argv[2] === "verify") {
  const target = process.platform + "-" + process.arch;
  const manifest = verified(
    JSON.parse(
      await readFile(join(output, "manifest-" + target + ".json"), "utf8"),
    ),
  );
  await validateArchive(
    manifest,
    await readFile(join(output, "computer-use-" + target + ".zip")),
  );
  await writeFile(
    join(output, "verification-" + target + ".json"),
    JSON.stringify(
      {
        archiveSha256: manifest.archive.sha256,
        packVersion: manifest.version,
        sourceDigest: manifest.sourceDigest,
        hostVersion: host,
        arch: manifest.arch,
        checks: {
          "manifest-signature": true,
          "archive-integrity": true,
          "plugin-manifest": true,
          "native-verification": true,
        },
        effectiveAclVerified: process.platform === "win32",
        notarizationVerified: process.platform === "darwin",
      },
      null,
      2,
    ) + "\n",
  );
} else if (process.argv[2] === "publish") {
  const manifests = await Promise.all(
    ["darwin-arm64", "win32-x64"].map(async (target) =>
      verified(
        JSON.parse(
          await readFile(join(output, "manifest-" + target + ".json"), "utf8"),
        ),
      ),
    ),
  );
  for (const manifest of manifests)
    await validateArchive(
      manifest,
      await readFile(
        join(output, new URL(manifest.archive.url).pathname.split("/").at(-1)!),
      ),
    );
  const evidence = Object.fromEntries(
    await Promise.all(
      manifests.map(async (manifest) => [
        manifest.platform,
        JSON.parse(
          await readFile(
            join(
              output,
              "verification-" +
                manifest.platform +
                "-" +
                manifest.arch +
                ".json",
            ),
            "utf8",
          ),
        ),
      ]),
    ),
  );
  validateNativeAcceptance(evidence, manifests, host);
  await writeFile(
    join(output, "native-acceptance.json"),
    JSON.stringify(evidence, null, 2) + "\n",
  );
  await writeFile(
    join(output, "catalog.json"),
    JSON.stringify(
      { schemaVersion: 1, publicKeys: pinned.publicKeys, manifests },
      null,
      2,
    ) + "\n",
  );
  let existing = false;
  try {
    gh(["release", "view", tag, "--repo", repo]);
    existing = true;
  } catch {}
  if (existing)
    throw new Error("Immutable Computer Use version already exists");
  gh([
    "release",
    "create",
    tag,
    "--repo",
    repo,
    "--target",
    process.env.GITHUB_SHA ?? "main",
    "--prerelease",
    "--latest=false",
    "--title",
    "Computer Use " + version,
    "--notes",
    "Verified native capability packs. Ed25519 signatures cover both platform archives. macOS is Developer ID signed, notarized and stapled; Windows installation ACLs are verified.",
    ...[
      "computer-use-darwin-arm64.zip",
      "computer-use-win32-x64.zip",
      "manifest-darwin-arm64.json",
      "manifest-win32-x64.json",
      "catalog.json",
      "native-acceptance.json",
    ].map((name) => join(output, name)),
  ]);
  await publicCatalog();
} else if (process.argv[2] === "promote") {
  const catalog = await publicCatalog();
  // Each native runner verifies its final signed archive before publication.
  const evidence = JSON.parse(
    (await download(url + "native-acceptance.json", 1024 * 1024)).toString(
      "utf8",
    ),
  );
  validateNativeAcceptance(evidence, catalog.manifests, host);
  const stableUrl =
    "https://github.com/" +
    repo +
    "/releases/download/computer-use-stable/catalog.json";
  try {
    const previous = JSON.parse(
      (await download(stableUrl, 16 * 1024 * 1024)).toString("utf8"),
    );
    if (
      previous.schemaVersion !== 1 ||
      !Array.isArray(previous.manifests) ||
      previous.manifests.length > 32
    )
      throw new Error("Invalid previous Computer Use catalog");
    const manifests = previous.manifests.map((input: unknown) => {
      const manifest = computerUsePackManifestSchema.parse(input);
      return verifyCapabilityManifest(manifest, {
        hostVersion: minVersion(manifest.hostRange)?.version ?? "",
        platform: manifest.platform,
        arch: manifest.arch,
        packId: "computer-use",
        publicKeys: pinned.publicKeys,
      }) as ComputerUsePackManifest;
    });
    rejectCatalogRegression(catalog.manifests, manifests);
  } catch (error) {
    if (!(error instanceof PublicDownloadError) || error.status !== 404)
      throw error;
  }
  gh([
    "release",
    "edit",
    tag,
    "--repo",
    repo,
    "--prerelease=false",
    "--latest=false",
  ]);
  let channel = false;
  try {
    gh(["release", "view", "computer-use-stable", "--repo", repo]);
    channel = true;
  } catch {}
  if (!channel)
    gh([
      "release",
      "create",
      "computer-use-stable",
      "--repo",
      repo,
      "--latest=false",
      "--title",
      "Computer Use stable",
      "--notes",
      "Signed platform catalog.",
    ]);
  const path = join(output, "catalog.json");
  await writeFile(path, JSON.stringify(catalog, null, 2) + "\n");
  gh([
    "release",
    "upload",
    "computer-use-stable",
    path,
    "--repo",
    repo,
    "--clobber",
  ]);
  const readback = await download(
    "https://github.com/" +
      repo +
      "/releases/download/computer-use-stable/catalog.json",
    16 * 1024 * 1024,
  );
  if (!readback.equals(await readFile(path)))
    throw new Error("Stable Computer Use catalog readback differs");
} else throw new Error("Usage: run-publisher.mjs verify|publish|promote");
