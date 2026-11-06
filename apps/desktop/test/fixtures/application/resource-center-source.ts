import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Source contracts follow the actual presentation owners; component tests
// still render ResourceCenter and exercise its real state and event handlers.
export function readResourceCenterSources(): string {
  const root = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../src/renderer/plugins",
  );
  const source = readFileSync(resolve(root, "ResourceCenter.tsx"), "utf8");
  const owners = [
    ...source.matchAll(
      /from ["']\.\/((?:resource-presentation|resource-cache|controllers\/[^/]+|[^/]+-renderers))\.js["']/g,
    ),
  ];
  return [
    source,
    ...owners.map((match) => {
      const extension =
        match[1]!.startsWith("controllers/") || match[1] === "resource-cache"
          ? "ts"
          : "tsx";
      return readFileSync(resolve(root, `${match[1]}.${extension}`), "utf8");
    }),
  ].join("\n");
}
