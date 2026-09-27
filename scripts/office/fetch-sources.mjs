import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pins = JSON.parse(
  await readFile(
    join(dirname(fileURLToPath(import.meta.url)), "sources.json"),
    "utf8",
  ),
);
const target = pins.targets[`${process.platform}-${process.arch}`];
if (!target) throw new Error("Unsupported Office build target");
const out = resolve(process.argv[2] ?? "artifacts/office/sources");
await mkdir(out, { recursive: true });
async function digest(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
for (const source of [target.office, target.sdk, pins.json]) {
  const path = join(out, basename(new URL(source.url).pathname));
  if ((await digest(path).catch(() => "")) === source.sha256) {
    console.log(`Verified cache: ${basename(path)}`);
    continue;
  }
  const response = await fetch(source.url);
  if (!response.ok || !response.body)
    throw new Error(`Download failed: ${source.url}`);
  const temporary = `${path}.partial`;
  const output = await open(temporary, "w", 0o600);
  try {
    for await (const chunk of response.body) await output.writeFile(chunk);
    await output.sync();
  } finally {
    await output.close();
  }
  if ((await digest(temporary)) !== source.sha256) {
    await rm(temporary);
    throw new Error(`Source digest mismatch: ${basename(path)}`);
  }
  await rename(temporary, path);
  console.log(`Verified download: ${basename(path)}`);
}
