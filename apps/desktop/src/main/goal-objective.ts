import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const GOAL_OBJECTIVE_INLINE_MAX_CHARACTERS = 4_000;
export const GOAL_OBJECTIVE_MAX_CHARACTERS = 100_000;
export const GOAL_OBJECTIVE_REFERENCE_PREFIX =
  "Follow the objective in the Artemis-managed file at ";
export const GOAL_OBJECTIVE_PREVIEW_MARKER = "\n\nObjective preview:\n";

export function managedGoalObjectivePath(
  rootPath: string,
  objective: string,
): string | undefined {
  if (!objective.startsWith(GOAL_OBJECTIVE_REFERENCE_PREFIX)) return undefined;
  const filePath = resolve(
    objective
      .slice(GOAL_OBJECTIVE_REFERENCE_PREFIX.length)
      .split("\n", 1)[0]!
      .trim(),
  );
  const root = resolve(rootPath);
  const relativePath = relative(root, filePath);
  if (
    !relativePath ||
    relativePath.startsWith(`..${sep}`) ||
    relativePath === ".." ||
    isAbsolute(relativePath)
  ) {
    return undefined;
  }
  return filePath;
}

export async function materializeGoalObjective(
  rootPath: string,
  objective: string,
): Promise<string> {
  const normalized = objective.trim();
  if (!normalized) throw new Error("Goal objective cannot be empty.");
  if (normalized.length > GOAL_OBJECTIVE_MAX_CHARACTERS) {
    throw new Error(
      `Goal objective cannot exceed ${GOAL_OBJECTIVE_MAX_CHARACTERS.toLocaleString()} characters.`,
    );
  }
  if (normalized.length <= GOAL_OBJECTIVE_INLINE_MAX_CHARACTERS) {
    return normalized;
  }
  const directory = join(rootPath, randomUUID());
  const filePath = join(directory, "goal-objective.md");
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(filePath, `${normalized}\n`, "utf8");
  } catch (error) {
    await rm(directory, { force: true, recursive: true });
    throw error;
  }
  const reference = `${GOAL_OBJECTIVE_REFERENCE_PREFIX}${filePath}`;
  const previewLength = Math.max(
    0,
    GOAL_OBJECTIVE_INLINE_MAX_CHARACTERS -
      reference.length -
      GOAL_OBJECTIVE_PREVIEW_MARKER.length,
  );
  return `${reference}${GOAL_OBJECTIVE_PREVIEW_MARKER}${normalized.slice(0, previewLength)}`;
}

export async function readGoalObjective(
  rootPath: string,
  objective: string,
): Promise<string> {
  const filePath = managedGoalObjectivePath(rootPath, objective);
  if (!filePath) return objective;
  return (await readFile(filePath, "utf8")).trimEnd();
}

export async function cleanupGoalObjective(
  rootPath: string,
  objective: string | undefined,
): Promise<void> {
  if (!objective) return;
  const filePath = managedGoalObjectivePath(rootPath, objective);
  if (!filePath) return;
  await rm(dirname(filePath), { force: true, recursive: true });
}
