import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { app, BrowserWindow } from "electron";
import { AgentProcess } from "../../../../src/main/agent/agent-process.js";

import {
  store,
  activeTurns,
  pendingMultiUserInputs,
  emitPayload,
  handleUserInputBrokerRequest,
  completeUserInput,
  completeMultiUserInputQuestion,
  agentProcess,
  cancelTaskTurn,
} from "../../../../src/main/main.js";
import { smokeMode } from "../../../../test/fixtures/smoke/environment.js";

export type SmokeUserInputTransportCheck = {
  name: string;
  pass: boolean;
  actual: unknown;
  expected: unknown;
};

export type SmokeUserInputTransportDomState = {
  pendingCards: number;
  cancelledCards: number;
  answeredCards: number;
  timedOutCards: number;
  cardTexts: string[];
};

export type SmokeUserInputRequestedView = {
  requestId: string;
  nonce: string;
  kind?: string;
  questions?: Array<{ questionId: string; expiresAt?: string }>;
};

export type SmokeUserInputResolvedView = {
  requestId: string;
  nonce?: string;
  answer?: string;
  questionId?: string;
  selectedOptionLabel?: string;
  customAnswer?: string;
  source?: string;
  kind?: string;
};

export type SmokeUserInputTransportEvidence = {
  view: "user-input-transport";
  generatedAt: string;
  checks: SmokeUserInputTransportCheck[];
  brokerPosts: Array<Record<string, unknown>>;
  storeChecks: {
    legacyRequested: number;
    legacyResolved: number;
    multiRequested: number;
    multiResolved: number;
    multiExpiredRequested: number;
    multiExpiredResolved: number;
    multiCancelRequested: number;
    multiCancelResolved: number;
    multiReverseRequested: number;
    multiReverseResolved: number;
  };
  renderer: SmokeUserInputTransportDomState;
};

export let smokeUserInputTransportEvidence:
  SmokeUserInputTransportEvidence | undefined;

