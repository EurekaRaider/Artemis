// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import "./renderer-test-utils.js";
import {
  handleWorkspaceTabBarKeyDown,
  workspaceTabDomId,
} from "../src/renderer/workspace-tabs.js";

function TabBarHarness() {
  const [activeTabId, setActiveTabId] = useState("terminal");
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
          activeTabId,
          rtl: false,
          activate: (tabId) => setActiveTabId(tabId),
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
            aria-controls={`${workspaceTabDomId(tab.id)}-pane`}
            aria-selected={tab.id === activeTabId}
            className="workspace-tab-select"
            id={workspaceTabDomId(tab.id)}
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
      {tabs.map((tab) => (
        <div
          aria-labelledby={workspaceTabDomId(tab.id)}
          id={`${workspaceTabDomId(tab.id)}-pane`}
          key={tab.id}
          role="tabpanel"
        >
          {tab.title} pane
        </div>
      ))}
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

describe("workspace tab/pane ARIA association (review follow-up)", () => {
  it("pairs each tab with its pane via unique two-way references", () => {
    render(<TabBarHarness />);
    const tabs = screen.getAllByRole("tab");
    const panes = screen.getAllByRole("tabpanel");
    expect(tabs.length).toBe(panes.length);

    const tabIds = new Set<string>();
    const paneIds = new Set<string>();
    for (const tab of tabs) {
      const controlsId = tab.getAttribute("aria-controls");
      const tabId = tab.id;
      expect(controlsId).toBeTruthy();
      expect(tabId).toBeTruthy();
      expect(tabIds.has(tabId)).toBe(false);
      tabIds.add(tabId);
      const pane = document.getElementById(controlsId!);
      expect(pane).not.toBeNull();
      expect(pane!.getAttribute("role")).toBe("tabpanel");
      expect(pane!.getAttribute("aria-labelledby")).toBe(tabId);
      paneIds.add(controlsId!);
    }
    expect(paneIds.size).toBe(panes.length);
    // Tab ids survive characters that are illegal in raw DOM ids.
    expect(workspaceTabDomId("agent:team foo/bar")).toBe(
      "workspace-tab-agent-3Ateam-20foo-2Fbar",
    );
  });
});
