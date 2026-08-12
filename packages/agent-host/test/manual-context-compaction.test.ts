import { describe, expect, it, vi } from "vitest";
import { formatSkillsForPrompt } from "@earendil-works/pi-coding-agent";

import { ArtemisAgentHost } from "../src/runtime.js";

describe("manual context compaction", () => {
  it("compacts the open idle Pi session with optional summary instructions", async () => {
    const compact = vi.fn().mockResolvedValue({});
    const host = new ArtemisAgentHost(
      {
        async request() {
          throw new Error("compaction must not execute tools");
        },
      },
      { emit() {} },
    );
    const threads = (
      host as unknown as {
        threads: Map<
          string,
          {
            compacting: boolean;
            currentTurnId: string | undefined;
            session: { compact: typeof compact };
          }
        >;
      }
    ).threads;
    threads.set("thread-1", {
      compacting: false,
      currentTurnId: undefined,
      session: { compact },
    });

    await host.compact("thread-1", "Preserve the current implementation state");

    expect(compact).toHaveBeenCalledWith(
      "Preserve the current implementation state",
    );
    expect(threads.get("thread-1")?.compacting).toBe(false);
  });

  it("does not interrupt an active Pi turn to compact", async () => {
    const compact = vi.fn().mockResolvedValue({});
    const host = new ArtemisAgentHost({ async request() {} }, { emit() {} });
    (
      host as unknown as {
        threads: Map<string, unknown>;
      }
    ).threads.set("thread-1", {
      compacting: false,
      currentTurnId: "turn-1",
      session: { compact },
    });

    await expect(host.compact("thread-1")).rejects.toThrow("active turn");
    expect(compact).not.toHaveBeenCalled();
  });
});

