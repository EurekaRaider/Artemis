export type WorkspaceTabKind =
  | "review"
  | "terminal"
  | "browser"
  | "file"
  | "markdown"
  | "child-agent"
  | "agent-team";

export interface WorkspaceTab {
  id: string;
  kind: WorkspaceTabKind;
  title: string;
  path?: string | undefined;
  revision?: string | undefined;
  url?: string | undefined;
  childAgentId?: string;
  agentTeamId?: string;
}

export interface WorkspaceTabsState {
  tabs: WorkspaceTab[];
  activeTabId: string | undefined;
}

export type WorkspaceTabAction =
  | { type: "open"; tab: WorkspaceTab }
  | { type: "ensure"; tab: WorkspaceTab }
  | { type: "activate"; tabId: string }
  | { type: "close"; tabId: string }
  | {
      type: "update";
      tabId: string;
      updates: Partial<
        Pick<WorkspaceTab, "title" | "path" | "revision" | "url">
      >;
    };

export const emptyWorkspaceTabs = (): WorkspaceTabsState => ({
  tabs: [],
  activeTabId: undefined,
});

export function closesLastWorkspaceTab(
  state: WorkspaceTabsState,
  tabId: string,
): boolean {
  return state.tabs.length === 1 && state.tabs[0]?.id === tabId;
}

export function childAgentWorkspaceTab(
  agentId: string,
  label: string,
  agentTeamId?: string,
): WorkspaceTab {
  return {
    id: `child-agent:${agentId}`,
    kind: "child-agent",
    title: label,
    childAgentId: agentId,
    ...(agentTeamId ? { agentTeamId } : {}),
  };
}

export function agentTeamWorkspaceTab(
  teamId: string,
  title: string,
): WorkspaceTab {
  return {
    id: `agent-team:${teamId}`,
    kind: "agent-team",
    title,
    agentTeamId: teamId,
  };
}

export function reconcileAgentTeamWorkspaceTab(
  state: WorkspaceTabsState,
  tab: WorkspaceTab,
): WorkspaceTabsState {
  const replacesPreviousTeam = state.tabs.some(
    (existing) =>
      (existing.kind === "agent-team" || existing.kind === "child-agent") &&
      existing.agentTeamId !== undefined &&
      existing.agentTeamId !== tab.agentTeamId,
  );
  if (!replacesPreviousTeam) {
    return reduceWorkspaceTabs(state, { type: "ensure", tab });
  }

  return {
    tabs: [
      ...state.tabs.filter(
        (existing) =>
          existing.kind !== "agent-team" && existing.kind !== "child-agent",
      ),
      tab,
    ],
    activeTabId: tab.id,
  };
}

export function reduceWorkspaceTabs(
  state: WorkspaceTabsState,
  action: WorkspaceTabAction,
): WorkspaceTabsState {
  if (action.type === "open" || action.type === "ensure") {
    const existingIndex = state.tabs.findIndex(
      (tab) => tab.id === action.tab.id,
    );
    const tabs =
      existingIndex < 0
        ? [...state.tabs, action.tab]
        : state.tabs.map((tab, index) =>
            index === existingIndex ? action.tab : tab,
          );
    return {
      tabs,
      activeTabId:
        action.type === "ensure" && state.activeTabId
          ? state.activeTabId
          : action.tab.id,
    };
  }

  if (action.type === "activate") {
    return state.tabs.some((tab) => tab.id === action.tabId)
      ? { ...state, activeTabId: action.tabId }
      : state;
  }

  if (action.type === "update") {
    if (!state.tabs.some((tab) => tab.id === action.tabId)) return state;
    return {
      ...state,
      tabs: state.tabs.map((tab) =>
        tab.id === action.tabId ? { ...tab, ...action.updates } : tab,
      ),
    };
  }

  const closingIndex = state.tabs.findIndex((tab) => tab.id === action.tabId);
  if (closingIndex < 0) return state;
  const tabs = state.tabs.filter((tab) => tab.id !== action.tabId);
  if (state.activeTabId !== action.tabId) return { ...state, tabs };
  return {
    tabs,
    activeTabId:
      state.tabs[closingIndex + 1]?.id ??
      state.tabs[closingIndex - 1]?.id ??
      undefined,
  };
}
