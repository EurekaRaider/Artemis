// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps, CSSProperties } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubWindowArtemis } from "./renderer-test-utils.js";
import { EnvironmentPanel } from "../src/renderer/EnvironmentPanel.js";

const props: ComponentProps<typeof EnvironmentPanel> = {
  actionsDisabled: false,
  agents: [],
  attachments: [],
  defaultOpen: true,
  dockOpen: false,
  locale: "en",
  mcpUsages: [],
  sources: [],
  teams: [],
  project: {
    id: "p",
    name: "Artemis",
    path: "/synthetic",
    createdAt: "2026-09-06T00:00:00Z",
    updatedAt: "2026-09-06T00:00:00Z",
  },
  threadId: "t",
  taskTitle: "Task",
  onAddProject: vi.fn(),
  onAddSources: vi.fn(),
  onConfirm: async () => false,
  onMessage: vi.fn(),
  onOpenAgent: vi.fn(),
  onOpenReview: vi.fn(),
  onOpenTeam: vi.fn(),
  onOpenUrl: vi.fn(),
  onViewAllSources: vi.fn(),
};

let workspaceWidth: number;
const resizeCallbacks = new Set<() => void>();
beforeEach(() => {
  workspaceWidth = 1200;
  resizeCallbacks.clear();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: () => void) {}
      observe() {
        resizeCallbacks.add(this.callback);
      }
      disconnect() {
        resizeCallbacks.delete(this.callback);
      }
    },
  );
  const originalRect = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function () {
      return this.classList.contains("workspace")
        ? new DOMRect(0, 0, workspaceWidth, 780)
        : originalRect.call(this);
    },
  );
  stubWindowArtemis({
    getProjectGitInfo: vi.fn().mockResolvedValue({ managed: false }),
    getProjectPullRequest: vi.fn().mockResolvedValue({ status: "none" }),
    onProjectGitChanged: () => () => {},
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fixture(overrides: Partial<typeof props> = {}, panelWidth = 280) {
  return (
    <div
      className="workspace"
      style={
        {
          "--environment-panel-inline-size": `${panelWidth}px`,
        } as CSSProperties
      }
    >
      <input aria-label="Prompt" />
      <EnvironmentPanel {...props} {...overrides} />
    </div>
  );
}
function resize(width: number) {
  workspaceWidth = width;
  act(() => resizeCallbacks.forEach((callback) => callback()));
}
const dialog = () =>
  screen.queryByRole("dialog", { name: "Environment", exact: true });

describe("environment panel automatic visibility", () => {
  it("opens with sufficient space and restores at the exact width threshold without moving prompt focus", async () => {
    workspaceWidth = 1023;
    render(fixture());
    expect(dialog()).toBeNull();
    const prompt = screen.getByRole("textbox", { name: "Prompt" });
    prompt.focus();
    resize(1024);
    expect(dialog()).toBeVisible();
    await waitFor(() =>
      expect(window.artemis.getProjectGitInfo).toHaveBeenCalled(),
    );
    expect(prompt).toHaveFocus();
    resize(1023);
    expect(dialog()).toBeNull();
    resize(1200);
    expect(dialog()).toBeVisible();
    expect(prompt).toHaveFocus();
  });

  it("measures the workspace and configured panel width, including sidebar-only resizes", () => {
    workspaceWidth = 1063;
    render(fixture({}, 320));
    expect(dialog()).toBeNull();
    resize(1064);
    expect(dialog()).toBeVisible();
    resize(1000);
    expect(dialog()).toBeNull();
  });

  it("restores after closing the dock, including when initially mounted with the dock open", () => {
    const { rerender } = render(fixture({ dockOpen: true }));
    expect(dialog()).toBeNull();
    rerender(fixture());
    expect(dialog()).toBeVisible();
    rerender(fixture({ dockOpen: true }));
    expect(dialog()).toBeNull();
    resize(1500);
    expect(dialog()).toBeNull();
    rerender(fixture());
    expect(dialog()).toBeVisible();
  });

  it("respects manual dismissal through resize and dock transitions, and still allows reopening", async () => {
    const user = userEvent.setup();
    const { rerender } = render(fixture());
    await user.click(
      screen.getByRole("button", { name: "Close", exact: true }),
    );
    resize(900);
    resize(1200);
    rerender(fixture({ dockOpen: true }));
    rerender(fixture());
    expect(dialog()).toBeNull();
    await user.click(screen.getByRole("button", { name: "Task environment" }));
    expect(dialog()).toBeVisible();
    resize(900);
    expect(dialog()).toBeNull();
    resize(1200);
    expect(dialog()).toBeVisible();
  });

  it("restores after a child-agent shortcut opens and then closes the dock", async () => {
    const child = {
      type: "child-agent.status" as const,
      agentId: "child",
      label: "Layout check",
      status: "running" as const,
      updatedAt: "2026-09-06T00:00:00Z",
    };
    const onOpenAgent = vi.fn();
    const overrides = { agents: [child], onOpenAgent };
    const { rerender } = render(fixture(overrides));
    await userEvent.click(screen.getByRole("button", { name: /Layout check/ }));
    expect(onOpenAgent).toHaveBeenCalledWith(child);
    expect(dialog()).toBeNull();
    rerender(fixture({ ...overrides, dockOpen: true }));
    rerender(fixture(overrides));
    expect(dialog()).toBeVisible();
  });

  it("allows explicit opening in narrow layouts and beside the dock", async () => {
    workspaceWidth = 800;
    render(fixture({ dockOpen: true }));
    await userEvent.click(
      screen.getByRole("button", { name: "Task environment" }),
    );
    expect(dialog()).toBeVisible();
    await userEvent.keyboard("{Escape}");
    expect(dialog()).toBeNull();
    resize(1500);
    expect(dialog()).toBeNull();
  });

  it("keeps explicitly disabled defaults closed and disconnects observation on unmount", () => {
    const { unmount } = render(fixture({ defaultOpen: false }));
    resize(1500);
    expect(dialog()).toBeNull();
    expect(resizeCallbacks.size).toBe(1);
    unmount();
    expect(resizeCallbacks.size).toBe(0);
  });
});
