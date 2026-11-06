import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Legacy source assertions follow the actual feature owners. Behavioral bridge
// tests exercise the public API; boundary checks inspect real import graphs.
function readOwners(entry: string, ownerDirectory: string): string {
  const root = fileURLToPath(new URL("../../../src/", import.meta.url));
  const owners = resolve(root, ownerDirectory);
  const visited = new Set<string>();
  function visit(file: string): string {
    if (visited.has(file)) return "";
    visited.add(file);
    const source = readFileSync(file, "utf8");
    const dependencies = [
      ...source.matchAll(/from ["'](\.\.?\/[^"']+)\.js["']/g),
    ]
      .map((match) => resolve(dirname(file), match[1]! + ".ts"))
      .filter(
        (path) =>
          path.startsWith(owners + "/") ||
          path === resolve(root, "shared/ipc-channels.ts"),
      );
    return [source, ...dependencies.map(visit)].join("\n");
  }
  return visit(resolve(root, entry));
}
export function readSharedApiSources(): string {
  return readOwners("shared/api.ts", "shared/api");
}
export function readPreloadBridgeSources(): string {
  return readOwners("preload/preload.ts", "preload/bridges");
}
