import { access, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";

export const SKILL_METADATA_FILE = ".artemis-skill.json";
export const LEGACY_SKILL_METADATA_FILE = ".lightningstorm-skill.json";

export interface SkillInstallerMetadata {
  version: 1;
  id: string;
  source: string;
  hash?: string;
  installedAt: string;
}

export function isSkillInstallerMetadata(path: string): boolean {
  return path === SKILL_METADATA_FILE || path === LEGACY_SKILL_METADATA_FILE;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseSkillInstallerMetadata(
  value: unknown,
): SkillInstallerMetadata | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const metadata = value as Record<string, unknown>;
  if (
    metadata.version !== 1 ||
    !nonEmptyString(metadata.id) ||
    !nonEmptyString(metadata.source) ||
    !nonEmptyString(metadata.installedAt) ||
    (metadata.hash !== undefined && !nonEmptyString(metadata.hash))
  ) {
    return undefined;
  }
  return {
    version: 1,
    id: metadata.id,
    source: metadata.source,
    installedAt: metadata.installedAt,
    ...(metadata.hash ? { hash: metadata.hash } : {}),
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function readMetadata(
  path: string,
): Promise<SkillInstallerMetadata | undefined> {
  try {
    return parseSkillInstallerMetadata(
      JSON.parse(await readFile(path, "utf8")),
    );
  } catch (error) {
    if (
      error instanceof SyntaxError ||
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return undefined;
    }
    throw error;
  }
}

export async function readAndMigrateSkillMetadata(
  skillPath: string,
): Promise<SkillInstallerMetadata | undefined> {
  const currentPath = join(skillPath, SKILL_METADATA_FILE);
  const legacyPath = join(skillPath, LEGACY_SKILL_METADATA_FILE);
  if (await exists(currentPath)) {
    const current = await readMetadata(currentPath);
    if (current && (await readMetadata(legacyPath))) {
      await rm(legacyPath, { force: true });
    }
    return current;
  }

  const legacy = await readMetadata(legacyPath);
  if (!legacy) return undefined;
  try {
    await rename(legacyPath, currentPath);
    return legacy;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EEXIST" && code !== "ENOENT") throw error;
    return readMetadata(currentPath);
  }
}
