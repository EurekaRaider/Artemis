// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
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
      if (this.matches(".workspace, .conversation, .timeline-scroll"))
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
    getProjectGitInfo: vi.fn().mockResolvedValue({
      managed: true,
      branches: [],
      changeCount: 0,
      ahead: 0,
      behind: 0,
    }),
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
async function renderReady(ui: ReturnType<typeof fixture>) {
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(ui);
  });
  return result;
}
function resize(width: number) {
  workspaceWidth = width;
  act(() => resizeCallbacks.forEach((callback) => callback()));
}
const dialog = () =>
  screen.queryByRole("dialog", { name: "Environment", exact: true });

describe("environment agent activity", () => {
  const child = {
    type: "child-agent.status" as const,
    agentId: "child",
    parentAgentId: "parent",
    depth: 1,
    label: "Layout check",
    status: "running" as const,
    updatedAt: "2026-09-06T00:00:00Z",
  };

  it("hides the activity section when the task has no children or teams", async () => {
    await renderReady(fixture());
    expect(dialog()).toBeVisible();
    expect(screen.queryByText("Main agent")).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "Agent activity" }),
    ).toBeNull();
  });

  it("shows only direct children and preserves preview expansion and navigation", async () => {
    const onOpenAgent = vi.fn();
    const children = [
      child,
      ...[2, 3].map((index) => ({
        ...child,
        agentId: `child-${index}`,
        label: `Layout check ${index}`,
      })),
    ];
    await renderReady(
      fixture({
        onOpenAgent,
        agents: [
          ...children,
          {
            ...child,
            agentId: "nested",
            parentAgentId: child.agentId,
            depth: 2,
            label: "Nested check",
          },
        ],
      }),
    );
    expect(screen.queryByText("Main agent")).toBeNull();
    expect(screen.queryByRole("button", { name: /Nested check/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Layout check 3/ })).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "View all", exact: true }),
    );
    expect(
      screen.getByRole("button", { name: /Layout check 3/ }),
    ).toBeVisible();
    await userEvent.click(
      screen.getByRole("button", { name: "Show less", exact: true }),
    );
    expect(screen.queryByRole("button", { name: /Layout check 3/ })).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: /Layout check\s*Started working/ }),
    );
    expect(onOpenAgent).toHaveBeenCalledWith(child);
  });

  it("lists direct children beneath the team entry and opens the selected child", async () => {
    const children = [
      "cxx-plan-wrapper",
      "csharp-plan-bindings",
      "cli-validate-plan",
      "actor-review-fixes",
      "fleet-plan-c-abi",
      "typed-flash-rebase-verify",
    ].map((label) => ({ ...child, agentId: label, label, teamId: "team" }));
    const nested = {
      ...child,
      agentId: "nested",
      label: "Nested team member",
      parentAgentId: children[0]!.agentId,
      depth: 2,
      teamId: "team",
    };
    const team = {
      type: "agent-team.status" as const,
      teamId: "team",
      mission: "Follow the handoff document and finish the remaining work",
      status: "completed" as const,
      memberAgentIds: [
        ...children.map((member) => member.agentId),
        nested.agentId,
      ],
      requiredAgentIds: children.map((member) => member.agentId),
      maxMembers: 8,
      updatedAt: child.updatedAt,
    };
    const onOpenAgent = vi.fn();
    const { rerender } = await renderReady(fixture({ teams: [team] }));
    expect(screen.getByRole("group", { name: team.mission })).toBeVisible();
    expect(document.querySelectorAll(".environment-activity-row")).toHaveLength(
      0,
    );
    rerender(
      fixture({
        agents: [...children, nested],
        teams: [team],
        onOpenAgent,
      }),
    );
    expect(screen.queryByText("Main agent")).toBeNull();
    const group = screen.getByRole("group", { name: team.mission });
    expect(
      within(group).getByRole("button", { name: new RegExp(team.mission) }),
    ).toHaveClass("environment-agent-team-trigger");
    expect(screen.queryByText(nested.label)).toBeNull();
    expect(
      screen.getByRole("button", { name: /cxx-plan-wrapper/ }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /typed-flash-rebase-verify/ }),
    ).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "View all", exact: true }),
    );
    for (const member of children) {
      const row = within(group).getByRole("button", {
        name: new RegExp(`${member.label}\\s*Completed`),
      });
      expect(row).toBeVisible();
      expect(row.parentElement).toHaveClass("environment-agent-team-children");
    }
    expect(screen.queryByText(nested.label)).toBeNull();
    expect(screen.getByText(/6 total · 0 active/)).toBeVisible();
    await userEvent.click(
      screen.getByRole("button", { name: /cxx-plan-wrapper/ }),
    );
    expect(onOpenAgent).toHaveBeenCalledWith({
      ...children[0],
      status: "completed",
    });
  });

  it("opens each team from its own group header, including teams with no loaded children", async () => {
    const teams = ["First team", "Second team"].map((mission) => ({
      type: "agent-team.status" as const,
      teamId: mission,
      mission,
      status: "running" as const,
      memberAgentIds: [],
      requiredAgentIds: [],
      maxMembers: 8,
      updatedAt: child.updatedAt,
    }));
    const onOpenTeam = vi.fn();
    await renderReady(fixture({ teams, onOpenTeam }));
    expect(
      screen.queryByRole("button", { name: "View all", exact: true }),
    ).toBeNull();
    for (const team of teams) {
      expect(
        within(screen.getByRole("group", { name: team.mission })).getByRole(
          "button",
          { name: new RegExp(team.mission) },
        ),
      ).toBeVisible();
    }
    await userEvent.click(screen.getByRole("button", { name: /Second team/ }));
    expect(onOpenTeam).toHaveBeenCalledWith(teams[1]);
  });
});

