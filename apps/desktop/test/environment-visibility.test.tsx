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
let timelineWidth: number;
let composerWidth: number;
const resizeCallbacks = new Set<() => void>();
beforeEach(() => {
  workspaceWidth = 1800;
  timelineWidth = 960;
  composerWidth = 960;
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
      const workspaceLeft = 260;
      if (this.classList.contains("workspace"))
        return new DOMRect(workspaceLeft, 0, workspaceWidth, 780);
      if (
        this.matches(
          '[data-artemis-component="environment-control"][data-part="root"]',
        )
      )
        return new DOMRect(workspaceLeft + workspaceWidth - 80, 0, 30, 40);
      if (
        this.matches(".timeline, .conversation-empty-state, .composer-wrap")
      ) {
        const width = this.classList.contains("composer-wrap")
          ? composerWidth
          : timelineWidth;
        return new DOMRect(
          workspaceLeft + (workspaceWidth - width) / 2,
          40,
          width,
          600,
        );
      }
      return originalRect.call(this);
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
      <div className="conversation">
        <div className="timeline-scroll">
          <div className="timeline">Timeline content</div>
        </div>
        <div className="composer-wrap">
          <input aria-label="Prompt" />
        </div>
      </div>
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
    workspaceWidth = 1667;
    render(fixture());
    expect(dialog()).toBeNull();
    const prompt = screen.getByRole("textbox", { name: "Prompt" });
    prompt.focus();
    resize(1668);
    expect(dialog()).toBeVisible();
    await waitFor(() =>
      expect(window.artemis.getProjectGitInfo).toHaveBeenCalled(),
    );
    expect(prompt).toHaveFocus();
    resize(1667);
    expect(dialog()).toBeNull();
    resize(1800);
    expect(dialog()).toBeVisible();
    expect(prompt).toHaveFocus();
  });

  it("measures actual content bounds and configured panel width, including sidebar-only resizes", () => {
    workspaceWidth = 1747;
    render(fixture({}, 320));
    expect(dialog()).toBeNull();
    resize(1748);
    expect(dialog()).toBeVisible();
    resize(1000);
    expect(dialog()).toBeNull();
  });

  it("hides when either the timeline or composer would overlap, even in a wide workspace", () => {
    workspaceWidth = 1200;
    render(fixture());
    expect(dialog()).toBeNull();
    resize(1800);
    expect(dialog()).toBeVisible();
    timelineWidth = 1200;
    resize(1800);
    expect(dialog()).toBeNull();
    timelineWidth = 960;
    composerWidth = 1200;
    resize(1800);
    expect(dialog()).toBeNull();
    composerWidth = 960;
    resize(1800);
    expect(dialog()).toBeVisible();
  });

  it("remeasures content mounted after the initial empty geometry", async () => {
    timelineWidth = 0;
    composerWidth = 0;
    const { container } = render(fixture());
    expect(dialog()).toBeNull();
    timelineWidth = 960;
    const empty = document.createElement("div");
    empty.className = "conversation-empty-state";
    container.querySelector(".timeline-scroll")!.replaceChildren(empty);
    await waitFor(() => expect(dialog()).toBeVisible());
    timelineWidth = 1200;
    const timeline = document.createElement("div");
    timeline.className = "timeline";
    empty.replaceWith(timeline);
    await waitFor(() => expect(dialog()).toBeNull());
  });

  it("restores after closing the dock, including when initially mounted with the dock open", () => {
    const { rerender } = render(fixture({ dockOpen: true }));
    expect(dialog()).toBeNull();
    rerender(fixture());
    expect(dialog()).toBeVisible();
    rerender(fixture({ dockOpen: true }));
    expect(dialog()).toBeNull();
    resize(1900);
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
    resize(1800);
    rerender(fixture({ dockOpen: true }));
    rerender(fixture());
    expect(dialog()).toBeNull();
    await user.click(screen.getByRole("button", { name: "Task environment" }));
    expect(dialog()).toBeVisible();
    resize(900);
    expect(dialog()).toBeNull();
    resize(1800);
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
    resize(1900);
    expect(dialog()).toBeNull();
  });

  it("keeps explicitly disabled defaults closed and disconnects observation on unmount", () => {
    const { unmount } = render(fixture({ defaultOpen: false }));
    resize(1900);
    expect(dialog()).toBeNull();
    expect(resizeCallbacks.size).toBe(1);
    unmount();
    expect(resizeCallbacks.size).toBe(0);
  });
});
