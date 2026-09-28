#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, readFile, rm, stat } from "node:fs/promises";
import { capabilityPackManifestSchema } from "@artemis/protocol";

const [manifestPath, archivePath, output] = process.argv.slice(2);
if (!manifestPath || !archivePath || !output?.endsWith(".artemis-office")) {
  throw new Error(
    "Usage: node scripts/office/create-offline-pack.mjs manifest.json runtime.zip output.artemis-office",
  );
}
if ((await stat(manifestPath)).size > 16 * 1024 * 1024)
  throw new Error("Capability manifest is too large");
const manifest = capabilityPackManifestSchema.parse(
  JSON.parse(await readFile(manifestPath, "utf8")),
);
const info = await stat(archivePath);
if (!info.isFile() || info.size !== manifest.archive.downloadBytes)
  throw new Error("Archive size differs from the signed manifest");

// Version 1: 8-byte magic, 4-byte BE JSON length, signed JSON, original ZIP.
// Public-key trust remains with the host; the package cannot add trusted keys.
const json = Buffer.from(JSON.stringify(manifest));
if (json.length > 16 * 1024 * 1024)
  throw new Error("Capability manifest is too large");
const header = Buffer.alloc(12);
header.write("ARTOFF1\n");
header.writeUInt32BE(json.length, 8);
const file = await open(output, "wx", 0o600);
let complete = false;
try {
  await file.writeFile(header);
  await file.writeFile(json);
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(archivePath)) {
    bytes += chunk.length;
    if (bytes > manifest.archive.downloadBytes)
      throw new Error("Archive exceeds signed size");
    hash.update(chunk);
    await file.writeFile(chunk);
  }
  if (
    bytes !== manifest.archive.downloadBytes ||
    hash.digest("hex") !== manifest.archive.sha256
  )
    throw new Error("Archive digest differs from the signed manifest");
  await file.sync();
  complete = true;
} finally {
  await file.close();
  if (!complete) await rm(output, { force: true });
}
console.log(`Created ${output}`);
