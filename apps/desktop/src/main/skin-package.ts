import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import {
  SKIN_RESOURCE_LIMITS,
  isSkinRelativePath,
  skinDeclaredFiles,
  validateVisualSkinManifest,
  validateVisualSkinPackage,
  validateVisualSkinIntegrity,
  type SkinAssetKind,
  type ValidatedVisualSkinPackage,
} from "@artemis/theme-contract";

export interface SkinFile {
  path: string;
  hash: string;
  size: number;
  mime: string;
  identity: string;
}
export interface LoadedSkin {
  data: ValidatedVisualSkinPackage;
  files: Record<string, SkinFile>;
}
export function skinFileIdentity(stat: {
  dev: bigint;
  ino: bigint;
  size: bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
}) {
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(":");
}
export async function skinSafePath(
  root: string,
  path: string,
): Promise<string> {
  if (!isSkinRelativePath(path)) throw new Error("Unsafe skin resource path.");
  const base = await realpath(root),
    full = resolve(base, path);
  if (!full.startsWith(base + sep))
    throw new Error("Skin resource escaped its package.");
  let current = base;
  if ((await lstat(root)).isSymbolicLink())
    throw new Error("Skin package cannot contain symlinks.");
  for (const part of relative(base, full).split(sep)) {
    current = join(current, part);
    if ((await lstat(current)).isSymbolicLink())
      throw new Error("Skin resource cannot contain symlinks.");
  }
  return full;
}
async function readStable(root: string, path: string, limit: number) {
  const full = await skinSafePath(root, path);
  const handle = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size > BigInt(limit) || before.size === 0n)
      throw new Error(`Skin file is empty or exceeds its limit: ${path}`);
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const named = await lstat(await skinSafePath(root, path), { bigint: true });
    if (
      skinFileIdentity(before) !== skinFileIdentity(after) ||
      skinFileIdentity(after) !== skinFileIdentity(named) ||
      bytes.length !== Number(after.size)
    )
      throw new Error("Skin file changed while reading.");
    return {
      bytes,
      identity: skinFileIdentity(after),
      hash: createHash("sha256").update(bytes).digest("hex"),
    };
  } finally {
    await handle.close();
  }
}
async function filesUnder(root: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(join(root, prefix), { withFileTypes: true });
  const files: string[] = [];
  for (const e of entries) {
    const p = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isSymbolicLink())
      throw new Error("Skin package cannot contain symlinks.");
    if (e.isDirectory()) files.push(...(await filesUnder(root, p)));
    else if (e.isFile()) files.push(p);
    else throw new Error("Unsupported skin file.");
    if (files.length > 256) throw new Error("Skin has too many files.");
  }
  return files.sort();
}
function imageSize(b: Buffer, extension: string): [number, number] {
  if (
    extension === "png" &&
    b.length >= 33 &&
    b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    b.toString("ascii", 12, 16) === "IHDR"
  )
    return [b.readUInt32BE(16), b.readUInt32BE(20)];
  if (
    extension === "webp" &&
    b.length >= 30 &&
    b.toString("ascii", 0, 4) === "RIFF" &&
    b.toString("ascii", 8, 12) === "WEBP" &&
    b.readUInt32LE(4) + 8 === b.length
  ) {
    const tag = b.toString("ascii", 12, 16);
    if (tag === "VP8X")
      return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
    if (tag === "VP8 " && b.subarray(23, 26).equals(Buffer.from([157, 1, 42])))
      return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
    if (tag === "VP8L" && b[20] === 47) {
      const bits = b.readUInt32LE(21);
      return [1 + (bits & 0x3fff), 1 + ((bits >>> 14) & 0x3fff)];
    }
  }
  if (
    ["jpg", "jpeg"].includes(extension) &&
    b[0] === 255 &&
    b[1] === 216 &&
    b.subarray(-2).equals(Buffer.from([255, 217]))
  ) {
    for (let p = 2; p + 4 < b.length;) {
      if (b[p] !== 255) break;
      const marker = b[p + 1]!;
      p += 2;
      if (marker === 217 || marker === 218) break;
      if (marker === 255 || marker === 216 || marker === 1) continue;
      const length = b.readUInt16BE(p);
      if (length < 2 || p + length > b.length) break;
      if (
        [
          192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
        ].includes(marker) &&
        length >= 8
      )
        return [b.readUInt16BE(p + 5), b.readUInt16BE(p + 3)];
      p += length;
    }
  }
  throw new Error("Unsupported or corrupt skin image.");
}
// Read container metadata without invoking an executable or accepting external references.
function mp4Metadata(b: Buffer) {
  let width = 0,
    height = 0,
    seconds = 0,
    hasMedia = false,
    budget = 0;
  function atoms(start: number, end: number, depth: number) {
    if (depth > 8) throw new Error("MP4 nesting limit exceeded.");
    for (let p = start; p + 8 <= end;) {
      if (++budget > 10000) throw new Error("MP4 atom limit exceeded.");
      let size = b.readUInt32BE(p),
        header = 8;
      const tag = b.toString("ascii", p + 4, p + 8);
      if (size === 1) {
        if (p + 16 > end) throw new Error("Truncated MP4 atom.");
        size = Number(b.readBigUInt64BE(p + 8));
        header = 16;
      }
      if (size === 0) size = end - p;
      if (!Number.isSafeInteger(size) || size < header || p + size > end)
        throw new Error("Invalid MP4 atom.");
      const data = p + header,
        stop = p + size;
      if (["moov", "trak", "mdia", "minf", "stbl"].includes(tag))
        atoms(data, stop, depth + 1);
      if (tag === "mdat") hasMedia = true;
      if (tag === "mvhd") {
        const v = b[data],
          offset = v === 1 ? 20 : 12;
        if (stop - data < (v === 1 ? 32 : 20) || (v !== 0 && v !== 1))
          throw new Error("Invalid MP4 duration.");
        const scale = b.readUInt32BE(data + offset),
          duration =
            v === 1
              ? Number(b.readBigUInt64BE(data + offset + 4))
              : b.readUInt32BE(data + offset + 4);
        if (!scale) throw new Error("Invalid MP4 timescale.");
        seconds = duration / scale;
      }
      if (tag === "tkhd" && stop - data >= 84) {
        width = Math.max(width, b.readUInt32BE(stop - 8) / 65536);
        height = Math.max(height, b.readUInt32BE(stop - 4) / 65536);
      }
      p = stop;
    }
  }
  if (b.length < 16 || b.toString("ascii", 4, 8) !== "ftyp")
    throw new Error("Invalid MP4 signature.");
  atoms(0, b.length, 0);
  if (!hasMedia) throw new Error("MP4 has no media.");
  return { width, height, seconds };
}
function webmMetadata(b: Buffer) {
  let width = 0,
    height = 0,
    duration = 0,
    scale = 1_000_000,
    hasMedia = false,
    doc = "",
    budget = 0;
  function vint(p: number, id: boolean): [number, number] {
    if (p >= b.length || b[p] === 0) throw new Error("Invalid WebM element.");
    let n = 1,
      mask = 128;
    while (!(b[p]! & mask)) {
      n++;
      mask >>= 1;
    }
    if (n > (id ? 4 : 8) || p + n > b.length)
      throw new Error("Invalid WebM integer.");
    let value = id ? b[p]! : b[p]! & (mask - 1);
    for (let i = 1; i < n; i++) value = value * 256 + b[p + i]!;
    return [value, n];
  }
  const masters = new Set([
    0x1a45dfa3, 0x18538067, 0x1549a966, 0x1654ae6b, 0xae, 0xe0,
  ]);
  function elements(start: number, end: number, depth: number) {
    if (depth > 8) throw new Error("WebM nesting limit exceeded.");
    for (let p = start; p < end;) {
      if (++budget > 10000) throw new Error("WebM element limit exceeded.");
      const [id, incr] = vint(p, true),
        [length, sz] = vint(p + incr, false);
      const data = p + incr + sz;
      const unknown = length === 2 ** (7 * sz) - 1,
        stop = unknown && id === 0x18538067 ? end : data + length;
      if (!Number.isSafeInteger(stop) || stop > end || stop <= p)
        throw new Error("Invalid WebM size.");
      const uint = () => {
        if (stop - data > 8) throw new Error("WebM integer too large.");
        let v = 0;
        for (let i = data; i < stop; i++) v = v * 256 + b[i]!;
        return v;
      };
      if (masters.has(id)) elements(data, stop, depth + 1);
      else if (id === 0x4282) doc = b.toString("ascii", data, stop);
      else if (id === 0x2ad7b1) scale = uint();
      else if (id === 0x4489) {
        if (![4, 8].includes(stop - data))
          throw new Error("Invalid WebM duration.");
        duration =
          stop - data === 4 ? b.readFloatBE(data) : b.readDoubleBE(data);
      } else if (id === 0xb0) width = Math.max(width, uint());
      else if (id === 0xba) height = Math.max(height, uint());
      else if (id === 0x1f43b675) hasMedia = true;
      p = stop;
    }
  }
  elements(0, b.length, 0);
  if (doc !== "webm" || !hasMedia) throw new Error("Invalid WebM container.");
  return { width, height, seconds: (duration * scale) / 1e9 };
}
export function validateSkinAsset(
  bytes: Buffer,
  path: string,
  kind: SkinAssetKind,
): string {
  const ext = path.split(".").at(-1)!.toLowerCase();
  if (bytes.length > SKIN_RESOURCE_LIMITS[kind])
    throw new Error(`Skin ${kind} exceeds its size limit.`);
  if (kind === "image") {
    const [w, h] = imageSize(bytes, ext);
    if (w <= 0 || h <= 0 || w * h > SKIN_RESOURCE_LIMITS.imagePixels)
      throw new Error("Skin image exceeds its pixel limit.");
    return ext === "png"
      ? "image/png"
      : ext === "webp"
        ? "image/webp"
        : "image/jpeg";
  }
  if (kind === "font") {
    if (
      bytes.length < 48 ||
      bytes.toString("ascii", 0, 4) !== "wOF2" ||
      bytes.readUInt32BE(8) !== bytes.length ||
      bytes.readUInt16BE(12) === 0 ||
      bytes.readUInt16BE(14) !== 0
    )
      throw new Error("Invalid WOFF2 font.");
    return "font/woff2";
  }
  const { width, height, seconds } =
    ext === "mp4" ? mp4Metadata(bytes) : webmMetadata(bytes);
  if (
    !Number.isFinite(seconds) ||
    seconds <= 0 ||
    seconds > SKIN_RESOURCE_LIMITS.videoSeconds ||
    width <= 0 ||
    height <= 0 ||
    width > SKIN_RESOURCE_LIMITS.videoWidth ||
    height > SKIN_RESOURCE_LIMITS.videoHeight
  )
    throw new Error(
      "Skin video exceeds duration or dimensions, or lacks metadata.",
    );
  return ext === "mp4" ? "video/mp4" : "video/webm";
}
export async function loadSkinPackage(root: string): Promise<LoadedSkin> {
  const files: Record<string, SkinFile> = {};
  async function json(path: string) {
    const file = await readStable(root, path, SKIN_RESOURCE_LIMITS.json);
    files[path] = {
      path,
      hash: file.hash,
      identity: file.identity,
      size: file.bytes.length,
      mime: "application/json",
    };
    return JSON.parse(file.bytes.toString("utf8")) as unknown;
  }
  const manifestInput = await json("manifest.json"),
    manifestReport = validateVisualSkinManifest(manifestInput);
  if (!manifestReport.value || !manifestReport.valid)
    throw new Error(
      `Invalid skin manifest: ${manifestReport.issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`,
    );
  const manifest = manifestReport.value,
    declared = skinDeclaredFiles(manifest).sort();
  const actual = await filesUnder(root);
  if (actual.join("\n") !== [...declared, "integrity.json"].sort().join("\n"))
    throw new Error("Skin contains missing or undeclared files.");
  const integrity = validateVisualSkinIntegrity(
    await json("integrity.json"),
    manifest,
  );
  if (!integrity.valid || !integrity.value)
    throw new Error("Invalid skin integrity document.");
  const tokenDocuments: Record<string, unknown> = {};
  for (const file of Object.values(manifest.tokens))
    tokenDocuments[file] = await json(file);
  const icons =
    manifest.schemaVersion === 2 && manifest.icons
      ? await json(manifest.icons)
      : undefined;
  const motion =
    manifest.schemaVersion === 2 && manifest.motion
      ? await json(manifest.motion)
      : undefined;
  const report = validateVisualSkinPackage({
    manifest,
    tokenDocuments,
    ...(icons ? { icons } : {}),
    ...(motion ? { motion } : {}),
  });
  if (!report.valid || !report.value)
    throw new Error(
      `Invalid skin data: ${report.issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`,
    );
  if (manifest.schemaVersion === 2)
    for (const asset of Object.values(manifest.assets)) {
      const file = await readStable(
        root,
        asset.path,
        SKIN_RESOURCE_LIMITS[asset.kind],
      );
      files[asset.path] = {
        path: asset.path,
        hash: file.hash,
        identity: file.identity,
        size: file.bytes.length,
        mime: validateSkinAsset(file.bytes, asset.path, asset.kind),
      };
    }
  for (const file of declared)
    if (
      files[file]!.hash !==
      (integrity.value.files as Record<string, string>)[file]
    )
      throw new Error(`Skin integrity mismatch: ${file}`);
  // Detect a replaced directory/file set after the asynchronous reads.
  if ((await filesUnder(root)).join("\n") !== actual.join("\n"))
    throw new Error("Skin changed while validating.");
  for (const file of Object.values(files))
    if (
      skinFileIdentity(
        await lstat(await skinSafePath(root, file.path), { bigint: true }),
      ) !== file.identity
    )
      throw new Error("Skin changed while validating.");
  return { data: report.value, files };
}
