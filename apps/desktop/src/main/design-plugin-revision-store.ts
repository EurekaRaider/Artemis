// S1 design-plugin immutable revision store (proposal §6.1, §5.1).
//
// Publishes an installed plugin package to
//   <revisionsRoot>/<installationId>/<contentHash>/
// where contentHash is computed over the full file manifest. A published
// revision is immutable: republishing identical content is idempotent, and
// the same contentHash with different content is refused (never overwrite).
// This mirrors ArtemisPluginShop's manifest-hash + immutable release model
// and gives thread typeBinding snapshots a stable, verifiable target.

import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { pluginManifestSchema, type PluginManifest } from "@artemis/protocol";

/** PluginShop-aligned package limits. */
const MAX_FILES = 500;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;

interface CollectedFile {
  path: string;
  bytes: Buffer;
}

export interface PublishedRevision {
  revisionRoot: string;
  manifest: PluginManifest;
  contentHash: string;
}

export class PluginRevisionStore {
  constructor(private readonly revisionsRoot: string) {}

  /**
   * Publish sourceRoot under installationId/contentHash atomically:
   * collect + validate into a staging directory, then rename into place.
   * Existing identical content is idempotent; existing different content
   * under the same hash is refused.
   */
  async publish(input: {
    installationId: string;
    contentHash: string;
    sourceRoot: string;
  }): Promise<PublishedRevision> {
    const files = await this.collectFiles(input.sourceRoot);
    const manifest = this.parseManifest(input.sourceRoot, files);
    const revisionRoot = join(
      this.revisionsRoot,
      input.installationId,
      input.contentHash,
    );

    if (await exists(revisionRoot)) {
      // Immutability check: same hash must mean same bytes.
      const existingFiles = await this.collectFiles(revisionRoot);
      const same =
        existingFiles.length === files.length &&
        existingFiles.every((existing) => {
          const candidate = files.find((f) => f.path === existing.path);
          return candidate?.bytes.equals(existing.bytes) ?? false;
        });
      if (!same) {
        throw new Error(
          `Revision ${input.contentHash} already exists with different content; refusing to overwrite.`,
        );
      }
      return { revisionRoot, manifest, contentHash: input.contentHash };
    }

    const staging = join(
      this.revisionsRoot,
      input.installationId,
      `.staging-${randomUUID()}`,
    );
    await mkdir(staging, { recursive: true });
    try {
      for (const file of files) {
        const destination = join(staging, file.path);
        await mkdir(join(destination, ".."), { recursive: true });
        await writeFile(destination, file.bytes);
      }
      await rename(staging, revisionRoot);
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      throw error;
    }
    return { revisionRoot, manifest, contentHash: input.contentHash };
  }

  /** List all published revisions for an installation. */
  async list(installationId: string): Promise<PublishedRevision[]> {
    const installationRoot = join(this.revisionsRoot, installationId);
    if (!(await exists(installationRoot))) return [];
    const entries = await readdir(installationRoot, {
      withFileTypes: true,
    });
    const revisions: PublishedRevision[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const revisionRoot = join(installationRoot, entry.name);
      try {
        const manifestBytes = await readFile(
          join(revisionRoot, "artemis.plugin.json"),
        );
        const manifest = pluginManifestSchema.parse(
          JSON.parse(manifestBytes.toString("utf8")),
        );
        revisions.push({
          revisionRoot,
          manifest,
          contentHash: entry.name,
        });
      } catch {
        // Unreadable revision directories are skipped, not fatal: listing
        // must never throw because one package on disk is corrupted.
      }
    }
    return revisions.sort((a, b) => (a.contentHash < b.contentHash ? -1 : 1));
  }

  /** Deterministic latest: lexicographically greatest content hash. */
  async latest(installationId: string): Promise<PublishedRevision | undefined> {
    const revisions = await this.list(installationId);
    return revisions.at(-1);
  }

  /**
   * Content hash: sorted relative paths, per-file SHA-256, joined as
   * "relpath:hash\n", then SHA-256 over the whole manifest string. Adding,
   * removing, or editing any file changes the hash.
   */
  static async computeContentHash(sourceRoot: string): Promise<string> {
    const files = await collectSourceFiles(sourceRoot);
    const manifestText = files
      .map(
        (file) =>
          `${file.path}:${createHash("sha256").update(file.bytes).digest("hex")}\n`,
      )
      .join("");
    return createHash("sha256").update(manifestText).digest("hex");
  }

  private async collectFiles(sourceRoot: string): Promise<CollectedFile[]> {
    return collectSourceFiles(sourceRoot);
  }

  private parseManifest(
    sourceRoot: string,
    files: CollectedFile[],
  ): PluginManifest {
    const manifestFile = files.find((f) => f.path === "artemis.plugin.json");
    if (!manifestFile) {
      throw new Error(
        `Plugin package at ${sourceRoot} has no artemis.plugin.json; refusing to publish.`,
      );
    }
    return pluginManifestSchema.parse(
      JSON.parse(manifestFile.bytes.toString("utf8")),
    );
  }
}

async function collectSourceFiles(root: string): Promise<CollectedFile[]> {
  const files: CollectedFile[] = [];
  let totalBytes = 0;
  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const absolute = join(directory, entry.name);
      // Reject symlinks: the revision must contain the bytes we validated.
      if (entry.isSymbolicLink()) {
        throw new Error(
          `Symbolic link in plugin package is not allowed: ${absolute}`,
        );
      }
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const info = await stat(absolute);
      if (info.size > MAX_FILE_BYTES) {
        throw new Error(`Plugin file exceeds 5 MiB limit: ${absolute}`);
      }
      totalBytes += info.size;
      if (totalBytes > MAX_TOTAL_BYTES) {
        throw new Error("Plugin package exceeds 25 MiB total limit.");
      }
      if (files.length >= MAX_FILES) {
        throw new Error("Plugin package exceeds 500 file limit.");
      }
      const rel = relative(resolve(root), resolve(absolute));
      if (rel.startsWith("..") || resolve(absolute) === resolve(root)) {
        throw new Error(`Plugin file escapes the package root: ${absolute}`);
      }
      files.push({
        path: rel.split("\\").join("/"),
        bytes: await readFile(absolute),
      });
    }
  };
  await walk(root);
  return files.sort((a, b) => (a.path < b.path ? -1 : 1));
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

// Re-exported so codex-plugin-service can copy staged files without
// duplicating the collection rules.
export { collectSourceFiles };
export type { CollectedFile as RevisionCollectedFile };
export { MAX_FILES as REVISION_MAX_FILES };
