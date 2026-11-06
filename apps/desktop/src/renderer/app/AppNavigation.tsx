const PROJECT_THREAD_PREVIEW_LIMIT = 5;

import { PanelHeader } from "@artemis/ui/layout";
import { SearchIcon } from "./app-icons.js";
import { LeftSidebarIcon } from "./app-icons.js";
import { SidebarUpdateControl } from "../updates/SidebarUpdateControl.js";
import { SettingsIcon } from "./app-icons.js";
import { NavigationSidebar } from "@artemis/ui/surfaces";
import { Keycap } from "@artemis/ui/actions";
import { ThreadWaitingBadge } from "../conversation/ThreadStatusIndicator.js";
import { ThreadTitleContent } from "./thread-presentation.js";
import { ImThreadConnection } from "../im/ImThreadConnection.js";
import { ThreadChannelMark } from "./thread-presentation.js";
import { ThreadStatusIndicator } from "../conversation/ThreadStatusIndicator.js";
import { Popover } from "@artemis/ui/feedback";
import { FolderIcon } from "./app-icons.js";
import { Tooltip } from "@artemis/ui/feedback";
import { PlusIcon } from "./app-icons.js";
import { ChevronIcon } from "./app-icons.js";

import { ArtemisMark } from "./app-icons.js";

import { ArtemisIcon } from "@artemis/ui/icons";

import {
  visibleThreadTitle,
  prepareThreadTitleScroll,
} from "./thread-presentation.js";

import { appCopy } from "./app-copy.js";
import {
  type ActiveView,
  type SettingsEntryTab,
  type ToastContent,
} from "./app-types.js";

import { sidebarUpdateSubtitle } from "../updates/SidebarUpdateControl.js";

import type { HookQuery } from "@artemis/protocol";

import { type ThreadHistoryPage } from "../../shared/thread-history.js";

import { uiText } from "../../shared/i18n/ui-text.js";

import {
  type KeyboardEvent as ReactKeyboardEvent,
  type SetStateAction,
} from "react";

import { type Project, type Thread } from "@artemis/protocol";
import type { DesktopSnapshot, SettingsSnapshot } from "../../shared/api.js";

import { handleProjectTreeKeyDown } from "./project-thread-tree.js";

import {
  isWorkspaceDraftThread,
  orderProjectThreadsByPreference,
  reorderThreadIds,
  sortProjectThreads,
  type ThreadDropEdge,
} from "./thread-list-order.js";
import { userInitials } from "./user-profile.js";

import { formatSidebarTime } from "./project-sidebar-layout.js";
import { reorderProjectIds, type ProjectDropEdge } from "./project-order.js";

