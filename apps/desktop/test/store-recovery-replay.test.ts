import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

// Review round 3, item 5: the recovery short-circuit is a pure cost
// optimization — a multi request the linear scan can settle conclusively
// (every requested question answered by a nonce-matching per-question
// resolution, or a nonce-matching kind-less cancelled close) must not
// trigger the second full-event reduceAgentEvents replay. Wrapping the
// protocol export in a transparent spy lets this suite observe the replay
// call by thread id without changing behavior for anything else.
vi.mock("@artemis/protocol", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@artemis/protocol")>();
  return {
    ...actual,
    reduceAgentEvents: vi.fn(actual.reduceAgentEvents),
  };
});

import { reduceAgentEvents } from "@artemis/protocol";

import { AppStore } from "../src/main/store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("recoverInterruptedThreads replay short-circuit", () => {
  const options = [
    {
      label: "Ship now",
      description: "Release the current build.",
      recommended: true,
    },
    {
      label: "Ship later",
      description: "Wait one more day.",
      recommended: false,
    },
  ];
  const questionsFor = (nonceScope: string) =>
    ["q1", "q2"].map((questionId) => ({
      questionId,
      question: `${nonceScope} ${questionId}?`,
      options,
      expiresAt: "2999-01-01T00:00:00.000Z",
    }));
  const now = "2026-08-30T00:00:00.000Z";

  const createWaitingThread = (
    store: AppStore,
    threadId: string,
    title: string,
  ): void => {
    store.createThread({
      id: threadId,
      projectId: "project-1",
      title,
      mode: "execute",
      target: "local",
      status: "waiting-approval",
      pinned: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
  };

  const requestMulti = (
    store: AppStore,
    threadId: string,
    requestId: string,
    nonce: string,
  ): void => {
    store.appendEvent(randomUUID(), threadId, "turn-1", {
      type: "user-input.requested",
      kind: "multi-question",
      requestId,
      nonce,
      header: "Scope",
      questions: questionsFor(requestId),
    });
  };

  const answerQuestion = (
    store: AppStore,
    threadId: string,
    requestId: string,
    nonce: string,
    questionId: string,
  ): void => {
    store.appendEvent(randomUUID(), threadId, "turn-1", {
      type: "user-input.resolved",
      kind: "multi-question",
      requestId,
      nonce,
      questionId,
      selectedOptionLabel: "Ship now",
      source: "user",
    });
  };

  it("skips the replay pass for threads whose multi requests all settled", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-replay-skip-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "state.sqlite");

    const first = new AppStore(databasePath);
    first.upsertProject({
      id: "project-1",
      name: "Workspace",
      path: join(directory, "workspace"),
      createdAt: now,
      updatedAt: now,
    });

    // Settled thread: every requested question carries a nonce-matching
    // per-question resolution, so the linear scan settles it conclusively.
    createWaitingThread(first, "thread-settled", "Fully answered multi");
    requestMulti(first, "thread-settled", "multi-settled", "settled-nonce-01");
    answerQuestion(
      first,
      "thread-settled",
      "multi-settled",
      "settled-nonce-01",
      "q1",
    );
    answerQuestion(
      first,
      "thread-settled",
      "multi-settled",
      "settled-nonce-01",
      "q2",
    );

    // Partial thread: q2 is still open, so recovery must replay to derive
    // the unresolved set and then synthesize the kind-less cancel.
    createWaitingThread(first, "thread-partial", "Partially answered multi");
    requestMulti(first, "thread-partial", "multi-partial", "partial-nonce-01");
    answerQuestion(
      first,
      "thread-partial",
      "multi-partial",
      "partial-nonce-01",
      "q1",
    );
    first.close();

    const reopened = new AppStore(databasePath);
    vi.mocked(reduceAgentEvents).mockClear();
    const recovered = reopened.recoverInterruptedThreads();
    const replayedThreadIds = vi
      .mocked(reduceAgentEvents)
      .mock.calls.map((call) => call[0]);
    reopened.close();

    expect(replayedThreadIds).toContain("thread-partial");
    expect(replayedThreadIds).not.toContain("thread-settled");
    // Behavior is unchanged: only the still-open request gets a recovery
    // resolution; the settled thread is left alone apart from the
    // host-restart turn failure every interrupted thread receives.
    const recoveredResolutions = recovered.filter(
      (event) => event.payload.type === "user-input.resolved",
    );
    expect(recoveredResolutions).toHaveLength(1);
    expect(recoveredResolutions[0]?.payload).toMatchObject({
      requestId: "multi-partial",
      nonce: "partial-nonce-01",
      answer: "",
      source: "cancelled",
    });
  });

  it("skips the replay pass when a kind-less cancelled close settled the request", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-replay-cancel-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "state.sqlite");

    const first = new AppStore(databasePath);
    first.upsertProject({
      id: "project-1",
      name: "Workspace",
      path: join(directory, "workspace"),
      createdAt: now,
      updatedAt: now,
    });
    createWaitingThread(first, "thread-cancelled", "Cancelled multi");
    requestMulti(
      first,
      "thread-cancelled",
      "multi-cancelled",
      "cancelled-nonce-1",
    );
    first.appendEvent(randomUUID(), "thread-cancelled", "turn-1", {
      type: "user-input.resolved",
      requestId: "multi-cancelled",
      nonce: "cancelled-nonce-1",
      answer: "",
      source: "cancelled",
    });
    first.close();

    const reopened = new AppStore(databasePath);
    vi.mocked(reduceAgentEvents).mockClear();
    const recovered = reopened.recoverInterruptedThreads();
    const replayedThreadIds = vi
      .mocked(reduceAgentEvents)
      .mock.calls.map((call) => call[0]);
    reopened.close();

    expect(replayedThreadIds).not.toContain("thread-cancelled");
    expect(
      recovered.filter((event) => event.payload.type === "user-input.resolved"),
    ).toHaveLength(0);
  });

  it("still replays when a nonce-mismatched resolution cannot settle the request", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-replay-mismatch-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "state.sqlite");

    const first = new AppStore(databasePath);
    first.upsertProject({
      id: "project-1",
      name: "Workspace",
      path: join(directory, "workspace"),
      createdAt: now,
      updatedAt: now,
    });
    createWaitingThread(first, "thread-mismatch", "Nonce-mismatched multi");
    requestMulti(
      first,
      "thread-mismatch",
      "multi-mismatch",
      "mismatch-nonce-1",
    );
    // Wrong nonce: the reducer discards these whole, so the scan must not
    // settle the request on them — the replay still decides.
    answerQuestion(
      first,
      "thread-mismatch",
      "multi-mismatch",
      "wrong-nonce-aaaa",
      "q1",
    );
    answerQuestion(
      first,
      "thread-mismatch",
      "multi-mismatch",
      "wrong-nonce-aaaa",
      "q2",
    );
    first.close();

    const reopened = new AppStore(databasePath);
    vi.mocked(reduceAgentEvents).mockClear();
    const recovered = reopened.recoverInterruptedThreads();
    const replayedThreadIds = vi
      .mocked(reduceAgentEvents)
      .mock.calls.map((call) => call[0]);
    reopened.close();

    expect(replayedThreadIds).toContain("thread-mismatch");
    expect(
      recovered.filter((event) => event.payload.type === "user-input.resolved"),
    ).toHaveLength(1);
  });
});
