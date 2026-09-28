import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  await readFile(join(directory, "corpus.json"), "utf8"),
);
const destination = resolve(process.argv[2] ?? "artifacts/office/corpus");
for (const sample of manifest.samples) {
  const path = join(destination, sample.id);
  let bytes = await readFile(path).catch(() => undefined);
  const matches = (value) =>
    value?.length === sample.bytes &&
    createHash("sha1")
      .update(`blob ${value.length}\0`)
      .update(value)
      .digest("hex") === sample.gitBlobSha1;
  if (!matches(bytes)) {
    if (
      !sample.url.startsWith(
        `https://raw.githubusercontent.com/LibreOffice/core/${manifest.sourceCommit}/`,
      )
    )
      throw new Error("Corpus URL is not pinned");
    const response = await fetch(sample.url, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok)
      throw new Error(
        `Corpus download failed: ${sample.id}: ${response.status}`,
      );
    bytes = Buffer.from(await response.arrayBuffer());
    if (!matches(bytes))
      throw new Error(`Corpus digest mismatch: ${sample.id}`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }
  console.log(`${sample.id}: ${bytes.length} bytes verified`);
}
