import { EMPTY_WORKSPACE_TAB_SCROLL_STATE } from "./controllers/controller-values.js";
import { useConversationDraftState } from "./controllers/use-conversation-draft-state.js";
import { useReviewSelection } from "./controllers/use-review-selection.js";
import { useConversationDraft } from "./controllers/use-conversation-draft.js";
import { useConversationNavigation } from "./controllers/use-conversation-navigation.js";
import { useOverlayInteractions } from "./controllers/use-overlay-interactions.js";
import { useComposerSuggestions } from "./controllers/use-composer-suggestions.js";
import { useThreadCreation } from "./controllers/use-thread-creation.js";
import { useWorkspaceTabsController } from "./controllers/use-workspace-tabs-controller.js";
import { useConversationLinks } from "./controllers/use-conversation-links.js";
import { useAgentControls } from "./controllers/use-agent-controls.js";
import { useProjectLayout } from "./controllers/use-project-layout.js";
import { useWorkspaceDockLayout } from "./controllers/use-workspace-dock-layout.js";
import { useApplicationSubscriptions } from "./controllers/use-application-subscriptions.js";
import { useBrowserWorkspace } from "./controllers/use-browser-workspace.js";
import { useConversationHistory } from "./controllers/use-conversation-history.js";
import { useConversationState } from "./controllers/use-conversation-state.js";
import { useComposerModelDetails } from "./controllers/use-composer-model-details.js";
import { useComposerModelSelection } from "./controllers/use-composer-model-selection.js";
import { useTimelineViewport } from "./controllers/use-timeline-viewport.js";
import { useReviewController } from "./controllers/use-review-controller.js";
import { useProjectThreadActions } from "./controllers/use-project-thread-actions.js";
import { usePromptAttachments } from "./controllers/use-prompt-attachments.js";
import { useComposerSubmission } from "./controllers/use-composer-submission.js";
import { useComposerAutoSend } from "./controllers/use-composer-auto-send.js";
import { useGoalControl } from "./controllers/use-goal-control.js";
import { useQueuedMessages } from "./controllers/use-queued-messages.js";
import { useApplicationShortcuts } from "./controllers/use-application-shortcuts.js";
import { CodexSelect } from "../components/CodexSelect.js";
import { AppWorkspaceDock } from "./AppWorkspaceDock.js";
import { AppNavigation } from "./AppNavigation.js";
import { ApplicationShell } from "@artemis/ui/surfaces";
import { SettingsPanel } from "./feature-panels.js";
import { UpdateAnnouncement } from "../updates/UpdateAnnouncement.js";
import { ConversationShareDialog } from "../conversation/ConversationShareDialog.js";
import { ProjectInstructionsDialog } from "../workspace/ProjectInstructionsDialog.js";
import { Dialog } from "@artemis/ui/feedback";
import { TokenUsagePage } from "./feature-panels.js";
import { AutomationPage } from "./feature-panels.js";
import { ArchivePage } from "./ArchivePage.js";
import { ResourceCenter } from "./feature-panels.js";

import { WorkspaceDockResizer } from "@artemis/ui/workspace";
import { ConversationSurface } from "@artemis/ui/conversation";
import { WelcomeResume } from "../conversation/WelcomeResume.js";
import { ComposerContextBar } from "../conversation/ComposerContextBar.js";
import { EnvironmentWorkspaceMenu } from "../workspace/EnvironmentWorkspaceMenu.js";
import { DecisionComposer } from "../conversation/DecisionComposer.js";
import { ModelPickerMenu } from "../settings/ModelPickerMenu.js";
import { ModelHoverDetails } from "../settings/ModelHoverDetails.js";
import { ModelIcon } from "./app-icons.js";
import { ContextUsageIndicator } from "../conversation/ContextUsageIndicator.js";
import { ComposerRunModeControl } from "../conversation/ComposerContextBar.js";
import { CustomAgentMentionMenu } from "../settings/CustomAgentMention.js";
import { CustomAgentTaskBlocks } from "../settings/CustomAgentTaskBlocks.js";
import { OfficeAnnotationCards } from "../office/OfficeAnnotationCards.js";
import { ComposerAttachments } from "../conversation/ComposerAttachments.js";
import { AttachmentImportProgress } from "../conversation/AttachmentImportProgress.js";
import { ComposerSkillChip } from "../conversation/ComposerSkillChip.js";
import { CommandArtwork } from "../components/CommandArtwork.js";
import { QueueIcon } from "./app-icons.js";
import { QueuedMessageGroup } from "@artemis/ui/conversation";
import { TrashIcon } from "./app-icons.js";
import { EditIcon } from "./app-icons.js";
import { MoveToFrontIcon } from "./app-icons.js";
import { QueuedMessageItem } from "@artemis/ui/conversation";
import { QueuedMessageEditor } from "../conversation/QueuedMessageEditor.js";
import { TaskPlanProgress } from "../conversation/TaskPlanProgress.js";
import { GoalBar } from "../conversation/GoalBar.js";
import { ImDelegationWaitStatus } from "../im/ImDelegationWaitStatus.js";
import { HookTaskNotice } from "./feature-panels.js";
import { Suspense } from "react";
import { ComputerPreview } from "./feature-panels.js";
import { ComputerUseControls } from "./feature-panels.js";
import { TimelineViewport } from "@artemis/ui/conversation";
import { Button } from "@artemis/ui/actions";
import { ErrorState } from "@artemis/ui/feedback";
import { LoadingState } from "@artemis/ui/feedback";
import { ConversationEmptyState } from "@artemis/ui/conversation";
import { Fragment } from "react";
import { RightSidebarIcon } from "./app-icons.js";
import { EnvironmentPanel } from "../workspace/EnvironmentPanel.js";
import { RunningArc } from "@artemis/ui/icons";
import { TransientNotice } from "./transient-notice.js";
import { Toolbar } from "@artemis/ui/layout";
import { ApplicationShellResizer } from "@artemis/ui/surfaces";

import { LeftSidebarIcon } from "./app-icons.js";

import { Keycap } from "@artemis/ui/actions";

import { Tooltip } from "@artemis/ui/feedback";
import { PlusIcon } from "./app-icons.js";
import { ChevronIcon } from "./app-icons.js";
import { SidebarGlassFilters } from "./SidebarGlassFilters.js";
import { ArchiveIcon } from "./app-icons.js";
import { TokenUsageIcon } from "./app-icons.js";
import { AutomationIcon } from "./app-icons.js";
import { ResourceIcon } from "./app-icons.js";
import { ArtemisMark } from "./app-icons.js";
import { CloseIcon } from "./app-icons.js";
import { ArtemisIcon } from "@artemis/ui/icons";
import { useSidebarNavigation } from "./use-sidebar-navigation.js";

import { Timeline } from "../conversation/timeline.js";
import { TurnChangeSetCard } from "../conversation/turn-change-set-card.js";
import { ToolActivityGroupCard } from "../conversation/tool-activity-group-card.js";
import { ChildAgentPanel } from "../conversation/child-agent-panel.js";
import { AgentTeamPanel } from "../conversation/agent-team-panel.js";
import {
  loadResourceCenter,
  loadSettingsPanel,
  loadTerminalPanel,
} from "./feature-panels.js";

import {
  statusLabel,
  synchronizeTurnIndicator,
} from "./thread-presentation.js";
import { WorkspaceTabIcon } from "./app-icons.js";
import { appCopy } from "./app-copy.js";
import {
  type LiveChildActivity,
  type Locale,
  type ActiveView,
  type SettingsEntryTab,
  type ToastContent,
  type ToastState,
  type ConfirmationState,
  type FileLinkContextMenuState,
  type WorkspaceDockDrag,
  type ProjectSidebarDrag,
  type WorkspaceTabScrollState,
} from "./app-types.js";

import { threadPresentationStatus } from "../conversation/thread-presentation.js";

import { preserveLoadedEvents } from "../conversation/stream-snapshot.js";
import { BoundedStateCache } from "./bounded-state-cache.js";
import type { WindowMaterial } from "../../shared/window-material.js";

import { claimUpdateAnnouncement } from "../updates/update-announcement.js";
import type { HookQuery } from "@artemis/protocol";
import { type ArtifactSnapshot } from "@artemis/protocol";

import { UserInputCard } from "../conversation/UserInputCard.js";
import { firstPendingComposerDecision } from "../conversation/DecisionComposer.js";
export { UserInputCard } from "../conversation/UserInputCard.js";
import { type ResolveApprovalDecision } from "../conversation/ApprovalDecisionCard.js";

import { type ThreadHistoryPage } from "../../shared/thread-history.js";

import { uiText } from "../../shared/i18n/ui-text.js";

import {
  changeOfficeAnnotation,
  isStoredOfficeAnnotations,
  restoreOfficeAnnotationAttachment,
  type OfficeAnnotationReference,
} from "../office/office-annotations.js";

import { officeAnnotationCopy } from "../office/office-annotation-copy.js";

import { useAutomations } from "../automation/useAutomationCount.js";

import { isAttachmentReference } from "@artemis/protocol";
import { localizedTurnFailure } from "../conversation/turn-failure.js";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
} from "react";
import { useTranslation } from "react-i18next";

import {
  type AgentEvent,
  type ApprovalPolicy,
  type ApprovalState,
  type ModelSelection,
  type PromptAttachment,
  type PromptImage,
  type Project,
  type RunMode,
  type ThreadViewState,
  type UserInputResolution,
} from "@artemis/protocol";

import type {
  DesktopSnapshot,
  ProjectGitInfo,
  ReviewComment,
  ReviewDiff,
  SettingsSnapshot,
} from "../../shared/api.js";
import { localeDirection } from "../../shared/i18n/locales.js";

import { useImThreadStatus } from "../im/ImThreadConnection.js";

import {
  desktopSkinHost,
  desktopSkinReady,
} from "../appearance/desktop-skin-bootstrap.js";

import { clampTreeActiveRowId } from "./project-thread-tree.js";

import {
  resolveTimelinePinned,
  type TimelineScrollSnapshot,
} from "../conversation/timeline-scroll.js";

import { retainWorkspaceDrafts } from "../workspace/workspace-autosave.js";

import {
  deriveRunPresentation,
  formatRunDuration,
} from "../conversation/run-presentation.js";

import { nextRunMode } from "../conversation/run-mode-controls.js";

import { selectedSkillNamesForPrompt } from "../plugins/skill-commands.js";
import {
  navigatePromptHistory,
  type PromptHistoryNavigation,
} from "../conversation/prompt-history.js";
import { deriveTaskPlan } from "../conversation/task-plan.js";

import {
  isWorkspaceDraftThread,
  sortProjectThreads,
  type ThreadDropEdge,
} from "./thread-list-order.js";

import { useConversationWelcome } from "../conversation/use-conversation-welcome.js";
import {
  agentTeamWorkspaceTab,
  emptyWorkspaceTabs,
  reconcileAgentTeamWorkspaceTab,
} from "../workspace/workspace-tabs.js";
import { useWorkspaceUiState } from "../workspace/workspace-ui-state.js";
import { booleanUiState, usePersistentUiState } from "./ui-state.js";
import {
  clampWorkspaceDockWidth,
  DEFAULT_WORKSPACE_DOCK_WIDTH,
  workspaceDockWidthBounds,
} from "../workspace/workspace-dock-layout.js";
import {
  PROJECT_SIDEBAR_WIDTH_DEFAULT,
  PROJECT_SIDEBAR_WIDTH_MAX,
  PROJECT_SIDEBAR_WIDTH_MIN,
} from "./project-sidebar-layout.js";
import {
  createProjectOrderPersistenceQueue,
  orderProjectsByPreference,
  type ProjectDropEdge,
  type ProjectOrderPersistenceQueue,
} from "./project-order.js";
import {
  createBooleanPreferencePersistenceQueue,
  type BooleanPreferencePersistenceQueue,
} from "./boolean-preference-persistence.js";
import {
  latestFailedTurnPrompt,
  reduceTurnFailureNotices,
  type TurnFailureNotices,
} from "../conversation/turn-failure-notices.js";
import { thinkingLevelLabel } from "../settings/model-selection.js";

function isPromptImage(
  attachment: PromptAttachment,
): attachment is PromptImage {
  return !("type" in attachment);
}

/* IM 任务标题固定带「渠道 · 摘要」前缀（task-title.ts），侧栏把前缀文字
   换成品牌图标；标题数据本身不动。 */

