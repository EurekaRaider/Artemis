// Promote the exact accepted ZIP; do not rebuild, repackage or Authenticode-sign it.
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
} from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import {
  canonicalCapabilityJson,
  capabilityPackManifestSchema,
} from "@artemis/protocol";
const candidate = "artifacts/office/candidate";
const out = "artifacts/office/windows-release";
const report = JSON.parse(
  await readFile(join(candidate, "report.json"), "utf8"),
);
const expected = report.archive.sha256;
if (
  !process.env.OFFICE_CANDIDATE_COMMIT ||
  report.commit !== process.env.OFFICE_CANDIDATE_COMMIT ||
  !/^[a-f0-9]{64}$/.test(expected)
)
  throw Error("Candidate is not from the verified source commit");
const hash = createHash("sha256");
let bytes = 0;
for await (const chunk of createReadStream(
  join(candidate, "office-core-win32-x64.zip"),
)) {
  hash.update(chunk);
  bytes += chunk.length;
}
if (hash.digest("hex") !== expected || bytes !== report.archive.downloadBytes)
  throw Error("Candidate bytes changed");
const catalog = JSON.parse(
  await readFile("apps/desktop/resources/office-runtime/catalog.json", "utf8"),
);
const input = JSON.parse(
  await readFile(join(candidate, "catalog.json"), "utf8"),
).manifests[0];
const version = process.env.OFFICE_RUNTIME_VERSION;
if (!/^\d+\.\d+\.\d+$/.test(version ?? ""))
  throw Error("A stable runtime version is required");
const keyId = "artemis-office-release-2026-09";
const key = createPrivateKey(
  process.env.OFFICE_RUNTIME_ED25519_PRIVATE_KEY ?? "",
);
if (
  key.asymmetricKeyType !== "ed25519" ||
  createPublicKey(key).export({ type: "spki", format: "pem" }).toString() !==
    catalog.publicKeys[keyId]
)
  throw Error("Release key does not match the existing host trust root");
const { signature: _signature, ...unsigned } = input;
unsigned.version = version;
unsigned.hostRange = ">=1.6.9 <2.0.0";
unsigned.archive.url = `https://github.com/EurekaRaider/Artemis/releases/download/office-runtime-v${version}/office-core-win32-x64-${version}.zip`;
const manifest = capabilityPackManifestSchema.parse({
  ...unsigned,
  signature: {
    keyId,
    value: sign(
      null,
      Buffer.from(canonicalCapabilityJson(unsigned)),
      key,
    ).toString("base64"),
  },
});
if (
  manifest.platform !== "win32" ||
  manifest.arch !== "x64" ||
  manifest.archive.sha256 !== expected ||
  manifest.native.windows.find((entry) => entry.path === manifest.entrypoint)
    ?.signer !== null
)
  throw Error("Unexpected Windows runtime policy");
catalog.manifests = [
  ...catalog.manifests.filter(
    (m) => m.platform !== "win32" || m.arch !== "x64",
  ),
  manifest,
];
await mkdir(out, { recursive: true });
const archive = join(out, `office-core-win32-x64-${version}.zip`);
const manifestPath = join(
  out,
  `office-core-win32-x64-${version}.manifest.json`,
);
await copyFile(join(candidate, "office-core-win32-x64.zip"), archive);
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
await writeFile(
  join(out, "catalog.json"),
  JSON.stringify(catalog, null, 2) + "\n",
);
await copyFile("scripts/office/sources.json", join(out, "sources.json"));
execFileSync(
  process.execPath,
  [
    "scripts/office/create-offline-pack.mjs",
    manifestPath,
    archive,
    join(out, `office-core-win32-x64-${version}.artemis-office`),
  ],
  { stdio: "inherit" },
);
console.log(`Prepared Windows runtime ${version}; retained ZIP ${expected}`);
