import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { app } from "electron";
import {
  store,
  activeTurns,
  pendingMultiUserInputs,
  emitPayload,
  handleUserInputBrokerRequest,
  completeMultiUserInputQuestion,
} from "../../../src/main/main.js";

import { smokeMode } from "./environment.js";

export function seedSmokeUserInputFixture(): void {
  if (!store || !process.env.ARTEMIS_SMOKE_USER_INPUT) return;
  const now = new Date().toISOString();
  const localized = process.env.ARTEMIS_SMOKE_LOCALE === "zh-CN";
  const projectId = "artemis-smoke-project";
  const threadId = "artemis-smoke-user-input";
  store.upsertProject({
    id: projectId,
    name: "Artemis",
    path: process.cwd(),
    createdAt: now,
    updatedAt: now,
  });
  store.createThread({
    id: threadId,
    projectId,
    title: localized ? "确认实施计划" : "Confirm the plan",
    mode: "work",
    target: "local",
    status: "running",
    pinned: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
  });
  store.appendEvent("artemis-smoke-user-input-event", threadId, "smoke-turn", {
    type: "user-input.requested",
    requestId: "artemis-smoke-request",
    nonce: "artemis-smoke-nonce-0001",
    header: localized ? "计划确认" : "Confirmation",
    question: localized ? "实施此计划？" : "Implement this plan?",
    options: localized
      ? [
          {
            label: "是，实施此计划",
            description: "按当前方案继续实施。",
            recommended: true,
          },
          {
            label: "先调整计划",
            description: "说明需要修改的内容后再继续。",
            recommended: false,
          },
        ]
      : [
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
        ],
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
  });
}

export async function seedSmokeUserInputTransportFixture(): Promise<void> {
  // The smokeMode guard matches seedSmokeInputFieldsFixture: seeding stays
  // a smoke-harness-only behavior so a merely VIEW-tagged process can never
  // write smoke fixtures into a real profile.
  const view = process.env.ARTEMIS_SMOKE_VIEW;
  if (!store || !smokeMode || view !== "user-input-transport") {
    return;
  }
  const fixtureDirectory = join(
    app.getPath("userData"),
    "fixtures",
    "user-input-transport",
  );
  await mkdir(fixtureDirectory, { recursive: true });
  const now = new Date().toISOString();
  const projectId = "artemis-smoke-project";
  const threadId = "artemis-smoke-user-input-transport";
  store.upsertProject({
    id: projectId,
    name: "Artemis",
    path: fixtureDirectory,
    createdAt: now,
    updatedAt: now,
  });
  store.createThread({
    id: threadId,
    projectId,
    title: "Transport smoke",
    mode: "work",
    target: "local",
    status: "running",
    pinned: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
  });
}

export type SmokeMultiQuestionUiQuestion = {
  questionId: string;
  question: string;
  options: Array<{
    label: string;
    description: string;
    recommended: boolean;
  }>;
  expiresAt: string;
};

export function registerSmokeMultiQuestionUiPendingInput(input: {
  requestId: string;
  nonce: string;
  workerRequestId: string;
  threadId: string;
  turnId: string;
  workspacePath: string;
  header: string;
  questions: SmokeMultiQuestionUiQuestion[];
}): void {
  pendingMultiUserInputs.register({
    requestId: input.requestId,
    nonce: input.nonce,
    questions: input.questions.map((question) => ({
      questionId: question.questionId,
      options: question.options,
      expiresAt: question.expiresAt,
    })),
    value: {
      workerRequestId: input.workerRequestId,
      request: {
        kind: "user.input",
        approvalId: input.requestId,
        threadId: input.threadId,
        turnId: input.turnId,
        workspacePath: input.workspacePath,
        header: input.header,
        questions: input.questions.map(({ questionId, question, options }) => ({
          questionId,
          question,
          options,
        })),
        mode: "work",
      },
      timeouts: new Map(),
    },
  });
  emitPayload(input.threadId, input.turnId, {
    type: "user-input.requested",
    kind: "multi-question",
    requestId: input.requestId,
    nonce: input.nonce,
    header: input.header,
    questions: input.questions.map(
      ({ questionId, question, options, expiresAt }) => ({
        questionId,
        question,
        options,
        expiresAt,
      }),
    ),
  });
}

