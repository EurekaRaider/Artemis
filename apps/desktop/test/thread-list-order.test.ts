import { describe, expect, it } from "vitest";

import {
  PROTOCOL_VERSION,
  type AgentEvent,
  type Thread,
} from "@artemis/protocol";
import {
  isWorkspaceDraftThread,
  orderProjectThreadsByPreference,
  reorderThreadIds,
  sortProjectThreads,
} from "../src/renderer/thread-list-order.js";

function thread(
  id: string,
  status: Thread["status"],
  updatedAt: string,
): Thread {
  return {
    id,
    projectId: "project-1",
    title: id,
    mode: "execute",
    target: "local",
    status,
    pinned: false,
    archived: false,
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt,
  };
}

function promptEvent(threadId: string, timestamp: string): AgentEvent {
  return {
    protocolVersion: PROTOCOL_VERSION,
    eventId: `${threadId}-prompt`,
    threadId,
    turnId: `${threadId}-turn`,
    seq: 0,
    timestamp,
    payload: {
      type: "user.message",
      messageId: `${threadId}-message`,
      text: "prompt",
    },
  };
}

describe("sidebar conversation order", () => {
  it("uses a persisted manual order without changing the default order", () => {
    const threads = [
      thread("first", "idle", "2026-08-02T03:00:00.000Z"),
      thread("second", "idle", "2026-08-02T02:00:00.000Z"),
      thread("third", "idle", "2026-08-02T01:00:00.000Z"),
    ];

    expect(orderProjectThreadsByPreference(threads, undefined)).toEqual(
      threads,
    );
    expect(
      orderProjectThreadsByPreference(threads, ["third", "first"]).map(
        ({ id }) => id,
      ),
    ).toEqual(["third", "first", "second"]);
  });

  it("moves a conversation to the indicated insertion edge", () => {
    expect(
      reorderThreadIds(
        ["first", "second", "third"],
        "third",
        "first",
        "before",
      ),
    ).toEqual(["third", "first", "second"]);
    expect(
      reorderThreadIds(
        ["first", "second", "third"],
        "first",
        "second",
        "after",
      ),
    ).toEqual(["second", "first", "third"]);
  });

  it("recognizes only untouched workspace-support threads as hidden drafts", () => {
    const draft = {
      ...thread("draft", "idle", "2026-08-02T04:00:00.000Z"),
      title: "Waiting for task",
    };

    expect(isWorkspaceDraftThread(draft)).toBe(true);
    expect(isWorkspaceDraftThread({ ...draft, title: "等待任务内容" })).toBe(
      true,
    );
    expect(isWorkspaceDraftThread({ ...draft, title: "Real task" })).toBe(
      false,
    );
    expect(isWorkspaceDraftThread({ ...draft, status: "failed" })).toBe(false);
    expect(
      isWorkspaceDraftThread({ ...draft, sessionFile: "/tmp/session.jsonl" }),
    ).toBe(false);
    expect(isWorkspaceDraftThread({ ...draft, goal: "Ship it" })).toBe(false);
    expect(isWorkspaceDraftThread({ ...draft, pinned: true })).toBe(false);
    expect(isWorkspaceDraftThread({ ...draft, archived: true })).toBe(false);
  });

  it("keeps every active conversation above inactive conversations", () => {
    const threads = [
      thread("idle-newer", "idle", "2026-08-02T04:00:00.000Z"),
      thread("running", "running", "2026-08-02T02:00:00.000Z"),
      thread("waiting", "waiting-approval", "2026-08-02T01:00:00.000Z"),
      thread("idle-older", "idle", "2026-08-02T00:00:00.000Z"),
    ];

    expect(sortProjectThreads(threads, {}).map(({ id }) => id)).toEqual([
      "running",
      "waiting",
      "idle-newer",
      "idle-older",
    ]);
  });

  it("orders active conversations by their latest submitted prompt", () => {
    const older = thread("older", "running", "2026-08-02T05:00:00.000Z");
    const newer = thread(
      "newer",
      "waiting-approval",
      "2026-08-02T01:00:00.000Z",
    );

    expect(
      sortProjectThreads([older, newer], {
        older: [promptEvent("older", "2026-08-02T02:00:00.000Z")],
        newer: [promptEvent("newer", "2026-08-02T03:00:00.000Z")],
      }).map(({ id }) => id),
    ).toEqual(["newer", "older"]);
  });

  it("uses the local submission time until its event reaches the renderer", () => {
    const first = thread("first", "running", "2026-08-02T02:00:00.000Z");
    const second = thread("second", "running", "2026-08-02T03:00:00.000Z");

    expect(
      sortProjectThreads([first, second], {}, { first: 4, second: 3 }).map(
        ({ id }) => id,
      ),
    ).toEqual(["first", "second"]);
  });

  it("preserves the existing order for inactive conversations", () => {
    const threads = [
      thread("pinned-or-recent", "idle", "2026-08-02T01:00:00.000Z"),
      thread("next", "failed", "2026-08-02T04:00:00.000Z"),
    ];

    expect(sortProjectThreads(threads, {}).map(({ id }) => id)).toEqual([
      "pinned-or-recent",
      "next",
    ]);
    expect(threads.map(({ id }) => id)).toEqual(["pinned-or-recent", "next"]);
  });
});
