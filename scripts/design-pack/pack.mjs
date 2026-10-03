// Design capability-pack builder (todo ③).
//
// Packages apps/desktop/resources/design-plugins/<packId>/ into a ZIP32
// archive, inventories every file (sha256 + bytes), builds a software-pack
// manifest per @artemis/protocol's softwareCapabilityPackManifestSchema and
// signs its canonical JSON with an ed25519 key. The trust chain never sees
// this repository — only the signed artifacts matter, so the same module
// serves local rehearsal (dev key), CI signing (owner-held key) and tests.
//
// ZIP32 writer: store/deflate entries whose sizes are known upfront (no data
// descriptors), regular files only, no ZIP64 — exactly the subset
// extractCapabilityZip accepts.
import { createHash, createPrivateKey, sign } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { deflateRawSync } from "node:zlib";
import { join } from "node:path";
import {
  canonicalCapabilityJson,
  capabilityPackManifestSchema,
} from "@artemis/protocol";

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(bytes) {
  let crc = -1;
  for (let index = 0; index < bytes.length; index++)
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[index]) & 0xff];
  return (crc ^ -1) >>> 0;
}

/**
 * Build a ZIP32 archive buffer from in-memory entries. Names must be
 * forward-slash relative paths; content is deflated when smaller, stored
 * otherwise (both accepted by the reader).
 */
export function zipEntries(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    if (name.length > 0xffff) throw new Error(`ZIP name too long: ${entry.name}`);
    const mode = ((entry.executable ? 0o100755 : 0o100644) << 16) >>> 0;
    const deflated = deflateRawSync(entry.bytes, { level: 6 });
    const method = deflated.length < entry.bytes.length ? 8 : 0;
    const payload = method === 8 ? deflated : entry.bytes;
    const crc = crc32(entry.bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names; sizes are known upfront.
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10); // Time (DOS): deterministic builds.
    local.writeUInt16LE(0x29, 12); // Date (DOS): 1980-01-01.
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(entry.bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x0800, 8);
    directory.writeUInt16LE(method, 10);
    directory.writeUInt16LE(0, 12);
    directory.writeUInt16LE(0, 14);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(payload.length, 20);
    directory.writeUInt32LE(entry.bytes.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(mode, 38); // External attrs: unix mode << 16.
    directory.writeUInt32LE(offset, 42);
    parts.push(local, name, payload);
    central.push(directory, name);
    offset += local.length + name.length + payload.length;
  }
  const centralSize = central.reduce((total, part) => total + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...central, end]);
}

async function fileSha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

/**
 * Inventory a source tree: sorted relative forward-slash paths with size and
 * digest. Symbolic links are rejected — release packaging dereferences them
 * by refusing, mirroring the installer's link hostility.
 */
export async function inventoryTree(root) {
  const files = [];
  const visit = async (prefix) => {
    const entries = (await readdir(prefix, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name),
    );
    for (const entry of entries) {
      const absolute = join(prefix, entry.name);
      if (entry.isSymbolicLink())
        throw new Error(`Design pack source contains a link: ${absolute}`);
      if (entry.isDirectory()) await visit(join(prefix, entry.name));
      else if (entry.isFile())
        files.push({
          path: `${join(prefix, entry.name).slice(root.length + 1).replaceAll("\\", "/")}`,
          bytes: (await stat(absolute)).size,
          sha256: await fileSha256(absolute),
          executable: false,
        });
      else throw new Error(`Unexpected source entry: ${absolute}`);
    }
  };
  await visit(root);
  if (files.length === 0) throw new Error("Design pack source tree is empty");
  return files;
}

/** Deterministic provenance digest of the inventoried tree. */
export function treeDigest(files) {
  const hash = createHash("sha256");
  for (const file of files)
    hash.update(`${file.path}\0${file.bytes}\0${file.sha256}\n`);
  return hash.digest("hex");
}

const RELEASE_BASE =
  "https://github.com/EurekaRaider/ArtemisRelease/releases/download";

/** One unsigned manifest per platform; the archive itself is platform-free. */
export function unsignedManifests({
  id,
  version,
  hostRange,
  files,
  sourceDigest,
  archive,
  platforms = [
    { platform: "darwin", arch: "arm64" },
    { platform: "win32", arch: "x64" },
  ],
}) {
  const unpackedBytes = files.reduce((total, file) => total + file.bytes, 0);
  return platforms.map(({ platform, arch }) => ({
    schemaVersion: 1,
    id,
    version,
    hostRange,
    platform,
    arch,
    sourceDigest,
    archive: {
      url: `${RELEASE_BASE}/${id}-v${version}/${id}-${platform}-${arch}.zip`,
      sha256: archive.sha256,
      downloadBytes: archive.downloadBytes,
      unpackedBytes,
    },
    files,
  }));
}

export function signManifest(unsigned, { privateKeyPem, keyId }) {
  const privateKey = createPrivateKey(privateKeyPem);
  return capabilityPackManifestSchema.parse({
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
}

/** Assemble the signed catalog for a set of manifests under one key. */
export function buildCatalog(manifests, publicKeyPem, keyId) {
  return {
    schemaVersion: 1,
    publicKeys: { [keyId]: publicKeyPem },
    manifests,
  };
}
