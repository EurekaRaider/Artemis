import { describe, expect, it } from "vitest";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

import {
  GLM_5_3_FLASH_PROVIDER_IDS,
  registerArtemisBuiltinModels,
} from "../../src/models/builtin-models.js";

describe("Artemis built-in model additions", () => {
  it("keeps saved Azure selections and credentials usable after the provider rename", async () => {
    const providerId = "azure-openai-responses";
    const runtime = await ModelRuntime.create({
      modelsPath: null,
      allowModelNetwork: false,
      credentials: {
        async read(id) {
          return id === providerId
            ? { type: "api_key", key: "synthetic-azure-key" }
            : undefined;
        },
        async list() {
          return [{ providerId, type: "api_key" }];
        },
        async modify() {
          throw new Error("Existing Azure credentials must not be rewritten");
        },
        async delete() {
          throw new Error("Existing Azure credentials must not be deleted");
        },
      },
    });
    registerArtemisBuiltinModels(runtime);
    registerArtemisBuiltinModels(runtime);
    await runtime.refresh({ allowNetwork: false });

    const current = runtime.getModel("azure", "gpt-6.1-sol");
    expect(current).toBeDefined();
    expect(runtime.getModel(providerId, "gpt-6.1-sol")).toEqual({
      ...current,
      provider: providerId,
    });
    expect(
      runtime
        .getModels(providerId)
        .every((model) => model.api === "azure-openai-responses"),
    ).toBe(true);
    expect(runtime.hasConfiguredAuth(providerId)).toBe(true);
    expect(runtime.hasConfiguredAuth("azure")).toBe(false);
    expect(runtime.getModel("azure", "deepseek-v4-pro")?.api).toBe(
      "openai-completions",
    );
  });

  it("preserves a custom provider using the legacy Azure ID", async () => {
    const runtime = await ModelRuntime.create({
      modelsPath: null,
      allowModelNetwork: false,
    });
    const providerId = "azure-openai-responses";
    runtime.registerProvider(providerId, {
      api: "openai-completions",
      baseUrl: "http://127.0.0.1:11434/v1",
      models: [
        {
          id: "custom-azure-model",
          name: "Custom Azure model",
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 32_000,
          maxTokens: 4096,
        },
      ],
    });
    registerArtemisBuiltinModels(runtime);
    expect(runtime.getModel(providerId, "custom-azure-model")?.api).toBe(
      "openai-completions",
    );
    expect(runtime.getModel(providerId, "gpt-6.1-sol")).toBeUndefined();
  });

  it("keeps saved DeepSeek Flash aliases callable after catalog upgrades", async () => {
    const runtime = await ModelRuntime.create({
      modelsPath: null,
      allowModelNetwork: false,
    });
    registerArtemisBuiltinModels(runtime);
    registerArtemisBuiltinModels(runtime);
    const models = runtime.getModels("deepseek");
    const current = models.find((model) => model.id === "deepseek-flash")!;
    for (const id of ["deepseek-v4-flash", "deepseek-v4-flash-vision-exp"]) {
      expect(models.filter((model) => model.id === id)).toEqual([
        {
          ...current,
          id,
          name: `${current.name} (${id === "deepseek-v4-flash" ? "V4 alias" : "Vision alias"})`,
        },
      ]);
    }
  });
  it("registers GLM-5.3-Flash as a callable multimodal Z.AI model", async () => {
    const runtime = await ModelRuntime.create({
      modelsPath: null,
      allowModelNetwork: false,
    });

    registerArtemisBuiltinModels(runtime);
    registerArtemisBuiltinModels(runtime);

    for (const providerId of GLM_5_3_FLASH_PROVIDER_IDS) {
      const matches = runtime
        .getModels(providerId)
        .filter((model) => model.id === "glm-5.3-flash");
      expect(matches).toHaveLength(1);
      expect(matches[0]).toMatchObject({
        name: "GLM-5.3-Flash",
        reasoning: true,
        thinkingLevelMap: {
          off: null,
          minimal: null,
          low: "low",
          medium: null,
          high: "high",
          xhigh: null,
          max: "max",
        },
        input: ["text", "image"],
        contextWindow: 1_000_000,
        maxTokens: 131_072,
      });
    }
  });
});
