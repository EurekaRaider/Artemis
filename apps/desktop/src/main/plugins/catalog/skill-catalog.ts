import {
  SKILL_REGISTRY,
  parseSkillCatalogResponse,
  parseSkillFrontmatter,
} from "./skill-source.js";

import { responseJson } from "./catalog-values.js";

import { lstat, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { InstalledSkill, SkillCatalogItem } from "../../../shared/api.js";

import { readAndMigrateSkillMetadata } from "../skill-metadata.js";
import type { CatalogDependencies } from "./catalog-dependencies.js";
export function createSkillCatalog(
  services: Pick<
    CatalogDependencies,
    "fetcher" | "listInstalledSkills" | "skillsRoot"
  >,
) {
  async function searchSkills(query: string): Promise<SkillCatalogItem[]> {
    const normalized = query.trim();
    if (normalized.length < 2) {
      throw new Error("Enter at least two characters to search Skills.");
    }
    const url = new URL("/api/search", SKILL_REGISTRY);
    url.searchParams.set("q", normalized);
    url.searchParams.set("limit", "40");
    const response = await services.fetcher(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    const installed = new Set(
      (await services.listInstalledSkills()).map((skill) => skill.id),
    );
    return parseSkillCatalogResponse(
      await responseJson(response, "Skill catalog"),
    ).map((item) => ({ ...item, installed: installed.has(item.id) }));
  }

  async function listInstalledSkills(): Promise<InstalledSkill[]> {
    await mkdir(services.skillsRoot, { recursive: true });
    const entries = await readdir(services.skillsRoot, { withFileTypes: true });
    const skills = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map(async (entry): Promise<InstalledSkill | undefined> => {
          const skillPath = join(services.skillsRoot, entry.name);
          try {
            const frontmatter = parseSkillFrontmatter(
              await readFile(join(skillPath, "SKILL.md"), "utf8"),
            );
            const metadata = await readAndMigrateSkillMetadata(skillPath);
            return {
              id: metadata?.id ?? `local/${entry.name}`,
              name: frontmatter.name,
              description: frontmatter.description,
              path: skillPath,
              enabled: true,
              ...(metadata?.source ? { source: metadata.source } : {}),
              ...(metadata?.installedAt
                ? { installedAt: metadata.installedAt }
                : {}),
            };
          } catch {
            return undefined;
          }
        }),
    );
    return skills
      .filter((skill): skill is InstalledSkill => Boolean(skill))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async function removeSkill(id: string): Promise<void> {
    const skill = (await services.listInstalledSkills()).find(
      (candidate) => candidate.id === id,
    );
    if (!skill) {
      throw new Error("Installed Skill was not found.");
    }
    const relation = relative(
      resolve(services.skillsRoot),
      resolve(skill.path),
    );
    if (!relation || relation.startsWith("..") || isAbsolute(relation)) {
      throw new Error("Installed Skill path is unsafe.");
    }
    const info = await lstat(skill.path);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error("Installed Skill path is unsafe.");
    }
    await rm(skill.path, { recursive: true });
  }
  const handlers = { searchSkills, listInstalledSkills, removeSkill };
  return handlers;
}
