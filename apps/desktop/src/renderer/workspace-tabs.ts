import type { ArtifactSession } from "@artemis/protocol";

export type WorkspaceTabKind =
  | "review"
  | "terminal"
  | "browser"
  | "file"
  | "office"
  | "design"
  | "markdown"
  | "sources"
  | "goal"
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
  artifactSessionId?: string | undefined;
}

export interface WorkspaceTabsState {
  tabs: WorkspaceTab[];
  activeTabId: string | undefined;
  dockOpen?: boolean | undefined;
}

export interface WorkspaceTabOpenOptions {
  forceNew?: boolean;
  path?: string;
  reuseKind?: boolean;
  revision?: string;
  url?: string;
}

export function findReusableWorkspaceTab(
  state: WorkspaceTabsState,
  kind: WorkspaceTabKind,
  options: WorkspaceTabOpenOptions = {},
): WorkspaceTab | undefined {
  if (options.forceNew) return undefined;
  return state.tabs.find(
    (tab) =>
      tab.kind === kind &&
      (options.reuseKind ||
        (!options.path && !options.url) ||
        (Boolean(options.path) && tab.path === options.path) ||
        (Boolean(options.url) && tab.url === options.url)),
  );
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
        Pick<
          WorkspaceTab,
          "title" | "path" | "revision" | "url" | "artifactSessionId"
        >
      >;
    };

export const emptyWorkspaceTabs = (): WorkspaceTabsState => ({
  tabs: [],
  activeTabId: undefined,
});

export function reconcileOfficeWorkspaceTab(
  state: WorkspaceTabsState,
  session: ArtifactSession,
  openIfMissing = false,
): WorkspaceTabsState {
  if (session.status === "closed") return state;
  const pathKey = (path: string) =>
    path.replaceAll("\\", "/").replace(/^\.\//u, "");
  const existing = state.tabs.find(
    (tab) =>
      tab.kind === "office" &&
      (tab.artifactSessionId === session.sessionId ||
        (tab.path && pathKey(tab.path) === pathKey(session.path))),
  );
  // Replayed document history describes artifacts, not the user's open tabs.
  if (!existing && !openIfMissing) return state;
  if (existing?.artifactSessionId === session.sessionId) return state;
  return reduceWorkspaceTabs(state, {
    type: "ensure",
    tab: {
      id: existing?.id ?? `office:${session.sessionId}`,
      kind: "office",
      title: session.path.split(/[\\/]/u).at(-1) ?? session.path,
      path: session.path,
      artifactSessionId: session.sessionId,
    },
  });
}

export function workspaceTabFocusTargetAfterClose(
  tabs: readonly WorkspaceTab[],
  closedTabId: string,
  activeTabId: string | undefined,
): string | undefined {
  // Closing a background tab keeps the current active tab, so focus must stay
  // there to preserve the roving-tabindex invariant.
  if (activeTabId !== undefined && closedTabId !== activeTabId) {
    return activeTabId;
  }
  const index = tabs.findIndex((tab) => tab.id === closedTabId);
  if (index < 0) return undefined;
  return tabs[index + 1]?.id ?? tabs[index - 1]?.id;
}

export type WorkspaceTabArrowKey = "ArrowLeft" | "ArrowRight" | "Home" | "End";

export function workspaceTabIdForKey(
  tabs: readonly WorkspaceTab[],
  activeTabId: string | undefined,
  key: WorkspaceTabArrowKey,
  rtl: boolean,
): string | undefined {
  if (tabs.length === 0) return undefined;
  // Home/End address the logical first/last tab and are RTL-independent.
  if (key === "Home") return tabs[0]!.id;
  if (key === "End") return tabs[tabs.length - 1]!.id;
  const baseDelta = key === "ArrowRight" ? 1 : -1;
  const delta = rtl ? -baseDelta : baseDelta;
  const currentIndex = tabs.findIndex((tab) => tab.id === activeTabId);
  if (currentIndex < 0) {
    // No active tab: land on the edge tab the direction points at.
    const fallbackIndex = delta > 0 ? 0 : tabs.length - 1;
    return tabs[fallbackIndex]!.id;
  }
  // WAI-ARIA Tabs pattern: wrap from last to first (forward) and from first
  // to last (backward) instead of clamping at the ends.
  const nextIndex = (currentIndex + delta + tabs.length) % tabs.length;
  return tabs[nextIndex]!.id;
}

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
    // History and live status may refresh an open page, never open one.
    return state.tabs.some((existing) => existing.id === tab.id)
      ? reduceWorkspaceTabs(state, { type: "ensure", tab })
      : state;
  }

  return {
    ...state,
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
      ...state,
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
        tab.id === action.tabId
          ? {
              ...tab,
              ...action.updates,
              ...("path" in action.updates && action.updates.path !== tab.path
                ? { artifactSessionId: undefined }
                : {}),
            }
          : tab,
      ),
    };
  }

  const closingIndex = state.tabs.findIndex((tab) => tab.id === action.tabId);
  if (closingIndex < 0) return state;
  const tabs = state.tabs.filter((tab) => tab.id !== action.tabId);
  if (state.activeTabId !== action.tabId) return { ...state, tabs };
  return {
    ...state,
    ...(tabs.length ? {} : { dockOpen: false }),
    tabs,
    activeTabId:
      state.tabs[closingIndex + 1]?.id ??
      state.tabs[closingIndex - 1]?.id ??
      undefined,
  };
}

export interface WorkspaceTabBarKeyboardDeps {
  tabs: readonly WorkspaceTab[];
  activeTabId: string | undefined;
  rtl: boolean;
  activate: (tabId: string) => void;
  focusTab: (tabId: string) => void;
}

/**
 * Keydown handler for the workspace tab bar. Navigation keys are honoured
 * only when the event originates from a tab button itself (not from close,
 * scroll, add, or menu controls that live inside the same bar), so focus is
 * never stolen from those controls.
 */
export function handleWorkspaceTabBarKeyDown(
  event: {
    key: string;
    target: EventTarget | null;
    preventDefault(): void;
  },
  deps: WorkspaceTabBarKeyboardDeps,
): void {
  const target = event.target;
  if (
    !(target instanceof HTMLElement) ||
    (!target.classList.contains("workspace-tab-select") &&
      !target.matches(
        '[data-artemis-component="workspace-tab"] > [data-part="select"]',
      ))
  ) {
    return;
  }
  const key = event.key;
  if (
    key !== "ArrowLeft" &&
    key !== "ArrowRight" &&
    key !== "Home" &&
    key !== "End"
  ) {
    return;
  }
  const nextId = workspaceTabIdForKey(
    deps.tabs,
    deps.activeTabId,
    key,
    deps.rtl,
  );
  if (!nextId) return;
  event.preventDefault();
  deps.activate(nextId);
  deps.focusTab(nextId);
}

/**
 * Stable DOM id for a workspace tab. Tab ids embed `:`, paths, and URLs, so
 * percent-encode and flatten them into a character class that is safe and
 * unique as a DOM id (WAI-ARIA Tabs: tab.id <-> pane aria-labelledby).
 */
export function workspaceTabDomId(tabId: string): string {
  return `workspace-tab-${encodeURIComponent(tabId).replace(/%/g, "-")}`;
}
