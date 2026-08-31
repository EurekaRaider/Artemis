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
});
