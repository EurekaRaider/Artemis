// CLI: build the design capability pack for artemis-design.
//
// Outputs under artifacts/design-pack/<version>/:
//   artemis-design-<platform>-<arch>.zip  (one archive, per-platform names)
//   manifest-<platform>-<arch>.json       (signed)
//   catalog.json                          (signed manifests + public key)
//   report.json
//
// Signing key resolution (first wins):
//   1. --key <pem-file>            (CI passes the owner-held key file)
//   2. DESIGN_PACK_ED25519_PRIVATE_KEY env (PEM, CI secret)
//   3. dev key at artifacts/design-pack/dev-key.json (generated on first use)
//
// OWNER SETUP (one-time, see .github/workflows/design-pack-release.yml):
//   - generate an ed25519 keypair; put the PRIVATE pem in the
//     DESIGN_PACK_ED25519_PRIVATE_KEY secret and publish the PUBLIC pem
//     inside the app's bundled design catalog.
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
} from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  buildCatalog,
  inventoryTree,
  signManifest,
  treeDigest,
  unsignedManifests,
  zipEntries,
} from "./pack.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..", "..");
const DEFAULT_SOURCE = join(
  repoRoot,
  "apps/desktop/resources/design-plugins/artemis-design",
);

// First-version platform scope (PR #245 review decision): darwin-arm64 only.
// The runtime's sandbox probe (design-plugin-thread-runtime.ts defaultProbe)
// has a verified Seatbelt path on Apple Silicon; no darwin-x64 manifest is
// signed and the Windows AppContainer sandbox has not landed, so publishing
// other targets would advertise installs that refuse to start. Expand this
// list only together with the runtime probe change and an install→run
// acceptance pass on the new platform.
export const DESIGN_PACK_PLATFORMS = [{ platform: "darwin", arch: "arm64" }];

async function main() {
  const argv = process.argv.slice(2);
  function option(name) {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  }
  const version = option("--version");
  if (!version || !/^\d+\.\d+\.\d+$/.test(version))
    throw new Error(
      "usage: build-design-pack.mjs --version x.y.z [--key pem] [--out dir]",
    );
  const keyArg = option("--key");
  const outArg =
    option("--out") ?? join(repoRoot, "artifacts/design-pack", version);
  const hostVersion = JSON.parse(
    await readFile(join(repoRoot, "apps/desktop/package.json"), "utf8"),
  ).version;
  const hostMajor = Number(hostVersion.split(".")[0]);
  const hostRange = `>=${hostVersion} <${hostMajor + 1}`;

  const sourceRoot = DEFAULT_SOURCE;
  const files = await inventoryTree(sourceRoot);
  const sourceDigest = treeDigest(files);
  const entries = [];
  for (const file of files)
    entries.push({
      name: file.path,
      bytes: await readFile(join(sourceRoot, file.path)),
      executable: file.executable,
    });
  const archive = zipEntries(entries);

  const platforms = DESIGN_PACK_PLATFORMS;
  const unsigned = unsignedManifests({
    id: "artemis-design",
    version,
    hostRange,
    files,
    sourceDigest,
    archive: {
      sha256: createHash("sha256").update(archive).digest("hex"),
      downloadBytes: archive.length,
    },
    platforms,
  });

  let privateKeyPem;
  let publicKeyPem;
  let keyId;
  let keySource;
  if (keyArg) {
    privateKeyPem = await readFile(resolve(keyArg), "utf8");
    keySource = `key-file:${keyArg}`;
  } else if (process.env.DESIGN_PACK_ED25519_PRIVATE_KEY) {
    privateKeyPem = process.env.DESIGN_PACK_ED25519_PRIVATE_KEY.replaceAll(
      "\\n",
      "\n",
    );
    keySource = "env:DESIGN_PACK_ED25519_PRIVATE_KEY";
  } else {
    // Local rehearsal key: persisted so install→update flows reuse one trust root.
    const devKeyPath = join(repoRoot, "artifacts/design-pack/dev-key.json");
    try {
      const saved = JSON.parse(await readFile(devKeyPath, "utf8"));
      privateKeyPem = saved.privateKey;
      publicKeyPem = saved.publicKey;
      keyId = saved.keyId;
      keySource = `dev-key:${devKeyPath}`;
    } catch {
      const pair = generateKeyPairSync("ed25519");
      privateKeyPem = pair.privateKey
        .export({ type: "pkcs8", format: "pem" })
        .toString();
      publicKeyPem = pair.publicKey
        .export({ type: "spki", format: "pem" })
        .toString();
      keyId = "design-pack-dev";
      await mkdir(dirname(devKeyPath), { recursive: true });
      await writeFile(
        devKeyPath,
        JSON.stringify(
          { privateKey: privateKeyPem, publicKey: publicKeyPem, keyId },
          null,
          2,
        ),
        { mode: 0o600 },
      );
      keySource = `dev-key-generated:${devKeyPath}`;
    }
  }
  if (!keyId) keyId = keyArg ? "design-pack-release" : "design-pack-dev";
  // The catalog carries the public key; derive it from the private key so a
  // lost/absent public half never produces a broken catalog.
  const derivedPublic = createPublicKey(createPrivateKey(privateKeyPem))
    .export({ type: "spki", format: "pem" })
    .toString();
  publicKeyPem = derivedPublic;

  const out = resolve(outArg);
  await mkdir(out, { recursive: true });
  const manifests = [];
  for (const item of unsigned) {
    const signed = signManifest(item, { privateKeyPem, keyId });
    const archiveName = `artemis-design-${item.platform}-${item.arch}.zip`;
    await writeFile(join(out, archiveName), archive, { mode: 0o600 });
    await writeFile(
      join(out, `manifest-${item.platform}-${item.arch}.json`),
      JSON.stringify(signed, null, 2),
    );
    manifests.push(signed);
  }
  // --offline: wrap the first platform's manifest + archive into the single-file
  // container the app's offline import accepts (AROFF1 header + manifest length
  // + manifest JSON + archive bytes).
  if (argv.includes("--offline")) {
    const manifestBytes = Buffer.from(JSON.stringify(manifests[0]), "utf8");
    if (manifestBytes.length > 16 * 1024 * 1024)
      throw new Error("Offline manifest too large");
    const header = Buffer.alloc(12);
    header.write("ARTOFF1\n");
    header.writeUInt32BE(manifestBytes.length, 8);
    await writeFile(
      join(out, `artemis-design.artemis-design`),
      Buffer.concat([header, manifestBytes, archive]),
      { mode: 0o600 },
    );
  }
  const catalog = buildCatalog(manifests, publicKeyPem, keyId);
  await writeFile(join(out, "catalog.json"), JSON.stringify(catalog, null, 2));
  const report = {
    schemaVersion: 1,
    id: "artemis-design",
    version,
    hostRange,
    hostVersion,
    keySource,
    keyId,
    files: files.length,
    archiveBytes: archive.length,
    archiveSha256: unsigned[0].archive.sha256,
    platforms: platforms.map(({ platform, arch }) => `${platform}-${arch}`),
    releaseTag: `artemis-design-v${version}`,
  };
  await writeFile(join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
