import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function readAgentRuntimeSources(): string {
  const root = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../../../packages/agent-host/src/runtime",
  );
  const read = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? read(join(directory, entry.name))
        : entry.name.endsWith(".ts")
          ? [readFileSync(join(directory, entry.name), "utf8")]
          : [],
    );
  return read(root).join("\n");
}