describe("context usage updates", () => {
  it("refreshes after every Pi turn and publishes the compaction estimate", () => {
    const emit = vi.fn();
    const host = new ArtemisAgentHost({ async request() {} }, { emit });
    const getContextUsage = vi
      .fn()
      .mockReturnValueOnce({
        tokens: 96_000,
        contextWindow: 128_000,
        percent: 75,
      })
      .mockReturnValueOnce({
        tokens: null,
        contextWindow: 128_000,
        percent: null,
      });
    const hosted = {
      threadId: "thread-1",
      currentTurnId: "turn-1",
      session: {
        getContextUsage,
        model: { contextWindow: 128_000 },
      },
    };
    const handleContextUsageEvent = (
      host as unknown as {
        handleContextUsageEvent(hosted: unknown, event: unknown): void;
      }
    ).handleContextUsageEvent.bind(host);

    handleContextUsageEvent(hosted, { type: "turn_end" });
    expect(emit).toHaveBeenLastCalledWith("thread-1", "turn-1", {
      type: "context.usage",
      tokens: 96_000,
      contextWindow: 128_000,
      compacting: false,
      estimated: true,
      source: "local-estimate",
      footprint: {
        imageBytes: 0,
        imageCount: 0,
        largestToolResultBytes: 0,
        textBytes: 0,
        toolSchemaBytes: 2,
      },
    });

    handleContextUsageEvent(hosted, {
      type: "compaction_end",
      result: { estimatedTokensAfter: 31_500 },
    });
    expect(emit).toHaveBeenLastCalledWith("thread-1", "turn-1", {
      type: "context.usage",
      tokens: 31_500,
      contextWindow: 128_000,
      compacting: false,
      estimated: true,
      source: "compaction-estimate",
      footprint: {
        imageBytes: 0,
        imageCount: 0,
        largestToolResultBytes: 0,
        textBytes: 0,
        toolSchemaBytes: 2,
      },
    });
  });

  it("adds fixed context to the post-compaction message estimate", () => {
    const emit = vi.fn();
    const host = new ArtemisAgentHost({ async request() {} }, { emit });
    const hosted = {
      threadId: "thread-1",
      currentTurnId: "turn-1",
      mcpToolNames: new Set<string>(),
      resourceLoader: {
        getAgentsFiles: () => ({ agentsFiles: [] }),
        getSkills: () => ({ skills: [] }),
      },
      session: {
        getContextUsage: () => ({
          tokens: null,
          contextWindow: 1_000_000,
          percent: null,
        }),
        model: { contextWindow: 1_000_000 },
        systemPrompt: "s".repeat(20_000),
        messages: [],
        agent: { state: { tools: [] } },
      },
    };
    const emitContextUsage = (
      host as unknown as {
        emitContextUsage(
          hosted: unknown,
          compacting: boolean,
          estimatedTokens?: number,
        ): void;
      }
    ).emitContextUsage.bind(host);

    emitContextUsage(hosted, false, 3_102);

    expect(emit).toHaveBeenLastCalledWith("thread-1", "turn-1", {
      type: "context.usage",
      tokens: 8_102,
      contextWindow: 1_000_000,
      compacting: false,
      estimated: true,
      source: "compaction-estimate",
      breakdown: {
        systemPromptTokens: 5_000,
        systemToolTokens: 0,
        mcpToolTokens: 0,
        customAgentTokens: 0,
        memoryFileTokens: 0,
        skillTokens: 0,
        messageTokens: 3_102,
        freeSpaceTokens: 891_898,
        autocompactBufferTokens: 100_000,
      },
      footprint: {
        imageBytes: 0,
        imageCount: 0,
        largestToolResultBytes: 0,
        textBytes: 0,
        toolSchemaBytes: 2,
      },
    });
  });

  it("publishes a normalized current-context breakdown", () => {
    const emit = vi.fn();
    const host = new ArtemisAgentHost({ async request() {} }, { emit });
    const contextFiles = [
      { path: "/workspace/AGENTS.md", content: "Project rules" },
    ];
    const skills = [
      {
        name: "documents",
        description: "Create and edit documents",
        filePath: "/skills/documents/SKILL.md",
        disableModelInvocation: false,
      },
    ];
    const skillPrompt = formatSkillsForPrompt(
      skills as unknown as Parameters<typeof formatSkillsForPrompt>[0],
    );
    const projectPrompt =
      '\n\n<project_context>\n\nProject-specific instructions and guidelines:\n\n<project_instructions path="/workspace/AGENTS.md">\nProject rules\n</project_instructions>\n\n</project_context>\n';
    const hosted = {
      threadId: "thread-1",
      currentTurnId: "turn-1",
      mcpToolNames: new Set(["github_search"]),
      resourceLoader: {
        getAgentsFiles: () => ({ agentsFiles: contextFiles }),
        getSkills: () => ({ skills }),
      },
      session: {
        getContextUsage: () => ({
          tokens: 1_000,
          contextWindow: 128_000,
          percent: 1,
        }),
        model: { contextWindow: 128_000 },
        systemPrompt: `Base system prompt${projectPrompt}${skillPrompt}`,
        messages: [{ role: "user", content: "Hello", timestamp: 1 }],
        agent: {
          state: {
            tools: [
              {
                name: "read",
                description: "Read a file",
                parameters: { type: "object", properties: {} },
              },
              {
                name: "github_search",
                description: "Search GitHub",
                parameters: { type: "object", properties: {} },
              },
            ],
          },
        },
      },
    };
    const emitContextUsage = (
      host as unknown as {
        emitContextUsage(hosted: unknown, compacting: boolean): void;
      }
    ).emitContextUsage.bind(host);

    emitContextUsage(hosted, false);

    const payload = emit.mock.calls.at(-1)?.[2] as {
      breakdown: Record<string, number>;
    };
    expect(payload.breakdown).toMatchObject({
      systemPromptTokens: expect.any(Number),
      systemToolTokens: expect.any(Number),
      mcpToolTokens: expect.any(Number),
      customAgentTokens: 0,
      memoryFileTokens: expect.any(Number),
      skillTokens: expect.any(Number),
      messageTokens: expect.any(Number),
      freeSpaceTokens: 114_200,
      autocompactBufferTokens: 12_800,
    });
    expect(
      payload.breakdown.systemPromptTokens +
        payload.breakdown.systemToolTokens +
        payload.breakdown.mcpToolTokens +
        payload.breakdown.customAgentTokens +
        payload.breakdown.memoryFileTokens +
        payload.breakdown.skillTokens +
        payload.breakdown.messageTokens,
    ).toBe(1_000);
  });
});
