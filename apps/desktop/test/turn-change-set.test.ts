import { execFile } from "node:child_process";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { AppStore } from "../src/main/store.js";
import { TurnChangeSetService } from "../src/main/turn-change-set.js";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture(): Promise<{
  root: string;
  store: AppStore;
  service: TurnChangeSetService;
}> {
  const root = await mkdtemp(join(tmpdir(), "artemis-turn-changes-"));
  temporaryDirectories.push(root);
  const workspace = join(root, "workspace");
  await execFileAsync("git", ["init", "-q", workspace]);
  await execFileAsync("git", ["config", "user.name", "Artemis Test"], {
    cwd: workspace,
  });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], {
    cwd: workspace,
  });
  await writeFile(join(workspace, "a.txt"), "before a\n", "utf8");
  await writeFile(join(workspace, "b.txt"), "before b\n", "utf8");
  await writeFile(join(workspace, ".gitignore"), "ignored.tmp\n", "utf8");
  await execFileAsync("git", ["add", "."], { cwd: workspace });
  await execFileAsync("git", ["commit", "-qm", "initial"], {
    cwd: workspace,
  });

  const now = "2026-08-28T00:00:00.000Z";
  const store = new AppStore(join(root, "state.sqlite"));
  store.upsertProject({
    id: "project-1",
    name: "Fixture",
    path: workspace,
    createdAt: now,
    updatedAt: now,
  });
  store.createThread({
    id: "thread-1",
    projectId: "project-1",
    title: "Fixture task",
    mode: "execute",
    target: "local",
    status: "idle",
    pinned: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
  });
  return {
    root: workspace,
    store,
    service: new TurnChangeSetService(join(root, "private"), store),
  };
}

describe("TurnChangeSetService", () => {
  it("captures an immutable turn diff and restores the exact before state", async () => {
    const { root, service, store } = await fixture();
    await service.begin({
      threadId: "thread-1",
      turnId: "turn-1",
      workspacePath: root,
    });
    await writeFile(join(root, "a.txt"), "after a\nsecond line\n", "utf8");
    await writeFile(join(root, "new.txt"), "new file\n", "utf8");
    await rm(join(root, "b.txt"));

    const payload = await service.complete("thread-1", "turn-1");
    expect(payload).toMatchObject({
      status: "ready",
      undoAvailable: true,
      additions: 3,
      deletions: 2,
    });
    expect(payload?.files.map((file) => [file.path, file.status])).toEqual([
      ["a.txt", "modified"],
      ["b.txt", "deleted"],
      ["new.txt", "added"],
    ]);
    expect(service.review("thread-1", "turn-1").text).toContain(
      "diff --git a/a.txt b/a.txt",
    );

    const { result, payload: undone } = await service.undo(
      "thread-1",
      "turn-1",
    );
    expect(result.restoredFiles).toEqual(["a.txt", "b.txt", "new.txt"]);
    expect(undone.status).toBe("undone");
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("before a\n");
    expect(await readFile(join(root, "b.txt"), "utf8")).toBe("before b\n");
    await expect(readFile(join(root, "new.txt"), "utf8")).rejects.toThrow();
    store.close();
  });

  it("keeps historical turn review immutable and rejects a conflicted undo", async () => {
    const { root, service, store } = await fixture();
    await service.begin({
      threadId: "thread-1",
      turnId: "turn-1",
      workspacePath: root,
    });
    await writeFile(join(root, "a.txt"), "turn one\n", "utf8");
    await service.complete("thread-1", "turn-1");
    const firstReview = service.review("thread-1", "turn-1").text;

    await service.begin({
      threadId: "thread-1",
      turnId: "turn-2",
      workspacePath: root,
    });
    await writeFile(join(root, "b.txt"), "turn two\n", "utf8");
    await service.complete("thread-1", "turn-2");
    expect(service.review("thread-1", "turn-1").text).toBe(firstReview);
    expect(firstReview).toContain("a.txt");
    expect(firstReview).not.toContain("b.txt");

    await writeFile(join(root, "b.txt"), "manual conflict\n", "utf8");
    await expect(service.undo("thread-1", "turn-2")).rejects.toThrow(
      /no longer matches/u,
    );
    expect(await readFile(join(root, "b.txt"), "utf8")).toBe(
      "manual conflict\n",
    );
    store.close();
  });

  it("captures renames as delete/add, marks binary files, and excludes ignored files", async () => {
    const { root, service, store } = await fixture();
    await service.begin({
      threadId: "thread-1",
      turnId: "turn-1",
      workspacePath: root,
    });
    await rename(join(root, "a.txt"), join(root, "renamed.txt"));
    await writeFile(join(root, "binary.dat"), Buffer.from([0, 1, 2, 3]));
    await writeFile(
      join(root, "ignored.tmp"),
      "not part of the turn\n",
      "utf8",
    );

    const payload = await service.complete("thread-1", "turn-1");
    expect(payload?.files.map((file) => [file.path, file.status])).toEqual([
      ["a.txt", "deleted"],
      ["binary.dat", "added"],
      ["renamed.txt", "added"],
    ]);
    expect(
      payload?.files.find((file) => file.path === "binary.dat")?.binary,
    ).toBe(true);
    expect(payload?.files.some((file) => file.path === "ignored.tmp")).toBe(
      false,
    );

    await service.undo("thread-1", "turn-1");
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("before a\n");
    await expect(readFile(join(root, "binary.dat"))).rejects.toThrow();
    await expect(readFile(join(root, "renamed.txt"))).rejects.toThrow();
    expect(await readFile(join(root, "ignored.tmp"), "utf8")).toBe(
      "not part of the turn\n",
    );
    store.close();
  });

  it("preserves pre-existing staged state and disables undo for background work", async () => {
    const { root, service, store } = await fixture();
    await writeFile(join(root, "a.txt"), "pre-existing staged\n", "utf8");
    await execFileAsync("git", ["add", "a.txt"], { cwd: root });
    await service.begin({
      threadId: "thread-1",
      turnId: "turn-1",
      workspacePath: root,
    });
    await writeFile(join(root, "a.txt"), "turn edit\n", "utf8");
    const first = await service.complete("thread-1", "turn-1");
    expect(first?.undoAvailable).toBe(true);
    await service.undo("thread-1", "turn-1");
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe(
      "pre-existing staged\n",
    );
    expect(
      (
        await execFileAsync("git", ["diff", "--cached", "--", "a.txt"], {
          cwd: root,
        })
      ).stdout,
    ).toContain("pre-existing staged");

    await service.begin({
      threadId: "thread-1",
      turnId: "turn-2",
      workspacePath: root,
    });
    await writeFile(join(root, "b.txt"), "background edit\n", "utf8");
    const second = await service.complete("thread-1", "turn-2", true);
    expect(second).toMatchObject({
      undoAvailable: false,
      message: expect.stringContaining("still running"),
    });
    await expect(service.undo("thread-1", "turn-2")).rejects.toThrow(
      /still running/u,
    );
    store.close();
  });

  it("atomically rejects undo after the Git index changes", async () => {
    const { root, service, store } = await fixture();
    await service.begin({
      threadId: "thread-1",
      turnId: "turn-1",
      workspacePath: root,
    });
    await writeFile(join(root, "b.txt"), "turn edit\n", "utf8");
    await service.complete("thread-1", "turn-1");
    await execFileAsync("git", ["add", "b.txt"], { cwd: root });

    await expect(service.undo("thread-1", "turn-1")).rejects.toThrow(
      /Git index changed/u,
    );
    expect(await readFile(join(root, "b.txt"), "utf8")).toBe("turn edit\n");
    store.close();
  });
});