export type AppNavigationProps = {
  t: ReturnType<typeof appCopy>;
  projectsExpanded: boolean;
  toggleProjectsExpansion: () => void;
  hasExpandedProject: boolean;
  projects: {
    id: string;
    name: string;
    path: string;
    createdAt: string;
    updatedAt: string;
  }[];
  setProjectHistoriesCollapsed: (
    projectIds: readonly string[],
    collapsed: boolean,
  ) => void;
  locale:
    | "ar"
    | "de"
    | "en"
    | "es"
    | "fr"
    | "hi"
    | "id"
    | "it"
    | "ja"
    | "ko"
    | "pt-BR"
    | "ru"
    | "zh-CN"
    | "zh-TW";
  openProject: () => Promise<void>;
  snapshot: DesktopSnapshot;
  query: string;
  imThreadStatus: Record<
    string,
    import("../im/ImThreadConnection.js").ThreadConnection
  >;
  promptSubmittedAtByThread: Record<string, number>;
  runtimeSettings: SettingsSnapshot | undefined;
  expandedProjectIds: Set<string>;
  collapsedProjectIds: Set<string>;
  toggleProjectHistory: (projectId: string) => void;
  beginNewConversation: (projectId?: string | undefined) => void;
  projectMenuId: string | undefined;
  projectMenuAnchor: import("react").RefObject<HTMLButtonElement | null>;
  setThreadMenuId: import("react").Dispatch<SetStateAction<string | undefined>>;
  setProjectMenuId: import("react").Dispatch<
    SetStateAction<string | undefined>
  >;
  setAutomationDraftRequest: import("react").Dispatch<
    SetStateAction<
      | {
          projectId: string;
          token: number;
        }
      | undefined
    >
  >;
  setActiveView: import("react").Dispatch<SetStateAction<ActiveView>>;
  setProjectInstructionsProject: import("react").Dispatch<
    SetStateAction<
      | {
          id: string;
          name: string;
          path: string;
          createdAt: string;
          updatedAt: string;
        }
      | undefined
    >
  >;
  setHooksQuery: import("react").Dispatch<SetStateAction<HookQuery>>;
  openSettings: (tab: SettingsEntryTab, trigger: HTMLButtonElement) => void;
  updateProjectThreads: (
    project: Project,
    operation: "archive" | "delete",
  ) => Promise<void>;
  removeProject: (project: Project) => Promise<void>;
  activeProjectId: string | undefined;
  setDraggedProjectId: import("react").Dispatch<
    SetStateAction<string | undefined>
  >;
  setProjectDropTarget: import("react").Dispatch<
    SetStateAction<
      | {
          projectId: string;
          edge: ProjectDropEdge;
        }
      | undefined
    >
  >;
  historyPages: Record<string, ThreadHistoryPage>;
  clockMs: number;
  taskShortcut: (
    event: ReactKeyboardEvent<HTMLElement>,
    thread: Thread,
  ) => void;
  discardNewConversationDraft: () => void;
  setActiveProjectId: import("react").Dispatch<
    SetStateAction<string | undefined>
  >;
  setActiveThreadId: import("react").Dispatch<
    SetStateAction<string | undefined>
  >;
  setMode: import("react").Dispatch<
    SetStateAction<"codemode" | "plan" | "work">
  >;
  threadMenuId: string | undefined;
  threadMenuAnchor: import("react").RefObject<HTMLButtonElement | null>;
  beginRenameThread: (thread: Thread) => void;
  forkThread: (thread: Thread) => Promise<void>;
  setSharingThreadId: import("react").Dispatch<
    SetStateAction<string | undefined>
  >;
  copyTaskLink: (id: string) => Promise<void>;
  setThreadArchived: (
    thread: Thread,
    archived: boolean,
    bulk?: boolean,
  ) => Promise<boolean | undefined>;
  deleteThread: (
    thread: Thread,
    confirmed?: boolean,
  ) => Promise<boolean | undefined>;
  activeThreadId: string | undefined;
  draggedThread:
    | {
        projectId: string;
        threadId: string;
      }
    | undefined;
  threadDropTarget:
    | {
        projectId: string;
        threadId: string;
        edge: ThreadDropEdge;
      }
    | undefined;
  threadRename:
    | {
        threadId: string;
        title: string;
      }
    | undefined;
  setTreeActiveRowId: import("react").Dispatch<
    SetStateAction<string | undefined>
  >;
  treeActiveRowId: string | undefined;
  setDraggedThread: import("react").Dispatch<
    SetStateAction<
      | {
          projectId: string;
          threadId: string;
        }
      | undefined
    >
  >;
  setThreadDropTarget: import("react").Dispatch<
    SetStateAction<
      | {
          projectId: string;
          threadId: string;
          edge: ThreadDropEdge;
        }
      | undefined
    >
  >;
  persistProjectThreadOrder: (
    projectId: string,
    order: string[],
    previousOrder: string[],
  ) => Promise<void>;
  toggleProjectPreview: (projectId: string) => void;
  draggedProjectId: string | undefined;
  projectDropTarget:
    | {
        projectId: string;
        edge: ProjectDropEdge;
      }
    | undefined;
  persistProjectOrder: (
    order: string[],
    previousOrder: string[],
  ) => Promise<void> | undefined;
  temporaryConversationsOpen: boolean;
  toggleTemporaryConversations: () => void;
  beginTemporaryConversation: () => void;
  temporaryThreads: {
    notification?:
      | {
          revision: number;
          seq: number;
          unread: boolean;
          kind?:
            | "approval-required"
            | "assigned"
            | "completed"
            | "failed"
            | "input-required"
            | undefined;
        }
      | undefined;
    id: string;
    projectId?: string | undefined;
    title: string;
    goal?:
      | {
          threadId: string;
          goalId: string;
          objective: string;
          status:
            | "active"
            | "blocked"
            | "budgetLimited"
            | "complete"
            | "paused"
            | "usageLimited";
          tokenBudget?: number | undefined;
          tokensUsed: number;
          timeUsedSeconds: number;
          revision: number;
          createdAt: string;
          updatedAt: string;
        }
      | undefined;
    mode: "codemode" | "plan" | "work";
    target: "local" | "managed-worktree" | "permanent-worktree";
    status: "failed" | "idle" | "running" | "waiting-approval";
    sessionFile?: string | undefined;
    modelSelection?:
      | {
          providerId: string;
          modelId: string;
          thinkingLevel:
            "high" | "low" | "max" | "medium" | "minimal" | "off" | "xhigh";
          ultraMode?: boolean | undefined;
        }
      | undefined;
    contextWindow?: number | undefined;
    pinned: boolean;
    archived: boolean;
    typeBinding?:
      | {
          installationId: string;
          pluginId: string;
          typeId: string;
          pluginVersion: string;
          contentHash: string;
          bindingRevision: string;
        }
      | undefined;
    executionProfile?: string | undefined;
    createdAt: string;
    updatedAt: string;
  }[];
  projectTreeElement: import("react").RefObject<HTMLDivElement | null>;
  focusProjectTreeRow: (rowId: string) => void;
  collapseProjectTreeRow: (rowId: string) => void;
  expandProjectTreeRow: (rowId: string) => void;
  activateProjectTreeRow: (rowId: string) => void;
  sidebarPeek: boolean;
  sidebarOpen: boolean;
  requestSidebarPeek: () => void;
  sidebarHoverSuppressed: import("react").RefObject<boolean>;
  closeSidebarPeek: () => void;
  projectSidebar: import("react").RefObject<HTMLElement | null>;
  changeSidebarOpen: (open: boolean | ((current: boolean) => boolean)) => void;
  activeView: ActiveView;
  navigationItems: readonly [
    readonly ["resources", string, import("react").JSX.Element],
    readonly ["automations", string, import("react").JSX.Element],
    readonly ["token-usage", string, import("react").JSX.Element],
    readonly ["archive", string, import("react").JSX.Element],
  ];
  activeWorkspaceLabel: string;
  username: string;
  updateNoticeTarget: HTMLDivElement | null;
  setRuntimeSettings: import("react").Dispatch<
    SetStateAction<SettingsSnapshot | undefined>
  >;
  setToast: (content: ToastContent | undefined) => void;
  sidebarSearchInput: import("react").RefObject<HTMLInputElement | null>;
  setQuery: import("react").Dispatch<SetStateAction<string>>;
  automationCount: number | undefined;
};
export function AppNavigation({
  t,
  projectsExpanded,
  toggleProjectsExpansion,
  hasExpandedProject,
  projects,
  setProjectHistoriesCollapsed,
  locale,
  openProject,
  snapshot,
  query,
  imThreadStatus,
  promptSubmittedAtByThread,
  runtimeSettings,
  expandedProjectIds,
  collapsedProjectIds,
  toggleProjectHistory,
  beginNewConversation,
  projectMenuId,
  projectMenuAnchor,
  setThreadMenuId,
  setProjectMenuId,
  setAutomationDraftRequest,
  setActiveView,
  setProjectInstructionsProject,
  setHooksQuery,
  openSettings,
  updateProjectThreads,
  removeProject,
  activeProjectId,
  setDraggedProjectId,
  setProjectDropTarget,
  historyPages,
  clockMs,
  taskShortcut,
  discardNewConversationDraft,
  setActiveProjectId,
  setActiveThreadId,
  setMode,
  threadMenuId,
  threadMenuAnchor,
  beginRenameThread,
  forkThread,
  setSharingThreadId,
  copyTaskLink,
  setThreadArchived,
  deleteThread,
  activeThreadId,
  draggedThread,
  threadDropTarget,
  threadRename,
  setTreeActiveRowId,
  treeActiveRowId,
  setDraggedThread,
  setThreadDropTarget,
  persistProjectThreadOrder,
  toggleProjectPreview,
  draggedProjectId,
  projectDropTarget,
  persistProjectOrder,
  temporaryConversationsOpen,
  toggleTemporaryConversations,
  beginTemporaryConversation,
  temporaryThreads,
  projectTreeElement,
  focusProjectTreeRow,
  collapseProjectTreeRow,
  expandProjectTreeRow,
  activateProjectTreeRow,
  sidebarPeek,
  sidebarOpen,
  requestSidebarPeek,
  sidebarHoverSuppressed,
  closeSidebarPeek,
  projectSidebar,
  changeSidebarOpen,
  activeView,
  navigationItems,
  activeWorkspaceLabel,
  username,
  updateNoticeTarget,
  setRuntimeSettings,
  setToast,
  sidebarSearchInput,
  setQuery,
  automationCount,
}: AppNavigationProps) {
  return (
    <NavigationSidebar
      className="sidebar"
      peek={sidebarPeek && !sidebarOpen}
      onMouseEnter={requestSidebarPeek}
      onMouseMove={requestSidebarPeek}
      onMouseLeave={() => {
        sidebarHoverSuppressed.current = false;
        if (
          !projectSidebar.current
            ?.querySelector('[data-part="main"]')
            ?.querySelector(":focus-visible")
        )
          closeSidebarPeek();
      }}
      onBlur={(event) => {
        if (
          !event.currentTarget.contains(event.relatedTarget) &&
          !(
            event.relatedTarget instanceof Element &&
            event.relatedTarget.closest(".thread-menu")
          ) &&
          !event.currentTarget.matches(":hover")
        )
          closeSidebarPeek();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && sidebarPeek) {
          closeSidebarPeek();
          sidebarHoverSuppressed.current = true;
          requestAnimationFrame(() => {
            projectSidebar.current
              ?.querySelector<HTMLButtonElement>(".rail-brand")
              ?.focus({ preventScroll: true });
          });
        }
      }}
      rail={
        <div className="sidebar-rail">
          <button
            className="rail-brand"
            type="button"
            aria-label={t.leftSidebar}
            onClick={() => changeSidebarOpen(true)}
          >
            <ArtemisMark />
          </button>
          <nav aria-label={t.activityBar}>
            {navigationItems.map(([view, label, icon]) => (
              <button
                type="button"
                className="activity-button rail-item"
                key={view}
                data-nav-view={view}
                aria-label={label}
                title={label}
                aria-current={activeView === view ? "page" : undefined}
                onClick={() => setActiveView(view)}
              >
                {icon}
              </button>
            ))}
          </nav>
          <span aria-hidden="true" className="rail-sep" />
          <button
            className="rail-anchor"
            type="button"
            title={activeWorkspaceLabel}
            aria-label={t.projects}
            onClick={() => {
              setActiveView("workspace");
              changeSidebarOpen(true);
            }}
          >
            <FolderIcon />
          </button>
          <span className="rail-sp" />
          <button
            type="button"
            className="rail-avatar"
            title={username}
            aria-label={username}
            onClick={(event) => openSettings("general", event.currentTarget)}
          >
            {userInitials(username)}
          </button>
          <button
            type="button"
            className="rail-item"
            aria-label={t.settings}
            title={t.settings}
            onClick={(event) => openSettings("general", event.currentTarget)}
          >
            <SettingsIcon />
          </button>
        </div>
      }
      footer={
        <div className="sidebar-footer-stack">
          {runtimeSettings && (
            <SidebarUpdateControl
              status={runtimeSettings.update}
              locale={locale}
              noticeTarget={updateNoticeTarget}
              activeTaskCount={
                snapshot?.threads.filter(
                  (thread) =>
                    thread.status === "running" ||
                    thread.status === "waiting-approval",
                ).length ?? 0
              }
              onStatus={(update) =>
                setRuntimeSettings((current) =>
                  current ? { ...current, update } : current,
                )
              }
              onError={(message) => setToast({ error: true, message })}
            />
          )}
          <div className="sidebar-footer">
            <span className="local-indicator" title={username}>
              <span aria-hidden="true" className="sidebar-profile-avatar">
                {runtimeSettings?.profileAvatar ? (
                  <img alt="" src={runtimeSettings.profileAvatar} />
                ) : (
                  userInitials(username)
                )}
              </span>
              <span className="sidebar-profile-copy">
                <span className="local-user-name">{username}</span>
                {runtimeSettings?.update.currentVersion && (
                  <button
                    className="app-version"
                    onClick={(event) =>
                      openSettings("maintenance", event.currentTarget)
                    }
                    title={`${t.currentVersion} ${runtimeSettings.update.currentVersion}`}
                    type="button"
                  >
                    {sidebarUpdateSubtitle(runtimeSettings.update, locale)}
                  </button>
                )}
              </span>
            </span>
            <button
              className="activity-button foot-icon"
              type="button"
              aria-label={t.settings}
              title={t.settings}
              onClick={(event) => openSettings("general", event.currentTarget)}
            >
              <SettingsIcon />
            </button>
          </div>
        </div>
      }
      header={
        <>
          <div className="sidebar-top">
            <div className="sidebar-brand">
              <button
                type="button"
                className="brand-button"
                aria-label="Artemis"
                onClick={() => changeSidebarOpen(true)}
              >
                <ArtemisMark />
                <strong>Artemis</strong>
                <span className="group-agent-identity">
                  {uiText(locale, "Review01.localArtemis")}
                </span>
              </button>
              <button
                type="button"
                className="sidebar-collapse"
                aria-label={t.leftSidebar}
                aria-expanded={sidebarOpen}
                title={t.leftSidebar}
                onClick={() => changeSidebarOpen((open) => !open)}
              >
                <LeftSidebarIcon />
              </button>
            </div>
          </div>
          <button
            type="button"
            className="sidebar-new-task"
            onClick={() => beginNewConversation()}
          >
            <ArtemisIcon name="edit-square" width={16} height={16} />
            <span>{uiText(locale, "App.inline9")}</span>
            <Keycap aria-hidden="true">
              {snapshot.platform === "darwin" ? "⌘N" : "Ctrl+N"}
            </Keycap>
          </button>
          <PanelHeader
            actions={
              <div className="sidebar-header-actions">
                <label
                  className={
                    query ? "sidebar-search has-query" : "sidebar-search"
                  }
                >
                  <SearchIcon />
                  <input
                    aria-label={t.search}
                    ref={sidebarSearchInput}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t.search}
                    value={query}
                  />
                  <Keycap aria-hidden="true">
                    {snapshot.platform === "darwin" ? "⌘K" : "Ctrl+K"}
                  </Keycap>
                </label>
              </div>
            }
            className="sidebar-header"
            headingLevel={2}
            title={t.tasks}
          />
          <nav className="sidebar-nav" aria-label={t.activityBar}>
            {navigationItems.map(([view, label, icon]) => (
              <button
                type="button"
                className="activity-button nav-row"
                key={view}
                data-nav-view={view}
                aria-label={label}
                title={label}
                aria-current={activeView === view ? "page" : undefined}
                onClick={() => setActiveView(view)}
              >
                {icon}
                <span>{label}</span>
                {view === "archive" &&
                  snapshot.threads.some((thread) => thread.archived) && (
                    <span className="sidebar-nav-count" aria-hidden="true">
                      {
                        snapshot.threads.filter((thread) => thread.archived)
                          .length
                      }
                    </span>
                  )}
                {view === "automations" && Boolean(automationCount) && (
                  <span className="sidebar-nav-count" aria-hidden="true">
                    {automationCount}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </>
      }
      label={t.projects}
      open={sidebarOpen}
      ref={projectSidebar}
    >
      <div
        aria-label={t.projects}
        className="project-tree"
        onKeyDown={(event) =>
          handleProjectTreeKeyDown(event.nativeEvent, {
            container: projectTreeElement.current,
            focusRow: focusProjectTreeRow,
            collapseRow: collapseProjectTreeRow,
            expandRow: expandProjectTreeRow,
            activateRow: activateProjectTreeRow,
            rtl: document.documentElement.dir === "rtl",
          })
        }
        ref={projectTreeElement}
        role="tree"
      >
        <section
          aria-expanded={projectsExpanded}
          aria-level={1}
          className="project-group project-collection"
          data-tree-kind="collection"
          data-tree-level={1}
          data-tree-row-id="collection:projects"
          onFocus={(event) => {
            if (event.target !== event.currentTarget) return;
            setTreeActiveRowId("collection:projects");
          }}
          role="treeitem"
          tabIndex={
            treeActiveRowId === "collection:projects" ||
            treeActiveRowId === undefined
              ? 0
              : -1
          }
        >
          <div className="project-row project-group-row">
            <button
              aria-expanded={projectsExpanded}
              aria-label={
                projectsExpanded ? t.collapseProjects : t.expandProjects
              }
              className="project-group-select"
              onClick={() => toggleProjectsExpansion()}
              title={projectsExpanded ? t.collapseProjects : t.expandProjects}
              type="button"
            >
              <span className="project-group-title">{t.projects}</span>
              <ChevronIcon />
            </button>
            <button
              aria-label={
                hasExpandedProject
                  ? t.collapseAllProjectHistories
                  : t.expandAllProjectHistories
              }
              className="project-collapse-all"
              disabled={projects.length === 0}
              onClick={() =>
                setProjectHistoriesCollapsed(
                  projects.map((project) => project.id),
                  hasExpandedProject,
                )
              }
              title={
                hasExpandedProject
                  ? t.collapseAllProjectHistories
                  : t.expandAllProjectHistories
              }
              type="button"
            >
              <ArtemisIcon
                height={12}
                name={hasExpandedProject ? "collapse" : "expand"}
                width={12}
              />
            </button>
            <Tooltip
              align="end"
              label={uiText(locale, "Review04.addProjectFolder")}
            >
              <button
                aria-label={uiText(locale, "Review04.addProjectFolder")}
                className="project-new-thread"
                onClick={() => void openProject()}
                type="button"
              >
                <PlusIcon />
              </button>
            </Tooltip>
          </div>
          <div
            className="project-collection-rows"
            hidden={!projectsExpanded}
            role="group"
          >
            {projects.map((project) => {
              const hasActiveTask = snapshot.threads.some(
                (thread) =>
                  thread.projectId === project.id &&
                  (thread.status === "running" ||
                    thread.status === "waiting-approval"),
              );
              const matchesProject = project.name
                .toLowerCase()
                .includes(query.trim().toLowerCase());
              const projectThreads = orderProjectThreadsByPreference(
                sortProjectThreads(
                  snapshot.threads
                    .filter(
                      (thread) =>
                        thread.projectId === project.id && !thread.archived,
                    )
                    .filter(
                      (thread) =>
                        !isWorkspaceDraftThread(thread) &&
                        (!imThreadStatus[thread.id]?.group?.native ||
                          !!imThreadStatus[thread.id]?.group?.retired ||
                          !!imThreadStatus[thread.id]?.parentThreadId),
                    )
                    .filter(
                      (thread) =>
                        matchesProject ||
                        thread.title
                          .toLowerCase()
                          .includes(query.trim().toLowerCase()),
                    ),
                  snapshot.events,
                  promptSubmittedAtByThread,
                ),
                runtimeSettings?.projectThreadOrder?.[project.id],
              );
              const expanded = expandedProjectIds.has(project.id);
              const projectOpen = !collapsedProjectIds.has(project.id);
              const visibleThreads = expanded
                ? projectThreads
                : projectThreads.slice(0, PROJECT_THREAD_PREVIEW_LIMIT);
              return (
                <section
                  aria-expanded={projectOpen}
                  aria-level={2}
                  data-tree-kind="project"
                  className={`project-group nested-project${
                    draggedProjectId === project.id ? " dragging" : ""
                  }${
                    projectDropTarget?.projectId === project.id
                      ? ` drop-${projectDropTarget.edge}`
                      : ""
                  }`}
                  hidden={!projectsExpanded}
                  key={project.id}
                  onDragOver={(event) => {
                    if (!draggedProjectId || draggedProjectId === project.id)
                      return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    const bounds = event.currentTarget
                      .querySelector(":scope > .project-row")
                      ?.getBoundingClientRect();
                    if (!bounds) return;
                    setProjectDropTarget({
                      projectId: project.id,
                      edge:
                        event.clientY < bounds.top + bounds.height / 2
                          ? "before"
                          : "after",
                    });
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (!draggedProjectId || !projectDropTarget) return;
                    const previousOrder = projects.map(
                      (candidate) => candidate.id,
                    );
                    const order = reorderProjectIds(
                      previousOrder,
                      draggedProjectId,
                      projectDropTarget.projectId,
                      projectDropTarget.edge,
                    );
                    setDraggedProjectId(undefined);
                    setProjectDropTarget(undefined);
                    void persistProjectOrder(order, previousOrder);
                  }}
                  data-tree-level={2}
                  data-tree-row-id={`project:${project.id}`}
                  onFocus={(event) => {
                    if (event.target !== event.currentTarget) return;
                    setTreeActiveRowId(`project:${project.id}`);
                  }}
                  role="treeitem"
                  tabIndex={
                    treeActiveRowId === `project:${project.id}` ? 0 : -1
                  }
                >
                  <div
                    className={`project-row ${project.id === activeProjectId ? "active" : ""}`}
                    draggable
                    onDragEnd={() => {
                      setDraggedProjectId(undefined);
                      setProjectDropTarget(undefined);
                    }}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", project.id);
                      setDraggedProjectId(project.id);
                      setProjectDropTarget(undefined);
                    }}
                  >
                    <button
                      aria-label={
                        projectOpen
                          ? t.collapseProjectHistory
                          : t.expandProjectHistory
                      }
                      className="project-toggle"
                      aria-expanded={projectOpen}
                      aria-controls={`project-thread-list-${project.id}`}
                      onClick={() => toggleProjectHistory(project.id)}
                      title={
                        projectOpen
                          ? t.collapseProjectHistory
                          : t.expandProjectHistory
                      }
                      type="button"
                    >
                      <FolderIcon open={projectOpen} />
                    </button>
                    <button
                      className="project-select"
                      onClick={() => toggleProjectHistory(project.id)}
                      title={project.path}
                    >
                      <span className="project-title">{project.name}</span>
                    </button>
                    <Tooltip align="end" label={t.newTask}>
                      <button
                        aria-label={`${t.newTask}: ${project.name}`}
                        className="project-new-thread"
                        onClick={() => beginNewConversation(project.id)}
                        type="button"
                      >
                        <ArtemisIcon
                          name="edit-square"
                          width={16}
                          height={16}
                        />
                      </button>
                    </Tooltip>
                    <Tooltip align="end" label={t.moreProjectActions}>
                      <button
                        aria-label={t.moreProjectActions}
                        aria-haspopup="menu"
                        aria-expanded={projectMenuId === project.id}
                        className="project-action"
                        onClick={(event) => {
                          projectMenuAnchor.current = event.currentTarget;
                          setThreadMenuId(undefined);
                          setProjectMenuId((current) =>
                            current === project.id ? undefined : project.id,
                          );
                        }}
                      >
                        <ArtemisIcon name="more" width={16} height={16} />
                      </button>
                    </Tooltip>
                    {projectMenuId === project.id && (
                      <Popover
                        anchorRef={projectMenuAnchor}
                        align="end"
                        className="project-menu"
                        label={t.moreProjectActions}
                        onOpenChange={(open) => {
                          if (!open) setProjectMenuId(undefined);
                        }}
                        open
                        role="menu"
                      >
                        <button
                          role="menuitem"
                          onClick={() => {
                            setProjectMenuId(undefined);
                            beginNewConversation(project.id);
                          }}
                        >
                          <ArtemisIcon
                            name="edit-square"
                            width={16}
                            height={16}
                          />
                          <span>
                            {uiText(locale, "Review05.newProjectTask")}
                          </span>
                        </button>
                        <button
                          role="menuitem"
                          onClick={() => {
                            setProjectMenuId(undefined);
                            setAutomationDraftRequest((previous) => ({
                              projectId: project.id,
                              token: (previous?.token ?? 0) + 1,
                            }));
                            setActiveView("automations");
                          }}
                        >
                          <ArtemisIcon
                            name="automation"
                            width={16}
                            height={16}
                          />
                          <span>
                            {uiText(locale, "Review06.newProjectAutomation")}
                          </span>
                        </button>
                        <button
                          role="menuitem"
                          onClick={() => {
                            setProjectMenuId(undefined);
                            setProjectInstructionsProject(project);
                          }}
                        >
                          <ArtemisIcon name="document" width={16} height={16} />
                          <span>
                            {uiText(locale, "Review06.projectInstructions")}
                          </span>
                        </button>
                        <button
                          role="menuitem"
                          onClick={(event) => {
                            setHooksQuery({ projectId: project.id });
                            setProjectMenuId(undefined);
                            openSettings("hooks", event.currentTarget);
                          }}
                        >
                          <ArtemisIcon name="hooks" width={16} height={16} />
                          <span>{uiText(locale, "Hooks.title")}</span>
                        </button>
                        <button
                          role="menuitem"
                          disabled={
                            hasActiveTask ||
                            !snapshot.threads.some(
                              (thread) =>
                                thread.projectId === project.id &&
                                !thread.archived,
                            )
                          }
                          onClick={() =>
                            void updateProjectThreads(project, "archive")
                          }
                        >
                          <ArtemisIcon name="archive" width={16} height={16} />
                          <span>{uiText(locale, "App.inline7")}</span>
                        </button>
                        <div role="separator" />
                        <button
                          role="menuitem"
                          className="danger"
                          disabled={
                            hasActiveTask ||
                            !snapshot.threads.some(
                              (thread) => thread.projectId === project.id,
                            )
                          }
                          onClick={() =>
                            void updateProjectThreads(project, "delete")
                          }
                        >
                          <ArtemisIcon name="trash" width={16} height={16} />
                          <span>{uiText(locale, "App.inline8")}</span>
                        </button>
                        <button
                          role="menuitem"
                          className="danger"
                          disabled={hasActiveTask}
                          onClick={() => void removeProject(project)}
                          title={
                            hasActiveTask
                              ? t.stopTasksBeforeRemove
                              : uiText(locale, "Review05.removeFromSidebar")
                          }
                        >
                          <ArtemisIcon name="close" width={16} height={16} />
                          <span>
                            {uiText(locale, "Review05.removeFromSidebar")}
                          </span>
                        </button>
                      </Popover>
                    )}
                  </div>
                  {projectOpen && (
                    <div
                      className="project-thread-list"
                      id={`project-thread-list-${project.id}`}
                      role="group"
                    >
                      {visibleThreads.map((thread) => (
                        <div
                          className={`project-thread-row${
                            thread.id === activeThreadId ? " selected" : ""
                          }${
                            draggedThread?.threadId === thread.id
                              ? " dragging"
                              : ""
                          }${
                            threadDropTarget?.threadId === thread.id
                              ? ` drop-${threadDropTarget.edge}`
                              : ""
                          }`}
                          draggable={
                            threadRename?.threadId !== thread.id &&
                            !query.trim()
                          }
                          key={thread.id}
                          aria-selected={thread.id === activeThreadId}
                          aria-level={3}
                          data-tree-kind="thread"
                          data-tree-level={3}
                          data-tree-row-id={`thread:${thread.id}`}
                          onFocus={(event) => {
                            if (event.target !== event.currentTarget) return;
                            setTreeActiveRowId(`thread:${thread.id}`);
                          }}
                          role="treeitem"
                          tabIndex={
                            treeActiveRowId === `thread:${thread.id}` ? 0 : -1
                          }
                          onDragEnd={() => {
                            setDraggedThread(undefined);
                            setThreadDropTarget(undefined);
                          }}
                          onDragOver={(event) => {
                            if (
                              !draggedThread ||
                              draggedThread.projectId !== project.id ||
                              draggedThread.threadId === thread.id
                            ) {
                              return;
                            }
                            event.preventDefault();
                            event.stopPropagation();
                            event.dataTransfer.dropEffect = "move";
                            const bounds =
                              event.currentTarget.getBoundingClientRect();
                            setThreadDropTarget({
                              projectId: project.id,
                              threadId: thread.id,
                              edge:
                                event.clientY < bounds.top + bounds.height / 2
                                  ? "before"
                                  : "after",
                            });
                          }}
                          onDragStart={(event) => {
                            if (query.trim()) {
                              event.preventDefault();
                              return;
                            }
                            event.stopPropagation();
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData("text/plain", thread.id);
                            setDraggedThread({
                              projectId: project.id,
                              threadId: thread.id,
                            });
                            setThreadDropTarget(undefined);
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            if (
                              !draggedThread ||
                              !threadDropTarget ||
                              draggedThread.projectId !== project.id ||
                              threadDropTarget.projectId !== project.id
                            ) {
                              return;
                            }
                            const previousOrder = projectThreads.map(
                              (candidate) => candidate.id,
                            );
                            const order = reorderThreadIds(
                              previousOrder,
                              draggedThread.threadId,
                              threadDropTarget.threadId,
                              threadDropTarget.edge,
                            );
                            setDraggedThread(undefined);
                            setThreadDropTarget(undefined);
                            void persistProjectThreadOrder(
                              project.id,
                              order,
                              previousOrder,
                            );
                          }}
                        >
                          <>
                            <button
                              className="thread-select"
                              onKeyDown={(event) => taskShortcut(event, thread)}
                              onClick={() => {
                                discardNewConversationDraft();
                                setActiveView("workspace");
                                setActiveProjectId(project.id);
                                setActiveThreadId(thread.id);
                                setMode(thread.mode);
                                setThreadMenuId(undefined);
                              }}
                            >
                              <ThreadStatusIndicator
                                thread={thread}
                                locale={locale}
                                events={snapshot.events[thread.id]}
                                historyState={historyPages[thread.id]?.state}
                              />
                              {imThreadStatus[thread.id] && (
                                <ImThreadConnection
                                  status={imThreadStatus[thread.id]!}
                                  channelIcon={
                                    <ThreadChannelMark
                                      channel={
                                        imThreadStatus[thread.id]?.channel ?? ""
                                      }
                                      locale={locale}
                                    />
                                  }
                                  locale={locale}
                                />
                              )}
                              <span
                                className="thread-title"
                                onPointerEnter={prepareThreadTitleScroll}
                                title={visibleThreadTitle(thread.title)}
                              >
                                <ThreadTitleContent
                                  hideChannel={
                                    !!imThreadStatus[thread.id]?.group?.retired
                                  }
                                  title={thread.title}
                                  locale={locale}
                                />
                              </span>
                              <ThreadWaitingBadge
                                thread={thread}
                                locale={locale}
                                events={snapshot.events[thread.id]}
                                historyState={historyPages[thread.id]?.state}
                              />
                              <time
                                className="thread-time"
                                dateTime={thread.updatedAt}
                                title={new Date(
                                  thread.updatedAt,
                                ).toLocaleString(locale)}
                              >
                                {thread.notification?.unread
                                  ? uiText(locale, "App_copy.unreadShort")
                                  : formatSidebarTime(
                                      thread.updatedAt,
                                      clockMs,
                                      locale,
                                    )}
                              </time>
                            </button>
                            <Tooltip align="end" label={t.moreActions}>
                              <button
                                aria-label={t.moreActions}
                                aria-haspopup="menu"
                                aria-expanded={threadMenuId === thread.id}
                                className="thread-action"
                                onClick={(event) => {
                                  threadMenuAnchor.current =
                                    event.currentTarget;
                                  setProjectMenuId(undefined);
                                  setThreadMenuId((current) =>
                                    current === thread.id
                                      ? undefined
                                      : thread.id,
                                  );
                                }}
                              >
                                <ArtemisIcon
                                  name="more"
                                  width={16}
                                  height={16}
                                />
                              </button>
                            </Tooltip>
                            {threadMenuId === thread.id && (
                              <Popover
                                anchorRef={threadMenuAnchor}
                                align="end"
                                className="thread-menu"
                                onKeyDown={(event) =>
                                  taskShortcut(event, thread)
                                }
                                label={t.moreActions}
                                onOpenChange={(open) => {
                                  if (!open) setThreadMenuId(undefined);
                                }}
                                open
                                role="menu"
                              >
                                <button
                                  role="menuitem"
                                  onClick={() => beginRenameThread(thread)}
                                >
                                  <ArtemisIcon
                                    name="edit"
                                    width={16}
                                    height={16}
                                  />
                                  <span>{t.renameTask}</span>
                                  <Keycap>F2</Keycap>
                                </button>
                                <button
                                  role="menuitem"
                                  disabled={
                                    thread.status === "running" ||
                                    thread.status === "waiting-approval"
                                  }
                                  onClick={() => void forkThread(thread)}
                                >
                                  <ArtemisIcon
                                    name="fork"
                                    width={16}
                                    height={16}
                                  />
                                  <span>{t.forkTask}</span>
                                </button>
                                <button
                                  role="menuitem"
                                  onClick={() => {
                                    setThreadMenuId(undefined);
                                    setSharingThreadId(thread.id);
                                  }}
                                >
                                  <ArtemisIcon
                                    name="share"
                                    width={16}
                                    height={16}
                                  />
                                  <span>
                                    {uiText(locale, "Review05.shareTask")}
                                  </span>
                                </button>

                                <button
                                  role="menuitem"
                                  onClick={() => void copyTaskLink(thread.id)}
                                >
                                  <ArtemisIcon
                                    name="copy"
                                    width={16}
                                    height={16}
                                  />
                                  <span>
                                    {uiText(locale, "Review06.copyTaskLink")}
                                  </span>
                                </button>

                                <div role="separator" />
                                <button
                                  role="menuitem"
                                  disabled={
                                    thread.status === "running" ||
                                    thread.status === "waiting-approval"
                                  }
                                  onClick={() =>
                                    void setThreadArchived(thread, true)
                                  }
                                >
                                  <ArtemisIcon
                                    name="archive"
                                    width={16}
                                    height={16}
                                  />
                                  <span>{t.archiveTask}</span>
                                  <Keycap>
                                    {snapshot.platform === "darwin"
                                      ? "⌘⌫"
                                      : "Ctrl+Backspace"}
                                  </Keycap>
                                </button>
                                <button
                                  role="menuitem"
                                  className="danger"
                                  disabled={
                                    thread.status === "running" ||
                                    thread.status === "waiting-approval"
                                  }
                                  onClick={() => void deleteThread(thread)}
                                >
                                  <ArtemisIcon
                                    name="trash"
                                    width={16}
                                    height={16}
                                  />
                                  <span>{t.deleteTask}</span>
                                </button>
                              </Popover>
                            )}
                          </>
                        </div>
                      ))}
                      {projectThreads.length > PROJECT_THREAD_PREVIEW_LIMIT && (
                        <button
                          aria-level={3}
                          className="project-expand-toggle"
                          data-tree-kind="show-more"
                          data-tree-level={3}
                          data-tree-row-id={`show-more:${project.id}`}
                          onFocus={(event) => {
                            if (event.target !== event.currentTarget) return;
                            setTreeActiveRowId(`show-more:${project.id}`);
                          }}
                          role="treeitem"
                          tabIndex={
                            treeActiveRowId === `show-more:${project.id}`
                              ? 0
                              : -1
                          }
                          aria-expanded={expanded}
                          onClick={() => toggleProjectPreview(project.id)}
                          type="button"
                        >
                          {expanded ? t.showFewerTasks : t.showMoreTasks}
                        </button>
                      )}
                      {query.trim() && projectThreads.length === 0 && (
                        <span className="project-no-matches">{t.noTasks}</span>
                      )}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </section>
        <section
          aria-expanded={temporaryConversationsOpen}
          aria-level={1}
          className="project-group temporary-conversations"
          data-tree-kind="temporary"
          data-tree-level={1}
          data-tree-row-id="temporary:conversations"
          onFocus={(event) => {
            if (event.target !== event.currentTarget) return;
            setTreeActiveRowId("temporary:conversations");
          }}
          role="treeitem"
          tabIndex={treeActiveRowId === "temporary:conversations" ? 0 : -1}
        >
          <div
            className={`project-row project-group-row ${
              !activeProjectId ? "active" : ""
            }`}
          >
            <button
              aria-controls="temporary-conversation-list"
              aria-expanded={temporaryConversationsOpen}
              aria-label={
                temporaryConversationsOpen
                  ? t.collapseTemporaryConversations
                  : t.expandTemporaryConversations
              }
              className="project-group-select"
              onClick={() => void toggleTemporaryConversations()}
              title={t.temporaryConversations}
              type="button"
            >
              <span className="project-group-title">
                {t.temporaryConversations}
              </span>
              <ChevronIcon />
            </button>
            <Tooltip align="end" label={t.newTask}>
              <button
                aria-label={`${t.newTask}: ${t.temporaryConversations}`}
                className="project-new-thread"
                onClick={beginTemporaryConversation}
                type="button"
              >
                <PlusIcon />
              </button>
            </Tooltip>
          </div>
          <div
            className="project-thread-list"
            hidden={!temporaryConversationsOpen}
            id="temporary-conversation-list"
            role="group"
          >
            {temporaryThreads.map((thread) => (
              <div
                aria-selected={thread.id === activeThreadId}
                aria-level={2}
                className={`project-thread-row ${thread.id === activeThreadId ? "selected" : ""}`}
                data-tree-kind="thread"
                data-tree-level={2}
                data-tree-row-id={`thread:${thread.id}`}
                key={thread.id}
                onFocus={(event) => {
                  if (event.target !== event.currentTarget) return;
                  setTreeActiveRowId(`thread:${thread.id}`);
                }}
                role="treeitem"
                tabIndex={treeActiveRowId === `thread:${thread.id}` ? 0 : -1}
              >
                <>
                  <button
                    className="thread-select"
                    onKeyDown={(event) => taskShortcut(event, thread)}
                    onClick={() => {
                      discardNewConversationDraft();
                      setActiveView("workspace");
                      setActiveProjectId(undefined);
                      setActiveThreadId(thread.id);
                      setMode(thread.mode);
                      setThreadMenuId(undefined);
                    }}
                    type="button"
                  >
                    <ThreadStatusIndicator
                      thread={thread}
                      locale={locale}
                      events={snapshot.events[thread.id]}
                      historyState={historyPages[thread.id]?.state}
                    />
                    {imThreadStatus[thread.id] && (
                      <ImThreadConnection
                        status={imThreadStatus[thread.id]!}
                        channelIcon={
                          <ThreadChannelMark
                            channel={imThreadStatus[thread.id]?.channel ?? ""}
                            locale={locale}
                          />
                        }
                        locale={locale}
                      />
                    )}
                    <span
                      className="thread-title"
                      onPointerEnter={prepareThreadTitleScroll}
                      title={visibleThreadTitle(thread.title)}
                    >
                      <ThreadTitleContent
                        hideChannel={
                          !!imThreadStatus[thread.id]?.group?.retired
                        }
                        title={thread.title}
                        locale={locale}
                      />
                    </span>
                    <ThreadWaitingBadge
                      thread={thread}
                      locale={locale}
                      events={snapshot.events[thread.id]}
                      historyState={historyPages[thread.id]?.state}
                    />
                    <time
                      className="thread-time"
                      dateTime={thread.updatedAt}
                      title={new Date(thread.updatedAt).toLocaleString(locale)}
                    >
                      {thread.notification?.unread
                        ? uiText(locale, "App_copy.unreadShort")
                        : formatSidebarTime(thread.updatedAt, clockMs, locale)}
                    </time>
                  </button>
                  <Tooltip align="end" label={t.moreActions}>
                    <button
                      aria-label={t.moreActions}
                      aria-haspopup="menu"
                      aria-expanded={threadMenuId === thread.id}
                      className="thread-action"
                      onClick={(event) => {
                        threadMenuAnchor.current = event.currentTarget;
                        setProjectMenuId(undefined);
                        setThreadMenuId((current) =>
                          current === thread.id ? undefined : thread.id,
                        );
                      }}
                      type="button"
                    >
                      <ArtemisIcon name="more" width={16} height={16} />
                    </button>
                  </Tooltip>
                  {threadMenuId === thread.id && (
                    <Popover
                      anchorRef={threadMenuAnchor}
                      align="end"
                      className="thread-menu"
                      onKeyDown={(event) => taskShortcut(event, thread)}
                      label={t.moreActions}
                      onOpenChange={(open) => {
                        if (!open) setThreadMenuId(undefined);
                      }}
                      open
                      role="menu"
                    >
                      <button
                        role="menuitem"
                        onClick={() => beginRenameThread(thread)}
                      >
                        <ArtemisIcon name="edit" width={16} height={16} />
                        <span>{t.renameTask}</span>
                        <Keycap>F2</Keycap>
                      </button>
                      <button
                        role="menuitem"
                        disabled={
                          thread.status === "running" ||
                          thread.status === "waiting-approval"
                        }
                        onClick={() => void forkThread(thread)}
                      >
                        <ArtemisIcon name="fork" width={16} height={16} />
                        <span>{t.forkTask}</span>
                      </button>
                      <button
                        role="menuitem"
                        onClick={() => {
                          setThreadMenuId(undefined);
                          setSharingThreadId(thread.id);
                        }}
                      >
                        <ArtemisIcon name="share" width={16} height={16} />
                        <span>{uiText(locale, "Review05.shareTask")}</span>
                      </button>

                      <button
                        role="menuitem"
                        onClick={() => void copyTaskLink(thread.id)}
                      >
                        <ArtemisIcon name="copy" width={16} height={16} />
                        <span>{uiText(locale, "Review06.copyTaskLink")}</span>
                      </button>

                      <div role="separator" />
                      <button
                        role="menuitem"
                        disabled={
                          thread.status === "running" ||
                          thread.status === "waiting-approval"
                        }
                        onClick={() => void setThreadArchived(thread, true)}
                      >
                        <ArtemisIcon name="archive" width={16} height={16} />
                        <span>{t.archiveTask}</span>
                        <Keycap>
                          {snapshot.platform === "darwin"
                            ? "⌘⌫"
                            : "Ctrl+Backspace"}
                        </Keycap>
                      </button>
                      <button
                        role="menuitem"
                        className="danger"
                        disabled={
                          thread.status === "running" ||
                          thread.status === "waiting-approval"
                        }
                        onClick={() => void deleteThread(thread)}
                      >
                        <ArtemisIcon name="trash" width={16} height={16} />
                        <span>{t.deleteTask}</span>
                      </button>
                    </Popover>
                  )}
                </>
              </div>
            ))}
            {query.trim() && temporaryThreads.length === 0 && (
              <span className="project-no-matches">{t.noTasks}</span>
            )}
          </div>
        </section>
      </div>
    </NavigationSidebar>
  );
}
