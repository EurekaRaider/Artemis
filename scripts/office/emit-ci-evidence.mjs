// A bounded log transport keeps native evidence retrievable when Artifact storage is full.
// Only public-corpus results and synthetic preview files are included, never Office profiles.
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { gzipSync } from "node:zlib";

const root = resolve("artifacts/office");
const allowed =
  /^(?:(?:report|identity|windows|snapshots)\.json|(?:live|reopened)\.pdf|(?:desktop|compact)\.png)$/u;
let total = 0;
let count = 0;
async function emit(directory) {
  for (const item of await readdir(directory, { withFileTypes: true }).catch(
    () => [],
  )) {
    const path = join(directory, item.name);
    if (item.isDirectory() && !item.name.startsWith("profile-"))
      await emit(path);
    if (!item.isFile() || !allowed.test(item.name)) continue;
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
}
for (const name of ["probe", "preview", "evidence", "ordinary-user"])
  await emit(join(root, name));
console.log(
  `Office evidence: ${count} files, ${total} original bytes; checksummed gzip chunks retained in this job log.`,
);
