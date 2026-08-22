import type { AgentModelInfo } from "@artemis/protocol";
import { describe, expect, it } from "vitest";

import {
  selectionForModelSwitch,
  thinkingLevelsForModel,
} from "../src/renderer/model-selection.js";

const glm53: AgentModelInfo = {
  providerId: "zai",
  modelId: "glm-5.3",
  name: "GLM-5.3",
  reasoning: true,
  thinkingLevels: ["off", "minimal", "low", "medium", "high"],
  highestThinkingLevel: "high",
  contextWindow: 1_000_000,
  configured: true,
};

describe("model selection defaults", () => {
  it("uses the model's highest supported level for a first selection", () => {
    expect(selectionForModelSwitch(glm53)).toEqual({
      providerId: "zai",
      modelId: "glm-5.3",
      thinkingLevel: "high",
    });
  });

  it("uses max when that is the model's highest supported level", () => {
    expect(
      selectionForModelSwitch({
        ...glm53,
        modelId: "gpt-5.6-sol",
        thinkingLevels: [
          "off",
          "minimal",
          "low",
          "medium",
          "high",
          "xhigh",
          "max",
        ],
        highestThinkingLevel: "max",
      }),
    ).toEqual({
      providerId: "zai",
      modelId: "gpt-5.6-sol",
      thinkingLevel: "max",
    });
  });

  it("lists only the reasoning levels actually supported by the model", () => {
    expect(thinkingLevelsForModel(glm53)).toEqual([
      "minimal",
      "low",
      "medium",
      "high",
    ]);
  });

  it("does not carry a different model's medium default into GLM-5.3", () => {
    expect(
      selectionForModelSwitch(glm53, {
        providerId: "openai",
        modelId: "gpt-5.2",
        thinkingLevel: "medium",
      }),
    ).toEqual({
      providerId: "zai",
      modelId: "glm-5.3",
      thinkingLevel: "high",
    });
  });

  it("preserves an explicit level when reselecting the same model", () => {
    expect(
      selectionForModelSwitch(glm53, {
        providerId: "zai",
        modelId: "glm-5.3",
        thinkingLevel: "low",
      }),
    ).toEqual({
      providerId: "zai",
      modelId: "glm-5.3",
      thinkingLevel: "low",
    });
  });

  it("clamps a stale same-model level to the model's current ceiling", () => {
    expect(
      selectionForModelSwitch(glm53, {
        providerId: "zai",
        modelId: "glm-5.3",
        thinkingLevel: "max",
      }),
    ).toMatchObject({ thinkingLevel: "high" });
  });
});
