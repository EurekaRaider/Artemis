import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const renderer = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../src/renderer",
);

/** Read actual feature owners recursively for legacy structural contracts. */
export function readRendererFeatureSources(
  entry: string,
  directories: readonly string[],
  files: readonly string[] = [],
): string {
  const visit = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((item) => {
      const path = resolve(directory, item.name);
      return item.isDirectory()
        ? visit(path)
        : /\.tsx?$/.test(item.name)
          ? [readFileSync(path, "utf8")]
          : [];
    });
  return [
    readFileSync(resolve(renderer, entry), "utf8"),
    ...files.map((file) => readFileSync(resolve(renderer, file), "utf8")),
    ...directories.flatMap((directory) => visit(resolve(renderer, directory))),
  ].join("\n");
}
