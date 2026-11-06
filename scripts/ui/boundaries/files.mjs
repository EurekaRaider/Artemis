import { readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { SOURCE_EXTENSIONS } from "./policy.mjs";

export async function filesBelow(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesBelow(path)));
    else if (SOURCE_EXTENSIONS.has(extname(entry.name))) files.push(path);
  }
  return files;
}
