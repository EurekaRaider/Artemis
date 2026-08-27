import { execFile } from "node:child_process";
import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  commitProjectChanges,
  createGitBranch,
  inspectGitBranches,
  pushProjectBranch,
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

async function bareRemote(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "artemis-git-remote-"));
  cleanup.push(path);
  await git(path, "init", "--bare", "-b", "main");
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
      additions: 0,
      deletions: 0,
      stagedAdditions: 0,
      stagedDeletions: 0,
      stagedCount: 0,
      unstagedCount: 0,
      untrackedCount: 0,
      conflictCount: 0,
      ahead: 0,
      behind: 0,
      branches: [],
    });
  });

  it("reports branch, working-tree line totals, and status categories", async () => {
    const path = await repository();
    await writeFile(join(path, "README.md"), "# Artemis\nUpdated\n", "utf8");
    await git(path, "add", "README.md");
    await writeFile(join(path, "notes.txt"), "draft\n", "utf8");

    const info = await inspectGitBranches(path);

    expect(info.managed).toBe(true);
    expect(info.root).toBe(await realpath(path));
    expect(info.currentBranch).toBe("main");
    expect(info.head).toMatch(/^[a-f\d]+$/u);
    expect(info.headOid).toBe((await git(path, "rev-parse", "HEAD")).trim());
    expect(info.detached).toBe(false);
    expect(info.changeCount).toBe(2);
    expect(info.additions).toBe(2);
    expect(info.deletions).toBe(0);
    expect(info.stagedAdditions).toBe(1);
    expect(info.stagedDeletions).toBe(0);
    expect(info.stagedCount).toBe(1);
    expect(info.unstagedCount).toBe(0);
    expect(info.untrackedCount).toBe(1);
    expect(info.conflictCount).toBe(0);
    expect(info.branches).toContainEqual({ name: "main", current: true });
  });

  it("counts an untracked binary without inventing line totals", async () => {
    const path = await repository();
    await writeFile(join(path, "fixture.bin"), Buffer.from([0, 1, 2, 255]));

    const info = await inspectGitBranches(path);

    expect(info.changeCount).toBe(1);
    expect(info.untrackedCount).toBe(1);
    expect(info.additions).toBe(0);
    expect(info.deletions).toBe(0);
  });

  it("reports configured upstream divergence", async () => {
    const path = await repository();
    const remote = await bareRemote();
    await git(path, "remote", "add", "origin", remote);
    await git(path, "push", "-u", "origin", "main");
    await writeFile(join(path, "ahead.txt"), "ahead\n", "utf8");
    await git(path, "add", "ahead.txt");
    await git(path, "commit", "-m", "ahead");

    const info = await inspectGitBranches(path);
    expect(info.upstream).toBe("origin/main");
    expect(info.ahead).toBe(1);
    expect(info.behind).toBe(0);
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

  it("stages every working-tree change and commits it", async () => {
    const path = await repository();
    await writeFile(join(path, "delete-me.txt"), "delete me\n", "utf8");
    await git(path, "add", "delete-me.txt");
    await git(path, "commit", "-m", "add deletion fixture");
    await writeFile(join(path, "README.md"), "# Updated\n", "utf8");
    await writeFile(join(path, "new.txt"), "new\n", "utf8");
    await rm(join(path, "delete-me.txt"));

    const result = await commitProjectChanges(path, "Commit all changes");

    expect(result.commit).toMatch(/^[a-f0-9]{40}$/u);
    expect(result.gitInfo.changeCount).toBe(0);
    expect((await git(path, "log", "-1", "--pretty=%s")).trim()).toBe(
      "Commit all changes",
    );
    expect((await git(path, "ls-files", "new.txt")).trim()).toBe("new.txt");
    expect((await git(path, "ls-files", "delete-me.txt")).trim()).toBe("");
  });

  it("can commit only staged changes and generate an empty commit message", async () => {
    const path = await repository();
    await writeFile(join(path, "staged.txt"), "staged\n", "utf8");
    await writeFile(join(path, "unstaged.txt"), "unstaged\n", "utf8");
    await git(path, "add", "staged.txt");

    const result = await commitProjectChanges(path, "", false);

    expect(result.commit).toMatch(/^[a-f0-9]{40}$/u);
    expect((await git(path, "log", "-1", "--pretty=%s")).trim()).toBe(
      "Update staged.txt",
    );
    expect(result.gitInfo.changeCount).toBe(1);
    expect(result.gitInfo.untrackedCount).toBe(1);
    expect((await git(path, "ls-files", "unstaged.txt")).trim()).toBe("");
  });

  it("rejects staged-only commits when nothing is staged", async () => {
    const path = await repository();
    await writeFile(join(path, "unstaged.txt"), "unstaged\n", "utf8");

    await expect(commitProjectChanges(path, "", false)).rejects.toThrow(
      /no staged changes/u,
    );
  });

  it("rejects non-string commit messages before staging changes", async () => {
    const path = await repository();
    await writeFile(join(path, "invalid.txt"), "invalid\n", "utf8");

    await expect(
      commitProjectChanges(path, { message: "invalid" }),
    ).rejects.toThrow(/message is invalid/u);
    expect((await git(path, "diff", "--cached", "--name-only")).trim()).toBe(
      "",
    );
  });

  it("rejects an invalid include-unstaged selection before staging", async () => {
    const path = await repository();
    await writeFile(join(path, "invalid-option.txt"), "invalid\n", "utf8");

    await expect(
      commitProjectChanges(path, "Message", "yes" as never),
    ).rejects.toThrow(/include-unstaged selection is invalid/iu);
    expect((await git(path, "diff", "--cached", "--name-only")).trim()).toBe(
      "",
    );
  });

  it("keeps staged changes when a commit hook rejects the commit", async () => {
    const path = await repository();
    const hook = join(path, ".git", "hooks", "pre-commit");
    await writeFile(hook, "#!/bin/sh\necho rejected >&2\nexit 1\n", "utf8");
    await chmod(hook, 0o755);
    await writeFile(join(path, "blocked.txt"), "blocked\n", "utf8");

    await expect(commitProjectChanges(path, "Blocked")).rejects.toThrow(
      /rejected/u,
    );
    expect((await git(path, "diff", "--cached", "--name-only")).trim()).toBe(
      "blocked.txt",
    );
  });

  it("pushes only to the configured upstream without forcing", async () => {
    const path = await repository();
    const remote = await bareRemote();
    await git(path, "remote", "add", "origin", remote);
    await git(path, "push", "-u", "origin", "main");
    await writeFile(join(path, "push.txt"), "push\n", "utf8");
    const committed = await commitProjectChanges(path, "Push me");
    expect(committed.gitInfo.ahead).toBe(1);

    const pushed = await pushProjectBranch(path);

    expect(pushed.upstream).toBe("origin/main");
    expect(pushed.gitInfo.ahead).toBe(0);
    expect((await git(remote, "rev-parse", "refs/heads/main")).trim()).toBe(
      committed.commit,
    );
  });

  it("blocks push without an upstream and when the known upstream is ahead", async () => {
    const path = await repository();
    await writeFile(join(path, "local.txt"), "local\n", "utf8");
    await commitProjectChanges(path, "Local only");
    await expect(pushProjectBranch(path)).rejects.toThrow(
      /no configured upstream/u,
    );

    const remote = await bareRemote();
    await git(path, "remote", "add", "origin", remote);
    await git(path, "push", "-u", "origin", "main");
    const other = await mkdtemp(join(tmpdir(), "artemis-git-other-"));
    cleanup.push(other);
    await git(other, "clone", remote, ".");
    await git(other, "config", "user.email", "other@example.invalid");
    await git(other, "config", "user.name", "Other Tests");
    await writeFile(join(other, "remote.txt"), "remote\n", "utf8");
    await git(other, "add", "remote.txt");
    await git(other, "commit", "-m", "remote ahead");
    await git(other, "push", "origin", "main");
    await git(path, "fetch", "origin");

    const behind = await inspectGitBranches(path);
    expect(behind.behind).toBe(1);
    await expect(pushProjectBranch(path)).rejects.toThrow(
      /behind or diverged/u,
    );

    await writeFile(join(path, "diverged.txt"), "diverged\n", "utf8");
    await commitProjectChanges(path, "Local divergence");
    const diverged = await inspectGitBranches(path);
    expect(diverged.ahead).toBe(1);
    expect(diverged.behind).toBe(1);
    await expect(pushProjectBranch(path)).rejects.toThrow(
      /behind or diverged/u,
    );
  });

  it("does not retry or force a non-fast-forward push", async () => {
    const path = await repository();
    const remote = await bareRemote();
    await git(path, "remote", "add", "origin", remote);
    await git(path, "push", "-u", "origin", "main");
    const other = await mkdtemp(join(tmpdir(), "artemis-git-non-ff-"));
    cleanup.push(other);
    await git(other, "clone", remote, ".");
    await git(other, "config", "user.email", "other@example.invalid");
    await git(other, "config", "user.name", "Other Tests");
    await writeFile(join(other, "remote-only.txt"), "remote\n", "utf8");
    await git(other, "add", "remote-only.txt");
    await git(other, "commit", "-m", "remote only");
    await git(other, "push", "origin", "main");
    const remoteHead = (
      await git(remote, "rev-parse", "refs/heads/main")
    ).trim();

    await writeFile(join(path, "local-only.txt"), "local\n", "utf8");
    await commitProjectChanges(path, "local only");
    const stale = await inspectGitBranches(path);
    expect(stale.ahead).toBe(1);
    expect(stale.behind).toBe(0);

    await expect(pushProjectBranch(path)).rejects.toThrow(
      /rejected|fetch first/u,
    );
    expect((await git(remote, "rev-parse", "refs/heads/main")).trim()).toBe(
      remoteHead,
    );
  });

  it("reports conflicts and blocks commit and push", async () => {
    const path = await repository();
    await createGitBranch(path, "conflict-side");
    await writeFile(join(path, "README.md"), "side\n", "utf8");
    await commitProjectChanges(path, "side change");
    await switchGitBranch(path, "main");
    await writeFile(join(path, "README.md"), "main\n", "utf8");
    await commitProjectChanges(path, "main change");
    await expect(git(path, "merge", "conflict-side")).rejects.toThrow();

    const info = await inspectGitBranches(path);
    expect(info.conflictCount).toBe(1);
    await expect(commitProjectChanges(path, "conflicted")).rejects.toThrow(
      /resolve repository conflicts/iu,
    );
    await expect(pushProjectBranch(path)).rejects.toThrow(
      /resolve repository conflicts/iu,
    );
  });

  it("blocks committing on a detached head", async () => {
    const path = await repository();
    await git(path, "checkout", "--detach");
    await writeFile(join(path, "detached.txt"), "detached\n", "utf8");

    await expect(commitProjectChanges(path, "Detached")).rejects.toThrow(
      /switch to a branch/u,
    );
  });
});
