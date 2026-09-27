// A bounded log transport keeps native evidence retrievable when Artifact storage is full.
// Only public-corpus results and synthetic preview files are included, never Office profiles.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { gzipSync } from "node:zlib";

const root = resolve("artifacts/office");
const allowed =
  /^(?:(?:report|identity|windows|snapshots)\.json|(?:live|reopened)\.pdf|(?:desktop|compact|word|excel|powerpoint)\.png)$/u;
let total = 0;
let count = 0;
const files = [];
const omitted = [];
async function discover(directory) {
  for (const item of await readdir(directory, { withFileTypes: true }).catch(
    () => [],
  )) {
    const path = join(directory, item.name);
    if (item.isDirectory() && !item.name.startsWith("profile-"))
      await discover(path);
    if (!item.isFile() || !allowed.test(item.name)) continue;
    files.push(path);
  }
}
async function emit(path) {
  const bytes = await readFile(path);
  total += bytes.length;
  if (bytes.length > 16 * 1024 * 1024 || total > 64 * 1024 * 1024)
    throw new Error("CI evidence exceeds the log transport limit");
  const encoded = gzipSync(bytes, { level: 9 }).toString("base64");
  const parts = Math.ceil(encoded.length / 6000);
  const metadata = {
    path: relative(root, path).split(sep).join("/"),
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    parts,
  };
  for (let part = 0; part < parts; part++)
    console.log(
      `ARTEMIS_OFFICE_EVIDENCE ${JSON.stringify({ ...metadata, part, data: encoded.slice(part * 6000, (part + 1) * 6000) })}`,
    );
  count++;
}
for (const name of ["probe", "preview", "evidence", "ordinary-user", "panels"])
  await discover(join(root, name));
if (await stat(join(root, "candidate", "report.json")).catch(() => null))
  files.push(join(root, "candidate", "report.json"));
// Preserve reports and UI screenshots before optional sample PDFs. A large
// native export must not prevent retrieving the rest of a failed job's evidence.
const priority = (path) =>
  path.endsWith(".json") ? 0 : path.endsWith(".png") ? 1 : 2;
files.sort((a, b) => priority(a) - priority(b) || a.localeCompare(b));
for (const path of files) {
  const { size } = await stat(path);
  if (size > 16 * 1024 * 1024 || total + size > 63 * 1024 * 1024) {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    omitted.push({
      path: relative(root, path).split(sep).join("/"),
      bytes: size,
      sha256: hash.digest("hex"),
      reason:
        "Exceeds the bounded CI log transport; full file requires Artifact storage.",
    });
    continue;
  }
  await emit(path);
}
const manifest = join(root, "evidence", "log-transport.json");
await mkdir(dirname(manifest), { recursive: true });
await writeFile(
  manifest,
  JSON.stringify(
    { schemaVersion: 1, exportedFiles: count, exportedBytes: total, omitted },
    null,
    2,
  ),
);
await emit(manifest);
console.log(
  `Office evidence: ${count} files, ${total} original bytes; ${omitted.length} oversized files listed by digest in evidence/log-transport.json.`,
);
