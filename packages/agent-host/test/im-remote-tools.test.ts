import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect } from "vitest";
import { ArtemisAgentHost } from "../src/runtime.js";
import type { BrokerExecutionRequest } from "@artemis/protocol";
import {
  createRemoteChildTools,
  createRemoteTools,
  isRemoteToolAllowed,
} from "../src/remote-tools.js";

describe("remote Pi tool boundary", () => {
  it("exposes only read-only IM discovery in Plan and Review", async () => {
    const calls: unknown[] = [];
    const tool = createRemoteTools(async (operation) => {
      calls.push(operation);
      return { complete: false, members: [] };
    }).find((t) => t.name === "im_participants");
    expect(tool).toBeDefined();
    for (const mode of ["plan", "review", "execute"] as const)
      expect(isRemoteToolAllowed("im_participants", mode, false)).toBe(true);
    for (const mode of ["plan", "review"] as const)
      expect(isRemoteToolAllowed("collaborate", mode, false)).toBe(false);
    await tool!.execute("discover", {} as never);
    expect(calls).toEqual([{ action: "participants" }]);
  });
  it("rejects the screenshot's malformed calls before dispatch and accepts a corrected delegate", async () => {
    const calls: unknown[] = [];
    const tool = createRemoteTools(async (operation) => {
      calls.push(operation);
      return [{ id: "task" }];
    }).find((t) => t.name === "collaborate")!;
    await expect(
      tool.execute("bad-delegate", {
        action: "delegate",
        assignments: [{ participantId: "solar", text: "Memory?" }],
      } as never),
    ).rejects.toThrow("delegate-many");
    await expect(
      tool.execute("bad-message", {
        action: "message",
        participantId: "solar",
        text: "Memory?",
      } as never),
    ).rejects.toThrow("taskId");
    expect(calls).toEqual([]);
    await tool.execute("corrected", {
      action: "delegate",
      participantId: "solar",
      text: "Memory?",
    } as never);
    expect(calls).toEqual([
      {
        action: "collaborate",
        command: {
          action: "delegate",
          participantId: "solar",
          text: "Memory?",
        },
      },
    ]);
  });
  it("requires the same restricted tool boundary for desktop group sessions", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "artemis-local-group-"));
    const calls: BrokerExecutionRequest[] = [];
    const host = new ArtemisAgentHost(
      {
        async request(request) {
          calls.push(request);
          return { approved: true, data: [] };
        },
      },
      { emit() {} },
    );
    try {
      await host.openThread({
        threadId: "local-group",
        workspacePath: workspace,
        target: "local",
        groupCollaboration: true,
        remoteExecution: {
          network: false,
          shell: false,
          security: {
            version: 2,
            projectId: "p",
            revision: "r",
            audience: "space:team",
            identityKey: "owner",
            source: "desktop",
            messageId: "m",
          },
        },
      });
      await host.openThread({
        threadId: "ordinary",
        workspacePath: workspace,
        target: "local",
      });
      const threads = (
        host as unknown as {
          threads: Map<
            string,
            {
              currentTurnId?: string;
              currentMode?: string;
              executeTools: Array<{
                name: string;
                execute(id: string, args: unknown): Promise<unknown>;
              }>;
              delegatedTools: Array<{ name: string }>;
            }
          >;
        }
      ).threads;
      const group = threads.get("local-group")!;
      expect(group.executeTools.map((t) => t.name)).toContain("collaborate");
      expect(group.delegatedTools.map((t) => t.name)).toContain(
        "im_participants",
      );
      expect(group.executeTools.map((t) => t.name)).toContain("remote_write");
      expect(group.delegatedTools.map((t) => t.name)).not.toContain(
        "collaborate",
      );
      expect(
        threads.get("ordinary")!.executeTools.map((t) => t.name),
      ).not.toContain("collaborate");
      group.currentTurnId = "desktop-turn";
      group.currentMode = "execute";
      await group.executeTools
        .find((t) => t.name === "collaborate")!
        .execute("list", { action: "participants" });
      expect(calls[0]).toMatchObject({
        threadId: "local-group",
        turnId: "desktop-turn",
        operation: { action: "collaborate" },
      });
    } finally {
      host.dispose();
      await rm(workspace, { recursive: true, force: true });
    }
  });
  it("exposes one structured batch for different group member assignments", async () => {
    const calls: unknown[] = [];
    const tool = createRemoteTools(async (operation) => {
      calls.push(operation);
      return "queued";
    }).find((t) => t.name === "collaborate")!;
    const assignments = [
      { participantId: "bob", text: "Check API" },
      { participantId: "carol", text: "Check UI" },
    ];
    await tool.execute("batch", {
      action: "delegate-many",
      assignments,
    } as never);
    expect(calls).toEqual([
      {
        action: "collaborate",
        command: { action: "delegate-many", assignments, text: "" },
      },
    ]);
  });
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
