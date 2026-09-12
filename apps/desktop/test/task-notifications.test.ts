import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentPayload } from "@artemis/protocol";
import { AppStore } from "../src/main/store.js";

const cleanups: Array<() => void> = [];
afterEach(() =>
  cleanups
    .splice(0)
    .reverse()
    .forEach((cleanup) => cleanup()),
);

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "artemis-notifications-"));
  const path = join(directory, "state.sqlite");
  let store = new AppStore(path);
  cleanups.push(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const now = new Date().toISOString();
  for (const id of ["one", "two"])
    store.createThread({
      id,
      title: id,
      mode: "execute",
      target: "local",
      status: "idle",
      pinned: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
  let id = 0;
  return {
    get store() {
      return store;
    },
    reopen() {
      store.close();
      store = new AppStore(path);
    },
    emit(
      payload: AgentPayload,
      options: {
        viewed?: boolean;
        suppressCompletion?: boolean;
        approvalPending?: boolean;
      } = {},
      threadId = "one",
      turnId = "turn",
    ) {
      const event = store.appendEvent(
        `event-${id++}`,
        threadId,
        turnId,
        payload,
      );
      return { event, result: store.notifications.observe(event, options) };
    },
  };
}

const approval = {
  type: "approval.requested",
  approvalId: "approve",
  nonce: "0123456789012345",
  summary: "Run command",
  risk: "medium",
  allowedScopes: ["once"],
} as const;
const question = {
  type: "user-input.requested",
  requestId: "input",
  nonce: "0123456789012345",
  header: "Choice",
  question: "Which result?",
  options: [
    { label: "First", description: "Use first", recommended: true },
    { label: "Second", description: "Use second", recommended: false },
  ],
  expiresAt: "2099-01-01T00:00:00.000Z",
} as const;

describe("persistent task notifications", () => {
  it("starts old histories read, persists new unread notices and deduplicates replay", () => {
    const f = fixture();
    f.store.appendEvent("legacy", "one", "legacy-turn", {
      type: "turn.completed",
      reason: "completed",
    });
    f.reopen();
    expect(f.store.notifications.countUnread()).toBe(0);
    const { event, result } = f.emit({
      type: "turn.completed",
      reason: "completed",
    });
    expect(result?.notice?.kind).toBe("completed");
    f.reopen();
    expect(f.store.getThread("one")?.notification?.unread).toBe(true);
    expect(f.store.notifications.observe(event, {})).toBeUndefined();
    expect(
      f.emit({ type: "turn.completed", reason: "completed" }).result,
    ).toBeUndefined();
    expect(f.store.notifications.countUnread()).toBe(1);
  });

  it.each([
    "completed",
    "failed",
    "input-required",
    "approval-required",
  ] as const)("records viewed %s atomically as read", (kind) => {
    const f = fixture();
    const payload =
      kind === "completed"
        ? { type: "turn.completed", reason: "completed" }
        : kind === "failed"
          ? { type: "turn.failed", message: "failed" }
          : kind === "input-required"
            ? question
            : approval;
    const result = f.emit(payload as AgentPayload, {
      viewed: true,
      approvalPending: true,
    }).result;
    expect(result?.notice?.kind).toBe(kind);
    expect(result?.state.unread).toBe(false);
    expect(f.store.notifications.countUnread()).toBe(0);
  });

  it("does not confuse cancellation, automatic approval, or Goal continuation with notifications", () => {
    const f = fixture();
    f.emit({ type: "turn.completed", reason: "cancelled" });
    f.emit(
      { ...approval, allowedScopes: ["once"] },
      { approvalPending: false },
    );
    f.emit(
      { type: "turn.completed", reason: "completed" },
      { suppressCompletion: true },
    );
    expect(f.store.notifications.countUnread()).toBe(0);
    f.emit(
      { type: "turn.failed", message: "failed" },
      { suppressCompletion: true },
    );
    expect(f.store.notifications.countUnread()).toBe(1);
  });

  it("counts tasks, does not read newer events with stale acknowledgements, and preserves other tasks", () => {
    const f = fixture();
    const first = f.emit({ ...question, options: [...question.options] });
    f.emit({ type: "turn.failed", message: "failed" });
    f.emit({ type: "turn.completed", reason: "completed" }, {}, "two");
    f.store.notifications.markRead("one", first.event.seq);
    expect(f.store.notifications.countUnread()).toBe(2);
    const state = f.store.notifications.state("one")!;
    f.store.notifications.markRead("one", state.seq);
    expect(f.store.notifications.countUnread()).toBe(1);
    expect(f.store.notifications.markRead("one", state.seq)).toBeUndefined();
    f.store.updateThread("two", { archived: true });
    expect(f.store.notifications.countUnread()).toBe(0);
    f.store.updateThread("two", { archived: false });
    expect(f.store.notifications.countUnread()).toBe(1);
    f.store.deleteThread("two");
    expect(f.store.notifications.countUnread()).toBe(0);
  });

  it("reading approval is not approval; a new request notifies again", () => {
    const f = fixture();
    const first = f.emit(
      { ...approval, allowedScopes: ["once"] },
      { approvalPending: true },
    );
    f.store.notifications.markRead("one", first.event.seq);
    expect(
      f.store
        .getThreadEvents("one")
        .some((e) => e.payload.type === "approval.resolved"),
    ).toBe(false);
    expect(
      f.store.notifications.observe(first.event, { approvalPending: true }),
    ).toBeUndefined();
    const next = f.emit(
      { ...approval, approvalId: "new", allowedScopes: ["once"] },
      { approvalPending: true },
    );
    expect(next.result?.state.unread).toBe(true);
  });

  it("groups multiple questions and only retires the request after the last resolution", () => {
    const f = fixture();
    f.emit({
      type: "user-input.requested",
      kind: "multi-question",
      requestId: "multi",
      nonce: question.nonce,
      header: "Choice",
      questions: ["a", "b"].map((questionId) => ({
        questionId,
        question: "Which?",
        options: [...question.options],
        expiresAt: question.expiresAt,
      })),
    });
    const resolved = {
      type: "user-input.resolved",
      kind: "multi-question",
      requestId: "multi",
      nonce: question.nonce,
      questionId: "a",
      customAnswer: "yes",
      source: "user",
    } as const;
    f.emit(resolved);
    expect(f.store.notifications.countUnread()).toBe(1);
    f.emit(resolved);
    expect(f.store.notifications.countUnread()).toBe(1);
    f.emit({ ...resolved, questionId: "b" });
    expect(f.store.notifications.countUnread()).toBe(0);
  });
});
