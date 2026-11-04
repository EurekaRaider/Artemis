// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CSSProperties } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each(["ltr", "rtl"])(
    "keeps the popup inside the conversation beside the dock in %s and after resizing",
    (direction) => {
      let boundaryLeft = 256;
      let boundaryRight = 952;
      let updateLayout = () => {};
      const observe = vi.fn();
      const disconnect = vi.fn();
      vi.stubGlobal(
        "ResizeObserver",
        class {
          constructor(update: () => void) {
            updateLayout = update;
          }
          observe = observe;
          disconnect = disconnect;
        },
      );
      vi.spyOn(
        HTMLElement.prototype,
        "getBoundingClientRect",
      ).mockImplementation(function () {
        if (this.classList.contains("conversation"))
          return new DOMRect(
            boundaryLeft,
            0,
            boundaryRight - boundaryLeft,
            900,
          );
        if (this.classList.contains("composer"))
          return new DOMRect(280, 600, 648, 100);
        if (this.classList.contains("model-picker-menu"))
          return new DOMRect(
            0,
            0,
            Math.min(320, Number.parseFloat(this.style.maxWidth) || 320),
            400,
          );
        return new DOMRect();
      });
      const { container, unmount } = render(
        <div className="conversation">
          <div
            className="composer"
            style={{ direction, "--model-anchor": "458px" } as CSSProperties}
          >
            <ModelPickerMenu
              models={[model]}
              providers={[]}
              activeModel={model}
              selection={{
                providerId: "p",
                modelId: "m",
                thinkingLevel: "low",
              }}
              locale="zh-CN"
              query=""
              onQuery={vi.fn()}
              onModel={vi.fn()}
              onThinking={vi.fn()}
            />
          </div>
        </div>,
      );
      const menu = screen.getByRole("dialog");
      const expectInsideConversation = () => {
        const left = 280 + Number.parseFloat(menu.style.left);
        const width = menu.getBoundingClientRect().width;
        expect(left).toBeGreaterThanOrEqual(boundaryLeft + 8);
        expect(left + width).toBeLessThanOrEqual(boundaryRight - 8);
      };
      expectInsideConversation();
      expect(observe).toHaveBeenCalledWith(
        container.querySelector(".conversation"),
      );
      boundaryLeft = 400;
      boundaryRight = 680;
      updateLayout();
      expect(menu.style.maxWidth).toBe("264px");
      expectInsideConversation();
      disconnect.mockClear();
      unmount();
      expect(disconnect).toHaveBeenCalled();
    },
  );

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
