import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect } from "vitest";
import { ArtemisAgentHost } from "../src/runtime.js";
import type { BrokerExecutionRequest } from "@artemis/protocol";
import { createRemoteChildTools } from "../src/remote-tools.js";

describe("remote Pi tool boundary", () => {
  it("enforces a child's current write scope before contacting the broker", async () => {
    const calls: unknown[] = [];
    const tools = createRemoteChildTools(
      async (operation) => {
        calls.push(operation);
        return "ok";
      },
      (path) => path.startsWith("assigned/"),
    );
    expect(tools.map((t) => t.name)).toEqual(["remote_read", "remote_write"]);
    const write = tools.find((t) => t.name === "remote_write")!;
    await expect(
      write.execute("denied", {
        path: "other/file.txt",
        content: "bad",
      } as never),
    ).rejects.toThrow("write scope");
    expect(calls).toEqual([]);
    await write.execute("allowed", {
      path: "assigned/file.txt",
      content: "ok",
    } as never);
    expect(calls).toEqual([
      { action: "write", path: "assigned/file.txt", content: "ok" },
    ]);
  });
  it("routes actual remote tools through the host and excludes full-user, MCP and extension tools in every mode", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "artemis-im-host-"));
    const calls: BrokerExecutionRequest[] = [];
    const host = new ArtemisAgentHost(
      {
        async request(request) {
          calls.push(request);
          return { approved: true, data: "scoped" };
        },
      },
      { emit() {} },
    );
    try {
      await host.openThread({
        threadId: "remote",
        workspacePath: workspace,
        target: "local",
        remoteExecution: { network: false, shell: true },
      });
      const thread = (
        host as unknown as {
          threads: Map<
            string,
            {
              currentTurnId?: string;
              currentMode?: string;
              executeTools: Array<{
                name: string;
                execute(id: string, p: unknown): Promise<unknown>;
              }>;
              delegatedTools: Array<{ name: string }>;
            }
          >;
        }
      ).threads.get("remote")!;
      expect(thread.executeTools.map((t) => t.name)).toContain("remote_shell");
      expect(thread.executeTools.map((t) => t.name)).toContain("collaborate");
      for (const name of [
        "shell",
        "shell_wait",
        "local_file_read",
        "local_file_write",
        "save_memory",
        "office_document",
        "load_workspace_dependencies",
        "web_search",
        "read",
        "write",
      ]) {
        expect(thread.executeTools.map((t) => t.name)).not.toContain(name);
        expect(thread.delegatedTools.map((t) => t.name)).not.toContain(name);
      }
      expect(thread.delegatedTools.map((t) => t.name)).toContain("remote_read");
      expect(thread.delegatedTools.map((t) => t.name)).not.toContain(
        "remote_write",
      );
      expect(thread.delegatedTools.map((t) => t.name)).not.toContain(
        "collaborate",
      );
      thread.currentTurnId = "turn";
      thread.currentMode = "execute";
      await thread.executeTools
        .find((t) => t.name === "remote_shell")!
        .execute("operation", { command: "pwd", timeoutSeconds: 5 });
      expect(calls).toMatchObject([
        {
          kind: "remote.operation",
          threadId: "remote",
          operation: { action: "shell", command: "pwd" },
        },
      ]);
    } finally {
      host.dispose();
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
