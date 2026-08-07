import { describe, expect, it, vi } from "vitest";

type WorkspaceTabKind =
  "review" | "terminal" | "file" | "markdown" | "child-agent" | "agent-team";

interface WorkspaceTab {
  id: string;
  kind: WorkspaceTabKind;
  title: string;
  path?: string;
  childAgentId?: string;
  agentTeamId?: string;
}

interface WorkspaceTabsState {
  tabs: WorkspaceTab[];
  activeTabId: string | undefined;
}

type WorkspaceTabAction =
  | { type: "open"; tab: WorkspaceTab }
  | { type: "ensure"; tab: WorkspaceTab }
  | { type: "activate"; tabId: string }
  | { type: "close"; tabId: string };

interface WorkspaceTabsModule {
  agentTeamWorkspaceTab(teamId: string, title: string): WorkspaceTab;
  childAgentWorkspaceTab(
    agentId: string,
    label: string,
    teamId?: string,
  ): WorkspaceTab;
  closesLastWorkspaceTab(state: WorkspaceTabsState, tabId: string): boolean;
  reconcileAgentTeamWorkspaceTab(
    state: WorkspaceTabsState,
    tab: WorkspaceTab,
  ): WorkspaceTabsState;
  reduceWorkspaceTabs(
    state: WorkspaceTabsState,
    action: WorkspaceTabAction,
  ): WorkspaceTabsState;
}

const workspaceTabsModule = "../src/renderer/workspace-tabs.js";

async function loadReducer(): Promise<
  WorkspaceTabsModule["reduceWorkspaceTabs"]
> {
  const module =
    await vi.importActual<WorkspaceTabsModule>(workspaceTabsModule);

  expect(module.reduceWorkspaceTabs).toBeTypeOf("function");
  return module.reduceWorkspaceTabs;
}

async function loadWorkspaceTabs(): Promise<WorkspaceTabsModule> {
  const module =
    await vi.importActual<WorkspaceTabsModule>(workspaceTabsModule);

  expect(module.childAgentWorkspaceTab).toBeTypeOf("function");
  expect(module.reconcileAgentTeamWorkspaceTab).toBeTypeOf("function");
  expect(module.reduceWorkspaceTabs).toBeTypeOf("function");
  return module;
}

function emptyState(): WorkspaceTabsState {
  return { tabs: [], activeTabId: undefined };
}

