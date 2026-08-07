import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { getReviewDiff, mutateReviewDiff } from "../src/main/git-review.js";

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

async function createRepository(): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), "artemis-review-"));
  temporaryDirectories.push(workspace);
  await git(workspace, "init", "-b", "main");
  await git(workspace, "config", "user.email", "tests@artemis.local");
  await git(workspace, "config", "user.name", "Artemis Tests");
  await git(workspace, "config", "core.autocrlf", "false");
  await writeFile(join(workspace, "README.md"), "# Original\n", "utf8");
  await writeFile(join(workspace, "alpha.txt"), "one\ntwo\nthree\n", "utf8");
  await writeFile(join(workspace, "beta.txt"), "base\n", "utf8");
  await git(workspace, "add", ".");
  await git(workspace, "commit", "-m", "base");
  return workspace;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("Git review", () => {
  it("keeps tracked README and untracked binary files reviewable together", async () => {
    const workspace = await createRepository();
    await writeFile(join(workspace, "README.md"), "# Updated\n", "utf8");
    await writeFile(
      join(workspace, "asset.bin"),
      Buffer.from([0x00, 0x01, 0x02, 0x03]),
    );

    const review = await getReviewDiff({
      workspace,
      scope: "unstaged",
    });

    expect(review.available).toBe(true);
    expect(review.text).toContain("diff --git a/README.md b/README.md");
    expect
      .soft(review.text)
      .toContain("Binary files /dev/null and b/asset.bin differ");
    expect.soft(review.text).not.toContain("GIT binary patch");
    expect(review.files.map((file) => file.path)).toEqual([
      "README.md",
      "asset.bin",
    ]);
    expect(
      review.files.find((file) => file.path === "README.md")?.hunks,
    ).not.toHaveLength(0);
    expect(
      review.files.find((file) => file.path === "asset.bin"),
    ).toMatchObject({
      binary: true,
      status: "added",
      untracked: true,
    });
  });

  it("stages an untracked binary file from its Unstaged file target", async () => {
    const workspace = await createRepository();
    await writeFile(
      join(workspace, "asset.bin"),
      Buffer.from([0x00, 0x01, 0x02, 0x03]),
    );
    const unstaged = await getReviewDiff({
      workspace,
      scope: "unstaged",
    });
    const asset = unstaged.files.find((file) => file.path === "asset.bin");

    expect(asset).toMatchObject({
      binary: true,
      status: "added",
      untracked: true,
    });
    await mutateReviewDiff({
      workspace,
      scope: "unstaged",
      action: "stage",
      target: { kind: "file", id: asset!.id },
      recoveryRoot: join(workspace, ".recovery"),
    });

    const staged = await getReviewDiff({
      workspace,
      scope: "staged",
    });
    expect(staged.files).toEqual([
      expect.objectContaining({
        binary: true,
        path: "asset.bin",
        status: "added",
        untracked: false,
      }),
    ]);
  });

  it("parses tracked and untracked changes and stages only the selected hunk", async () => {
    const workspace = await createRepository();
    await writeFile(
      join(workspace, "alpha.txt"),
      "one\nchanged\nthree\n",
      "utf8",
    );
    await writeFile(join(workspace, "new file.txt"), "new\n", "utf8");

    const review = await getReviewDiff({
      workspace,
      scope: "unstaged",
    });

    expect(review.available).toBe(true);
    expect(review.files.map((file) => file.path)).toEqual([
      "alpha.txt",
      "new file.txt",
    ]);
    expect(review.files[0]?.hunks).toHaveLength(1);
    expect(review.files[0]?.hunks[0]?.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "deletion",
          oldLine: 2,
          text: "two",
        }),
        expect.objectContaining({
          kind: "addition",
          newLine: 2,
          text: "changed",
        }),
      ]),
    );
    expect(review.files[1]?.untracked).toBe(true);

    await mutateReviewDiff({
      workspace,
      scope: "unstaged",
      action: "stage",
      target: {
        kind: "hunk",
        id: review.files[0]!.hunks[0]!.id,
      },
      recoveryRoot: join(workspace, ".recovery"),
    });

    expect(
      await git(workspace, "diff", "--cached", "--", "alpha.txt"),
    ).toContain("+changed");
    expect(await git(workspace, "diff", "--", "alpha.txt")).toBe("");
    expect(
      await git(workspace, "status", "--short", "--", "new file.txt"),
    ).toBe('?? "new file.txt"\n');
  });

  it("unstages only the selected staged hunk", async () => {
    const workspace = await createRepository();
    await writeFile(
      join(workspace, "alpha.txt"),
      "one\nchanged\nthree\n",
      "utf8",
    );
    await git(workspace, "add", "alpha.txt");

    const review = await getReviewDiff({
      workspace,
      scope: "staged",
    });
    await mutateReviewDiff({
      workspace,
      scope: "staged",
      action: "unstage",
      target: {
        kind: "hunk",
        id: review.files[0]!.hunks[0]!.id,
      },
      recoveryRoot: join(workspace, ".recovery"),
    });

    expect(await git(workspace, "diff", "--cached", "--", "alpha.txt")).toBe(
      "",
    );
    expect(await git(workspace, "diff", "--", "alpha.txt")).toContain(
      "+changed",
    );
  });

  it("keeps separate hunks isolated and can recover an untracked file", async () => {
    const workspace = await createRepository();
    const original = Array.from(
      { length: 20 },
      (_, index) => `line-${index + 1}`,
    );
    await writeFile(join(workspace, "gamma.txt"), `${original.join("\n")}\n`);
    await git(workspace, "add", "gamma.txt");
    await git(workspace, "commit", "-m", "add gamma");
    const changed = [...original];
    changed[1] = "changed-near-start";
    changed[17] = "changed-near-end";
    await writeFile(join(workspace, "gamma.txt"), `${changed.join("\n")}\n`);
    await writeFile(join(workspace, "recover me.txt"), "recoverable\n", "utf8");

    const review = await getReviewDiff({
      workspace,
      scope: "unstaged",
    });
    const gamma = review.files.find((file) => file.path === "gamma.txt")!;
    expect(gamma.hunks).toHaveLength(2);
    await mutateReviewDiff({
      workspace,
      scope: "unstaged",
      action: "stage",
      target: { kind: "hunk", id: gamma.hunks[0]!.id },
      recoveryRoot: join(workspace, ".recovery"),
    });

    const stagedGamma = await git(
      workspace,
      "diff",
      "--cached",
      "--",
      "gamma.txt",
    );
    const unstagedGamma = await git(workspace, "diff", "--", "gamma.txt");
    expect(stagedGamma).toContain("changed-near-start");
    expect(stagedGamma).not.toContain("changed-near-end");
    expect(unstagedGamma).toContain("changed-near-end");
    expect(unstagedGamma).not.toContain("changed-near-start");

    const refreshed = await getReviewDiff({
      workspace,
      scope: "unstaged",
    });
    const untracked = refreshed.files.find(
      (file) => file.path === "recover me.txt",
    )!;
    const recovery = await mutateReviewDiff({
      workspace,
      scope: "unstaged",
      action: "revert",
      target: { kind: "file", id: untracked.id },
      recoveryRoot: join(workspace, ".recovery"),
    });

    await expect(access(join(workspace, "recover me.txt"))).rejects.toThrow();
    expect(
      await readFile(join(recovery.recoveryPath!, "recover me.txt"), "utf8"),
    ).toBe("recoverable\n");
  });

  it("backs up and reverts a selected unstaged file", async () => {
    const workspace = await createRepository();
    await writeFile(join(workspace, "alpha.txt"), "irreversible?\n", "utf8");
    const review = await getReviewDiff({
      workspace,
      scope: "unstaged",
    });
    const recoveryRoot = join(workspace, ".recovery");

    const result = await mutateReviewDiff({
      workspace,
      scope: "unstaged",
      action: "revert",
      target: {
        kind: "file",
        id: review.files[0]!.id,
      },
      recoveryRoot,
    });

    expect(await readFile(join(workspace, "alpha.txt"), "utf8")).toBe(
      "one\ntwo\nthree\n",
    );
    expect(result.recoveryPath).toBeDefined();
    expect(
      await readFile(join(result.recoveryPath!, "alpha.txt"), "utf8"),
    ).toBe("irreversible?\n");
  });

  it("supports last-turn filtering and branch-vs-base review", async () => {
    const workspace = await createRepository();
    await git(workspace, "checkout", "-b", "feature");
    await writeFile(join(workspace, "alpha.txt"), "feature\n", "utf8");
    await git(workspace, "add", "alpha.txt");
    await git(workspace, "commit", "-m", "feature");
    await writeFile(join(workspace, "alpha.txt"), "working alpha\n", "utf8");
    await writeFile(join(workspace, "beta.txt"), "working beta\n", "utf8");

    const lastTurn = await getReviewDiff({
      workspace,
      scope: "last-turn",
      paths: ["beta.txt"],
    });
    const branch = await getReviewDiff({
      workspace,
      scope: "branch",
      baseRef: "main",
    });

    expect(lastTurn.files.map((file) => file.path)).toEqual(["beta.txt"]);
    expect(lastTurn.text).toContain("+working beta");
    expect(lastTurn.text).not.toContain("working alpha");
    expect(branch.baseRef).toBe("main");
    expect(branch.text).toContain("+feature");
    expect(branch.text).not.toContain("working alpha");
  });

  it("rejects stale targets and mutations that do not belong to the scope", async () => {
    const workspace = await createRepository();
    await writeFile(join(workspace, "alpha.txt"), "changed\n", "utf8");

    await expect(
      mutateReviewDiff({
        workspace,
        scope: "unstaged",
        action: "stage",
        target: { kind: "file", id: "stale-id" },
        recoveryRoot: join(workspace, ".recovery"),
      }),
    ).rejects.toThrow("Review target is stale");

    const branch = await getReviewDiff({
      workspace,
      scope: "branch",
      baseRef: "main",
    });
    await expect(
      mutateReviewDiff({
        workspace,
        scope: "branch",
        action: "revert",
        target: {
          kind: "file",
          id: branch.files[0]?.id ?? "missing",
        },
        recoveryRoot: join(workspace, ".recovery"),
      }),
    ).rejects.toThrow("read-only");
  });
});