describe("environment panel automatic visibility", () => {
  it("keeps a new conversation closed, then opens after the conversation starts", async () => {
    const { rerender } = render(fixture({ defaultOpen: false }));
    resize(1900);
    expect(dialog()).toBeNull();
    expect(window.artemis.getProjectGitInfo).not.toHaveBeenCalled();
    rerender(fixture({ defaultOpen: true }));
    await waitFor(() => expect(dialog()).toBeVisible());
  });

  it("waits for Git confirmation without flashing an open panel", async () => {
    let resolveGit!: (
      value: Awaited<ReturnType<typeof window.artemis.getProjectGitInfo>>,
    ) => void;
    vi.mocked(window.artemis.getProjectGitInfo).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveGit = resolve;
        }),
    );
    render(fixture());
    expect(dialog()).toBeNull();
    await act(async () =>
      resolveGit({ managed: true, branches: [], changeCount: 0 } as never),
    );
    expect(dialog()).toBeVisible();
  });

  it.each(["unmanaged", "failed"])(
    "keeps a started conversation closed when Git is %s",
    async (state) => {
      const getGit = vi.mocked(window.artemis.getProjectGitInfo);
      if (state === "failed")
        getGit.mockRejectedValue(new Error("Git unavailable"));
      else getGit.mockResolvedValue({ managed: false } as never);
      await act(async () => {
        render(fixture());
      });
      expect(getGit).toHaveBeenCalled();
      resize(1900);
      expect(dialog()).toBeNull();
      await userEvent.click(
        screen.getByRole("button", { name: "Task environment" }),
      );
      expect(dialog()).toBeVisible();
    },
  );

  it("reserves content space on manual open and releases it on close and unmount", async () => {
    workspaceWidth = 1200;
    const { container, unmount } = await renderReady(
      fixture({ defaultOpen: false }),
    );
    const conversation = container.querySelector<HTMLElement>(".conversation")!;
    const safeSpace = () =>
      conversation.style.getPropertyValue(
        "--environment-panel-content-safe-inline-size",
      );
    expect(safeSpace()).toBe("");
    await userEvent.click(
      screen.getByRole("button", { name: "Task environment" }),
    );
    expect(dialog()).toBeVisible();
    expect(safeSpace()).toBe("354px");
    await userEvent.keyboard("{Escape}");
    expect(dialog()).toBeNull();
    expect(safeSpace()).toBe("");
    await userEvent.click(
      screen.getByRole("button", { name: "Task environment" }),
    );
    expect(safeSpace()).toBe("354px");
    unmount();
    expect(safeSpace()).toBe("");
  });

  it("opens with sufficient space and restores at the exact width threshold without moving prompt focus", async () => {
    workspaceWidth = 833;
    await renderReady(fixture());
    expect(dialog()).toBeNull();
    const prompt = screen.getByRole("textbox", { name: "Prompt" });
    prompt.focus();
    resize(834);
    expect(dialog()).toBeVisible();
    await waitFor(() =>
      expect(window.artemis.getProjectGitInfo).toHaveBeenCalled(),
    );
    expect(prompt).toHaveFocus();
    resize(833);
    expect(dialog()).toBeNull();
    resize(1800);
    expect(dialog()).toBeVisible();
    expect(prompt).toHaveFocus();
  });

  it("measures actual content bounds and configured panel width, including sidebar-only resizes", async () => {
    workspaceWidth = 873;
    await renderReady(fixture({}, 320));
    expect(dialog()).toBeNull();
    resize(874);
    expect(dialog()).toBeVisible();
    resize(800);
    expect(dialog()).toBeNull();
  });

  it("keeps the panel open when content changes width because both rows reserve space", async () => {
    workspaceWidth = 1200;
    const { container } = await renderReady(fixture());
    expect(dialog()).toBeVisible();
    timelineWidth = 1200;
    composerWidth = 1200;
    resize(1200);
    expect(dialog()).toBeVisible();
    expect(
      container
        .querySelector<HTMLElement>(".conversation")!
        .style.getPropertyValue("--environment-panel-content-safe-inline-size"),
    ).toBe("354px");
  });

  it("reserves the same space before and after the empty state becomes a timeline", async () => {
    timelineWidth = 0;
    composerWidth = 0;
    const { container } = await renderReady(fixture());
    expect(dialog()).toBeVisible();
    const viewport = container.querySelector(".timeline-scroll")!;
    const empty = document.createElement("div");
    empty.className = "conversation-empty-state";
    viewport.replaceChildren(empty);
    const conversation = container.querySelector<HTMLElement>(".conversation")!;
    expect(
      conversation.style.getPropertyValue(
        "--environment-panel-content-safe-inline-size",
      ),
    ).toBe("354px");
    empty.className = "timeline";
    resize(1200);
    expect(dialog()).toBeVisible();
    expect(
      conversation.style.getPropertyValue(
        "--environment-panel-content-safe-inline-size",
      ),
    ).toBe("354px");
  });

  it("restores after closing the dock, including when initially mounted with the dock open", async () => {
    const { rerender } = await renderReady(fixture({ dockOpen: true }));
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
    const { rerender } = await renderReady(fixture());
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
    const focused = document.activeElement;
    timelineWidth = 1200;
    resize(1800);
    expect(dialog()).toBeVisible();
    expect(document.activeElement).toBe(focused);
    resize(800);
    expect(dialog()).toBeNull();
    rerender(fixture({ dockOpen: true }));
    expect(dialog()).toBeNull();
    timelineWidth = 960;
    resize(1800);
    rerender(fixture());
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
    const { rerender } = await renderReady(fixture(overrides));
    await userEvent.click(screen.getByRole("button", { name: /Layout check/ }));
    expect(onOpenAgent).toHaveBeenCalledWith(child);
    expect(dialog()).toBeNull();
    rerender(fixture({ ...overrides, dockOpen: true }));
    rerender(fixture(overrides));
    expect(dialog()).toBeVisible();
  });

  it("allows explicit opening beside the dock when there is enough content space", async () => {
    workspaceWidth = 1200;
    await renderReady(fixture({ dockOpen: true }));
    await userEvent.click(
      screen.getByRole("button", { name: "Task environment" }),
    );
    expect(dialog()).toBeVisible();
    await userEvent.keyboard("{Escape}");
    expect(dialog()).toBeNull();
    resize(1900);
    expect(dialog()).toBeNull();
  });

  it("closes even a manually opened panel when it would leave less than 480px", async () => {
    workspaceWidth = 800;
    const { container } = await renderReady(fixture({ defaultOpen: false }));
    await userEvent.click(
      screen.getByRole("button", { name: "Task environment" }),
    );
    expect(dialog()).toBeNull();
    expect(
      container
        .querySelector<HTMLElement>(".conversation")!
        .style.getPropertyValue("--environment-panel-content-safe-inline-size"),
    ).toBe("");
    resize(1200);
    expect(dialog()).toBeVisible();
  });

  it("keeps explicitly disabled defaults closed and disconnects observation on unmount", async () => {
    const { unmount } = await renderReady(fixture({ defaultOpen: false }));
    resize(1900);
    expect(dialog()).toBeNull();
    expect(resizeCallbacks.size).toBe(1);
    unmount();
    expect(resizeCallbacks.size).toBe(0);
  });
});
