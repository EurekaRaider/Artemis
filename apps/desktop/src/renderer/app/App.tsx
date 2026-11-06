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
import { copy, appCopy } from "./app-copy.js";
import {
  type LiveChildActivity,
  type Locale,
  type ActiveView,
  type SettingsEntryTab,
  type ConfirmationTone,
  type ToastContent,
  type ToastState,
  type ConfirmationState,
  type FileLinkContextMenuState,
  type WorkspaceDockDrag,
  type ProjectSidebarDrag,
  type WorkspaceTabScrollState,
} from "./app-types.js";

import { threadPresentationStatus } from "../conversation/thread-presentation.js";

import { useComposerPrediction } from "../conversation/useComposerPrediction.js";

import {
  applyStreamBatch,
  mergeThreadEvents,
  preserveLoadedEvents,
} from "../conversation/stream-snapshot.js";
import { BoundedStateCache } from "./bounded-state-cache.js";
import type { WindowMaterial } from "../../shared/window-material.js";

import { isExecutionMode } from "@artemis/protocol";
import { claimUpdateAnnouncement } from "../updates/update-announcement.js";
import type { HookQuery } from "@artemis/protocol";
import {
  restoreArtifactSnapshot,
  type ArtifactSnapshot,
} from "@artemis/protocol";

import { UserInputCard } from "../conversation/UserInputCard.js";
import { firstPendingComposerDecision } from "../conversation/DecisionComposer.js";
export { UserInputCard } from "../conversation/UserInputCard.js";
import { type ResolveApprovalDecision } from "../conversation/ApprovalDecisionCard.js";

import {
  mergeHistoryPage,
  type ThreadHistoryPage,
} from "../../shared/thread-history.js";

import { GOAL_RESOURCES } from "../../shared/i18n/goal-resources.js";

import { uiText } from "../../shared/i18n/ui-text.js";

import { AGENT_TEAM_LOGICAL_MAXIMUM } from "@artemis/protocol";

import {
  changeOfficeAnnotation,
  readOfficeAnnotations,
  isStoredOfficeAnnotations,
  restoreOfficeAnnotationAttachment,
  type OfficeAnnotationReference,
} from "../office/office-annotations.js";
import {
  addDesignDocumentAttachment,
  DesignAnnotationDraft,
  buildDesignBindingHint,
} from "../design/design-annotations.js";
import { officeAnnotationCopy } from "../office/office-annotation-copy.js";

import { useAutomations } from "../automation/useAutomationCount.js";
import { useTaskNotificationRead } from "../conversation/task-notification-read.js";
import { isAttachmentReference } from "@artemis/protocol";
import { localizedTurnFailure } from "../conversation/turn-failure.js";

import { useImMemberMentions } from "../im/ImMemberMentions";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ClipboardEvent as ReactClipboardEvent,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { useTranslation } from "react-i18next";

import {
  reduceAgentEventBatch,
  reduceAgentEvents,
  type AgentEvent,
  type AgentHostEvent,
  type AgentTeamState,
  type ApprovalPolicy,
  type ApprovalState,
  type ChildAgentState,
  type ModelSelection,
  type PromptAttachment,
  type PromptImage,
  type Project,
  type RunMode,
  type ThinkingLevel,
  type Thread,
  type ThreadViewState,
  type UserInputResolution,
} from "@artemis/protocol";

import type {
  DesktopSnapshot,
  ProjectGitInfo,
  InstalledArtemisPlugin,
  InstalledSkill,
  ReviewAction,
  ReviewComment,
  ReviewDiff,
  ReviewScope,
  SettingsSnapshot,
  WorkspaceFileLink,
} from "../../shared/api.js";
import { localeDirection } from "../../shared/i18n/locales.js";
import { I18N_RESOURCES } from "../../shared/i18n/i18n-resources.js";

import { sortAgentsByActivity } from "../conversation/agent-team-tree.js";

import { normalizeBrowserAddress } from "./browser-navigation.js";

import { useImThreadStatus } from "../im/ImThreadConnection.js";

import {
  desktopSkinHost,
  desktopSkinReady,
} from "../appearance/desktop-skin-bootstrap.js";

import { clampTreeActiveRowId } from "./project-thread-tree.js";

import {
  prepareTimelineRestore,
  resolveTimelinePinned,
  resolveTimelineScrollTarget,
  type TimelineScrollSnapshot,
} from "../conversation/timeline-scroll.js";

import {
  flushWorkspaceEdits,
  retainWorkspaceDrafts,
} from "../workspace/workspace-autosave.js";

import {
  deriveRunPresentation,
  formatRunDuration,
} from "../conversation/run-presentation.js";

import {
  nextRunMode,
  parseRunModeCommand,
} from "../conversation/run-mode-controls.js";

import {
  isSkillCommandPrompt,
  promptWithoutSelectedSkills,
  promptWithSelectedSkills,
  replaceActiveSlashCommand,
  selectedSkillNamesForPrompt,
  slashCommandSuggestionsForPrompt,
} from "../plugins/skill-commands.js";
import {
  addPromptHistoryEntry,
  navigatePromptHistory,
  promptHistoryForConversation,
  type PromptHistoryNavigation,
} from "../conversation/prompt-history.js";
import { deriveTaskPlan } from "../conversation/task-plan.js";
import {
  appendPromptAttachments,
  clearComposerDraft,
  composerDraftFor,
  conversationDraftKey,
  moveComposerDraft,
  restoreComposerQueueItems,
  PromptAttachmentReadQueues,
  updateComposerDraft,
  type ComposerDraft,
  type ComposerDrafts,
  type CustomAgentDraftReference,
} from "../conversation/composer-drafts.js";
import { useCustomAgentMention } from "../settings/CustomAgentMention.js";

import { parseGoalCommand } from "../conversation/goal-command.js";
import {
  isWorkspaceDraftThread,
  sortProjectThreads,
  type ThreadDropEdge,
} from "./thread-list-order.js";

