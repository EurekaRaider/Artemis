import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { isAbsolute, posix, relative, resolve } from "node:path";
import type { SkillCatalogItem } from "../../../shared/api.js";
import { record, text } from "./catalog-values.js";
import { type GithubTreeEntry } from "./catalog-contracts.js";
export const SKILL_REGISTRY = "https://skills.sh";

export const GITHUB_API = "https://api.github.com";

export const GITHUB_RAW = "https://raw.githubusercontent.com";

export const MAX_SKILL_FILES = 200;

export const MAX_SKILL_FILE_BYTES = 5 * 1024 * 1024;

export const MAX_SKILL_BYTES = 20 * 1024 * 1024;

export function parseSkillCatalogResponse(value: unknown): SkillCatalogItem[] {
  const skills = record(value)?.skills;
  if (!Array.isArray(skills)) {
    throw new Error("Skill catalog returned an invalid response.");
  }
  return skills.flatMap((entry) => {
    const item = record(entry);
    const id = text(item?.id);
    const slug = text(item?.skillId);
    const name = text(item?.name);
    const source = text(item?.source);
    if (
      !id ||
      !slug ||
      !name ||
      !source ||
      id !== `${source}/${slug}` ||
      !/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/u.test(source) ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug)
    ) {
      return [];
    }
    return [
      {
        id,
        slug,
        name,
        source,
        installs:
          typeof item?.installs === "number" && Number.isFinite(item.installs)
            ? Math.max(0, Math.floor(item.installs))
            : 0,
        installed: false,
        sourceUrl: `https://github.com/${source}`,
        catalogUrl: `${SKILL_REGISTRY}/${id}`,
      },
    ];
  });
}

export function githubTreeEntries(value: unknown): GithubTreeEntry[] {
  const payload = record(value);
  if (payload?.truncated === true || !Array.isArray(payload?.tree)) {
    throw new Error("GitHub returned an incomplete Skill file tree.");
  }
  return payload.tree.flatMap((value) => {
    const entry = record(value);
    const path = text(entry?.path);
    const sha = text(entry?.sha);
    const size =
      typeof entry?.size === "number" &&
      Number.isFinite(entry.size) &&
      entry.size >= 0
        ? Math.floor(entry.size)
        : undefined;
    if (entry?.type !== "blob" || !path || !sha) return [];
    return [{ path, type: "blob" as const, sha, ...(size ? { size } : {}) }];
  });
}

export function skillMarkerRank(path: string, slug: string): number {
  const preferred = [
    `skills/${slug}/SKILL.md`,
    `skills/.curated/${slug}/SKILL.md`,
    `skills/.experimental/${slug}/SKILL.md`,
    `.agents/skills/${slug}/SKILL.md`,
    `.pi/skills/${slug}/SKILL.md`,
  ];
  const preferredIndex = preferred.indexOf(path);
  if (preferredIndex >= 0) return preferredIndex;
  return 100 + path.split("/").length;
}

export function parseSkillFrontmatter(contents: string): {
  name: string;
  description: string;
} {
  let name: unknown;
  let description: unknown;
  try {
    ({ name, description } = parseFrontmatter(contents).frontmatter);
  } catch {
    throw new Error("Skill has invalid SKILL.md frontmatter.");
  }
  if (
    typeof name !== "string" ||
    typeof description !== "string" ||
    !description.trim() ||
    !/^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$/u.test(name.trim()) ||
    name.trim().length > 64 ||
    description.trim().length > 1_024
  ) {
    throw new Error("Skill has invalid SKILL.md frontmatter.");
  }
  return { name: name.trim(), description: description.trim() };
}

export function safeSkillPath(root: string, inputPath: string): string {
  const normalized = inputPath.replaceAll("\\", "/");
  if (
    !normalized ||
    posix.isAbsolute(normalized) ||
    normalized.split("/").some((segment) => segment === ".." || !segment)
  ) {
    throw new Error(`Skill contains an unsafe path: ${inputPath}`);
  }
  const target = resolve(root, ...normalized.split("/"));
  const fromRoot = relative(resolve(root), target);
  if (!fromRoot || fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    throw new Error(`Skill contains an unsafe path: ${inputPath}`);
  }
  return target;
}
