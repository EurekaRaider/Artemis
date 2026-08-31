import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { BrokerExecutionRequest } from "@artemis/protocol";
import { afterEach, describe, expect, it } from "vitest";

import { ArtemisAgentHost } from "../src/runtime.js";

interface InspectableTool {
  name: string;
  execute(
    toolCallId: string,
    parameters: Record<string, unknown>,
  ): Promise<{ content: Array<{ type: string; text: string }> }>;
}

interface InspectableThread {
  delegatedTools: InspectableTool[];
  currentTurnId?: string;
  currentMode?: "execute" | "plan" | "review";
}

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("request_user_input", () => {
  it("asks exactly one structured question and returns the selected answer", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "artemis-input-tool-"));
    cleanupPaths.push(workspace);
    const requests: BrokerExecutionRequest[] = [];
    let releaseFirst!: () => void;
    const firstAnswerPending = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const host = new ArtemisAgentHost(
      {
        async request(request) {
          requests.push(request);
          if (requests.length === 1) await firstAnswerPending;
          return {
            approved: true,
            data: {
              answer: "Measure first",
              selectedOption: 0,
              source: "user",
            },
          };
        },
      },
      { emit() {} },
    );
    await host.openThread({
      threadId: "input-thread",
      workspacePath: workspace,
      target: "local",
    });
    const thread = (
      host as unknown as { threads: Map<string, InspectableThread> }
    ).threads.get("input-thread")!;
    thread.currentTurnId = "turn-1";
    thread.currentMode = "plan";
    const tool = thread.delegatedTools.find(
      (candidate) => candidate.name === "request_user_input",
    )!;

    const parameters = {
      header: "Baseline",
      question: "Should a baseline be measured before implementation?",
      options: [
        {
          label: "Measure first",
          description: "Confirm the hotspot with timing data.",
          recommended: true,
        },
        {
          label: "Implement now",
          description: "Start from the suspected hotspot.",
          recommended: false,
        },
      ],
    };
    const first = tool.execute("input-call-1", parameters);
    const second = tool.execute("input-call-2", {
      ...parameters,
      header: "Platform",
      question: "Which platform should be targeted first?",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requests).toHaveLength(1);
    releaseFirst();
    const [result] = await Promise.all([first, second]);

    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({
      kind: "user.input",
      header: "Baseline",
      question: "Should a baseline be measured before implementation?",
    });
    expect(requests[1]).toMatchObject({
      kind: "user.input",
      header: "Platform",
      question: "Which platform should be targeted first?",
    });
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({
      answer: "Measure first",
      selectedOption: 0,
    });
    host.dispose();
  });
});

interface MultiQuestionParameters {
  header: string;
  questions: Array<{
    questionId: string;
    question: string;
    options: Array<{
      label: string;
      description: string;
      recommended: boolean;
    }>;
  }>;
}

function buildMultiQuestionParameters(): MultiQuestionParameters {
  return {
    header: "Release",
    questions: [
      {
        questionId: "q1",
        question: "Ship today or measure the hotspot first?",
        options: [
          {
            label: "Ship now",
            description: "Release with the current implementation.",
            recommended: true,
          },
          {
            label: "Measure first",
            description: "Confirm the hotspot with timing data.",
            recommended: false,
          },
        ],
      },
      {
        questionId: "q2",
        question: "Which platform should be verified first?",
        options: [
          {
            label: "macOS arm64",
            description: "Primary release target.",
            recommended: true,
          },
          {
            label: "macOS x64",
            description: "Secondary target.",
            recommended: false,
          },
        ],
      },
    ],
  };
}

