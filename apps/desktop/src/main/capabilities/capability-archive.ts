import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createInflateRaw } from "node:zlib";
import {
  capabilityPathSchema,
  type CapabilityPackManifest,
} from "@artemis/protocol";

/** ZIP32 only; no links, devices, encrypted entries, or inferred permissions. */
export async function extractCapabilityZip(
  archive: string,
  destination: string,
  manifest: CapabilityPackManifest,
  signal: AbortSignal,
): Promise<void> {
  const file = await open(archive, "r");
  try {
    const size = (await file.stat()).size;
    const tail = Buffer.alloc(Math.min(size, 65_557));
    await file.read(tail, 0, tail.length, size - tail.length);
    let end = tail.length - 22;
    while (
      end >= 0 &&
      (tail.readUInt32LE(end) !== 0x06054b50 ||
        end + 22 + tail.readUInt16LE(end + 20) !== tail.length)
    )
      end--;
    if (end < 0) throw new Error("Invalid capability ZIP directory");
    const count = tail.readUInt16LE(end + 10);
    const directorySize = tail.readUInt32LE(end + 12);
    const directoryOffset = tail.readUInt32LE(end + 16);
    if (
      tail.readUInt32LE(end + 4) !== 0 ||
      count === 0xffff ||
      tail.readUInt16LE(end + 8) !== count ||
      directorySize > 16 * 1024 * 1024 ||
      directoryOffset + directorySize !== size - tail.length + end
    )
      throw new Error("Unsupported capability ZIP layout");
    const directory = Buffer.alloc(directorySize);
    await file.read(directory, 0, directorySize, directoryOffset);
    const expected = new Map(
      manifest.files.map((entry) => [entry.path, entry]),
    );
    const seen = new Set<string>();
    const entries: Array<{
      name: string;
      start: number;
      compressed: number;
      method: number;
    }> = [];
    let offset = 0;
    for (let i = 0; i < count; i++) {
      if (
        offset + 46 > directory.length ||
        directory.readUInt32LE(offset) !== 0x02014b50
      )
        throw new Error("Invalid capability ZIP entry");
      const flags = directory.readUInt16LE(offset + 8);
      const method = directory.readUInt16LE(offset + 10);
      const compressed = directory.readUInt32LE(offset + 20);
      const expanded = directory.readUInt32LE(offset + 24);
      const nameSize = directory.readUInt16LE(offset + 28);
      const extraSize = directory.readUInt16LE(offset + 30);
      const commentSize = directory.readUInt16LE(offset + 32);
      const mode = directory.readUInt32LE(offset + 38) >>> 16;
      const localOffset = directory.readUInt32LE(offset + 42);
      if (
        offset + 46 + nameSize + extraSize + commentSize > directory.length ||
        flags & 1 ||
        (method !== 0 && method !== 8) ||
        ((mode & 0xf000) !== 0 &&
          (mode & 0xf000) !== 0x8000 &&
          (mode & 0xf000) !== 0x4000)
      )
        throw new Error("Unsupported capability ZIP entry type");
      const nameBytes = directory.subarray(offset + 46, offset + 46 + nameSize);
      const name = new TextDecoder("utf-8", { fatal: true }).decode(nameBytes);
      offset += 46 + nameSize + extraSize + commentSize;
      const isDirectory = name.endsWith("/");
      capabilityPathSchema.parse(isDirectory ? name.slice(0, -1) : name);
      const canonicalName = name.normalize("NFC").toLowerCase();
      if (seen.has(canonicalName))
        throw new Error("Duplicate capability ZIP entry");
      seen.add(canonicalName);
      if (isDirectory) {
        if (
          expanded !== 0 ||
          !manifest.files.some((entry) => entry.path.startsWith(name))
        )
          throw new Error("Unexpected capability directory");
        continue;
      }
      const signed = expected.get(name);
      if (!signed || signed.bytes !== expanded || (mode & 0xf000) === 0x4000)
        throw new Error("Capability inventory mismatch");
      const header = Buffer.alloc(30);
      await file.read(header, 0, 30, localOffset);
      if (
        header.readUInt32LE(0) !== 0x04034b50 ||
        header.readUInt16LE(6) !== flags ||
        header.readUInt16LE(8) !== method ||
        header.readUInt16LE(26) !== nameSize
      )
        throw new Error("Capability ZIP header mismatch");
      const localName = Buffer.alloc(nameSize);
      await file.read(localName, 0, nameSize, localOffset + 30);
      if (!localName.equals(nameBytes))
        throw new Error("Capability ZIP path mismatch");
      const start = localOffset + 30 + nameSize + header.readUInt16LE(28);
      if (start + compressed > directoryOffset)
        throw new Error("Capability ZIP entry exceeds archive");
      entries.push({ name, start, compressed, method });
    }
    if (offset !== directory.length || entries.length !== expected.size)
      throw new Error("Capability ZIP is missing signed files");
    for (const entry of entries) {
      signal.throwIfAborted();
      const signed = expected.get(entry.name)!;
      const target = join(destination, entry.name);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      const hash = createHash("sha256");
      let bytes = 0;
      const check = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          bytes += chunk.length;
          if (bytes > signed.bytes)
            return callback(new Error("Capability expanded size exceeded"));
          hash.update(chunk);
          callback(null, chunk);
        },
      });
      if (entry.compressed === 0) {
        const output = await open(
          target,
          "wx",
          signed.executable ? 0o700 : 0o600,
        );
        await output.close();
      } else {
        const input = createReadStream(archive, {
          fd: file.fd,
          autoClose: false,
          start: entry.start,
          end: entry.start + entry.compressed - 1,
        });
        const output = createWriteStream(target, {
          flags: "wx",
          mode: signed.executable ? 0o700 : 0o600,
        });
        if (entry.method === 8)
          await pipeline(input, createInflateRaw(), check, output, { signal });
        else await pipeline(input, check, output, { signal });
      }
      if (bytes !== signed.bytes || hash.digest("hex") !== signed.sha256)
        throw new Error(`Capability file digest mismatch: ${entry.name}`);
    }
  } finally {
    await file.close();
  }
}
