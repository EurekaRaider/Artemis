import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { createManagedWorktree } from "../src/main/git-worktree.js";
import {
  applyWorkspaceChangeBundle,
  createWorkspaceChangeBundle,
} from "../src/main/workspace-handoff.js";

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
  worktreePath: string;
  bundleRoot: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "artemis-handoff-"));
  temporaryDirectories.push(root);
  await git(root, "init", "-b", "main");
  await git(root, "config", "user.email", "tests@artemis.local");
  await git(root, "config", "user.name", "Artemis Tests");
  await git(root, "config", "core.autocrlf", "false");
  await writeFile(join(root, "alpha.txt"), "alpha base\n", "utf8");
  await writeFile(join(root, "beta.txt"), "beta base\n", "utf8");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "base");
  const worktree = await createManagedWorktree({
    repositoryPath: root,
    managedRoot: join(root, ".managed"),
    id: "handoff-target",
  });
  return {
    root,
    worktreePath: worktree.path,
    bundleRoot: join(root, ".bundles"),
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("workspace handoff bundles", () => {
  it("copies only selected task changes into a worktree and leaves Local intact", async () => {
    const { root, worktreePath, bundleRoot } = await createRepository();
    await writeFile(join(root, "alpha.txt"), "alpha task\n", "utf8");
    await writeFile(join(root, "beta.txt"), "beta unrelated\n", "utf8");
    await writeFile(join(root, "new task.txt"), "new task\n", "utf8");

    const bundle = await createWorkspaceChangeBundle({
      sourceWorkspace: root,
      bundleRoot,
      paths: ["alpha.txt", "new task.txt"],
    });
    await applyWorkspaceChangeBundle({
      bundlePath: bundle.path,
      targetWorkspace: worktreePath,
    });

    expect(await readFile(join(worktreePath, "alpha.txt"), "utf8")).toBe(
      "alpha task\n",
    );
    expect(await readFile(join(worktreePath, "beta.txt"), "utf8")).toBe(
      "beta base\n",
    );
    expect(await readFile(join(worktreePath, "new task.txt"), "utf8")).toBe(
      "new task\n",
    );
    expect(await readFile(join(root, "alpha.txt"), "utf8")).toBe(
      "alpha task\n",
    );
    expect(bundle.manifest.paths).toEqual(["alpha.txt", "new task.txt"]);
  });

  it("rejects a conflicting target before changing any file", async () => {
    const { root, worktreePath, bundleRoot } = await createRepository();
    await writeFile(join(root, "alpha.txt"), "source change\n", "utf8");
    const bundle = await createWorkspaceChangeBundle({
      sourceWorkspace: root,
      bundleRoot,
      paths: ["alpha.txt"],
    });
    await writeFile(
      join(worktreePath, "alpha.txt"),
      "target conflict\n",
      "utf8",
    );

    await expect(
      applyWorkspaceChangeBundle({
        bundlePath: bundle.path,
        targetWorkspace: worktreePath,
      }),
    ).rejects.toThrow("cannot be applied cleanly");
    expect(await readFile(join(worktreePath, "alpha.txt"), "utf8")).toBe(
      "target conflict\n",
    );
  });

  it("rejects untracked collisions and different target HEADs", async () => {
    const { root, worktreePath, bundleRoot } = await createRepository();
    await writeFile(join(root, "notes.txt"), "source notes\n", "utf8");
    const bundle = await createWorkspaceChangeBundle({
      sourceWorkspace: root,
      bundleRoot,
      paths: ["notes.txt"],
    });
    await writeFile(join(worktreePath, "notes.txt"), "target notes\n", "utf8");

    await expect(
      applyWorkspaceChangeBundle({
        bundlePath: bundle.path,
        targetWorkspace: worktreePath,
      }),
    ).rejects.toThrow("already exists");

    await rm(join(worktreePath, "notes.txt"));
    await writeFile(
      join(worktreePath, "worktree-only.txt"),
      "commit\n",
      "utf8",
    );
    await git(worktreePath, "add", "worktree-only.txt");
    await git(worktreePath, "commit", "-m", "different head");
    await expect(
      applyWorkspaceChangeBundle({
        bundlePath: bundle.path,
        targetWorkspace: worktreePath,
      }),
    ).rejects.toThrow("different HEAD");
  });
});