describe("request_user_input multi-question producer activation (D#76 PR10C, decisions F/H)", () => {
  it("sends one broker request carrying the questions variant for a questions-array call", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "artemis-input-multi-"));
    cleanupPaths.push(workspace);
    const requests: BrokerExecutionRequest[] = [];
    const host = new ArtemisAgentHost(
      {
        async request(request) {
          requests.push(request);
          return {
            approved: true,
            data: {
              answers: [
                { questionId: "q1", selectedOptionLabel: "Ship now" },
                { questionId: "q2", selectedOptionLabel: "Measure first" },
                { questionId: "q3", customAnswer: "Both, in one report" },
              ],
            },
          };
        },
      },
      { emit() {} },
    );
    await host.openThread({
      threadId: "input-multi-thread",
      workspacePath: workspace,
      target: "local",
    });
    const thread = (
      host as unknown as { threads: Map<string, InspectableThread> }
    ).threads.get("input-multi-thread")!;
    thread.currentTurnId = "turn-1";
    thread.currentMode = "plan";
    const tool = thread.delegatedTools.find(
      (candidate) => candidate.name === "request_user_input",
    )!;

    const parameters = {
      header: "Release",
      questions: [
        {
          questionId: "q1",
          question: "Ship today or measure the hotspot first?",
          options: [
            {
              label: "Ship now",
              description: "Release with the current implementation.",
              recommended: true,
            },
            {
              label: "Measure first",
              description: "Confirm the hotspot with timing data.",
              recommended: false,
            },
          ],
        },
        {
          questionId: "q2",
          question: "Which platform should be verified first?",
          options: [
            {
              label: "macOS arm64",
              description: "Primary release target.",
              recommended: true,
            },
            {
              label: "macOS x64",
              description: "Secondary target.",
              recommended: false,
            },
            {
              label: "Windows",
              description: "After macOS parity.",
              recommended: false,
            },
          ],
        },
        {
          questionId: "q3",
          question: "Where should the report land?",
          options: [
            {
              label: "Thread summary",
              description: "Summarize in the thread.",
              recommended: true,
            },
            {
              label: "Markdown file",
              description: "Write a report file.",
              recommended: false,
            },
          ],
        },
      ],
    };
    const outcome = await tool.execute("multi-input-call-1", parameters).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    expect(
      outcome.ok,
      outcome.ok
        ? undefined
        : `request_user_input 应接受多题入参（questions 数组，决策点 F 案 1 + H 激活）：当前被拒绝——${String(
            outcome.error,
          )}`,
    ).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      kind: "user.input",
      header: "Release",
      questions: [
        {
          questionId: "q1",
          question: "Ship today or measure the hotspot first?",
          options: [
            { label: "Ship now", recommended: true },
            { label: "Measure first", recommended: false },
          ],
        },
        {
          questionId: "q2",
          options: [
            { label: "macOS arm64", recommended: true },
            { label: "macOS x64", recommended: false },
            { label: "Windows", recommended: false },
          ],
        },
        { questionId: "q3" },
      ],
    });
    host.dispose();
  });

  it("rejects multi-question calls whose options break recommendation or label rules", async () => {
    const workspace = await mkdtemp(
      join(tmpdir(), "artemis-input-multi-invalid-"),
    );
    cleanupPaths.push(workspace);
    const requests: BrokerExecutionRequest[] = [];
    const host = new ArtemisAgentHost(
      {
        async request(request) {
          requests.push(request);
          return { approved: true, data: {} };
        },
      },
      { emit() {} },
    );
    await host.openThread({
      threadId: "input-multi-invalid-thread",
      workspacePath: workspace,
      target: "local",
    });
    const thread = (
      host as unknown as { threads: Map<string, InspectableThread> }
    ).threads.get("input-multi-invalid-thread")!;
    thread.currentTurnId = "turn-1";
    thread.currentMode = "plan";
    const tool = thread.delegatedTools.find(
      (candidate) => candidate.name === "request_user_input",
    )!;

    const zeroRecommended = buildMultiQuestionParameters();
    zeroRecommended.questions[0]!.options[0]!.recommended = false;
    await expect(
      tool.execute("multi-zero-recommended", zeroRecommended),
    ).rejects.toThrow();

    const twoRecommended = buildMultiQuestionParameters();
    twoRecommended.questions[1]!.options[1]!.recommended = true;
    await expect(
      tool.execute("multi-two-recommended", twoRecommended),
    ).rejects.toThrow();

    const duplicateLabels = buildMultiQuestionParameters();
    duplicateLabels.questions[0]!.options[1]!.label =
      duplicateLabels.questions[0]!.options[0]!.label;
    await expect(
      tool.execute("multi-duplicate-labels", duplicateLabels),
    ).rejects.toThrow();

    expect(requests).toHaveLength(0);
    host.dispose();
  });

  it("rejects empty questions, more than three questions, invalid question ids, and mixed payloads", async () => {
    const workspace = await mkdtemp(
      join(tmpdir(), "artemis-input-multi-shape-"),
    );
    cleanupPaths.push(workspace);
    const requests: BrokerExecutionRequest[] = [];
    const host = new ArtemisAgentHost(
      {
        async request(request) {
          requests.push(request);
          return { approved: true, data: {} };
        },
      },
      { emit() {} },
    );
    await host.openThread({
      threadId: "input-multi-shape-thread",
      workspacePath: workspace,
      target: "local",
    });
    const thread = (
      host as unknown as { threads: Map<string, InspectableThread> }
    ).threads.get("input-multi-shape-thread")!;
    thread.currentTurnId = "turn-1";
    thread.currentMode = "plan";
    const tool = thread.delegatedTools.find(
      (candidate) => candidate.name === "request_user_input",
    )!;

    await expect(
      tool.execute("multi-empty-questions", {
        header: "Release",
        questions: [],
      }),
    ).rejects.toThrow();

    const fourQuestions = buildMultiQuestionParameters();
    fourQuestions.questions.push(
      {
        questionId: "q3",
        question: "Should the changelog be updated?",
        options: [
          {
            label: "Yes",
            description: "Update the changelog.",
            recommended: true,
          },
          {
            label: "No",
            description: "Skip the changelog.",
            recommended: false,
          },
        ],
      },
      {
        questionId: "q4",
        question: "Where should the report land?",
        options: [
          {
            label: "Thread summary",
            description: "Summarize in the thread.",
            recommended: true,
          },
          {
            label: "Markdown file",
            description: "Write a report file.",
            recommended: false,
          },
        ],
      },
    );
    await expect(
      tool.execute("multi-four-questions", fourQuestions),
    ).rejects.toThrow();

    const duplicateQuestionIds = buildMultiQuestionParameters();
    duplicateQuestionIds.questions[1]!.questionId = "q1";
    await expect(
      tool.execute("multi-duplicate-question-ids", duplicateQuestionIds),
    ).rejects.toThrow();

    const blankQuestionId = buildMultiQuestionParameters();
    blankQuestionId.questions[0]!.questionId = "   ";
    await expect(
      tool.execute("multi-blank-question-id", blankQuestionId),
    ).rejects.toThrow();

    const mixed = {
      ...buildMultiQuestionParameters(),
      question: "Which platform should be verified first?",
    };
    await expect(tool.execute("multi-mixed-payload", mixed)).rejects.toThrow();

    expect(requests).toHaveLength(0);
    host.dispose();
  });

  it("serializes concurrent multi-question calls like single-question calls", async () => {
    const workspace = await mkdtemp(
      join(tmpdir(), "artemis-input-multi-serial-"),
    );
    cleanupPaths.push(workspace);
    const requests: BrokerExecutionRequest[] = [];
    let releaseFirst!: () => void;
    const firstAnswerPending = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const host = new ArtemisAgentHost(
      {
        async request(request) {
          requests.push(request);
          if (requests.length === 1) await firstAnswerPending;
          return {
            approved: true,
            data: {
              answers: [
                { questionId: "q1", selectedOptionLabel: "Ship now" },
                { questionId: "q2", selectedOptionLabel: "macOS arm64" },
              ],
            },
          };
        },
      },
      { emit() {} },
    );
    await host.openThread({
      threadId: "input-multi-serial-thread",
      workspacePath: workspace,
      target: "local",
    });
    const thread = (
      host as unknown as { threads: Map<string, InspectableThread> }
    ).threads.get("input-multi-serial-thread")!;
    thread.currentTurnId = "turn-1";
    thread.currentMode = "plan";
    const tool = thread.delegatedTools.find(
      (candidate) => candidate.name === "request_user_input",
    )!;

    const parameters = buildMultiQuestionParameters();
    const first = tool.execute("multi-serial-1", parameters);
    const second = tool.execute("multi-serial-2", {
      ...parameters,
      header: "Verify",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requests).toHaveLength(1);
    releaseFirst();
    const results = await Promise.all([first, second]);

    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({ kind: "user.input", header: "Verify" });
    for (const result of results) {
      expect(JSON.parse(result.content[0]!.text)).toEqual({
        answers: [
          { questionId: "q1", selectedOptionLabel: "Ship now" },
          { questionId: "q2", selectedOptionLabel: "macOS arm64" },
        ],
      });
    }
    host.dispose();
  });

  it("returns the multi-question answers array as JSON in the tool result", async () => {
    const workspace = await mkdtemp(
      join(tmpdir(), "artemis-input-multi-json-"),
    );
    cleanupPaths.push(workspace);
    const requests: BrokerExecutionRequest[] = [];
    const host = new ArtemisAgentHost(
      {
        async request(request) {
          requests.push(request);
          return {
            approved: true,
            data: {
              answers: [
                { questionId: "q1", selectedOptionLabel: "Ship now" },
                { questionId: "q2", customAnswer: "Both, in one report" },
              ],
            },
          };
        },
      },
      { emit() {} },
    );
    await host.openThread({
      threadId: "input-multi-json-thread",
      workspacePath: workspace,
      target: "local",
    });
    const thread = (
      host as unknown as { threads: Map<string, InspectableThread> }
    ).threads.get("input-multi-json-thread")!;
    thread.currentTurnId = "turn-1";
    thread.currentMode = "plan";
    const tool = thread.delegatedTools.find(
      (candidate) => candidate.name === "request_user_input",
    )!;

    const result = await tool.execute(
      "multi-json-1",
      buildMultiQuestionParameters(),
    );

    expect(requests).toHaveLength(1);
    expect(JSON.parse(result.content[0]!.text)).toEqual({
      answers: [
        { questionId: "q1", selectedOptionLabel: "Ship now" },
        { questionId: "q2", customAnswer: "Both, in one report" },
      ],
    });
    host.dispose();
  });
});
