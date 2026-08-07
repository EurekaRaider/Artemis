import { execFile } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  attachPermanentWorktree,
  listGitWorktrees,
} from "../src/main/git-worktree.js";

const execFileAsync = promisify(execFile);
const cleanupPaths: string[] = [];

async function git(cwd: string, ...args: string[]) {
  await execFileAsync("git", args, { cwd, windowsHide: true });
}

async function createRepository() {
  const root = await mkdtemp(join(tmpdir(), "artemis-permanent-"));
  cleanupPaths.push(root);
  const repository = join(root, "repository");
  const permanent = join(root, "permanent");
  await mkdir(repository);
  await git(repository, "init", "-b", "main");
  await git(repository, "config", "user.email", "test@artemis.local");
  await git(repository, "config", "user.name", "Artemis Test");
  await writeFile(join(repository, "README.md"), "root\n");
  await git(repository, "add", "README.md");
  await git(repository, "commit", "-m", "initial");
  await git(
    repository,
    "worktree",
    "add",
    "-b",
    "feature/permanent",
    permanent,
  );
  return { repository, permanent };
}

afterEach(async () => {
  for (const path of cleanupPaths.splice(0)) {
    await rm(path, { recursive: true, force: true });
  }
});

describe("attachPermanentWorktree", () => {
  it("attaches an existing registered worktree without managing its lifetime", async () => {
    const { repository, permanent } = await createRepository();

    const attached = await attachPermanentWorktree({
      repositoryPath: repository,
      worktreePath: permanent,
    });
    const canonicalPermanent = await realpath(permanent);

    expect(attached).toMatchObject({
      path: canonicalPermanent,
      branch: "feature/permanent",
      detached: false,
      locked: false,
      prunable: false,
    });
    expect(await listGitWorktrees(repository)).toHaveLength(2);
  });

  it("rejects the primary checkout", async () => {
    const { repository } = await createRepository();

    await expect(
      attachPermanentWorktree({
        repositoryPath: repository,
        worktreePath: repository,
      }),
    ).rejects.toThrow("primary checkout is Local");
  });
});
