import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function readEnvironmentPanelSources(): string {
  const workspace = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../src/renderer/workspace",
  );
  const owners = resolve(workspace, "environment");
  return [
    readFileSync(resolve(workspace, "EnvironmentPanel.tsx"), "utf8"),
    ...readdirSync(owners)
      .filter((file) => /\.tsx?$/.test(file))
      .sort()
      .map((file) => readFileSync(resolve(owners, file), "utf8")),
  ].join("\n");
}
