// Sign already-built runtime bytes. Native signing and notarization happen first.
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
} from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  canonicalCapabilityJson,
  capabilityPackManifestSchema,
} from "@artemis/protocol";

const [input, archive, output, keyId] = process.argv.slice(2);
if (!input || !archive || !output || !keyId)
  throw new Error(
    "Usage: OFFICE_RUNTIME_ED25519_PRIVATE_KEY=... node scripts/office/sign-release.mjs manifest.json runtime.zip output-directory key-id",
  );
const privateKey = createPrivateKey(
  process.env.OFFICE_RUNTIME_ED25519_PRIVATE_KEY ?? "",
);
if (privateKey.asymmetricKeyType !== "ed25519")
  throw new Error("The Office release key must be Ed25519");
const { signature: _signature, ...unsigned } =
  capabilityPackManifestSchema.parse(JSON.parse(await readFile(input, "utf8")));
const hash = createHash("sha256");
let bytes = 0;
for await (const chunk of createReadStream(archive)) {
  bytes += chunk.length;
  hash.update(chunk);
}
if (
  bytes !== unsigned.archive.downloadBytes ||
  hash.digest("hex") !== unsigned.archive.sha256 ||
  basename(new URL(unsigned.archive.url).pathname) !== basename(archive)
)
  throw new Error("Release archive differs from the prepared manifest");
const manifest = capabilityPackManifestSchema.parse({
  ...unsigned,
  signature: {
    keyId,
    value: sign(
      null,
      Buffer.from(canonicalCapabilityJson(unsigned)),
      privateKey,
    ).toString("base64"),
  },
});
const catalog = {
  schemaVersion: 1,
  publicKeys: {
    [keyId]: createPublicKey(privateKey)
      .export({ type: "spki", format: "pem" })
      .toString(),
  },
  manifests: [manifest],
  updateUrl:
    "https://raw.githubusercontent.com/EurekaRaider/Artemis/main/apps/desktop/resources/office-runtime/catalog.json",
};
await mkdir(output, { recursive: true });
for (const [name, data] of [
  [basename(archive).replace(/\.zip$/u, ".manifest.json"), manifest],
  ["catalog.json", catalog],
])
  await writeFile(join(output, name), JSON.stringify(data, null, 2) + "\n", {
    flag: "wx",
  });
console.log(
  `Signed office-core ${manifest.version} ${manifest.platform}-${manifest.arch}`,
);