export function App() {
  const imThreadStatus = useImThreadStatus();
  const automations = useAutomations();
  const automationCount = automations?.length;
  const [welcomeAutomationId, setWelcomeAutomationId] = useState<string>();
  const [welcomeGit, setWelcomeGit] = useState<{
    key: string;
    info: ProjectGitInfo | undefined;
  }>();
  const { i18n } = useTranslation();
  const [snapshot, setSnapshot] = useState<DesktopSnapshot>();
  const [windowMaterial, setWindowMaterial] = useState<WindowMaterial>();
  const [activeProjectId, setActiveProjectId] = useState<string>();
  const linkOpenedThread = useRef<string | undefined>(undefined);
  const [activeThreadId, setActiveThreadId] = useState<string>();
  const {
    composerDrafts,
    setComposerDrafts,
    promptSubmittedAtByThread,
    setPromptSubmittedAtByThread,
    promptHistory,
    setPromptHistory,
    installedSkills,
    setInstalledSkills,
    installedPlugins,
    setInstalledPlugins,
    skillsLoading,
    setSkillsLoading,
    skillsError,
    setSkillsError,
    skillMenuDismissed,
    setSkillMenuDismissed,
    activeSlashSuggestion,
    setActiveSlashSuggestion,
    attachmentDragActive,
    setAttachmentDragActive,
  } = useConversationDraftState();
  const [approvalPolicy, setApprovalPolicy] = useState<ApprovalPolicy>("agent");
  const [runtimeSettings, setRuntimeSettings] = useState<SettingsSnapshot>();
  const [updateNoticeTarget, setUpdateNoticeTarget] =
    useState<HTMLDivElement | null>(null);
  const effectiveMaterial =
    runtimeSettings?.material === "solid" || windowMaterial === "solid"
      ? "solid"
      : "glass";
  useEffect(() => {
    document.documentElement.dataset.material = effectiveMaterial;
  }, [effectiveMaterial]);
  const [updateAnnouncement, setUpdateAnnouncement] = useState<string>();
  const announcedUpdate = useRef<string | undefined>(undefined);
  const [pendingModelSelection, setPendingModelSelection] =
    useState<ModelSelection>();
  const [approvalMenuOpen, setApprovalMenuOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelFilter, setModelFilter] = useState("");
  const [mode, setMode] = useState<RunMode>("work");
  const [query, setQuery] = useState("");
  const sidebarSearchInput = useRef<HTMLInputElement>(null);
  const [decisionTarget, setDecisionTarget] = useState<HTMLDivElement | null>(
    null,
  );
  const [projectsOpen, setProjectsOpen] = usePersistentUiState(
    "artemis-projects-open",
    booleanUiState,
    true,
  );
  const [temporaryConversationsOpen, setTemporaryConversationsOpen] =
    useState(true);
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(
    () => new Set(),
  );
  const expandedProjectIdsRef = useRef<Set<string>>(new Set());
  const expandedProjectIdsTouched = useRef(false);
  const projectTreeElement = useRef<HTMLDivElement>(null);
  const [treeActiveRowId, setTreeActiveRowId] = useState<string>();
  const focusProjectTreeRow = useCallback((rowId: string) => {
    setTreeActiveRowId(rowId);
    projectTreeElement.current
      ?.querySelector<HTMLElement>(`[data-tree-row-id="${CSS.escape(rowId)}"]`)
      ?.focus();
  }, []);
  useEffect(() => {
    setTreeActiveRowId((current) =>
      clampTreeActiveRowId(projectTreeElement.current, current),
    );
  });
  // One mutable expansion state drives the root treeitem, the internal
  // toggle, the child-group visibility and every keyboard entry point
  // (click / Enter / Space / ArrowLeft). Entering a search auto-expands
  // once; collapsing during the search is honoured and persisted; leaving
  // the search restores the persisted preference.
  const [projectsExpanded, setProjectsExpanded] = useState(projectsOpen);
  const projectsSearchQueryRef = useRef(query);
  useEffect(() => {
    const wasSearching = projectsSearchQueryRef.current.trim().length > 0;
    const isSearching = query.trim().length > 0;
    projectsSearchQueryRef.current = query;
    if (isSearching && !wasSearching) {
      setProjectsExpanded(true);
    } else if (!isSearching) {
      setProjectsExpanded(projectsOpen);
    }
  }, [projectsOpen, query]);
  const toggleProjectsExpansion = useCallback(() => {
    // Compute ONE next value from the authoritative visible state and sync
    // both states to it — two independent functional toggles can diverge
    // after the search auto-expansion (expanded=true, open=false) and the
    // leave-search restore would then undo the user's collapse.
    const next = !projectsExpanded;
    setProjectsExpanded(next);
    setProjectsOpen(next);
  }, [projectsExpanded]);
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<Set<string>>(
    () => new Set(),
  );
  const collapsedProjectIdsRef = useRef<Set<string>>(new Set());
  const collapsedProjectIdsTouched = useRef(false);
  const [draggedProjectId, setDraggedProjectId] = useState<string>();
  const [projectDropTarget, setProjectDropTarget] = useState<{
    projectId: string;
    edge: ProjectDropEdge;
  }>();
  const [draggedThread, setDraggedThread] = useState<{
    projectId: string;
    threadId: string;
  }>();
  const [threadDropTarget, setThreadDropTarget] = useState<{
    projectId: string;
    threadId: string;
    edge: ThreadDropEdge;
  }>();
  const [activeView, setActiveView] = useState<ActiveView>("workspace");
  const [managementActionTarget, setManagementActionTarget] =
    useState<HTMLDivElement | null>(null);
  const [projectInstructionsProject, setProjectInstructionsProject] =
    useState<Project>();
  const [automationDraftRequest, setAutomationDraftRequest] = useState<{
    projectId: string;
    token: number;
  }>();
  const [projectMenuId, setProjectMenuId] = useState<string>();
  const projectMenuAnchor = useRef<HTMLButtonElement | null>(null);
  const [threadMenuId, setThreadMenuId] = useState<string>();
  const [sharingThreadId, setSharingThreadId] = useState<string>();
  const threadMenuAnchor = useRef<HTMLButtonElement | null>(null);
  const threadRenameInput = useRef<HTMLInputElement>(null);
  const [threadRename, setThreadRename] = useState<{
    threadId: string;
    title: string;
  }>();
  const {
    tabsByThread: workspaceTabsByThread,
    setTabsByThread: setWorkspaceTabsByThread,
    dockOpen: workspaceDockOpen,
    setDockOpen: setWorkspaceDockOpen,
  } = useWorkspaceUiState(activeThreadId);
  const [officeAnnotationFocus, setOfficeAnnotationFocus] = useState<
    OfficeAnnotationReference & { threadId: string }
  >();
  const [workspaceDockWidth, setWorkspaceDockWidth] = useState<number>();
  const [workspaceDockResizing, setWorkspaceDockResizing] = useState(false);
  const [workspaceTabScrollState, setWorkspaceTabScrollState] =
    useState<WorkspaceTabScrollState>(EMPTY_WORKSPACE_TAB_SCROLL_STATE);
  const [fileLinkContextMenu, setFileLinkContextMenu] =
    useState<FileLinkContextMenuState>();
  const [workspaceTabMenuOpen, setWorkspaceTabMenuOpen] = useState(false);
  const workspaceTabScroll = useRef<HTMLDivElement>(null);
  const workspaceTabTrack = useRef<HTMLDivElement>(null);
  const activeWorkspaceTabElement = useRef<HTMLDivElement>(null);
  const workspaceTabButtons = useRef(
    new Map<string, HTMLButtonElement | null>(),
  );
  const workspaceDockToggleElement = useRef<HTMLButtonElement>(null);
  const focusWorkspaceTab = useCallback((tabId: string | undefined) => {
    if (!tabId) return;
    workspaceTabButtons.current.get(tabId)?.focus({ preventScroll: true });
  }, []);
  const workspaceContent = useRef<HTMLDivElement>(null);
  const workspaceDock = useRef<HTMLElement>(null);
  const workspaceDockDrag = useRef<WorkspaceDockDrag | undefined>(undefined);
  const workspaceDockWidthRef = useRef<number | undefined>(undefined);
  const workspaceDockPersistence = useRef<Promise<void>>(Promise.resolve());
  const projectSidebar = useRef<HTMLElement>(null);
  const projectSidebarDrag = useRef<ProjectSidebarDrag | undefined>(undefined);
  const projectSidebarWidthRef = useRef<number | undefined>(undefined);
  const projectSidebarPersistence = useRef<Promise<void>>(Promise.resolve());
  const settingsTrigger = useRef<HTMLButtonElement>(null);
  const knownAgentTeamTabs = useRef(new Set<string>());
  const workspaceThreadCreation =
    useRef<Promise<string | undefined>>(undefined);
  const {
    reviewScope,
    setReviewScope,
    reviewTurnId,
    setReviewTurnId,
    environmentCommitRequest,
    setEnvironmentCommitRequest,
    reviewBaseRef,
    setReviewBaseRef,
    reviewFileQuery,
    setReviewFileQuery,
    selectedReviewFilePath,
    setSelectedReviewFilePath,
    reviewBusy,
    setReviewBusy,
    reviewRefreshing,
    setReviewRefreshing,
  } = useReviewSelection();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hooksQuery, setHooksQuery] = useState<HookQuery>({});
  const [settingsTab, setSettingsTab] = useState<SettingsEntryTab>("general");
  const {
    sidebarOpen,
    sidebarPeek,
    sidebarHoverSuppressed,
    sidebarAnimating,
    closeSidebarPeek,
    requestSidebarPeek,
    changeSidebarOpen,
  } = useSidebarNavigation(projectSidebar);
  const [projectSidebarWidth, setProjectSidebarWidth] = useState<number>();
  const defaultProjectSidebarWidth = PROJECT_SIDEBAR_WIDTH_DEFAULT;
  useEffect(() => {
    let compact = window.innerWidth <= 1060;
    const resize = () => {
      const nextCompact = window.innerWidth <= 1060;
      if (nextCompact && !compact) changeSidebarOpen(false);
      compact = nextCompact;
    };
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const [projectSidebarResizing, setProjectSidebarResizing] = useState(false);
  const [clockMs, setClockMs] = useState(() => Date.now());
  const [childAgentControlPending, setChildAgentControlPending] = useState<
    string | undefined
  >();
  const [agentTeamControlPending, setAgentTeamControlPending] = useState(false);
  const [reviewDiff, setReviewDiff] = useState<ReviewDiff | undefined>({
    scope: "branch",
    text: "",
    available: true,
    files: [],
  });
  const [reviewComments, setReviewComments] = useState<ReviewComment[]>([]);
  const [reviewCounts, setReviewCounts] = useState<{
    threadId: string;
    staged?: number;
    unstaged?: number;
  }>();

  const openSettings = (tab: SettingsEntryTab, trigger: HTMLButtonElement) => {
    settingsTrigger.current = trigger;
    setSettingsTab(tab);
    setSettingsOpen(true);
  };
  const [commentLineId, setCommentLineId] = useState<string>();
  const [commentBody, setCommentBody] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmationState>();
  const [busy, setBusy] = useState(false);
  const [compactingThreadIds, setCompactingThreadIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const deletingThreadIds = useRef(new Set<string>());
  const [goalMutationPending, setGoalMutationPending] = useState(false);
  const toastSerial = useRef(0);
  const [failedTabClose, setFailedTabClose] = useState<{
    tabId: string;
    threadId: string;
    path: string;
    message: string;
  }>();
  const [toast, setToastState] = useState<ToastState>();
  const setToast = useCallback((content: ToastContent | undefined) => {
    if (content === undefined) {
      setToastState(undefined);
      return;
    }
    toastSerial.current += 1;
    setToastState({
      content,
      fading: false,
      id: toastSerial.current,
    });
  }, []);
  const projectOrderPersistence = useRef<
    ProjectOrderPersistenceQueue | undefined
  >(undefined);
  const collapsedProjectIdsPersistence = useRef<
    ProjectOrderPersistenceQueue | undefined
  >(undefined);
  const expandedProjectIdsPersistence = useRef<
    ProjectOrderPersistenceQueue | undefined
  >(undefined);
  const projectThreadOrderPersistence = useRef(
    new Map<string, ProjectOrderPersistenceQueue>(),
  );
  if (!projectOrderPersistence.current) {
    projectOrderPersistence.current = createProjectOrderPersistenceQueue({
      save: (order) => window.artemis.setProjectOrder(order),
      onPersisted: (order) => {
        setRuntimeSettings((current) =>
          current ? { ...current, projectOrder: order } : current,
        );
      },
      onRejected: (order, error) => {
        setRuntimeSettings((current) =>
          current ? { ...current, projectOrder: order } : current,
        );
        setToast({
          error: true,
          message: error instanceof Error ? error.message : String(error),
        });
      },
    });
  }
  if (!collapsedProjectIdsPersistence.current) {
    collapsedProjectIdsPersistence.current = createProjectOrderPersistenceQueue(
      {
        save: (projectIds) => window.artemis.setCollapsedProjectIds(projectIds),
        onPersisted: (projectIds) => {
          const next = new Set(projectIds);
          collapsedProjectIdsRef.current = next;
          setCollapsedProjectIds(next);
          setRuntimeSettings((current) =>
            current ? { ...current, collapsedProjectIds: projectIds } : current,
          );
        },
        onRejected: (projectIds, error) => {
          const previous = new Set(projectIds);
          collapsedProjectIdsRef.current = previous;
          setCollapsedProjectIds(previous);
          setRuntimeSettings((current) =>
            current ? { ...current, collapsedProjectIds: projectIds } : current,
          );
          setToast({
            error: true,
            message: error instanceof Error ? error.message : String(error),
          });
        },
      },
    );
  }
  if (!expandedProjectIdsPersistence.current) {
    expandedProjectIdsPersistence.current = createProjectOrderPersistenceQueue({
      save: (projectIds) => window.artemis.setExpandedProjectIds(projectIds),
      onPersisted: (projectIds) => {
        const next = new Set(projectIds);
        expandedProjectIdsRef.current = next;
        setExpandedProjectIds(next);
        setRuntimeSettings((current) =>
          current ? { ...current, expandedProjectIds: projectIds } : current,
        );
      },
      onRejected: (projectIds, error) => {
        const previous = new Set(projectIds);
        expandedProjectIdsRef.current = previous;
        setExpandedProjectIds(previous);
        setRuntimeSettings((current) =>
          current ? { ...current, expandedProjectIds: projectIds } : current,
        );
        setToast({
          error: true,
          message: error instanceof Error ? error.message : String(error),
        });
      },
    });
  }
  const toggleProjectPreview = useCallback((projectId: string) => {
    expandedProjectIdsTouched.current = true;
    const previous = expandedProjectIdsRef.current;
    const next = new Set(previous);
    if (next.has(projectId)) next.delete(projectId);
    else next.add(projectId);
    expandedProjectIdsRef.current = next;
    setExpandedProjectIds(next);
    void expandedProjectIdsPersistence.current?.persist(
      [...next],
      [...previous],
    );
  }, []);
  const setProjectHistoriesCollapsed = useCallback(
    (projectIds: readonly string[], collapsed: boolean) => {
      collapsedProjectIdsTouched.current = true;
      const previous = collapsedProjectIdsRef.current;
      const next = new Set(previous);
      for (const projectId of projectIds) {
        if (collapsed) next.add(projectId);
        else next.delete(projectId);
      }
      if (next.size === previous.size) {
        return;
      }
      collapsedProjectIdsRef.current = next;
      setCollapsedProjectIds(next);
      setRuntimeSettings((current) =>
        current ? { ...current, collapsedProjectIds: [...next] } : current,
      );
      void collapsedProjectIdsPersistence.current?.persist(
        [...next],
        [...previous],
      );
    },
    [],
  );
  const setProjectCollapsed = useCallback(
    (projectId: string, collapsed: boolean) =>
      setProjectHistoriesCollapsed([projectId], collapsed),
    [setProjectHistoriesCollapsed],
  );
  const setProjectRowCollapsed = useCallback(
    (rowId: string, collapsed: boolean) => {
      setProjectCollapsed(rowId.replace(/^project:/, ""), collapsed);
    },
    [setProjectCollapsed],
  );
  const temporaryConversationsPersistence = useRef<
    BooleanPreferencePersistenceQueue | undefined
  >(undefined);
  if (!temporaryConversationsPersistence.current) {
    temporaryConversationsPersistence.current =
      createBooleanPreferencePersistenceQueue({
        save: (open) => window.artemis.setTemporaryConversationsOpen(open),
        onPersisted: (open) => {
          setTemporaryConversationsOpen(open);
          setRuntimeSettings((current) =>
            current
              ? { ...current, temporaryConversationsOpen: open }
              : current,
          );
        },
        onRejected: (open, error) => {
          setTemporaryConversationsOpen(open);
          setToast({
            error: true,
            message: error instanceof Error ? error.message : String(error),
          });
        },
      });
  }
  const [turnFailureNotices, setTurnFailureNotices] =
    useState<TurnFailureNotices>({});
  const [editingQueuedMessage, setEditingQueuedMessage] = useState<{
    index: number;
    value: string;
  }>();
  const [queuedSaveErrorDetail, setQueuedSaveErrorDetail] = useState<
    string | null
  >(null);
  const timelineScroll = useRef<HTMLDivElement>(null);
  const timelinePinned = useRef(true);
  const timelineScrollSnapshots = useRef(
    new Map<string, TimelineScrollSnapshot>(),
  );
  const pendingTimelineRestore = useRef<
    | {
        threadId: string;
        snapshot?: TimelineScrollSnapshot;
      }
    | undefined
  >(undefined);
  const timelineScrollIntent = useRef(false);
  const timelineScrollbarPointerActive = useRef(false);
  const [historyPages, setHistoryPages] = useState<
    Record<string, ThreadHistoryPage>
  >({});
  const loadingHistoryPages = useRef(new Set<string>());
  const historyPrependAnchor = useRef<
    { threadId: string; element: Element; top: number } | undefined
  >(undefined);
  const loadedEventThreads = useRef(new Set<string>());
  const loadingEventThreads = useRef(new Set<string>());
  const [historyLoadErrors, setHistoryLoadErrors] = useState<
    Record<string, true>
  >({});
  const [historyRetry, setHistoryRetry] = useState(0);
  const pendingAgentEvents = useRef<AgentEvent[]>([]);
  const pendingAgentFrame = useRef<number | undefined>(undefined);
  const [liveChildActivities, setLiveChildActivities] = useState<
    Record<string, Record<string, LiveChildActivity>>
  >({});
  const reportedTurnPaints = useRef(new Set<string>());
  const recoveredQueueEventIds = useRef(new Set<string>());
  const promptInput = useRef<HTMLTextAreaElement>(null);
  const previousPendingDecisionId = useRef<string | undefined>(undefined);
  const approvalPolicyRoot = useRef<HTMLDivElement>(null);
  const modelPickerRoot = useRef<HTMLDivElement>(null);
  const composerBoundary = useRef<HTMLDivElement>(null);
  const slashCommandMenu = useRef<HTMLDivElement>(null);
  const confirmationResolver = useRef<
    ((confirmed: boolean) => void) | undefined
  >(undefined);
  const promptedGoalResumes = useRef(new Set<string>());
  const goalEditorGoalId = useRef<string | undefined>(undefined);
  const promptHistoryNavigation = useRef<PromptHistoryNavigation>({
    index: -1,
    draft: "",
  });
  const reviewRequestId = useRef(0);
  const reviewScopeThreadId = useRef(activeThreadId);
  const reviewDiffCache = useRef(new Map<string, ReviewDiff>());
  const reviewDiffInFlight = useRef(new Map<string, Promise<ReviewDiff>>());
  const reviewDiffVersion = useRef(new Map<string, number>());
  const [reviewTransitionPending, startReviewTransition] = useTransition();
  const threadStateCache = useRef(
    new BoundedStateCache<{
      history?: ThreadHistoryPage;
      eventCount: number;
      lastEventId?: string;
      mode: RunMode;
      state: ThreadViewState;
    }>((id) => turnWatermarks.current.delete(id)),
  );
  const [officeSnapshots, setOfficeSnapshots] = useState<
    Record<string, ArtifactSnapshot>
  >({});
  const recoverOfficeSnapshot = useCallback((next: ArtifactSnapshot) => {
    setOfficeSnapshots((current) => {
      if (
        (current[next.session.sessionId]?.session.sequence ?? -1) >=
        next.session.sequence
      )
        return current;
      return Object.fromEntries([
        ...Object.entries(current)
          .filter(([id]) => id !== next.session.sessionId)
          .slice(-19),
        [next.session.sessionId, next],
      ]);
    });
  }, []);
  // Highest turn count ever derived per thread. Cross-switch cache pollution
  // can shrink a derivation below what this thread already rendered; the
  // memo re-derives from raw inputs whenever that watermark is exceeded.
  const turnWatermarks = useRef(new Map<string, number>());

  const locale: Locale = snapshot?.locale ?? "en";
  const t = appCopy(locale);
  useEffect(
    () =>
      window.artemis.onUpdateStatus((update) => {
        setRuntimeSettings((current) =>
          current ? { ...current, update } : current,
        );
      }),
    [],
  );
  useEffect(() => {
    const version = runtimeSettings?.update.completedVersion;
    if (!version || announcedUpdate.current === version) return;
    announcedUpdate.current = version;
    if (claimUpdateAnnouncement(version)) {
      setUpdateAnnouncement(version);
    }
  }, [runtimeSettings?.update.completedVersion, locale, setToast]);
  const username = snapshot?.userName ?? t.local;
  const {
    welcome: emptyConversationGreeting,
    renew: renewConversationGreeting,
  } = useConversationWelcome(locale, username);
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const activeThreadIdRef = useRef(activeThreadId);
  activeThreadIdRef.current = activeThreadId;
  workspaceDockWidthRef.current = workspaceDockWidth;
  projectSidebarWidthRef.current = projectSidebarWidth;
  const {
    activeComposerDraftKey,
    activeComposerDraft,
    attachments,
    prompt,
    selectedComposerSkillNames,
    customAgentTasks,
    composerPrediction,
    hasOfficeAnnotations,
    hasRegularAttachments,
    draftAttachments,
    designAnnotationDrafts,
    designDocBinding,
    setDesignDocBinding,
    designDocBindingRef,
    designPluginAvailable,
    designPanelAutoSendText,
    reviewCommentAutoSendText,
    designPanelCredentials,
    pendingAttachmentReads,
    setPrompt,
    groupMentions,
    focusAgentTaskId,
    setCustomAgentTasks,
    customAgentMention,
    copyConversationText,
    editConversationMessage,
    setSelectedComposerSkillNames,
    setAttachments,
  } = useConversationDraft({
    activeProjectId,
    activeThreadId,
    composerDrafts,
    runtimeSettings,
    setWorkspaceTabsByThread,
    setComposerDrafts,
    imThreadStatus,
    promptInput,
    snapshot,
    installedPlugins,
    installedSkills,
    skillsLoading,
    t,
    setToast,
  });

  const restoringOfficeAnnotations = useRef(new Set<string>());
  useEffect(() => {
    for (const attachment of attachments) {
      if (!isStoredOfficeAnnotations(attachment)) continue;
      const key = `${activeComposerDraftKey}:${attachment.id}`;
      if (restoringOfficeAnnotations.current.has(key)) continue;
      restoringOfficeAnnotations.current.add(key);
      void pendingAttachmentReads.current.track(
        activeComposerDraftKey,
        restoreOfficeAnnotationAttachment(attachment, (offset) =>
          window.artemis.previewPromptFile(
            attachment.id,
            offset,
            activeThreadId,
          ),
        )
          .then((restored) =>
            setAttachments((current) =>
              current.map((item) =>
                isAttachmentReference(item) && item.id === attachment.id
                  ? restored
                  : item,
              ),
            ),
          )
          .catch((error) => setToast({ error: true, message: String(error) }))
          .finally(() => restoringOfficeAnnotations.current.delete(key)),
      );
    }
  }, [
    attachments,
    activeComposerDraftKey,
    activeThreadId,
    setAttachments,
    setToast,
  ]);

  const {
    beginNewConversation,
    beginTemporaryConversation,
    discardNewConversationDraft,
    toggleProjectHistory,
  } = useConversationNavigation({
    promptHistoryNavigation,
    prompt,
    setSkillMenuDismissed,
    setEditingQueuedMessage,
    activeComposerDraftKey,
    renewConversationGreeting,
    setActiveView,
    setActiveProjectId,
    setActiveThreadId,
    setMode,
    setComposerDrafts,
    setProjectMenuId,
    setThreadMenuId,
    promptInput,
    activeProjectId,
    activeThreadId,
    collapsedProjectIdsRef,
    setProjectCollapsed,
  });

  const toggleTemporaryConversations = useCallback(() => {
    setTemporaryConversationsOpen(
      temporaryConversationsPersistence.current!.toggle(),
    );
  }, []);
  const collapseProjectTreeRow = useCallback(
    (rowId: string) => {
      if (rowId === "collection:projects") {
        setProjectsExpanded(false);
        setProjectsOpen(false);
        return;
      }
      if (rowId === "temporary:conversations") {
        if (temporaryConversationsOpen) void toggleTemporaryConversations();
        return;
      }
      setProjectRowCollapsed(rowId, true);
    },
    [
      temporaryConversationsOpen,
      setProjectRowCollapsed,
      toggleTemporaryConversations,
    ],
  );
  const expandProjectTreeRow = useCallback(
    (rowId: string) => {
      if (rowId === "collection:projects") {
        setProjectsExpanded(true);
        setProjectsOpen(true);
        return;
      }
      if (rowId === "temporary:conversations") {
        if (!temporaryConversationsOpen) void toggleTemporaryConversations();
        return;
      }
      setProjectRowCollapsed(rowId, false);
    },
    [
      temporaryConversationsOpen,
      setProjectRowCollapsed,
      toggleTemporaryConversations,
    ],
  );
  const activateProjectTreeRow = useCallback(
    (rowId: string) => {
      if (rowId === "collection:projects") {
        toggleProjectsExpansion();
        return;
      }
      if (rowId === "temporary:conversations") {
        void toggleTemporaryConversations();
        return;
      }
      if (rowId.startsWith("project:")) {
        toggleProjectHistory(rowId.replace(/^project:/, ""));
        return;
      }
      if (rowId.startsWith("thread:")) {
        if (!snapshot) return;
        const thread = snapshot.threads.find(
          (candidate) => candidate.id === rowId.replace(/^thread:/, ""),
        );
        if (!thread) return;
        discardNewConversationDraft();
        setActiveView("workspace");
        setActiveProjectId(thread.projectId ?? undefined);
        setActiveThreadId(thread.id);
        setMode(thread.mode);
        setThreadMenuId(undefined);
      }
    },
    [
      discardNewConversationDraft,
      snapshot?.threads,
      toggleProjectHistory,
      toggleProjectsExpansion,
      toggleTemporaryConversations,
    ],
  );

  const { requestConfirmation, resolveConfirmation } = useOverlayInteractions({
    confirmationResolver,
    setConfirmation,
    toast,
    setToastState,
    approvalMenuOpen,
    setApprovalMenuOpen,
    approvalPolicyRoot,
    modelPickerOpen,
    setModelPickerOpen,
    modelPickerRoot,
    projectMenuId,
    threadMenuId,
    setProjectMenuId,
    setThreadMenuId,
  });

  const {
    skillCommandMenuOpen,
    installedPluginBySkillName,
    slashCommandSuggestions,
    goalSuggestionIndex,
    compactSuggestionIndex,
    initSuggestionIndex,
    modeSuggestions,
    skillSuggestions,
    selectedSkills,
  } = useComposerSuggestions({
    skillMenuDismissed,
    prompt,
    installedPlugins,
    selectedComposerSkillNames,
    installedSkills,
    skillsLoading,
  });
  const { createThread, ensureWorkspaceThread } = useThreadCreation({
    snapshot,
    mode,
    loadedEventThreads,
    setSnapshot,
    setComposerDrafts,
    setActiveView,
    setActiveProjectId,
    setActiveThreadId,
    t,
    setToast,
    activeProjectId,
    activeThreadId,
    workspaceThreadCreation,
  });

  const {
    workspaceTabs,
    activeWorkspaceTab,
    syncWorkspaceTabScrollState,
    scrollWorkspaceTabs,
    handleWorkspaceTabWheel,
    dispatchWorkspaceTab,
    closeWorkspaceTab,
    openWorkspaceTab,
    openResolvedWorkspaceFile,
  } = useWorkspaceTabsController({
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
  });

  const {
    openConversationFileLink,
    openConversationExternalLink,
    openConversationFileLinkMenu,
    revealConversationFile,
    runConversationFile,
  } = useConversationLinks({
    activeThreadId,
    activeThreadIdRef,
    openResolvedWorkspaceFile,
    setToast,
    locale,
    openWorkspaceTab,
    setFileLinkContextMenu,
    t,
    fileLinkContextMenu,
  });

  const {
    openChildAgentPanel,
    openAgentTeamPanel,
    controlChildAgent,
    stopAgentTeam,
  } = useAgentControls({
    setWorkspaceDockOpen,
    setWorkspaceTabMenuOpen,
    dispatchWorkspaceTab,
    t,
    activeThreadId,
    setChildAgentControlPending,
    localeRef,
    setToast,
    setAgentTeamControlPending,
  });

  const openReviewPanel = useCallback(() => {
    if (!activeProjectId) return;
    return openWorkspaceTab("review");
  }, [activeProjectId, openWorkspaceTab]);
  const openTerminalPanel = useCallback(
    () => openWorkspaceTab("terminal"),
    [openWorkspaceTab],
  );
  const openBrowserPanel = useCallback(
    () => openWorkspaceTab("browser"),
    [openWorkspaceTab],
  );
  const openFilesPanel = useCallback(
    () => openWorkspaceTab("file"),
    [openWorkspaceTab],
  );
  const openSourcesPanel = useCallback(
    () => openWorkspaceTab("sources"),
    [openWorkspaceTab],
  );
  const openAutomationThread = useCallback(
    async (threadId: string) => {
      const refreshed = await window.artemis.getSnapshot();
      setSnapshot((current) => preserveLoadedEvents(refreshed, current));
      const thread = refreshed.threads.find(
        (candidate) => candidate.id === threadId,
      );
      if (!thread) {
        setActiveThreadId(undefined);
        setActiveView("workspace");
        return;
      }
      discardNewConversationDraft();
      setActiveProjectId(thread.projectId);
      setActiveThreadId(thread.id);
      setMode(thread.mode);
      setActiveView("workspace");
    },
    [discardNewConversationDraft],
  );
  const {
    persistProjectOrder,
    persistProjectThreadOrder,
    beginProjectSidebarResize,
    moveProjectSidebarResize,
    finishProjectSidebarResize,
    cancelProjectSidebarResize,
    resizeProjectSidebarFromKeyboard,
  } = useProjectLayout({
    projectSidebarPersistence,
    setProjectSidebarWidth,
    setRuntimeSettings,
    setToast,
    projectOrderPersistence,
    projectThreadOrderPersistence,
    projectSidebarDrag,
    projectSidebarWidthRef,
    sidebarOpen,
    projectSidebar,
    setProjectSidebarResizing,
  });
  const {
    beginWorkspaceDockResize,
    moveWorkspaceDockResize,
    finishWorkspaceDockResize,
    cancelWorkspaceDockResize,
    resizeWorkspaceDockFromKeyboard,
    toggleRightSidebar,
    toggleReviewPanel,
    toggleTerminalPanel,
  } = useWorkspaceDockLayout({
    workspaceContent,
    workspaceDockPersistence,
    setWorkspaceDockWidth,
    setRuntimeSettings,
    setToast,
    workspaceDockDrag,
    workspaceDockWidthRef,
    workspaceDockOpen,
    workspaceDock,
    setWorkspaceDockResizing,
    setWorkspaceDockOpen,
    setWorkspaceTabMenuOpen,
    openReviewPanel,
    activeWorkspaceTab,
    openTerminalPanel,
  });

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = localeDirection(locale);
    void i18n.changeLanguage(locale);
  }, [i18n, locale]);

  useEffect(() => {
    const theme = runtimeSettings?.theme ?? "system";
    void desktopSkinHost.setTheme(theme);
  }, [runtimeSettings?.theme]);

  useEffect(() => {
    if (
      runtimeSettings?.projectSidebarWidth !== undefined &&
      !projectSidebarResizing
    ) {
      setProjectSidebarWidth(runtimeSettings.projectSidebarWidth);
    }
  }, [projectSidebarResizing, runtimeSettings?.projectSidebarWidth]);

  useEffect(() => {
    setTemporaryConversationsOpen(
      temporaryConversationsPersistence.current!.initialize(
        runtimeSettings?.temporaryConversationsOpen ?? true,
      ),
    );
  }, [runtimeSettings?.temporaryConversationsOpen]);

  useEffect(() => {
    if (
      runtimeSettings?.workspaceDockWidth !== undefined &&
      !workspaceDockResizing
    ) {
      setWorkspaceDockWidth(runtimeSettings.workspaceDockWidth);
    }
  }, [runtimeSettings?.workspaceDockWidth, workspaceDockResizing]);

  useEffect(() => {
    // Refresh preserved queries on return and when an in-flight resource
    // change finishes after the user has already returned to the composer.
    if (activeView !== "workspace") return;
    let mounted = true;
    let latestRequest = 0;
    const refresh = () => {
      const request = ++latestRequest;
      setSkillsLoading(true);
      setSkillsError(undefined);
      void Promise.all([
        window.artemis.listInstalledSkills(),
        window.artemis.listArtemisPlugins().catch(() => []),
      ])
        .then(([skills, plugins]) => {
          if (!mounted || request !== latestRequest) return;
          setInstalledSkills(skills);
          setInstalledPlugins(plugins);
        })
        .catch((error) => {
          if (mounted && request === latestRequest) {
            setInstalledSkills([]);
            setSkillsError(
              error instanceof Error ? error.message : String(error),
            );
          }
        })
        .finally(() => {
          if (mounted && request === latestRequest) setSkillsLoading(false);
        });
    };
    refresh();
    window.addEventListener("artemis:resources-changed", refresh);
    return () => {
      mounted = false;
      window.removeEventListener("artemis:resources-changed", refresh);
    };
  }, [activeView, skillCommandMenuOpen, customAgentMention.queryActive]);

  useEffect(() => {
    setActiveSlashSuggestion(0);
  }, [prompt, slashCommandSuggestions.length]);

  useLayoutEffect(() => {
    if (!skillCommandMenuOpen) return;
    const menu = slashCommandMenu.current;
    const option = menu?.querySelector<HTMLElement>(
      `#skill-command-option-${activeSlashSuggestion}`,
    );
    if (!menu || !option) return;
    const rows = [
      ...menu.querySelectorAll<HTMLElement>(
        ".slash-command-suggestion, .slash-command-heading",
      ),
    ];
    // Let the final scroll position land on a whole row as well.
    menu.style.setProperty("--slash-menu-end-padding", "6px");
    const maximumScroll = menu.scrollHeight - menu.clientHeight;
    const lastTopRow = rows.find((row) => row.offsetTop - 6 >= maximumScroll);
    if (maximumScroll > 0 && lastTopRow) {
      menu.style.setProperty(
        "--slash-menu-end-padding",
        `${lastTopRow.offsetTop - maximumScroll}px`,
      );
    }
    const optionTop = option.offsetTop;
    const optionBottom = optionTop + option.offsetHeight;
    if (optionTop < menu.scrollTop + 6) {
      menu.scrollTop = Math.max(0, optionTop - 6);
    } else if (optionBottom > menu.scrollTop + menu.clientHeight - 6) {
      const minimumTop = optionBottom - menu.clientHeight + 6;
      // Align a whole row at the top while keeping the selected row in view.
      // Arbitrary pixel offsets cut through icons; nearest CSS snapping alone
      // can instead leave the selected row clipped at the bottom.
      const firstVisibleRow = rows.find(
        (row) => row.offsetTop - 6 >= minimumTop,
      );
      menu.scrollTop = firstVisibleRow
        ? firstVisibleRow.offsetTop - 6
        : minimumTop;
    }
  }, [
    activeSlashSuggestion,
    skillCommandMenuOpen,
    slashCommandSuggestions.length,
  ]);

  useApplicationSubscriptions({
    setWindowMaterial,
    setToast,
    setInstalledPlugins,
    setSnapshot,
    setActiveProjectId,
    setActiveThreadId,
    setMode,
    projectOrderPersistence,
    collapsedProjectIdsPersistence,
    collapsedProjectIdsRef,
    setCollapsedProjectIds,
    collapsedProjectIdsTouched,
    expandedProjectIdsPersistence,
    expandedProjectIdsRef,
    setExpandedProjectIds,
    expandedProjectIdsTouched,
    setApprovalPolicy,
    setRuntimeSettings,
    setPromptHistory,
    pendingAgentFrame,
    pendingAgentEvents,
    activeThreadIdRef,
    reportedTurnPaints,
    composerPrediction,
    get liveOfficeTabs() {
      return liveOfficeTabs;
    },
    knownAgentTeamTabs,
    localeRef,
    setWorkspaceTabsByThread,
    setTurnFailureNotices,
    recoveredQueueEventIds,
    setComposerDrafts,
    setLiveChildActivities,
  });

  useBrowserWorkspace({
    setWorkspaceTabsByThread,
    openAutomationThread,
    activeThreadId,
    openBrowserPanel,
    locale,
    setToast,
    linkOpenedThread,
    setSnapshot,
  });

  useEffect(() => {
    if (!snapshot) return;

    let cancelled = false;
    const readyTimer = setTimeout(() => {
      void desktopSkinReady.then(() => {
        if (cancelled) return;
        if (
          performance.getEntriesByName?.("artemis:renderer-ready").length === 0
        ) {
          performance.mark?.("artemis:renderer-ready");
        }
        window.artemis.rendererReady();
      });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(readyTimer);
    };
  }, [snapshot]);

  useEffect(() => {
    if (!snapshot) return;
    const panelTimer = window.setTimeout(() => {
      void Promise.all([loadResourceCenter(), loadSettingsPanel()]).catch(
        () => undefined,
      );
    }, 250);
    const idleCallback = window.requestIdleCallback(
      () => {
        void loadTerminalPanel().catch(() => undefined);
      },
      {
        timeout: 2_000,
      },
    );
    return () => {
      window.clearTimeout(panelTimer);
      window.cancelIdleCallback(idleCallback);
    };
  }, [Boolean(snapshot)]);

  const projects = useMemo(
    () =>
      orderProjectsByPreference(
        snapshot?.projects ?? [],
        runtimeSettings?.projectOrder,
      ),
    [runtimeSettings?.projectOrder, snapshot?.projects],
  );
  const hasExpandedProject = projects.some(
    (project) => !collapsedProjectIds.has(project.id),
  );
  const temporaryThreads = sortProjectThreads(
    (snapshot?.threads ?? [])
      .filter((thread) => !thread.projectId && !thread.archived)
      .filter(
        (thread) =>
          !isWorkspaceDraftThread(thread) &&
          (!imThreadStatus[thread.id]?.group?.native ||
            !!imThreadStatus[thread.id]?.group?.retired ||
            !!imThreadStatus[thread.id]?.parentThreadId),
      )
      .filter(
        (thread) =>
          !query.trim() ||
          thread.title.toLowerCase().includes(query.trim().toLowerCase()),
      ),
    snapshot?.events ?? {},
    promptSubmittedAtByThread,
  );
  const activeThread = (snapshot?.threads ?? []).find(
    (thread) => thread.id === activeThreadId,
  );
  const activeProject = projects.find(
    (project) => project.id === (activeThread?.projectId ?? activeProjectId),
  );
  const activeWorkspaceLabel = activeProject?.name ?? t.temporaryConversation;
  useEffect(() => {
    if (!activeThreadId) return;
    const connection = imThreadStatus[activeThreadId];
    if (
      !connection?.group?.native ||
      connection.group.retired ||
      connection.parentThreadId
    )
      return;
    // Restore old group-page links to a normal task after the overview is removed.
    const task = snapshot?.threads
      .filter(
        (thread) =>
          imThreadStatus[thread.id]?.parentThreadId === activeThreadId &&
          !thread.archived,
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    setActiveThreadId(task?.id);
    if (task) {
      setActiveProjectId(task.projectId);
      setMode(task.mode);
    }
  }, [activeThreadId, imThreadStatus, snapshot?.threads]);

  const [emptyConversationPrefix, emptyConversationSuffix = ""] =
    emptyConversationGreeting.projectPrompt.split("{{workspace}}");
  const emptyConversationLabel = activeProject
    ? `${emptyConversationPrefix}${activeProject.name}${emptyConversationSuffix}`
    : emptyConversationGreeting.temporaryPrompt;
  const dockWidthBounds = workspaceDockWidthBounds(
    workspaceContent.current?.clientWidth ?? window.innerWidth,
    window.innerWidth,
  );
  const dockWidthNow = clampWorkspaceDockWidth(
    workspaceDockWidth ?? DEFAULT_WORKSPACE_DOCK_WIDTH,
    dockWidthBounds,
  );
  const filteredReviewFiles = useMemo(() => {
    const normalizedQuery = reviewFileQuery.trim().toLowerCase();
    if (!normalizedQuery) return reviewDiff?.files ?? [];
    return (reviewDiff?.files ?? []).filter((file) =>
      file.path.toLowerCase().includes(normalizedQuery),
    );
  }, [reviewDiff, reviewFileQuery]);
  const selectedReviewFile = useMemo(
    () =>
      reviewDiff?.files.find((file) => file.path === selectedReviewFilePath) ??
      reviewDiff?.files[0],
    [reviewDiff, selectedReviewFilePath],
  );
  const {
    activeHistoryPending,
    activeHistoryError,
    activeHistory,
    loadEarlierHistory,
  } = useConversationHistory({
    activeThreadId,
    linkOpenedThread,
    loadedEventThreads,
    loadingEventThreads,
    historyLoadErrors,
    setHistoryLoadErrors,
    setHistoryPages,
    setSnapshot,
    historyRetry,
    historyPages,
    loadingHistoryPages,
    setToast,
    timelineScroll,
    historyPrependAnchor,
    activeThreadIdRef,
  });
  const {
    activeEvents,
    latestHtmlChange,
    latestMarkdownChange,
    threadState,
    liveOfficeTabs,
    activePromptHistory,
    latestAgentTeam,
    environmentAgents,
    environmentTeams,
  } = useConversationState({
    snapshot,
    activeThread,
    activeThreadId,
    activeView,
    loadedEventThreads,
    activeHistory,
    workspaceDockOpen,
    threadStateCache,
    turnWatermarks,
    officeSnapshots,
    liveChildActivities,
    setWorkspaceTabsByThread,
    promptHistory,
  });
  const environmentMcpUsages = useMemo(
    () =>
      (threadState?.mcpToolUseOrder ?? []).flatMap((key) => {
        const usage = threadState?.mcpToolUses[key];
        return usage ? [usage] : [];
      }),
    [threadState?.mcpToolUseOrder, threadState?.mcpToolUses],
  );
  const environmentSources = useMemo(
    () =>
      (threadState?.taskSourceOrder ?? []).flatMap((sourceId) => {
        const source = threadState?.taskSources[sourceId];
        return source ? [source] : [];
      }),
    [threadState?.taskSourceOrder, threadState?.taskSources],
  );
  const environmentWorktree = snapshot?.worktrees.find(
    (worktree) =>
      worktree.threadId === activeThread?.id && worktree.status === "active",
  );
  const environmentWorkspaceKey = JSON.stringify([
    activeProject?.id,
    activeThread?.id,
    activeThread?.target,
    activeProject?.path,
    environmentWorktree?.id,
    environmentWorktree?.path,
  ]);
  const receiveWelcomeGit = useCallback(
    (info: ProjectGitInfo | undefined) => {
      setWelcomeGit({ key: environmentWorkspaceKey, info });
    },
    [environmentWorkspaceKey],
  );
  const refreshWorkspaceSnapshot = async () => {
    const refreshed = await window.artemis.getSnapshot();
    setSnapshot((current) => preserveLoadedEvents(refreshed, current));
  };
  const handoffActiveWorkspace = activeThread
    ? async (destination: "local" | "managed-worktree") => {
        await window.artemis.handoffWorkspace(activeThread.id, destination);
        await refreshWorkspaceSnapshot();
      }
    : undefined;

  const environmentRefreshKey = useMemo(() => {
    for (let index = activeEvents.length - 1; index >= 0; index -= 1) {
      const event = activeEvents[index];
      if (event?.payload.type === "file.changed") return event.eventId;
    }
    return undefined;
  }, [activeEvents]);
  useEffect(() => {
    if (
      !activeThreadId ||
      !latestAgentTeam ||
      knownAgentTeamTabs.current.has(latestAgentTeam.teamId)
    ) {
      return;
    }
    knownAgentTeamTabs.current.add(latestAgentTeam.teamId);
    setWorkspaceTabsByThread((current) => ({
      ...current,
      [activeThreadId]: reconcileAgentTeamWorkspaceTab(
        current[activeThreadId] ?? emptyWorkspaceTabs(),
        agentTeamWorkspaceTab(latestAgentTeam.teamId, t.agentTeam),
      ),
    }));
  }, [activeThreadId, latestAgentTeam, t.agentTeam]);
  const latestReviewUndoTurn = threadState?.turnOrder.findLast(
    (id) => threadState.turns[id]?.status === "completed",
  );
  const reviewUndoAvailable = Boolean(
    latestReviewUndoTurn &&
    threadState?.status === "idle" &&
    threadState.turns[latestReviewUndoTurn]?.changeSet?.undoAvailable &&
    (reviewScope !== "turn" || reviewTurnId === latestReviewUndoTurn),
  );
  const pendingComposerDecision = firstPendingComposerDecision(threadState);
  const activePendingDecisionId = pendingComposerDecision?.entry;
  useEffect(() => {
    const previousId = previousPendingDecisionId.current;
    previousPendingDecisionId.current = activePendingDecisionId;
    if (!previousId || activePendingDecisionId) return;
    const frame = window.requestAnimationFrame(() => {
      promptInput.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activePendingDecisionId]);
  const contextCompacting =
    (activeThreadId !== undefined && compactingThreadIds.has(activeThreadId)) ||
    Object.values(threadState?.contextCompactions ?? {}).some(
      (item) => item.status === "running",
    );
  const turnRunning =
    threadState?.status === "running" ||
    threadState?.status === "waiting-approval" ||
    threadState?.status === "waiting-user-input";
  const turnActive = contextCompacting || turnRunning;
  const visibleComposerPrediction =
    !turnActive &&
    !busy &&
    !pendingComposerDecision &&
    !customAgentMention.open &&
    !skillCommandMenuOpen
      ? composerPrediction.text
      : undefined;
  const projectBranchActionsDisabled =
    turnActive ||
    (snapshot?.threads ?? []).some(
      (thread) =>
        thread.projectId === activeProjectId &&
        thread.target === "local" &&
        (thread.status === "running" || thread.status === "waiting-approval"),
    );
  const latestTimelineEntryIsCompaction =
    threadState?.order.at(-1)?.startsWith("compaction:") ?? false;
  const queuedFollowUps = threadState?.queue.followUp ?? [];
  const approvalChangeLocked =
    busy ||
    (snapshot?.threads.some(
      (thread) =>
        thread.status === "running" || thread.status === "waiting-approval",
    ) ??
      false);
  const approvalPolicyLabel = {
    ask: t.askApproval,
    agent: t.agentApproval,
    "full-access": t.fullAccess,
    custom: t.customApproval,
  }[approvalPolicy];
  const approvalPolicyIcon =
    approvalPolicy === "full-access"
      ? "approval-full"
      : approvalPolicy === "agent"
        ? "approval-agent"
        : "approval-ask";
  const {
    activeSelection,
    activeModel,
    activeProvider,
    activeModelLabel,
    activeModelSupportsReasoning,
    activeThinkingLevel,
    switchableModels,
    filteredModels,
  } = useComposerModelDetails({
    pendingModelSelection,
    activeThread,
    runtimeSettings,
    t,
    locale,
    modelFilter,
  });
  const activeTurnFailure = activeThreadId
    ? (turnFailureNotices[activeThreadId] ??
      (threadState?.error
        ? localizedTurnFailure(t, threadState.error, threadState.errorCode)
        : undefined))
    : undefined;
  const failedTurnPrompt = activeTurnFailure
    ? latestFailedTurnPrompt(threadState)
    : undefined;
  const turnFailureBanner = activeTurnFailure ? (
    <div className="turn-error-banner" role="alert">
      <ArtemisIcon name="alert" width={18} height={18} />
      <div className="turn-error-copy">
        <strong>{t.failed}</strong>
        <p>{activeTurnFailure}</p>
        {!activeThread?.archived && (
          <div className="turn-error-actions">
            {failedTurnPrompt && (
              <button
                type="button"
                disabled={
                  busy ||
                  turnActive ||
                  Boolean(pendingComposerDecision) ||
                  Boolean(prompt.trim()) ||
                  attachments.length > 0 ||
                  selectedComposerSkillNames.length > 0 ||
                  customAgentTasks.length > 0
                }
                onClick={() => editConversationMessage(failedTurnPrompt)}
              >
                <ArtemisIcon name="edit" width={14} height={14} />
                {t.editAndResend}
              </button>
            )}
            <button
              type="button"
              className="turn-error-secondary"
              disabled={
                busy ||
                turnActive ||
                Boolean(pendingComposerDecision) ||
                switchableModels.length === 0
              }
              onClick={() => {
                setApprovalMenuOpen(false);

                setModelFilter("");
                setModelPickerOpen(true);
              }}
            >
              {uiText(locale, "DecisionCard.changeModel")}
            </button>
          </div>
        )}
      </div>
      {!threadState?.error && (
        <button
          aria-label={t.dismissTurnError}
          onClick={() =>
            activeThreadId &&
            setTurnFailureNotices((current) =>
              reduceTurnFailureNotices(current, {
                type: "dismiss",
                threadId: activeThreadId,
              }),
            )
          }
          title={t.dismissTurnError}
          type="button"
        >
          <CloseIcon />
        </button>
      )}
    </div>
  ) : null;

  const { switchComposerModel, switchComposerThinking } =
    useComposerModelSelection({
      runtimeSettings,
      turnActive,
      busy,
      pendingModelSelection,
      activeSelection,
      setPendingModelSelection,
      activeThread,
      activeProjectId,
      createThread,
      setRuntimeSettings,
      setSnapshot,
      t,
      setToast,
    });
  const runPresentation = useMemo(
    () => deriveRunPresentation(activeEvents, clockMs, threadState?.status),
    [activeEvents, clockMs, threadState?.status],
  );
  const delegationWaiting =
    !turnActive &&
    !!(
      activeThreadId &&
      imThreadStatus[activeThreadId]?.delegationWaits?.some(
        (wait) => wait.state !== "interrupted",
      )
    );
  const retiredGroup = activeThreadId
    ? imThreadStatus[activeThreadId]?.group?.retired
    : undefined;
  const permissionBlock = activeThreadId
    ? imThreadStatus[activeThreadId]?.permissionBlock
    : undefined;
  const remoteWaiting = delegationWaiting || (!turnActive && !!permissionBlock);
  const statusDotStatus = remoteWaiting
    ? "waiting-approval"
    : activeThread
      ? threadPresentationStatus(
          activeThread,
          threadState,
          runPresentation.status,
        )
      : "idle";
  const taskPlan = useMemo(
    () => deriveTaskPlan(activeEvents, turnActive),
    [activeEvents, turnActive],
  );

  const openHtmlFromFiles = useCallback(
    (path: string) => {
      openWorkspaceTab("browser", { path });
    },
    [openWorkspaceTab],
  );

  const openGoalEditor = useCallback(() => {
    if (!activeThread?.goal) {
      setToast(t.noGoal);
      return;
    }
    openWorkspaceTab("goal", { reuseKind: true });
  }, [activeThread?.goal, openWorkspaceTab, t.noGoal]);

  const closeGoalEditor = useCallback(() => {
    const goalTab = workspaceTabs.tabs.find((tab) => tab.kind === "goal");
    if (goalTab) closeWorkspaceTab(goalTab.id);
  }, [closeWorkspaceTab, workspaceTabs.tabs]);

  useEffect(() => {
    const goalTabOpen = workspaceTabs.tabs.some((tab) => tab.kind === "goal");
    if (!goalTabOpen) {
      goalEditorGoalId.current = undefined;
      return;
    }
    const currentGoalId = activeThread?.goal?.goalId;
    if (
      !currentGoalId ||
      (goalEditorGoalId.current !== undefined &&
        goalEditorGoalId.current !== currentGoalId)
    ) {
      closeGoalEditor();
      return;
    }
    goalEditorGoalId.current = currentGoalId;
  }, [activeThread?.goal?.goalId, closeGoalEditor, workspaceTabs.tabs]);

  useEffect(() => {
    setClockMs(Date.now());
    const interval =
      turnActive || activeThread?.goal?.status === "active" ? 1_000 : 60_000;
    const timer = window.setInterval(() => setClockMs(Date.now()), interval);
    return () => window.clearInterval(timer);
  }, [activeThread?.goal?.status, turnActive]);

  useTimelineViewport({
    timelinePinned,
    pendingTimelineRestore,
    activeThreadId,
    activeView,
    timelineScrollSnapshots,
    loadedEventThreads,
    activeThreadIdRef,
    timelineScroll,
    activeEvents,
    threadState,
    timelineScrollbarPointerActive,
  });

  const {
    refreshDiff,
    selectReviewScope,
    openReviewScopePanel,
    openReviewTurnPanel,
    undoTurnChanges,
    reviewCount,
    mutateReview,
    saveReviewComment,
    deleteReviewComment,
  } = useReviewController({
    reviewScopeThreadId,
    activeThreadId,
    reviewRequestId,
    setReviewScope,
    setReviewTurnId,
    setReviewDiff,
    setSelectedReviewFilePath,
    setCommentLineId,
    setCommentBody,
    threadState,
    reviewScope,
    reviewBaseRef,
    reviewTurnId,
    reviewDiffVersion,
    reviewDiffCache,
    reviewDiffInFlight,
    setReviewComments,
    setToast,
    startReviewTransition,
    setReviewBaseRef,
    openReviewPanel,
    t,
    requestConfirmation,
    workspaceDockOpen,
    activeWorkspaceTab,
    activeProject,
    setReviewCounts,
    reviewDiff,
    reviewCounts,
    reviewBusy,
    setReviewBusy,
    commentBody,
  });

  const {
    openProject,
    removeProject,
    beginRenameThread,
    renameThread,
    copyTaskLink,
    deleteThread,
    updateProjectThreads,
    setThreadArchived,
    forkThread,
  } = useProjectThreadActions({
    setSnapshot,
    beginNewConversation,
    t,
    requestConfirmation,
    setProjectMenuId,
    activeProjectId,
    setActiveProjectId,
    setActiveThreadId,
    setActiveView,
    setMode,
    setToast,
    setThreadRename,
    setThreadMenuId,
    locale,
    deletingThreadIds,
    snapshot,
    loadedEventThreads,
    loadingEventThreads,
    threadStateCache,
    setComposerDrafts,
    setPromptSubmittedAtByThread,
    setWorkspaceTabsByThread,
    promptInput,
    activeThreadId,
  });

  const resolveApprovalRequest = useCallback(
    async (
      approval: ApprovalState,
      approved: boolean,
      scope: "once" | "session" | "project",
      extra?: Parameters<ResolveApprovalDecision>[3],
    ) => {
      try {
        await window.artemis.resolveApproval({
          approvalId: approval.approvalId,
          nonce: approval.nonce,
          approved,
          scope,
          ...extra,
        });
      } catch (error) {
        setToast(
          `${t.taskError} ${error instanceof Error ? error.message : String(error)}`,
        );
        throw error;
      }
    },
    [t.taskError],
  );

  const resolveUserInputRequest = useCallback(
    async (resolution: UserInputResolution) => {
      try {
        await window.artemis.resolveUserInput(resolution);
      } catch (error) {
        setToast(
          `${t.taskError} ${error instanceof Error ? error.message : String(error)}`,
        );
        throw error;
      }
    },
    [t.taskError],
  );

  const cancelActiveTurn = useCallback(async (): Promise<boolean> => {
    if (!activeThreadId) return false;
    try {
      await window.artemis.cancelTurn(activeThreadId);
      return true;
    } catch (error) {
      setToast(
        `${t.taskError} ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }, [activeThreadId, t.taskError]);

  const {
    addPromptAttachments,
    selectPromptAttachments,
    handleAttachmentDragEnter,
    handleAttachmentDragOver,
    handleAttachmentDragLeave,
    handleAttachmentDrop,
    handleAttachmentPaste,
  } = usePromptAttachments({
    setToast,
    activeComposerDraftKey,
    draftAttachments,
    setAttachments,
    t,
    pendingAttachmentReads,
    attachments,
    setAttachmentDragActive,
  });

  const {
    changeApprovalPolicy,
    updateThreadInSnapshot,
    selectComposerCommand,
    selectSkillCommand,
    removeSelectedSkill,
    selectMode,
    selectModeCommand,
    sendPrompt,
  } = useComposerSubmission({
    approvalChangeLocked,
    setApprovalMenuOpen,
    setApprovalPolicy,
    t,
    setToast,
    setSnapshot,
    promptHistoryNavigation,
    setPrompt,
    setSkillMenuDismissed,
    promptInput,
    setSelectedComposerSkillNames,
    activeComposerDraftKey,
    designPanelCredentials,
    setPromptHistory,
    setCustomAgentTasks,
    setPromptSubmittedAtByThread,
    activeThread,
    mode,
    setMode,
    turnActive,
    busy,
    pendingModelSelection,
    retiredGroup,
    pendingAttachmentReads,
    draftAttachments,
    designDocBindingRef,
    setAttachments,
    locale,
    customAgentTasks,
    prompt,
    selectedSkills,
    openGoalEditor,
    designAnnotationDrafts,
    setCompactingThreadIds,
    setBusy,
    closeGoalEditor,
    createThread,
    requestConfirmation,
    activeComposerDraft,
    setComposerDrafts,
  });

  // 设计面板批注自动发送：sendPrompt 的闭包读取 prompt state，必须等
  // setPrompt 真正落地再触发；期间文本被用户改动则放弃自动发送。
  const { sendReviewComment } = useComposerAutoSend({
    designPanelAutoSendText,
    activeComposerDraftKey,
    designPanelCredentials,
    prompt,
    busy,
    retiredGroup,
    sendPrompt,
    reviewCommentAutoSendText,
    attachments,
    selectedSkills,
    customAgentTasks,
    saveReviewComment,
    activeThreadIdRef,
    setPrompt,
  });

  const { updateActiveGoal } = useGoalControl({
    activeThread,
    goalMutationPending,
    setGoalMutationPending,
    updateThreadInSnapshot,
    closeGoalEditor,
    t,
    setToast,
    promptedGoalResumes,
    requestConfirmation,
  });

  const {
    steerQueuedMessage,
    deleteQueuedMessage,
    moveQueuedMessageToFront,
    saveQueuedMessage,
  } = useQueuedMessages({
    queuedFollowUps,
    activeThread,
    busy,
    setBusy,
    setEditingQueuedMessage,
    t,
    setToast,
    setQueuedSaveErrorDetail,
  });

  const { taskShortcut } = useApplicationShortcuts({
    beginNewConversation,
    changeSidebarOpen,
    sidebarSearchInput,
    toggleTerminalPanel,
    toggleReviewPanel,
    setApprovalMenuOpen,
    setModelPickerOpen,
    setThreadArchived,
    beginRenameThread,
  });

  if (!snapshot) {
    return (
      <main className="loading-shell">
        <ArtemisMark />
        <span>Artemis</span>
      </main>
    );
  }

  const hasConversationContent =
    (threadState?.order.length ?? 0) > 0 ||
    (activeHistory?.state.order.length ?? 0) > 0;
  const conversationEmpty =
    !activeThread ||
    (!activeThread.archived &&
      loadedEventThreads.current.has(activeThread.id) &&
      !hasConversationContent);
  const composerPlaceholder = visibleComposerPrediction
    ? ""
    : activeThread && imThreadStatus[activeThread.id]?.group
      ? uiText(locale, "App.inline12")
      : hasOfficeAnnotations
        ? officeAnnotationCopy(locale).placeholder
        : designDocBinding
          ? uiText(locale, "AppDesign.askArtemisToEditName", {
              name: designDocBinding.name,
            })
          : pendingComposerDecision
            ? uiText(locale, "Review01.waitingPrompt")
            : t.prompt;

  const navigationItems = [
    ["resources", uiText(locale, "App.inline5"), <ResourceIcon />],
    ["automations", t.automations, <AutomationIcon />],
    ["token-usage", uiText(locale, "App.inline6"), <TokenUsageIcon />],
    ["archive", uiText(locale, "App.archiveConversations"), <ArchiveIcon />],
  ] as const;
  const managementViewLabel =
    activeView === "token-usage"
      ? uiText(locale, "Review04.usage")
      : (navigationItems.find(([view]) => view === activeView)?.[1] ??
        activeWorkspaceLabel);

  return (
    <ApplicationShell
      layout="integrated"
      className="app-shell"
      style={
        {
          "--sidebar-expanded-width": `${projectSidebarWidth ?? defaultProjectSidebarWidth}px`,
        } as CSSProperties
      }
      data-sidebar-animating={sidebarAnimating || undefined}
      data-sidebar-resizing={projectSidebarResizing || undefined}
      data-sidebar-peek={(sidebarPeek && !sidebarOpen) || undefined}
      data-platform={snapshot.platform}
      data-window-material={windowMaterial}
      data-material={effectiveMaterial}
      data-renderer-ready="true"
      sidebarOpen={sidebarOpen}
      sidebarSize={projectSidebarWidth ?? defaultProjectSidebarWidth}
    >
      <SidebarGlassFilters />
      <AppNavigation
        {...{
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
        }}
      />

      <ApplicationShellResizer
        aria-valuemax={PROJECT_SIDEBAR_WIDTH_MAX}
        aria-valuemin={PROJECT_SIDEBAR_WIDTH_MIN}
        aria-valuenow={projectSidebarWidth ?? defaultProjectSidebarWidth}
        className="project-sidebar-resizer"
        label={t.resizeProjectsSidebar}
        onWheel={(event) => {
          if (event.ctrlKey || event.metaKey || event.shiftKey) return;
          const viewport = projectSidebar.current?.querySelector<HTMLElement>(
            '[data-part="main"] > [data-part="content"]',
          );
          if (!viewport) return;
          const unit =
            event.deltaMode === 1
              ? 16
              : event.deltaMode === 2
                ? viewport.clientHeight
                : 1;
          viewport.scrollBy({ top: event.deltaY * unit, behavior: "instant" });
        }}
        onKeyDown={resizeProjectSidebarFromKeyboard}
        onPointerCancel={cancelProjectSidebarResize}
        onPointerDown={beginProjectSidebarResize}
        onPointerMove={moveProjectSidebarResize}
        onPointerUp={finishProjectSidebarResize}
        open={sidebarOpen}
      />

      <section className="workspace">
        {activeView !== "workspace" && (
          <Toolbar
            actions={
              activeView === "automations" || activeView === "resources" ? (
                <div
                  className="management-header-action"
                  ref={setManagementActionTarget}
                />
              ) : null
            }
            className="workspace-header"
            label={managementViewLabel}
          >
            <div className="workspace-header-leading">
              <button
                aria-expanded={sidebarOpen}
                aria-label={t.leftSidebar}
                className="left-sidebar-toggle"
                onClick={() => changeSidebarOpen((open) => !open)}
                title={t.leftSidebar}
              >
                <LeftSidebarIcon />
              </button>
              <div className="workspace-heading">
                <strong dir="auto">{managementViewLabel}</strong>
              </div>
            </div>
          </Toolbar>
        )}
        {toast && activeView !== "workspace" && (
          <TransientNotice
            dismissLabel={t.dismissNotice}
            notice={toast}
            onDismiss={() => setToast(undefined)}
            placement="view"
          />
        )}
        {activeView === "token-usage" ? (
          <Suspense fallback={<div className="view-loading">…</div>}>
            <TokenUsagePage
              locale={locale}
              {...(runtimeSettings?.profileAvatar
                ? { profileAvatar: runtimeSettings.profileAvatar }
                : {})}
              username={username}
            />
          </Suspense>
        ) : activeView === "automations" ? (
          <Suspense fallback={<div className="view-loading">…</div>}>
            <AutomationPage
              initialAutomationId={welcomeAutomationId}
              initialDraftRequest={automationDraftRequest}
              headerActionTarget={managementActionTarget}
              locale={locale}
              settings={runtimeSettings}
              onConfirm={requestConfirmation}
              onOpenThread={(threadId) => void openAutomationThread(threadId)}
              projects={projects}
            />
          </Suspense>
        ) : activeView === "archive" ? (
          <ArchivePage
            groupThreadIds={
              new Set(
                Object.entries(imThreadStatus)
                  .filter(([, status]) => status.group)
                  .map(([id]) => id),
              )
            }
            locale={locale}
            onOpen={(thread) => {
              discardNewConversationDraft();
              setActiveProjectId(thread.projectId);
              setActiveThreadId(thread.id);
              setMode(thread.mode);
              setActiveView("workspace");
            }}
            onBatch={async (threads, operation) => {
              if (
                operation === "delete" &&
                !(await requestConfirmation(
                  uiText(locale, "Review06.bulkDeleteConfirm", {
                    count: threads.length,
                  }),
                  "danger",
                ))
              )
                return undefined;
              const succeeded: string[] = [];
              for (const thread of threads) {
                const ok =
                  operation === "delete"
                    ? await deleteThread(thread, true)
                    : await setThreadArchived(thread, false, true);
                if (ok) succeeded.push(thread.id);
              }
              return succeeded;
            }}
            onDelete={(thread) => void deleteThread(thread)}
            onRestore={(thread) => void setThreadArchived(thread, false)}
            projects={projects}
            threads={snapshot.threads}
          />
        ) : activeView === "resources" ? (
          <Suspense fallback={<div className="view-loading">…</div>}>
            <ResourceCenter
              headerActionTarget={managementActionTarget}
              locale={locale}
              onReviewHooks={(pluginId, trigger) => {
                setHooksQuery({
                  pluginId,
                  ...(activeProjectId ? { projectId: activeProjectId } : {}),
                });
                openSettings("hooks", trigger);
              }}
              onConfirm={requestConfirmation}
              onSettingsChange={(value) => {
                setRuntimeSettings(value);
                setApprovalPolicy(value.approvalPolicy);
                setSnapshot((current) =>
                  current
                    ? {
                        ...current,
                        locale: value.resolvedLocale,
                      }
                    : current,
                );
              }}
              {...(runtimeSettings ? { settings: runtimeSettings } : {})}
            />
          </Suspense>
        ) : (
          <>
            <div
              className="workspace-content"
              data-resizing={workspaceDockResizing || undefined}
              ref={workspaceContent}
            >
              <ConversationSurface
                className="conversation"
                data-pending-decision={Boolean(pendingComposerDecision)}
                id="conversation"
                label={t.conversation}
                state={conversationEmpty ? "empty" : "ready"}
              >
                <Toolbar
                  actions={
                    <div className="header-actions">
                      <span
                        className={`status-pill ${statusDotStatus}`}
                        onAnimationStart={synchronizeTurnIndicator}
                      >
                        {statusDotStatus === "running" ? (
                          <RunningArc />
                        ) : statusDotStatus === "completed" ||
                          statusDotStatus === "failed" ? (
                          <ArtemisIcon
                            name={
                              statusDotStatus === "completed"
                                ? "check"
                                : "alert"
                            }
                            width={14}
                            height={14}
                          />
                        ) : (
                          <span className={`status-dot ${statusDotStatus}`} />
                        )}
                        <span className="status-pill-label">
                          {permissionBlock && !turnActive
                            ? uiText(locale, "ImPermission.waiting")
                            : delegationWaiting
                              ? uiText(locale, "ImDelegation.waitingShort")
                              : pendingComposerDecision
                                ? uiText(locale, "Review02.waitingDecision")
                                : statusDotStatus === "completed"
                                  ? t.completed
                                  : statusLabel(threadState, locale, clockMs)}
                        </span>
                        {!remoteWaiting && statusDotStatus === "running" && (
                          <time
                            dateTime={`PT${Math.floor(runPresentation.elapsedMs / 1_000)}S`}
                          >
                            {formatRunDuration(
                              runPresentation.elapsedMs,
                              locale,
                            )}
                          </time>
                        )}
                      </span>
                      {activeProject && activeThread && (
                        <button
                          className="header-share"
                          type="button"
                          aria-label={uiText(locale, "Share.title")}
                          title={uiText(locale, "Share.title")}
                          onClick={() => setSharingThreadId(activeThread.id)}
                        >
                          <ArtemisIcon name="share" width={16} height={16} />
                        </button>
                      )}
                      {activeProject && (
                        <EnvironmentPanel
                          worktreeCount={
                            snapshot.worktrees.filter(
                              (tree) =>
                                tree.target === "managed-worktree" &&
                                tree.status === "active",
                            ).length
                          }
                          key={environmentWorkspaceKey}
                          commitRequest={environmentCommitRequest}
                          actionsDisabled={
                            projectBranchActionsDisabled ||
                            Boolean(activeThread?.archived)
                          }
                          onOpenUsage={() => setActiveView("token-usage")}
                          workspaceIsWorktree={Boolean(
                            activeThread && activeThread.target !== "local",
                          )}
                          onWorktreesChanged={refreshWorkspaceSnapshot}
                          onWorkspaceHandoff={handoffActiveWorkspace}
                          agents={environmentAgents}
                          onMentionMember={groupMentions.insert}
                          memberRemovalDisabled={turnActive || busy}
                          executing={
                            threadState?.status === "running" &&
                            !pendingComposerDecision
                          }
                          onRemoveMember={async (deviceId) => {
                            if (!activeThread) return false;
                            try {
                              await window.artemis.manageIm({
                                action: "remove-conversation-member",
                                threadId: activeThread.id,
                                deviceId,
                              });
                              setToast(uiText(locale, "App.inline10"));
                              return true;
                            } catch (error) {
                              setToast({
                                error: true,
                                message:
                                  error instanceof Error
                                    ? error.message
                                    : String(error),
                              });
                              return false;
                            }
                          }}
                          imConnection={
                            activeThread
                              ? imThreadStatus[activeThread.id]
                              : undefined
                          }
                          onManageGroupAuthorization={(trigger) =>
                            openSettings("im", trigger)
                          }
                          imGroup={
                            activeThread
                              ? imThreadStatus[activeThread.id]?.group
                              : undefined
                          }
                          attachments={attachments}
                          contextSkills={installedSkills
                            .filter(
                              (skill) =>
                                selectedSkills.some(
                                  (selected) => selected.id === skill.id,
                                ) ||
                                Object.values(
                                  threadState?.userMessages ?? {},
                                ).some((message) =>
                                  selectedSkillNamesForPrompt(
                                    message.text,
                                  ).includes(skill.name),
                                ),
                            )
                            .map((skill) => ({
                              ...skill,
                              plugin: installedPluginBySkillName.get(
                                skill.name,
                              ),
                            }))}
                          defaultOpen={Boolean(threadState?.turnOrder.length)}
                          dockOpen={workspaceDockOpen}
                          locale={locale}
                          mcpUsages={environmentMcpUsages}
                          onAddProject={() => void openProject()}
                          onAddSources={() => void selectPromptAttachments()}
                          onConfirm={requestConfirmation}
                          onMessage={(message, error) =>
                            setToast(error ? { error: true, message } : message)
                          }
                          onOpenAgent={openChildAgentPanel}
                          onOpenReview={openReviewScopePanel}
                          onOpenTeam={openAgentTeamPanel}
                          onOpenUrl={openConversationExternalLink}
                          onViewAllSources={openSourcesPanel}
                          project={activeProject}
                          {...(environmentRefreshKey
                            ? { refreshKey: environmentRefreshKey }
                            : {})}
                          sources={environmentSources}
                          taskTitle={activeThread?.title ?? activeProject.name}
                          teams={environmentTeams}
                          {...(activeThreadId
                            ? { threadId: activeThreadId }
                            : {})}
                        />
                      )}
                      {!activeThread?.archived && !workspaceDockOpen && (
                        <button
                          aria-expanded={workspaceDockOpen}
                          aria-label={t.rightSidebar}
                          className="right-sidebar-toggle"
                          onClick={toggleRightSidebar}
                          ref={workspaceDockToggleElement}
                          title={t.rightSidebar}
                        >
                          <RightSidebarIcon />
                        </button>
                      )}
                    </div>
                  }
                  className="workspace-header"
                  label={activeWorkspaceLabel}
                >
                  <div className="workspace-header-leading">
                    <button
                      aria-expanded={sidebarOpen}
                      aria-label={t.leftSidebar}
                      className="left-sidebar-toggle"
                      onClick={() => changeSidebarOpen((open) => !open)}
                      title={t.leftSidebar}
                    >
                      <LeftSidebarIcon />
                    </button>
                    <div className="workspace-heading">
                      <strong dir="auto">{activeWorkspaceLabel}</strong>
                      {activeThread && (
                        <>
                          <span className="header-separator">/</span>
                          <span className="workspace-thread-title">
                            {activeThread.title}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </Toolbar>

                <div className="conversation-body">
                  <div
                    className="update-notice-slot"
                    ref={setUpdateNoticeTarget}
                  />

                  <TimelineViewport
                    className="timeline-scroll"
                    label={t.conversationHistory}
                    onPointerDown={(event) => {
                      const container = event.currentTarget;
                      const bounds = container.getBoundingClientRect();
                      const scrollbarEdge = Math.max(
                        container.offsetWidth - container.clientWidth,
                        12,
                      );
                      const direction =
                        window.getComputedStyle(container).direction;
                      const overScrollbar =
                        direction === "rtl"
                          ? event.clientX <= bounds.left + scrollbarEdge
                          : event.clientX >= bounds.right - scrollbarEdge;
                      timelineScrollbarPointerActive.current = overScrollbar;
                    }}
                    onScroll={(event) => {
                      const container = event.currentTarget;
                      if (
                        container.scrollTop < 240 &&
                        (timelineScrollIntent.current ||
                          timelineScrollbarPointerActive.current)
                      )
                        loadEarlierHistory();
                      timelinePinned.current = resolveTimelinePinned({
                        clientHeight: container.clientHeight,
                        pinned: timelinePinned.current,
                        scrollHeight: container.scrollHeight,
                        scrollTop: container.scrollTop,
                        userInitiated:
                          timelineScrollIntent.current ||
                          timelineScrollbarPointerActive.current,
                      });
                      const threadId = activeThreadIdRef.current;
                      if (
                        threadId &&
                        pendingTimelineRestore.current?.threadId !== threadId
                      ) {
                        timelineScrollSnapshots.current.set(threadId, {
                          pinned: timelinePinned.current,
                          scrollTop: container.scrollTop,
                        });
                      }
                      timelineScrollIntent.current = false;
                    }}
                    onWheel={() => {
                      timelineScrollIntent.current = true;
                      window.requestAnimationFrame(() => {
                        timelineScrollIntent.current = false;
                      });
                    }}
                    ref={timelineScroll}
                  >
                    {activeHistoryPending ? (
                      activeHistoryError !== undefined ? (
                        <ErrorState
                          className="conversation-history-feedback"
                          action={
                            <Button
                              onClick={() => {
                                if (!activeThreadId) return;
                                setHistoryLoadErrors((current) => {
                                  const next = { ...current };
                                  delete next[activeThreadId];
                                  return next;
                                });
                                setHistoryRetry((current) => current + 1);
                              }}
                            >
                              {uiText(locale, "App_copy.historyRetry")}
                            </Button>
                          }
                        >
                          {uiText(locale, "App_copy.historyLoadFailed")}
                        </ErrorState>
                      ) : (
                        <LoadingState
                          className="conversation-history-feedback"
                          label={uiText(locale, "App_copy.loadingHistory")}
                          lines={3}
                        />
                      )
                    ) : conversationEmpty ? (
                      <ConversationEmptyState
                        className="conversation-empty-state"
                        icon={<ArtemisMark />}
                        label={`${emptyConversationGreeting.title}. ${emptyConversationLabel}`}
                        title={<h1>{emptyConversationGreeting.title}</h1>}
                        detail={
                          <p className="conversation-greeting-detail">
                            {activeProject ? (
                              <>
                                {emptyConversationPrefix}
                                <bdi className="conversation-project-name">
                                  {activeProject.name}
                                </bdi>
                                {emptyConversationSuffix}
                              </>
                            ) : (
                              emptyConversationGreeting.temporaryPrompt
                            )}
                          </p>
                        }
                      />
                    ) : (
                      <Fragment>
                        {activeHistory?.cursor ? (
                          <button type="button" onClick={loadEarlierHistory}>
                            {uiText(locale, "App_copy.loadEarlierMessages")}
                          </button>
                        ) : null}
                        <Timeline
                          events={activeEvents}
                          imChannel={
                            activeThread
                              ? imThreadStatus[activeThread.id]?.channel
                              : undefined
                          }
                          imGroup={
                            activeThread
                              ? imThreadStatus[activeThread.id]?.group
                              : undefined
                          }
                          installedPlugins={installedPlugins}
                          installedSkills={installedSkills}
                          mcpServers={runtimeSettings?.mcpServers}
                          locale={locale}
                          onExternalLink={openConversationExternalLink}
                          onFileLink={openConversationFileLink}
                          onFileLinkContextMenu={openConversationFileLinkMenu}
                          onOpenChildAgent={openChildAgentPanel}
                          onOpenTurnReview={openReviewTurnPanel}
                          onCopyText={copyConversationText}
                          onFork={
                            activeThread &&
                            !turnActive &&
                            !activeThread.archived
                              ? () => void forkThread(activeThread)
                              : undefined
                          }
                          onShare={
                            activeProject && activeThread
                              ? () => setSharingThreadId(activeThread.id)
                              : undefined
                          }
                          onEditUserMessage={
                            activeThread?.archived
                              ? undefined
                              : editConversationMessage
                          }
                          onResolve={resolveApprovalRequest}
                          onResolveUserInput={resolveUserInputRequest}
                          onUndoTurnChanges={(turnId) =>
                            void undoTurnChanges(turnId)
                          }
                          state={threadState!}
                        />
                      </Fragment>
                    )}
                    {activeThread &&
                      runPresentation.status === "running" &&
                      !remoteWaiting &&
                      !threadState?.turnOrder.some(
                        (id) => threadState.turns[id]?.status === "running",
                      ) &&
                      !latestTimelineEntryIsCompaction && (
                        <div className="turn-status running" role="status">
                          <RunningArc size={16} />
                          <span>
                            {statusLabel(threadState, locale, clockMs)}
                          </span>
                          <time>
                            {formatRunDuration(
                              runPresentation.elapsedMs,
                              locale,
                            )}
                          </time>
                        </div>
                      )}
                    {turnFailureBanner}
                    <div
                      className="timeline-decision"
                      ref={setDecisionTarget}
                    />
                  </TimelineViewport>

                  {(activeThread?.archived || retiredGroup) && (
                    <div className="composer-wrap">
                      {toast && (
                        <TransientNotice
                          dismissLabel={t.dismissNotice}
                          notice={toast}
                          onDismiss={() => setToast(undefined)}
                          placement="composer"
                        />
                      )}
                      {activeThread?.archived && (
                        <div className="archived-readonly" role="status">
                          <ArchiveIcon />
                          <span>
                            <strong>{t.archivedReadOnly}</strong>
                            <small>{t.archivedReadOnlyDetail}</small>
                          </span>
                          <button
                            onClick={() =>
                              void setThreadArchived(activeThread, false)
                            }
                          >
                            {t.restoreTask}
                          </button>
                        </div>
                      )}

                      {retiredGroup && (
                        <div className="im-retired-notice" role="status">
                          <ArtemisIcon name="agents" width={18} height={18} />
                          <span>
                            {uiText(
                              locale,
                              retiredGroup === "dissolved"
                                ? "ImThreadConnection.dissolvedDetail"
                                : "ImThreadConnection.archivedDetail",
                            )}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                  {!activeThread?.archived && !retiredGroup && (
                    <div className="composer-wrap" ref={composerBoundary}>
                      <Suspense fallback={null}>
                        <ComputerUseControls
                          locale={locale}
                          nativeGlass={windowMaterial === "acrylic"}
                        />
                        <ComputerPreview
                          locale={locale}
                          threadId={activeThreadId}
                          dockOpen={workspaceDockOpen}
                        />
                      </Suspense>
                      <Suspense fallback={null}>
                        <HookTaskNotice
                          locale={locale}
                          {...(activeThreadId
                            ? { threadId: activeThreadId }
                            : {})}
                          {...(activeProjectId
                            ? { projectId: activeProjectId }
                            : {})}
                          mode={mode}
                          onReview={(trigger) => {
                            setHooksQuery({
                              ...(activeThreadId
                                ? { threadId: activeThreadId }
                                : {}),
                              ...(activeProjectId
                                ? { projectId: activeProjectId }
                                : {}),
                            });
                            openSettings("hooks", trigger);
                          }}
                        />
                      </Suspense>
                      {permissionBlock && (
                        <div className="sandbox-notice" role="status">
                          <span>{permissionBlock}</span>
                          <button
                            type="button"
                            onClick={(event) =>
                              openSettings("general", event.currentTarget)
                            }
                          >
                            {uiText(locale, "ImPermission.settings")}
                          </button>
                        </div>
                      )}
                      {activeThread && (
                        <ImDelegationWaitStatus
                          key={activeThread.id}
                          waits={
                            imThreadStatus[activeThread.id]?.delegationWaits ??
                            []
                          }
                          locale={locale}
                        />
                      )}
                      <div className="composer-status-row">
                        {activeThread?.goal && (
                          <GoalBar
                            clockMs={clockMs}
                            disabled={goalMutationPending}
                            goal={activeThread.goal}
                            locale={locale}
                            onClear={() => void updateActiveGoal("clear")}
                            onEdit={openGoalEditor}
                            onPause={() => void updateActiveGoal("pause")}
                            onResume={() => void updateActiveGoal("resume")}
                          />
                        )}
                        {taskPlan && (
                          <TaskPlanProgress locale={locale} plan={taskPlan} />
                        )}
                        {queuedFollowUps.length > 0 && (
                          <details className="composer-queue">
                            <summary>
                              {t.queuedMessages.replace(
                                "{{count}}",
                                String(queuedFollowUps.length),
                              )}
                            </summary>
                            <QueuedMessageGroup
                              className="queued-message-bar"
                              heading={
                                <>
                                  <QueueIcon />
                                  <strong>
                                    {t.queuedMessages.replace(
                                      "{{count}}",
                                      String(queuedFollowUps.length),
                                    )}
                                  </strong>
                                </>
                              }
                              label={t.queuedMessages.replace(
                                "{{count}}",
                                String(queuedFollowUps.length),
                              )}
                              state={busy ? "busy" : "queued"}
                            >
                              {queuedFollowUps.map((message, index) => {
                                const editing =
                                  editingQueuedMessage?.index === index;
                                const itemLabel = t.queueItem.replace(
                                  "{{number}}",
                                  String(index + 1),
                                );
                                return (
                                  <QueuedMessageItem
                                    actions={
                                      editing ? undefined : (
                                        <>
                                          <button
                                            aria-label={`${t.queueSteer}: ${itemLabel}`}
                                            className="queued-message-steer"
                                            disabled={busy || contextCompacting}
                                            onClick={() =>
                                              void steerQueuedMessage(index)
                                            }
                                            title={t.queueSteerHint}
                                            type="button"
                                          >
                                            <span>{t.queueSteer}</span>
                                          </button>
                                          {index > 0 && (
                                            <button
                                              aria-label={`${t.queueMoveToFront}: ${itemLabel}`}
                                              className="queued-message-prioritize"
                                              disabled={busy}
                                              onClick={() =>
                                                void moveQueuedMessageToFront(
                                                  index,
                                                )
                                              }
                                              title={t.queueMoveToFrontHint}
                                              type="button"
                                            >
                                              <MoveToFrontIcon />
                                            </button>
                                          )}
                                          <button
                                            aria-label={`${t.queueEdit}: ${itemLabel}`}
                                            className="queued-message-edit"
                                            disabled={busy}
                                            onClick={() =>
                                              setEditingQueuedMessage({
                                                index,
                                                value: message,
                                              })
                                            }
                                            title={t.queueEdit}
                                            type="button"
                                          >
                                            <EditIcon />
                                          </button>
                                          <button
                                            aria-label={`${t.queueDelete}: ${itemLabel}`}
                                            className="queued-message-delete"
                                            disabled={busy}
                                            onClick={() =>
                                              void deleteQueuedMessage(index)
                                            }
                                            title={t.queueDelete}
                                            type="button"
                                          >
                                            <TrashIcon />
                                          </button>
                                        </>
                                      )
                                    }
                                    className="queued-message-item"
                                    data-queued-index={index}
                                    index={
                                      <ArtemisIcon
                                        name="clock"
                                        width={14}
                                        height={14}
                                      />
                                    }
                                    key={String(index)}
                                    state={busy ? "busy" : "queued"}
                                  >
                                    {editing ? (
                                      <QueuedMessageEditor
                                        busy={busy}
                                        cancelLabel={t.queueCancel}
                                        errorDetail={queuedSaveErrorDetail}
                                        errorLabel={t.queueSaveError}
                                        retryLabel={t.queueRetry}
                                        saveLabel={t.queueSave}
                                        textareaLabel={t.queueEdit}
                                        value={editingQueuedMessage.value}
                                        focusReturnTarget={() =>
                                          document.querySelector<HTMLElement>(
                                            `[data-queued-index="${index}"] .queued-message-steer`,
                                          )
                                        }
                                        onCancel={() =>
                                          setEditingQueuedMessage(undefined)
                                        }
                                        onSave={async () =>
                                          (await saveQueuedMessage(
                                            index,
                                            editingQueuedMessage.value,
                                          )) === true
                                        }
                                        onSuccess={() =>
                                          setEditingQueuedMessage(undefined)
                                        }
                                        onValueChange={(value) =>
                                          setEditingQueuedMessage({
                                            index,
                                            value,
                                          })
                                        }
                                      />
                                    ) : (
                                      <div className="queued-message-content">
                                        <small>
                                          {uiText(
                                            locale,
                                            "Review06.queuedAfterTurn",
                                          )}
                                        </small>
                                        <span title={message}>{message}</span>
                                      </div>
                                    )}
                                  </QueuedMessageItem>
                                );
                              })}
                            </QueuedMessageGroup>
                          </details>
                        )}
                      </div>
                      {toast && (
                        <TransientNotice
                          dismissLabel={t.dismissNotice}
                          notice={toast}
                          onDismiss={() => setToast(undefined)}
                          placement="composer"
                        />
                      )}
                      <>
                        {!snapshot.sandbox.available && (
                          <div className="sandbox-notice">
                            <ArtemisIcon
                              className="icon"
                              height={16}
                              name="warning"
                              width={16}
                            />
                            <span>
                              <strong>{t.sandboxUnavailable}</strong>
                              <small>{t.sandboxDetail}</small>
                            </span>
                          </div>
                        )}

                        <DecisionComposer
                          decision={pendingComposerDecision}
                          decisionTarget={decisionTarget}
                          locale={locale}
                          onResolveApproval={resolveApprovalRequest}
                          onResolveUserInput={resolveUserInputRequest}
                          onAcceptPlan={
                            activeThread?.archived
                              ? undefined
                              : async (plan, executionMode) => {
                                  const result =
                                    await window.artemis.acceptPlan({
                                      threadId: threadState!.threadId,
                                      planId: plan.planId,
                                      revision: plan.revision,
                                      mode: executionMode,
                                    });
                                  setMode(executionMode);
                                  updateThreadInSnapshot(result.thread);
                                }
                          }
                          onRevisePlan={
                            activeThread?.archived
                              ? undefined
                              : async (text) => {
                                  const result =
                                    await window.artemis.revisePlan({
                                      threadId: threadState!.threadId,
                                      text,
                                    });
                                  setMode("plan");
                                  updateThreadInSnapshot(result.thread);
                                }
                          }
                          context={
                            <div
                              className={
                                hasConversationContent
                                  ? undefined
                                  : "composer-context-row"
                              }
                              hidden={hasConversationContent}
                            >
                              <ComposerContextBar
                                renderControls={!hasConversationContent}
                                onGitInfo={receiveWelcomeGit}
                                key={environmentWorkspaceKey}
                                threadId={activeThread?.id}
                                {...(activeProject ? { activeProject } : {})}
                                projectActionsDisabled={
                                  busy ||
                                  turnActive ||
                                  Boolean(
                                    activeThread &&
                                    (!loadedEventThreads.current.has(
                                      activeThread.id,
                                    ) ||
                                      (threadState?.order.length ?? 0) > 0),
                                  )
                                }
                                branchActionsDisabled={
                                  projectBranchActionsDisabled
                                }
                                locale={locale}
                                mode={mode}
                                showMode={false}
                                workspaceControl={
                                  activeProject ? (
                                    <EnvironmentWorkspaceMenu
                                      worktreeCount={
                                        snapshot.worktrees.filter(
                                          (tree) =>
                                            tree.target ===
                                              "managed-worktree" &&
                                            tree.status === "active",
                                        ).length
                                      }
                                      locale={locale}
                                      path={
                                        environmentWorktree?.path ??
                                        activeProject.path
                                      }
                                      worktree={Boolean(
                                        activeThread &&
                                        activeThread.target !== "local",
                                      )}
                                      disabled={
                                        projectBranchActionsDisabled ||
                                        Boolean(activeThread?.archived)
                                      }
                                      placement="block-start"
                                      onHandoff={handoffActiveWorkspace}
                                      onWorktreesChanged={
                                        refreshWorkspaceSnapshot
                                      }
                                      onOpenUsage={() =>
                                        setActiveView("token-usage")
                                      }
                                      onMessage={(message, error) =>
                                        setToast(
                                          error
                                            ? { error: true, message }
                                            : message,
                                        )
                                      }
                                    />
                                  ) : undefined
                                }
                                modeActionsDisabled={
                                  turnActive ||
                                  busy ||
                                  pendingComposerDecision?.kind === "plan"
                                }
                                onClearProject={() => {
                                  discardNewConversationDraft();
                                  beginTemporaryConversation();
                                }}
                                onError={(message) =>
                                  setToast({ error: true, message })
                                }
                                onModeChange={(nextMode) =>
                                  void selectMode(nextMode)
                                }
                                onOpenProject={openProject}
                                onSelectProject={(project) => {
                                  discardNewConversationDraft();
                                  beginNewConversation(project.id);
                                }}
                                projects={projects}
                              />
                              <small className="composer-send-hint">
                                <Keycap>↵</Keycap> {t.send}　<Keycap>⇧↵</Keycap>{" "}
                                {uiText(locale, "Review01.newline")}
                              </small>
                            </div>
                          }
                          className="composer"
                          label={t.prompt}
                          onDragEnter={handleAttachmentDragEnter}
                          onDragLeave={handleAttachmentDragLeave}
                          onDragOver={handleAttachmentDragOver}
                          onDrop={handleAttachmentDrop}
                        >
                          {attachmentDragActive && (
                            <div className="composer-drop-overlay">
                              <PlusIcon />
                              <strong>{t.dropAttachments}</strong>
                              <small>{t.dropAttachmentsDetail}</small>
                            </div>
                          )}
                          {skillCommandMenuOpen && (
                            <div
                              aria-label={t.installedSkills}
                              className="slash-command-menu"
                              id="skill-command-menu"
                              ref={slashCommandMenu}
                              role="listbox"
                            >
                              {skillsLoading ? (
                                <div className="slash-command-status">
                                  {t.loadingSkills}
                                </div>
                              ) : skillsError ? (
                                <div className="slash-command-status error">
                                  {skillsError}
                                </div>
                              ) : skillSuggestions.length > 0 ? (
                                <>
                                  {skillSuggestions.length > 0 && (
                                    <div className="slash-command-heading">
                                      {t.installedSkills}
                                    </div>
                                  )}
                                  {skillSuggestions.map(({ index, skill }) => (
                                    <button
                                      aria-selected={
                                        index === activeSlashSuggestion
                                      }
                                      className={`slash-command-suggestion${index === activeSlashSuggestion ? " active" : ""}`}
                                      id={`skill-command-option-${index}`}
                                      key={skill.id}
                                      onClick={() => selectSkillCommand(skill)}
                                      role="option"
                                      tabIndex={-1}
                                    >
                                      <ArtemisIcon
                                        name="skill"
                                        width={14}
                                        height={14}
                                      />
                                      <span>
                                        <strong>{skill.name}</strong>
                                        <small>{skill.description}</small>
                                      </span>
                                    </button>
                                  ))}
                                </>
                              ) : (
                                <div className="slash-command-status">
                                  {installedSkills.some(
                                    (skill) => skill.enabled,
                                  )
                                    ? t.noMatchingSkills
                                    : t.noInstalledSkills}
                                </div>
                              )}
                              <div className="slash-command-heading">
                                {uiText(locale, "Review06.commands")}
                              </div>
                              {goalSuggestionIndex >= 0 && (
                                <button
                                  aria-selected={
                                    goalSuggestionIndex ===
                                    activeSlashSuggestion
                                  }
                                  className={`slash-command-suggestion${goalSuggestionIndex === activeSlashSuggestion ? " active" : ""}`}
                                  id={`skill-command-option-${goalSuggestionIndex}`}
                                  onClick={() =>
                                    selectComposerCommand("/goal ")
                                  }
                                  role="option"
                                  tabIndex={-1}
                                >
                                  <CommandArtwork command="goal" />
                                  <span>
                                    <strong>{t.goalCommand}</strong>
                                    <small>{t.goalCommandDetail}</small>
                                  </span>
                                </button>
                              )}
                              {compactSuggestionIndex >= 0 && (
                                <button
                                  aria-selected={
                                    compactSuggestionIndex ===
                                    activeSlashSuggestion
                                  }
                                  className={`slash-command-suggestion${compactSuggestionIndex === activeSlashSuggestion ? " active" : ""}`}
                                  id={`skill-command-option-${compactSuggestionIndex}`}
                                  onClick={() =>
                                    selectComposerCommand("/compact")
                                  }
                                  role="option"
                                  tabIndex={-1}
                                >
                                  <CommandArtwork command="compact" />
                                  <span>
                                    <strong>{t.compactCommand}</strong>
                                    <small>{t.compactCommandDetail}</small>
                                  </span>
                                </button>
                              )}
                              {initSuggestionIndex >= 0 && (
                                <button
                                  aria-selected={
                                    initSuggestionIndex ===
                                    activeSlashSuggestion
                                  }
                                  className={`slash-command-suggestion${initSuggestionIndex === activeSlashSuggestion ? " active" : ""}`}
                                  id={`skill-command-option-${initSuggestionIndex}`}
                                  onClick={() => selectComposerCommand("/init")}
                                  role="option"
                                  tabIndex={-1}
                                >
                                  <CommandArtwork command="init" />
                                  <span>
                                    <strong>{t.initCommand}</strong>
                                    <small>{t.initCommandDetail}</small>
                                  </span>
                                </button>
                              )}
                              {modeSuggestions.map(({ index, mode }) => {
                                const commandLabel = `/${mode}`;
                                const commandDetail =
                                  mode === "plan"
                                    ? t.planCommandDetail
                                    : mode === "work"
                                      ? uiText(locale, "Plan.workDetail")
                                      : uiText(locale, "Plan.codemodeDetail");
                                return (
                                  <button
                                    aria-selected={
                                      index === activeSlashSuggestion
                                    }
                                    className={`slash-command-suggestion${index === activeSlashSuggestion ? " active" : ""}`}
                                    id={`skill-command-option-${index}`}
                                    key={mode}
                                    onClick={() => void selectModeCommand(mode)}
                                    role="option"
                                    tabIndex={-1}
                                  >
                                    <CommandArtwork command={mode} />
                                    <span>
                                      <strong>{commandLabel}</strong>
                                      <small>{commandDetail}</small>
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                          {(skillCommandMenuOpen ||
                            customAgentMention.open) && (
                            <small className="composer-suggestion-hint">
                              {uiText(locale, "Review06.slashHint")}
                            </small>
                          )}
                          {designDocBinding && (
                            <div
                              className="composer-active-file"
                              title={designDocBinding.name}
                            >
                              <span className="composer-active-file-label">
                                {uiText(locale, "AppDesign.editing")}
                              </span>
                              <span className="composer-active-file-name">
                                {designDocBinding.name}
                              </span>
                            </div>
                          )}
                          {((!skillCommandMenuOpen &&
                            selectedSkills.length > 0) ||
                            hasRegularAttachments) && (
                            <div className="composer-resource-strip">
                              {!skillCommandMenuOpen &&
                                selectedSkills.map((skill) => (
                                  <ComposerSkillChip
                                    key={skill.id}
                                    skill={skill}
                                    plugin={installedPluginBySkillName.get(
                                      skill.name,
                                    )}
                                    removeLabel={t.removeSelectedSkill}
                                    onRemove={() =>
                                      removeSelectedSkill(skill.name)
                                    }
                                  />
                                ))}
                              <AttachmentImportProgress
                                locale={locale}
                                onImported={addPromptAttachments}
                              />
                              {hasRegularAttachments && (
                                <ComposerAttachments
                                  key={activeComposerDraftKey}
                                  attachments={attachments}
                                  threadId={activeThreadId}
                                  locale={locale}
                                  onRemove={(index) => {
                                    const attachment = attachments[index];
                                    if (
                                      attachment &&
                                      isAttachmentReference(attachment)
                                    )
                                      void window.artemis.cancelPromptAttachment(
                                        attachment.id,
                                      );
                                    setAttachments((current) =>
                                      current.filter(
                                        (_item, itemIndex) =>
                                          itemIndex !== index,
                                      ),
                                    );
                                  }}
                                />
                              )}
                            </div>
                          )}
                          {hasOfficeAnnotations && (
                            <OfficeAnnotationCards
                              key={activeComposerDraftKey}
                              attachments={attachments}
                              locale={locale}
                              disabled={busy}
                              onChange={(index, id, text) => {
                                const next = changeOfficeAnnotation(
                                  draftAttachments.current.get(
                                    activeComposerDraftKey,
                                  ) ?? [],
                                  index,
                                  id,
                                  text,
                                );
                                if (!next) {
                                  setToast(t.attachmentLimit);
                                  return false;
                                }
                                setAttachments(next);
                                return true;
                              }}
                              onLocate={({ path, annotation }) => {
                                if (!activeThreadId) return;
                                setOfficeAnnotationFocus({
                                  threadId: activeThreadId,
                                  path,
                                  annotation: { ...annotation },
                                });
                                openWorkspaceTab("office", { path });
                              }}
                            />
                          )}
                          {customAgentTasks.length > 0 && (
                            <CustomAgentTaskBlocks
                              tasks={customAgentTasks}
                              focusTaskId={focusAgentTaskId}
                              locale={locale}
                              onChange={(id, text) =>
                                setCustomAgentTasks(
                                  customAgentTasks.map((task) =>
                                    task.id === id ? { ...task, text } : task,
                                  ),
                                )
                              }
                              onRemove={(id) => {
                                setCustomAgentTasks(
                                  customAgentTasks.filter(
                                    (task) => task.id !== id,
                                  ),
                                );
                                promptInput.current?.focus();
                              }}
                            />
                          )}
                          <CustomAgentMentionMenu
                            mention={customAgentMention}
                            locale={locale}
                          />
                          <div className="composer-input">
                            {visibleComposerPrediction && (
                              <div
                                className="composer-prediction"
                                role="status"
                              >
                                <span>{visibleComposerPrediction}</span>
                                <small>
                                  {uiText(locale, "ComposerPrediction.accept")}
                                </small>
                              </div>
                            )}
                            {customAgentTasks.length > 0 && (
                              <div className="composer-agent-main-label">
                                {uiText(locale, "App.inline11")}
                              </div>
                            )}
                            <textarea
                              aria-activedescendant={
                                customAgentMention.open
                                  ? `custom-agent-mention-${customAgentMention.activeIndex}`
                                  : skillCommandMenuOpen &&
                                      slashCommandSuggestions.length > 0
                                    ? `skill-command-option-${activeSlashSuggestion}`
                                    : undefined
                              }
                              aria-autocomplete="list"
                              aria-controls={
                                customAgentMention.open
                                  ? "custom-agent-mention-menu"
                                  : skillCommandMenuOpen
                                    ? "skill-command-menu"
                                    : undefined
                              }
                              aria-expanded={
                                customAgentMention.open || skillCommandMenuOpen
                              }
                              aria-label={t.prompt}
                              disabled={Boolean(pendingComposerDecision)}
                              onChange={(event) => {
                                const value = event.target.value;
                                composerPrediction.changed(value);
                                groupMentions.changed(
                                  event.target.selectionStart,
                                );
                                customAgentMention.changed(
                                  event.target.selectionStart,
                                );
                                setPrompt(value);
                                setSkillMenuDismissed(false);
                                promptHistoryNavigation.current = {
                                  index: -1,
                                  draft: value,
                                };
                              }}
                              onSelect={(event) => {
                                groupMentions.selected(
                                  event.currentTarget.selectionStart,
                                );
                                customAgentMention.selected(
                                  event.currentTarget.selectionStart,
                                );
                              }}
                              onKeyDown={(event) => {
                                if (customAgentMention.keyDown(event)) return;
                                if (
                                  event.key === "Tab" &&
                                  event.shiftKey &&
                                  !event.nativeEvent.isComposing &&
                                  !turnActive &&
                                  !busy
                                ) {
                                  event.preventDefault();
                                  void selectMode(nextRunMode(mode));
                                  return;
                                }
                                if (
                                  skillCommandMenuOpen &&
                                  slashCommandSuggestions.length > 0 &&
                                  !event.nativeEvent.isComposing
                                ) {
                                  if (event.key === "ArrowDown") {
                                    event.preventDefault();
                                    setActiveSlashSuggestion(
                                      (current) =>
                                        (current + 1) %
                                        slashCommandSuggestions.length,
                                    );
                                    return;
                                  }
                                  if (event.key === "ArrowUp") {
                                    event.preventDefault();
                                    setActiveSlashSuggestion(
                                      (current) =>
                                        (current -
                                          1 +
                                          slashCommandSuggestions.length) %
                                        slashCommandSuggestions.length,
                                    );
                                    return;
                                  }
                                  if (
                                    (event.key === "Enter" ||
                                      event.key === "Tab") &&
                                    !event.shiftKey
                                  ) {
                                    event.preventDefault();
                                    const suggestion =
                                      slashCommandSuggestions[
                                        activeSlashSuggestion
                                      ];
                                    if (suggestion?.kind === "goal") {
                                      selectComposerCommand("/goal ");
                                    } else if (suggestion?.kind === "compact") {
                                      selectComposerCommand("/compact");
                                    } else if (suggestion?.kind === "init") {
                                      selectComposerCommand("/init");
                                    } else if (
                                      suggestion?.kind === "plan" ||
                                      suggestion?.kind === "work" ||
                                      suggestion?.kind === "codemode"
                                    ) {
                                      void selectModeCommand(suggestion.kind);
                                    } else if (suggestion?.kind === "skill") {
                                      selectSkillCommand(suggestion.skill);
                                    }
                                    return;
                                  }
                                }
                                if (
                                  skillCommandMenuOpen &&
                                  event.key === "Escape"
                                ) {
                                  event.preventDefault();
                                  setSkillMenuDismissed(true);
                                  return;
                                }
                                if (
                                  visibleComposerPrediction &&
                                  composerPrediction.keyDown(event, setPrompt)
                                )
                                  return;
                                if (
                                  !skillCommandMenuOpen &&
                                  !event.nativeEvent.isComposing &&
                                  (event.key === "ArrowUp" ||
                                    event.key === "ArrowDown")
                                ) {
                                  const navigation = navigatePromptHistory(
                                    activePromptHistory,
                                    prompt,
                                    promptHistoryNavigation.current,
                                    event.key === "ArrowUp"
                                      ? "previous"
                                      : "next",
                                  );
                                  if (navigation) {
                                    event.preventDefault();
                                    promptHistoryNavigation.current =
                                      navigation;
                                    setPrompt(navigation.value);
                                    setSkillMenuDismissed(true);
                                    window.requestAnimationFrame(() => {
                                      promptInput.current?.setSelectionRange(
                                        navigation.value.length,
                                        navigation.value.length,
                                      );
                                    });
                                    return;
                                  }
                                }
                                if (
                                  event.key === "Enter" &&
                                  !event.shiftKey &&
                                  !event.nativeEvent.isComposing
                                ) {
                                  event.preventDefault();
                                  void sendPrompt();
                                }
                              }}
                              onCompositionStart={
                                composerPrediction.compositionStart
                              }
                              onCompositionEnd={(event) =>
                                composerPrediction.compositionEnd(
                                  event.currentTarget.value,
                                )
                              }
                              onPaste={(event) => {
                                composerPrediction.dismiss();
                                handleAttachmentPaste(event);
                              }}
                              placeholder={
                                !prompt &&
                                !visibleComposerPrediction &&
                                !pendingComposerDecision
                                  ? ""
                                  : composerPlaceholder
                              }
                              ref={promptInput}
                              rows={1}
                              value={prompt}
                            />
                            {!prompt &&
                              !visibleComposerPrediction &&
                              !pendingComposerDecision && (
                                <small className="composer-empty-hint">
                                  <span className="composer-placeholder">
                                    {composerPlaceholder}
                                  </span>
                                </small>
                              )}
                          </div>
                          <div className="composer-toolbar">
                            <div className="composer-leading">
                              <button
                                aria-label={t.addAttachments}
                                className="composer-icon-button"
                                disabled={Boolean(pendingComposerDecision)}
                                onClick={() => void selectPromptAttachments()}
                                title={t.addAttachments}
                              >
                                <PlusIcon />
                              </button>
                              <ComposerRunModeControl
                                locale={locale}
                                mode={mode}
                                disabled={
                                  turnActive ||
                                  busy ||
                                  pendingComposerDecision?.kind === "plan"
                                }
                                onModeChange={(nextMode) =>
                                  void selectMode(nextMode)
                                }
                              />
                              <div
                                className="approval-policy-control"
                                ref={approvalPolicyRoot}
                              >
                                <button
                                  aria-expanded={approvalMenuOpen}
                                  aria-haspopup="menu"
                                  className="approval-policy-trigger"
                                  disabled={approvalChangeLocked}
                                  onClick={(event) => {
                                    const root =
                                      event.currentTarget.closest<HTMLElement>(
                                        ".composer",
                                      )!;
                                    const rect =
                                        event.currentTarget.getBoundingClientRect(),
                                      parent = root.getBoundingClientRect();
                                    root.style.setProperty(
                                      "--approval-anchor",
                                      `${document.documentElement.dir === "rtl" ? parent.right - rect.right : rect.left - parent.left}px`,
                                    );
                                    setModelPickerOpen(false);
                                    setApprovalMenuOpen((current) => !current);
                                  }}
                                  title={t.approvalPolicy}
                                >
                                  <ArtemisIcon
                                    className="icon"
                                    name={approvalPolicyIcon}
                                    width={18}
                                    height={18}
                                  />
                                  <span>{approvalPolicyLabel}</span>
                                  <ChevronIcon />
                                </button>
                                {approvalMenuOpen && (
                                  <div
                                    aria-label={t.approvalPolicy}
                                    className="approval-policy-menu"
                                    role="menu"
                                  >
                                    <button
                                      aria-checked={approvalPolicy === "ask"}
                                      className={
                                        approvalPolicy === "ask"
                                          ? "selected"
                                          : ""
                                      }
                                      disabled={approvalChangeLocked}
                                      onClick={() =>
                                        void changeApprovalPolicy("ask")
                                      }
                                      role="menuitemradio"
                                    >
                                      <ArtemisIcon
                                        className="icon"
                                        name="approval-ask"
                                        width={18}
                                        height={18}
                                      />
                                      <span>
                                        <strong>{t.askApproval}</strong>
                                        <small>{t.askApprovalDetail}</small>
                                      </span>
                                      <b aria-hidden="true">
                                        {approvalPolicy === "ask" ? "✓" : ""}
                                      </b>
                                    </button>
                                    <button
                                      aria-checked={approvalPolicy === "agent"}
                                      className={
                                        approvalPolicy === "agent"
                                          ? "selected"
                                          : ""
                                      }
                                      disabled={approvalChangeLocked}
                                      onClick={() =>
                                        void changeApprovalPolicy("agent")
                                      }
                                      role="menuitemradio"
                                    >
                                      <ArtemisIcon
                                        className="icon"
                                        name="approval-agent"
                                        width={18}
                                        height={18}
                                      />
                                      <span>
                                        <strong>{t.agentApproval}</strong>
                                        <small>{t.agentApprovalDetail}</small>
                                      </span>
                                      <b aria-hidden="true">
                                        {approvalPolicy === "agent" ? "✓" : ""}
                                      </b>
                                    </button>
                                    <button
                                      aria-checked={
                                        approvalPolicy === "full-access"
                                      }
                                      className={`danger ${
                                        approvalPolicy === "full-access"
                                          ? "selected"
                                          : ""
                                      }`}
                                      disabled={
                                        approvalChangeLocked ||
                                        !snapshot.sandbox.available
                                      }
                                      onClick={() =>
                                        void changeApprovalPolicy("full-access")
                                      }
                                      role="menuitemradio"
                                    >
                                      <ArtemisIcon
                                        className="icon"
                                        name="approval-full"
                                        width={18}
                                        height={18}
                                      />
                                      <span>
                                        <strong>{t.fullAccess}</strong>
                                        <small>
                                          {snapshot.sandbox.available
                                            ? t.fullAccessDetail
                                            : t.fullAccessUnavailable}
                                        </small>
                                      </span>
                                      <b aria-hidden="true">
                                        {approvalPolicy === "full-access"
                                          ? "✓"
                                          : ""}
                                      </b>
                                    </button>
                                    <small className="approval-policy-note">
                                      {uiText(
                                        locale,
                                        "Review02.approvalMenuNote",
                                      )}
                                    </small>
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="composer-trailing">
                              {turnActive && !pendingComposerDecision && (
                                <span className="composer-running-status">
                                  <RunningArc size={12} />
                                  <span>
                                    {uiText(locale, "App_copy_9734.running")}
                                  </span>
                                  <time>
                                    {Math.floor(
                                      runPresentation.elapsedMs / 60000,
                                    )}
                                    :
                                    {String(
                                      Math.floor(
                                        runPresentation.elapsedMs / 1000,
                                      ) % 60,
                                    ).padStart(2, "0")}
                                  </time>
                                </span>
                              )}
                              <ContextUsageIndicator
                                contextWindow={
                                  runtimeSettings?.contextWindow ??
                                  activeModel?.contextWindow
                                }
                                locale={locale}
                                usage={threadState?.contextUsage}
                              />
                              <div
                                className="model-picker-control"
                                ref={modelPickerRoot}
                              >
                                <Tooltip
                                  align="end"
                                  avoidRef={composerBoundary}
                                  className="model-hover"
                                  label={activeModelLabel}
                                  content={
                                    <ModelHoverDetails
                                      context={threadState?.contextUsage}
                                      contextWindow={
                                        runtimeSettings?.contextWindow ??
                                        activeModel?.contextWindow
                                      }
                                      events={activeEvents}
                                      locale={locale}
                                      model={activeModelLabel}
                                      provider={
                                        activeProvider?.name ??
                                        activeSelection?.providerId
                                      }
                                      thinking={
                                        activeModelSupportsReasoning
                                          ? (activeThinkingLevel ??
                                            thinkingLevelLabel("off", locale))
                                          : undefined
                                      }
                                    />
                                  }
                                >
                                  <button
                                    aria-expanded={modelPickerOpen}
                                    aria-haspopup="menu"
                                    aria-label={t.modelPicker}
                                    className="model-button"
                                    disabled={
                                      busy ||
                                      turnActive ||
                                      switchableModels.length === 0
                                    }
                                    onClick={(event) => {
                                      const root =
                                        event.currentTarget.closest<HTMLElement>(
                                          ".composer",
                                        )!;
                                      const rect =
                                          event.currentTarget.getBoundingClientRect(),
                                        parent = root.getBoundingClientRect();
                                      root.style.setProperty(
                                        "--model-anchor",
                                        `${document.documentElement.dir === "rtl" ? parent.right - rect.right : rect.left - parent.left}px`,
                                      );
                                      setApprovalMenuOpen(false);

                                      setModelFilter("");
                                      setModelPickerOpen((current) => !current);
                                    }}
                                    type="button"
                                  >
                                    <span
                                      aria-hidden="true"
                                      className="model-compact-icon"
                                    >
                                      <ModelIcon />
                                    </span>
                                    <span className="model-information">
                                      <strong>{activeModelLabel}</strong>
                                      {activeThinkingLevel && (
                                        <small>· {activeThinkingLevel}</small>
                                      )}
                                    </span>
                                    <ChevronIcon />
                                  </button>
                                </Tooltip>
                                {modelPickerOpen && (
                                  <ModelPickerMenu
                                    disabled={busy || turnActive}
                                    pending={Boolean(pendingModelSelection)}
                                    models={filteredModels}
                                    providers={runtimeSettings?.providers ?? []}
                                    activeModel={activeModel}
                                    selection={activeSelection}
                                    locale={locale}
                                    query={modelFilter}
                                    onQuery={setModelFilter}
                                    onModel={(model) =>
                                      void switchComposerModel(model)
                                    }
                                    onThinking={(level, ultra) =>
                                      void switchComposerThinking(level, ultra)
                                    }
                                  />
                                )}
                              </div>
                              {turnActive ? (
                                <div className="run-actions">
                                  {(prompt.trim() ||
                                    attachments.length > 0 ||
                                    selectedSkills.length > 0 ||
                                    customAgentTasks.length > 0) && (
                                    <button
                                      className="send-button"
                                      aria-disabled={
                                        Boolean(pendingModelSelection) ||
                                        undefined
                                      }
                                      disabled={
                                        (customAgentTasks.length === 0 &&
                                          !prompt.trim() &&
                                          attachments.length === 0 &&
                                          selectedSkills.length === 0) ||
                                        busy
                                      }
                                      onClick={() => void sendPrompt()}
                                      title={t.followUp}
                                    >
                                      <ArtemisIcon
                                        className="icon"
                                        height={17}
                                        name="send"
                                        width={17}
                                        strokeWidth={1.8}
                                        fallback={
                                          <path d="m6 12 6-6 6 6m-6-6v12" />
                                        }
                                      />
                                    </button>
                                  )}
                                  <button
                                    className="send-button stop"
                                    disabled={!turnRunning}
                                    onClick={() => void cancelActiveTurn()}
                                    title={`${uiText(locale, "Review05.stopRunning")} ${snapshot.platform === "darwin" ? "⌘." : "Ctrl+."}`}
                                  >
                                    <svg viewBox="0 0 32 32" aria-hidden="true">
                                      <circle
                                        cx="16"
                                        cy="16"
                                        r="15"
                                        fill="none"
                                        stroke="var(--border)"
                                        strokeWidth="1.5"
                                      />
                                      <path
                                        className="stop-progress-arc"
                                        d="M16 1a15 15 0 0 1 15 15"
                                        fill="none"
                                        stroke="var(--artemis-color-brand)"
                                        strokeWidth="1.5"
                                        strokeLinecap="round"
                                      />
                                      <rect
                                        x="12"
                                        y="12"
                                        width="8"
                                        height="8"
                                        rx="1.5"
                                        fill="currentColor"
                                        stroke="none"
                                      />
                                    </svg>
                                  </button>
                                </div>
                              ) : (
                                <button
                                  className="send-button"
                                  aria-disabled={
                                    Boolean(pendingModelSelection) || undefined
                                  }
                                  disabled={
                                    (customAgentTasks.length === 0 &&
                                      !prompt.trim() &&
                                      attachments.length === 0 &&
                                      selectedSkills.length === 0) ||
                                    busy ||
                                    Boolean(pendingComposerDecision)
                                  }
                                  onClick={() => void sendPrompt()}
                                  title={t.send}
                                >
                                  <ArtemisIcon
                                    className="icon"
                                    height={17}
                                    name="send"
                                    width={17}
                                    strokeWidth={1.8}
                                    fallback={
                                      <path d="m6 12 6-6 6 6m-6-6v12" />
                                    }
                                  />
                                </button>
                              )}
                            </div>
                          </div>
                        </DecisionComposer>
                      </>
                    </div>
                  )}
                  {conversationEmpty && activeProject && (
                    <WelcomeResume
                      locale={locale}
                      projectId={activeProject.id}
                      threads={snapshot.threads}
                      events={snapshot.events}
                      automations={automations ?? []}
                      gitInfo={
                        welcomeGit?.key === environmentWorkspaceKey
                          ? welcomeGit.info
                          : undefined
                      }
                      onOpenThread={(thread) => {
                        discardNewConversationDraft();
                        setActiveView("workspace");
                        setActiveThreadId(thread.id);
                        setMode(thread.mode);
                      }}
                      onOpenReview={openReviewScopePanel}
                      onOpenAutomation={(id) => {
                        setWelcomeAutomationId(id);
                        setActiveView("automations");
                      }}
                    />
                  )}
                </div>
              </ConversationSurface>

              {!activeThread?.archived && (
                <>
                  <WorkspaceDockResizer
                    controls="conversation workspace-tool-dock"
                    label={t.resizeRightSidebar}
                    maximum={dockWidthBounds.max}
                    minimum={dockWidthBounds.min}
                    open={workspaceDockOpen}
                    onKeyDown={resizeWorkspaceDockFromKeyboard}
                    onPointerCancel={cancelWorkspaceDockResize}
                    onPointerDown={beginWorkspaceDockResize}
                    onPointerMove={moveWorkspaceDockResize}
                    onPointerUp={finishWorkspaceDockResize}
                    value={dockWidthNow}
                    valueText={`${t.rightSidebar}: ${dockWidthNow}px`}
                  />
                  <AppWorkspaceDock
                    {...{
                      workspaceTabs,
                      t,
                      closeWorkspaceTab,
                      dispatchWorkspaceTab,
                      activeWorkspaceTabElement,
                      workspaceTabButtons,
                      workspaceDockOpen,
                      toggleRightSidebar,
                      workspaceDockToggleElement,
                      workspaceTabMenuOpen,
                      setWorkspaceTabMenuOpen,
                      activeProject,
                      designPluginAvailable,
                      locale,
                      focusWorkspaceTab,
                      workspaceTabScrollState,
                      scrollWorkspaceTabs,
                      syncWorkspaceTabScrollState,
                      handleWorkspaceTabWheel,
                      workspaceTabScroll,
                      workspaceTabTrack,
                      openReviewPanel,
                      snapshot,
                      openTerminalPanel,
                      openBrowserPanel,
                      openFilesPanel,
                      openWorkspaceTab,
                      selectReviewScope,
                      reviewScope,
                      reviewCount,
                      setReviewBaseRef,
                      reviewDiff,
                      reviewBaseRef,
                      reviewRefreshing,
                      activeThreadId,
                      setReviewRefreshing,
                      refreshDiff,
                      setToast,
                      setReviewFileQuery,
                      reviewFileQuery,
                      selectedReviewFile,
                      setSelectedReviewFilePath,
                      filteredReviewFiles,
                      reviewBusy,
                      turnActive,
                      mutateReview,
                      reviewComments,
                      setCommentLineId,
                      setCommentBody,
                      deleteReviewComment,
                      commentLineId,
                      username,
                      commentBody,
                      saveReviewComment,
                      busy,
                      retiredGroup,
                      prompt,
                      attachments,
                      selectedSkills,
                      customAgentTasks,
                      sendReviewComment,
                      reviewUndoAvailable,
                      activeThread,
                      latestReviewUndoTurn,
                      undoTurnChanges,
                      projectBranchActionsDisabled,
                      setWorkspaceDockOpen,
                      setEnvironmentCommitRequest,
                      reviewTransitionPending,
                      environmentAgents,
                      environmentMcpUsages,
                      openConversationExternalLink,
                      openChildAgentPanel,
                      openResolvedWorkspaceFile,
                      environmentSources,
                      clockMs,
                      updateThreadInSnapshot,
                      runtimeSettings,
                      setPrompt,
                      addPromptAttachments,
                      promptInput,
                      latestHtmlChange,
                      latestMarkdownChange,
                      activeThreadIdRef,
                      activeComposerDraftKey,
                      designPanelCredentials,
                      draftAttachments,
                      setAttachments,
                      designAnnotationDrafts,
                      designPanelAutoSendText,
                      setDesignDocBinding,
                      threadState,
                      recoverOfficeSnapshot,
                      officeAnnotationFocus,
                      openHtmlFromFiles,
                      agentTeamControlPending,
                      stopAgentTeam,
                      controlChildAgent,
                      childAgentControlPending,
                      workspaceDock,
                      workspaceDockResizing,
                      workspaceDockWidth,
                    }}
                  />
                </>
              )}
            </div>
          </>
        )}
      </section>

      {failedTabClose && (
        <Dialog
          open
          label={uiText(locale, "WorkspaceSave.fileNotSaved")}
          onOpenChange={(open) => {
            if (!open) setFailedTabClose(undefined);
          }}
        >
          <h2>{uiText(locale, "WorkspaceSave.fileNotSaved")}</h2>
          <p>{failedTabClose.path}</p>
          <p>{failedTabClose.message}</p>
          <p>{uiText(locale, "WorkspaceSave.draftHint")}</p>
          <Button onClick={() => setFailedTabClose(undefined)}>
            {uiText(locale, "WorkspaceSave.keepEditing")}
          </Button>
          <Button onClick={() => void closeWorkspaceTab(failedTabClose.tabId)}>
            {uiText(locale, "WorkspaceSave.retrySave")}
          </Button>
          <Button
            onClick={() => {
              try {
                retainWorkspaceDrafts(
                  failedTabClose.threadId,
                  failedTabClose.path,
                );
                void closeWorkspaceTab(failedTabClose.tabId, {
                  moveFocus: true,
                });
              } catch (error) {
                setFailedTabClose({
                  ...failedTabClose,
                  message: String(error),
                });
              }
            }}
          >
            {uiText(locale, "WorkspaceSave.retainDraftAndClose")}
          </Button>
        </Dialog>
      )}
      {projectInstructionsProject && (
        <ProjectInstructionsDialog
          project={projectInstructionsProject}
          locale={locale}
          onConfirm={requestConfirmation}
          onClose={() => setProjectInstructionsProject(undefined)}
        />
      )}
      {sharingThreadId && (
        <ConversationShareDialog
          key={sharingThreadId}
          threadId={sharingThreadId}
          locale={locale}
          onClose={() => setSharingThreadId(undefined)}
        />
      )}
      {threadRename && (
        <Dialog
          className="thread-rename-dialog"
          label={t.renameTaskTitle}
          aria-describedby="thread-rename-hint"
          initialFocusRef={threadRenameInput}
          returnFocusRef={threadMenuAnchor}
          onOpenChange={(open) => {
            if (!open) setThreadRename(undefined);
          }}
          open
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const thread = snapshot?.threads.find(
                (item) => item.id === threadRename.threadId,
              );
              if (thread && threadRename.title.trim())
                void renameThread(thread, threadRename.title);
            }}
          >
            <header>
              <h2>{t.renameTaskTitle}</h2>
              <button
                aria-label={t.renameClose}
                className="thread-rename-close"
                onClick={() => setThreadRename(undefined)}
                type="button"
              >
                <CloseIcon />
              </button>
            </header>
            <p id="thread-rename-hint">{t.renameTaskHint}</p>
            <input
              aria-label={t.taskNamePrompt}
              className="thread-rename-input"
              ref={threadRenameInput}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => {
                const title = event.currentTarget.value;
                setThreadRename((current) =>
                  current ? { ...current, title } : current,
                );
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && event.nativeEvent.isComposing)
                  event.preventDefault();
              }}
              value={threadRename.title}
            />
            <footer>
              <button type="button" onClick={() => setThreadRename(undefined)}>
                {t.renameCancel}
              </button>
              <button
                className="thread-rename-save"
                type="submit"
                disabled={!threadRename.title.trim()}
              >
                {t.renameSave}
              </button>
            </footer>
          </form>
        </Dialog>
      )}

      {updateAnnouncement && (
        <UpdateAnnouncement
          version={updateAnnouncement}
          locale={locale}
          onClose={() => setUpdateAnnouncement(undefined)}
        />
      )}
      {settingsOpen && (
        <Suspense
          fallback={
            <Dialog
              className="settings-panel settings-loading"
              label={t.settings}
              onOpenChange={(open) => {
                if (!open) setSettingsOpen(false);
              }}
              open
              returnFocusRef={settingsTrigger}
            >
              <LoadingState label={t.loadingSettings} />
            </Dialog>
          }
        >
          <SettingsPanel
            username={username}
            initialSettings={runtimeSettings}
            initialTab={settingsTab}
            hooksQuery={hooksQuery}
            locale={locale}
            projects={projects}
            onClose={() => setSettingsOpen(false)}
            returnFocusRef={settingsTrigger}
            onSettingsChange={(value, options) => {
              setRuntimeSettings(value);
              setApprovalPolicy(value.approvalPolicy);
              setSnapshot((current) =>
                current
                  ? {
                      ...current,
                      locale: value.resolvedLocale,
                    }
                  : current,
              );
              if (options?.refreshThreads) {
                void window.artemis
                  .getSnapshot()
                  .then((refreshed) => {
                    setSnapshot((current) =>
                      preserveLoadedEvents(refreshed, current),
                    );
                  })
                  .catch((error) => {
                    setToast(
                      error instanceof Error ? error.message : String(error),
                    );
                  });
              }
            }}
          />
        </Suspense>
      )}

      {confirmation && (
        <Dialog
          aria-describedby="confirmation-message"
          aria-labelledby="confirmation-title"
          className={`confirmation-dialog ${confirmation.tone}`}
          label={
            confirmation.title ??
            (confirmation.tone === "danger"
              ? t.confirmationDangerTitle
              : t.confirmationTitle)
          }
          onOpenChange={(open) => {
            if (!open) resolveConfirmation(false);
          }}
          open
          role="alertdialog"
        >
          <div className="confirmation-copy">
            <h2 id="confirmation-title">
              {confirmation.title ??
                (confirmation.tone === "danger"
                  ? t.confirmationDangerTitle
                  : t.confirmationTitle)}
            </h2>
            <p id="confirmation-message">{confirmation.message}</p>
          </div>
          <div className="confirmation-actions">
            <Button
              className="secondary-button"
              size="compact"
              variant="secondary"
              onClick={() => resolveConfirmation(false)}
            >
              {confirmation.cancelLabel ?? t.confirmationCancel}
            </Button>
            <Button
              size="compact"
              className={
                confirmation.tone === "danger"
                  ? "primary-button danger"
                  : "primary-button"
              }
              variant={confirmation.tone === "danger" ? "danger" : "primary"}
              onClick={() => resolveConfirmation(true)}
            >
              {confirmation.acceptLabel ?? t.confirmationAccept}
            </Button>
          </div>
        </Dialog>
      )}

      {fileLinkContextMenu && (
        <div
          className="file-link-context-backdrop"
          onContextMenu={(event) => {
            event.preventDefault();
            setFileLinkContextMenu(undefined);
          }}
          onMouseDown={() => setFileLinkContextMenu(undefined)}
        >
          <div
            aria-label={t.fileLinkMenu}
            className="file-link-context-menu"
            onMouseDown={(event) => event.stopPropagation()}
            role="menu"
            style={{
              left: `${fileLinkContextMenu.x}px`,
              top: `${fileLinkContextMenu.y}px`,
            }}
            title={fileLinkContextMenu.file.path}
          >
            <button
              autoFocus
              onClick={() => {
                const menu = fileLinkContextMenu;
                setFileLinkContextMenu(undefined);
                if (activeThreadIdRef.current === menu.threadId) {
                  openResolvedWorkspaceFile(menu.file);
                }
              }}
              role="menuitem"
            >
              {t.openLinkedFile}
            </button>
            <button
              onClick={() => void revealConversationFile(fileLinkContextMenu)}
              role="menuitem"
            >
              {t.revealLinkedFile}
            </button>
            {fileLinkContextMenu.file.executable && (
              <button
                className="run"
                onClick={() => void runConversationFile(fileLinkContextMenu)}
                role="menuitem"
              >
                {t.runLinkedFile}
              </button>
            )}
          </div>
        </div>
      )}
    </ApplicationShell>
  );
}

export { WorkspaceTabIcon } from "./app-icons.js";

export { AgentTeamPanel } from "../conversation/agent-team-panel.js";

export { ChildAgentPanel } from "../conversation/child-agent-panel.js";

export { ToolActivityGroupCard } from "../conversation/tool-activity-group-card.js";

export { TurnChangeSetCard } from "../conversation/turn-change-set-card.js";

export { Timeline } from "../conversation/timeline.js";
