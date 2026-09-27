import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
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
  const temporary = `${path}.partial`;
  await rm(temporary, { force: true });
  for (let attempt = 1; attempt <= 3; attempt++) {
    const offset = (await stat(temporary).catch(() => undefined))?.size ?? 0;
    if (offset && (await digest(temporary)) === source.sha256) break;
    try {
      const response = await fetch(source.url, {
        headers: {
          "Accept-Encoding": "identity",
          ...(offset ? { Range: `bytes=${offset}-` } : {}),
        },
        signal: AbortSignal.timeout(300_000),
      });
      if (!response.ok || !response.body)
        throw new Error(`Download returned ${response.status}`);
      const resumed = response.status === 206;
      if (
        resumed &&
        !response.headers.get("content-range")?.startsWith(`bytes ${offset}-`)
      )
        throw new Error("Download resumed at an unexpected offset");
      console.log(
        `Downloading ${basename(path)}: attempt ${attempt}, offset ${resumed ? offset : 0}`,
      );
      const output = await open(temporary, resumed ? "a" : "w", 0o600);
      try {
        for await (const chunk of response.body) await output.writeFile(chunk);
        await output.sync();
      } finally {
        await output.close();
      }
      break;
    } catch (error) {
      console.warn(`Download attempt ${attempt} failed: ${error.message}`);
      if (attempt === 3) throw error;
    }
  }
  if ((await digest(temporary)) !== source.sha256) {
    await rm(temporary);
    throw new Error(`Source digest mismatch: ${basename(path)}`);
  }
  await rename(temporary, path);
  console.log(`Verified download: ${basename(path)}`);
}
