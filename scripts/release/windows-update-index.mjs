import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
} from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  canonicalUpdatePayload,
  verifyUpdateIndex,
} from "../../apps/desktop/src/main/updates/signed-update-index.ts";

export async function signWindowsUpdateIndex(
  directory,
  version,
  { privateKey, keyId, sequence, keys },
) {
  if (!privateKey || !keyId || !Number.isSafeInteger(sequence) || sequence <= 0)
    throw new Error(
      "Windows update signing key, key ID and positive release sequence are required",
    );
  const key = createPrivateKey(privateKey);
  if (
    key.asymmetricKeyType !== "ed25519" ||
    createPublicKey(key).export({ type: "spki", format: "pem" }).toString() !==
      keys[keyId]
  )
    throw new Error(
      "Windows signing key does not match the shipped public key",
    );
  const assets = [];
  for (const extension of ["exe", "zip"]) {
    const name = `Artemis-Windows-x64-${version}.${extension}`;
    const bytes = await readFile(join(directory, name));
    assets.push({
      name,
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  const payload = {
    version,
    platform: "win32",
    arch: "x64",
    distribution: "nsis",
    sequence,
    minUpdaterVersion: 1,
    assets,
  };
  const envelope = {
    schemaVersion: 1,
    keyId,
    payload,
    signature: sign(
      null,
      Buffer.from(canonicalUpdatePayload(payload)),
      key,
    ).toString("base64"),
  };
  const bytes = Buffer.from(JSON.stringify(envelope, null, 2) + "\n");
  verifyUpdateIndex(bytes, keys);
  await writeFile(join(directory, "windows-x64-update.json"), bytes);
}
