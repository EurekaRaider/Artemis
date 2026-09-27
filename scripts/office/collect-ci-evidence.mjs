import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

const [log, destination] = process.argv.slice(2);
if (!log || !destination)
  throw new Error("Pass a downloaded CI log and a new output directory");
const records = new Map();
const marker = "ARTEMIS_OFFICE_EVIDENCE ";
for (const line of (await readFile(log, "utf8")).split(/\r?\n/u)) {
  const start = line.indexOf(marker);
  if (start < 0) continue;
  const row = JSON.parse(line.slice(start + marker.length));
  if (
    typeof row.path !== "string" ||
    !/^(probe|preview|evidence|ordinary-user)\/[a-zA-Z0-9_./-]+$/u.test(
      row.path,
    ) ||
    row.path
      .split("/")
      .some((part) => !part || part === "." || part === "..") ||
    !/\.(json|png|pdf)$/u.test(row.path) ||
    !Number.isInteger(row.bytes) ||
    row.bytes < 0 ||
    row.bytes > 16 * 1024 * 1024 ||
    !Number.isInteger(row.parts) ||
    row.parts < 1 ||
    row.parts > 4096 ||
    !Number.isInteger(row.part) ||
    row.part < 0 ||
    row.part >= row.parts ||
    !/^[a-f0-9]{64}$/u.test(row.sha256) ||
    typeof row.data !== "string" ||
    row.data.length > 6000 ||
    !/^[A-Za-z0-9+/=]+$/u.test(row.data)
  )
    throw new Error("Invalid CI evidence record");
  let file = records.get(row.path);
  if (!file) {
    file = { ...row, chunks: new Map() };
    records.set(row.path, file);
  }
  if (
    file.bytes !== row.bytes ||
    file.sha256 !== row.sha256 ||
    file.parts !== row.parts
  )
    throw new Error("Conflicting CI evidence metadata");
  const previous = file.chunks.get(row.part);
  if (previous && previous !== row.data)
    throw new Error("Conflicting CI evidence chunk");
  file.chunks.set(row.part, row.data);
  if (records.size > 500) throw new Error("Too many CI evidence files");
}
if (!records.size)
  throw new Error("The CI log contains no exported Office evidence");
const files = [];
let total = 0;
for (const [path, file] of records) {
  if (file.chunks.size !== file.parts)
    throw new Error(`Incomplete evidence: ${path}`);
  const encoded = Array.from({ length: file.parts }, (_, index) =>
    file.chunks.get(index),
  ).join("");
  const bytes = gunzipSync(Buffer.from(encoded, "base64"), {
    maxOutputLength: 16 * 1024 * 1024,
  });
  total += bytes.length;
  if (
    total > 64 * 1024 * 1024 ||
    bytes.length !== file.bytes ||
    createHash("sha256").update(bytes).digest("hex") !== file.sha256
  )
    throw new Error(`Evidence digest or size mismatch: ${path}`);
  files.push({ path, bytes });
}
const output = resolve(destination);
await mkdir(output); // Never mix downloaded evidence with an existing directory.
for (const file of files) {
  const path = join(output, file.path);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, file.bytes, { flag: "wx" });
}
console.log(
  `Restored ${files.length} verified Office evidence files to ${output}`,
);
