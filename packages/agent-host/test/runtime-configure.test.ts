import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AgentSession,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { ProviderConnection } from "@artemis/protocol";

import { ArtemisAgentHost } from "../src/runtime.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    cleanupPaths
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

function provider(
  modelId: string,
  modelName: string,
  reasoning = false,
): ProviderConnection {
  return {
    id: "local-proxy",
    name: "Local Proxy",
    baseUrl: "http://127.0.0.1:11434/v1",
    models: [
      {
        id: modelId,
        name: modelName,
        reasoning,
        input: ["text"],
        contextWindow: 128_000,
        maxTokens: 32_000,
      },
    ],
  };
}

describe("agent runtime configuration", () => {
  it("does not initialize the model runtime for an empty default configuration", async () => {
    const createModelRuntime = vi
      .spyOn(ModelRuntime, "create")
      .mockRejectedValue(new Error("model runtime should stay lazy"));
    const host = new ArtemisAgentHost(
      {
        async request() {
          throw new Error("configure should not use the execution broker");
        },
      },
      { emit() {} },
    );

    await expect
      .soft(host.configure({ credentials: {} }))
      .resolves.toBeUndefined();
    expect.soft(createModelRuntime).not.toHaveBeenCalled();
  });

  it("refreshes an open session's backend identity when its model changes", async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), "artemis-runtime-model-"),
    );
    cleanupPaths.push(workspacePath);
    const host = new ArtemisAgentHost(
      {
        async request() {
          throw new Error("model configuration must not execute tools");
        },
      },
      { emit() {} },
    );
    await host.configure({
      credentials: {},
      providers: [provider("qwen-coder", "Qwen Coder")],
      selection: {
        providerId: "local-proxy",
        modelId: "qwen-coder",
        thinkingLevel: "off",
      },
    });
    const sessionFile = SessionManager.create(
      workspacePath,
      join(workspacePath, "sessions"),
    ).getSessionFile();
    await host.openThread({
      threadId: "model-identity-thread",
      workspacePath,
      target: "local",
      ...(sessionFile ? { sessionFile } : {}),
    });
    const session = (
      host as unknown as {
        threads: Map<
          string,
          { session: { model?: { id: string }; systemPrompt: string } }
        >;
      }
    ).threads.get("model-identity-thread")?.session;

    expect(session?.model?.id).toBe("qwen-coder");
    expect(session?.systemPrompt).toContain(
      'model "Qwen Coder" (ID: "qwen-coder")',
    );

    await host.configure({
      credentials: {},
      providers: [provider("deepseek-coder", "DeepSeek Coder")],
      selection: {
        providerId: "local-proxy",
        modelId: "deepseek-coder",
        thinkingLevel: "off",
      },
    });

    expect(session?.model?.id).toBe("deepseek-coder");
    expect(session?.systemPrompt).toContain(
      'model "DeepSeek Coder" (ID: "deepseek-coder")',
    );
    expect(session?.systemPrompt).not.toContain(
      'model "Qwen Coder" (ID: "qwen-coder")',
    );
    host.dispose();
  });

  it("normalizes Ultra Mode to Max for new and already-open parent sessions", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "artemis-ultra-model-"));
    cleanupPaths.push(workspacePath);
    const host = new ArtemisAgentHost(
      {
        async request() {
          throw new Error("model configuration must not execute tools");
        },
      },
      { emit() {} },
    );
    const ultraSelection = {
      providerId: "openai",
      modelId: "gpt-5.6-sol",
      thinkingLevel: "low" as const,
      ultraMode: true,
    };
    await host.configure({
      credentials: { openai: { type: "api_key", key: "test-key" } },
      selection: ultraSelection,
    });
    const sessionFile = SessionManager.create(
      workspacePath,
      join(workspacePath, "sessions"),
    ).getSessionFile();
    await host.openThread({
      threadId: "ultra-model-thread",
      workspacePath,
      target: "local",
      ...(sessionFile ? { sessionFile } : {}),
    });
    const session = (
      host as unknown as {
        threads: Map<string, { session: { thinkingLevel: string } }>;
      }
    ).threads.get("ultra-model-thread")?.session;

    expect(session?.thinkingLevel).toBe("max");
    await expect(host.catalog()).resolves.toMatchObject({
      selection: { thinkingLevel: "max", ultraMode: true },
    });

    await host.configure({
      credentials: { openai: { type: "api_key", key: "test-key" } },
      selection: ultraSelection,
    });
    expect(session?.thinkingLevel).toBe("max");
    host.dispose();
  });

  it("uses the highest supported level when an Ultra model has no Max mapping", async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), "artemis-ultra-fallback-"),
    );
    cleanupPaths.push(workspacePath);
    const host = new ArtemisAgentHost(
      {
        async request() {
          throw new Error("model configuration must not execute tools");
        },
      },
      { emit() {} },
    );

    await host.configure({
      credentials: {},
      providers: [provider("reasoning-model", "Reasoning Model", true)],
      selection: {
        providerId: "local-proxy",
        modelId: "reasoning-model",
        thinkingLevel: "low",
        ultraMode: true,
      },
    });
    const sessionFile = SessionManager.create(
      workspacePath,
      join(workspacePath, "sessions"),
    ).getSessionFile();
    await host.openThread({
      threadId: "ultra-fallback-thread",
      workspacePath,
      target: "local",
      ...(sessionFile ? { sessionFile } : {}),
    });
    const session = (
      host as unknown as {
        threads: Map<string, { session: { thinkingLevel: string } }>;
      }
    ).threads.get("ultra-fallback-thread")?.session;

    expect(session?.thinkingLevel).toBe("high");
    await expect(host.catalog()).resolves.toMatchObject({
      selection: { thinkingLevel: "high", ultraMode: true },
    });

    const originalSessionCreate = SessionManager.create.bind(SessionManager);
    vi.spyOn(SessionManager, "create").mockImplementation(
      (cwd, sessionDir, options) =>
        originalSessionCreate(
          cwd,
          sessionDir ?? join(workspacePath, "child-sessions"),
          options,
        ),
    );
    const childThinkingLevels: string[] = [];
    vi.spyOn(AgentSession.prototype, "prompt").mockImplementation(
      async function () {
        childThinkingLevels.push(this.thinkingLevel);
      },
    );
    const internals = host as unknown as {
      threads: Map<
        string,
        {
          currentTurnId?: string;
          currentMode?: "execute";
          executeTools: Array<{
            name: string;
            execute(
              toolCallId: string,
              parameters: Record<string, unknown>,
            ): Promise<unknown>;
          }>;
        }
      >;
      concurrency: {
        run<T>(kind: "parent" | "child", task: () => Promise<T>): Promise<T>;
      };
    };
    const thread = internals.threads.get("ultra-fallback-thread")!;
    thread.currentTurnId = "turn-ultra-child";
    thread.currentMode = "execute";
    internals.concurrency = {
      run: <T>(_kind: "parent" | "child", task: () => Promise<T>) => task(),
    };
    const spawn = thread.executeTools.find(
      (tool) => tool.name === "spawn_agent",
    )!;
    await spawn.execute("spawn-ultra-child", {
      label: "Ultra child",
      task: "Inspect one bounded area.",
    });
    await vi.waitFor(() => {
      expect(childThinkingLevels).toContain("high");
    });
    host.dispose();
  });
});
