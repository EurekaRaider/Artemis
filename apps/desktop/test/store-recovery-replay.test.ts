import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

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

// Review round 3, P1: recovery settledness for multi-question requests is
// decided solely by replaying the thread's events through the same reducer
// the renderer uses. There is deliberately no linear fast path here — a
// requestId+nonce match is strictly weaker than the reducer's rules, which
// also discard premature timeouts, user answers stamped after expiry,
// non-finite timestamps, and selectedOptionLabels the question never
// offered. These cases pin the observable outcome: exactly one kind-less
// cancelled recovery resolution whenever the replayed state keeps any
// question pending, and a replayed final state with nothing pending after
// the recovery restart.
describe("recoverInterruptedThreads multi-question settledness", () => {
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
  const questionsFor = (
    nonceScope: string,
    expiresAt = "2999-01-01T00:00:00.000Z",
  ) =>
    ["q1", "q2"].map((questionId) => ({
      questionId,
      question: `${nonceScope} ${questionId}?`,
      options,
      expiresAt,
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

  const seedProject = (store: AppStore, directory: string): void => {
    store.upsertProject({
      id: "project-1",
      name: "Workspace",
      path: join(directory, "workspace"),
      createdAt: now,
      updatedAt: now,
    });
  };

  const requestMulti = (
    store: AppStore,
    threadId: string,
    requestId: string,
    nonce: string,
    expiresAt?: string,
  ): void => {
    store.appendEvent(randomUUID(), threadId, "turn-1", {
      type: "user-input.requested",
      kind: "multi-question",
      requestId,
      nonce,
      header: "Scope",
      questions: questionsFor(requestId, expiresAt),
    });
  };

  type QuestionResolution = {
    source: "user" | "timeout";
    label?: string;
    customAnswer?: string;
    timestamp: string;
  };

  const resolveQuestion = (
    store: AppStore,
    threadId: string,
    requestId: string,
    nonce: string,
    questionId: string,
    resolution: QuestionResolution,
  ): void => {
    store.appendEvent(
      randomUUID(),
      threadId,
      "turn-1",
      {
        type: "user-input.resolved",
        kind: "multi-question",
        requestId,
        nonce,
        questionId,
        ...(resolution.label === undefined
          ? {}
          : { selectedOptionLabel: resolution.label }),
        ...(resolution.customAnswer === undefined
          ? {}
          : { customAnswer: resolution.customAnswer }),
        source: resolution.source,
      },
      resolution.timestamp,
    );
  };

  const answerQuestion = (
    store: AppStore,
    threadId: string,
    requestId: string,
    nonce: string,
    questionId: string,
  ): void => {
    resolveQuestion(store, threadId, requestId, nonce, questionId, {
      source: "user",
      label: "Ship now",
      timestamp: now,
    });
  };

  const recoveryResolutions = (
    recovered: ReturnType<AppStore["getThreadEvents"]>,
  ) =>
    recovered.filter((event) => event.payload.type === "user-input.resolved");

  const multiInput = (store: AppStore, threadId: string, requestId: string) => {
    const state = reduceAgentEvents(threadId, store.getThreadEvents(threadId));
    const input = state.userInputs[requestId];
    expect(input?.kind).toBe("multi-question");
    return input as {
      status: string;
      answers: Record<string, { status: string }>;
    };
  };

  it("leaves a fully answered multi request untouched and cancels only the partially answered one", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-replay-settled-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "state.sqlite");

    // Settled thread: every requested question carries a nonce-matching,
    // reducer-valid per-question resolution, so the replayed final state is
    // terminal and recovery must not touch it.
    const first = new AppStore(databasePath);
    seedProject(first, directory);
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
    const recovered = reopened.recoverInterruptedThreads();
    const resolutions = recoveryResolutions(recovered);

    expect(resolutions).toHaveLength(1);
    expect(resolutions[0]?.payload).toMatchObject({
      requestId: "multi-partial",
      nonce: "partial-nonce-01",
      answer: "",
      source: "cancelled",
    });
    expect(
      (resolutions[0]?.payload as { kind?: string } | undefined)?.kind,
    ).toBeUndefined();

    const settled = multiInput(reopened, "thread-settled", "multi-settled");
    expect(settled.answers).toMatchObject({
      q1: { status: "answered" },
      q2: { status: "answered" },
    });
    expect(settled.status).toBe("answered");

    const partial = multiInput(reopened, "thread-partial", "multi-partial");
    expect(partial.answers).toMatchObject({
      q1: { status: "answered" },
      q2: { status: "cancelled" },
    });
    reopened.close();
  });

  it("leaves a kind-less cancelled multi request untouched", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-replay-cancel-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "state.sqlite");

    const first = new AppStore(databasePath);
    seedProject(first, directory);
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
    const recovered = reopened.recoverInterruptedThreads();
    expect(recoveryResolutions(recovered)).toHaveLength(0);

    const cancelled = multiInput(
      reopened,
      "thread-cancelled",
      "multi-cancelled",
    );
    expect(cancelled.answers).toMatchObject({
      q1: { status: "cancelled" },
      q2: { status: "cancelled" },
    });
    expect(cancelled.status).toBe("cancelled");
    reopened.close();
  });

  it("still cancels when nonce-mismatched resolutions cannot settle the request", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-replay-mismatch-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "state.sqlite");

    const first = new AppStore(databasePath);
    seedProject(first, directory);
    createWaitingThread(first, "thread-mismatch", "Nonce-mismatched multi");
    requestMulti(
      first,
      "thread-mismatch",
      "multi-mismatch",
      "mismatch-nonce-1",
    );
    // Wrong nonce: the reducer discards these whole, so recovery must
    // still derive the unresolved set from replay and cancel the request.
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
    const recovered = reopened.recoverInterruptedThreads();
    const resolutions = recoveryResolutions(recovered);
    expect(resolutions).toHaveLength(1);
    expect(resolutions[0]?.payload).toMatchObject({
      requestId: "multi-mismatch",
      nonce: "mismatch-nonce-1",
      source: "cancelled",
    });

    const mismatched = multiInput(
      reopened,
      "thread-mismatch",
      "multi-mismatch",
    );
    expect(mismatched.answers).toMatchObject({
      q1: { status: "cancelled" },
      q2: { status: "cancelled" },
    });
    reopened.close();
  });

  it("cancels every question after premature timeout resolutions were discarded", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-replay-early-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "state.sqlite");
    const expiresAt = "2026-08-30T00:10:00.000Z";
    const beforeDeadline = "2026-08-30T00:01:00.000Z";

    // Both questions expire at 00:10 but carry kind'd timeout resolutions
    // stamped at 00:01: the reducer's reverse time gate discards them
    // whole, so both questions stay pending and recovery must close the
    // whole card with exactly one kind-less cancelled resolution.
    const first = new AppStore(databasePath);
    seedProject(first, directory);
    createWaitingThread(first, "thread-early", "Premature timeout multi");
    requestMulti(
      first,
      "thread-early",
      "multi-early",
      "premature-nonce-1",
      expiresAt,
    );
    resolveQuestion(
      first,
      "thread-early",
      "multi-early",
      "premature-nonce-1",
      "q1",
      { source: "timeout", label: "Ship now", timestamp: beforeDeadline },
    );
    resolveQuestion(
      first,
      "thread-early",
      "multi-early",
      "premature-nonce-1",
      "q2",
      { source: "timeout", label: "Ship now", timestamp: beforeDeadline },
    );
    first.close();

    const reopened = new AppStore(databasePath);
    const recovered = reopened.recoverInterruptedThreads();
    const resolutions = recoveryResolutions(recovered);
    expect(resolutions).toHaveLength(1);
    expect(resolutions[0]?.payload).toMatchObject({
      requestId: "multi-early",
      nonce: "premature-nonce-1",
      answer: "",
      source: "cancelled",
    });
    expect(
      (resolutions[0]?.payload as { kind?: string } | undefined)?.kind,
    ).toBeUndefined();

    const early = multiInput(reopened, "thread-early", "multi-early");
    expect(early.answers).toMatchObject({
      q1: { status: "cancelled" },
      q2: { status: "cancelled" },
    });
    expect(early.status).toBe("cancelled");
    reopened.close();

    // After another restart the persisted view still holds no pending
    // question — the discarded timeouts cannot strand the card forever.
    const restarted = new AppStore(databasePath);
    const restartedInput = multiInput(restarted, "thread-early", "multi-early");
    expect(
      Object.values(restartedInput.answers).every(
        (answer) => answer.status !== "pending",
      ),
    ).toBe(true);
    restarted.close();
  });

  it("cancels every question after expired user answers were discarded", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-replay-late-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "state.sqlite");
    const expiresAt = "2026-08-30T00:10:00.000Z";
    const afterDeadline = "2026-08-30T00:11:00.000Z";

    // User answers stamped at 00:11, past the 00:10 deadline: the reducer
    // discards them whole, so both questions stay pending and recovery
    // must close the whole card with exactly one kind-less cancelled
    // resolution.
    const first = new AppStore(databasePath);
    seedProject(first, directory);
    createWaitingThread(first, "thread-late", "Expired answer multi");
    requestMulti(
      first,
      "thread-late",
      "multi-late",
      "expired-nonce-01",
      expiresAt,
    );
    resolveQuestion(
      first,
      "thread-late",
      "multi-late",
      "expired-nonce-01",
      "q1",
      { source: "user", label: "Ship now", timestamp: afterDeadline },
    );
    resolveQuestion(
      first,
      "thread-late",
      "multi-late",
      "expired-nonce-01",
      "q2",
      { source: "user", label: "Ship now", timestamp: afterDeadline },
    );
    first.close();

    const reopened = new AppStore(databasePath);
    const recovered = reopened.recoverInterruptedThreads();
    const resolutions = recoveryResolutions(recovered);
    expect(resolutions).toHaveLength(1);
    expect(resolutions[0]?.payload).toMatchObject({
      requestId: "multi-late",
      nonce: "expired-nonce-01",
      answer: "",
      source: "cancelled",
    });

    const late = multiInput(reopened, "thread-late", "multi-late");
    expect(late.answers).toMatchObject({
      q1: { status: "cancelled" },
      q2: { status: "cancelled" },
    });
    reopened.close();

    const restarted = new AppStore(databasePath);
    const restartedInput = multiInput(restarted, "thread-late", "multi-late");
    expect(
      Object.values(restartedInput.answers).every(
        (answer) => answer.status !== "pending",
      ),
    ).toBe(true);
    restarted.close();
  });

  it("cancels every question after not-offered option labels were discarded", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-replay-label-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "state.sqlite");
    const expiresAt = "2026-08-30T00:10:00.000Z";
    const beforeDeadline = "2026-08-30T00:01:00.000Z";

    // Both answers reference a label neither question offered ("Not
    // offered"): the time gates pass, but the reducer discards the
    // resolutions on label membership, so both questions stay pending and
    // recovery must close the whole card with exactly one kind-less
    // cancelled resolution.
    const first = new AppStore(databasePath);
    seedProject(first, directory);
    createWaitingThread(first, "thread-label", "Not-offered label multi");
    requestMulti(
      first,
      "thread-label",
      "multi-label",
      "unoffered-nonce-1",
      expiresAt,
    );
    resolveQuestion(
      first,
      "thread-label",
      "multi-label",
      "unoffered-nonce-1",
      "q1",
      { source: "user", label: "Not offered", timestamp: beforeDeadline },
    );
    resolveQuestion(
      first,
      "thread-label",
      "multi-label",
      "unoffered-nonce-1",
      "q2",
      { source: "user", label: "Not offered", timestamp: beforeDeadline },
    );
    first.close();

    const reopened = new AppStore(databasePath);
    const recovered = reopened.recoverInterruptedThreads();
    const resolutions = recoveryResolutions(recovered);
    expect(resolutions).toHaveLength(1);
    expect(resolutions[0]?.payload).toMatchObject({
      requestId: "multi-label",
      nonce: "unoffered-nonce-1",
      answer: "",
      source: "cancelled",
    });

    const label = multiInput(reopened, "thread-label", "multi-label");
    expect(label.answers).toMatchObject({
      q1: { status: "cancelled" },
      q2: { status: "cancelled" },
    });
    reopened.close();

    const restarted = new AppStore(databasePath);
    const restartedInput = multiInput(restarted, "thread-label", "multi-label");
    expect(
      Object.values(restartedInput.answers).every(
        (answer) => answer.status !== "pending",
      ),
    ).toBe(true);
    restarted.close();
  });
});
