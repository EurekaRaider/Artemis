// Read-only app-CD check. Never builds, signs, notarizes, uploads or edits a runtime.
import { createHash, createPublicKey, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import { satisfies } from "semver";
import {
  capabilityPackManifestSchema,
  capabilityArchiveDownloadUrl,
  canonicalCapabilityJson,
} from "../../packages/protocol/src/capability-pack.ts";

const catalog = JSON.parse(
  await readFile("apps/desktop/resources/office-runtime/catalog.json", "utf8"),
);
const { version } = JSON.parse(await readFile("package.json", "utf8"));
if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.manifests))
  throw new Error("Invalid runtime catalog");
for (const item of catalog.manifests) {
  const manifest = capabilityPackManifestSchema.parse(item);
  const { signature, ...unsigned } = manifest;
  const key = createPublicKey(catalog.publicKeys[signature.keyId]);
  if (
    key.asymmetricKeyType !== "ed25519" ||
    !verify(
      null,
      Buffer.from(canonicalCapabilityJson(unsigned)),
      key,
      Buffer.from(signature.value, "base64"),
    )
  )
    throw new Error("Invalid catalog signature");
  if (!satisfies(version, manifest.hostRange))
    throw new Error(
      "Host is outside the published runtime compatibility range",
    );
  const response = await fetch(
    capabilityArchiveDownloadUrl(manifest.archive.url),
  );
  if (!response.ok || !response.body)
    throw new Error("Published runtime asset is unavailable");
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > manifest.archive.downloadBytes)
      throw new Error("Published runtime size changed");
    hash.update(chunk);
  }
  if (
    bytes !== manifest.archive.downloadBytes ||
    hash.digest("hex") !== manifest.archive.sha256
  )
    throw new Error("Published runtime bytes changed");
  console.log(
    `Reused immutable office-core ${manifest.version} ${manifest.platform}-${manifest.arch}`,
  );
}
if (!catalog.manifests.length)
  console.log(
    "No accepted Office runtime is advertised; Lite remains available.",
  );
