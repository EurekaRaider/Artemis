import { expect, it, vi } from "vitest";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { modelCapabilityTools } from "../../src/models/model-capability-tools.js";
import { toPiProviderConfig } from "../../src/models/provider-configuration.js";
import { registerVirtualModels } from "../../src/models/virtual-models.js";
import type { ProviderConnection } from "@artemis/protocol";
const provider: ProviderConnection = {
  id: "fixture",
  name: "Fixture",
  baseUrl: "http://localhost/v1",
  models: [
    {
      id: "physical",
      name: "Physical",
      reasoning: true,
      input: ["text"],
      contextWindow: 32000,
      maxTokens: 1000,
      samplingParams: { temperature: 0.2 },
      samplingParamsByThinkingLevel: { high: { top_p: 0.8 } },
      thinkingLevelMap: { high: "max" },
      inputLimits: { maxRequestBytes: 100000 },
      promptCache: { short: 300 },
    },
  ],
};
it("passes sampling, thinking mappings, cache and limits into Pi", () => {
  expect(toPiProviderConfig(provider, true).models[0]).toMatchObject({
    samplingParams: { temperature: 0.2 },
    samplingParamsByThinkingLevel: { high: { top_p: 0.8 } },
    thinkingLevelMap: { high: "max" },
    inputLimits: { maxRequestBytes: 100000 },
    promptCache: { short: 300 },
  });
});
it("denies every model operation in Plan before any provider call", async () => {
  const execute = vi.fn();
  const runtime = {
    getAllAvailable: execute,
    getModelOfType: execute,
  } as unknown as ModelRuntime;
  for (const tool of modelCapabilityTools(runtime, () => "plan"))
    await expect(
      tool.execute("call", {} as never, undefined, undefined, {} as never),
    ).rejects.toThrow(/Work or Codemode/);
  expect(execute).not.toHaveBeenCalled();
});
it.each(["work", "codemode"] as const)(
  "forwards classifier images and cancellation in %s without echoing image data",
  async (mode) => {
    const model = {
      provider: "fixture",
      id: "vision",
      type: "classifier",
      input: ["text", "image"],
    };
    const answers = { visible: { type: "bool", value: true } };
    const classify = vi.fn(async () => ({ stopReason: "stop", answers }));
    const runtime = {
      getModelOfType: () => model,
      hasConfiguredAuth: () => true,
      getAllAvailable: async () => [model],
      classify,
    } as unknown as ModelRuntime;
    const tools = modelCapabilityTools(runtime, () => mode);
    const capabilities = await tools[0]!.execute(
      "list",
      {},
      undefined,
      undefined,
      {} as never,
    );
    expect(JSON.parse(capabilities.content[0]!.text)).toMatchObject([
      { input: ["text", "image"] },
    ]);
    const tool = tools.find((tool) => tool.name === "classify")!;
    const signal = new AbortController().signal;
    const args = {
      provider: "fixture",
      model: "vision",
      state: {},
      images: [
        { type: "image", data: "private-image-data", mimeType: "image/png" },
      ],
      questions: {
        visible: {
          type: "bool",
          instructions: "Is it visible?",
          criteria: { true: "Visible", false: "Hidden" },
        },
      },
    };
    const result = await tool.execute(
      "call",
      args as never,
      signal,
      undefined,
      {} as never,
    );
    expect(classify).toHaveBeenCalledWith(
      model,
      { state: args.state, questions: args.questions, images: args.images },
      { signal },
    );
    expect(result.structuredContent).toEqual({ answers });
    expect(JSON.stringify(result)).not.toContain("private-image-data");
    classify.mockResolvedValueOnce({
      stopReason: "error",
      errorMessage: "Model does not support image input",
    } as never);
    await expect(
      tool.execute("call", args as never, signal, undefined, {} as never),
    ).rejects.toThrow(/does not support image/);
  },
);

it("routes a virtual model through Pi with continuation affinity and bounded retry fallback", () => {
  let definition:
    Parameters<ModelRuntime["registerVirtualModel"]>[0] | undefined;
  const models = [
    { id: "physical", provider: "fixture" },
    { id: "backup", provider: "fixture" },
  ];
  const runtime = {
    registerVirtualModel: vi.fn((d) => {
      definition = d;
    }),
    getPhysicalModel: (_p: string, id: string) =>
      models.find((m) => m.id === id),
  } as unknown as ModelRuntime;
  const virtual = {
    ...provider.models[0]!,
    id: "virtual",
    virtualRoutes: [
      { providerId: "fixture", modelId: "physical" },
      { providerId: "fixture", modelId: "backup" },
    ],
  };
  expect(
    toPiProviderConfig(
      { ...provider, models: [...provider.models, virtual] },
      true,
    ).models,
  ).toHaveLength(1);
  registerVirtualModels(runtime, [{ ...provider, models: [virtual] }]);
  expect(
    definition!.route({ reason: "user", thinkingLevel: "high" } as never),
  ).toMatchObject({ model: models[0] });
  expect(
    definition!.route({
      reason: "retry",
      thinkingLevel: "high",
      failed: { model: models[0] },
    } as never),
  ).toMatchObject({ model: models[1] });
  expect(
    definition!.route({
      reason: "continuation",
      thinkingLevel: "high",
      previous: { model: models[1] },
    } as never),
  ).toMatchObject({ model: models[1] });
});
