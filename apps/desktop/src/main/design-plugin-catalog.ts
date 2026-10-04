// S0 design-plugin prototype: generic plugin catalog.
//
// Scans a directory of plugin packages, validates each artemis.plugin.json
// against the protocol schema, and exposes the combined project-type
// catalog. This module must contain ZERO per-plugin branches: test-notes and
// test-shapes flow through the same parse/validate/list path, which is the
// S0 decoupling proof.

import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { pluginManifestSchema, type PluginManifest } from "@artemis/protocol";

export interface CataloguedPlugin {
  /** Absolute path to the package root. */
  root: string;
  manifest: PluginManifest;
  /** SHA-256 over the manifest bytes, used as the S0 content hash. */
  contentHash: string;
}

export class DesignPluginCatalog {
  private readonly plugins: CataloguedPlugin[] = [];

  /** Scan and validate every package under directory. Throws on bad manifest. */
  async load(directory: string): Promise<CataloguedPlugin[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    this.plugins.length = 0;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const root = join(directory, entry.name);
      const manifestPath = join(root, "artemis.plugin.json");
      if (!(await fileExists(manifestPath))) continue;
      const bytes = await readFile(manifestPath);
      const manifest = pluginManifestSchema.parse(
        JSON.parse(bytes.toString("utf8")),
      );
      this.plugins.push({
        root,
        manifest,
        contentHash: createHash("sha256").update(bytes).digest("hex"),
      });
    }
    return [...this.plugins];
  }

  list(): CataloguedPlugin[] {
    return [...this.plugins];
  }

  /** Resolve a project type key to its plugin; undefined when unknown. */
  findByTypeId(typeId: string): CataloguedPlugin | undefined {
    return this.plugins.find((p) =>
      p.manifest.projectTypes.some((t) => t.id === typeId),
    );
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
