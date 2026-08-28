import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  cleanupGoalObjective,
  GOAL_OBJECTIVE_INLINE_MAX_CHARACTERS,
  GOAL_OBJECTIVE_PREVIEW_MARKER,
  managedGoalObjectivePath,
  materializeGoalObjective,
  readGoalObjective,
} from "../src/main/goal-objective.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("managed Goal objectives", () => {
  it("keeps short objectives inline", async () => {
    const root = await mkdtemp(join(tmpdir(), "artemis-goal-objective-"));
    roots.push(root);
    expect(await materializeGoalObjective(root, "  Ship it  ")).toBe("Ship it");
  });

  it("materializes long objectives, preserves an inline preview, and cleans up", async () => {
    const root = await mkdtemp(join(tmpdir(), "artemis-goal-objective-"));
    roots.push(root);
    const objective = `# Goal\n\n${"verification ".repeat(420)}`.trim();
    expect(objective.length).toBeGreaterThan(
      GOAL_OBJECTIVE_INLINE_MAX_CHARACTERS,
    );

    const persisted = await materializeGoalObjective(root, objective);
    const filePath = managedGoalObjectivePath(root, persisted);
    expect(persisted.length).toBeLessThanOrEqual(
      GOAL_OBJECTIVE_INLINE_MAX_CHARACTERS,
    );
    expect(persisted).toContain(GOAL_OBJECTIVE_PREVIEW_MARKER);
    expect(filePath).toBeTruthy();
    expect(await readFile(filePath!, "utf8")).toBe(`${objective}\n`);
    expect(await readGoalObjective(root, persisted)).toBe(objective);

    await cleanupGoalObjective(root, persisted);
    await expect(stat(filePath!)).rejects.toThrow();
  });

  it.each([3_999, 4_000])(
    "keeps a %i-character objective inline",
    async (length) => {
      const root = await mkdtemp(join(tmpdir(), "artemis-goal-objective-"));
      roots.push(root);
      const objective = "x".repeat(length);
      expect(await materializeGoalObjective(root, objective)).toBe(objective);
    },
  );

  it("materializes a 4,001-character objective", async () => {
    const root = await mkdtemp(join(tmpdir(), "artemis-goal-objective-"));
    roots.push(root);
    const objective = "x".repeat(4_001);
    const persisted = await materializeGoalObjective(root, objective);
    expect(managedGoalObjectivePath(root, persisted)).toBeTruthy();
    expect(await readGoalObjective(root, persisted)).toBe(objective);
  });

  it("never follows a managed reference outside its root", async () => {
    const root = await mkdtemp(join(tmpdir(), "artemis-goal-objective-"));
    roots.push(root);
    const outside = join(tmpdir(), "outside-goal.md");
    const reference = `Follow the objective in the Artemis-managed file at ${outside}`;
    expect(managedGoalObjectivePath(root, reference)).toBeUndefined();
    expect(await readGoalObjective(root, reference)).toBe(reference);
  });
});
