import {
  EMPTY_WORKSPACE_TAB_SCROLL_STATE,
  WORKSPACE_TAB_SCROLL_INSET,
} from "./controller-values.js";
import { appCopy } from "../app-copy.js";
import { type WorkspaceTabScrollState } from "../app-types.js";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  type SetStateAction,
  type WheelEvent as ReactWheelEvent,
} from "react";

import type { WorkspaceFileLink } from "../../../shared/api.js";

import { flushWorkspaceEdits } from "../../workspace/workspace-autosave.js";

import {
  closesLastWorkspaceTab,
  emptyWorkspaceTabs,
  findReusableWorkspaceTab,
  reduceWorkspaceTabs,
  type WorkspaceTab,
  type WorkspaceTabAction,
  type WorkspaceTabKind,
  type WorkspaceTabOpenOptions,
  workspaceTabFocusTargetAfterClose,
} from "../../workspace/workspace-tabs.js";

interface UseWorkspaceTabsControllerContext {
  readonly workspaceTabsByThread: Record<
    string,
    import("../../workspace/workspace-tabs.js").WorkspaceTabsState
  >;
  readonly activeThreadId: string | undefined;
  readonly workspaceTabScroll: import("react").RefObject<HTMLDivElement | null>;
  readonly workspaceTabTrack: import("react").RefObject<HTMLDivElement | null>;
  readonly setWorkspaceTabScrollState: import("react").Dispatch<
    import("react").SetStateAction<WorkspaceTabScrollState>
  >;
  readonly workspaceDockOpen: boolean;
  readonly workspaceTabScrollState: WorkspaceTabScrollState;
  readonly activeWorkspaceTabElement: import("react").RefObject<HTMLDivElement | null>;
  readonly t: ReturnType<typeof appCopy>;
  readonly setWorkspaceTabsByThread: (
    update: SetStateAction<
      Record<
        string,
        import("../../workspace/workspace-tabs.js").WorkspaceTabsState
      >
    >,
  ) => void;
  readonly setFailedTabClose: import("react").Dispatch<
    import("react").SetStateAction<
      | {
          tabId: string;
          threadId: string;
          path: string;
          message: string;
        }
      | undefined
    >
  >;
  readonly activeThreadIdRef: import("react").RefObject<string | undefined>;
  readonly workspaceDockToggleElement: import("react").RefObject<HTMLButtonElement | null>;
  readonly focusWorkspaceTab: (tabId: string | undefined) => void;
  readonly setWorkspaceDockOpen: (update: SetStateAction<boolean>) => void;
  readonly setWorkspaceTabMenuOpen: import("react").Dispatch<
    SetStateAction<boolean>
  >;
  readonly ensureWorkspaceThread: () => Promise<string | undefined>;
}
export function useWorkspaceTabsController(
  context: UseWorkspaceTabsControllerContext,
) {
  const {
    workspaceTabsByThread,
    activeThreadId,
    workspaceTabScroll,
    workspaceTabTrack,
    setWorkspaceTabScrollState,
    workspaceDockOpen,
    workspaceTabScrollState,
    activeWorkspaceTabElement,
    t,
    setWorkspaceTabsByThread,
    setFailedTabClose,
    activeThreadIdRef,
    workspaceDockToggleElement,
    focusWorkspaceTab,
    setWorkspaceDockOpen,
    setWorkspaceTabMenuOpen,
    ensureWorkspaceThread,
  } = context;
  const workspaceTabs = activeThreadId
    ? (workspaceTabsByThread[activeThreadId] ?? emptyWorkspaceTabs())
    : emptyWorkspaceTabs();
  const activeWorkspaceTab = workspaceTabs.tabs.find(
    (tab) => tab.id === workspaceTabs.activeTabId,
  );

  const syncWorkspaceTabScrollState = useCallback(() => {
    const scroll = workspaceTabScroll.current;
    const track = workspaceTabTrack.current;
    if (!scroll || !track) return;

    const hasOverflow = track.scrollWidth > scroll.clientWidth + 1;
    const maxScrollLeft = Math.max(0, scroll.scrollWidth - scroll.clientWidth);
    const nextState: WorkspaceTabScrollState = {
      hasOverflow,
      canScrollLeft: hasOverflow && scroll.scrollLeft > 1,
      canScrollRight: hasOverflow && scroll.scrollLeft < maxScrollLeft - 1,
    };
    setWorkspaceTabScrollState((current) =>
      current.hasOverflow === nextState.hasOverflow &&
      current.canScrollLeft === nextState.canScrollLeft &&
      current.canScrollRight === nextState.canScrollRight
        ? current
        : nextState,
    );
  }, []);

  const scrollWorkspaceTabs = useCallback((direction: -1 | 1) => {
    const scroll = workspaceTabScroll.current;
    if (!scroll) return;
    scroll.scrollBy({
      behavior: "smooth",
      left: direction * Math.max(160, scroll.clientWidth * 0.72),
    });
  }, []);

  const handleWorkspaceTabWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      const scroll = event.currentTarget;
      const maxScrollLeft = Math.max(
        0,
        scroll.scrollWidth - scroll.clientWidth,
      );
      if (maxScrollLeft <= 0) return;

      const rawDelta =
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX
          : event.deltaY;
      const deltaScale =
        event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? scroll.clientWidth
            : 1;
      const nextScrollLeft = Math.max(
        0,
        Math.min(maxScrollLeft, scroll.scrollLeft + rawDelta * deltaScale),
      );
      if (Math.abs(nextScrollLeft - scroll.scrollLeft) < 0.5) return;

      event.preventDefault();
      scroll.scrollLeft = nextScrollLeft;
      syncWorkspaceTabScrollState();
    },
    [syncWorkspaceTabScrollState],
  );

  useLayoutEffect(() => {
    const scroll = workspaceTabScroll.current;
    const track = workspaceTabTrack.current;
    if (!workspaceDockOpen || !scroll || !track) {
      setWorkspaceTabScrollState((current) =>
        current.hasOverflow || current.canScrollLeft || current.canScrollRight
          ? EMPTY_WORKSPACE_TAB_SCROLL_STATE
          : current,
      );
      return;
    }

    syncWorkspaceTabScrollState();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(syncWorkspaceTabScrollState);
    observer.observe(scroll);
    observer.observe(track);
    return () => observer.disconnect();
  }, [
    activeThreadId,
    syncWorkspaceTabScrollState,
    workspaceDockOpen,
    workspaceTabScrollState.hasOverflow,
  ]);

  useLayoutEffect(() => {
    const scroll = workspaceTabScroll.current;
    const activeTab = activeWorkspaceTabElement.current;
    if (!workspaceDockOpen || !scroll || !activeTab) return;

    const scrollBounds = scroll.getBoundingClientRect();
    const activeBounds = activeTab.getBoundingClientRect();
    const edgeInset = workspaceTabScrollState.hasOverflow
      ? WORKSPACE_TAB_SCROLL_INSET
      : 0;
    const hiddenLeft = activeBounds.left - (scrollBounds.left + edgeInset);
    const hiddenRight = activeBounds.right - (scrollBounds.right - edgeInset);
    const scrollDelta =
      hiddenLeft < 0 ? hiddenLeft : hiddenRight > 0 ? hiddenRight : 0;
    if (Math.abs(scrollDelta) > 1) {
      scroll.scrollBy({ behavior: "smooth", left: scrollDelta });
    }
  }, [
    activeWorkspaceTab?.id,
    workspaceDockOpen,
    workspaceTabScrollState.hasOverflow,
  ]);

  const workspaceTabBaseTitle = useCallback(
    (kind: WorkspaceTabKind) => {
      if (kind === "review") return t.reviewPanel;
      if (kind === "design") return t.designTab;
      if (kind === "terminal") return t.terminal;
      if (kind === "browser") return t.browser;
      if (kind === "markdown") return t.markdownReader;
      if (kind === "sources") return t.sources;
      if (kind === "goal") return t.goalEditTitle;
      if (kind === "agent-team") return t.agentTeam;
      return t.files;
    },
    [t],
  );

  const dispatchWorkspaceTab = useCallback(
    (action: WorkspaceTabAction) => {
      if (!activeThreadId) return;
      setWorkspaceTabsByThread((current) => ({
        ...current,
        [activeThreadId]: reduceWorkspaceTabs(
          current[activeThreadId] ?? emptyWorkspaceTabs(),
          action,
        ),
      }));
    },
    [activeThreadId],
  );

  const closeWorkspaceTab = useCallback(
    async (tabId: string, options?: { moveFocus?: boolean }) => {
      const tab = workspaceTabs.tabs.find((value) => value.id === tabId);
      try {
        if (tab?.path) await flushWorkspaceEdits(activeThreadId, tab.path);
      } catch (error) {
        if (tab?.path && activeThreadId) {
          dispatchWorkspaceTab({ type: "activate", tabId });
          setFailedTabClose({
            tabId,
            threadId: activeThreadId,
            path: tab.path,
            message: String(error),
          });
        }
        return;
      }
      setFailedTabClose(undefined);
      if (tab?.kind === "browser" && activeThreadId)
        await window.artemis
          .browserSession({ action: "close", threadId: activeThreadId, tabId })
          .catch(() => {});
      const closesLastTab = closesLastWorkspaceTab(workspaceTabs, tabId);
      const focusTarget = workspaceTabFocusTargetAfterClose(
        workspaceTabs.tabs,
        tabId,
        workspaceTabs.activeTabId,
      );
      dispatchWorkspaceTab({ type: "close", tabId });
      if (activeThreadIdRef.current !== activeThreadId) return;
      if (closesLastTab) {
        if (options?.moveFocus) {
          requestAnimationFrame(() => {
            workspaceDockToggleElement.current?.focus({ preventScroll: true });
          });
        }
        return;
      }
      if (options?.moveFocus) {
        focusWorkspaceTab(focusTarget);
      }
    },
    [activeThreadId, dispatchWorkspaceTab, focusWorkspaceTab, workspaceTabs],
  );

  const openWorkspaceTabForThread = useCallback(
    (
      threadId: string,
      kind: WorkspaceTabKind,
      options: WorkspaceTabOpenOptions = {},
    ) => {
      setWorkspaceTabsByThread((current) => {
        const state = current[threadId] ?? emptyWorkspaceTabs();
        const existing = findReusableWorkspaceTab(state, kind, options);
        const pathTitle = options.path?.replaceAll("\\", "/").split("/").at(-1);
        const baseTitle = workspaceTabBaseTitle(kind);
        if (existing) {
          const updated = reduceWorkspaceTabs(state, {
            type: "update",
            tabId: existing.id,
            updates: {
              ...(pathTitle
                ? { title: pathTitle }
                : options.url
                  ? { title: baseTitle }
                  : {}),
              ...(options.path ? { path: options.path, url: undefined } : {}),
              ...(options.url
                ? { path: undefined, revision: undefined, url: options.url }
                : {}),
              ...(options.revision ? { revision: options.revision } : {}),
            },
          });
          return {
            ...current,
            [threadId]: {
              ...reduceWorkspaceTabs(updated, {
                type: "activate",
                tabId: existing.id,
              }),
              dockOpen: true,
            },
          };
        }

        const index = state.tabs.filter((tab) => tab.kind === kind).length + 1;
        const tab: WorkspaceTab = {
          id: `${threadId}-${kind}-${crypto.randomUUID()}`,
          kind,
          title: pathTitle ?? (index > 1 ? `${baseTitle} ${index}` : baseTitle),
          ...(options.path ? { path: options.path } : {}),
          ...(options.revision ? { revision: options.revision } : {}),
          ...(options.url ? { url: options.url } : {}),
        };
        return {
          ...current,
          [threadId]: {
            ...reduceWorkspaceTabs(state, {
              type: "open",
              tab,
            }),
            dockOpen: true,
          },
        };
      });
    },
    [workspaceTabBaseTitle],
  );

  const openWorkspaceTab = useCallback(
    async (kind: WorkspaceTabKind, options: WorkspaceTabOpenOptions = {}) => {
      setWorkspaceDockOpen(true);
      setWorkspaceTabMenuOpen(false);
      const threadId = activeThreadId ?? (await ensureWorkspaceThread());
      if (threadId) openWorkspaceTabForThread(threadId, kind, options);
      return threadId;
    },
    [activeThreadId, ensureWorkspaceThread, openWorkspaceTabForThread],
  );

  const openResolvedWorkspaceFile = useCallback(
    (file: WorkspaceFileLink) => {
      openWorkspaceTab(file.viewer, { path: file.path });
    },
    [openWorkspaceTab],
  );

  // 子窗口菜单回包：选择=开对应面板（design 复用既有 tab）；无选择关闭
  // （点外/Escape/父窗移动）只复位"+"按钮的展开态。
  useEffect(() => {
    return window.artemis.onWorkspaceTabMenuSelect((kind) => {
      setWorkspaceTabMenuOpen(false);
      openWorkspaceTab(
        kind,
        kind === "design" ? { reuseKind: true } : { forceNew: true },
      );
    });
  }, [openWorkspaceTab]);

  useEffect(() => {
    return window.artemis.onWorkspaceTabMenuClosed(() => {
      setWorkspaceTabMenuOpen(false);
    });
  }, []);
  return {
    workspaceTabs,
    activeWorkspaceTab,
    syncWorkspaceTabScrollState,
    scrollWorkspaceTabs,
    handleWorkspaceTabWheel,
    dispatchWorkspaceTab,
    closeWorkspaceTab,
    openWorkspaceTab,
    openResolvedWorkspaceFile,
  };
}
