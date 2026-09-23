import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { load, dump } from "js-yaml";

// Separate prepackaged builds write the same channel file. Retain both architectures.
export async function collectMacUpdateMetadata(directory, collected, version) {
  for (const name of await readdir(directory)) {
    if (!/^(?:latest|alpha|beta)-mac\.ya?ml$/u.test(name)) continue;
    const info = load(await readFile(join(directory, name), "utf8"));
    if (info.version !== version || !Array.isArray(info.files)) {
      throw new Error(`Invalid macOS update metadata: ${name}`);
    }
    const previous = collected.get(name);
    const files = new Map(
      [...(previous?.files ?? []), ...info.files].map((file) => [
        file.url,
        file,
      ]),
    );
    collected.set(name, { ...info, files: [...files.values()] });
  }
}

export async function writeMacUpdateMetadata(directory, collected) {
  for (const [name, info] of collected) {
    await writeFile(join(directory, name), dump(info));
  }
}
