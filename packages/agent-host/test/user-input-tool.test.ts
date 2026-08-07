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