export async function driveSmokeUserInputTransportEvidence(
  window: BrowserWindow,
  artifacts: { screenshot?: string | undefined },
): Promise<void> {
  const view = process.env.ARTEMIS_SMOKE_VIEW;
  if (!smokeMode || view !== "user-input-transport") {
    return;
  }
  const agentHost = agentProcess;
  const appStore = store;
  if (!agentHost || !appStore) {
    throw new Error(
      "User-input transport smoke requires a live agent host and store.",
    );
  }
  const threadId = "artemis-smoke-user-input-transport";
  const turnId = "smoke-turn-transport";
  const workspacePath = join(
    app.getPath("userData"),
    "fixtures",
    "user-input-transport",
  );
  const checks: SmokeUserInputTransportCheck[] = [];
  const assert = (
    name: string,
    pass: boolean,
    actual: unknown,
    expected: unknown,
  ): void => {
    checks.push({ name, pass, actual, expected });
    if (!pass) {
      throw new Error(
        `User-input transport smoke check failed: ${name} (actual ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}).`,
      );
    }
  };
  const domState = async (): Promise<SmokeUserInputTransportDomState> =>
    (await window.webContents.executeJavaScript(`(() => {
      document.querySelectorAll('.work-record:not([open]) > summary').forEach(summary => summary.click());
      return ({
      pendingCards: document.querySelectorAll('.user-input-card:is([data-state="pending"], [data-state="busy"])').length,
      cancelledCards: document.querySelectorAll('.user-input-result[data-state="cancelled"]').length,
      answeredCards: document.querySelectorAll('.user-input-result[data-state="answered"]').length,
      timedOutCards: document.querySelectorAll('.user-input-result[data-state="timed-out"]').length,
      cardTexts: [...document.querySelectorAll(".user-input-card, .user-input-result")].map(
        (card) => (card.textContent ?? "").replace(/\\s+/gu, " ").trim(),
      ),
    }); })()`)) as SmokeUserInputTransportDomState;
  const waitForDomState = async (
    description: string,
    predicate: (state: SmokeUserInputTransportDomState) => boolean,
  ): Promise<SmokeUserInputTransportDomState> => {
    const deadline = Date.now() + 8_000;
    for (;;) {
      const state = await domState();
      if (predicate(state)) return state;
      if (Date.now() >= deadline) {
        throw new Error(
          `User-input transport smoke timed out waiting for ${description}; last state ${JSON.stringify(state)}.`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  };
  const wait = (milliseconds: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  const requestedEvents = (requestId: string): SmokeUserInputRequestedView[] =>
    appStore
      .getThreadEvents(threadId)
      .map((event) => event.payload)
      .filter(
        (payload) =>
          payload.type === "user-input.requested" &&
          (payload as { requestId?: string }).requestId === requestId,
      ) as unknown as SmokeUserInputRequestedView[];
  const resolvedEvents = (requestId: string): SmokeUserInputResolvedView[] =>
    appStore
      .getThreadEvents(threadId)
      .map((event) => event.payload)
      .filter(
        (payload) =>
          payload.type === "user-input.resolved" &&
          (payload as { requestId?: string }).requestId === requestId,
      ) as unknown as SmokeUserInputResolvedView[];
  const multiPending = (requestId: string): boolean =>
    pendingMultiUserInputs.hasWhere(
      (pending) => pending.request.approvalId === requestId,
    );

  const legacyOptions = [
    {
      label: "Yes, implement this plan",
      description: "Continue with the plan as written.",
      recommended: true,
    },
    {
      label: "Revise the plan first",
      description: "Describe what should change before continuing.",
      recommended: false,
    },
  ];
  const multiQuestions = [
    {
      questionId: "q1",
      question: "Ship on Friday?",
      options: [
        {
          label: "Ship it",
          description: "Release the build.",
          recommended: true,
        },
        {
          label: "Hold",
          description: "Wait one more day.",
          recommended: false,
        },
      ],
    },
    {
      questionId: "q2",
      question: "Notify users first?",
      options: [
        {
          label: "Email digest",
          description: "Send a summary.",
          recommended: true,
        },
        {
          label: "In-app only",
          description: "Show a banner.",
          recommended: false,
        },
      ],
    },
    {
      questionId: "q3",
      question: "Anything to add?",
      options: [
        {
          label: "No, ship as-is",
          description: "Nothing extra.",
          recommended: true,
        },
        {
          label: "Yes, add notes",
          description: "Attach release notes.",
          recommended: false,
        },
      ],
    },
  ];
  const cancelQuestions = [
    {
      questionId: "c1",
      question: "Roll out to everyone?",
      options: [
        {
          label: "Staged rollout",
          description: "Ten percent first.",
          recommended: true,
        },
        {
          label: "Full rollout",
          description: "Everyone now.",
          recommended: false,
        },
      ],
    },
    {
      questionId: "c2",
      question: "Announce the release?",
      options: [
        {
          label: "Changelog only",
          description: "Quiet update.",
          recommended: true,
        },
        {
          label: "Blog post",
          description: "Public announcement.",
          recommended: false,
        },
      ],
    },
  ];

  // The real agent host drops broker resolutions for unknown worker request
  // ids (agent-worker.ts), so capturing the posts at this boundary observes
  // the exact commands main sends without changing production behavior.
  const brokerPosts: Array<Record<string, unknown>> = [];
  const originalPost = agentHost.post.bind(agentHost);
  agentHost.post = (command: Parameters<AgentProcess["post"]>[0]): void => {
    brokerPosts.push(command as unknown as Record<string, unknown>);
    originalPost(command);
  };
  activeTurns.set(threadId, turnId);
  try {
    // §6-6 legacy chain: the real single-question broker handler registers,
    // persists, and renders the existing card end to end.
    handleUserInputBrokerRequest("artemis-smoke-single-worker", {
      kind: "user.input",
      approvalId: "artemis-smoke-single",
      threadId,
      turnId,
      workspacePath,
      header: "Confirmation",
      question: "Implement this plan?",
      options: legacyOptions,
      mode: "work",
    });
    const legacyRequested = requestedEvents("artemis-smoke-single");
    assert(
      "legacy-request-persisted",
      legacyRequested.length === 1,
      legacyRequested.length,
      1,
    );
    const legacyNonce = legacyRequested[0]?.nonce ?? "";
    const legacyRendered = await waitForDomState(
      "legacy card pending",
      (state) => state.pendingCards === 1,
    );
    assert(
      "legacy-card-pending-rendered",
      legacyRendered.pendingCards === 1,
      legacyRendered.pendingCards,
      1,
    );
    assert(
      "legacy-card-shows-question",
      legacyRendered.cardTexts.some((text) =>
        text.includes("Implement this plan?"),
      ),
      legacyRendered.cardTexts,
      "a card containing 'Implement this plan?'",
    );

    // §6-1 no-lost-events: the real multi-question broker handler persists
    // the frozen payload and the renderer replays it through the protocol
    // reducer (the translated card renders beside the legacy one).
    handleUserInputBrokerRequest("artemis-smoke-multi-worker", {
      kind: "user.input",
      approvalId: "artemis-smoke-multi",
      threadId,
      turnId,
      workspacePath,
      header: "Plan check",
      questions: multiQuestions,
      mode: "work",
    });
    const multiRequested = requestedEvents("artemis-smoke-multi");
    assert(
      "multi-request-persisted",
      multiRequested.length === 1,
      multiRequested.length,
      1,
    );
    const multiRequest = multiRequested[0];
    assert(
      "multi-request-frozen-kind",
      multiRequest?.kind === "multi-question",
      multiRequest?.kind ?? null,
      "multi-question",
    );
    const multiQuestionSnapshot = multiRequest?.questions ?? [];
    assert(
      "multi-request-three-questions",
      multiQuestionSnapshot.length === 3,
      multiQuestionSnapshot.length,
      3,
    );
    assert(
      "multi-request-per-question-expiry",
      multiQuestionSnapshot.every(
        (question) =>
          typeof question.expiresAt === "string" &&
          Number.isFinite(Date.parse(question.expiresAt)),
      ),
      multiQuestionSnapshot.map((question) => question.expiresAt ?? null),
      "a finite ISO expiresAt per question",
    );
    const multiNonce = multiRequested[0]?.nonce ?? "";
    // §6-2 no-auto-answer: no user action and no timeout expiry yet.
    await wait(1_200);
    assert(
      "no-resolution-before-timeout-window",
      resolvedEvents("artemis-smoke-multi").length === 0,
      resolvedEvents("artemis-smoke-multi").length,
      0,
    );
    const beforeTimeoutDom = await domState();
    assert(
      "cards-still-pending-without-user-action",
      beforeTimeoutDom.pendingCards === 1,
      beforeTimeoutDom.pendingCards,
      1,
    );
    assert(
      "multi-registry-still-pending",
      multiPending("artemis-smoke-multi"),
      multiPending("artemis-smoke-multi"),
      true,
    );
    assert(
      "no-broker-resolve-before-final-answer",
      brokerPosts.length === 0,
      brokerPosts.length,
      0,
    );

    // §6-6 legacy user resolution through the IPC handler's own entry
    // function: the renderer event and the broker result must agree.
    completeUserInput(
      {
        requestId: "artemis-smoke-single",
        nonce: legacyNonce,
        selectedOption: 0,
      },
      "user",
    );
    const legacyResolved = resolvedEvents("artemis-smoke-single");
    assert(
      "legacy-resolved-once",
      legacyResolved.length === 1,
      legacyResolved.length,
      1,
    );
    assert(
      "legacy-resolved-answer-is-label",
      legacyResolved[0]?.answer === "Yes, implement this plan",
      legacyResolved[0]?.answer ?? null,
      "Yes, implement this plan",
    );
    const legacyPost = brokerPosts.find(
      (post) =>
        (post.resolution as { approvalId?: string } | undefined)?.approvalId ===
        "artemis-smoke-single",
    );
    const legacyResult = (legacyPost?.result ?? {}) as {
      answer?: string;
      selectedOption?: number;
      selectedLabel?: string;
      source?: string;
    };
    assert(
      "legacy-broker-backfill-dual-channel-consistent",
      Boolean(legacyPost) &&
        legacyResult.answer === "Yes, implement this plan" &&
        legacyResult.selectedLabel === "Yes, implement this plan" &&
        legacyResult.selectedOption === 0 &&
        legacyResult.source === "user",
      { post: legacyPost ?? null },
      "answer, selectedLabel, and selectedOption(0) agree with the event",
    );
    const afterLegacy = await waitForDomState(
      "legacy card settled",
      (state) => state.pendingCards === 1 && state.answeredCards >= 1,
    );
    assert(
      "legacy-card-settled-rendered",
      afterLegacy.pendingCards === 1 && afterLegacy.answeredCards >= 1,
      afterLegacy,
      "one pending card (multi) and at least one answered card",
    );

    const multiRendered = await waitForDomState(
      "multi card advances into the decision composer",
      (state) =>
        state.pendingCards === 1 &&
        state.cardTexts.some((text) => text.includes("Ship on Friday?")),
    );
    assert(
      "multi-card-translated-pending",
      multiRendered.pendingCards === 1,
      multiRendered.pendingCards,
      1,
    );
    assert(
      "multi-card-projects-first-pending-question",
      multiRendered.cardTexts.some((text) => text.includes("Ship on Friday?")),
      multiRendered.cardTexts,
      "a translated card showing 'Ship on Friday?'",
    );

    // Capture after the earlier decision settles: only the next pending
    // decision occupies the composer, with the earlier answer in history. A presented compositor frame armed
    // before a double rAF confirms the cards reached the screen before
    // capturePage — the same frame-gating the input-fields driver uses.
    // No new named check: the audit keeps exactly 51 recorded checks.
    if (artifacts.screenshot) {
      const frameArrival = new Promise<boolean>((resolve) => {
        let settled = false;
        const finish = (presented: boolean) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          try {
            window.webContents.endFrameSubscription();
          } catch {
            // Subscription API unavailable: the double rAF below already
            // forces one frame.
          }
          resolve(presented);
        };
        const timeout = setTimeout(() => finish(false), 1_500);
        try {
          window.webContents.beginFrameSubscription(() => finish(true));
        } catch {
          finish(false);
        }
      });
      await window.webContents.executeJavaScript(
        `new Promise((resolve) => {
           let second = 0;
           const first = requestAnimationFrame(() => {
             second = requestAnimationFrame(() => resolve(true));
           });
           setTimeout(() => {
             cancelAnimationFrame(first);
             cancelAnimationFrame(second);
             resolve(false);
           }, 1_500);
         })`,
      );
      await frameArrival;
      const image = await window.webContents.capturePage();
      await writeFile(artifacts.screenshot, image.toPNG());
    }

    // All questions of the live request are answered through both user
    // channels; each answer advances the translated card to the next
    // pending question and the last one triggers the aggregated backfill.
    completeMultiUserInputQuestion(
      "artemis-smoke-multi",
      multiNonce,
      "q1",
      "user",
      { selectedOptionLabel: "Ship it" },
    );
    const afterFirstAnswerDom = await waitForDomState(
      "translated card projecting q2 after the q1 answer",
      (state) =>
        state.pendingCards === 1 &&
        state.cardTexts.some((text) => text.includes("Notify users first?")),
    );
    assert(
      "multi-card-projects-next-pending-question",
      afterFirstAnswerDom.pendingCards === 1 &&
        afterFirstAnswerDom.cardTexts.some((text) =>
          text.includes("Notify users first?"),
        ),
      afterFirstAnswerDom,
      "the translated card now shows 'Notify users first?'",
    );

    // §6-4 duplicate resolution: an already-answered question cannot be
    // answered twice and the store keeps exactly one resolved event.
    let duplicateResolutionError = "";
    try {
      completeMultiUserInputQuestion(
        "artemis-smoke-multi",
        multiNonce,
        "q1",
        "user",
        { selectedOptionLabel: "Ship it" },
      );
    } catch (error) {
      duplicateResolutionError = error instanceof Error ? error.message : "";
    }
    assert(
      "duplicate-question-resolution-rejected",
      duplicateResolutionError.includes("no longer pending"),
      duplicateResolutionError,
      "a 'no longer pending' rejection",
    );
    assert(
      "duplicate-resolution-single-side-effect",
      resolvedEvents("artemis-smoke-multi").length === 1,
      resolvedEvents("artemis-smoke-multi").length,
      1,
    );

    // §6-4 duplicate injection: the same approval id cannot register twice;
    // the duplicate is answered with one broker reject (approved:false,
    // "User input is already pending.") instead of a thrown error, and the
    // store keeps exactly one requested event.
    let duplicateInjectionError = "";
    try {
      handleUserInputBrokerRequest("artemis-smoke-multi-worker", {
        kind: "user.input",
        approvalId: "artemis-smoke-multi",
        threadId,
        turnId,
        workspacePath,
        header: "Plan check",
        questions: multiQuestions,
        mode: "work",
      });
    } catch (error) {
      duplicateInjectionError = error instanceof Error ? error.message : "";
    }
    const duplicateInjectionPost = brokerPosts.find(
      (post) =>
        post.requestId === "artemis-smoke-multi-worker" &&
        (post.resolution as { approved?: boolean } | undefined)?.approved ===
          false &&
        post.error === "User input is already pending.",
    );
    assert(
      "duplicate-injection-rejected",
      duplicateInjectionError === "" && Boolean(duplicateInjectionPost),
      {
        thrown: duplicateInjectionError,
        post: duplicateInjectionPost ?? null,
      },
      "no throw and one approved:false broker reject saying 'User input is already pending.'",
    );
    assert(
      "duplicate-injection-single-requested-event",
      requestedEvents("artemis-smoke-multi").length === 1,
      requestedEvents("artemis-smoke-multi").length,
      1,
    );

    completeMultiUserInputQuestion(
      "artemis-smoke-multi",
      multiNonce,
      "q2",
      "user",
      { selectedOptionLabel: "Email digest" },
    );
    const betweenAnswersDom = await waitForDomState(
      "translated card projecting q3 after the q2 answer",
      (state) =>
        state.pendingCards === 1 &&
        state.cardTexts.some((text) => text.includes("Anything to add?")),
    );
    assert(
      "multi-card-projects-last-pending-question",
      betweenAnswersDom.pendingCards === 1 &&
        betweenAnswersDom.cardTexts.some((text) =>
          text.includes("Anything to add?"),
        ),
      betweenAnswersDom,
      "the translated card now shows 'Anything to add?'",
    );
    completeMultiUserInputQuestion(
      "artemis-smoke-multi",
      multiNonce,
      "q3",
      "user",
      { customAnswer: "Add a changelog entry first." },
    );
    const multiResolved = resolvedEvents("artemis-smoke-multi");
    assert(
      "multi-all-questions-resolved",
      multiResolved.length === 3,
      multiResolved.length,
      3,
    );
    const multiFinalPost = brokerPosts.find(
      (post) =>
        (post.resolution as { approvalId?: string } | undefined)?.approvalId ===
          "artemis-smoke-multi" &&
        (post.resolution as { approved?: boolean } | undefined)?.approved ===
          true,
    );
    const multiFinalResult = (multiFinalPost?.result ?? {}) as {
      answers?: Array<{
        questionId?: string;
        answer?: string;
        source?: string;
      }>;
      source?: string;
    };
    assert(
      "final-broker-resolve-approved-once",
      Boolean(multiFinalPost) &&
        (multiFinalPost?.resolution as { approved?: boolean } | undefined)
          ?.approved === true,
      multiFinalPost ?? null,
      "exactly one approved broker resolve for the multi request",
    );
    assert(
      "final-broker-resolve-aggregates-answers",
      multiFinalResult.answers?.length === 3 &&
        multiFinalResult.answers[0]?.answer === "Ship it" &&
        multiFinalResult.answers[1]?.answer === "Email digest" &&
        multiFinalResult.answers[2]?.answer ===
          "Add a changelog entry first." &&
        multiFinalResult.answers.every((answer) => answer.source === "user"),
      multiFinalResult,
      "aggregated answers for q1/q2/q3 in order, each with source user",
    );
    // Review R2 P1-3: the aggregate covers the whole card, so a top-level
    // source would misstate every question that settled differently from
    // the last one — provenance lives per question only.
    assert(
      "final-broker-resolve-no-top-level-source",
      Object.hasOwn(multiFinalResult, "source") === false,
      multiFinalResult,
      "no top-level source on the all-user aggregate",
    );
    assert(
      "multi-registry-drained-after-final",
      !multiPending("artemis-smoke-multi"),
      multiPending("artemis-smoke-multi"),
      false,
    );
    const multiAnsweredDom = await waitForDomState(
      "multi card answered",
      (state) => state.pendingCards === 0 && state.answeredCards >= 2,
    );
    assert(
      "multi-card-answered-rendered",
      multiAnsweredDom.pendingCards === 0,
      multiAnsweredDom.pendingCards,
      0,
    );

    // §6-2 timeout arm: the five-minute timers cannot be shortened, and the
    // frozen reducer honors a reverse time gate (a timeout stamped before a
    // question's expiresAt is discarded whole), so the timeout path is
    // driven through a synthetic request whose first question already
    // expired while its second question keeps a live deadline. The request
    // rides the real emitPayload channel and a real registry registration;
    // only the minted expiresAt is synthesized (checklist §6-2 fallback).
    const expiredRequestId = "artemis-smoke-multi-expired";
    const expiredNonce = "artemis-smoke-expired-nonce";
    // One set of frozen deadlines shared by the registry snapshot and the
    // emitted payload: the main-process expiry gate reads the registry copy,
    // the reducer reads the payload copy, and the two must agree exactly.
    const expiredQuestionDeadlines = [
      new Date(Date.now() - 60_000).toISOString(),
      new Date(Date.now() + 300_000).toISOString(),
    ];
    const expiredQuestions = [
      {
        questionId: "e1",
        question: "Archive the old logs?",
        options: [
          {
            label: "Archive it",
            description: "Move logs to cold storage.",
            recommended: true,
          },
          {
            label: "Keep them",
            description: "Leave the logs in place.",
            recommended: false,
          },
        ],
      },
      {
        questionId: "e2",
        question: "File the report where?",
        options: [
          {
            label: "Internal wiki",
            description: "Publish internally.",
            recommended: true,
          },
          {
            label: "Email digest",
            description: "Send by email.",
            recommended: false,
          },
        ],
      },
    ];
    pendingMultiUserInputs.register({
      requestId: expiredRequestId,
      nonce: expiredNonce,
      questions: expiredQuestions.map((question, index) => ({
        ...question,
        expiresAt: expiredQuestionDeadlines[index]!,
      })),
      value: {
        workerRequestId: "artemis-smoke-multi-expired-worker",
        request: {
          kind: "user.input",
          approvalId: expiredRequestId,
          threadId,
          turnId,
          workspacePath,
          header: "Expiry",
          questions: expiredQuestions,
          mode: "work",
        },
        timeouts: new Map(),
      },
    });
    emitPayload(threadId, turnId, {
      type: "user-input.requested",
      kind: "multi-question",
      requestId: expiredRequestId,
      nonce: expiredNonce,
      header: "Expiry",
      questions: expiredQuestions.map((question, index) => ({
        questionId: question.questionId,
        question: question.question,
        options: question.options,
        expiresAt: expiredQuestionDeadlines[index]!,
      })),
    });
    const expiredRendered = await waitForDomState(
      "expired-deadline card pending",
      (state) => state.pendingCards === 1,
    );
    assert(
      "expired-request-card-pending",
      expiredRendered.pendingCards === 1,
      expiredRendered.pendingCards,
      1,
    );
    completeMultiUserInputQuestion(
      expiredRequestId,
      expiredNonce,
      "e1",
      "timeout",
    );
    const expiredResolved = resolvedEvents(expiredRequestId);
    assert(
      "timeout-resolves-exactly-first-expired-question",
      expiredResolved.length === 1 &&
        expiredResolved[0]?.questionId === "e1" &&
        expiredResolved[0]?.source === "timeout",
      expiredResolved,
      "one resolved event for e1 with source timeout",
    );
    assert(
      "timeout-answer-is-recommended-label",
      expiredResolved[0]?.selectedOptionLabel === "Archive it",
      expiredResolved[0]?.selectedOptionLabel ?? null,
      "Archive it",
    );
    assert(
      "timeout-no-broker-resolve-before-final",
      // legacy backfill (1) + duplicate-injection reject (2) + multi final
      // backfill (3): nothing else may reach the agent host.
      brokerPosts.length === 3,
      brokerPosts.length,
      3,
    );
    const afterExpiredTimeoutDom = await waitForDomState(
      "expired-deadline card projecting e2 after the e1 timeout",
      (state) =>
        state.pendingCards === 1 &&
        state.cardTexts.some((text) => text.includes("File the report where?")),
    );
    assert(
      "timeout-card-still-pending-after-partial-timeout",
      afterExpiredTimeoutDom.pendingCards === 1,
      afterExpiredTimeoutDom.pendingCards,
      1,
    );
    assert(
      "timeout-card-projects-next-pending-question",
      afterExpiredTimeoutDom.cardTexts.some((text) =>
        text.includes("File the report where?"),
      ),
      afterExpiredTimeoutDom.cardTexts,
      "the translated card now shows 'File the report where?'",
    );

    // The still-live second question is answered by user choice (a
    // non-recommended label), proving per-question independence inside one
    // card: e1 closed by timeout, e2 closed by choice, one aggregated
    // broker backfill.
    completeMultiUserInputQuestion(
      expiredRequestId,
      expiredNonce,
      "e2",
      "user",
      { selectedOptionLabel: "Email digest" },
    );
    const expiredFinalResolved = resolvedEvents(expiredRequestId);
    assert(
      "mixed-expiry-all-questions-resolved",
      expiredFinalResolved.length === 2,
      expiredFinalResolved.length,
      2,
    );
    const expiredFinalPost = brokerPosts.find(
      (post) =>
        (post.resolution as { approvalId?: string } | undefined)?.approvalId ===
        expiredRequestId,
    );
    const expiredFinalResult = (expiredFinalPost?.result ?? {}) as {
      answers?: Array<{
        questionId?: string;
        answer?: string;
        source?: string;
      }>;
    };
    assert(
      "mixed-expiry-final-broker-backfill",
      Boolean(expiredFinalPost) &&
        (expiredFinalPost?.resolution as { approved?: boolean } | undefined)
          ?.approved === true &&
        expiredFinalResult.answers?.length === 2 &&
        expiredFinalResult.answers[0]?.answer === "Archive it" &&
        expiredFinalResult.answers[1]?.answer === "Email digest" &&
        expiredFinalResult.answers[0]?.source === "timeout" &&
        expiredFinalResult.answers[1]?.source === "user",
      expiredFinalPost ?? null,
      "one approved backfill aggregating the timed-out and user-chosen answers with per-question source",
    );
    assert(
      "mixed-expiry-broker-backfill-no-top-level-source",
      Object.hasOwn(expiredFinalResult, "source") === false,
      expiredFinalResult,
      "no top-level source on the timeout-then-user aggregate",
    );
    const expiredSettledDom = await waitForDomState(
      "mixed-expiry card settled timed-out",
      (state) => state.pendingCards === 0 && state.timedOutCards >= 1,
    );
    assert(
      "mixed-expiry-card-settles-timed-out",
      expiredSettledDom.pendingCards === 0 &&
        expiredSettledDom.timedOutCards >= 1,
      expiredSettledDom,
      "no pending cards and a timed-out aggregate card",
    );

    // Review R2 P1-3, reverse settlement order: the user answers the live
    // first question while the second has already expired, so the card
    // settles user -> timeout — the mirror of the mixed-expiry card above.
    // The aggregated backfill must carry per-question provenance only, with
    // no top-level source relabeling the whole card as the last question's
    // origin.
    const reverseRequestId = "artemis-smoke-multi-reverse";
    const reverseNonce = "artemis-smoke-reverse-nonce";
    const reverseQuestionDeadlines = [
      new Date(Date.now() + 300_000).toISOString(),
      new Date(Date.now() - 60_000).toISOString(),
    ];
    const reverseQuestions = [
      {
        questionId: "r1",
        question: "Keep the changelog where?",
        options: [
          {
            label: "In repo",
            description: "Ship it with the code.",
            recommended: true,
          },
          {
            label: "Wiki",
            description: "Publish it separately.",
            recommended: false,
          },
        ],
      },
      {
        questionId: "r2",
        question: "Delete the stale branches?",
        options: [
          {
            label: "Yes, delete",
            description: "Remove merged branches.",
            recommended: true,
          },
          {
            label: "Keep them",
            description: "Leave the branches alone.",
            recommended: false,
          },
        ],
      },
    ];
    pendingMultiUserInputs.register({
      requestId: reverseRequestId,
      nonce: reverseNonce,
      questions: reverseQuestions.map((question, index) => ({
        ...question,
        expiresAt: reverseQuestionDeadlines[index]!,
      })),
      value: {
        workerRequestId: "artemis-smoke-multi-reverse-worker",
        request: {
          kind: "user.input",
          approvalId: reverseRequestId,
          threadId,
          turnId,
          workspacePath,
          header: "Reverse",
          questions: reverseQuestions,
          mode: "work",
        },
        timeouts: new Map(),
      },
    });
    emitPayload(threadId, turnId, {
      type: "user-input.requested",
      kind: "multi-question",
      requestId: reverseRequestId,
      nonce: reverseNonce,
      header: "Reverse",
      questions: reverseQuestions.map((question, index) => ({
        questionId: question.questionId,
        question: question.question,
        options: question.options,
        expiresAt: reverseQuestionDeadlines[index]!,
      })),
    });
    const reverseRendered = await waitForDomState(
      "reverse-order card pending",
      (state) => state.pendingCards === 1,
    );
    assert(
      "reverse-expiry-card-pending",
      reverseRendered.pendingCards === 1,
      reverseRendered.pendingCards,
      1,
    );
    completeMultiUserInputQuestion(
      reverseRequestId,
      reverseNonce,
      "r1",
      "user",
      { selectedOptionLabel: "Wiki" },
    );
    const reverseAfterUser = resolvedEvents(reverseRequestId);
    assert(
      "reverse-expiry-user-answer-first",
      reverseAfterUser.length === 1 &&
        reverseAfterUser[0]?.questionId === "r1" &&
        reverseAfterUser[0]?.source === "user" &&
        reverseAfterUser[0]?.selectedOptionLabel === "Wiki",
      reverseAfterUser,
      "one user resolution for r1 choosing the non-recommended 'Wiki'",
    );
    const reverseAfterUserDom = await waitForDomState(
      "reverse-order card projects the expired r2 after the r1 answer",
      (state) =>
        state.pendingCards === 1 &&
        state.cardTexts.some((text) =>
          text.includes("Delete the stale branches?"),
        ),
    );
    assert(
      "reverse-expiry-card-projects-expired-question",
      reverseAfterUserDom.cardTexts.some((text) =>
        text.includes("Delete the stale branches?"),
      ),
      reverseAfterUserDom.cardTexts,
      "the translated card now shows 'Delete the stale branches?'",
    );
    completeMultiUserInputQuestion(
      reverseRequestId,
      reverseNonce,
      "r2",
      "timeout",
    );
    const reverseResolved = resolvedEvents(reverseRequestId);
    assert(
      "reverse-expiry-all-questions-resolved",
      reverseResolved.length === 2,
      reverseResolved.length,
      2,
    );
    const reverseFinalPost = brokerPosts.find(
      (post) =>
        (post.resolution as { approvalId?: string } | undefined)?.approvalId ===
        reverseRequestId,
    );
    const reverseFinalResult = (reverseFinalPost?.result ?? {}) as {
      answers?: Array<{
        questionId?: string;
        answer?: string;
        source?: string;
      }>;
    };
    assert(
      "reverse-expiry-final-broker-backfill",
      Boolean(reverseFinalPost) &&
        (reverseFinalPost?.resolution as { approved?: boolean } | undefined)
          ?.approved === true &&
        reverseFinalResult.answers?.length === 2 &&
        reverseFinalResult.answers[0]?.answer === "Wiki" &&
        reverseFinalResult.answers[1]?.answer === "Yes, delete" &&
        reverseFinalResult.answers[0]?.source === "user" &&
        reverseFinalResult.answers[1]?.source === "timeout",
      reverseFinalPost ?? null,
      "one approved backfill aggregating the user-then-timeout answers with per-question source",
    );
    assert(
      "reverse-expiry-broker-backfill-no-top-level-source",
      Object.hasOwn(reverseFinalResult, "source") === false,
      reverseFinalResult,
      "no top-level source on the user-then-timeout aggregate",
    );
    const reverseSettledDom = await waitForDomState(
      "reverse-order card settled timed-out",
      (state) => state.pendingCards === 0 && state.timedOutCards >= 2,
    );
    assert(
      "reverse-expiry-card-settles-timed-out",
      reverseSettledDom.pendingCards === 0 &&
        reverseSettledDom.timedOutCards >= 2,
      reverseSettledDom,
      "no pending cards and a second timed-out aggregate card",
    );

    // §6-3 no-infinite-wait: a fresh multi request on the same turn, then
    // the real thread-cancel path closes every pending question with one
    // kind-less cancelled event and an approved:false broker receipt.
    handleUserInputBrokerRequest("artemis-smoke-multi-cancel-worker", {
      kind: "user.input",
      approvalId: "artemis-smoke-multi-cancel",
      threadId,
      turnId,
      workspacePath,
      header: "Release",
      questions: cancelQuestions,
      mode: "work",
    });
    const cancelTargetRendered = await waitForDomState(
      "cancel-target card pending",
      (state) => state.pendingCards === 1,
    );
    assert(
      "cancel-target-card-pending",
      cancelTargetRendered.pendingCards === 1,
      cancelTargetRendered.pendingCards,
      1,
    );
    await cancelTaskTurn(threadId);
    const cancelResolved = resolvedEvents("artemis-smoke-multi-cancel");
    assert(
      "cancel-emits-one-kind-less-cancelled",
      cancelResolved.length === 1 &&
        cancelResolved[0]?.kind === undefined &&
        cancelResolved[0]?.source === "cancelled",
      cancelResolved,
      "one kind-less resolved event with source cancelled",
    );
    const cancelPost = brokerPosts.find(
      (post) =>
        (post.resolution as { approvalId?: string } | undefined)?.approvalId ===
        "artemis-smoke-multi-cancel",
    );
    assert(
      "cancel-broker-resolve-rejected",
      Boolean(cancelPost) &&
        (cancelPost?.resolution as { approved?: boolean } | undefined)
          ?.approved === false &&
        cancelPost?.error === "The turn was cancelled.",
      cancelPost ?? null,
      "approved:false with 'The turn was cancelled.'",
    );
    assert(
      "cancel-registry-drained",
      !multiPending("artemis-smoke-multi-cancel"),
      multiPending("artemis-smoke-multi-cancel"),
      false,
    );
    const cancelledDom = await waitForDomState(
      "cancelled card rendered",
      (state) => state.pendingCards === 0 && state.cancelledCards >= 1,
    );
    assert(
      "cancel-closes-card-in-renderer",
      cancelledDom.pendingCards === 0 && cancelledDom.cancelledCards >= 1,
      cancelledDom,
      "no pending cards and a cancelled card",
    );

    smokeUserInputTransportEvidence = {
      view: "user-input-transport",
      generatedAt: new Date().toISOString(),
      checks,
      brokerPosts,
      storeChecks: {
        legacyRequested: requestedEvents("artemis-smoke-single").length,
        legacyResolved: resolvedEvents("artemis-smoke-single").length,
        multiRequested: requestedEvents("artemis-smoke-multi").length,
        multiResolved: resolvedEvents("artemis-smoke-multi").length,
        multiExpiredRequested: requestedEvents(expiredRequestId).length,
        multiExpiredResolved: resolvedEvents(expiredRequestId).length,
        multiCancelRequested: requestedEvents("artemis-smoke-multi-cancel")
          .length,
        multiCancelResolved: resolvedEvents("artemis-smoke-multi-cancel")
          .length,
        multiReverseRequested: requestedEvents(reverseRequestId).length,
        multiReverseResolved: resolvedEvents(reverseRequestId).length,
      },
      renderer: await domState(),
    };
  } finally {
    delete (agentHost as { post?: unknown }).post;
    activeTurns.delete(threadId);
  }
}