import { useConversationWelcome } from "../conversation/use-conversation-welcome.js";
import {
  agentTeamWorkspaceTab,
  childAgentWorkspaceTab,
  closesLastWorkspaceTab,
  emptyWorkspaceTabs,
  findReusableWorkspaceTab,
  reconcileAgentTeamWorkspaceTab,
  reconcileOfficeWorkspaceTab,
  reduceWorkspaceTabs,
  type WorkspaceTab,
  type WorkspaceTabAction,
  type WorkspaceTabKind,
  type WorkspaceTabOpenOptions,
  workspaceTabFocusTargetAfterClose,
} from "../workspace/workspace-tabs.js";
import { useWorkspaceUiState } from "../workspace/workspace-ui-state.js";
import { booleanUiState, usePersistentUiState } from "./ui-state.js";
import {
  clampWorkspaceDockWidth,
  DEFAULT_WORKSPACE_DOCK_WIDTH,
  workspaceDockWidthAfterKey,
  workspaceDockWidthAfterPointer,
  workspaceDockWidthBounds,
} from "../workspace/workspace-dock-layout.js";
import {
  clampProjectSidebarWidth,
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
import {
  selectionForModelSwitch,
  thinkingLevelLabel,
} from "../settings/model-selection.js";

const EMPTY_WORKSPACE_TAB_SCROLL_STATE: WorkspaceTabScrollState = {
  hasOverflow: false,
  canScrollLeft: false,
  canScrollRight: false,
};

const WORKSPACE_TAB_SCROLL_INSET = 32;
const TOAST_VISIBLE_MILLISECONDS = 10_000;
const TOAST_FADE_MILLISECONDS = 600;

function modelIdentity(providerId: string, modelId: string): string {
  return `${providerId}\u0000${modelId}`;
}

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
  const [composerDrafts, setComposerDrafts] = useState<ComposerDrafts>({});
  const [promptSubmittedAtByThread, setPromptSubmittedAtByThread] = useState<
    Record<string, number>
  >({});
  const [promptHistory, setPromptHistory] = useState<string[]>([]);
  const [installedSkills, setInstalledSkills] = useState<InstalledSkill[]>([]);
  const [installedPlugins, setInstalledPlugins] = useState<
    InstalledArtemisPlugin[]
  >([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsError, setSkillsError] = useState<string>();
  const [skillMenuDismissed, setSkillMenuDismissed] = useState(false);
  const [activeSlashSuggestion, setActiveSlashSuggestion] = useState(0);
  const [attachmentDragActive, setAttachmentDragActive] = useState(false);
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
  const [reviewScope, setReviewScope] = useState<ReviewScope>("branch");
  const [reviewTurnId, setReviewTurnId] = useState<string>();
  const [environmentCommitRequest, setEnvironmentCommitRequest] = useState(0);
  const [reviewBaseRef, setReviewBaseRef] = useState("");
  const [reviewFileQuery, setReviewFileQuery] = useState("");
  const [selectedReviewFilePath, setSelectedReviewFilePath] =
    useState<string>();
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewRefreshing, setReviewRefreshing] = useState(false);
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
  const activeComposerDraftKey = conversationDraftKey(
    activeProjectId,
    activeThreadId,
  );
  const activeComposerDraft = composerDraftFor(
    composerDrafts,
    activeComposerDraftKey,
  );
  const {
    attachments,
    prompt,
    selectedSkillNames: selectedComposerSkillNames,
    customAgentTasks = [],
  } = activeComposerDraft;
  const composerPrediction = useComposerPrediction(
    activeThreadId,
    runtimeSettings?.composerPredictions ?? true,
    attachments.length > 0 ||
      selectedComposerSkillNames.length > 0 ||
      customAgentTasks.length > 0,
    prompt,
  );
  const hasOfficeAnnotations = attachments.some((item) =>
    readOfficeAnnotations(item),
  );
  const hasRegularAttachments = attachments.some(
    (item) => !readOfficeAnnotations(item),
  );
  const draftAttachments = useRef(new Map<string, PromptAttachment[]>());
  draftAttachments.current.set(activeComposerDraftKey, attachments);
  // 设计面板批注（消息体 hint 的 pending 集），随草稿隔离、发送时消费
  const designAnnotationDrafts = useRef(
    new Map<string, DesignAnnotationDraft>(),
  );
  // OD activeProjectFileName 等价物：设计面板的活动文档 tab 锁定 composer，
  // 芯片提示 + 发送自动附页；null=网格视图（解绑）。
  const [designDocBinding, setDesignDocBinding] = useState<{
    documentId: string;
    name: string;
    html: string;
  } | null>(null);
  const designDocBindingRef = useRef(designDocBinding);
  designDocBindingRef.current = designDocBinding;
  // 设计入口可见性跟随能力包：开关关闭（pack 移除）时 + 菜单/launcher 的
  // 设计入口隐藏、已开的设计 tab 关闭。初始乐观 true，首个查询即纠正。
  const [designPluginAvailable, setDesignPluginAvailable] = useState(true);
  useEffect(() => {
    void window.artemis
      .designCapabilityAvailability()
      .then((value) => setDesignPluginAvailable(value.available))
      .catch(() => {});
    return window.artemis.onDesignCapabilityAvailability((event) => {
      setDesignPluginAvailable(event.available);
      if (!event.available) {
        // 关闭插件 = 设计模式全局下线：所有线程的设计 tab 一并关闭
        // （面板视图已由主进程回收）。
        setWorkspaceTabsByThread((current) => {
          let changed = false;
          const next: typeof current = {};
          for (const [threadId, state] of Object.entries(current)) {
            const designTabs = state.tabs.filter(
              (tab) => tab.kind === "design",
            );
            if (designTabs.length === 0) {
              next[threadId] = state;
              continue;
            }
            changed = true;
            let updated = state;
            for (const tab of designTabs) {
              updated = reduceWorkspaceTabs(updated, {
                type: "close",
                tabId: tab.id,
              });
            }
            next[threadId] = updated;
          }
          return changed ? next : current;
        });
      }
    });
  }, []);
  // OD queueOnly 语义的落点：面板批注发送后自动触发发送。effect 在
  // prompt state 落地后消费此标记并调用 sendPrompt（空闲直发、运行中
  // 走 followUpTurn 排队）；置 null 表示没有待自动发送的文本。
  const designPanelAutoSendText = useRef<{
    draftKey: string;
    text: string;
  } | null>(null);
  const reviewCommentAutoSendText = useRef<{
    draftKey: string;
    text: string;
  } | null>(null);
  const designPanelCredentials = useRef(
    new Map<string, { text: string; credential: string }>(),
  );
  const pendingAttachmentReads = useRef(new PromptAttachmentReadQueues());
  const updateActiveComposerDraft = useCallback(
    (update: (current: ComposerDraft) => ComposerDraft) => {
      setComposerDrafts((current) =>
        updateComposerDraft(current, activeComposerDraftKey, update),
      );
    },
    [activeComposerDraftKey],
  );
  const setPrompt = useCallback(
    (action: SetStateAction<string>) => {
      updateActiveComposerDraft((current) => ({
        ...current,
        prompt: typeof action === "function" ? action(current.prompt) : action,
      }));
    },
    [updateActiveComposerDraft],
  );
  const groupMentions = useImMemberMentions({
    group: activeThreadId ? imThreadStatus[activeThreadId]?.group : undefined,
    text: prompt,
    setText: setPrompt,
    input: promptInput,
  });
  const [focusAgentTaskId, setFocusAgentTaskId] = useState<string>();
  const setCustomAgentTasks = useCallback(
    (tasks: NonNullable<ComposerDraft["customAgentTasks"]>) => {
      updateActiveComposerDraft((current) => ({
        ...current,
        customAgentTasks: tasks,
      }));
    },
    [updateActiveComposerDraft],
  );
  const addCustomAgentTask = (reference: CustomAgentDraftReference) => {
    const id = crypto.randomUUID();
    updateActiveComposerDraft((current) => ({
      ...current,
      customAgentTasks: [
        ...(current.customAgentTasks ?? []),
        { ...reference, id, text: "" },
      ],
    }));
    setFocusAgentTaskId(id);
  };
  const customAgentMention = useCustomAgentMention({
    definitions: runtimeSettings?.customAgents ?? [],
    projectId:
      (snapshot?.threads ?? []).find((thread) => thread.id === activeThreadId)
        ?.projectId ?? activeProjectId,
    text: prompt,
    setText: setPrompt,
    input: promptInput,
    enabled: customAgentTasks.length < AGENT_TEAM_LOGICAL_MAXIMUM,
    remaining: AGENT_TEAM_LOGICAL_MAXIMUM - customAgentTasks.length,
    members: groupMentions.open ? groupMentions : undefined,
    onSelect: addCustomAgentTask,
    plugins: {
      installed: installedPlugins,
      skills: skillsLoading ? [] : installedSkills,
      selectedNames: selectedComposerSkillNames,
      onSelect: (skill) =>
        setSelectedComposerSkillNames((current) =>
          current.includes(skill.name) ? current : [...current, skill.name],
        ),
    },
  });
  const copyConversationText = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setToast(t.messageCopied);
      } catch (error) {
        setToast({
          error: true,
          message: `${t.messageCopyFailed} ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }
    },
    [t.messageCopied, t.messageCopyFailed],
  );
  const editConversationMessage = useCallback(
    (text: string) => {
      updateActiveComposerDraft(() => ({
        attachments: [],
        prompt: promptWithoutSelectedSkills(text),
        selectedSkillNames: selectedSkillNamesForPrompt(text),
      }));
      window.requestAnimationFrame(() => {
        const input = promptInput.current;
        input?.focus({ preventScroll: true });
        input?.setSelectionRange(0, input.value.length);
      });
    },
    [updateActiveComposerDraft],
  );
  const setSelectedComposerSkillNames = useCallback(
    (action: SetStateAction<string[]>) => {
      updateActiveComposerDraft((current) => ({
        ...current,
        selectedSkillNames:
          typeof action === "function"
            ? action(current.selectedSkillNames)
            : action,
      }));
    },
    [updateActiveComposerDraft],
  );
  const setAttachments = useCallback(
    (action: SetStateAction<PromptAttachment[]>) => {
      const current =
        draftAttachments.current.get(activeComposerDraftKey) ?? [];
      const next = typeof action === "function" ? action(current) : action;
      draftAttachments.current.set(activeComposerDraftKey, next);
      updateActiveComposerDraft((current) => ({
        ...current,
        attachments: next,
      }));
    },
    [activeComposerDraftKey, updateActiveComposerDraft],
  );

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

  useEffect(() => {
    promptHistoryNavigation.current = { index: -1, draft: prompt };
    setSkillMenuDismissed(false);
    setEditingQueuedMessage(undefined);
  }, [activeComposerDraftKey]);

  const beginNewConversation = useCallback(
    (projectId = activeProjectId) => {
      renewConversationGreeting();
      setActiveView("workspace");
      setActiveProjectId(projectId);
      setActiveThreadId(undefined);
      setMode("work");
      setComposerDrafts((current) =>
        clearComposerDraft(current, conversationDraftKey(projectId, undefined)),
      );
      promptHistoryNavigation.current = { index: -1, draft: "" };
      setSkillMenuDismissed(false);
      setProjectMenuId(undefined);
      setThreadMenuId(undefined);
      window.requestAnimationFrame(() => promptInput.current?.focus());
    },
    [activeProjectId, renewConversationGreeting],
  );

  const beginTemporaryConversation = useCallback(() => {
    renewConversationGreeting();
    setActiveView("workspace");
    setActiveProjectId(undefined);
    setActiveThreadId(undefined);
    setMode("work");
    setComposerDrafts((current) =>
      clearComposerDraft(current, conversationDraftKey(undefined, undefined)),
    );
    promptHistoryNavigation.current = { index: -1, draft: "" };
    setSkillMenuDismissed(false);
    setProjectMenuId(undefined);
    setThreadMenuId(undefined);
    window.requestAnimationFrame(() => promptInput.current?.focus());
  }, [renewConversationGreeting]);

  const discardNewConversationDraft = useCallback(() => {
    if (activeThreadId) return;
    setComposerDrafts((current) =>
      clearComposerDraft(
        current,
        conversationDraftKey(activeProjectId, undefined),
      ),
    );
    promptHistoryNavigation.current = { index: -1, draft: "" };
    setSkillMenuDismissed(false);
  }, [activeProjectId, activeThreadId]);

  const toggleProjectHistory = useCallback(
    (projectId: string) => {
      setProjectCollapsed(
        projectId,
        !collapsedProjectIdsRef.current.has(projectId),
      );
    },
    [setProjectCollapsed],
  );

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

  const requestConfirmation = useCallback(
    (
      message: string,
      tone: ConfirmationTone = "default",
      options: Pick<
        ConfirmationState,
        "acceptLabel" | "cancelLabel" | "title"
      > = {},
    ) =>
      new Promise<boolean>((resolve) => {
        confirmationResolver.current?.(false);
        confirmationResolver.current = resolve;
        setConfirmation({ message, tone, ...options });
      }),
    [],
  );

  const resolveConfirmation = useCallback((confirmed: boolean) => {
    const resolve = confirmationResolver.current;
    confirmationResolver.current = undefined;
    setConfirmation(undefined);
    resolve?.(confirmed);
  }, []);

  useEffect(
    () => () => {
      confirmationResolver.current?.(false);
      confirmationResolver.current = undefined;
    },
    [],
  );

  const activeToastId = toast?.id;
  useEffect(() => {
    if (activeToastId === undefined) return;
    const fadeTimer = window.setTimeout(() => {
      setToastState((current) =>
        current?.id === activeToastId ? { ...current, fading: true } : current,
      );
    }, TOAST_VISIBLE_MILLISECONDS);
    const removeTimer = window.setTimeout(() => {
      setToastState((current) =>
        current?.id === activeToastId ? undefined : current,
      );
    }, TOAST_VISIBLE_MILLISECONDS + TOAST_FADE_MILLISECONDS);
    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(removeTimer);
    };
  }, [activeToastId]);

  useEffect(() => {
    if (!approvalMenuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!approvalPolicyRoot.current?.contains(event.target as Node)) {
        setApprovalMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
    };
  }, [approvalMenuOpen]);

  useEffect(() => {
    if (!modelPickerOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!modelPickerRoot.current?.contains(event.target as Node)) {
        setModelPickerOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [modelPickerOpen]);

  useEffect(() => {
    if (!projectMenuId && !threadMenuId) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(
          ".project-menu, .thread-menu, .project-action, .thread-action",
        )
      ) {
        return;
      }
      setProjectMenuId(undefined);
      setThreadMenuId(undefined);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setProjectMenuId(undefined);
      setThreadMenuId(undefined);
    };
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [projectMenuId, threadMenuId]);

  const skillCommandMenuOpen =
    !skillMenuDismissed && isSkillCommandPrompt(prompt);
  const installedPluginBySkillName = useMemo(() => {
    const plugins = new Map<string, InstalledArtemisPlugin>();
    for (const plugin of installedPlugins) {
      for (const skillName of plugin.skillNames) {
        plugins.set(skillName, plugin);
      }
    }
    return plugins;
  }, [installedPlugins]);
  const slashCommandSuggestions = useMemo(() => {
    const selectedNames = new Set(selectedComposerSkillNames);
    const suggestions = slashCommandSuggestionsForPrompt(
      prompt,
      (skillsLoading ? [] : installedSkills).filter(
        (skill) =>
          !selectedNames.has(skill.name) &&
          !installedPluginBySkillName.has(skill.name),
      ),
    );
    return [
      ...suggestions.filter((suggestion) => suggestion.kind === "skill"),
      ...suggestions.filter(
        (suggestion) =>
          suggestion.kind !== "skill" &&
          (selectedComposerSkillNames.length === 0 ||
            suggestion.kind === "plan" ||
            suggestion.kind === "work" ||
            suggestion.kind === "codemode"),
      ),
    ];
  }, [
    installedPluginBySkillName,
    installedSkills,
    skillsLoading,
    prompt,
    selectedComposerSkillNames,
  ]);
  const goalSuggestionIndex = slashCommandSuggestions.findIndex(
    (suggestion) => suggestion.kind === "goal",
  );
  const compactSuggestionIndex = slashCommandSuggestions.findIndex(
    (suggestion) => suggestion.kind === "compact",
  );
  const initSuggestionIndex = slashCommandSuggestions.findIndex(
    (suggestion) => suggestion.kind === "init",
  );
  const modeSuggestions = slashCommandSuggestions.flatMap(
    (suggestion, index) =>
      suggestion.kind === "plan" ||
      suggestion.kind === "work" ||
      suggestion.kind === "codemode"
        ? [{ index, mode: suggestion.kind }]
        : [],
  );
  const skillSuggestions = slashCommandSuggestions.flatMap(
    (suggestion, index) =>
      suggestion.kind === "skill" ? [{ index, skill: suggestion.skill }] : [],
  );
  const selectedSkills = useMemo(
    () =>
      selectedComposerSkillNames.flatMap((name) => {
        const skill = installedSkills.find(
          (candidate) => candidate.enabled && candidate.name === name,
        );
        return skill ? [skill] : [];
      }),
    [installedSkills, selectedComposerSkillNames],
  );
  const createThread = useCallback(
    async (projectId = activeProjectId, preserveDraft = false) => {
      try {
        const reusableWorkspaceDraft = snapshot?.threads.find(
          (thread) =>
            thread.projectId === projectId && isWorkspaceDraftThread(thread),
        );
        const thread =
          reusableWorkspaceDraft ??
          (await window.artemis.createThread({
            ...(projectId ? { projectId } : {}),
            mode,
            target: "local",
          }));
        if (!thread) return undefined;
        loadedEventThreads.current.add(thread.id);
        if (!reusableWorkspaceDraft) {
          const refreshed = await window.artemis.getSnapshot();
          setSnapshot((current) => preserveLoadedEvents(refreshed, current));
        }
        if (preserveDraft) {
          setComposerDrafts((current) =>
            moveComposerDraft(
              current,
              conversationDraftKey(projectId, undefined),
              conversationDraftKey(projectId, thread.id),
            ),
          );
        }
        setActiveView("workspace");
        setActiveProjectId(projectId);
        setActiveThreadId(thread.id);
        return thread;
      } catch (error) {
        setToast(
          `${t.taskError} ${error instanceof Error ? error.message : String(error)}`,
        );
        return undefined;
      }
    },
    [activeProjectId, mode, snapshot?.threads, t.taskError],
  );

  const ensureWorkspaceThread = useCallback(() => {
    if (activeThreadId) return Promise.resolve(activeThreadId);
    if (workspaceThreadCreation.current) {
      return workspaceThreadCreation.current;
    }
    const pending = createThread(activeProjectId, true)
      .then((thread) => thread?.id)
      .finally(() => {
        if (workspaceThreadCreation.current === pending) {
          workspaceThreadCreation.current = undefined;
        }
      });
    workspaceThreadCreation.current = pending;
    return pending;
  }, [activeProjectId, activeThreadId, createThread]);

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
    (kind: WorkspaceTabKind, options: WorkspaceTabOpenOptions = {}) => {
      setWorkspaceDockOpen(true);
      setWorkspaceTabMenuOpen(false);
      if (activeThreadId) {
        openWorkspaceTabForThread(activeThreadId, kind, options);
        return;
      }
      void ensureWorkspaceThread().then((threadId) => {
        if (threadId) openWorkspaceTabForThread(threadId, kind, options);
      });
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

  const openConversationFileLink = useCallback(
    async (href: string) => {
      const threadId = activeThreadId;
      if (!threadId) return;
      try {
        const file = await window.artemis.inspectWorkspaceFileLink(
          threadId,
          href,
        );
        if (activeThreadIdRef.current !== threadId) return;
        openResolvedWorkspaceFile(file);
      } catch (error) {
        setToast({
          error: true,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [activeThreadId, openResolvedWorkspaceFile],
  );

  const openConversationExternalLink = useCallback(
    (href: string) => {
      try {
        const url = normalizeBrowserAddress(href, locale);
        openWorkspaceTab("browser", { reuseKind: true, url });
      } catch (error) {
        setToast({
          error: true,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [openWorkspaceTab],
  );

  const openConversationFileLinkMenu = useCallback(
    async (href: string, position: { x: number; y: number }) => {
      const threadId = activeThreadId;
      if (!threadId) return;
      setFileLinkContextMenu(undefined);
      try {
        const file = await window.artemis.inspectWorkspaceFileLink(
          threadId,
          href,
        );
        if (activeThreadIdRef.current !== threadId) return;
        const menuWidth = 208;
        const menuHeight = file.executable ? 122 : 84;
        setFileLinkContextMenu({
          file,
          threadId,
          x: Math.max(
            8,
            Math.min(position.x, window.innerWidth - menuWidth - 8),
          ),
          y: Math.max(
            8,
            Math.min(position.y, window.innerHeight - menuHeight - 8),
          ),
        });
      } catch (error) {
        setToast({
          error: true,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [activeThreadId],
  );

  const revealConversationFile = useCallback(
    async (menu: FileLinkContextMenuState) => {
      setFileLinkContextMenu(undefined);
      try {
        await window.artemis.revealWorkspaceFile(menu.threadId, menu.file.path);
      } catch (error) {
        setToast({
          error: true,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [],
  );

  const runConversationFile = useCallback(
    async (menu: FileLinkContextMenuState) => {
      setFileLinkContextMenu(undefined);
      try {
        await window.artemis.runWorkspaceFile(menu.threadId, menu.file.path);
        setToast(`${t.runLinkedFileStarted}: ${menu.file.path}`);
      } catch (error) {
        setToast({
          error: true,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [t.runLinkedFileStarted],
  );

  useEffect(() => {
    setFileLinkContextMenu(undefined);
  }, [activeThreadId]);

  useEffect(() => {
    if (!fileLinkContextMenu) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFileLinkContextMenu(undefined);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [fileLinkContextMenu]);

  const openChildAgentPanel = useCallback(
    (child: ChildAgentState) => {
      setWorkspaceDockOpen(true);
      setWorkspaceTabMenuOpen(false);
      dispatchWorkspaceTab({
        type: "open",
        tab: childAgentWorkspaceTab(child.agentId, child.label, child.teamId),
      });
    },
    [dispatchWorkspaceTab],
  );

  const openAgentTeamPanel = useCallback(
    (team: AgentTeamState) => {
      setWorkspaceDockOpen(true);
      setWorkspaceTabMenuOpen(false);
      dispatchWorkspaceTab({
        type: "open",
        tab: agentTeamWorkspaceTab(team.teamId, t.agentTeam),
      });
    },
    [dispatchWorkspaceTab, t.agentTeam],
  );

  const controlChildAgent = useCallback(
    async (child: ChildAgentState, action: "steer" | "cancel" | "retry") => {
      if (!activeThreadId) return;
      const pendingKey = `${child.agentId}:${action}`;
      setChildAgentControlPending(pendingKey);
      try {
        const result = await window.artemis.controlChildAgent({
          threadId: activeThreadId,
          agentId: child.agentId,
          action,
          ...(action === "steer"
            ? {
                message: I18N_RESOURCES[localeRef.current].app.childNudgePrompt,
              }
            : {}),
        });
        if (action === "retry") {
          setWorkspaceDockOpen(true);
          dispatchWorkspaceTab({
            type: "open",
            tab: childAgentWorkspaceTab(
              result.agentId,
              child.label,
              child.teamId,
            ),
          });
        }
      } catch (error) {
        setToast({
          error: true,
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setChildAgentControlPending(undefined);
      }
    },
    [activeThreadId, dispatchWorkspaceTab],
  );

  const stopAgentTeam = useCallback(
    async (team: AgentTeamState) => {
      if (!activeThreadId) return;
      setAgentTeamControlPending(true);
      try {
        await window.artemis.controlAgentTeam({
          threadId: activeThreadId,
          teamId: team.teamId,
          action: "cancel",
        });
      } catch (error) {
        setToast({
          error: true,
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setAgentTeamControlPending(false);
      }
    },
    [activeThreadId],
  );

  const openReviewPanel = useCallback(() => {
    if (!activeProjectId) return;
    openWorkspaceTab("review");
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
  const persistProjectSidebarWidth = useCallback((width: number) => {
    projectSidebarPersistence.current = projectSidebarPersistence.current.then(
      async () => {
        try {
          const persisted = await window.artemis.setProjectSidebarWidth(width);
          setProjectSidebarWidth(persisted);
          setRuntimeSettings((current) =>
            current ? { ...current, projectSidebarWidth: persisted } : current,
          );
        } catch (error) {
          setToast({
            error: true,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      },
    );
    return projectSidebarPersistence.current;
  }, []);
  const persistProjectOrder = useCallback(
    (order: string[], previousOrder: string[]) => {
      setRuntimeSettings((current) =>
        current ? { ...current, projectOrder: order } : current,
      );
      return projectOrderPersistence.current?.persist(order, previousOrder);
    },
    [],
  );
  const persistProjectThreadOrder = useCallback(
    (projectId: string, order: string[], previousOrder: string[]) => {
      const applyOrder = (
        current: SettingsSnapshot | undefined,
        value: string[],
      ) =>
        current
          ? {
              ...current,
              projectThreadOrder: {
                ...(current.projectThreadOrder ?? {}),
                [projectId]: value,
              },
            }
          : current;
      let persistence = projectThreadOrderPersistence.current.get(projectId);
      if (!persistence) {
        persistence = createProjectOrderPersistenceQueue({
          save: (value) =>
            window.artemis.setProjectThreadOrder(projectId, value),
          onPersisted: (value) => {
            setRuntimeSettings((current) => applyOrder(current, value));
          },
          onRejected: (value, error) => {
            setRuntimeSettings((current) => applyOrder(current, value));
            setToast({
              error: true,
              message: error instanceof Error ? error.message : String(error),
            });
          },
        });
        projectThreadOrderPersistence.current.set(projectId, persistence);
      }
      setRuntimeSettings((current) => applyOrder(current, order));
      return persistence.persist(order, previousOrder);
    },
    [],
  );
  const projectSidebarWidthForPointer = useCallback((clientX: number) => {
    const drag = projectSidebarDrag.current;
    if (!drag) return projectSidebarWidthRef.current;
    const delta =
      document.documentElement.dir === "rtl"
        ? drag.startX - clientX
        : clientX - drag.startX;
    return clampProjectSidebarWidth(drag.startWidth + delta);
  }, []);
  const beginProjectSidebarResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!sidebarOpen || event.button !== 0) return;
      const startWidth =
        projectSidebar.current?.getBoundingClientRect().width ??
        projectSidebarWidthRef.current ??
        PROJECT_SIDEBAR_WIDTH_DEFAULT;
      projectSidebarDrag.current = {
        pointerId: event.pointerId,
        startWidth,
        startX: event.clientX,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      setProjectSidebarWidth(Math.round(startWidth));
      setProjectSidebarResizing(true);
    },
    [sidebarOpen],
  );
  const moveProjectSidebarResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (projectSidebarDrag.current?.pointerId !== event.pointerId) return;
      const width = projectSidebarWidthForPointer(event.clientX);
      if (width !== undefined) setProjectSidebarWidth(width);
    },
    [projectSidebarWidthForPointer],
  );
  const finishProjectSidebarResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (projectSidebarDrag.current?.pointerId !== event.pointerId) return;
      const width = projectSidebarWidthForPointer(event.clientX);
      projectSidebarDrag.current = undefined;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setProjectSidebarResizing(false);
      if (width !== undefined) {
        setProjectSidebarWidth(width);
        void persistProjectSidebarWidth(width);
      }
    },
    [persistProjectSidebarWidth, projectSidebarWidthForPointer],
  );
  const cancelProjectSidebarResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = projectSidebarDrag.current;
      if (drag?.pointerId !== event.pointerId) return;
      projectSidebarDrag.current = undefined;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setProjectSidebarResizing(false);
      setProjectSidebarWidth(clampProjectSidebarWidth(drag.startWidth));
    },
    [],
  );
  const resizeProjectSidebarFromKeyboard = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const currentWidth =
        projectSidebar.current?.getBoundingClientRect().width ??
        projectSidebarWidthRef.current ??
        PROJECT_SIDEBAR_WIDTH_DEFAULT;
      const logicalIncrease =
        document.documentElement.dir === "rtl"
          ? event.key === "ArrowLeft"
          : event.key === "ArrowRight";
      const width = clampProjectSidebarWidth(
        currentWidth + (logicalIncrease ? 24 : -24),
      );
      setProjectSidebarWidth(width);
      void persistProjectSidebarWidth(width);
    },
    [persistProjectSidebarWidth],
  );
  const currentWorkspaceDockBounds = useCallback(
    () =>
      workspaceDockWidthBounds(
        workspaceContent.current?.clientWidth ?? window.innerWidth,
        window.innerWidth,
      ),
    [],
  );
  const persistWorkspaceDockWidth = useCallback((width: number) => {
    workspaceDockPersistence.current = workspaceDockPersistence.current.then(
      async () => {
        try {
          const persisted = await window.artemis.setWorkspaceDockWidth(width);
          setWorkspaceDockWidth(persisted);
          setRuntimeSettings((current) =>
            current ? { ...current, workspaceDockWidth: persisted } : current,
          );
        } catch (error) {
          setToast({
            error: true,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      },
    );
    return workspaceDockPersistence.current;
  }, []);
  const workspaceDockWidthForPointer = useCallback(
    (clientX: number) => {
      const drag = workspaceDockDrag.current;
      if (!drag) return workspaceDockWidthRef.current;
      return workspaceDockWidthAfterPointer(
        drag.startWidth,
        drag.startX,
        clientX,
        document.documentElement.dir === "rtl" ? "rtl" : "ltr",
        currentWorkspaceDockBounds(),
      );
    },
    [currentWorkspaceDockBounds],
  );
  const beginWorkspaceDockResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || !workspaceDockOpen) return;
      event.preventDefault();
      const startWidth = workspaceDock.current?.getBoundingClientRect().width;
      if (!startWidth) return;
      workspaceDockDrag.current = {
        pointerId: event.pointerId,
        startWidth,
        startX: event.clientX,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      setWorkspaceDockWidth(Math.round(startWidth));
      setWorkspaceDockResizing(true);
    },
    [workspaceDockOpen],
  );
  const moveWorkspaceDockResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (workspaceDockDrag.current?.pointerId !== event.pointerId) return;
      const width = workspaceDockWidthForPointer(event.clientX);
      if (width !== undefined) setWorkspaceDockWidth(width);
    },
    [workspaceDockWidthForPointer],
  );
  const finishWorkspaceDockResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (workspaceDockDrag.current?.pointerId !== event.pointerId) return;
      const width = workspaceDockWidthForPointer(event.clientX);
      workspaceDockDrag.current = undefined;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setWorkspaceDockResizing(false);
      if (width !== undefined) {
        setWorkspaceDockWidth(width);
        void persistWorkspaceDockWidth(width);
      }
    },
    [persistWorkspaceDockWidth, workspaceDockWidthForPointer],
  );
  const cancelWorkspaceDockResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (workspaceDockDrag.current?.pointerId !== event.pointerId) return;
      const width = Math.round(
        workspaceDockWidthRef.current ?? workspaceDockDrag.current.startWidth,
      );
      workspaceDockDrag.current = undefined;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setWorkspaceDockResizing(false);
      setWorkspaceDockWidth(width);
      void persistWorkspaceDockWidth(width);
    },
    [persistWorkspaceDockWidth],
  );
  const resizeWorkspaceDockFromKeyboard = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (
        event.key !== "ArrowLeft" &&
        event.key !== "ArrowRight" &&
        event.key !== "Home" &&
        event.key !== "End"
      ) {
        return;
      }
      event.preventDefault();
      const bounds = currentWorkspaceDockBounds();
      const currentWidth =
        workspaceDock.current?.getBoundingClientRect().width ??
        workspaceDockWidthRef.current ??
        bounds.min;
      const step = event.shiftKey ? 64 : 24;
      const width = workspaceDockWidthAfterKey(
        currentWidth,
        event.key,
        document.documentElement.dir === "rtl" ? "rtl" : "ltr",
        bounds,
        workspaceContent.current?.clientWidth ?? window.innerWidth,
        step,
      );
      setWorkspaceDockWidth(width);
      void persistWorkspaceDockWidth(width);
    },
    [currentWorkspaceDockBounds, persistWorkspaceDockWidth],
  );
  const toggleRightSidebar = useCallback(() => {
    setWorkspaceDockOpen((open) => !open);
    setWorkspaceTabMenuOpen(false);
  }, []);
  const toggleReviewPanel = useCallback(() => {
    if (workspaceDockOpen && activeWorkspaceTab?.kind === "review") {
      setWorkspaceDockOpen(false);
    } else {
      openReviewPanel();
    }
  }, [activeWorkspaceTab?.kind, openReviewPanel, workspaceDockOpen]);
  const toggleTerminalPanel = useCallback(() => {
    if (workspaceDockOpen && activeWorkspaceTab?.kind === "terminal") {
      setWorkspaceDockOpen(false);
    } else {
      openTerminalPanel();
    }
  }, [activeWorkspaceTab?.kind, openTerminalPanel, workspaceDockOpen]);

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

  useEffect(() => {
    let mounted = true;
    // History capability icons need plugin metadata before the skill menu opens.
    let receivedMaterial = false;
    const unsubscribeMaterial = window.artemis.onWindowMaterialChanged?.(
      (material) => {
        receivedMaterial = true;
        setWindowMaterial(material);
      },
    );
    void window.artemis
      .listArtemisPlugins()
      .then((plugins) => {
        if (mounted) setInstalledPlugins(plugins);
      })
      .catch((error) => {
        if (mounted) {
          setToast(error instanceof Error ? error.message : String(error));
        }
      });
    performance.mark?.("artemis:snapshot-request");
    void window.artemis.getSnapshot().then((value) => {
      if (!mounted) return;
      performance.mark?.("artemis:snapshot-ready");
      setSnapshot(value);
      if (!receivedMaterial) setWindowMaterial(value.windowMaterial);
      const project = value.projects[0];
      setActiveProjectId(project?.id);
      setActiveThreadId(undefined);
      setMode("work");
    });
    void window.artemis
      .getSettings()
      .then((value) => {
        if (mounted) {
          projectOrderPersistence.current?.initialize(value.projectOrder ?? []);
          const persistedCollapsed = new Set(value.collapsedProjectIds ?? []);
          collapsedProjectIdsPersistence.current?.initialize([
            ...persistedCollapsed,
          ]);
          if (!collapsedProjectIdsTouched.current) {
            collapsedProjectIdsRef.current = persistedCollapsed;
            setCollapsedProjectIds(persistedCollapsed);
          }
          const persistedExpanded = new Set(value.expandedProjectIds ?? []);
          expandedProjectIdsPersistence.current?.initialize([
            ...persistedExpanded,
          ]);
          if (!expandedProjectIdsTouched.current) {
            expandedProjectIdsRef.current = persistedExpanded;
            setExpandedProjectIds(persistedExpanded);
          }
          setApprovalPolicy(value.approvalPolicy);
          setRuntimeSettings(
            collapsedProjectIdsTouched.current
              ? {
                  ...value,
                  collapsedProjectIds: [...collapsedProjectIdsRef.current],
                }
              : value,
          );
        }
      })
      .catch((error) => {
        if (mounted) {
          setToast(error instanceof Error ? error.message : String(error));
        }
      });
    void window.artemis
      .getPromptHistory()
      .then((history) => {
        if (mounted) {
          setPromptHistory((current) =>
            [
              ...current,
              ...history.filter((prompt) => !current.includes(prompt)),
            ].slice(0, 100),
          );
        }
      })
      .catch((error) => {
        if (mounted) {
          setToast(error instanceof Error ? error.message : String(error));
        }
      });
    const flushAgentEvents = () => {
      pendingAgentFrame.current = undefined;
      const batch = pendingAgentEvents.current.splice(0);
      if (batch.length === 0) return;
      setSnapshot((current) => {
        if (!current) return current;
        return applyStreamBatch(current, batch);
      });
      const visibleText = batch.find(
        (event) =>
          event.threadId === activeThreadIdRef.current &&
          event.turnId &&
          event.payload.type === "message.part.delta" &&
          event.payload.partType === "text" &&
          event.payload.delta.length > 0 &&
          !reportedTurnPaints.current.has(event.turnId),
      );
      if (visibleText?.turnId) {
        const turnId = visibleText.turnId;
        reportedTurnPaints.current.add(turnId);
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            window.artemis.reportTurnRendered(turnId, Date.now());
          });
        });
      }
    };
    const receiveAgentEvents = (events: AgentEvent[]) => {
      const finishedThreadIds = new Set<string>();
      for (const event of events) {
        composerPrediction.receive(event);
        if (
          event.payload.type === "artifact.event" &&
          event.payload.event.kind === "opened"
        ) {
          liveOfficeTabs.current.add(event.payload.event.session.sessionId);
        }
        if (
          event.payload.type === "agent-team.status" &&
          !knownAgentTeamTabs.current.has(event.payload.teamId)
        ) {
          const teamStatus = event.payload;
          knownAgentTeamTabs.current.add(teamStatus.teamId);
          setWorkspaceTabsByThread((current) => ({
            ...current,
            [event.threadId]: reconcileAgentTeamWorkspaceTab(
              current[event.threadId] ?? emptyWorkspaceTabs(),
              agentTeamWorkspaceTab(
                teamStatus.teamId,
                appCopy(localeRef.current).agentTeam,
              ),
            ),
          }));
        }
        if (event.payload.type === "turn.started") {
          setTurnFailureNotices((current) =>
            reduceTurnFailureNotices(current, {
              type: "started",
              threadId: event.threadId,
            }),
          );
        }
        if (event.payload.type === "turn.failed") {
          finishedThreadIds.add(event.threadId);
          const copy = appCopy(localeRef.current);
          const message = `${copy.turnError} ${localizedTurnFailure(
            copy,
            event.payload.message,
            event.payload.code,
          )}`;
          setTurnFailureNotices((current) =>
            reduceTurnFailureNotices(current, {
              type: "failed",
              threadId: event.threadId,
              message,
            }),
          );
        }
        if (event.payload.type === "turn.completed") {
          finishedThreadIds.add(event.threadId);
        }
        if (
          event.payload.type === "queue.recovered" &&
          !recoveredQueueEventIds.current.has(event.eventId)
        ) {
          const recoveredItems =
            event.payload.items ??
            event.payload.messages.map((text) => ({ text }));
          recoveredQueueEventIds.current.add(event.eventId);
          setComposerDrafts((current) =>
            restoreComposerQueueItems(
              current,
              conversationDraftKey(undefined, event.threadId),
              recoveredItems,
            ),
          );
        }
      }
      if (finishedThreadIds.size > 0) {
        setLiveChildActivities((current) => {
          const next = { ...current };
          for (const threadId of finishedThreadIds) delete next[threadId];
          return next;
        });
      }
      pendingAgentEvents.current.push(...events);
      if (pendingAgentFrame.current === undefined) {
        pendingAgentFrame.current =
          window.requestAnimationFrame(flushAgentEvents);
      }
    };
    const unsubscribe = window.artemis.onAgentEvent((event) => {
      receiveAgentEvents([event]);
    });
    const unsubscribeBatch = window.artemis.onAgentEvents(receiveAgentEvents);
    const unsubscribeTitles = window.artemis.onThreadTitleUpdated?.(
      ({ id, title }) => {
        setSnapshot((current) =>
          current
            ? {
                ...current,
                threads: current.threads.map((thread) =>
                  thread.id === id ? { ...thread, title } : thread,
                ),
              }
            : current,
        );
      },
    );
    const unsubscribeImTasks = window.artemis.onImTaskCreated?.((thread) => {
      setSnapshot((current) =>
        current
          ? {
              ...current,
              threads: current.threads.some(
                (candidate) => candidate.id === thread.id,
              )
                ? current.threads.map((candidate) =>
                    candidate.id === thread.id ? thread : candidate,
                  )
                : [thread, ...current.threads],
            }
          : current,
      );
    });
    const unsubscribeActivities = window.artemis.onAgentActivities(
      (events: AgentHostEvent[]) => {
        setLiveChildActivities((current) => {
          const next = { ...current };
          for (const event of events) {
            if (
              event.payload.type !== "child-agent.status" ||
              !event.payload.activityDelta
            ) {
              continue;
            }
            const threadActivities = {
              ...(next[event.threadId] ?? {}),
            };
            const previous = threadActivities[event.payload.agentId];
            threadActivities[event.payload.agentId] = {
              activity:
                `${previous?.activity ?? ""}${event.payload.activityDelta}`.slice(
                  -64 * 1024,
                ),
              payload: event.payload,
            };
            next[event.threadId] = threadActivities;
          }
          return next;
        });
      },
    );
    return () => {
      mounted = false;
      unsubscribeMaterial?.();
      unsubscribe();
      unsubscribeBatch();
      unsubscribeImTasks?.();
      unsubscribeTitles?.();
      unsubscribeActivities();
      if (pendingAgentFrame.current !== undefined) {
        window.cancelAnimationFrame(pendingAgentFrame.current);
        pendingAgentFrame.current = undefined;
      }
      pendingAgentEvents.current = [];
    };
  }, []);

  const [computerBrowserThread, setComputerBrowserThread] = useState<string>();
  useEffect(
    () =>
      window.artemis.onComputerPreviewExpand?.((state) => {
        if (state.target.kind !== "browser" || !state.tabId) return;
        setWorkspaceTabsByThread((current) => {
          const existing = current[state.threadId] ?? emptyWorkspaceTabs();
          const tab = existing.tabs.find(
            (value) => value.id === state.tabId,
          ) ?? {
            id: state.tabId!,
            kind: "browser" as const,
            title: state.target.name,
          };
          return {
            ...current,
            [state.threadId]: {
              ...reduceWorkspaceTabs(existing, { type: "open", tab }),
              dockOpen: true,
            },
          };
        });
        if (state.threadId !== activeThreadId)
          void openAutomationThread(state.threadId);
      }),
    [activeThreadId, openAutomationThread],
  );
  useEffect(
    () =>
      window.artemis.onComputerBrowserOpen?.((threadId) => {
        setComputerBrowserThread(threadId);
        if (threadId !== activeThreadId) void openAutomationThread(threadId);
      }),
    [activeThreadId, openAutomationThread],
  );
  useEffect(() => {
    if (computerBrowserThread && computerBrowserThread === activeThreadId) {
      openBrowserPanel();
      setComputerBrowserThread(undefined);
    }
  }, [computerBrowserThread, activeThreadId, openBrowserPanel]);

  useEffect(
    () =>
      window.artemis.onThreadLinkOpen((id) => {
        if (id) {
          linkOpenedThread.current = id;
          void openAutomationThread(id);
        } else
          setToast({
            error: true,
            message: uiText(locale, "Review06.taskNotFound"),
          });
      }),
    [openAutomationThread, locale],
  );

  useEffect(
    () =>
      window.artemis.onAutomationThreadOpen((threadId) => {
        void openAutomationThread(threadId);
      }),
    [openAutomationThread],
  );

  useEffect(
    () =>
      window.artemis.onAutomationEvent((event) => {
        if (
          event.payload.type !== "automation-run.upserted" ||
          !event.payload.run.threadId
        ) {
          return;
        }
        void window.artemis.getSnapshot().then((refreshed) => {
          setSnapshot((current) => preserveLoadedEvents(refreshed, current));
        });
      }),
    [],
  );

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
  useEffect(() => {
    if (!activeThreadId) return;
    if (linkOpenedThread.current === activeThreadId) {
      linkOpenedThread.current = undefined;
      return;
    }
    void window.artemis.prepareThread(activeThreadId).catch(() => {
      // Starting the turn reports an actionable error if background warming failed.
    });
  }, [activeThreadId]);
  useEffect(() => {
    if (
      !activeThreadId ||
      loadedEventThreads.current.has(activeThreadId) ||
      loadingEventThreads.current.has(activeThreadId) ||
      historyLoadErrors[activeThreadId] !== undefined
    ) {
      return;
    }
    const threadId = activeThreadId;
    loadingEventThreads.current.add(threadId);
    if (window.artemis.getThreadHistory) {
      void window.artemis
        .getThreadHistory(threadId)
        .then((page) => {
          loadedEventThreads.current.add(threadId);
          setHistoryPages((current) => ({ ...current, [threadId]: page }));
          setSnapshot((current) =>
            current
              ? {
                  ...current,
                  events: {
                    ...current.events,
                    [threadId]: mergeThreadEvents(
                      page.events,
                      (current.events[threadId] ?? []).filter(
                        (event) => event.seq > page.state.lastSeq,
                      ),
                    ),
                  },
                }
              : current,
          );
        })
        .catch((error) => {
          console.error(
            "[thread-history] history page load failed",
            threadId,
            error instanceof Error ? error.message : String(error),
          );
          setHistoryLoadErrors((current) => ({
            ...current,
            [threadId]: true,
          }));
        })
        .finally(() => loadingEventThreads.current.delete(threadId));
      return;
    }
    void window.artemis
      .getThreadEvents(threadId)
      .then((history) => {
        loadedEventThreads.current.add(threadId);
        setSnapshot((current) => {
          if (!current) return current;
          return {
            ...current,
            events: {
              ...current.events,
              [threadId]: mergeThreadEvents(
                history,
                current.events[threadId] ?? [],
              ),
            },
          };
        });
      })
      .catch((error) => {
        console.error(
          "[thread-history] thread events load failed",
          threadId,
          error instanceof Error ? error.message : String(error),
        );
        setHistoryLoadErrors((current) => ({
          ...current,
          [threadId]: true,
        }));
      })
      .finally(() => {
        loadingEventThreads.current.delete(threadId);
      });
  }, [activeThreadId, historyRetry]);
  const activeHistoryPending = Boolean(
    activeThreadId && !loadedEventThreads.current.has(activeThreadId),
  );
  const activeHistoryError = activeThreadId
    ? historyLoadErrors[activeThreadId]
    : undefined;
  const activeHistory = activeThreadId
    ? historyPages[activeThreadId]
    : undefined;
  const loadEarlierHistory = useCallback(() => {
    const threadId = activeThreadId;
    const page = threadId ? historyPages[threadId] : undefined;
    if (!threadId || !page?.cursor || loadingHistoryPages.current.has(threadId))
      return;
    loadingHistoryPages.current.add(threadId);
    void window.artemis
      .getThreadHistory(threadId, page.cursor)
      .then((earlier) => {
        if (activeThreadIdRef.current === threadId) {
          const element = timelineScroll.current?.querySelector(
            "[data-history-turn]",
          );
          if (element)
            historyPrependAnchor.current = {
              threadId,
              element,
              top: element.getBoundingClientRect().top,
            };
        }
        setHistoryPages((current) =>
          current[threadId] === page
            ? { ...current, [threadId]: mergeHistoryPage(page, earlier) }
            : current,
        );
      })
      .catch((error) =>
        setToast(error instanceof Error ? error.message : String(error)),
      )
      .finally(() => loadingHistoryPages.current.delete(threadId));
  }, [activeThreadId, historyPages]);
  useLayoutEffect(() => {
    const anchor = historyPrependAnchor.current;
    if (
      anchor &&
      anchor.threadId === activeThreadId &&
      timelineScroll.current
    ) {
      timelineScroll.current.scrollTop +=
        anchor.element.getBoundingClientRect().top - anchor.top;
      historyPrependAnchor.current = undefined;
    }
  }, [activeHistory, activeThreadId]);
  const activeEvents = activeThread
    ? (snapshot?.events[activeThread.id] ?? [])
    : [];
  useTaskNotificationRead(
    activeView === "workspace" &&
      activeThreadId &&
      loadedEventThreads.current.has(activeThreadId)
      ? activeThreadId
      : undefined,
    activeThread?.notification?.unread &&
      Math.max(
        activeHistory?.state.lastSeq ?? -1,
        activeEvents.at(-1)?.seq ?? -1,
      ) >= activeThread.notification.seq
      ? activeThread.notification.seq
      : undefined,
    workspaceDockOpen,
  );
  const latestHtmlChange = useMemo(() => {
    for (let index = activeEvents.length - 1; index >= 0; index -= 1) {
      const event = activeEvents[index];
      if (
        event?.payload.type === "file.changed" &&
        /\.html?$/iu.test(event.payload.path)
      ) {
        return { eventId: event.eventId, path: event.payload.path };
      }
    }
    return undefined;
  }, [activeEvents]);
  const latestMarkdownChange = useMemo(() => {
    for (let index = activeEvents.length - 1; index >= 0; index -= 1) {
      const event = activeEvents[index];
      if (
        event?.payload.type === "file.changed" &&
        /\.(?:md|markdown)$/iu.test(event.payload.path)
      ) {
        return { eventId: event.eventId, path: event.payload.path };
      }
    }
    return undefined;
  }, [activeEvents]);
  const threadState = useMemo(() => {
    if (!activeThread) return undefined;
    const cached = threadStateCache.current.get(activeThread.id);
    const prefixMatches =
      cached &&
      cached.history === activeHistory &&
      cached.mode === activeThread.mode &&
      cached.eventCount <= activeEvents.length &&
      (cached.eventCount === 0 ||
        activeEvents[cached.eventCount - 1]?.eventId === cached.lastEventId);
    const state = prefixMatches
      ? reduceAgentEventBatch(
          cached.state,
          activeEvents
            .slice(cached.eventCount)
            .filter(
              (event) =>
                !activeHistory || event.seq > activeHistory.state.lastSeq,
            ),
        )
      : activeHistory
        ? reduceAgentEventBatch(
            activeHistory.state,
            activeEvents.filter(
              (event) => event.seq > activeHistory.state.lastSeq,
            ),
          )
        : reduceAgentEvents(activeThread.id, activeEvents, activeThread.mode);
    // Guard against cross-switch derivation regressions (blank or shrunken
    // timelines): if this thread rendered more turns before, re-derive once
    // from the raw history page + events instead of trusting the incremental
    // or cached path.
    const turnWatermark =
      cached?.history === activeHistory
        ? (turnWatermarks.current.get(activeThread.id) ?? 0)
        : 0;
    let guardedState = state;
    if (state.order.length < turnWatermark) {
      guardedState = activeHistory
        ? reduceAgentEventBatch(
            activeHistory.state,
            activeEvents.filter(
              (event) => event.seq > activeHistory.state.lastSeq,
            ),
          )
        : reduceAgentEvents(activeThread.id, activeEvents, activeThread.mode);
      if (guardedState.order.length < turnWatermark) {
        console.error(
          "[thread-history] derived turns regressed below the session watermark",
          activeThread.id,
          turnWatermark,
          guardedState.order.length,
        );
      }
    }
    turnWatermarks.current.set(
      activeThread.id,
      Math.max(turnWatermark, guardedState.order.length),
    );
    for (const recovered of Object.values(officeSnapshots)) {
      const id = recovered.session.sessionId;
      const current = guardedState.artifacts?.[id];
      if (
        current?.needsSnapshot &&
        recovered.session.sequence >= current.session.sequence
      ) {
        guardedState = {
          ...guardedState,
          artifacts: {
            ...guardedState.artifacts,
            [id]: restoreArtifactSnapshot(current, recovered),
          },
        };
      }
    }
    threadStateCache.current.delete(activeThread.id);
    threadStateCache.current.set(activeThread.id, {
      ...(activeHistory ? { history: activeHistory } : {}),
      eventCount: activeEvents.length,
      ...(activeEvents.at(-1)
        ? { lastEventId: activeEvents.at(-1)!.eventId }
        : {}),
      mode: activeThread.mode,
      state: guardedState,
    });
    const liveActivities = liveChildActivities[activeThread.id];
    if (!liveActivities) return guardedState;
    const childAgents = { ...guardedState.childAgents };
    for (const [agentId, live] of Object.entries(liveActivities)) {
      const current = childAgents[agentId];
      if (!current) continue;
      const merged: ChildAgentState = {
        ...current,
        activity: live.activity,
        ...(live.payload.health ? { health: live.payload.health } : {}),
        ...(live.payload.lastActivityAt
          ? { lastActivityAt: live.payload.lastActivityAt }
          : {}),
      };
      if (
        current.status === "queued" ||
        current.status === "running" ||
        current.status === "cancelling"
      ) {
        if (live.payload.currentTool) {
          merged.currentTool = live.payload.currentTool;
        } else {
          delete merged.currentTool;
        }
        if (live.payload.currentToolStartedAt) {
          merged.currentToolStartedAt = live.payload.currentToolStartedAt;
        } else {
          delete merged.currentToolStartedAt;
        }
      }
      childAgents[agentId] = merged;
    }
    return { ...guardedState, childAgents };
  }, [
    activeEvents,
    activeHistory,
    officeSnapshots,
    activeThread?.id,
    activeThread?.mode,
    liveChildActivities,
  ]);
  const openedOfficeTabs = useRef(new Set<string>());
  const liveOfficeTabs = useRef(new Set<string>());
  useEffect(() => {
    if (!activeThreadId || !threadState) return;
    // History pages retain artifact state but omit raw artifact presentation events.
    const sessions = Object.values(threadState.artifacts ?? {})
      .map((view) => view.session)
      .filter(
        (session) =>
          session.status !== "closed" &&
          !openedOfficeTabs.current.has(session.sessionId),
      );
    if (!sessions.length) return;
    for (const session of sessions)
      openedOfficeTabs.current.add(session.sessionId);
    setWorkspaceTabsByThread((current) => {
      let state = current[activeThreadId] ?? emptyWorkspaceTabs();
      for (const session of sessions) {
        const live = liveOfficeTabs.current.delete(session.sessionId);
        const next = reconcileOfficeWorkspaceTab(state, session, live);
        state = live && next !== state ? { ...next, dockOpen: true } : next;
      }
      return state === current[activeThreadId]
        ? current
        : { ...current, [activeThreadId]: state };
    });
  }, [activeThreadId, threadState]);
  const activePromptHistory = useMemo(() => {
    if (!threadState?.order.length) {
      return promptHistoryForConversation(promptHistory, undefined);
    }
    const conversationMessages = threadState.order.flatMap((entry) => {
      const separator = entry.indexOf(":");
      if (entry.slice(0, separator) !== "user") return [];
      const message = threadState.userMessages[entry.slice(separator + 1)];
      return message ? [message.text] : [];
    });
    return promptHistoryForConversation(promptHistory, conversationMessages);
  }, [promptHistory, threadState]);
  const latestAgentTeam = useMemo(
    () =>
      Object.values(threadState?.agentTeams ?? {})
        .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
        .at(-1),
    [threadState?.agentTeams],
  );
  const environmentAgents = useMemo(
    () => sortAgentsByActivity(Object.values(threadState?.childAgents ?? {})),
    [threadState?.childAgents],
  );
  const environmentTeams = useMemo(
    () => Object.values(threadState?.agentTeams ?? {}),
    [threadState?.agentTeams],
  );
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
  const activeSelection =
    pendingModelSelection ??
    activeThread?.modelSelection ??
    runtimeSettings?.selection;
  const activeModel = activeSelection
    ? runtimeSettings?.models.find(
        (model) =>
          model.providerId === activeSelection.providerId &&
          model.modelId === activeSelection.modelId,
      )
    : undefined;
  const activeProvider = activeSelection
    ? runtimeSettings?.providers.find(
        (provider) => provider.id === activeSelection.providerId,
      )
    : undefined;
  const activeProviderModel = activeProvider?.models.find(
    (model) => model.id === activeSelection?.modelId,
  );
  const activeModelLabel =
    activeModel?.name ??
    activeProviderModel?.name ??
    activeSelection?.modelId ??
    t.model;
  const activeModelSupportsReasoning =
    activeModel?.reasoning ?? activeProviderModel?.reasoning ?? false;
  const activeUltraMode =
    activeModelSupportsReasoning && activeSelection?.ultraMode === true;
  const activeThinkingLevel = activeUltraMode
    ? uiText(locale, "Review06.ultra")
    : activeSelection &&
        activeModelSupportsReasoning &&
        activeSelection.thinkingLevel !== "off"
      ? thinkingLevelLabel(activeSelection.thinkingLevel, locale)
      : undefined;
  const switchableModels = useMemo(() => {
    if (!runtimeSettings) return [];
    const addedModels = new Set(
      runtimeSettings.addedModels.map((model) =>
        modelIdentity(model.providerId, model.modelId),
      ),
    );
    const customProviders = new Set(
      runtimeSettings.providers.map((provider) => provider.id),
    );
    const selectedModelIdentity = activeSelection
      ? modelIdentity(activeSelection.providerId, activeSelection.modelId)
      : undefined;
    return runtimeSettings.models
      .filter((model) => {
        const identity = modelIdentity(model.providerId, model.modelId);
        return (
          addedModels.has(identity) ||
          customProviders.has(model.providerId) ||
          identity === selectedModelIdentity
        );
      })
      .sort(
        (left, right) =>
          left.name.localeCompare(right.name, locale) ||
          left.providerId.localeCompare(right.providerId, locale),
      );
  }, [activeSelection, locale, runtimeSettings]);
  const filteredModels = useMemo(() => {
    const query = modelFilter.trim().toLocaleLowerCase(locale);
    return switchableModels.filter((model) =>
      [model.name, model.modelId, model.providerId].some((value) =>
        value.toLocaleLowerCase(locale).includes(query),
      ),
    );
  }, [switchableModels, modelFilter, locale]);
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

  const switchComposerModel = useCallback(
    async (model: SettingsSnapshot["models"][number]) => {
      if (!runtimeSettings || turnActive || busy || pendingModelSelection)
        return;
      const nextSelection = selectionForModelSwitch(model, activeSelection);
      setPendingModelSelection(nextSelection);
      try {
        const thread =
          activeThread ?? (await createThread(activeProjectId, true));
        if (!thread) return;
        const updated = await window.artemis.setThreadModelSelection(
          thread.id,
          nextSelection,
        );
        setRuntimeSettings((current) =>
          current
            ? {
                ...current,
                selection: updated.modelSelection ?? nextSelection,
                ...(updated.contextWindow !== undefined
                  ? { contextWindow: updated.contextWindow }
                  : {}),
              }
            : current,
        );
        setSnapshot((current) =>
          current
            ? {
                ...current,
                threads: current.threads.map((candidate) =>
                  candidate.id === updated.id ? updated : candidate,
                ),
              }
            : current,
        );
      } catch (error) {
        setToast(
          `${t.modelSwitchFailed} ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        setPendingModelSelection(undefined);
      }
    },
    [
      activeProjectId,
      activeSelection,
      activeThread,
      busy,
      createThread,
      pendingModelSelection,
      runtimeSettings,
      t.modelSwitchFailed,
      turnActive,
    ],
  );

  const switchComposerThinking = useCallback(
    async (thinkingLevel: ThinkingLevel, ultraMode = false) => {
      if (!activeSelection || turnActive || busy || pendingModelSelection)
        return;
      const nextSelection = {
        ...activeSelection,
        thinkingLevel,
        ultraMode,
      };
      setPendingModelSelection(nextSelection);
      try {
        const thread =
          activeThread ?? (await createThread(activeProjectId, true));
        if (!thread) return;
        const updated = await window.artemis.setThreadModelSelection(
          thread.id,
          nextSelection,
        );
        setRuntimeSettings((current) =>
          current
            ? {
                ...current,
                selection: updated.modelSelection ?? nextSelection,
                ...(updated.contextWindow !== undefined
                  ? { contextWindow: updated.contextWindow }
                  : {}),
              }
            : current,
        );
        setSnapshot((current) =>
          current
            ? {
                ...current,
                threads: current.threads.map((candidate) =>
                  candidate.id === updated.id ? updated : candidate,
                ),
              }
            : current,
        );
      } catch (error) {
        setToast(
          `${t.modelSwitchFailed} ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        setPendingModelSelection(undefined);
      }
    },
    [
      activeProjectId,
      activeSelection,
      activeThread,
      busy,
      createThread,
      pendingModelSelection,
      t.modelSwitchFailed,
      turnActive,
    ],
  );
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

  useLayoutEffect(() => {
    if (!activeThreadId || activeView !== "workspace") {
      timelinePinned.current = true;
      pendingTimelineRestore.current = undefined;
      return;
    }
    const snapshot = timelineScrollSnapshots.current.get(activeThreadId);
    timelinePinned.current = snapshot?.pinned ?? true;
    pendingTimelineRestore.current = prepareTimelineRestore(
      activeThreadId,
      activeView,
      snapshot,
    );
  }, [activeThreadId, activeView]);

  useLayoutEffect(() => {
    const pending = pendingTimelineRestore.current;
    if (
      !activeThreadId ||
      activeView !== "workspace" ||
      pending?.threadId !== activeThreadId ||
      !loadedEventThreads.current.has(activeThreadId)
    ) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      if (activeThreadIdRef.current !== activeThreadId) return;
      const container = timelineScroll.current;
      if (!container) return;
      timelinePinned.current = pending.snapshot?.pinned ?? true;
      pendingTimelineRestore.current = undefined;
      container.scrollTop = resolveTimelineScrollTarget({
        clientHeight: container.clientHeight,
        scrollHeight: container.scrollHeight,
        ...(pending.snapshot ? { snapshot: pending.snapshot } : {}),
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeEvents.length, activeThreadId, activeView, threadState?.lastSeq]);

  useLayoutEffect(() => {
    const container = timelineScroll.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (timelinePinned.current) container.scrollTop = container.scrollHeight;
    });
    observer.observe(container);
    for (const child of container.children) observer.observe(child);
    return () => observer.disconnect();
  }, [activeEvents.length, activeThreadId]);

  useEffect(() => {
    const finishScrollbarInteraction = () => {
      timelineScrollbarPointerActive.current = false;
    };
    window.addEventListener("pointerup", finishScrollbarInteraction);
    window.addEventListener("pointercancel", finishScrollbarInteraction);
    return () => {
      window.removeEventListener("pointerup", finishScrollbarInteraction);
      window.removeEventListener("pointercancel", finishScrollbarInteraction);
    };
  }, []);

  useEffect(() => {
    if (!timelinePinned.current) return;
    const frame = window.requestAnimationFrame(() => {
      const container = timelineScroll.current;
      if (container) container.scrollTop = container.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [threadState?.lastSeq]);

  useEffect(() => {
    if (reviewScopeThreadId.current === activeThreadId) return;
    reviewScopeThreadId.current = activeThreadId;
    reviewRequestId.current += 1;
    setReviewScope("branch");
    setReviewTurnId(undefined);
    setReviewDiff(undefined);
    setSelectedReviewFilePath(undefined);
    setCommentLineId(undefined);
    setCommentBody("");
  }, [activeThreadId]);

  // Completed turn diffs are immutable; live output must not reload them.
  const reviewLiveSequence =
    reviewScope === "turn" ? 0 : (threadState?.lastSeq ?? 0);
  const reviewChangedFileCount =
    reviewScope === "turn" ? 0 : (threadState?.changedFiles.length ?? 0);
  const reviewDiffCacheKey = useCallback(
    (threadId: string, scope: ReviewScope) => {
      const baseRef = scope === "branch" ? reviewBaseRef.trim() : "";
      const turnId = scope === "turn" ? (reviewTurnId ?? "") : "";
      const version = reviewDiffVersion.current.get(threadId) ?? 0;
      const sequence = scope === "turn" ? 0 : reviewLiveSequence;
      return `${threadId}\u0000${scope}\u0000${turnId}\u0000${baseRef}\u0000${sequence}\u0000${version}`;
    },
    [reviewBaseRef, reviewTurnId, reviewLiveSequence],
  );

  const loadCachedReviewDiff = useCallback(
    (threadId: string, scope: ReviewScope, force = false) => {
      const cacheKey = reviewDiffCacheKey(threadId, scope);
      const cached = reviewDiffCache.current.get(cacheKey);
      if (!force && cached) return Promise.resolve(cached);
      const inFlight = reviewDiffInFlight.current.get(cacheKey);
      if (inFlight) return inFlight;

      const request = window.artemis
        .getReviewDiff({
          threadId,
          scope,
          ...(scope === "turn" && reviewTurnId ? { turnId: reviewTurnId } : {}),
          ...(scope === "branch" && reviewBaseRef.trim()
            ? { baseRef: reviewBaseRef.trim() }
            : {}),
        })
        .then((diff) => {
          reviewDiffCache.current.set(cacheKey, diff);
          if (reviewDiffCache.current.size > 16) {
            const oldestKey = reviewDiffCache.current.keys().next().value;
            if (oldestKey) reviewDiffCache.current.delete(oldestKey);
          }
          return diff;
        })
        .finally(() => {
          reviewDiffInFlight.current.delete(cacheKey);
        });
      reviewDiffInFlight.current.set(cacheKey, request);
      return request;
    },
    [reviewBaseRef, reviewDiffCacheKey, reviewTurnId],
  );

  const invalidateReviewDiffCache = useCallback((threadId: string) => {
    reviewDiffVersion.current.set(
      threadId,
      (reviewDiffVersion.current.get(threadId) ?? 0) + 1,
    );
    const prefix = `${threadId}\u0000`;
    for (const key of reviewDiffCache.current.keys()) {
      if (key.startsWith(prefix)) reviewDiffCache.current.delete(key);
    }
  }, []);

  const refreshDiff = useCallback(
    async (force = false) => {
      const requestId = ++reviewRequestId.current;
      if (!activeThreadId) {
        setReviewDiff({
          available: true,
          scope: reviewScope,
          text: "",
          files: [],
        });
        setReviewComments([]);
        return;
      }

      void window.artemis
        .listReviewComments(activeThreadId)
        .then((comments) => {
          if (requestId !== reviewRequestId.current) return;
          setReviewComments(comments);
        })
        .catch((error) => {
          if (requestId !== reviewRequestId.current) return;
          setToast(error instanceof Error ? error.message : String(error));
        });

      try {
        const diff = await loadCachedReviewDiff(
          activeThreadId,
          reviewScope,
          force,
        );
        if (requestId !== reviewRequestId.current) return;
        startReviewTransition(() => {
          setReviewDiff(diff);
        });
        return diff;
      } catch (error) {
        if (requestId !== reviewRequestId.current) return;
        setReviewDiff({
          available: false,
          scope: reviewScope,
          text: "",
          files: [],
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [activeThreadId, loadCachedReviewDiff, reviewScope],
  );

  const selectReviewScope = (scope: ReviewScope) => {
    if (scope === reviewScope) return;
    reviewRequestId.current += 1;
    setReviewScope(scope);
    if (scope !== "turn") setReviewTurnId(undefined);
    const cached = activeThreadId
      ? reviewDiffCache.current.get(reviewDiffCacheKey(activeThreadId, scope))
      : undefined;
    setReviewDiff(cached);
    setSelectedReviewFilePath(undefined);
    setCommentLineId(undefined);
    setCommentBody("");
  };

  const openReviewScopePanel = (scope: ReviewScope, baseRef?: string) => {
    if (scope === "branch" && baseRef) setReviewBaseRef(baseRef);
    selectReviewScope(scope);
    openReviewPanel();
  };

  const openReviewTurnPanel = useCallback(
    (turnId: string, path?: string) => {
      if (reviewScope !== "turn" || reviewTurnId !== turnId) {
        reviewRequestId.current += 1;
        setReviewDiff(undefined);
      }
      setReviewTurnId(turnId);
      setReviewScope("turn");
      setSelectedReviewFilePath(path);
      setCommentLineId(undefined);
      setCommentBody("");
      openReviewPanel();
    },
    [openReviewPanel, reviewScope, reviewTurnId],
  );

  const undoTurnChanges = useCallback(
    async (turnId: string) => {
      if (
        !activeThreadId ||
        !(await requestConfirmation(t.undoTurnConfirm, "danger"))
      ) {
        return;
      }
      try {
        const result = await window.artemis.undoTurnChanges(
          activeThreadId,
          turnId,
        );
        invalidateReviewDiffCache(activeThreadId);
        setToast(
          `${t.undoTurnComplete} · ${result.restoredFiles.length} · ${result.recoveryPath}`,
        );
      } catch (error) {
        setToast(error instanceof Error ? error.message : String(error));
      }
    },
    [
      activeThreadId,
      invalidateReviewDiffCache,
      requestConfirmation,
      t.undoTurnComplete,
      t.undoTurnConfirm,
    ],
  );

  useEffect(() => {
    if (workspaceDockOpen && activeWorkspaceTab?.kind === "review") {
      void refreshDiff();
    }
  }, [
    activeWorkspaceTab?.kind,
    refreshDiff,
    reviewChangedFileCount,
    workspaceDockOpen,
  ]);

  useEffect(() => {
    if (
      !activeThreadId ||
      !activeProject ||
      !workspaceDockOpen ||
      activeWorkspaceTab?.kind !== "review"
    )
      return;
    let active = true;
    void window.artemis
      .getProjectGitInfo(activeProject.id, activeThreadId)
      .then((info) => {
        if (active)
          setReviewCounts({
            threadId: activeThreadId,
            staged: info.stagedCount,
            unstaged: info.unstagedCount,
          });
      })
      .catch(() => {
        if (active) setReviewCounts(undefined);
      });
    return () => {
      active = false;
    };
  }, [
    activeThreadId,
    activeProject?.id,
    workspaceDockOpen,
    activeWorkspaceTab?.kind,
    reviewDiff,
  ]);
  const reviewCount = (scope: ReviewScope) =>
    reviewDiff?.scope === scope && reviewDiff.available
      ? reviewDiff.files.length
      : reviewCounts?.threadId === activeThreadId &&
          (scope === "staged" || scope === "unstaged")
        ? reviewCounts?.[scope]
        : undefined;

  const mutateReview = useCallback(
    async (
      action: ReviewAction,
      target: { kind: "file" | "hunk"; id: string },
    ) => {
      if (!activeThreadId || reviewBusy) return;
      if (
        action === "revert" &&
        !(await requestConfirmation(t.revertConfirm, "danger"))
      )
        return;
      setReviewBusy(true);
      try {
        const result = await window.artemis.mutateReviewDiff({
          threadId: activeThreadId,
          scope: reviewScope,
          action,
          target:
            target.kind === "file"
              ? { kind: "file", id: target.id }
              : { kind: "hunk", id: target.id },
          ...(reviewScope === "branch" && reviewBaseRef.trim()
            ? { baseRef: reviewBaseRef.trim() }
            : {}),
        });
        if (result.recoveryPath) {
          setToast(`${t.recoverySaved}: ${result.recoveryPath}`);
        }
        invalidateReviewDiffCache(activeThreadId);
        await refreshDiff(true);
      } catch (error) {
        setToast(error instanceof Error ? error.message : String(error));
      } finally {
        setReviewBusy(false);
      }
    },
    [
      activeThreadId,
      invalidateReviewDiffCache,
      refreshDiff,
      requestConfirmation,
      reviewBaseRef,
      reviewBusy,
      reviewScope,
      t.recoverySaved,
      t.revertConfirm,
    ],
  );

  const saveReviewComment = useCallback(
    async (lineId: string) => {
      if (
        !activeThreadId ||
        reviewScope === "turn" ||
        !commentBody.trim() ||
        reviewBusy
      )
        return;
      setReviewBusy(true);
      try {
        const comment = await window.artemis.addReviewComment({
          threadId: activeThreadId,
          scope: reviewScope,
          lineId,
          body: commentBody.trim(),
          ...(reviewScope === "branch" && reviewBaseRef.trim()
            ? { baseRef: reviewBaseRef.trim() }
            : {}),
        });
        setReviewComments((current) => [...current, comment]);
        setCommentLineId(undefined);
        setCommentBody("");
        return comment;
      } catch (error) {
        setToast(error instanceof Error ? error.message : String(error));
      } finally {
        setReviewBusy(false);
      }
    },
    [activeThreadId, commentBody, reviewBaseRef, reviewBusy, reviewScope],
  );

  const deleteReviewComment = useCallback(
    async (comment: ReviewComment) => {
      if (!activeThreadId || reviewBusy) return;
      setReviewBusy(true);
      try {
        await window.artemis.deleteReviewComment(activeThreadId, comment.id);
        setReviewComments((current) =>
          current.filter((candidate) => candidate.id !== comment.id),
        );
      } catch (error) {
        setToast(error instanceof Error ? error.message : String(error));
      } finally {
        setReviewBusy(false);
      }
    },
    [activeThreadId, reviewBusy],
  );

  const openProject = useCallback(async () => {
    const project = await window.artemis.openProject();
    if (!project) return;
    setSnapshot((current) => {
      if (!current) return current;
      const exists = current.projects.some((item) => item.id === project.id);
      return {
        ...current,
        projects: exists ? current.projects : [project, ...current.projects],
      };
    });
    beginNewConversation(project.id);
  }, [beginNewConversation]);

  const removeProject = useCallback(
    async (project: Project) => {
      if (!(await requestConfirmation(t.removeProjectConfirm))) return;
      try {
        await window.artemis.removeProject(project.id);
        const refreshed = await window.artemis.getSnapshot();
        setSnapshot((current) => preserveLoadedEvents(refreshed, current));
        setProjectMenuId(undefined);
        if (activeProjectId !== project.id) return;

        const nextProject = refreshed.projects[0];
        const nextThread = refreshed.threads.find(
          (thread) => thread.projectId === nextProject?.id && !thread.archived,
        );
        setActiveProjectId(nextProject?.id);
        setActiveThreadId(nextThread?.id);
        setActiveView("workspace");
        if (nextThread) {
          setMode(nextThread.mode);
        } else {
          setMode("work");
        }
      } catch (error) {
        setToast(
          `${t.taskError} ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
    [activeProjectId, requestConfirmation, t.removeProjectConfirm, t.taskError],
  );

  const beginRenameThread = useCallback((thread: Thread) => {
    setThreadRename({ threadId: thread.id, title: thread.title });
    setThreadMenuId(undefined);
  }, []);

  const renameThread = useCallback(
    async (thread: Thread, draft: string) => {
      const title = draft.trim();
      setThreadRename(undefined);
      if (!title || title === thread.title) return;
      try {
        const updated = await window.artemis.renameThread(thread.id, title);
        setSnapshot((current) =>
          current
            ? {
                ...current,
                threads: current.threads.map((item) =>
                  item.id === updated.id ? updated : item,
                ),
              }
            : current,
        );
      } catch (error) {
        setToast(
          `${t.taskError} ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
    [t.taskError],
  );

  const copyTaskLink = async (id: string) => {
    setThreadMenuId(undefined);
    try {
      await navigator.clipboard.writeText(`artemis://thread/${id}`);
      setToast({
        success: true,
        message: uiText(locale, "Review06.copiedTaskLink"),
      });
    } catch (error) {
      setToast({ error: true, message: String(error) });
    }
  };

  const deleteThread = useCallback(
    async (thread: Thread, confirmed = false) => {
      if (deletingThreadIds.current.has(thread.id)) return false;
      if (
        !confirmed &&
        !(await requestConfirmation(t.deleteTaskConfirm, "danger"))
      )
        return false;
      if (deletingThreadIds.current.has(thread.id)) return;
      deletingThreadIds.current.add(thread.id);
      setThreadMenuId(undefined);
      if (!confirmed) setToast(uiText(locale, "App.inline1"));
      const siblingThreads = (snapshot?.threads ?? []).filter(
        (item) => item.projectId === thread.projectId && !item.archived,
      );
      const deletedIndex = siblingThreads.findIndex(
        (item) => item.id === thread.id,
      );
      try {
        await window.artemis.deleteThread(thread.id);
        const refreshed = await window.artemis.getSnapshot();
        const remainingThreads = refreshed.threads
          .filter((item) => item.id !== thread.id)
          .filter(
            (item) => item.projectId === thread.projectId && !item.archived,
          );
        const nextThread =
          remainingThreads[Math.min(deletedIndex, remainingThreads.length - 1)];
        loadedEventThreads.current.delete(thread.id);
        loadingEventThreads.current.delete(thread.id);
        threadStateCache.current.delete(thread.id);
        setComposerDrafts((current) =>
          clearComposerDraft(
            current,
            conversationDraftKey(thread.projectId, thread.id),
          ),
        );
        setPromptSubmittedAtByThread((current) => {
          if (!(thread.id in current)) return current;
          const next = { ...current };
          delete next[thread.id];
          return next;
        });
        setWorkspaceTabsByThread((current) => {
          const next = { ...current };
          delete next[thread.id];
          return next;
        });
        setSnapshot((current) => preserveLoadedEvents(refreshed, current));
        setToast(undefined);
        if (activeThreadId === thread.id) {
          setActiveThreadId(nextThread?.id);
          setMode(nextThread?.mode ?? "work");
          window.requestAnimationFrame(() => promptInput.current?.focus());
        }
        return true;
      } catch (error) {
        setToast({
          error: true,
          message: `${t.taskError} ${error instanceof Error ? error.message : String(error)}`,
        });
        return false;
      } finally {
        deletingThreadIds.current.delete(thread.id);
        setThreadMenuId(undefined);
      }
    },
    [
      activeThreadId,
      locale,
      requestConfirmation,
      snapshot?.threads,
      t.deleteTaskConfirm,
      t.taskError,
    ],
  );

  const projectBulkBusy = useRef(false);
  const updateProjectThreads = async (
    project: Project,
    operation: "archive" | "delete",
  ) => {
    if (projectBulkBusy.current) return;
    const threads = (snapshot?.threads ?? []).filter(
      (thread) =>
        thread.projectId === project.id &&
        (operation === "delete" || !thread.archived),
    );
    if (!threads.length) return;
    const deleting = operation === "delete";
    const message = deleting
      ? uiText(locale, "App.inline2", {
          value1: project.name,
          value2: threads.length,
        })
      : uiText(locale, "App.inline3", {
          value1: project.name,
          value2: threads.length,
        });
    projectBulkBusy.current = true;
    try {
      if (
        !(await requestConfirmation(message, deleting ? "danger" : undefined))
      )
        return;
      setProjectMenuId(undefined);
      const failed: string[] = [];
      const completed = new Set<string>();
      for (const thread of threads) {
        try {
          if (deleting) await window.artemis.deleteThread(thread.id);
          else await window.artemis.archiveThread(thread.id, true);
          completed.add(thread.id);
          if (deleting) {
            loadedEventThreads.current.delete(thread.id);
            loadingEventThreads.current.delete(thread.id);
            threadStateCache.current.delete(thread.id);
            setWorkspaceTabsByThread((current) => {
              const next = { ...current };
              delete next[thread.id];
              return next;
            });
            setComposerDrafts((current) =>
              clearComposerDraft(
                current,
                conversationDraftKey(thread.projectId, thread.id),
              ),
            );
          }
        } catch (error) {
          failed.push(
            `${thread.title}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      const refreshed = await window.artemis.getSnapshot();
      setSnapshot((current) => preserveLoadedEvents(refreshed, current));
      if (activeThreadId && completed.has(activeThreadId)) {
        const next = refreshed.threads.find(
          (thread) => thread.projectId === project.id && !thread.archived,
        );
        setActiveThreadId(next?.id);
        setMode(next?.mode ?? "work");
      }
      setToast(
        failed.length
          ? {
              error: true,
              message: `${completed.size}/${threads.length} · ${failed.join("\n")}`,
            }
          : undefined,
      );
    } catch (error) {
      setToast({ error: true, message: String(error) });
    } finally {
      projectBulkBusy.current = false;
    }
  };

  const setThreadArchived = useCallback(
    async (thread: Thread, archived: boolean, bulk = false) => {
      if (archived && !(await requestConfirmation(t.archiveConfirm))) return;
      try {
        const updated = await window.artemis.archiveThread(thread.id, archived);
        const refreshed = await window.artemis.getSnapshot();
        setSnapshot((current) => preserveLoadedEvents(refreshed, current));
        if (archived) {
          if (activeThreadId === thread.id) {
            const nextThread = refreshed.threads.find(
              (candidate) =>
                candidate.projectId === thread.projectId &&
                !candidate.archived &&
                candidate.id !== thread.id,
            );
            setActiveThreadId(nextThread?.id);
            if (nextThread) {
              setMode(nextThread.mode);
            }
          }
          setActiveView("workspace");
        } else if (!bulk) {
          setActiveView("workspace");
          setActiveProjectId(updated.projectId);
          setActiveThreadId(updated.id);
          setMode(updated.mode);
          window.requestAnimationFrame(() => promptInput.current?.focus());
        }
        return true;
      } catch (error) {
        setToast(
          `${t.taskError} ${error instanceof Error ? error.message : String(error)}`,
        );
        return false;
      } finally {
        setThreadMenuId(undefined);
      }
    },
    [activeThreadId, requestConfirmation, t.archiveConfirm, t.taskError],
  );

  const forkThread = useCallback(
    async (thread: Thread) => {
      try {
        const forked = await window.artemis.forkThread(thread.id);
        setSnapshot((current) =>
          current
            ? {
                ...current,
                threads: [forked.thread, ...current.threads],
                worktrees: forked.worktree
                  ? [forked.worktree, ...current.worktrees]
                  : current.worktrees,
                events: {
                  ...current.events,
                  [forked.thread.id]: forked.events,
                },
              }
            : current,
        );
        setActiveView("workspace");
        setActiveProjectId(forked.thread.projectId);
        setActiveThreadId(forked.thread.id);
        setMode(forked.thread.mode);
      } catch (error) {
        setToast(
          `${t.taskError} ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        setThreadMenuId(undefined);
      }
    },
    [t.taskError],
  );

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

  const addPromptAttachments = useCallback(
    (response: import("../../shared/api.js").AttachmentImportResponse) => {
      const selected = Array.isArray(response)
        ? response
        : response.attachments;
      if (!Array.isArray(response) && response.errors.length)
        setToast(response.errors.join("\n"));
      const { attachments: next, limited } = appendPromptAttachments(
        draftAttachments.current.get(activeComposerDraftKey) ?? [],
        selected,
      );
      draftAttachments.current.set(activeComposerDraftKey, next);
      setAttachments(next);
      if (limited) {
        setToast(t.attachmentLimit);
      }
    },
    [activeComposerDraftKey, setAttachments, t.attachmentLimit],
  );

  const selectPromptAttachments = useCallback(async () => {
    try {
      await pendingAttachmentReads.current.track(
        activeComposerDraftKey,
        window.artemis.selectPromptAttachments().then((selected) => {
          if (selected) addPromptAttachments(selected);
        }),
      );
    } catch (error) {
      setToast(
        `${t.taskError} ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }, [
    addPromptAttachments,
    attachments.length,
    t.attachmentLimit,
    t.taskError,
  ]);

  const handleAttachmentDragEnter = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      if (!Array.from(event.dataTransfer.types).includes("Files")) return;
      event.preventDefault();
      event.stopPropagation();
      setAttachmentDragActive(true);
    },
    [],
  );

  const handleAttachmentDragOver = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      if (!Array.from(event.dataTransfer.types).includes("Files")) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "copy";
      setAttachmentDragActive(true);
    },
    [],
  );

  const handleAttachmentDragLeave = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      const relatedTarget = event.relatedTarget;
      if (
        relatedTarget instanceof Node &&
        event.currentTarget.contains(relatedTarget)
      ) {
        return;
      }
      setAttachmentDragActive(false);
    },
    [],
  );

  const handleAttachmentDrop = useCallback(
    async (event: ReactDragEvent<HTMLDivElement>) => {
      if (!Array.from(event.dataTransfer.types).includes("Files")) return;
      event.preventDefault();
      event.stopPropagation();
      setAttachmentDragActive(false);
      const files = Array.from(event.dataTransfer.files);
      if (files.length === 0) return;
      try {
        await pendingAttachmentReads.current.track(
          activeComposerDraftKey,
          window.artemis
            .readPromptAttachments(files)
            .then(addPromptAttachments),
        );
      } catch (error) {
        setToast(
          `${t.taskError} ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
    [activeComposerDraftKey, addPromptAttachments, t.taskError],
  );

  const handleAttachmentPaste = useCallback(
    async (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
      const files = Array.from(event.clipboardData.files);
      if (files.length === 0) return;
      event.preventDefault();
      try {
        await pendingAttachmentReads.current.track(
          activeComposerDraftKey,
          window.artemis
            .readPromptAttachments(files)
            .then(addPromptAttachments),
        );
      } catch (error) {
        setToast(
          `${t.taskError} ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
    [activeComposerDraftKey, addPromptAttachments, t.taskError],
  );

  const changeApprovalPolicy = useCallback(
    async (policy: ApprovalPolicy) => {
      if (approvalChangeLocked) return;
      setApprovalMenuOpen(false);
      try {
        const settings = await window.artemis.setApprovalPolicy(policy);
        setApprovalPolicy(settings.approvalPolicy);
      } catch (error) {
        setToast(
          `${t.taskError} ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
    [approvalChangeLocked, t.taskError],
  );

  const updateThreadInSnapshot = useCallback((updated: Thread) => {
    setSnapshot((current) =>
      current
        ? {
            ...current,
            threads: current.threads.map((thread) =>
              thread.id === updated.id ? updated : thread,
            ),
          }
        : current,
    );
  }, []);

  const selectComposerCommand = useCallback(
    (value: string) => {
      setPrompt((current) => {
        const next = replaceActiveSlashCommand(current, value);
        promptHistoryNavigation.current = { index: -1, draft: next };
        return next;
      });
      setSkillMenuDismissed(true);
      window.requestAnimationFrame(() => promptInput.current?.focus());
    },
    [setPrompt],
  );

  const selectSkillCommand = useCallback(
    (skill: InstalledSkill) => {
      setSelectedComposerSkillNames((current) =>
        current.includes(skill.name) ? current : [...current, skill.name],
      );
      setPrompt((current) => {
        const next = replaceActiveSlashCommand(current, "").trimEnd();
        promptHistoryNavigation.current = { index: -1, draft: next };
        return next;
      });
      setSkillMenuDismissed(true);
      window.requestAnimationFrame(() => promptInput.current?.focus());
    },
    [setPrompt, setSelectedComposerSkillNames],
  );

  const removeSelectedSkill = useCallback(
    (skillName: string) => {
      setSelectedComposerSkillNames((current) =>
        current.filter((name) => name !== skillName),
      );
      window.requestAnimationFrame(() => promptInput.current?.focus());
    },
    [setSelectedComposerSkillNames],
  );

  const clearSubmittedPrompt = useCallback(
    (submittedPrompt: string) => {
      const pending = designPanelCredentials.current.get(
        activeComposerDraftKey,
      );
      designPanelCredentials.current.delete(activeComposerDraftKey);
      if (pending)
        void window.artemis
          .discardDesignPanelCandidate(pending.credential)
          .catch(() => undefined);
      setPromptHistory((current) =>
        addPromptHistoryEntry(current, submittedPrompt),
      );
      promptHistoryNavigation.current = { index: -1, draft: "" };
      setPrompt("");
      setSelectedComposerSkillNames([]);
      setCustomAgentTasks([]);
    },
    [
      activeComposerDraftKey,
      setPrompt,
      setSelectedComposerSkillNames,
      setCustomAgentTasks,
    ],
  );

  const recordPromptSubmission = useCallback(
    (threadId: string, submittedAt: number) => {
      setPromptSubmittedAtByThread((current) => ({
        ...current,
        [threadId]: submittedAt,
      }));
    },
    [],
  );

  const selectMode = useCallback(
    async (nextMode: RunMode) => {
      try {
        if (isExecutionMode(mode) && !isExecutionMode(nextMode) && activeThread)
          await window.artemis.controlComputer("revoke-task", activeThread.id);
        setMode(nextMode);
        return true;
      } catch (error) {
        setToast({ error: true, message: String(error) });
        return false;
      }
    },
    [mode, activeThread],
  );

  const selectModeCommand = useCallback(
    async (nextMode: RunMode) => {
      if (turnActive || busy || !(await selectMode(nextMode))) return;
      setPrompt((current) => replaceActiveSlashCommand(current, "").trimEnd());
      setSkillMenuDismissed(true);
      window.requestAnimationFrame(() => promptInput.current?.focus());
    },
    [busy, turnActive, selectMode, setPrompt],
  );

  const sendPrompt = useCallback(async () => {
    if (busy || pendingModelSelection || retiredGroup) return;
    await pendingAttachmentReads.current.waitForIdle(activeComposerDraftKey);
    let pendingAttachments =
      draftAttachments.current.get(activeComposerDraftKey) ?? [];
    // 面板文档绑定（OD activeFileContext）：发送自动附上锁定页面，
    // 用户已手动附同名页时以手动为准。
    const activeBinding = designDocBindingRef.current;
    if (
      activeBinding?.html.trim() &&
      !pendingAttachments.some(
        (item) =>
          "type" in item &&
          item.type === "file" &&
          item.mimeType === "text/html" &&
          item.name === activeBinding.name,
      )
    ) {
      const merged = addDesignDocumentAttachment(pendingAttachments, {
        documentId: activeBinding.documentId,
        documentName: activeBinding.name,
        html: activeBinding.html,
      });
      if (merged) {
        pendingAttachments = merged;
        setAttachments(merged);
      }
    }
    if (customAgentTasks.some((task) => !task.text.trim())) {
      setToast({
        error: true,
        message: uiText(locale, "App.inline4"),
      });
      return;
    }
    const rawPrompt = prompt.trim();
    const panelCandidate = designPanelCredentials.current.get(
      activeComposerDraftKey,
    );
    const designPanelCredential =
      panelCandidate?.text === rawPrompt
        ? panelCandidate.credential
        : undefined;
    if (panelCandidate && !designPanelCredential) {
      designPanelCredentials.current.delete(activeComposerDraftKey);
      void window.artemis
        .discardDesignPanelCandidate(panelCandidate.credential)
        .catch(() => undefined);
    }
    const runModeCommand = parseRunModeCommand(rawPrompt);
    if (runModeCommand && runModeCommand.kind === "multiple") {
      setToast({ error: true, message: t.multipleModeCommands });
      return;
    }
    if (
      runModeCommand &&
      runModeCommand.kind === "command" &&
      turnActive &&
      runModeCommand.mode !== "plan"
    ) {
      setToast({ error: true, message: t.modeCommandWhileRunning });
      return;
    }
    const submittedMode =
      runModeCommand?.kind === "command" ? runModeCommand.mode : mode;
    const commandPrompt =
      runModeCommand?.kind === "command" ? runModeCommand.prompt : rawPrompt;
    // A @ sub-agent chip binds to a plain dispatch message. Control
    // commands (/plan, /goal, /compact, …) never carry one.
    if (
      customAgentTasks.length > 0 &&
      commandPrompt.trimStart().startsWith("/")
    ) {
      setToast({ error: true, message: t.customAgentControlConflict });
      return;
    }
    if (runModeCommand?.kind === "command") {
      if (turnActive && activeThread && !commandPrompt) {
        await window.artemis.cancelTurn(activeThread.id);
      }
      if ((!turnActive || !commandPrompt) && !(await selectMode(submittedMode)))
        return;
      if (
        !commandPrompt &&
        pendingAttachments.length === 0 &&
        selectedSkills.length === 0
      ) {
        clearSubmittedPrompt(rawPrompt);
        return;
      }
    }

    const compactMatch = commandPrompt.match(/^\/compact(?:\s+([\s\S]*))?$/iu);
    const compactInstructions = compactMatch?.[1]?.trim() || undefined;
    if (compactMatch && !activeThread) {
      setToast(t.compactRequiresTask);
      clearSubmittedPrompt(rawPrompt);
      return;
    }
    if (compactMatch && turnActive) {
      setToast(t.compactWhileRunning);
      return;
    }
    const goalCommand = parseGoalCommand(commandPrompt, locale);
    if (goalCommand?.kind === "invalid") {
      setToast({ error: true, message: goalCommand.message });
      return;
    }
    if (goalCommand?.kind === "show") {
      setToast(
        activeThread?.goal
          ? `${t.goal}: ${activeThread.goal.objective} · ${GOAL_RESOURCES[locale][activeThread.goal.status]} · ${activeThread.goal.tokensUsed}${activeThread.goal.tokenBudget === undefined ? "" : `/${activeThread.goal.tokenBudget}`} Token`
          : t.noGoal,
      );
      clearSubmittedPrompt(rawPrompt);
      return;
    }
    if (goalCommand && goalCommand.kind !== "set" && !activeThread) {
      setToast(t.noGoal);
      clearSubmittedPrompt(rawPrompt);
      return;
    }
    if (goalCommand?.kind === "edit") {
      if (!activeThread?.goal) setToast(t.noGoal);
      else openGoalEditor();
      clearSubmittedPrompt(rawPrompt);
      return;
    }
    if (goalCommand?.kind === "set" && turnActive) {
      setToast({ error: true, message: t.goalSetWhileRunning });
      return;
    }

    const visibleText =
      goalCommand?.kind === "set"
        ? goalCommand.objective
        : commandPrompt ||
          (pendingAttachments.some((item) => readOfficeAnnotations(item))
            ? officeAnnotationCopy(locale).request
            : pendingAttachments.length
              ? t.inspectAttachments
              : "");
    // 设计面板批注：消息体在发送边界拼结构化 hint（OD 的
    // messageContentWithCommentAttachments 等价物），composer 只留用户文字
    const designHint = designAnnotationDrafts.current
      .get(activeComposerDraftKey)
      ?.takeForSend() ?? { hint: "" };
    // 文档绑定说明块（OD 附件信号的设计插件等价物）
    const designBindingHint = designDocBindingRef.current
      ? buildDesignBindingHint(designDocBindingRef.current)
      : "";
    const text = goalCommand
      ? visibleText
      : promptWithSelectedSkills(visibleText, selectedSkills) +
        designHint.hint +
        designBindingHint;
    if ((!text && customAgentTasks.length === 0) || busy) return;
    const submittedAt = Date.now();
    let createdThread: Thread | undefined;
    if (compactMatch && activeThread) {
      const threadId = activeThread.id;
      clearSubmittedPrompt(rawPrompt);
      setCompactingThreadIds((current) => new Set([...current, threadId]));
      try {
        await window.artemis.compactThread(threadId, compactInstructions);
      } catch (error) {
        setToast({
          error: true,
          message: `${t.compactFailed} ${error instanceof Error ? error.message : String(error)}`,
        });
      } finally {
        setCompactingThreadIds((current) => {
          const next = new Set(current);
          next.delete(threadId);
          return next;
        });
      }
      return;
    }
    setBusy(true);
    try {
      if (goalCommand?.kind === "pause" && activeThread) {
        const updated = await window.artemis.pauseThreadGoal(activeThread.id);
        updateThreadInSnapshot(updated);
        clearSubmittedPrompt(rawPrompt);
        return;
      }
      if (goalCommand?.kind === "resume" && activeThread) {
        const updated = await window.artemis.resumeThreadGoal(activeThread.id);
        updateThreadInSnapshot(updated);
        clearSubmittedPrompt(rawPrompt);
        return;
      }
      if (goalCommand?.kind === "clear" && activeThread) {
        const updated = await window.artemis.clearThreadGoal(activeThread.id);
        updateThreadInSnapshot(updated);
        closeGoalEditor();
        clearSubmittedPrompt(rawPrompt);
        setToast(t.goalCleared);
        return;
      }

      const thread = activeThread ?? (await createThread());
      if (!thread) return;
      if (!activeThread) createdThread = thread;
      let currentThread = thread;
      if (goalCommand?.kind === "set") {
        if (
          activeThread?.goal &&
          !(await requestConfirmation(t.goalReplaceConfirm))
        ) {
          return;
        }
        if (activeThread?.goal) {
          currentThread = await window.artemis.clearThreadGoal(thread.id);
          updateThreadInSnapshot(currentThread);
          closeGoalEditor();
        }
        currentThread = await window.artemis.setThreadGoal(
          thread.id,
          goalCommand.objective,
          goalCommand.tokenBudget,
        );
        updateThreadInSnapshot(currentThread);
        setToast(t.goalSet);
      }

      if (activeThread && turnActive && submittedMode === "plan") {
        const result = await window.artemis.revisePlan({
          threadId: currentThread.id,
          text,
          ...(pendingAttachments.length
            ? { attachments: pendingAttachments }
            : {}),
        });
        updateThreadInSnapshot(result.thread);
        setMode("plan");
        clearSubmittedPrompt(rawPrompt);
        draftAttachments.current.set(activeComposerDraftKey, []);
        setAttachments([]);
        return;
      }
      if (activeThread && turnActive) {
        // Explicit @ dispatch requires an idle thread this phase; the
        // follow-up queue has no invocation-record carriage yet.
        if (customAgentTasks.length > 0) {
          setToast({ error: true, message: t.customAgentWhileRunning });
          return;
        }
        await window.artemis.followUpTurn({
          ...(designPanelCredential ? { designPanelCredential } : {}),
          threadId: currentThread.id,
          text,
          ...(pendingAttachments.length
            ? { attachments: pendingAttachments }
            : {}),
        });
        recordPromptSubmission(currentThread.id, submittedAt);
        clearSubmittedPrompt(rawPrompt);
        draftAttachments.current.set(activeComposerDraftKey, []);
        setAttachments([]);
        return;
      }
      const result = await window.artemis.startTurn({
        ...(designPanelCredential ? { designPanelCredential } : {}),
        threadId: currentThread.id,
        text,
        mode: submittedMode,
        submittedAt,
        ...(pendingAttachments.length
          ? { attachments: pendingAttachments }
          : {}),
        // The renderer mints one invocationId per submission; IPC retries
        // of this call reuse it and the store dedups by (thread, id) +
        // content fingerprint.
        ...(customAgentTasks.length > 0
          ? {
              customAgentTasks: customAgentTasks.map((task) => ({
                definitionId: task.definitionId,
                revision: task.revision,
                invocationId: crypto.randomUUID(),
                text: task.text.trim(),
              })),
            }
          : {}),
      });
      recordPromptSubmission(currentThread.id, submittedAt);
      updateThreadInSnapshot(result.thread);
      clearSubmittedPrompt(rawPrompt);
      draftAttachments.current.set(activeComposerDraftKey, []);
      setAttachments([]);
    } catch (error) {
      if (
        panelCandidate &&
        designPanelCredentials.current.get(activeComposerDraftKey) ===
          panelCandidate
      ) {
        designPanelCredentials.current.delete(activeComposerDraftKey);
        void window.artemis
          .discardDesignPanelCandidate(panelCandidate.credential)
          .catch(() => undefined);
      }
      if (createdThread) {
        const createdDraftKey = conversationDraftKey(
          createdThread.projectId,
          createdThread.id,
        );
        setComposerDrafts((current) =>
          updateComposerDraft(
            clearComposerDraft(current, activeComposerDraftKey),
            createdDraftKey,
            () => activeComposerDraft,
          ),
        );
      }
      setToast(
        `${compactMatch ? t.compactFailed : t.taskError} ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setBusy(false);
    }
  }, [
    activeThread,
    activeComposerDraft,
    activeComposerDraftKey,
    locale,
    busy,
    pendingModelSelection,
    retiredGroup,
    clearSubmittedPrompt,
    closeGoalEditor,
    selectMode,
    createThread,
    customAgentTasks,
    mode,
    openGoalEditor,
    prompt,
    recordPromptSubmission,
    selectedSkills,
    t.compactFailed,
    t.compactRequiresTask,
    t.compactWhileRunning,
    t.customAgentControlConflict,
    t.customAgentWhileRunning,
    t.goal,
    t.goalCleared,
    t.goalReplaceConfirm,
    t.goalSet,
    t.goalSetWhileRunning,
    t.inspectAttachments,
    t.modeCommandWhileRunning,
    t.multipleModeCommands,
    t.noGoal,
    t.taskError,
    turnActive,
    updateThreadInSnapshot,
    requestConfirmation,
  ]);

  // 设计面板批注自动发送：sendPrompt 的闭包读取 prompt state，必须等
  // setPrompt 真正落地再触发；期间文本被用户改动则放弃自动发送。
  useEffect(() => {
    const pending = designPanelAutoSendText.current;
    if (pending == null || pending.draftKey !== activeComposerDraftKey) return;
    if (prompt.trim() !== pending.text) {
      designPanelAutoSendText.current = null;
      const candidate = designPanelCredentials.current.get(
        activeComposerDraftKey,
      );
      designPanelCredentials.current.delete(activeComposerDraftKey);
      if (candidate)
        void window.artemis
          .discardDesignPanelCandidate(candidate.credential)
          .catch(() => undefined);
      return;
    }
    if (busy || retiredGroup) return;
    designPanelAutoSendText.current = null;
    void sendPrompt();
  }, [activeComposerDraftKey, busy, prompt, retiredGroup, sendPrompt]);

  // Review comments use the ordinary composer submission path, including
  // its run mode, follow-up queue and approval checks. Never replace a draft.
  useEffect(() => {
    const pending = reviewCommentAutoSendText.current;
    if (!pending) return;
    if (
      pending.draftKey !== activeComposerDraftKey ||
      prompt.trim() !== pending.text ||
      attachments.length > 0 ||
      selectedSkills.length > 0 ||
      customAgentTasks.length > 0
    ) {
      reviewCommentAutoSendText.current = null;
      return;
    }
    if (busy || retiredGroup) return;
    reviewCommentAutoSendText.current = null;
    void sendPrompt();
  }, [
    activeComposerDraftKey,
    attachments.length,
    busy,
    customAgentTasks.length,
    prompt,
    retiredGroup,
    selectedSkills.length,
    sendPrompt,
  ]);

  const sendReviewComment = async (lineId: string) => {
    if (
      busy ||
      retiredGroup ||
      prompt.trim() ||
      attachments.length ||
      selectedSkills.length ||
      customAgentTasks.length
    )
      return;
    const comment = await saveReviewComment(lineId);
    if (!comment || activeThreadIdRef.current !== comment.threadId) return;
    const text = `${comment.path}:${comment.newLine ?? comment.oldLine ?? 1}\n\n${comment.body}`;
    reviewCommentAutoSendText.current = {
      draftKey: activeComposerDraftKey,
      text,
    };
    setPrompt((current) => (current.trim() ? current : text));
  };

  const updateActiveGoal = useCallback(
    async (action: "pause" | "resume" | "clear") => {
      if (!activeThread || goalMutationPending) return;
      setGoalMutationPending(true);
      try {
        const updated = await (action === "pause"
          ? window.artemis.pauseThreadGoal(activeThread.id)
          : action === "resume"
            ? window.artemis.resumeThreadGoal(activeThread.id)
            : window.artemis.clearThreadGoal(activeThread.id));
        updateThreadInSnapshot(updated);
        if (action === "clear") closeGoalEditor();
      } catch (error) {
        setToast(
          `${t.taskError} ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        setGoalMutationPending(false);
      }
    },
    [
      activeThread,
      closeGoalEditor,
      goalMutationPending,
      t.taskError,
      updateThreadInSnapshot,
    ],
  );

  useEffect(() => {
    const goal = activeThread?.goal;
    if (!goal || !["paused", "blocked", "usageLimited"].includes(goal.status)) {
      return;
    }
    const key = `${goal.threadId}:${goal.goalId}`;
    if (promptedGoalResumes.current.has(key)) return;
    promptedGoalResumes.current.add(key);
    void requestConfirmation(t.goalResumeConfirm, "default", {
      acceptLabel: t.goalResumeAccept,
      cancelLabel: t.goalResumeLater,
      title: t.goalResumeTitle,
    }).then(async (confirmed) => {
      if (!confirmed) return;
      setGoalMutationPending(true);
      try {
        const updated = await window.artemis.resumeThreadGoal(goal.threadId);
        updateThreadInSnapshot(updated);
      } catch (error) {
        setToast(
          `${t.taskError} ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        setGoalMutationPending(false);
      }
    });
  }, [
    activeThread?.goal,
    requestConfirmation,
    t.goalResumeAccept,
    t.goalResumeConfirm,
    t.goalResumeLater,
    t.goalResumeTitle,
    t.taskError,
    updateThreadInSnapshot,
  ]);

  const steerQueuedMessage = useCallback(
    async (index: number) => {
      const expectedText = queuedFollowUps[index];
      if (!activeThread || busy || !expectedText) return;
      setBusy(true);
      try {
        await window.artemis.steerQueuedTurn({
          threadId: activeThread.id,
          followUpIndex: index,
          expectedFollowUp: [...queuedFollowUps],
        });
        setEditingQueuedMessage(undefined);
      } catch (error) {
        setToast(
          `${t.taskError} ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        setBusy(false);
      }
    },
    [activeThread, busy, queuedFollowUps, t.taskError],
  );

  const replaceQueuedMessages = useCallback(
    async (
      followUp: Array<{ sourceIndex: number; text: string }>,
      options?: { silent?: boolean },
    ) => {
      if (!activeThread || busy) {
        setQueuedSaveErrorDetail(null);
        return false;
      }
      setBusy(true);
      try {
        await window.artemis.replaceTurnQueue({
          threadId: activeThread.id,
          expectedFollowUp: [...queuedFollowUps],
          followUp,
        });
        setEditingQueuedMessage(undefined);
        setQueuedSaveErrorDetail(null);
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!options?.silent) {
          setToast(`${t.taskError} ${message}`);
        } else {
          setQueuedSaveErrorDetail(message);
        }
        return false;
      } finally {
        setBusy(false);
      }
    },
    [activeThread, busy, queuedFollowUps, t.taskError],
  );

  const deleteQueuedMessage = useCallback(
    (index: number) => {
      if (!queuedFollowUps[index]) return;
      return replaceQueuedMessages(
        queuedFollowUps.flatMap((text, sourceIndex) =>
          sourceIndex === index ? [] : [{ sourceIndex, text }],
        ),
      );
    },
    [queuedFollowUps, replaceQueuedMessages],
  );

  const moveQueuedMessageToFront = useCallback(
    (index: number) => {
      const message = queuedFollowUps[index];
      if (!message || index === 0) return;
      return replaceQueuedMessages([
        { sourceIndex: index, text: message },
        ...queuedFollowUps
          .map((text, sourceIndex) => ({ sourceIndex, text }))
          .filter((item) => item.sourceIndex !== index),
      ]);
    },
    [queuedFollowUps, replaceQueuedMessages],
  );

  const saveQueuedMessage = useCallback(
    (index: number, value: string) => {
      const message = value.trim();
      if (!message || !queuedFollowUps[index]) return;
      return replaceQueuedMessages(
        queuedFollowUps.map((text, sourceIndex) => ({
          sourceIndex,
          text: sourceIndex === index ? message : text,
        })),
        { silent: true },
      );
    },
    [queuedFollowUps, replaceQueuedMessages],
  );

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const modifier = event.ctrlKey || event.metaKey;
      if (event.key === "Escape") {
        setApprovalMenuOpen(false);
        setModelPickerOpen(false);
      } else if (modifier && event.altKey && event.key.toLowerCase() === "b") {
        event.preventDefault();
        toggleReviewPanel();
      } else if (modifier && event.key.toLowerCase() === "b") {
        event.preventDefault();
        changeSidebarOpen((open) => !open);
      } else if (modifier && event.key.toLowerCase() === "j") {
        event.preventDefault();
        toggleTerminalPanel();
      } else if (modifier && event.key.toLowerCase() === "k") {
        event.preventDefault();
        changeSidebarOpen(true);
        requestAnimationFrame(() => sidebarSearchInput.current?.focus());
      } else if (modifier && event.key.toLowerCase() === "n") {
        event.preventDefault();
        beginNewConversation();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    beginNewConversation,
    changeSidebarOpen,
    toggleReviewPanel,
    toggleTerminalPanel,
  ]);

  const taskShortcut = (
    event: ReactKeyboardEvent<HTMLElement>,
    thread: Thread,
  ) => {
    if (event.key === "F2") {
      event.preventDefault();
      beginRenameThread(thread);
    } else if (
      (event.metaKey || event.ctrlKey) &&
      event.key === "Backspace" &&
      thread.status !== "running" &&
      thread.status !== "waiting-approval"
    ) {
      event.preventDefault();
      void setThreadArchived(thread, true);
    }
  };

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
                      onOpenReview={openReviewPanel}
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
