import { describe, expect, it } from "vitest";

import {
  filterCodexSelectOptions,
  type CodexSelectOption,
} from "../src/renderer/CodexSelect.js";

const models: CodexSelectOption<string>[] = [
  {
    value: "google:gemini-2.5-pro",
    label: "google · Gemini 2.5 Pro",
    searchText: "google Gemini 2.5 Pro gemini-2.5-pro",
  },
  {
    value: "openai:gpt-5.2-codex",
    label: "openai · GPT-5.2 Codex",
    searchText: "openai GPT-5.2 Codex gpt-5.2-codex",
  },
  {
    value: "deepseek:deepseek-reasoner",
    label: "deepseek · DeepSeek Reasoner",
    searchText: "deepseek DeepSeek Reasoner deepseek-reasoner",
  },
];

describe("CodexSelect fuzzy search", () => {
  it("matches provider, display name, and model ID without case sensitivity", () => {
    expect(
      filterCodexSelectOptions(models, "OPENAI").map(({ value }) => value),
    ).toEqual(["openai:gpt-5.2-codex"]);
    expect(
      filterCodexSelectOptions(models, "reasoner").map(({ value }) => value),
    ).toEqual(["deepseek:deepseek-reasoner"]);
    expect(
      filterCodexSelectOptions(models, "gemini-2.5").map(({ value }) => value),
    ).toEqual(["google:gemini-2.5-pro"]);
  });

  it("supports ordered fuzzy terms and returns an explicit empty result", () => {
    expect(
      filterCodexSelectOptions(models, "gmni pro").map(({ value }) => value),
    ).toEqual(["google:gemini-2.5-pro"]);
    expect(filterCodexSelectOptions(models, "not-a-model")).toEqual([]);
  });
});
