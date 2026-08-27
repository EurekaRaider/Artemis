import { describe, expect, it } from "vitest";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

import {
  GLM_5_3_FLASH_PROVIDER_IDS,
  registerArtemisBuiltinModels,
} from "../src/builtin-models.js";

describe("Artemis built-in model additions", () => {
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
