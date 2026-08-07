import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AppStore } from "../src/main/store.js";

const temporaryDirectories: string[] = [];
const openStores: AppStore[] = [];
const now = "2026-07-30T00:00:00.000Z";

afterEach(async () => {
  for (const store of openStores.splice(0)) {
    store.close();
  }
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

function closeStore(store: AppStore): void {
  store.close();
  const index = openStores.indexOf(store);
  if (index >= 0) openStores.splice(index, 1);
}

async function createStore(
  threads: ReadonlyArray<{ id: string; archived: boolean }>,
): Promise<AppStore> {
  const directory = await mkdtemp(join(tmpdir(), "artemis-usage-store-"));
  temporaryDirectories.push(directory);
  const store = new AppStore(join(directory, "state.sqlite"));
  store.upsertProject({
    id: "project-1",
    name: "Workspace",
    path: join(directory, "workspace"),
    createdAt: now,
    updatedAt: now,
  });
  for (const thread of threads) {
    store.createThread({
      id: thread.id,
      projectId: "project-1",
      title: thread.id,
      mode: "execute",
      target: "local",
      status: "idle",
      pinned: false,
      archived: thread.archived,
      createdAt: now,
      updatedAt: now,
    });
  }
  openStores.push(store);
  return store;
}

function appendUsage(
  store: AppStore,
  eventId: string,
  threadId: string,
  totalTokens: number,
): void {
  store.appendEvent(eventId, threadId, `turn-${eventId}`, {
    type: "assistant.usage",
    inputTokens: totalTokens - 20,
    outputTokens: 20,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens,
  });
}

describe("AppStore token usage events", () => {
  it("returns assistant usage from active and archived threads", async () => {
    const store = await createStore([
      { id: "thread-active", archived: false },
      { id: "thread-archived", archived: true },
    ]);
    appendUsage(store, "usage-active", "thread-active", 120);
    store.appendEvent("non-usage", "thread-active", "turn-message", {
      type: "user.message",
      messageId: "message-1",
      text: "Do not count this event",
    });
    appendUsage(store, "usage-archived", "thread-archived", 340);

    const usageEvents = store.getTokenUsageEvents();
    closeStore(store);

    expect(
      usageEvents.map((event) => ({
        eventId: event.eventId,
        threadId: event.threadId,
        totalTokens:
          event.payload.type === "assistant.usage"
            ? event.payload.totalTokens
            : undefined,
      })),
    ).toEqual([
      {
        eventId: "usage-active",
        threadId: "thread-active",
        totalTokens: 120,
      },
      {
        eventId: "usage-archived",
        threadId: "thread-archived",
        totalTokens: 340,
      },
    ]);
  });

  it("does not copy assistant usage into fork history or duplicate billing", async () => {
    const store = await createStore([
      { id: "thread-source", archived: false },
      { id: "thread-fork", archived: false },
    ]);
    store.appendEvent("source-message", "thread-source", "turn-source", {
      type: "user.message",
      messageId: "message-source",
      text: "Keep this history in the fork",
    });
    appendUsage(store, "source-usage", "thread-source", 500);

    const copied = store.copyThreadEvents("thread-source", "thread-fork");
    const forkEvents = store.getThreadEvents("thread-fork");
    const billingEvents = store.getTokenUsageEvents();
    closeStore(store);

    expect(copied.map((event) => event.payload.type)).toEqual(["user.message"]);
    expect(
      forkEvents.some((event) => event.payload.type === "assistant.usage"),
    ).toBe(false);
    expect(
      billingEvents.map((event) => ({
        eventId: event.eventId,
        threadId: event.threadId,
        totalTokens:
          event.payload.type === "assistant.usage"
            ? event.payload.totalTokens
            : undefined,
      })),
    ).toEqual([
      {
        eventId: "source-usage",
        threadId: "thread-source",
        totalTokens: 500,
      },
    ]);
  });
});
