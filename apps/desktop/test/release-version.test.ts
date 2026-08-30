import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const releaseVersion = "1.4.31";
const workspacePaths = [
  "apps/desktop",
  "packages/agent-host",
  "packages/platform",
  "packages/protocol",
];

function json(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, path), "utf8")) as Record<
    string,
    unknown
  >;
}

describe("release version", () => {
  it("keeps manifests, lockfile, MCP identity, and README at v1.4.31", () => {
    const manifests = [json("package.json")];
    for (const workspacePath of workspacePaths) {
      manifests.push(json(join(workspacePath, "package.json")));
    }

    for (const manifest of manifests) {
      expect(manifest.version).toBe(releaseVersion);
      for (const [name, version] of Object.entries(
        (manifest.dependencies ?? {}) as Record<string, string>,
      )) {
        if (name.startsWith("@artemis/")) expect(version).toBe(releaseVersion);
      }
    }

    const lock = json("package-lock.json") as {
      version?: string;
      packages?: Record<
        string,
        { version?: string; dependencies?: Record<string, string> }
      >;
    };
    expect(lock.version).toBe(releaseVersion);
    for (const packagePath of ["", ...workspacePaths]) {
      const entry = lock.packages?.[packagePath];
      expect(entry?.version).toBe(releaseVersion);
      for (const [name, version] of Object.entries(entry?.dependencies ?? {})) {
        if (name.startsWith("@artemis/")) expect(version).toBe(releaseVersion);
      }
    }

    const mcp = readFileSync(
      join(root, "apps/desktop/src/main/mcp-client-manager.ts"),
      "utf8",
    );
    const readme = readFileSync(join(root, "README.md"), "utf8");
    expect(mcp.match(/version: "1\.4\.31"/gu)).toHaveLength(3);
    expect(readme).toContain("The `1.4.31` packaging configuration produces:");
    expect(new Set(readme.match(/\b1\.4\.\d+\b/gu) ?? [])).toEqual(
      new Set([releaseVersion]),
    );
  });
});
