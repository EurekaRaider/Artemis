import { describe, expect, it, vi } from "vitest";
import { Type } from "@sinclair/typebox";
import type {
  Api,
  Context,
  Model,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

import {
  PromptCacheController,
  injectExplicitPromptCache,
  promptCacheMetadata,
  withPromptCacheController,
} from "../src/prompt-cache.js";

function model(id: string, baseUrl = "https://api.openai.com/v1"): Model<Api> {
  return {
    id,
    name: id,
    api: "openai-responses",
    provider: "openai",
    baseUrl,
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 16_000,
  } as Model<Api>;
}

function context(systemPrompt = "Stable system prompt."): Context {
  return {
    systemPrompt,
    messages: [{ role: "user", content: "Dynamic request", timestamp: 1 }],
    tools: [
      {
        name: "read",
        description: "Read a file.",
        parameters: Type.Object({ path: Type.String() }),
      },
    ],
  };
}

describe("PromptCacheController", () => {
  it.each([
    ["gpt-5.6", 0, "parent", "explicit-30m", "official-gpt-5.6"],
    ["gpt-5.5", 0, "parent", "long", "official-gpt-5.5"],
    ["gpt-5.5-pro", 0, "parent", "long", "official-gpt-5.5"],
    ["gpt-5.4", 0, "parent", "short", "official-legacy-first-turn"],
    ["gpt-5.4", 1, "parent", "long", "official-legacy-persistent"],
    ["gpt-5.6", 2, "child", "short", "child-agent"],
  ] as const)(
    "selects $4 for $1 with $2 prior turns in $3 scope",
    (modelId, priorTurns, scope, policy, reason) => {
      const controller = new PromptCacheController();
      controller.registerSession("session-1", {
        scope,
        priorTopLevelUserTurns: priorTurns,
      });

      expect(
        controller.resolve(model(modelId), context(), {
          sessionId: "session-1",
        }),
      ).toMatchObject({ policy, reason });
    },
  );

  it("keeps unknown models and non-official endpoints on short caching", () => {
    const controller = new PromptCacheController();
    controller.registerSession("parent", {
      scope: "parent",
      priorTopLevelUserTurns: 5,
    });

    expect(
      controller.resolve(model("gpt-future"), context(), {
        sessionId: "parent",
      }),
    ).toMatchObject({ policy: "short", reason: "unsupported-model" });
    expect(
      controller.resolve(
        model("gpt-5.6", "https://openai.azure.com/v1"),
        context(),
        { sessionId: "parent" },
      ),
    ).toMatchObject({
      policy: "short",
      reason: "non-official-endpoint",
      cacheReadReported: false,
    });
  });

  it("always honors Pi one-shot requests that explicitly disable caching", () => {
    const controller = new PromptCacheController();
    controller.registerSession("session-1", {
      scope: "parent",
      priorTopLevelUserTurns: 3,
    });

    expect(
      controller.resolve(model("gpt-5.6"), context(), {
        sessionId: "session-1",
        cacheRetention: "none",
      }),
    ).toMatchObject({
      policy: "disabled",
      reason: "explicitly-disabled",
    });
  });

  it("keeps keys stable and changes them for model, system, or tool schemas", () => {
    const controller = new PromptCacheController();
    const first = controller.resolve(model("gpt-5.6"), context(), {
      sessionId: "session-1",
    });
    const same = controller.resolve(model("gpt-5.6"), context(), {
      sessionId: "session-1",
    });
    const changedModel = controller.resolve(model("gpt-5.6-pro"), context(), {
      sessionId: "session-1",
    });
    const changedSystem = controller.resolve(
      model("gpt-5.6"),
      context("Different system prompt."),
      { sessionId: "session-1" },
    );
    const changedTools = controller.resolve(
      model("gpt-5.6"),
      { ...context(), tools: [] },
      { sessionId: "session-1" },
    );

    expect(same.cacheKey).toBe(first.cacheKey);
    expect(changedModel.cacheKey).not.toBe(first.cacheKey);
    expect(changedSystem.cacheKey).not.toBe(first.cacheKey);
    expect(changedTools.cacheKey).not.toBe(first.cacheKey);
    expect(first.cacheKeyFingerprint).toHaveLength(16);
  });

  it("normalizes tool and schema key ordering before hashing", () => {
    const controller = new PromptCacheController();
    const tools = [
      {
        name: "write",
        description: "Write a file.",
        parameters: {
          type: "object",
          properties: { content: { type: "string" }, path: { type: "string" } },
        },
      },
      {
        name: "read",
        description: "Read a file.",
        parameters: {
          properties: { path: { type: "string" } },
          type: "object",
        },
      },
    ] as Context["tools"];
    const first = controller.resolve(
      model("gpt-5.6"),
      { ...context(), tools },
      { sessionId: "session-1" },
    );
    const reordered = controller.resolve(
      model("gpt-5.6"),
      { ...context(), tools: [...tools!].reverse() },
      { sessionId: "session-1" },
    );

    expect(reordered.cacheKey).toBe(first.cacheKey);
  });

  it("records a warning without rotating a hot key", () => {
    const controller = new PromptCacheController();
    const resolutions = Array.from({ length: 14 }, (_, index) =>
      controller.resolve(
        model("gpt-5.6"),
        context(),
        { sessionId: "session-1" },
        10_000 + index,
      ),
    );

    expect(new Set(resolutions.map((entry) => entry.cacheKey))).toHaveLength(1);
    expect(resolutions.at(-1)).toMatchObject({
      cacheKeyRequestsPerMinute: 14,
      cacheKeyRateWarning: true,
    });
  });
});

describe("prompt cache runtime wrapper", () => {
  it("injects GPT-5.6 explicit options after preserving an existing payload callback", async () => {
    const stream = {} as ReturnType<ModelRuntime["streamSimple"]>;
    const original = vi.fn(() => stream);
    const runtime = {
      streamSimple: original,
    } as unknown as ModelRuntime;
    const controller = new PromptCacheController();
    controller.registerSession("session-1", {
      scope: "parent",
      priorTopLevelUserTurns: 0,
    });
    const callback = vi.fn(() => ({
      input: [{ role: "developer", content: "Stable" }],
      custom: true,
      prompt_cache_retention: "24h",
    }));

    withPromptCacheController(runtime, controller).streamSimple(
      model("gpt-5.6"),
      context(),
      { sessionId: "session-1", onPayload: callback },
    );

    const forwarded = original.mock.calls[0]![2] as SimpleStreamOptions;
    const metadata = promptCacheMetadata(forwarded);
    expect(forwarded.cacheRetention).toBe("none");
    expect(forwarded.sessionId).toBe(metadata?.cacheKey);
    const payload = await forwarded.onPayload?.({}, model("gpt-5.6"));
    expect(callback).toHaveBeenCalledOnce();
    expect(payload).toEqual(
      expect.objectContaining({
        custom: true,
        prompt_cache_key: metadata?.cacheKey,
        prompt_cache_options: { mode: "explicit", ttl: "30m" },
        input: [
          {
            role: "developer",
            content: [
              {
                type: "input_text",
                text: "Stable",
                prompt_cache_breakpoint: { mode: "explicit" },
              },
            ],
          },
        ],
      }),
    );
    expect(payload).not.toHaveProperty("prompt_cache_retention");
  });

  it("adds a Chat Completions breakpoint to the stable system message", () => {
    const controller = new PromptCacheController();
    const resolution = controller.resolve(model("gpt-5.6"), context(), {
      sessionId: "session-1",
    });

    expect(
      injectExplicitPromptCache(
        {
          messages: [
            { role: "system", content: "Stable" },
            { role: "user", content: "Dynamic" },
          ],
        },
        resolution,
      ),
    ).toMatchObject({
      messages: [
        {
          role: "system",
          content: [
            {
              type: "text",
              text: "Stable",
              prompt_cache_breakpoint: { mode: "explicit" },
            },
          ],
        },
        { role: "user", content: "Dynamic" },
      ],
    });
  });
});
