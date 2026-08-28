import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionManager } from "@earendil-works/pi-coding-agent";

import {
  ArtemisAgentHost,
  providerRetryDelayMilliseconds,
} from "../src/runtime.js";

interface InspectableTool {
  name: string;
  execute(
    toolCallId: string,
    parameters: Record<string, unknown>,
  ): Promise<{ details?: Record<string, unknown> }>;
}

interface InspectableThread {
  currentTurnId?: string;
  currentMode?: "execute" | "plan" | "review";
  childAgents: Map<string, { status: string }>;
  executeTools: InspectableTool[];
  resourceLoader: {
    getAppendSystemPrompt(): string[];
    reload(): Promise<void>;
  };
  session: {
    agent: { state: { tools: InspectableTool[] } };
    abort(): Promise<void>;
    getActiveToolNames(): string[];
    prompt(text: string): Promise<void>;
    sendCustomMessage(
      message: {
        customType: string;
        content: string;
        display: boolean;
        details?: unknown;
      },
      options?: { deliverAs?: "steer" | "followUp" | "nextTurn" },
    ): Promise<void>;
    steer(text: string): Promise<void>;
  };
  team?: { teamId: string };
}

const cleanupPaths: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    cleanupPaths
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("sub-agent control tools", () => {
  it("separates long-running work from a genuinely silent agent", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-29T00:00:00.000Z"));
    const host = new ArtemisAgentHost(
      { request: async () => ({ approved: false }) },
      { emit() {} },
    );
    const childHealth = (
      child: Record<string, unknown>,
    ): "healthy" | "suspect" | "stalled" =>
      (
        host as unknown as {
          childHealth(
            value: Record<string, unknown>,
          ): "healthy" | "suspect" | "stalled";
        }
      ).childHealth(child);
    const now = Date.now();
    const child = {
      status: "running",
      lastActivityAt: now - 61_000,
      longestObservationMilliseconds: 5_000,
    };

    expect(childHealth(child)).toBe("suspect");
    expect(
      childHealth({
        ...child,
        lastActivityAt: now - 6 * 60_000,
      }),
    ).toBe("stalled");
    expect(
      childHealth({
        ...child,
        currentTool: "shell_wait",
        lastActivityAt: now - 60 * 60_000,
      }),
    ).toBe("suspect");
    expect(
      childHealth({
        ...child,
        status: "queued",
        lastActivityAt: now - 60 * 60_000,
      }),
    ).toBe("healthy");

    host.dispose();
  });

  it("delivers team handoffs as hidden internal messages", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "artemis-team-handoff-"));
    cleanupPaths.push(workspace);
    const host = new ArtemisAgentHost(
      { request: async () => ({ approved: false }) },
      { emit() {} },
    );
    await host.openThread({
      threadId: "thread-handoff",
      workspacePath: workspace,
      target: "local",
    });
    const internals = host as unknown as {
      threads: Map<string, InspectableThread>;
      concurrency: {
        run<T>(kind: "child", task: () => Promise<T>): Promise<T>;
      };
    };
    const thread = internals.threads.get("thread-handoff")!;
    thread.currentTurnId = "turn-1";
    thread.currentMode = "execute";
    internals.concurrency = {
      run: <T>() => new Promise<T>(() => undefined),
    };
    const spawn = thread.executeTools.find(
      (tool) => tool.name === "spawn_agent",
    )!;
    const child = await spawn.execute("spawn-1", {
      label: "Reviewer",
      role: "Reviewer",
      task: "Review the result.",
    });
    const delivered: Array<{ message: unknown; options: unknown }> = [];
    thread.session.sendCustomMessage = async (message, options) => {
      delivered.push({ message, options });
    };
    thread.session.steer = async () => {
      throw new Error("Internal handoffs must not use user steering.");
    };

    await host.sendAgentTeamMessage(
      "thread-handoff",
      String(child.details?.agentId),
      "parent",
      "handoff",
      "Internal result.",
    );
    thread.childAgents.get(String(child.details?.agentId))!.status =
      "cancelled";
    await host.cancelChildAgent(
      "thread-handoff",
      String(child.details?.agentId),
      true,
    );
    host.retryChildAgent(
      "thread-handoff",
      String(child.details?.agentId),
      true,
    );

    expect(delivered).toHaveLength(3);
    expect(delivered[0]).toEqual({
      message: expect.objectContaining({
        customType: "artemis-agent-team",
        content: expect.stringContaining("[agent-team handoff]"),
        display: false,
      }),
      options: { deliverAs: "steer" },
    });
    expect(delivered.slice(1)).toEqual(
      expect.arrayContaining([
        {
          message: expect.objectContaining({
            customType: "artemis-agent-control",
            content: expect.stringContaining("was stopped by the user"),
            display: false,
          }),
          options: { deliverAs: "steer" },
        },
        {
          message: expect.objectContaining({
            customType: "artemis-agent-control",
            content: expect.stringContaining("The user retried sub-agent"),
            display: false,
          }),
          options: { deliverAs: "steer" },
        },
      ]),
    );
    host.dispose();
  });

  it("honors explicit Provider rate-limit backoff without inventing retries", () => {
    expect(
      providerRetryDelayMilliseconds(
        Object.assign(new Error("429 rate limit"), { retryAfter: 3 }),
      ),
    ).toBe(3_000);
    expect(
      providerRetryDelayMilliseconds(new Error("Retry-After: 1.5 seconds")),
    ).toBe(1_500);
    expect(
      providerRetryDelayMilliseconds(new Error("Connection reset")),
    ).toBeUndefined();
  });

  it("keeps Ultra coordination stable in the system prompt without relaxing read-only tools", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "artemis-ultra-team-"));
    cleanupPaths.push(workspace);
    const host = new ArtemisAgentHost(
      {
        async request() {
          throw new Error("Unexpected broker request");
        },
      },
      { emit() {} },
    );
    const sessionFile = SessionManager.create(
      workspace,
      join(workspace, "sessions"),
    ).getSessionFile();
    await host.openThread({
      threadId: "thread-ultra",
      workspacePath: workspace,
      target: "local",
      ...(sessionFile ? { sessionFile } : {}),
    });
    const internals = host as unknown as {
      configuration: {
        credentials: Record<string, never>;
        selection: {
          providerId: string;
          modelId: string;
          thinkingLevel: "max";
          ultraMode?: boolean;
        };
      };
      threads: Map<string, InspectableThread>;
      concurrency: {
        run<T>(kind: "parent" | "child", task: () => Promise<T>): Promise<T>;
      };
    };
    internals.configuration = {
      credentials: {},
      selection: {
        providerId: "test",
        modelId: "reasoning-model",
        thinkingLevel: "max",
        ultraMode: true,
      },
    };
    internals.concurrency = {
      run: <T>(_kind: "parent" | "child", task: () => Promise<T>) => task(),
    };
    const thread = internals.threads.get("thread-ultra")!;
    await thread.resourceLoader.reload();
    const ultraSystemPrompt = thread.resourceLoader
      .getAppendSystemPrompt()
      .join("\n");
    expect(ultraSystemPrompt).toContain("## Agent-team coordination");
    expect(ultraSystemPrompt).toContain("In Ultra Mode");
    expect(ultraSystemPrompt).toContain(
      "proactively start three to five complementary direct children",
    );
    expect(
      ultraSystemPrompt.match(/## Agent-team coordination/gu),
    ).toHaveLength(1);
    const prompts: string[] = [];
    thread.session.prompt = async (text: string) => {
      prompts.push(text);
    };

    for (const mode of ["execute", "plan", "review"] as const) {
      await host.prompt(
        "thread-ultra",
        `turn-${mode}`,
        "Handle a complex cross-subsystem task.",
        mode,
      );
      expect(prompts.at(-1)).not.toContain("Agent-team coordination");
      expect(prompts.at(-1)).not.toContain(
        "proactively start three to five complementary direct children",
      );
      if (mode !== "execute") {
        const activeTools = thread.session.agent.state.tools.map(
          (tool) => tool.name,
        );
        expect(activeTools).not.toEqual(
          expect.arrayContaining(["shell", "write", "office_document"]),
        );
      }
    }

    delete internals.configuration.selection.ultraMode;
    await thread.resourceLoader.reload();
    await host.prompt(
      "thread-ultra",
      "turn-standard",
      "Handle a normal task.",
      "execute",
    );
    const standardSystemPrompt = thread.resourceLoader
      .getAppendSystemPrompt()
      .join("\n");
    expect(standardSystemPrompt).toContain(
      "Delegate only when parallel work materially helps.",
    );
    expect(standardSystemPrompt).not.toContain("In Ultra Mode");
    expect(prompts.at(-1)).not.toContain("Agent-team coordination");
    host.dispose();
  });

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
    const sessionFile = SessionManager.create(
      workspace,
      join(workspace, "sessions"),
    ).getSessionFile();
    await host.openThread({
      threadId: "thread-1",
      workspacePath: workspace,
      target: "local",
      ...(sessionFile ? { sessionFile } : {}),
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
        maxMembers: 64,
        maxDepth: 5,
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
    for (let index = 5; index <= 8; index += 1) {
      await spawn.execute(`spawn-${index}`, {
        label: `Extra reviewer ${index}`,
        task: "Inspect another independent area.",
        required: false,
      });
    }
    await expect(
      spawn.execute("spawn-9", {
        label: "Ninth direct reviewer",
        task: "This member exceeds the direct-child budget.",
      }),
    ).rejects.toThrow("at most 8 direct children");

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
    const sessionFile = SessionManager.create(
      workspace,
      join(workspace, "sessions"),
    ).getSessionFile();
    await host.openThread({
      threadId: "thread-cancel",
      workspacePath: workspace,
      target: "local",
      ...(sessionFile ? { sessionFile } : {}),
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

    const unrelatedStarted = preparePrompt();
    const unrelatedPrompt = host.prompt(
      "thread-cancel",
      "turn-2",
      "Explain how the continue keyword affects loop ordering.",
      "execute",
    );
    await unrelatedStarted;
    expect(prompts.at(-1)).not.toContain(
      "Previous interrupted agent-team context:",
    );
    releasePrompt();
    await unrelatedPrompt;

    const secondStarted = preparePrompt();
    const secondPrompt = host.prompt(
      "thread-cancel",
      "turn-3",
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
