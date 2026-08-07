import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ArtemisAgentHost } from "../src/runtime.js";

interface InspectableTool {
  name: string;
  execute(
    toolCallId: string,
    parameters: Record<string, unknown>,
  ): Promise<{ details?: Record<string, unknown> }>;
}

interface InspectableThread {
  currentTurnId?: string;
  currentMode?: "execute";
  executeTools: InspectableTool[];
  session: {
    abort(): Promise<void>;
    prompt(text: string): Promise<void>;
  };
  team?: { teamId: string };
}

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("sub-agent control tools", () => {
  it("starts delegation asynchronously and exposes status and intervention tools", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "artemis-subagent-"));
    cleanupPaths.push(workspace);
    const host = new ArtemisAgentHost(
      {
        async request() {
          throw new Error("Unexpected broker request");
        },
      },
      { emit() {} },
    );
    await host.openThread({
      threadId: "thread-1",
      workspacePath: workspace,
      target: "local",
    });
    const internals = host as unknown as {
      threads: Map<string, InspectableThread>;
      concurrency: {
        run<T>(kind: "child", task: () => Promise<T>): Promise<T>;
      };
    };
    const thread = internals.threads.get("thread-1")!;
    thread.currentTurnId = "turn-1";
    thread.currentMode = "execute";
    internals.concurrency = {
      run: <T>() => new Promise<T>(() => undefined),
    };

    const names = thread.executeTools.map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "spawn_agent",
        "list_agents",
        "wait_team",
        "send_message",
        "set_agent_write_scope",
        "finish_team",
        "wait_agent",
        "get_agent_status",
        "steer_agent",
        "cancel_agent",
        "retry_agent",
      ]),
    );
    const spawn = thread.executeTools.find(
      (tool) => tool.name === "spawn_agent",
    )!;
    const result = await spawn.execute("spawn-1", {
      label: "Inspect build",
      role: "Build reviewer",
      task: "Inspect the build without changing files.",
      write_paths: ["packages/agent-host"],
    });

    expect(result.details).toMatchObject({
      label: "Inspect build",
      role: "Build reviewer",
      writePaths: ["packages/agent-host"],
      required: true,
      status: "queued",
      health: "healthy",
    });
    expect(result.details?.agentId).toEqual(expect.any(String));
    const agentId = String(result.details?.agentId);

    const listAgents = thread.executeTools.find(
      (tool) => tool.name === "list_agents",
    )!;
    const team = await listAgents.execute("list-1", {});
    expect(team.details).toMatchObject({
      team: {
        status: "running",
        memberAgentIds: [agentId],
        maxMembers: 4,
      },
    });

    const sendMessage = thread.executeTools.find(
      (tool) => tool.name === "send_message",
    )!;
    await expect(
      sendMessage.execute("message-1", {
        recipient: agentId,
        kind: "request",
        message: "Report the build entry points first.",
      }),
    ).resolves.toMatchObject({
      details: {
        fromAgentId: "parent",
        kind: "request",
      },
    });

    await expect(
      spawn.execute("spawn-2", {
        label: "Overlapping writer",
        task: "Inspect the runtime.",
        write_paths: ["packages/agent-host/src"],
      }),
    ).rejects.toThrow("overlaps");

    const dependent = await spawn.execute("spawn-3", {
      label: "Protocol reviewer",
      task: "Review the protocol after the build entry points are known.",
      depends_on_agent_ids: [agentId],
      write_paths: ["packages/protocol"],
    });
    expect(dependent.details).toMatchObject({
      coordinationStatus: "waiting-dependency",
      dependsOnAgentIds: [agentId],
    });
    await spawn.execute("spawn-4", {
      label: "Desktop reviewer",
      task: "Review the desktop workbench.",
      write_paths: ["apps/desktop"],
    });
    await spawn.execute("spawn-5", {
      label: "Documentation reviewer",
      task: "Review documentation impact.",
      required: false,
      write_paths: ["README.md"],
    });
    await expect(
      spawn.execute("spawn-6", {
        label: "Extra reviewer",
        task: "This member exceeds the team budget.",
      }),
    ).rejects.toThrow("at most 4 members");

    const finish = thread.executeTools.find(
      (tool) => tool.name === "finish_team",
    )!;
    await expect(
      finish.execute("finish-1", { summary: "Integrated." }),
    ).rejects.toThrow("still running");

    host.dispose();
  });

  it("aborts a cancelled parent team without a failure and permits a fresh continuation team", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "artemis-team-cancel-"));
    cleanupPaths.push(workspace);
    const payloads: unknown[] = [];
    const host = new ArtemisAgentHost(
      {
        async request() {
          throw new Error("Unexpected broker request");
        },
      },
      {
        emit(_threadId, _turnId, payload) {
          payloads.push(payload);
        },
      },
    );
    await host.openThread({
      threadId: "thread-cancel",
      workspacePath: workspace,
      target: "local",
    });
    const internals = host as unknown as {
      threads: Map<string, InspectableThread>;
      concurrency: {
        run<T>(kind: "parent" | "child", task: () => Promise<T>): Promise<T>;
      };
    };
    const thread = internals.threads.get("thread-cancel")!;
    internals.concurrency = {
      run: <T>(kind: "parent" | "child", task: () => Promise<T>) =>
        kind === "parent" ? task() : new Promise<T>(() => undefined),
    };

    const prompts: string[] = [];
    let releasePrompt = () => undefined;
    const preparePrompt = () => {
      let markStarted = () => undefined;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      thread.session.prompt = async (text: string) => {
        prompts.push(text);
        markStarted();
        await new Promise<void>((resolve) => {
          releasePrompt = resolve;
        });
      };
      return started;
    };
    thread.session.abort = async () => releasePrompt();

    const firstStarted = preparePrompt();
    const firstPrompt = host.prompt(
      "thread-cancel",
      "turn-1",
      "Run a team review.",
      "execute",
    );
    await firstStarted;
    const spawn = thread.executeTools.find(
      (tool) => tool.name === "spawn_agent",
    )!;
    const firstChild = await spawn.execute("spawn-1", {
      label: "Protocol reviewer",
      role: "Protocol reviewer",
      task: "Continue reviewing the protocol layer.",
    });
    const firstTeamId = thread.team?.teamId;

    await host.cancel("thread-cancel");
    await firstPrompt;

    expect(payloads).toContainEqual(
      expect.objectContaining({ type: "agent-team.status", status: "aborted" }),
    );
    expect(payloads).not.toContainEqual(
      expect.objectContaining({
        type: "turn.failed",
        code: "agent-team-incomplete",
      }),
    );

    const secondStarted = preparePrompt();
    const secondPrompt = host.prompt(
      "thread-cancel",
      "turn-2",
      "Continue the interrupted team work.",
      "execute",
    );
    await secondStarted;

    expect(prompts.at(-1)).toContain(
      "Previous interrupted agent-team context:",
    );
    expect(prompts.at(-1)).toContain("Continue reviewing the protocol layer.");
    const replacement = await spawn.execute("spawn-2", {
      label: "Protocol reviewer continuation",
      role: "Protocol reviewer",
      task: "Continue the interrupted protocol review.",
    });
    expect(replacement.details?.agentId).not.toBe(firstChild.details?.agentId);
    expect(thread.team?.teamId).not.toBe(firstTeamId);

    await host.cancel("thread-cancel");
    await secondPrompt;
    host.dispose();
  });
});
