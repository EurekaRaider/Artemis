import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ArtemisAgentHost } from "../src/runtime.js";
import type { BrokerExecutionRequest } from "@artemis/protocol";

interface InspectableTool {
  name: string;
  execute(
    toolCallId: string,
    parameters: Record<string, unknown>,
  ): Promise<{ content: Array<{ type: string; text: string }> }>;
}

interface InspectableThread {
  executeTools: InspectableTool[];
  delegatedTools: InspectableTool[];
  currentTurnId?: string;
}

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function openInspectableHost(): Promise<{
  host: ArtemisAgentHost;
  thread: InspectableThread;
  requests: BrokerExecutionRequest[];
}> {
  const workspace = await mkdtemp(join(tmpdir(), "artemis-bash-tool-"));
  cleanupPaths.push(workspace);
  const requests: BrokerExecutionRequest[] = [];
  const host = new ArtemisAgentHost(
    {
      async request(request) {
        requests.push(request);
        return { approved: true };
      },
    },
    { emit() {} },
  );
  await host.openThread({
    threadId: "bash-thread",
    workspacePath: workspace,
    target: "local",
  });
  const thread = (
    host as unknown as { threads: Map<string, InspectableThread> }
  ).threads.get("bash-thread");
  expect(thread).toBeDefined();
  return { host, thread: thread!, requests };
}

function toolNames(tools: InspectableTool[]): string[] {
  return tools.map((tool) => tool.name);
}

describe("observed shell tools", () => {
  it("are available with full local execution in Execute only", async () => {
    const { host, thread, requests } = await openInspectableHost();

    expect(toolNames(thread.executeTools)).toEqual(
      expect.arrayContaining(["shell", "shell_wait", "shell_cancel"]),
    );
    expect(toolNames(thread.delegatedTools)).not.toContain("shell");

    const shell = thread.executeTools.find((tool) => tool.name === "shell");
    expect(shell).toBeDefined();
    thread.currentTurnId = "bash-turn";
    const result = await shell!.execute("bash-call", {
      command: "printf 'pi bash ready'",
      deadline_seconds: 10,
      model_approval: {
        risk: "low",
        explicit_user_request: false,
        reason: "A read-only, task-scoped probe.",
      },
    });
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({
      status: "completed",
      outputDelta: "pi bash ready",
      observationExpired: false,
      shell: {
        shell: { kind: expect.any(String), executable: expect.any(String) },
        profileMode: "environment",
      },
    });
    expect(requests).toMatchObject([
      {
        kind: "shell.execute",
        command: "printf 'pi bash ready'",
        modelApproval: {
          risk: "low",
          explicitUserRequest: false,
          reason: "A read-only, task-scoped probe.",
        },
      },
    ]);

    host.dispose();
  });
});