describe("workspace tab state", () => {
  it("opens Review, Terminal, file, and Markdown as independently closable tabs", async () => {
    const reduce = await loadReducer();
    const tabs: WorkspaceTab[] = [
      { id: "review-1", kind: "review", title: "Review" },
      { id: "terminal-1", kind: "terminal", title: "Terminal" },
      {
        id: "file-1",
        kind: "file",
        title: "settings.json",
        path: "settings.json",
      },
      {
        id: "markdown-1",
        kind: "markdown",
        title: "README.md",
        path: "README.md",
      },
    ];

    const opened = tabs.reduce(
      (state, tab) => reduce(state, { type: "open", tab }),
      emptyState(),
    );
    const afterClose = reduce(opened, {
      type: "close",
      tabId: "review-1",
    });

    expect(opened.tabs).toEqual(tabs);
    expect(opened.activeTabId).toBe("markdown-1");
    expect(afterClose.tabs.map((tab) => tab.id)).toEqual([
      "terminal-1",
      "file-1",
      "markdown-1",
    ]);
    expect(afterClose.activeTabId).toBe("markdown-1");
  });

  it("keeps multiple instances created through add-tab actions", async () => {
    const reduce = await loadReducer();
    const first = reduce(emptyState(), {
      type: "open",
      tab: { id: "terminal-1", kind: "terminal", title: "Terminal 1" },
    });
    const second = reduce(first, {
      type: "open",
      tab: { id: "terminal-2", kind: "terminal", title: "Terminal 2" },
    });
    const third = reduce(second, {
      type: "open",
      tab: {
        id: "file-2",
        kind: "file",
        title: "notes.txt",
        path: "notes.txt",
      },
    });

    expect(third.tabs.map(({ id, kind }) => ({ id, kind }))).toEqual([
      { id: "terminal-1", kind: "terminal" },
      { id: "terminal-2", kind: "terminal" },
      { id: "file-2", kind: "file" },
    ]);
    expect(third.activeTabId).toBe("file-2");
  });

  it("switches active tabs and falls back to the right then left when closing", async () => {
    const reduce = await loadReducer();
    const populated = [
      { id: "review-1", kind: "review", title: "Review" },
      { id: "terminal-1", kind: "terminal", title: "Terminal" },
      {
        id: "file-1",
        kind: "file",
        title: "app.ts",
        path: "src/app.ts",
      },
    ].reduce(
      (state, tab) =>
        reduce(state, {
          type: "open",
          tab: tab as WorkspaceTab,
        }),
      emptyState(),
    );

    const terminalActive = reduce(populated, {
      type: "activate",
      tabId: "terminal-1",
    });
    const afterMiddleClose = reduce(terminalActive, {
      type: "close",
      tabId: "terminal-1",
    });
    const afterRightClose = reduce(afterMiddleClose, {
      type: "close",
      tabId: "file-1",
    });
    const afterLastClose = reduce(afterRightClose, {
      type: "close",
      tabId: "review-1",
    });

    expect(terminalActive.activeTabId).toBe("terminal-1");
    expect(afterMiddleClose.activeTabId).toBe("file-1");
    expect(afterMiddleClose.tabs.map((tab) => tab.id)).toEqual([
      "review-1",
      "file-1",
    ]);
    expect(afterRightClose.activeTabId).toBe("review-1");
    expect(afterLastClose).toEqual(emptyState());
  });

  it("distinguishes closing the sole tab from an already-empty or populated dock", async () => {
    const module =
      await vi.importActual<WorkspaceTabsModule>(workspaceTabsModule);

    expect(module.closesLastWorkspaceTab).toBeTypeOf("function");

    const onlyTab = module.reduceWorkspaceTabs(emptyState(), {
      type: "open",
      tab: { id: "review-1", kind: "review", title: "Review" },
    });
    const twoTabs = module.reduceWorkspaceTabs(onlyTab, {
      type: "open",
      tab: { id: "terminal-1", kind: "terminal", title: "Terminal" },
    });

    expect(module.closesLastWorkspaceTab(onlyTab, "review-1")).toBe(true);
    expect(module.closesLastWorkspaceTab(emptyState(), "review-1")).toBe(false);
    expect(module.closesLastWorkspaceTab(onlyTab, "missing-tab")).toBe(false);
    expect(module.closesLastWorkspaceTab(twoTabs, "review-1")).toBe(false);
  });

  it("opens, switches, and closes child-agent views without mutating agent state", async () => {
    const { childAgentWorkspaceTab, reduceWorkspaceTabs: reduce } =
      await loadWorkspaceTabs();
    const testingAgent = childAgentWorkspaceTab(
      "agent-testing",
      "Code testing generator",
    );
    const researchAgent = childAgentWorkspaceTab(
      "agent-research",
      "Research agent",
    );

    const firstOpen = reduce(emptyState(), {
      type: "open",
      tab: testingAgent,
    });
    const bothOpen = reduce(firstOpen, {
      type: "open",
      tab: researchAgent,
    });
    const testingActive = reduce(bothOpen, {
      type: "activate",
      tabId: testingAgent.id,
    });
    const afterViewClose = reduce(testingActive, {
      type: "close",
      tabId: testingAgent.id,
    });

    expect(testingAgent).toEqual({
      id: "child-agent:agent-testing",
      kind: "child-agent",
      title: "Code testing generator",
      childAgentId: "agent-testing",
    });
    expect(bothOpen.tabs).toEqual([testingAgent, researchAgent]);
    expect(bothOpen.activeTabId).toBe(researchAgent.id);
    expect(testingActive.activeTabId).toBe(testingAgent.id);
    expect(afterViewClose).toEqual({
      tabs: [researchAgent],
      activeTabId: researchAgent.id,
    });
    expect(Object.keys(afterViewClose).sort()).toEqual(["activeTabId", "tabs"]);
  });

  it("adds an agent-team tab without stealing an existing workspace focus", async () => {
    const { agentTeamWorkspaceTab, reduceWorkspaceTabs: reduce } =
      await loadWorkspaceTabs();
    const existing = reduce(emptyState(), {
      type: "open",
      tab: { id: "terminal-1", kind: "terminal", title: "Terminal" },
    });
    const teamTab = agentTeamWorkspaceTab("team-1", "Agent team");
    const withTeam = reduce(existing, { type: "ensure", tab: teamTab });

    expect(teamTab).toEqual({
      id: "agent-team:team-1",
      kind: "agent-team",
      title: "Agent team",
      agentTeamId: "team-1",
    });
    expect(withTeam.tabs).toEqual([existing.tabs[0], teamTab]);
    expect(withTeam.activeTabId).toBe("terminal-1");
  });

  it("replaces stopped team pages when a continued task starts a new team", async () => {
    const {
      agentTeamWorkspaceTab,
      childAgentWorkspaceTab,
      reconcileAgentTeamWorkspaceTab,
      reduceWorkspaceTabs: reduce,
    } = await loadWorkspaceTabs();
    const terminalTab: WorkspaceTab = {
      id: "terminal-1",
      kind: "terminal",
      title: "Terminal",
    };
    const withTerminal = reduce(emptyState(), {
      type: "open",
      tab: terminalTab,
    });
    const stoppedTeamTab = agentTeamWorkspaceTab("team-stopped", "Agent team");
    const withStoppedTeam = reconcileAgentTeamWorkspaceTab(
      withTerminal,
      stoppedTeamTab,
    );
    const stoppedChildTab = childAgentWorkspaceTab(
      "agent-stopped",
      "Stopped agent",
      "team-stopped",
    );
    const withStoppedChild = reduce(withStoppedTeam, {
      type: "open",
      tab: stoppedChildTab,
    });
    const continuedTeamTab = agentTeamWorkspaceTab(
      "team-continued",
      "Agent team",
    );
    const continued = reconcileAgentTeamWorkspaceTab(
      withStoppedChild,
      continuedTeamTab,
    );

    expect(stoppedChildTab.agentTeamId).toBe("team-stopped");
    expect(withStoppedTeam.activeTabId).toBe(terminalTab.id);
    expect(continued.tabs).toEqual([terminalTab, continuedTeamTab]);
    expect(continued.activeTabId).toBe(continuedTeamTab.id);
  });
});
