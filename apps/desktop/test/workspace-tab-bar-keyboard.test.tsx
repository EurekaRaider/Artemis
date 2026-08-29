// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import "./renderer-test-utils.js";
import { handleWorkspaceTabBarKeyDown } from "../src/renderer/workspace-tabs.js";

function TabBarHarness() {
  const activate = vi.fn();
  const tabs = [
    { id: "review", kind: "review" as const, title: "Review" },
    { id: "terminal", kind: "terminal" as const, title: "Terminal" },
    { id: "browser", kind: "browser" as const, title: "Browser" },
  ];
  return (
    <div
      onKeyDown={(event) =>
        handleWorkspaceTabBarKeyDown(event.nativeEvent, {
          tabs,
          activeTabId: "terminal",
          rtl: false,
          activate,
          focusTab: (tabId) =>
            document
              .querySelector<HTMLButtonElement>(
                `[data-tab-id="${tabId}"] .workspace-tab-select`,
              )
              ?.focus(),
        })
      }
      role="tablist"
    >
      <button aria-label="Scroll left" type="button">
        ‹
      </button>
      {tabs.map((tab) => (
        <span data-tab-id={tab.id} key={tab.id}>
          <button
            aria-selected={tab.id === "terminal"}
            className="workspace-tab-select"
            role="tab"
            type="button"
          >
            {tab.title}
          </button>
          <button className="workspace-tab-close" type="button">
            ×
          </button>
        </span>
      ))}
      <button aria-label="Add tab" type="button">
        +
      </button>
    </div>
  );
}

describe("workspace tab bar keyboard handler (review follow-up)", () => {
  it("navigates tabs with arrows and Home/End when a tab has focus", async () => {
    const user = userEvent.setup();
    render(<TabBarHarness />);
    const terminal = screen.getByRole("tab", { name: "Terminal" });
    terminal.focus();

    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Review" })).toHaveFocus();

    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Browser" })).toHaveFocus();

    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "Review" })).toHaveFocus();

    // WAI-ARIA tabs pattern: wrap at the ends.
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Browser" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Review" })).toHaveFocus();
  });

  it("ignores navigation keys from close, add, and scroll controls", async () => {
    const user = userEvent.setup();
    render(<TabBarHarness />);

    for (const label of ["Add tab", "Scroll left", "Close"]) {
      const control =
        label === "Close"
          ? document.querySelector(".workspace-tab-close")!
          : screen.getByRole("button", { name: label });
      control.focus();
      await user.keyboard("{Home}");
      await user.keyboard("{ArrowLeft}");
      expect(control).toHaveFocus();
      expect(screen.getByRole("tab", { name: "Terminal" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    }
  });
});
