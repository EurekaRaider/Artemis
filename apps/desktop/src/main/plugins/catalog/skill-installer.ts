import {
  GITHUB_API,
  GITHUB_RAW,
  MAX_SKILL_FILES,
  MAX_SKILL_FILE_BYTES,
  MAX_SKILL_BYTES,
  githubTreeEntries,
  skillMarkerRank,
  parseSkillFrontmatter,
  safeSkillPath,
} from "./skill-source.js";

import { record, text, responseJson, encodedPath } from "./catalog-values.js";
import type { ProgressReporter } from "./catalog-contracts.js";

import { randomUUID } from "node:crypto";
import {
  access,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, posix, resolve } from "node:path";
import type { InstalledSkill } from "../../../shared/api.js";

import {
  SKILL_METADATA_FILE,
  isSkillInstallerMetadata,
  type SkillInstallerMetadata,
} from "../skill-metadata.js";
import type { CatalogDependencies } from "./catalog-dependencies.js";
export function createSkillInstaller(
  services: Pick<CatalogDependencies, "fetcher" | "skillsRoot">,
) {
  async function installSkill(
    id: string,
    onProgress?: ProgressReporter,
  ): Promise<InstalledSkill> {
    const segments = id.split("/");
    if (
      segments.length !== 3 ||
      segments.some((segment) => !/^[a-zA-Z0-9._-]+$/u.test(segment))
    ) {
      throw new Error("Skill catalog ID is invalid.");
    }
    onProgress?.(5);
    const [owner, repository, slug] = segments as [string, string, string];
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug)) {
      throw new Error("Skill catalog ID is invalid.");
    }
    const source = `${owner}/${repository}`;
    const githubHeaders = {
      Accept: "application/vnd.github+json",
      "User-Agent": "Artemis/0.1",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    const repositoryResponse = await services.fetcher(
      new URL(`/repos/${encodedPath([owner, repository])}`, GITHUB_API),
      {
        headers: githubHeaders,
        signal: AbortSignal.timeout(12_000),
      },
    );
    const repositoryInfo = record(
      await responseJson(repositoryResponse, "GitHub"),
    );
    const defaultBranch = text(repositoryInfo?.default_branch);
    if (!defaultBranch) {
      throw new Error("GitHub repository has no default branch.");
    }
    onProgress?.(15);
    const treeResponse = await services.fetcher(
      new URL(
        `/repos/${encodedPath([
          owner,
          repository,
        ])}/git/trees/${encodeURIComponent(defaultBranch)}?recursive=1`,
        GITHUB_API,
      ),
      {
        headers: githubHeaders,
        signal: AbortSignal.timeout(15_000),
      },
    );
    const tree = githubTreeEntries(await responseJson(treeResponse, "GitHub"));
    onProgress?.(30);
    const namedMarkers = tree
      .filter(
        (entry) =>
          posix.basename(entry.path) === "SKILL.md" &&
          posix.basename(posix.dirname(entry.path)) === slug,
      )
      .sort(
        (left, right) =>
          skillMarkerRank(left.path, slug) - skillMarkerRank(right.path, slug),
      );
    const rootMarker = tree.find((entry) => entry.path === "SKILL.md");
    const markers =
      namedMarkers.length > 0 ? namedMarkers : rootMarker ? [rootMarker] : [];
    const marker = markers[0];
    if (!marker) {
      throw new Error("The selected Skill was not found in its repository.");
    }
    const skillDirectory = posix.dirname(marker.path);
    const rootDirectories = new Set([
      "assets",
      "examples",
      "references",
      "scripts",
      "templates",
    ]);
    const files = tree.filter((entry) => {
      if (skillDirectory !== ".") {
        return entry.path.startsWith(`${skillDirectory}/`);
      }
      const [firstSegment] = entry.path.split("/");
      return (
        entry.path === "SKILL.md" ||
        (firstSegment !== undefined && rootDirectories.has(firstSegment))
      );
    });
    if (files.length < 1 || files.length > MAX_SKILL_FILES) {
      throw new Error("Skill package contains too many files.");
    }
    const declaredBytes = files.reduce(
      (total, file) => total + (file.size ?? 0),
      0,
    );
    if (
      files.some((file) => (file.size ?? 0) > MAX_SKILL_FILE_BYTES) ||
      declaredBytes > MAX_SKILL_BYTES
    ) {
      throw new Error("Skill package exceeds the installation size limit.");
    }

    await mkdir(services.skillsRoot, { recursive: true });
    const destination = join(services.skillsRoot, slug);
    try {
      await access(destination);
      throw new Error(`Skill is already installed: ${slug}`);
    } catch (error) {
      if (
        error instanceof Error &&
        !("code" in error && (error as NodeJS.ErrnoException).code === "ENOENT")
      ) {
        throw error;
      }
    }

    const temporaryPath = join(
      services.skillsRoot,
      `.install-${slug}-${randomUUID()}`,
    );
    let totalBytes = 0;
    try {
      await mkdir(temporaryPath);
      for (const [index, file] of files.entries()) {
        const filePath =
          skillDirectory === "."
            ? file.path
            : file.path.slice(skillDirectory.length + 1);
        const target = safeSkillPath(temporaryPath, filePath);
        const rawUrl = new URL(
          `/${encodedPath([
            owner,
            repository,
            defaultBranch,
            ...file.path.split("/"),
          ])}`,
          GITHUB_RAW,
        );
        const response = await services.fetcher(rawUrl, {
          headers: { Accept: "text/plain" },
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) {
          throw new Error(
            `GitHub Skill file request failed (${response.status}).`,
          );
        }
        const contents = await response.text();
        const bytes = Buffer.byteLength(contents, "utf8");
        totalBytes += bytes;
        if (bytes > MAX_SKILL_FILE_BYTES || totalBytes > MAX_SKILL_BYTES) {
          throw new Error("Skill package exceeds the installation size limit.");
        }
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, contents, { encoding: "utf8", mode: 0o600 });
        onProgress?.(30 + Math.round(((index + 1) / files.length) * 60));
      }
      const frontmatter = parseSkillFrontmatter(
        await readFile(join(temporaryPath, "SKILL.md"), "utf8"),
      );
      const metadata: SkillInstallerMetadata = {
        version: 1,
        id,
        source,
        hash: marker.sha,
        installedAt: new Date().toISOString(),
      };
      await writeFile(
        join(temporaryPath, SKILL_METADATA_FILE),
        `${JSON.stringify(metadata, undefined, 2)}\n`,
        { encoding: "utf8", mode: 0o600 },
      );
      onProgress?.(95);
      await rename(temporaryPath, destination);
      onProgress?.(100);
      return {
        id,
        name: frontmatter.name,
        description: frontmatter.description,
        path: destination,
        enabled: true,
        source,
        installedAt: metadata.installedAt,
      };
    } catch (error) {
      await rm(temporaryPath, { recursive: true, force: true });
      throw error;
    }
  }

  async function installLocalSkill(
    sourcePath: string,
    onProgress?: ProgressReporter,
  ): Promise<InstalledSkill> {
    const source = resolve(sourcePath);
    const sourceInfo = await lstat(source);
    if (!sourceInfo.isDirectory() || sourceInfo.isSymbolicLink()) {
      throw new Error("The selected Skill must be a local directory.");
    }
    onProgress?.(5);

    const frontmatter = parseSkillFrontmatter(
      await readFile(join(source, "SKILL.md"), "utf8"),
    );
    const files: Array<{ source: string; relativePath: string; size: number }> =
      [];
    let totalBytes = 0;

    const collect = async (directory: string, prefix = ""): Promise<void> => {
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        const relativePath = prefix ? join(prefix, entry.name) : entry.name;
        const path = join(directory, entry.name);
        const info = await lstat(path);
        if (info.isSymbolicLink()) {
          throw new Error("Local Skill packages cannot contain links.");
        }
        if (info.isDirectory()) {
          await collect(path, relativePath);
          continue;
        }
        if (!info.isFile()) {
          throw new Error("Local Skill packages can contain only files.");
        }
        if (isSkillInstallerMetadata(relativePath)) {
          throw new Error(
            "Local Skill packages cannot provide installer metadata.",
          );
        }
        totalBytes += info.size;
        files.push({ source: path, relativePath, size: info.size });
        if (
          files.length > MAX_SKILL_FILES ||
          info.size > MAX_SKILL_FILE_BYTES ||
          totalBytes > MAX_SKILL_BYTES
        ) {
          throw new Error("Skill package exceeds the installation limits.");
        }
      }
    };
    await collect(source);
    onProgress?.(25);

    await mkdir(services.skillsRoot, { recursive: true });
    const destination = join(services.skillsRoot, frontmatter.name);
    try {
      await access(destination);
      throw new Error(`Skill is already installed: ${frontmatter.name}`);
    } catch (error) {
      if (
        error instanceof Error &&
        !("code" in error && (error as NodeJS.ErrnoException).code === "ENOENT")
      ) {
        throw error;
      }
    }

    const temporaryPath = join(
      services.skillsRoot,
      `.install-${frontmatter.name}-${randomUUID()}`,
    );
    const installedAt = new Date().toISOString();
    try {
      await mkdir(temporaryPath);
      for (const [index, file] of files.entries()) {
        const target = safeSkillPath(temporaryPath, file.relativePath);
        await mkdir(dirname(target), { recursive: true });
        await copyFile(file.source, target);
        onProgress?.(25 + Math.round(((index + 1) / files.length) * 65));
      }
      const metadata: SkillInstallerMetadata = {
        version: 1,
        id: `local/${frontmatter.name}`,
        source: "local",
        installedAt,
      };
      await writeFile(
        join(temporaryPath, SKILL_METADATA_FILE),
        `${JSON.stringify(metadata, undefined, 2)}\n`,
        { encoding: "utf8", mode: 0o600 },
      );
      onProgress?.(95);
      await rename(temporaryPath, destination);
      onProgress?.(100);
      return {
        id: metadata.id,
        name: frontmatter.name,
        description: frontmatter.description,
        path: destination,
        enabled: true,
        source: metadata.source,
        installedAt,
      };
    } catch (error) {
      await rm(temporaryPath, { recursive: true, force: true });
      throw error;
    }
  }
  const handlers = { installSkill, installLocalSkill };
  return handlers;
}
