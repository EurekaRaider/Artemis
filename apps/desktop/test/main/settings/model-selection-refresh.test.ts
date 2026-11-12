import { expect, it } from "vitest";
import type { ModelSelection } from "@artemis/protocol";
import { createModelRuntime } from "../../../src/main/settings/model-runtime.js";

it.each([
  ["anthropic", "claude-sonnet-4-5"],
  ["openai", "gpt-5.6"],
  ["deepseek", "deepseek-v4-flash"],
  ["anthropic", "retired-model-id"],
] as const)(
  "keeps saved %s/%s when the bundled catalog is refreshed",
  async (providerId, modelId) => {
    const selection: ModelSelection = {
      providerId,
      modelId,
      thinkingLevel: "high",
    };
    const services = {
      cachedAgentCatalog: { models: [], providers: [] },
      settingsStore: {
        providerConnections: async () => [],
        credentialSummaries: async () => [],
        addedModels: async () => [{ providerId, modelId }],
        modelSelection: async () => structuredClone(selection),
        contextWindowPreference: async () => 64_000,
      },
    } as unknown as Parameters<typeof createModelRuntime>[0];
    const runtime = createModelRuntime(services);
    const first = await runtime.getModelSettingsSnapshot();
    expect(first.selection).toEqual(selection);
    expect(first.contextWindow).toBe(64_000);
    expect(first.addedModels).toEqual([{ providerId, modelId }]);
    expect(
      first.models.some(
        (model) =>
          model.providerId === "anthropic" &&
          model.modelId === "claude-fable-5-2",
      ),
    ).toBe(true);
    services.cachedAgentCatalog = { models: first.models };
    expect((await runtime.getModelSettingsSnapshot()).selection).toEqual(
      selection,
    );
    if (modelId === "retired-model-id")
      await expect(runtime.resolveModelSelection(selection)).rejects.toThrow(
        "not in the Pi model catalog",
      );
  },
);
