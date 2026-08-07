import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { BrokerExecutionRequest } from "@artemis/protocol";
import { afterEach, describe, expect, it } from "vitest";

import { ArtemisAgentHost, type AgentBroker } from "../src/runtime.js";

interface InspectableTool {
  name: string;
  parameters: {
    properties?: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
  execute(
    toolCallId: string,
    parameters: Record<string, unknown>,
  ): Promise<{ content: Array<{ type: string; text: string }> }>;
}

interface InspectableThread {
  currentTurnId: string | undefined;
  currentMode: "execute" | "plan" | "review" | undefined;
  executeTools: InspectableTool[];
  delegatedTools: InspectableTool[];
}

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function openInspectableHost(broker: AgentBroker): Promise<{
  host: ArtemisAgentHost;
  thread: InspectableThread;
}> {
  const workspace = await mkdtemp(join(tmpdir(), "artemis-memory-tool-"));
  cleanupPaths.push(workspace);
  const host = new ArtemisAgentHost(broker, { emit() {} });
  await host.openThread({
    threadId: "memory-thread",
    workspacePath: workspace,
    target: "local",
  });
  const thread = (
    host as unknown as { threads: Map<string, InspectableThread> }
  ).threads.get("memory-thread");
  expect(thread).toBeDefined();
  return { host, thread: thread! };
}

function toolNames(tools: InspectableTool[]): string[] {
  return tools.map((tool) => tool.name);
}

describe("save_memory tool", () => {
  it("is available in Execute but not Plan or Review toolsets", async () => {
    const { host, thread } = await openInspectableHost({
      async request() {
        throw new Error("The mode test must not execute brokered tools");
      },
    });

    expect(toolNames(thread.executeTools)).toContain("save_memory");
    expect(toolNames(thread.delegatedTools)).not.toContain("save_memory");
    host.dispose();
  });

  it("requires the model to select project scope and brokers it without a path", async () => {
    const requests: BrokerExecutionRequest[] = [];
    const { host, thread } = await openInspectableHost({
      async request(request) {
        requests.push(request);
        return { approved: true, data: { appended: true } };
      },
    });
    thread.currentTurnId = "turn-project-memory";
    thread.currentMode = "execute";
    const tool = thread.executeTools.find(
      (candidate) => candidate.name === "save_memory",
    );
    expect(tool).toBeDefined();
    expect(tool?.parameters.properties).not.toHaveProperty("path");
    expect(tool?.parameters.properties).toHaveProperty("scope");
    expect(tool?.parameters.required).toContain("scope");
    expect(tool?.parameters.additionalProperties).toBe(false);

    await tool!.execute("memory-call-project", {
      scope: "project",
      title: "Regenerate this repository protocol fixtures",
      content:
        "When Artemis protocol fixtures change, rebuild the protocol package first, run its focused tests, and only then run the desktop integration test.",
      keywords: ["artemis", "protocol", "fixtures", "build", "test"],
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual(
      expect.objectContaining({
        kind: "memory.append",
        threadId: "memory-thread",
        turnId: "turn-project-memory",
        scope: "project",
        title: "Regenerate this repository protocol fixtures",
      }),
    );
    expect(requests[0]).not.toHaveProperty("path");
    host.dispose();
  });

  it("preserves the model's global scope choice without English trigger words", async () => {
    const requests: BrokerExecutionRequest[] = [];
    const { host, thread } = await openInspectableHost({
      async request(request) {
        requests.push(request);
        return { approved: true, data: { appended: true } };
      },
    });
    thread.currentTurnId = "turn-global-memory";
    thread.currentMode = "execute";
    const tool = thread.executeTools.find(
      (candidate) => candidate.name === "save_memory",
    );
    expect(tool).toBeDefined();

    await tool!.execute("memory-call-global", {
      scope: "global",
      title: "复用受限环境权限诊断流程",
      content:
        "遇到用户会话目录权限错误时，先识别执行环境限制，再在具备真实目录权限的环境复跑；只有复跑仍然失败，才能判断为产品问题。此方法适合不同代码库复用。",
      keywords: ["权限诊断", "受限环境", "复跑验证", "通用流程"],
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual(
      expect.objectContaining({
        kind: "memory.append",
        scope: "global",
      }),
    );
    host.dispose();
  });

  it("does not broker transient facts or secret-bearing candidates", async () => {
    const requests: BrokerExecutionRequest[] = [];
    const { host, thread } = await openInspectableHost({
      async request(request) {
        requests.push(request);
        return { approved: true };
      },
    });
    thread.currentTurnId = "turn-rejected-memory";
    thread.currentMode = "execute";
    const tool = thread.executeTools.find(
      (candidate) => candidate.name === "save_memory",
    );
    expect(tool).toBeDefined();

    await expect(
      tool!.execute("memory-call-transient", {
        scope: "project",
        title: "Current test count",
        content: "The current run has 196 passing tests.",
        keywords: ["current", "tests"],
      }),
    ).rejects.toThrow(/reusable|workflow|transient/iu);
    await expect(
      tool!.execute("memory-call-secret", {
        scope: "global",
        title: "Provider credential",
        content:
          "Reuse Authorization: Bearer sk-test-not-a-real-secret-123456789 next time.",
        keywords: ["provider", "credential"],
      }),
    ).rejects.toThrow(/credential|secret|token/iu);

    expect(requests).toHaveLength(0);
    host.dispose();
  });
});
