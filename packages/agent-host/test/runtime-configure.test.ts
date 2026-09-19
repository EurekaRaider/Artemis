import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AgentSession,
  DefaultResourceLoader,
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
  it.each([
    ["turn", true, "continue"],
    ["turn", false, "continue"],
    ["compaction", true, "continue"],
    ["compaction", false, "continue"],
    ["turn", true, "cancel"],
    ["turn", true, "install-again"],
  ] as const)(
    "defers skills during %s (default model: %s, refresh action: %s)",
    async (busy, defaultModel, refreshAction) => {
      const workspacePath = await mkdtemp(
        join(tmpdir(), "artemis-install-active-"),
      );
      cleanupPaths.push(workspacePath);
      const agentDir = join(workspacePath, "agent");
      const host = new ArtemisAgentHost(
        { async request() {} },
        { emit() {} },
        { agentDir },
      );
      const selection = {
        providerId: "local-proxy",
        modelId: "qwen-coder",
        thinkingLevel: "off" as const,
      };
      const configuration = {
        credentials: {},
        providers: [provider("qwen-coder", "Qwen Coder")],
        ...(defaultModel ? { selection } : {}),
      };
      await host.configure(configuration);
      await host.openThread({
        threadId: "running-thread",
        workspacePath,
        target: "local",
        selection,
      });
      const hosted = (
        host as unknown as {
          threads: Map<
            string,
            {
              session: AgentSession;
              resourceLoader: DefaultResourceLoader;
              currentTurnId?: string;
              compacting: boolean;
            }
          >;
        }
      ).threads.get("running-thread")!;
      let finishTurn!: () => void;
      const prompt = vi
        .spyOn(hosted.session, "prompt")
        .mockResolvedValue(undefined);
      let running: Promise<void> | undefined;
      if (busy === "turn") {
        prompt.mockImplementationOnce(
          () => new Promise<void>((resolve) => (finishTurn = resolve)),
        );
        running = host.prompt("running-thread", "first", "Work", "execute");
        await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce());
      } else {
        hosted.compacting = true;
      }
      const reloadResources = hosted.resourceLoader.reload.bind(
        hosted.resourceLoader,
      );
      const reload = vi.spyOn(hosted.resourceLoader, "reload");
      const setModel = vi.spyOn(hosted.session, "setModel");
      const tools = hosted.session.agent.state.tools;
      const systemPrompt = hosted.session.systemPrompt;
      let releaseRefresh: (() => void) | undefined;
      let refreshing: Promise<void> | undefined;
      const installSkill = async (name: string) => {
        const skillPath = join(agentDir, "skills", name);
        await mkdir(skillPath, { recursive: true });
        await writeFile(
          join(skillPath, "SKILL.md"),
          `---\nname: ${name}\ndescription: Newly installed resource\n---\nNew skill instructions.\n`,
        );
      };
      try {
        await installSkill("new-skill");
        await host.configure(configuration);
        expect(reload).not.toHaveBeenCalled();
        expect(setModel).not.toHaveBeenCalled();
        expect(hosted.session.agent.state.tools).toBe(tools);
        expect(hosted.session.systemPrompt).toBe(systemPrompt);
        expect(
          hosted.resourceLoader.getSkills().skills.map((skill) => skill.name),
        ).not.toContain("new-skill");
        if (running) {
          expect(hosted.currentTurnId).toBe("first");
          finishTurn();
          await running;
        }
        hosted.compacting = false;
        if (refreshAction === "cancel") {
          const gate = new Promise<void>((resolve) => {
            releaseRefresh = resolve;
          });
          reload.mockImplementationOnce(async () => {
            await gate;
            await reloadResources();
          });
          refreshing = host.prompt(
            "running-thread",
            "cancelled-refresh",
            "Continue",
            "execute",
          );
          await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
          expect(hosted.currentTurnId).toBe("cancelled-refresh");
          await host.cancel("running-thread");
          releaseRefresh!();
          await refreshing;
          expect(prompt).toHaveBeenCalledOnce();
          expect(hosted.currentTurnId).toBeUndefined();
        }
        if (refreshAction === "install-again") {
          reload.mockImplementationOnce(async () => {
            await reloadResources();
            await installSkill("second-skill");
            await host.configure(configuration);
          });
        }
        await host.prompt("running-thread", "next", "Continue", "execute");
        expect(reload).toHaveBeenCalledOnce();
        expect(
          hosted.resourceLoader.getSkills().skills.map((skill) => skill.name),
        ).toContain("new-skill");
        expect(hosted.session.systemPrompt).toContain("new-skill");
        expect(hosted.session.model?.id).toBe("qwen-coder");
        if (refreshAction === "install-again") {
          expect(hosted.session.systemPrompt).not.toContain("second-skill");
          await host.prompt("running-thread", "third", "Continue", "execute");
          expect(hosted.session.systemPrompt).toContain("second-skill");
        }
      } finally {
        finishTurn?.();
        releaseRefresh?.();
        await running;
        await refreshing;
        hosted.compacting = false;
        host.dispose();
      }
    },
  );

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

  it("keeps GLM-5.3-Flash available after removing a same-id custom provider", async () => {
    const host = new ArtemisAgentHost(
      {
        async request() {
          throw new Error("model configuration must not execute tools");
        },
      },
      { emit() {} },
    );
    const customZai = provider("temporary-model", "Temporary Model");
    customZai.id = "zai";
    customZai.name = "Temporary Z.AI Proxy";
    await host.configure({
      credentials: {},
      providers: [customZai],
      selection: {
        providerId: "zai",
        modelId: "temporary-model",
        thinkingLevel: "off",
      },
    });

    await expect(
      host.configure({
        credentials: { zai: { type: "api_key", key: "test-key" } },
        selection: {
          providerId: "zai",
          modelId: "glm-5.3-flash",
          thinkingLevel: "max",
        },
      }),
    ).resolves.toBeUndefined();
    const catalog = await host.catalog();
    for (const providerId of ["zai", "zai-coding-cn"]) {
      expect(
        catalog.models.find(
          (model) =>
            model.providerId === providerId &&
            model.modelId === "glm-5.3-flash",
        ),
      ).toMatchObject({
        name: "GLM-5.3-Flash",
        reasoning: true,
        thinkingLevels: ["low", "high", "max"],
        highestThinkingLevel: "max",
        contextWindow: 1_000_000,
      });
    }
    host.dispose();
  });

  it("keeps open sessions on their own model until that thread changes it", async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), "artemis-runtime-model-"),
    );
    const secondWorkspacePath = await mkdtemp(
      join(tmpdir(), "artemis-runtime-model-b-"),
    );
    cleanupPaths.push(workspacePath, secondWorkspacePath);
    const host = new ArtemisAgentHost(
      {
        async request() {
          throw new Error("model configuration must not execute tools");
        },
      },
      { emit() {} },
    );
    const configuredProvider = provider("qwen-coder", "Qwen Coder");
    configuredProvider.models.push({
      id: "deepseek-coder",
      name: "DeepSeek Coder",
      reasoning: false,
      input: ["text"],
      contextWindow: 128_000,
      maxTokens: 32_000,
    });
    const qwenSelection = {
      providerId: "local-proxy",
      modelId: "qwen-coder",
      thinkingLevel: "off" as const,
    };
    await host.configure({
      credentials: {},
      providers: [configuredProvider],
      selection: qwenSelection,
    });
    const sessionFile = SessionManager.create(
      workspacePath,
      join(workspacePath, "sessions"),
    ).getSessionFile();
    await host.openThread({
      threadId: "model-identity-thread",
      workspacePath,
      target: "local",
      selection: qwenSelection,
      contextWindow: 128_000,
      ...(sessionFile ? { sessionFile } : {}),
    });
    const secondSessionFile = SessionManager.create(
      secondWorkspacePath,
      join(secondWorkspacePath, "sessions"),
    ).getSessionFile();
    await host.openThread({
      threadId: "second-model-thread",
      workspacePath: secondWorkspacePath,
      target: "local",
      selection: {
        providerId: "local-proxy",
        modelId: "deepseek-coder",
        thinkingLevel: "off",
      },
      contextWindow: 128_000,
      ...(secondSessionFile ? { sessionFile: secondSessionFile } : {}),
    });
    const session = (
      host as unknown as {
        threads: Map<
          string,
          { session: { model?: { id: string }; systemPrompt: string } }
        >;
      }
    ).threads.get("model-identity-thread")?.session;
    const secondSession = (
      host as unknown as {
        threads: Map<string, { session: { model?: { id: string } } }>;
      }
    ).threads.get("second-model-thread")?.session;

    expect(session?.model?.id).toBe("qwen-coder");
    expect(session?.systemPrompt).toContain(
      'model "Qwen Coder" (ID: "qwen-coder")',
    );
    expect(secondSession?.model?.id).toBe("deepseek-coder");

    await host.configure({
      credentials: {},
      providers: [configuredProvider],
      selection: {
        providerId: "local-proxy",
        modelId: "deepseek-coder",
        thinkingLevel: "off",
      },
    });

    expect(session?.model?.id).toBe("qwen-coder");
    expect(session?.systemPrompt).toContain(
      'model "Qwen Coder" (ID: "qwen-coder")',
    );
    expect(secondSession?.model?.id).toBe("deepseek-coder");

    await host.setThreadModel("second-model-thread", qwenSelection, 128_000);
    expect(session?.model?.id).toBe("qwen-coder");
    expect(secondSession?.model?.id).toBe("qwen-coder");

    await host.setThreadModel(
      "model-identity-thread",
      {
        providerId: "local-proxy",
        modelId: "deepseek-coder",
        thinkingLevel: "off",
      },
      128_000,
    );

    expect(session?.model?.id).toBe("deepseek-coder");
    expect(session?.systemPrompt).toContain(
      'model "DeepSeek Coder" (ID: "deepseek-coder")',
    );
    expect(session?.systemPrompt).not.toContain(
      'model "Qwen Coder" (ID: "qwen-coder")',
    );
    expect(secondSession?.model?.id).toBe("qwen-coder");
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

  it("reports a custom model's configured highest reasoning level", async () => {
    const host = new ArtemisAgentHost(
      {
        async request() {
          throw new Error("model configuration must not execute tools");
        },
      },
      { emit() {} },
    );
    const configuredProvider = provider(
      "reasoning-model",
      "Reasoning Model",
      true,
    );
    configuredProvider.models[0]!.highestThinkingLevel = "xhigh";

    await host.configure({ credentials: {}, providers: [configuredProvider] });

    const catalog = await host.catalog();
    expect(
      catalog.models.find(
        (model) =>
          model.providerId === "local-proxy" &&
          model.modelId === "reasoning-model",
      ),
    ).toMatchObject({
      thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh"],
      highestThinkingLevel: "xhigh",
    });
    host.dispose();
  });
});
