import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AppStore } from "../src/main/store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("conversation deletion persistence", () => {
  it("deletes the thread and cascades its events and review comments without touching siblings", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-thread-delete-"));
    temporaryDirectories.push(directory);
    const store = new AppStore(join(directory, "state.sqlite"));
    const now = "2026-07-30T00:00:00.000Z";

    store.upsertProject({
      id: "project-1",
      name: "Artemis",
      path: join(directory, "workspace"),
      createdAt: now,
      updatedAt: now,
    });
    for (const [id, title] of [
      ["thread-delete", "Delete me"],
      ["thread-keep", "Keep me"],
    ] as const) {
      store.createThread({
        id,
        projectId: "project-1",
        title,
        mode: "execute",
        target: "local",
        status: "idle",
        pinned: false,
        archived: false,
        createdAt: now,
        updatedAt: now,
      });
    }
    store.appendEvent("event-delete", "thread-delete", "turn-delete", {
      type: "user.message",
      messageId: "message-delete",
      text: "remove this persisted prompt",
    });
    store.appendEvent("event-keep", "thread-keep", "turn-keep", {
      type: "user.message",
      messageId: "message-keep",
      text: "preserve this persisted prompt",
    });
    store.addReviewComment(
      "thread-delete",
      {
        scope: "unstaged",
        lineId: "README.md:addition:1",
        path: "README.md",
        kind: "addition",
        text: "deleted line",
        newLine: 1,
      },
      "delete this stored comment",
    );
    store.addReviewComment(
      "thread-keep",
      {
        scope: "unstaged",
        lineId: "README.md:addition:2",
        path: "README.md",
        kind: "addition",
        text: "preserved line",
        newLine: 2,
      },
      "preserve this stored comment",
    );

    try {
      expect(store.getThreadEvents("thread-delete")).toHaveLength(1);
      expect(store.listReviewComments("thread-delete")).toHaveLength(1);

      (
        store as AppStore & {
          deleteThread(threadId: string): void;
        }
      ).deleteThread("thread-delete");

      expect(store.getThread("thread-delete")).toBeUndefined();
      expect(store.getThreadEvents("thread-delete")).toEqual([]);
      expect(store.listReviewComments("thread-delete")).toEqual([]);
      expect(store.getThread("thread-keep")?.title).toBe("Keep me");
      expect(store.getThreadEvents("thread-keep")).toHaveLength(1);
      expect(store.listReviewComments("thread-keep")).toHaveLength(1);
    } finally {
      store.close();
    }
  });
});
