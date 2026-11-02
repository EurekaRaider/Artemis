// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import "../../fixtures/renderer-test-utils.js";
import { ModelPickerMenu } from "../../../src/renderer/settings/ModelPickerMenu.js";
import type { AgentModelInfo } from "@artemis/protocol";
const model: AgentModelInfo = {
  providerId: "p",
  modelId: "m",
  name: "Fixture",
  configured: true,
  reasoning: true,
  thinkingLevels: ["low", "high"],
  contextWindow: 200000,
};
describe("integrated model picker", () => {
  it("groups models in one popup and offers only supported reasoning levels plus existing ultra", async () => {
    const user = userEvent.setup(),
      thinking = vi.fn();
    render(
      <ModelPickerMenu
        models={[
          model,
          {
            ...model,
            providerId: "q",
            modelId: "n",
            name: "Text",
            reasoning: false,
          },
        ]}
        providers={[
          { id: "p", name: "First" },
          { id: "q", name: "Second" },
        ]}
        activeModel={model}
        selection={{ providerId: "p", modelId: "m", thinkingLevel: "low" }}
        locale="zh-CN"
        query=""
        onQuery={vi.fn()}
        onModel={vi.fn()}
        onThinking={thinking}
      />,
    );
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(screen.getByText("First")).toBeVisible();
    expect(screen.getByText("Second")).toBeVisible();
    expect(screen.queryByRole("button", { name: "中" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "超强" }));
    expect(thinking).toHaveBeenCalledExactlyOnceWith("high", true);
  });
  it("hides all thinking controls for a non-reasoning model", () => {
    render(
      <ModelPickerMenu
        models={[model]}
        providers={[]}
        activeModel={{ ...model, reasoning: false }}
        selection={{ providerId: "p", modelId: "m", thinkingLevel: "off" }}
        locale="en"
        query=""
        onQuery={vi.fn()}
        onModel={vi.fn()}
        onThinking={vi.fn()}
      />,
    );
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByText("Thinking intensity")).toBeNull();
  });
});
