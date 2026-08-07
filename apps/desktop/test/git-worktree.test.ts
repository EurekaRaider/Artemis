import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  branchizeManagedWorktree,
  createManagedWorktree,
  listGitWorktrees,
  removeManagedWorktree,
  restoreWorktreeSnapshot,
} from "../src/main/git-worktree.js";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  return stdout;
}

async function createRepository(): Promise<{
  root: string;
  managedRoot: string;
  recoveryRoot: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "artemis-worktree-"));
  temporaryDirectories.push(root);
  await git(root, "init", "-b", "main");
  await git(root, "config", "user.email", "tests@artemis.local");
  await git(root, "config", "user.name", "Artemis Tests");
  await git(root, "config", "core.autocrlf", "false");
  await writeFile(join(root, "README.md"), "# Base\n", "utf8");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "base");
  return {
    root,
    managedRoot: join(root, ".managed"),
    recoveryRoot: join(root, ".recovery"),
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("managed Git worktrees", () => {
  it("creates a detached worktree without touching local dirty changes", async () => {
    const { root, managedRoot } = await createRepository();
    await writeFile(join(root, "README.md"), "# Dirty local\n", "utf8");

    const created = await createManagedWorktree({
      repositoryPath: root,
      managedRoot,
      id: "task-one",
    });

    expect(created.detached).toBe(true);
    expect(created.branch).toBeUndefined();
    expect(await readFile(join(created.path, "README.md"), "utf8")).toBe(
      "# Base\n",
    );
    expect(await readFile(join(root, "README.md"), "utf8")).toBe(
      "# Dirty local\n",
    );
    expect((await listGitWorktrees(root)).map((item) => item.path)).toContain(
      created.path,
    );
  });

  it("turns a detached managed worktree into a new branch", async () => {
    const { root, managedRoot } = await createRepository();
    const created = await createManagedWorktree({
      repositoryPath: root,
      managedRoot,
      id: "task-two",
    });

    const branched = await branchizeManagedWorktree({
      repositoryPath: root,
      managedRoot,
      worktreePath: created.path,
      branchName: "feature/task-two",
    });

    expect(branched.detached).toBe(false);
    expect(branched.branch).toBe("feature/task-two");
    expect((await git(created.path, "branch", "--show-current")).trim()).toBe(
      "feature/task-two",
    );
  });

  it("refuses dirty cleanup, then snapshots and removes on explicit force", async () => {
    const { root, managedRoot, recoveryRoot } = await createRepository();
    const created = await createManagedWorktree({
      repositoryPath: root,
      managedRoot,
      id: "task-three",
    });
    await writeFile(
      join(created.path, "README.md"),
      "# Worktree edit\n",
      "utf8",
    );
    await writeFile(join(created.path, "notes.txt"), "untracked\n", "utf8");

    await expect(
      removeManagedWorktree({
        repositoryPath: root,
        managedRoot,
        worktreePath: created.path,
        recoveryRoot,
        force: false,
      }),
    ).rejects.toThrow("uncommitted changes");

    const removed = await removeManagedWorktree({
      repositoryPath: root,
      managedRoot,
      worktreePath: created.path,
      recoveryRoot,
      force: true,
    });

    expect(removed.recoveryPath).toBeDefined();
    expect(
      await readFile(join(removed.recoveryPath!, "tracked.patch"), "utf8"),
    ).toContain("+# Worktree edit");
    expect(
      await readFile(
        join(removed.recoveryPath!, "untracked", "notes.txt"),
        "utf8",
      ),
    ).toBe("untracked\n");
    await expect(access(created.path)).rejects.toThrow();
    expect(
      (await listGitWorktrees(root)).map((item) => item.path),
    ).not.toContain(created.path);

    const restored = await restoreWorktreeSnapshot({
      recoveryRoot,
      recoveryPath: removed.recoveryPath!,
      targetWorkspace: root,
    });
    expect(restored.restoredFiles).toContain("tracked.patch");
    expect(await readFile(join(root, "README.md"), "utf8")).toBe(
      "# Worktree edit\n",
    );
    expect(await readFile(join(root, "notes.txt"), "utf8")).toBe("untracked\n");
  });

  it("rejects paths outside the managed root and existing branch names", async () => {
    const { root, managedRoot, recoveryRoot } = await createRepository();
    const created = await createManagedWorktree({
      repositoryPath: root,
      managedRoot,
      id: "task-four",
    });

    await expect(
      branchizeManagedWorktree({
        repositoryPath: root,
        managedRoot,
        worktreePath: created.path,
        branchName: "main",
      }),
    ).rejects.toThrow("already exists");

    await expect(
      removeManagedWorktree({
        repositoryPath: root,
        managedRoot,
        worktreePath: root,
        recoveryRoot,
        force: true,
      }),
    ).rejects.toThrow("outside the managed root");

    await expect(
      restoreWorktreeSnapshot({
        recoveryRoot,
        recoveryPath: root,
        targetWorkspace: root,
      }),
    ).rejects.toThrow("outside the managed root");
  });
});
