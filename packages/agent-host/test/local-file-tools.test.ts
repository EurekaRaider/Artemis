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
  currentTurnId?: string;
  currentMode?: "execute" | "plan" | "review";
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

describe("local file tools", () => {
  it("brokers explicit absolute-path reads and writes in Execute only", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "artemis-local-tools-"));
    cleanupPaths.push(workspace);
    const requests: BrokerExecutionRequest[] = [];
    const host = new ArtemisAgentHost(
      {
        async request(request) {
          requests.push(request);
          return request.kind === "local.file.read"
            ? { approved: true, data: { content: "outside" } }
            : { approved: true, data: { operation: "create" } };
        },
      },
      { emit() {} },
    );
    await host.openThread({
      threadId: "local-file-thread",
      workspacePath: workspace,
      target: "local",
    });
    const thread = (
      host as unknown as { threads: Map<string, InspectableThread> }
    ).threads.get("local-file-thread");
    expect(thread).toBeDefined();
    expect(thread!.executeTools.map(({ name }) => name)).toEqual(
      expect.arrayContaining(["local_file_read", "local_file_write"]),
    );
    expect(thread!.delegatedTools.map(({ name }) => name)).not.toEqual(
      expect.arrayContaining(["local_file_read", "local_file_write"]),
    );

    thread!.currentTurnId = "local-file-turn";
    thread!.currentMode = "execute";
    const modelApproval = {
      risk: "high",
      explicit_user_request: true,
      reason: "The user explicitly requested this exact absolute path.",
    };
    const readTool = thread!.executeTools.find(
      ({ name }) => name === "local_file_read",
    );
    const writeTool = thread!.executeTools.find(
      ({ name }) => name === "local_file_write",
    );

    await expect(
      readTool!.execute("read-local", {
        path: join(workspace, "..", "outside.txt"),
        model_approval: modelApproval,
      }),
    ).resolves.toMatchObject({ content: [{ text: "outside" }] });
    await expect(
      writeTool!.execute("write-local", {
        path: join(workspace, "..", "outside.txt"),
        content: "changed",
        model_approval: modelApproval,
      }),
    ).resolves.toMatchObject({
      content: [{ text: expect.stringContaining("outside.txt") }],
    });

    expect(requests).toMatchObject([
      {
        kind: "local.file.read",
        mode: "execute",
        modelApproval: {
          risk: "high",
          explicitUserRequest: true,
        },
      },
      {
        kind: "local.file.write",
        mode: "execute",
        content: "changed",
        modelApproval: {
          risk: "high",
          explicitUserRequest: true,
        },
      },
    ]);
    host.dispose();
  });
});