export async function seedSmokeMultiQuestionUiFixture(): Promise<void> {
  const view = process.env.ARTEMIS_SMOKE_VIEW;
  // PR10C review (severe 1): dedicated sentinel gate mirroring the
  // ARTEMIS_SMOKE_USER_INPUT fixture contract — a bare
  // ARTEMIS_SMOKE_VIEW=multi-question-ui* must never seed the store.
  if (
    !store ||
    process.env.ARTEMIS_SMOKE_MULTI_UI !== "1" ||
    !view?.startsWith("multi-question-ui")
  ) {
    return;
  }
  const fixtureDirectory = join(
    app.getPath("userData"),
    "fixtures",
    "multi-question-ui",
  );
  await mkdir(fixtureDirectory, { recursive: true });
  const now = new Date().toISOString();
  const projectId = "artemis-smoke-project";
  const threadId = "artemis-smoke-multi-ui-thread";
  const turnId = "artemis-smoke-multi-ui-turn";
  store.upsertProject({
    id: projectId,
    name: "Artemis",
    path: fixtureDirectory,
    createdAt: now,
    updatedAt: now,
  });
  store.createThread({
    id: threadId,
    projectId,
    title: "Multi-question UI smoke",
    mode: "work",
    target: "local",
    status: "running",
    pinned: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
  });
  // The real broker and cancel paths validate turn ownership, so the seeded
  // turn stays "active" exactly like a live broker request (#124 channel).
  activeTurns.set(threadId, turnId);
  // Long, staggered per-question deadlines: the UI drive asserts each
  // question's countdown reads its own expiresAt, and no real timer ever
  // fires mid-drive (these registry entries carry no armed timers).
  const liveDeadline = (offsetSeconds: number) =>
    new Date(Date.now() + 10 * 60_000 + offsetSeconds * 1_000).toISOString();
  if (view === "multi-question-ui") {
    // Legacy single-question regression card through the REAL broker
    // handler (validator, registry, five-minute timer, requested payload)
    // alongside the multi card, mirroring the #124 smoke layout.
    if (process.env.ARTEMIS_SMOKE_REVIEW06 !== "1") {
      handleUserInputBrokerRequest("artemis-smoke-multi-ui-single-worker", {
        kind: "user.input",
        approvalId: "artemis-smoke-multi-ui-single",
        threadId,
        turnId,
        workspacePath: fixtureDirectory,
        header: "Confirmation",
        question: "Run the legacy release checklist?",
        options: [
          {
            label: "Yes, run the checklist",
            description: "Execute every legacy step.",
            recommended: true,
          },
          {
            label: "Skip the checklist",
            description: "Continue without the legacy steps.",
            recommended: false,
          },
        ],
        mode: "work",
      });
    }
    registerSmokeMultiQuestionUiPendingInput({
      requestId: "artemis-smoke-multi-ui",
      nonce: "artemis-smoke-multi-ui-nonce",
      workerRequestId: "artemis-smoke-multi-ui-worker",
      threadId,
      turnId,
      workspacePath: fixtureDirectory,
      header: "Plan check",
      questions: [
        {
          questionId: "q1",
          question: "Ship the release on Friday?",
          options: [
            {
              label: "Ship it",
              description: "Release the build on Friday.",
              recommended: true,
            },
            {
              label: "Hold the release",
              description: "Wait one more day.",
              recommended: false,
            },
          ],
          expiresAt: liveDeadline(0),
        },
        {
          questionId: "q2",
          question: "Who is notified first?",
          options: [
            {
              label: "Email digest",
              description: "Send a summary by email.",
              recommended: true,
            },
            {
              label: "In-app banner",
              description: "Show a banner in the app.",
              recommended: false,
            },
            {
              label: "Slack channel",
              description: "Post to the release channel.",
              recommended: false,
            },
          ],
          expiresAt: liveDeadline(30),
        },
        {
          questionId: "q3",
          question: "Add anything to the notes?",
          options: [
            {
              label: "No, keep it short",
              description: "Ship the notes as-is.",
              recommended: true,
            },
            {
              label: "Yes, expand the notes",
              description: "Add the migration details.",
              recommended: false,
            },
          ],
          expiresAt: liveDeadline(60),
        },
      ],
    });
    return;
  }
  if (view === "multi-question-ui-expired") {
    // Timeout arm (same disclosure as the #124 checklist §6-2 fallback):
    // the five-minute timers cannot be shortened, so the first question is
    // seeded with an already-past deadline and closed through the timer's
    // own resolution function (completeMultiUserInputQuestion, source
    // "timeout") — the exact assembly of the timer body firing — while the
    // second question keeps a live deadline the UI drive answers by hand.
    registerSmokeMultiQuestionUiPendingInput({
      requestId: "artemis-smoke-multi-ui-expired",
      nonce: "artemis-smoke-multi-ui-expired-nonce",
      workerRequestId: "artemis-smoke-multi-ui-expired-worker",
      threadId,
      turnId,
      workspacePath: fixtureDirectory,
      header: "Expiry",
      questions: [
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
          expiresAt: new Date(Date.now() - 60_000).toISOString(),
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
          expiresAt: liveDeadline(30),
        },
      ],
    });
    completeMultiUserInputQuestion(
      "artemis-smoke-multi-ui-expired",
      "artemis-smoke-multi-ui-expired-nonce",
      "e1",
      "timeout",
    );
    return;
  }
  if (view === "multi-question-ui-cancel") {
    registerSmokeMultiQuestionUiPendingInput({
      requestId: "artemis-smoke-multi-ui-cancel",
      nonce: "artemis-smoke-multi-ui-cancel-nonce",
      workerRequestId: "artemis-smoke-multi-ui-cancel-worker",
      threadId,
      turnId,
      workspacePath: fixtureDirectory,
      header: "Release",
      questions: [
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
          expiresAt: liveDeadline(0),
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
          expiresAt: liveDeadline(30),
        },
      ],
    });
  }
}
