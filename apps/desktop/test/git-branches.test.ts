import { execFile } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  createGitBranch,
  inspectGitBranches,
  switchGitBranch,
} from "../src/main/git-branches.js";

const execFileAsync = promisify(execFile);
const cleanup: string[] = [];

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
  });
  return stdout;
}

async function repository(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "artemis-git-branches-"));
  cleanup.push(path);
  await git(path, "init", "-b", "main");
  await git(path, "config", "user.email", "artemis@example.invalid");
  await git(path, "config", "user.name", "Artemis Tests");
  await writeFile(join(path, "README.md"), "# Artemis\n", "utf8");
  await git(path, "add", "README.md");
  await git(path, "commit", "-m", "initial");
  return path;
}

afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("project Git branches", () => {
  it("reports a directory outside Git without treating it as an error", async () => {
    const path = await mkdtemp(join(tmpdir(), "artemis-no-git-"));
    cleanup.push(path);

    await expect(inspectGitBranches(path)).resolves.toEqual({
      managed: false,
      detached: false,
      changeCount: 0,
      branches: [],
    });
  });

  it("reports the current local branch and uncommitted file count", async () => {
    const path = await repository();
    await writeFile(join(path, "notes.txt"), "draft\n", "utf8");

    const info = await inspectGitBranches(path);

    expect(info.managed).toBe(true);
    expect(info.root).toBe(await realpath(path));
    expect(info.currentBranch).toBe("main");
    expect(info.detached).toBe(false);
    expect(info.changeCount).toBe(1);
    expect(info.branches).toContainEqual({ name: "main", current: true });
  });

  it("creates and switches local branches", async () => {
    const path = await repository();

    const created = await createGitBranch(path, "feature/context-menu");
    expect(created.currentBranch).toBe("feature/context-menu");
    expect(created.branches).toEqual(
      expect.arrayContaining([
        { name: "feature/context-menu", current: true },
        { name: "main", current: false },
      ]),
    );

    const switched = await switchGitBranch(path, "main");
    expect(switched.currentBranch).toBe("main");
    expect(switched.branches).toEqual(
      expect.arrayContaining([
        { name: "feature/context-menu", current: false },
        { name: "main", current: true },
      ]),
    );
  });

  it("rejects invalid and missing branch names", async () => {
    const path = await repository();

    await expect(createGitBranch(path, "--dangerous")).rejects.toThrow();
    await expect(switchGitBranch(path, "missing")).rejects.toThrow();
  });
});
