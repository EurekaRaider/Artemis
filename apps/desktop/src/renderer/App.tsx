import {
  lazy,
  Suspense,
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
  type ReactNode,
  type SetStateAction,
  type UIEvent as ReactUIEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { useTranslation } from "react-i18next";
import {
  MAX_PROMPT_ATTACHMENTS,
  MAX_PROMPT_IMAGES,
  reduceAgentEventBatch,
  reduceAgentEvents,
  type AgentEvent,
  type AgentHostEvent,
  type AgentTeamMessageState,
  type AgentTeamState,
  type ApprovalPolicy,
  type ApprovalState,
  type AppLocale,
  type ChildAgentState,
  type ChildAgentPayload,
  type ModelSelection,
  type PromptAttachment,
  type PromptImage,
  type Project,
  type RunMode,
  type ThinkingLevel,
  type Thread,
  type ThreadViewState,
  type ToolState,
  type UserInputResolution,
  type UserInputState,
} from "@artemis/protocol";

import type {
  DesktopSnapshot,
  InstalledCodexPlugin,
  InstalledSkill,
  ReviewAction,
  ReviewComment,
  ReviewDiff,
  ReviewScope,
  SettingsSnapshot,
  WorkspaceFileLink,
} from "../shared/api.js";
import { legacyLocale, localeDirection } from "../shared/locales.js";
import { I18N_RESOURCES, localizedCopy } from "../shared/i18n-resources.js";
import artemisIcon from "../../build/icon.png";
import { ArchivePage } from "./ArchivePage.js";
import {
  indexAgentTeamTree,
  visibleAgentTeamMembers,
} from "./agent-team-tree.js";

interface LiveChildActivity {
  activity: string;
  payload: ChildAgentPayload;
}
import { MarkdownContent } from "./MarkdownContent.js";
import { normalizeBrowserAddress } from "./browser-navigation.js";
import { CodexSelect } from "./CodexSelect.js";
import { ChildAgentIcon } from "./ChildAgentIcon.js";
import { ComposerContextBar } from "./ComposerContextBar.js";
import { ContextUsageIndicator } from "./ContextUsageIndicator.js";
import {
  ENVIRONMENT_PANEL_RESERVED_WORKSPACE_WIDTH,
  EnvironmentPanel,
} from "./EnvironmentPanel.js";
import { TaskPlanProgress } from "./TaskPlanProgress.js";
import { resolveTimelinePinned } from "./timeline-scroll.js";
import { HighlightedCodeLine } from "./WorkspaceFileEditor.js";
import {
  WorkspaceFileIcon,
  WorkspaceFilesPanel,
} from "./WorkspaceFilesPanel.js";
import {
  MarkdownReaderPanel,
  WorkspaceBrowserPanel,
} from "./WorkspacePreviewPanel.js";
import { filePresentation } from "./workspace-file-presentation.js";
import {
  deriveRunPresentation,
  formatRunDuration,
} from "./run-presentation.js";
import { nextRunMode, parseRunModeCommand } from "./run-mode-controls.js";
import {
  formatBashTranscript,
  formatToolInput,
  formatToolOutput,
  summarizeToolDetail,
  summarizeToolGroup,
  toolActivityKind,
  toolActivityPath,
  type ToolActivityKind,
} from "./tool-presentation.js";
import {
  appendTimelineActivities,
  groupTimelineActivities,
  latestVisibleToolGroupKey,
} from "./tool-activity-groups.js";
import {
  isSkillCommandPrompt,
  promptWithoutSelectedSkills,
  promptWithSelectedSkills,
  replaceActiveSlashCommand,
  selectedSkillNamesForPrompt,
  slashCommandSuggestionsForPrompt,
} from "./skill-commands.js";
import {
  addPromptHistoryEntry,
  navigatePromptHistory,
  promptHistoryForConversation,
  type PromptHistoryNavigation,
} from "./prompt-history.js";
import { deriveTaskPlan } from "./task-plan.js";
import {
  clearComposerDraft,
  composerDraftFor,
  conversationDraftKey,
  moveComposerDraft,
  restoreComposerMessages,
  updateComposerDraft,
  type ComposerDraft,
  type ComposerDrafts,
} from "./composer-drafts.js";
import {
  isWorkspaceDraftThread,
  sortProjectThreads,
} from "./thread-list-order.js";
import { moveUserInputOptionFocus } from "./user-input-navigation.js";
import { formatUserInputCountdown } from "./user-input-countdown.js";
import { userInitials } from "./user-profile.js";
import {
  agentTeamWorkspaceTab,
  childAgentWorkspaceTab,
  closesLastWorkspaceTab,
  emptyWorkspaceTabs,
  reconcileAgentTeamWorkspaceTab,
  reduceWorkspaceTabs,
  type WorkspaceTab,
  type WorkspaceTabAction,
  type WorkspaceTabKind,
  type WorkspaceTabsState,
} from "./workspace-tabs.js";
import {
  clampWorkspaceDockWidth,
  workspaceDockWidthBounds,
} from "./workspace-dock-layout.js";
import {
  clampProjectSidebarWidth,
  PROJECT_SIDEBAR_WIDTH_DEFAULT,
  PROJECT_SIDEBAR_WIDTH_MAX,
  PROJECT_SIDEBAR_WIDTH_MIN,
} from "./project-sidebar-layout.js";
import {
  createProjectOrderPersistenceQueue,
  orderProjectsByPreference,
  reorderProjectIds,
  type ProjectDropEdge,
  type ProjectOrderPersistenceQueue,
} from "./project-order.js";
import {
  reduceTurnFailureNotices,
  type TurnFailureNotices,
} from "./turn-failure-notices.js";
import {
  selectionForModelSwitch,
  thinkingLevelsForModel,
} from "./model-selection.js";

type Locale = AppLocale;
type ModelPickerSection = "model" | "thinking";
type ActiveView =
  "workspace" | "archive" | "resources" | "token-usage" | "automations";
type SettingsEntryTab = "general" | "maintenance";
type ConfirmationTone = "default" | "danger";
type ToastContent = string | { error: true; message: string };

interface ToastState {
  content: ToastContent;
  fading: boolean;
  id: number;
}

interface ConfirmationState {
  message: string;
  tone: ConfirmationTone;
}

interface FileLinkContextMenuState {
  file: WorkspaceFileLink;
  threadId: string;
  x: number;
  y: number;
}

interface WorkspaceDockDrag {
  pointerId: number;
  startWidth: number;
  startX: number;
}

interface ProjectSidebarDrag {
  pointerId: number;
  startWidth: number;
  startX: number;
}

interface WorkspaceTabOpenOptions {
  forceNew?: boolean;
  path?: string;
  reuseKind?: boolean;
  revision?: string;
  url?: string;
}

interface WorkspaceTabScrollState {
  hasOverflow: boolean;
  canScrollLeft: boolean;
  canScrollRight: boolean;
}

const EMPTY_WORKSPACE_TAB_SCROLL_STATE: WorkspaceTabScrollState = {
  hasOverflow: false,
  canScrollLeft: false,
  canScrollRight: false,
};

const WORKSPACE_TAB_SCROLL_INSET = 32;
const TOAST_VISIBLE_MILLISECONDS = 10_000;
const TOAST_FADE_MILLISECONDS = 600;

const PROJECT_THREAD_PREVIEW_LIMIT = 5;

function TransientNotice({
  notice,
  onDismiss,
  placement,
}: {
  notice: ToastState;
  onDismiss(): void;
  placement: "composer" | "view";
}) {
  const error = typeof notice.content !== "string";
  return (
    <div
      aria-live={error ? "assertive" : "polite"}
      className={`transient-notice ${placement}-notice${error ? " error" : ""}${notice.fading ? " fading" : ""}`}
      role={error ? "alert" : "status"}
    >
      <button onClick={onDismiss} type="button">
        {typeof notice.content === "string"
          ? notice.content
          : notice.content.message}
      </button>
    </div>
  );
}

function modelIdentity(providerId: string, modelId: string): string {
  return `${providerId}\u0000${modelId}`;
}

const loadAutomationPage = () => import("./AutomationPage.js");
const loadResourceCenter = () => import("./ResourceCenter.js");
const loadSettingsPanel = () => import("./SettingsPanel.js");
const loadTerminalPanel = () => import("./TerminalPanel.js");
const loadTokenUsagePage = () => import("./TokenUsagePage.js");
const AutomationPage = lazy(() =>
  loadAutomationPage().then((module) => ({ default: module.AutomationPage })),
);
const ResourceCenter = lazy(() =>
  loadResourceCenter().then((module) => ({ default: module.ResourceCenter })),
);
const SettingsPanel = lazy(() =>
  loadSettingsPanel().then((module) => ({ default: module.SettingsPanel })),
);
const TerminalPanel = lazy(() =>
  loadTerminalPanel().then((module) => ({ default: module.TerminalPanel })),
);
const TokenUsagePage = lazy(() =>
  loadTokenUsagePage().then((module) => ({ default: module.TokenUsagePage })),
);

const copy = {
  en: {
    appName: "Artemis",
    projects: "Projects",
    expandProjects: "Expand projects",
    collapseProjects: "Collapse projects",
    resizeProjectsSidebar: "Resize conversations sidebar",
    temporaryConversations: "Temporary chats",
    temporaryConversation: "Temporary chat",
    automations: "Automations",
    tasks: "Tasks",
    newTask: "New task",
    openProject: "Open project",
    removeProject: "Remove from sidebar",
    removeProjectConfirm:
      "Remove this project from the sidebar? Files and task history will not be deleted.",
    moreProjectActions: "More project actions",
    stopTasksBeforeRemove: "Stop active tasks before removing this project",
    search: "Search tasks",
    noTasks: "No tasks yet",
    activeTasks: "Active tasks",
    archivedTasks: "Archived tasks",
    showArchived: "Show archived",
    showActive: "Show active",
    renameTask: "Rename",
    forkTask: "Fork",
    archiveTask: "Archive",
    restoreTask: "Restore",
    deleteTask: "Delete conversation",
    deleteTaskConfirm:
      "Delete this conversation and its local history? This cannot be undone.",
    confirmationTitle: "Confirm action",
    confirmationDangerTitle: "This action cannot be undone",
    confirmationCancel: "Cancel",
    confirmationAccept: "Confirm",
    showMoreTasks: "Show more",
    showFewerTasks: "Show less",
    expandProjectHistory: "Expand conversation history",
    collapseProjectHistory: "Collapse conversation history",
    moreActions: "More task actions",
    taskNamePrompt: "Task name",
    archiveConfirm: "Archive this task?",
    emptyTitle: "Build with Artemis",
    emptyBody:
      "Open a local project to start a Pi-powered coding or work task. Your workspace stays on this computer.",
    prompt: "Ask Artemis to work, plan, review, or build…",
    send: "Send",
    stop: "Stop",
    execute: "Execute",
    plan: "Plan",
    review: "Review",
    local: "Local",
    taskMode: "Task mode",
    reviewPanel: "Review",
    agentTeam: "Agent team",
    terminal: "Terminal",
    browser: "Browser",
    browserAddress: "Enter a URL",
    browserBack: "Back",
    browserForward: "Forward",
    browserGo: "Go",
    markdownReader: "Markdown",
    files: "Files",
    addTab: "Add tab",
    closeTab: "Close tab",
    scrollTabsLeft: "Scroll tabs left",
    scrollTabsRight: "Scroll tabs right",
    resizeRightSidebar: "Resize right sidebar",
    dismissTurnError: "Dismiss task error",
    editFile: "Edit file",
    saveFile: "Save",
    saved: "Saved",
    saving: "Saving…",
    unsaved: "Unsaved",
    noHtmlPreview: "No HTML file has been generated for this task.",
    noMarkdownPreview: "No Markdown file has been changed for this task.",
    filterFiles: "Filter files…",
    openFileFromTree: "Choose a file from the workspace tree.",
    binaryFile: "Binary files cannot be previewed.",
    fileLinkMenu: "File actions",
    openLinkedFile: "Open in reader",
    revealLinkedFile: "Show in folder",
    runLinkedFile: "Run file",
    runLinkedFileStarted: "Started",
    richText: "Rich text",
    sourceText: "Source",
    refreshPreview: "Refresh",
    changedFiles: "Changed files",
    noChanges: "No workspace changes",
    changesAppearHere: "Changes in this project will appear here.",
    noMatchingFiles: "No matching files",
    comparison: "Comparison",
    lastTurn: "Last turn",
    unstaged: "Unstaged",
    staged: "Staged",
    branch: "Branch",
    baseRef: "Base ref",
    stage: "Stage",
    unstage: "Unstage",
    revert: "Revert",
    revertConfirm:
      "Revert this change? Artemis will create a recovery copy first.",
    recoverySaved: "Recovery copy saved",
    additions: "additions",
    deletions: "deletions",
    addComment: "Add inline comment",
    commentPlaceholder: "Write a Review comment…",
    saveComment: "Save comment",
    cancelComment: "Cancel",
    deleteComment: "Delete comment",
    approveOnce: "Approve once",
    approveSession: "Approve for task",
    approveProject: "Approve for project",
    deny: "Deny",
    approvalApproved: "Approved request",
    approvalDenied: "Denied request",
    recommended: "Recommended",
    otherAnswer: "Other…",
    otherAnswerDetail: "Type an answer that is not listed above",
    customAnswer: "Type another answer",
    submitAnswer: "Submit",
    navigateChoices: "Move",
    selectChoice: "Select",
    answered: "Selected",
    timedOut: "No response for 5 minutes; used the model recommendation",
    timeoutHint: "The recommended option is used automatically after 5 minutes",
    inputCancelled: "Cancelled",
    cancelCurrentTask: "Cancel the current task",
    skip: "Skip",
    skipAndCancelTask: "Skip and cancel the current task",
    modelReason: "Model decision",
    agentActor: "Requested by",
    thinking: "Reasoning",
    running: "Thinking",
    queuedForAgent: "Waiting for Agent slot",
    waitingForModel: "Waiting for model",
    waiting: "Needs approval",
    waitingInput: "Waiting for your choice",
    completed: "Completed",
    failed: "Failed",
    ready: "Ready",
    elapsed: "Elapsed",
    model: "Pi auto",
    modelPicker: "Model and reasoning",
    modelPickerModel: "Model",
    ultraMode: "Ultra Mode",
    ultraModeQuota: "Uses your quota faster",
    modelSwitchFailed: "The model setting could not be changed.",
    steer: "Steer",
    followUp: "Follow-up",
    queuedMessages: "{{count}} queued after the current task",
    queueItem: "Queued message {{number}}",
    queueMoveToFront: "Move to front",
    queueMoveToFrontHint: "Run this queued message next",
    queueDelete: "Delete queued message",
    queueEdit: "Edit queued message",
    queueSave: "Save queued message",
    queueCancel: "Cancel edit",
    emptyConversationPrompt: "What should we build in {{workspace}}?",
    temporaryConversationPrompt: "What should we build in Artemis?",
    sandboxUnavailable: "Native command sandbox is not installed",
    sandboxDetail:
      "The platform Shell and Terminal use your desktop permissions. Sandboxed MCP and extension execution remain locked.",
    terminalLocked: "Terminal locked until the native executor is available.",
    refreshDiff: "Refresh",
    addAttachments: "Add files or images",
    removeAttachment: "Remove attachment",
    removeSelectedSkill: "Remove loaded Skill",
    attachmentLimit: "You can attach up to 10 files, including 4 images.",
    inspectAttachments: "Inspect the attached file(s).",
    dropAttachments: "Drop files to attach",
    dropAttachmentsDetail:
      "Images, text, code, PDF, Word, Excel, or PowerPoint",
    approvalPolicy: "Approval permissions",
    askApproval: "Request approval",
    askApprovalDetail:
      "Always ask before non-MCP external changes or network access",
    agentApproval: "Approve for me",
    agentApprovalDetail:
      "Low and medium risk run automatically; high risk runs only when you explicitly requested it",
    fullAccess: "Full access",
    fullAccessDetail:
      "Auto-approve supported operations within the native sandbox",
    fullAccessUnavailable: "Requires the native command sandbox",
    customApproval: "Custom",
    customApprovalDetail:
      "Use saved approvals; sandboxed MCP calls run automatically",
    openFolder: "Open folder",
    leftSidebar: "Left sidebar",
    rightSidebar: "Right sidebar",
    toggleReview: "Toggle review",
    toggleTerminal: "Toggle terminal",
    noProject: "Open a project first.",
    taskError: "The task could not be started.",
    turnError: "The task failed.",
    settings: "Settings",
    currentVersion: "Current version",
    archiveLibrary: "Archive",
    resourceCenter: "MCP & Skills",
    tokenUsage: "Token usage",
    goal: "Goal",
    goalSet: "Persistent goal saved",
    goalCleared: "Persistent goal cleared",
    noGoal: "This task has no persistent goal.",
    goalCommand: "/goal",
    goalCommandDetail: "Set a persistent task goal",
    compactCommand: "/compact",
    compactCommandDetail: "Summarize older context now",
    contextCompacting: "Compacting context",
    contextCompacted: "Compact completed",
    compactRequiresTask: "Open an existing task before compacting context.",
    compactWhileRunning: "Wait for the active turn before compacting context.",
    compactFailed: "Context could not be compacted.",
    initCommand: "/init",
    initCommandDetail: "Create a project-level AGENTS.md file",
    planCommand: "/plan",
    planCommandDetail: "Switch to Plan mode",
    executeCommand: "/execute",
    executeCommandDetail: "Switch to Execute mode",
    reviewCommand: "/review",
    reviewCommandDetail: "Switch to Review mode",
    multipleModeCommands:
      "Only one /plan, /execute, or /review command is allowed per message.",
    modeCommandWhileRunning:
      "Stop the active turn before switching task modes.",
    installedSkills: "Installed Skills",
    installedPlugins: "Installed Plugins",
    loadingSkills: "Loading installed Skills…",
    noInstalledSkills: "No enabled Skills are installed.",
    noMatchingSkills: "No installed Skills match this command.",
    selectedSkill: "Loaded Skill",
    archivedReadOnly: "Archived conversation",
    archivedReadOnlyDetail:
      "This conversation is read-only while archived. Restore it to continue.",
  },
  "zh-CN": {
    appName: "Artemis",
    projects: "项目",
    expandProjects: "展开项目",
    collapseProjects: "收起项目",
    resizeProjectsSidebar: "调整会话侧栏宽度",
    temporaryConversations: "临时会话",
    temporaryConversation: "临时会话",
    automations: "定时任务",
    tasks: "任务",
    newTask: "新任务",
    openProject: "打开项目",
    removeProject: "从侧栏移除",
    removeProjectConfirm: "从侧栏移除这个项目？不会删除磁盘文件和任务历史。",
    moreProjectActions: "更多项目操作",
    stopTasksBeforeRemove: "请先停止项目中正在执行的任务",
    search: "搜索任务",
    noTasks: "还没有任务",
    activeTasks: "当前任务",
    archivedTasks: "已归档任务",
    showArchived: "查看已归档",
    showActive: "查看当前任务",
    renameTask: "重命名",
    forkTask: "分叉",
    archiveTask: "归档",
    restoreTask: "恢复",
    deleteTask: "删除对话",
    deleteTaskConfirm: "删除这个对话及其本地历史？此操作无法撤销。",
    confirmationTitle: "确认操作",
    confirmationDangerTitle: "此操作无法撤销",
    confirmationCancel: "取消",
    confirmationAccept: "确认",
    showMoreTasks: "展开显示",
    showFewerTasks: "收起显示",
    expandProjectHistory: "展开对话记录",
    collapseProjectHistory: "折叠对话记录",
    moreActions: "更多任务操作",
    taskNamePrompt: "任务名称",
    archiveConfirm: "归档这个任务？",
    emptyTitle: "使用 Artemis 开始构建",
    emptyBody:
      "打开本地项目即可创建由 Pi 驱动的编码或办公任务。工作区数据保留在这台电脑上。",
    prompt: "让 Artemis 工作、规划、审查或实现…",
    send: "发送",
    stop: "停止",
    execute: "执行",
    plan: "计划",
    review: "审查",
    local: "本地",
    taskMode: "任务模式",
    reviewPanel: "审查",
    agentTeam: "Agent 团队",
    terminal: "终端",
    browser: "浏览器",
    browserAddress: "输入网址",
    browserBack: "后退",
    browserForward: "前进",
    browserGo: "打开",
    markdownReader: "Markdown 阅读器",
    files: "文件",
    addTab: "添加选项卡",
    closeTab: "关闭选项卡",
    scrollTabsLeft: "向左滚动选项卡",
    scrollTabsRight: "向右滚动选项卡",
    resizeRightSidebar: "调整右侧边栏宽度",
    dismissTurnError: "关闭任务错误",
    editFile: "编辑文件",
    saveFile: "保存",
    saved: "已保存",
    saving: "正在保存…",
    unsaved: "未保存",
    noHtmlPreview: "此任务尚未生成 HTML 文件。",
    noMarkdownPreview: "此任务尚未修改 Markdown 文件。",
    filterFiles: "筛选文件…",
    openFileFromTree: "从工作区目录树中选择文件。",
    binaryFile: "二进制文件无法预览。",
    fileLinkMenu: "文件操作",
    openLinkedFile: "在阅读器中打开",
    revealLinkedFile: "打开文件目录",
    runLinkedFile: "直接执行",
    runLinkedFileStarted: "已启动",
    richText: "富文本",
    sourceText: "原始文本",
    refreshPreview: "刷新",
    changedFiles: "已改文件",
    noChanges: "工作区没有改动",
    changesAppearHere: "此项目中的改动将显示在这里。",
    noMatchingFiles: "没有匹配的文件",
    comparison: "比较范围",
    lastTurn: "上轮修改",
    unstaged: "未暂存",
    staged: "已暂存",
    branch: "分支比较",
    baseRef: "基准引用",
    stage: "暂存",
    unstage: "取消暂存",
    revert: "还原",
    revertConfirm: "确认还原这项改动？Artemis 会先创建恢复副本。",
    recoverySaved: "恢复副本已保存",
    additions: "新增",
    deletions: "删除",
    addComment: "添加行内评论",
    commentPlaceholder: "输入审查评论…",
    saveComment: "保存评论",
    cancelComment: "取消",
    deleteComment: "删除评论",
    approveOnce: "仅批准本次",
    approveSession: "本任务内批准",
    approveProject: "本项目内批准",
    deny: "拒绝",
    approvalApproved: "已批准的操作",
    approvalDenied: "已拒绝的操作",
    recommended: "模型推荐",
    otherAnswer: "其他…",
    otherAnswerDetail: "输入一个不在以上列表中的答案",
    customAnswer: "输入其他答案",
    submitAnswer: "提交",
    navigateChoices: "移动",
    selectChoice: "选择",
    answered: "已选择",
    timedOut: "5 分钟未选择，已采用模型推荐项",
    timeoutHint: "5 分钟内未选择将自动采用模型推荐项",
    inputCancelled: "已取消",
    cancelCurrentTask: "取消当前任务",
    skip: "跳过",
    skipAndCancelTask: "跳过并取消当前任务",
    modelReason: "模型判断",
    agentActor: "发起成员",
    thinking: "推理",
    running: "思考中",
    queuedForAgent: "等待 Agent 槽位",
    waitingForModel: "等待模型",
    waiting: "等待批准",
    waitingInput: "等待你选择",
    completed: "已完成",
    failed: "失败",
    ready: "就绪",
    elapsed: "用时",
    model: "Pi 自动选择",
    modelPicker: "模型与推理强度",
    modelPickerModel: "模型",
    ultraMode: "极致模式",
    ultraModeQuota: "更快消耗使用额度",
    modelSwitchFailed: "无法切换模型设置。",
    steer: "引导当前执行",
    followUp: "完成后继续",
    queuedMessages: "当前任务后等待 {{count}} 条",
    queueItem: "第 {{number}} 条排队消息",
    queueMoveToFront: "移到队首",
    queueMoveToFrontHint: "让此排队消息下一条执行",
    queueDelete: "删除排队消息",
    queueEdit: "编辑排队消息",
    queueSave: "保存排队消息",
    queueCancel: "取消编辑",
    emptyConversationPrompt: "想在 {{workspace}} 中构建什么？",
    temporaryConversationPrompt: "想在 Artemis 中构建什么？",
    sandboxUnavailable: "尚未安装原生命令沙箱",
    sandboxDetail:
      "平台 Shell 与终端使用当前桌面用户权限；MCP 与扩展的沙箱执行保持锁定。",
    terminalLocked: "原生执行器可用前，终端保持锁定。",
    refreshDiff: "刷新",
    addAttachments: "添加文件或图片",
    removeAttachment: "移除附件",
    removeSelectedSkill: "移除已加载 Skill",
    attachmentLimit: "最多添加 10 个文件，其中图片不超过 4 张。",
    inspectAttachments: "请查看已附加的文件。",
    dropAttachments: "松开即可添加文件",
    dropAttachmentsDetail:
      "支持图片、文本、代码、PDF、Word、Excel 和 PowerPoint",
    approvalPolicy: "审批权限",
    askApproval: "请求批准",
    askApprovalDetail: "非 MCP 的外部更改或网络访问前始终询问",
    agentApproval: "替我审批",
    agentApprovalDetail:
      "低、中风险自动批准；高风险仅在你明确要求该操作时自动批准",
    fullAccess: "完全访问权限",
    fullAccessDetail: "在原生沙箱边界内自动批准支持的操作",
    fullAccessUnavailable: "需要先安装原生命令沙箱",
    customApproval: "自定义",
    customApprovalDetail: "使用已保存的批准；沙箱内 MCP 自动调用",
    openFolder: "打开文件夹",
    leftSidebar: "左侧边栏",
    rightSidebar: "右侧边栏",
    toggleReview: "切换审查面板",
    toggleTerminal: "切换终端",
    noProject: "请先打开一个项目。",
    taskError: "任务无法启动。",
    turnError: "任务执行失败。",
    settings: "设置",
    currentVersion: "当前版本",
    archiveLibrary: "归档",
    resourceCenter: "MCP 与 Skills",
    tokenUsage: "Token 用量",
    goal: "目标",
    goalSet: "持久目标已保存",
    goalCleared: "持久目标已清除",
    noGoal: "当前任务没有持久目标。",
    goalCommand: "/goal",
    goalCommandDetail: "设置任务级持久目标",
    compactCommand: "/compact",
    compactCommandDetail: "立即压缩较早的上下文",
    contextCompacting: "正在压缩上下文",
    contextCompacted: "Compact 已完成",
    compactRequiresTask: "请先打开已有任务，再压缩上下文。",
    compactWhileRunning: "请等待当前任务执行结束后再压缩上下文。",
    compactFailed: "上下文压缩失败。",
    initCommand: "/init",
    initCommandDetail: "创建包含项目说明的 AGENTS.md 文件",
    planCommand: "/plan",
    planCommandDetail: "切换到 Plan 模式",
    executeCommand: "/execute",
    executeCommandDetail: "切换到 Execute 模式",
    reviewCommand: "/review",
    reviewCommandDetail: "切换到 Review 模式",
    multipleModeCommands:
      "每条消息只能包含一个 /plan、/execute 或 /review 指令。",
    modeCommandWhileRunning: "请先停止当前执行，再切换任务模式。",
    installedSkills: "已安装的 Skills",
    installedPlugins: "已安装的插件",
    loadingSkills: "正在加载已安装的 Skills…",
    noInstalledSkills: "尚未安装并启用任何 Skill。",
    noMatchingSkills: "没有匹配此命令的已安装 Skill。",
    selectedSkill: "已加载 Skill",
    archivedReadOnly: "已归档对话",
    archivedReadOnlyDetail: "归档状态下只能阅读；恢复后才能继续对话。",
  },
} satisfies Record<"en" | "zh-CN", Record<string, string>>;

function appCopy(locale: Locale): (typeof copy)["en"] {
  return localizedCopy(locale, "app", copy[legacyLocale(locale)]);
}

function Icon({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      className="icon"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      {children}
    </svg>
  );
}

function ArtemisMark() {
  return (
    <div className="artemis-mark" aria-label="Artemis">
      <img alt="" aria-hidden="true" src={artemisIcon} />
    </div>
  );
}

function FolderIcon({ open = false }: { open?: boolean }) {
  return (
    <Icon>
      {open ? (
        <>
          <path
            d="M3.5 10V6.5h6l2 2h6.8a1.7 1.7 0 0 1 1.7 1.7v.3"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.6"
          />
          <path
            d="m4.7 18.5 2.4-8h13.4l-2.2 7.2a1.2 1.2 0 0 1-1.2.8H4.7Z"
            stroke="currentColor"
            strokeLinejoin="round"
            strokeWidth="1.6"
          />
        </>
      ) : (
        <path
          d="M3.5 6.5h6l2 2h9v9.2a1.8 1.8 0 0 1-1.8 1.8H5.3a1.8 1.8 0 0 1-1.8-1.8V6.5Z"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="1.6"
        />
      )}
    </Icon>
  );
}

function PlusIcon() {
  return (
    <Icon>
      <path
        d="M12 5v14M5 12h14"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </Icon>
  );
}

function CloseIcon() {
  return (
    <Icon size={16}>
      <path
        d="m7 7 10 10M17 7 7 17"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.7"
      />
    </Icon>
  );
}

function QueueIcon() {
  return (
    <Icon size={18}>
      <path
        d="M6 7h12M6 12h12M6 17h8M3.5 7h.1M3.5 12h.1M3.5 17h.1"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </Icon>
  );
}

function MoveToFrontIcon() {
  return (
    <Icon size={18}>
      <path
        d="M12 18V6m-4 4 4-4 4 4M6 20h12"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </Icon>
  );
}

function TrashIcon() {
  return (
    <Icon size={18}>
      <path
        d="M5.5 7.5h13m-8.5-3h4l.7 2h-5.4l.7-2Zm-3 3 .7 12h8.6l.7-12M10 10.5v6m4-6v6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </Icon>
  );
}

function EditIcon() {
  return (
    <Icon size={18}>
      <path
        d="m5 17.5 1.3-4.2L16.8 2.8a2.1 2.1 0 0 1 3 3L9.3 16.3 5 17.5Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <path d="m14.7 4.9 3 3" stroke="currentColor" strokeWidth="1.5" />
    </Icon>
  );
}

function FileIcon() {
  return (
    <Icon size={24}>
      <path
        d="M6 3.5h8l4 4v13H6v-17Zm8 0v4h4M9 12h6m-6 4h6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </Icon>
  );
}

function isPromptImage(
  attachment: PromptAttachment,
): attachment is PromptImage {
  return !("type" in attachment);
}

function SearchIcon() {
  return (
    <Icon size={16}>
      <circle
        cx="10.7"
        cy="10.7"
        r="6.2"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="m15.4 15.4 4.1 4.1"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.6"
      />
    </Icon>
  );
}

function RefreshIcon() {
  return (
    <Icon size={16}>
      <path
        d="M19 8a7.5 7.5 0 1 0 .3 7.5M19 4.5V8h-3.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </Icon>
  );
}

function ReviewEmptyIcon() {
  return (
    <Icon size={46}>
      <path
        d="M7 3.5h7l4 4v13H7v-17Zm7 0v4h4"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.2"
      />
      <path
        d="M9.5 12h5M12 9.5v5m-2.5 3h5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.4"
      />
    </Icon>
  );
}

function ArchiveIcon() {
  return (
    <Icon>
      <path
        d="M4 8h16v11H4V8Zm-1-4h18v4H3V4Zm6 8h6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.55"
      />
    </Icon>
  );
}

function ResourceIcon() {
  return (
    <Icon>
      <path
        d="M8 3v5m8-5v5M6 8h12v2.5a6 6 0 0 1-12 0V8Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <path
        d="M12 16.5V21m-2.5 0h5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </Icon>
  );
}

function TokenUsageIcon() {
  return (
    <Icon>
      <path
        d="M5 19V11h3v8H5Zm5.5 0V5h3v14h-3Zm5.5 0V8h3v11h-3Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </Icon>
  );
}

function AutomationIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M12 7v5l3 2M8 3.5V2m8 1.5V2"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
    </Icon>
  );
}

function SettingsIcon() {
  return (
    <Icon size={17}>
      <path
        d="M9.7 3.4h4.6l.5 2a7.2 7.2 0 0 1 1.5.9l2-.6 2.3 4-1.5 1.5v1.7l1.5 1.5-2.3 4-2-.6a7.2 7.2 0 0 1-1.5.9l-.5 2H9.7l-.5-2a7.2 7.2 0 0 1-1.5-.9l-2 .6-2.3-4 1.5-1.5v-1.7L3.4 9.7l2.3-4 2 .6a7.2 7.2 0 0 1 1.5-.9l.5-2Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.45"
      />
      <circle
        cx="12"
        cy="12"
        r="2.6"
        stroke="currentColor"
        strokeWidth="1.45"
      />
    </Icon>
  );
}

function ReviewIcon() {
  return (
    <Icon>
      <path
        d="M7 4.5h10M7 9h10M7 13.5h6M5 3v18M19 3v18"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
    </Icon>
  );
}

function LeftSidebarIcon() {
  return (
    <Icon>
      <rect
        height="16"
        rx="3"
        stroke="currentColor"
        strokeWidth="1.6"
        width="18"
        x="3"
        y="4"
      />
      <path d="M9 4v16" stroke="currentColor" strokeWidth="1.6" />
    </Icon>
  );
}

function RightSidebarIcon() {
  return (
    <Icon>
      <rect
        height="16"
        rx="3"
        stroke="currentColor"
        strokeWidth="1.6"
        width="18"
        x="3"
        y="4"
      />
      <path d="M15 4v16" stroke="currentColor" strokeWidth="1.6" />
    </Icon>
  );
}

function TerminalIcon() {
  return (
    <Icon>
      <path
        d="m5 7 4.5 5L5 17m7 0h7"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </Icon>
  );
}

function ToolActivityIcon({ kind }: { kind: ToolActivityKind }) {
  if (kind === "bash") return <TerminalIcon />;
  if (kind === "search") return <SearchIcon />;
  if (kind === "generic") return <ResourceIcon />;
  if (kind === "write") {
    return (
      <Icon size={18}>
        <path
          d="m4.5 19.5 1-4 9.8-9.8a2 2 0 0 1 2.8 2.8l-9.8 9.8-3.8 1.2Zm9.4-12.4 3 3M5.5 15.5l2.8 2.8"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.55"
        />
      </Icon>
    );
  }
  return (
    <Icon size={18}>
      <path
        d="M4.5 5.3c2.8-.9 5.3-.5 7.5 1.2v12c-2.2-1.7-4.7-2.1-7.5-1.2v-12Zm15 0c-2.8-.9-5.3-.5-7.5 1.2v12c2.2-1.7 4.7-2.1 7.5-1.2v-12Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.45"
      />
    </Icon>
  );
}

function BrowserIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M4.5 12h15M12 4c2 2.2 3 4.9 3 8s-1 5.8-3 8c-2-2.2-3-4.9-3-8s1-5.8 3-8Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </Icon>
  );
}

function MarkdownIcon() {
  return (
    <Icon>
      <path
        d="M5 4.5h11l3 3V20H5V4.5Zm11 0V8h3M8 15v-4l2 2 2-2v4m3-4v4m-1.5-1.5L15 15l1.5-1.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.4"
      />
    </Icon>
  );
}

function FilesIcon() {
  return (
    <Icon>
      <path
        d="M3.5 7.5h6l2-2h3l2 2h4v11h-17v-11Zm3-3h6l2 2"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </Icon>
  );
}

function WorkspaceTabIcon({
  identity,
  kind,
  path,
}: {
  identity?: string | undefined;
  kind: WorkspaceTabKind;
  path?: string | undefined;
}) {
  if (kind === "review") return <ReviewIcon />;
  if (kind === "terminal") return <TerminalIcon />;
  if (kind === "browser") return <BrowserIcon />;
  if (kind === "markdown") return <MarkdownIcon />;
  if (kind === "agent-team" || kind === "child-agent") {
    return <ChildAgentIcon identity={identity ?? kind} />;
  }
  if (kind === "file") {
    return path ? (
      <WorkspaceFileIcon
        path={path}
        presentation={filePresentation(path)}
        symlink={false}
      />
    ) : (
      <FilesIcon />
    );
  }
  return <FilesIcon />;
}

function ModeIcon() {
  return (
    <Icon>
      <path
        d="M7 4.5h10a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="m8.5 9 2.5 3-2.5 3m5-6h2"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </Icon>
  );
}

function ModelIcon() {
  return (
    <Icon size={18}>
      <path
        d="M12 5a3 3 0 0 0-5.99.2A4 4 0 0 0 3.6 11a4 4 0 0 0 .55 6.4A4 4 0 0 0 12 18V5Zm0 0a3 3 0 0 1 5.99.2A4 4 0 0 1 20.4 11a4 4 0 0 1-.55 6.4A4 4 0 0 1 12 18m-3-8.5A4.5 4.5 0 0 0 12 13m3-3.5A4.5 4.5 0 0 1 12 13"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.45"
      />
    </Icon>
  );
}

function ChevronIcon() {
  return (
    <Icon size={14}>
      <path
        d="m7 9 5 5 5-5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </Icon>
  );
}

function TabScrollIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <Icon size={16}>
      <path
        d={
          direction === "left"
            ? "m14.5 6.5-5.5 5.5 5.5 5.5"
            : "m9.5 6.5 5.5 5.5-5.5 5.5"
        }
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </Icon>
  );
}

function ApprovalIcon({
  neutral = false,
  warning = false,
}: {
  neutral?: boolean;
  warning?: boolean;
}) {
  return (
    <Icon size={19}>
      <path
        d="M12 3.4 20 7v5.7c0 4-3.1 6.7-8 8-4.9-1.3-8-4-8-8V7l8-3.6Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
      {neutral ? null : warning ? (
        <path
          d="M12 8v5m0 3v.1"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.7"
        />
      ) : (
        <path
          d="m8.6 12.2 2.1 2.1 4.7-5"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.7"
        />
      )}
    </Icon>
  );
}

function statusLabel(state: ThreadViewState | undefined, locale: Locale) {
  const t = appCopy(locale);
  switch (state?.status) {
    case "running":
      return state.activity?.phase === "queued"
        ? t.queuedForAgent
        : state.activity?.phase === "requesting-model"
          ? t.waitingForModel
          : t.running;
    case "waiting-approval":
      return t.waiting;
    case "waiting-user-input":
      return t.waitingInput;
    case "failed":
      return t.failed;
    default:
      return t.ready;
  }
}

function thinkingLevelLabel(level: ThinkingLevel, locale: Locale): string {
  const key = {
    off: "thinkingOff",
    minimal: "thinkingMinimal",
    low: "thinkingLow",
    medium: "thinkingMedium",
    high: "thinkingHigh",
    xhigh: "thinkingXHigh",
    max: "thinkingMax",
  } as const;
  return I18N_RESOURCES[locale].settings[key[level]];
}

function updateThreadStatus(
  thread: Thread,
  event: AgentEvent,
): Thread["status"] {
  switch (event.payload.type) {
    case "turn.started":
      return "running";
    case "approval.requested":
    case "user-input.requested":
      return "waiting-approval";
    case "turn.completed":
      return "idle";
    case "turn.failed":
      return "failed";
    default:
      return thread.status;
  }
}

function mergeThreadEvents(
  history: AgentEvent[],
  liveEvents: AgentEvent[],
): AgentEvent[] {
  if (history.length === 0) return liveEvents;
  if (liveEvents.length === 0) return history;
  const byId = new Map<string, AgentEvent>();
  for (const event of history) byId.set(event.eventId, event);
  for (const event of liveEvents) byId.set(event.eventId, event);
  return [...byId.values()].sort((left, right) => left.seq - right.seq);
}

function eventChangesThread(event: AgentEvent): boolean {
  return [
    "turn.started",
    "approval.requested",
    "turn.completed",
    "turn.failed",
  ].includes(event.payload.type);
}

function preserveLoadedEvents(
  refreshed: DesktopSnapshot,
  current: DesktopSnapshot | undefined,
): DesktopSnapshot {
  const visibleThreads = new Set(refreshed.threads.map((thread) => thread.id));
  return {
    ...refreshed,
    events: Object.fromEntries(
      Object.entries(current?.events ?? {}).filter(([threadId]) =>
        visibleThreads.has(threadId),
      ),
    ),
  };
}

function visibleThreadTitle(title: string): string {
  return (
    promptWithoutSelectedSkills(title) ||
    selectedSkillNamesForPrompt(title).join(", ") ||
    title
  );
}

function prepareThreadTitleScroll(
  event: ReactPointerEvent<HTMLSpanElement>,
): void {
  const viewport = event.currentTarget;
  const content = viewport.firstElementChild;
  if (!(content instanceof HTMLElement)) return;

  const distance = Math.ceil(content.scrollWidth - viewport.clientWidth);
  if (distance <= 1) {
    delete viewport.dataset.overflowing;
    viewport.style.removeProperty("--thread-title-scroll-distance");
    viewport.style.removeProperty("--thread-title-scroll-duration");
    return;
  }

  viewport.dataset.overflowing = "true";
  viewport.style.setProperty(
    "--thread-title-scroll-distance",
    `-${distance}px`,
  );
  viewport.style.setProperty(
    "--thread-title-scroll-duration",
    `${Math.max(4, distance / 36 + 2).toFixed(2)}s`,
  );
}

export function App() {
  const { i18n } = useTranslation();
  const [snapshot, setSnapshot] = useState<DesktopSnapshot>();
  const [activeProjectId, setActiveProjectId] = useState<string>();
  const [activeThreadId, setActiveThreadId] = useState<string>();
  const [composerDrafts, setComposerDrafts] = useState<ComposerDrafts>({});
  const [promptSubmittedAtByThread, setPromptSubmittedAtByThread] = useState<
    Record<string, number>
  >({});
  const [promptHistory, setPromptHistory] = useState<string[]>([]);
  const [installedSkills, setInstalledSkills] = useState<InstalledSkill[]>([]);
  const [installedPlugins, setInstalledPlugins] = useState<
    InstalledCodexPlugin[]
  >([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsError, setSkillsError] = useState<string>();
  const [skillMenuDismissed, setSkillMenuDismissed] = useState(false);
  const [activeSlashSuggestion, setActiveSlashSuggestion] = useState(0);
  const [attachmentDragActive, setAttachmentDragActive] = useState(false);
  const [approvalPolicy, setApprovalPolicy] = useState<ApprovalPolicy>("agent");
  const [runtimeSettings, setRuntimeSettings] = useState<SettingsSnapshot>();
  const [pendingModelSelection, setPendingModelSelection] =
    useState<ModelSelection>();
  const [approvalMenuOpen, setApprovalMenuOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelPickerSection, setModelPickerSection] =
    useState<ModelPickerSection>("model");
  const [mode, setMode] = useState<RunMode>("execute");
  const [query, setQuery] = useState("");
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [draggedProjectId, setDraggedProjectId] = useState<string>();
  const [projectDropTarget, setProjectDropTarget] = useState<{
    projectId: string;
    edge: ProjectDropEdge;
  }>();
  const [activeView, setActiveView] = useState<ActiveView>("workspace");
  const [projectMenuId, setProjectMenuId] = useState<string>();
  const [threadMenuId, setThreadMenuId] = useState<string>();
  const [threadRename, setThreadRename] = useState<{
    threadId: string;
    title: string;
  }>();
  const [workspaceTabsByThread, setWorkspaceTabsByThread] = useState<
    Record<string, WorkspaceTabsState>
  >({});
  const [workspaceDockOpen, setWorkspaceDockOpen] = useState(false);
  const [environmentPanelOpen, setEnvironmentPanelOpen] = useState(false);
  const [workspaceDockWidth, setWorkspaceDockWidth] = useState<number>();
  const [workspaceDockResizing, setWorkspaceDockResizing] = useState(false);
  const [workspaceTabMenuOpen, setWorkspaceTabMenuOpen] = useState(false);
  const [workspaceTabScrollState, setWorkspaceTabScrollState] =
    useState<WorkspaceTabScrollState>(EMPTY_WORKSPACE_TAB_SCROLL_STATE);
  const [fileLinkContextMenu, setFileLinkContextMenu] =
    useState<FileLinkContextMenuState>();
  const workspaceTabSerial = useRef(0);
  const workspaceTabScroll = useRef<HTMLDivElement>(null);
  const workspaceTabTrack = useRef<HTMLDivElement>(null);
  const activeWorkspaceTabElement = useRef<HTMLDivElement>(null);
  const workspaceContent = useRef<HTMLDivElement>(null);
  const workspaceDock = useRef<HTMLElement>(null);
  const workspaceDockDrag = useRef<WorkspaceDockDrag | undefined>(undefined);
  const workspaceDockWidthRef = useRef<number | undefined>(undefined);
  const workspaceDockPersistence = useRef<Promise<void>>(Promise.resolve());
  const projectSidebar = useRef<HTMLElement>(null);
  const projectSidebarDrag = useRef<ProjectSidebarDrag | undefined>(undefined);
  const projectSidebarWidthRef = useRef<number | undefined>(undefined);
  const projectSidebarPersistence = useRef<Promise<void>>(Promise.resolve());
  const knownAgentTeamTabs = useRef(new Set<string>());
  const workspaceThreadCreation =
    useRef<Promise<string | undefined>>(undefined);
  const [reviewScope, setReviewScope] = useState<ReviewScope>("branch");
  const [reviewBaseRef, setReviewBaseRef] = useState("");
  const [reviewFileQuery, setReviewFileQuery] = useState("");
  const [selectedReviewFileId, setSelectedReviewFileId] = useState<string>();
  const [reviewBusy, setReviewBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsEntryTab>("general");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [projectSidebarWidth, setProjectSidebarWidth] = useState<number>();
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

  const openSettings = (tab: SettingsEntryTab = "general") => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  };
  const [commentLineId, setCommentLineId] = useState<string>();
  const [commentBody, setCommentBody] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmationState>();
  const [busy, setBusy] = useState(false);
  const toastSerial = useRef(0);
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
  const [turnFailureNotices, setTurnFailureNotices] =
    useState<TurnFailureNotices>({});
  const [editingQueuedMessage, setEditingQueuedMessage] = useState<{
    index: number;
    value: string;
  }>();
  const timelineScroll = useRef<HTMLDivElement>(null);
  const timelinePinned = useRef(true);
  const timelineScrollIntent = useRef(false);
  const timelineScrollbarPointerActive = useRef(false);
  const loadedEventThreads = useRef(new Set<string>());
  const loadingEventThreads = useRef(new Set<string>());
  const pendingAgentEvents = useRef<AgentEvent[]>([]);
  const pendingAgentFrame = useRef<number | undefined>(undefined);
  const [liveChildActivities, setLiveChildActivities] = useState<
    Record<string, Record<string, LiveChildActivity>>
  >({});
  const reportedTurnPaints = useRef(new Set<string>());
  const recoveredQueueEventIds = useRef(new Set<string>());
  const promptInput = useRef<HTMLTextAreaElement>(null);
  const previousPendingUserInputId = useRef<string | undefined>(undefined);
  const modelPickerRoot = useRef<HTMLDivElement>(null);
  const modelPickerHoverCloseTimer = useRef<number | undefined>(undefined);
  const slashCommandMenu = useRef<HTMLDivElement>(null);
  const confirmationCancelButton = useRef<HTMLButtonElement>(null);
  const confirmationResolver = useRef<
    ((confirmed: boolean) => void) | undefined
  >(undefined);
  const promptHistoryNavigation = useRef<PromptHistoryNavigation>({
    index: -1,
    draft: "",
  });
  const reviewRequestId = useRef(0);
  const reviewDiffCache = useRef(new Map<string, ReviewDiff>());
  const reviewDiffInFlight = useRef(new Map<string, Promise<ReviewDiff>>());
  const reviewDiffVersion = useRef(new Map<string, number>());
  const [reviewTransitionPending, startReviewTransition] = useTransition();
  const threadStateCache = useRef(
    new Map<
      string,
      {
        eventCount: number;
        lastEventId?: string;
        mode: RunMode;
        state: ThreadViewState;
      }
    >(),
  );

  const locale: Locale = snapshot?.locale ?? "en";
  const t = appCopy(locale);
  const username = snapshot?.userName ?? t.local;
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
  } = activeComposerDraft;
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
      updateActiveComposerDraft((current) => ({
        ...current,
        attachments:
          typeof action === "function" ? action(current.attachments) : action,
      }));
    },
    [updateActiveComposerDraft],
  );

  useEffect(() => {
    promptHistoryNavigation.current = { index: -1, draft: prompt };
    setSkillMenuDismissed(false);
    setEditingQueuedMessage(undefined);
  }, [activeComposerDraftKey]);

  const beginNewConversation = useCallback(
    (projectId = activeProjectId) => {
      setActiveView("workspace");
      setActiveProjectId(projectId);
      setActiveThreadId(undefined);
      setMode("execute");
      setComposerDrafts((current) =>
        clearComposerDraft(current, conversationDraftKey(projectId, undefined)),
      );
      promptHistoryNavigation.current = { index: -1, draft: "" };
      setSkillMenuDismissed(false);
      setWorkspaceDockOpen(false);
      setProjectMenuId(undefined);
      setThreadMenuId(undefined);
      window.requestAnimationFrame(() => promptInput.current?.focus());
    },
    [activeProjectId],
  );

  const beginTemporaryConversation = useCallback(() => {
    setActiveView("workspace");
    setActiveProjectId(undefined);
    setActiveThreadId(undefined);
    setMode("execute");
    setComposerDrafts((current) =>
      clearComposerDraft(current, conversationDraftKey(undefined, undefined)),
    );
    promptHistoryNavigation.current = { index: -1, draft: "" };
    setSkillMenuDismissed(false);
    setWorkspaceDockOpen(false);
    setProjectMenuId(undefined);
    setThreadMenuId(undefined);
    window.requestAnimationFrame(() => promptInput.current?.focus());
  }, []);

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

  const toggleProjectHistory = useCallback((projectId: string) => {
    setCollapsedProjectIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }, []);

  const requestConfirmation = useCallback(
    (message: string, tone: ConfirmationTone = "default") =>
      new Promise<boolean>((resolve) => {
        confirmationResolver.current?.(false);
        confirmationResolver.current = resolve;
        setConfirmation({ message, tone });
      }),
    [],
  );

  const resolveConfirmation = useCallback((confirmed: boolean) => {
    const resolve = confirmationResolver.current;
    confirmationResolver.current = undefined;
    setConfirmation(undefined);
    resolve?.(confirmed);
  }, []);

  useEffect(() => {
    if (!confirmation) return;
    confirmationCancelButton.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      resolveConfirmation(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [confirmation, resolveConfirmation]);

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
    if (!modelPickerOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!modelPickerRoot.current?.contains(event.target as Node)) {
        setModelPickerOpen(false);
        setModelPickerSection("model");
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [modelPickerOpen]);
  const cancelModelPickerHoverClose = useCallback(() => {
    if (modelPickerHoverCloseTimer.current !== undefined) {
      window.clearTimeout(modelPickerHoverCloseTimer.current);
      modelPickerHoverCloseTimer.current = undefined;
    }
  }, []);
  const scheduleModelPickerHoverClose = useCallback(() => {
    cancelModelPickerHoverClose();
    modelPickerHoverCloseTimer.current = window.setTimeout(() => {
      setModelPickerSection("model");
      modelPickerHoverCloseTimer.current = undefined;
    }, 160);
  }, [cancelModelPickerHoverClose]);
  useEffect(
    () => () => cancelModelPickerHoverClose(),
    [cancelModelPickerHoverClose],
  );

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
    const plugins = new Map<string, InstalledCodexPlugin>();
    for (const plugin of installedPlugins) {
      for (const skillName of plugin.skillNames) {
        plugins.set(skillName, plugin);
      }
    }
    return plugins;
  }, [installedPlugins]);
  const unavailablePluginSkillNames = useMemo(
    () =>
      new Set(
        installedPlugins
          .filter((plugin) => !plugin.installable)
          .flatMap((plugin) => plugin.skillNames),
      ),
    [installedPlugins],
  );
  const slashCommandSuggestions = useMemo(() => {
    const selectedNames = new Set(selectedComposerSkillNames);
    const suggestions = slashCommandSuggestionsForPrompt(
      prompt,
      installedSkills.filter(
        (skill) =>
          !selectedNames.has(skill.name) &&
          !unavailablePluginSkillNames.has(skill.name),
      ),
    );
    return [
      ...suggestions.filter(
        (suggestion) =>
          suggestion.kind !== "skill" &&
          (selectedComposerSkillNames.length === 0 ||
            suggestion.kind === "plan" ||
            suggestion.kind === "execute" ||
            suggestion.kind === "review"),
      ),
      ...suggestions.filter(
        (suggestion) =>
          suggestion.kind === "skill" &&
          installedPluginBySkillName.has(suggestion.skill.name),
      ),
      ...suggestions.filter(
        (suggestion) =>
          suggestion.kind === "skill" &&
          !installedPluginBySkillName.has(suggestion.skill.name),
      ),
    ];
  }, [
    installedPluginBySkillName,
    installedSkills,
    prompt,
    selectedComposerSkillNames,
    unavailablePluginSkillNames,
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
      suggestion.kind === "execute" ||
      suggestion.kind === "review"
        ? [{ index, mode: suggestion.kind }]
        : [],
  );
  const skillSuggestions = slashCommandSuggestions.flatMap(
    (suggestion, index) =>
      suggestion.kind === "skill" ? [{ index, skill: suggestion.skill }] : [],
  );
  const pluginSkillSuggestions = skillSuggestions.flatMap(
    ({ index, skill }) => {
      const plugin = installedPluginBySkillName.get(skill.name);
      return plugin ? [{ index, plugin, skill }] : [];
    },
  );
  const standaloneSkillSuggestions = skillSuggestions.filter(
    ({ skill }) => !installedPluginBySkillName.has(skill.name),
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
      if (kind === "terminal") return t.terminal;
      if (kind === "browser") return t.browser;
      if (kind === "markdown") return t.markdownReader;
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
    (tabId: string) => {
      const closesLastTab = closesLastWorkspaceTab(workspaceTabs, tabId);
      dispatchWorkspaceTab({ type: "close", tabId });
      if (closesLastTab) {
        setWorkspaceDockOpen(false);
      }
    },
    [dispatchWorkspaceTab, workspaceTabs],
  );

  const openWorkspaceTabForThread = useCallback(
    (
      threadId: string,
      kind: WorkspaceTabKind,
      options: WorkspaceTabOpenOptions = {},
    ) => {
      setWorkspaceTabsByThread((current) => {
        const state = current[threadId] ?? emptyWorkspaceTabs();
        const existing = options.forceNew
          ? undefined
          : state.tabs.find(
              (tab) =>
                tab.kind === kind &&
                (options.reuseKind ||
                  (!options.path && !options.url) ||
                  tab.path === options.path ||
                  tab.url === options.url),
            );
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
            [threadId]: reduceWorkspaceTabs(updated, {
              type: "activate",
              tabId: existing.id,
            }),
          };
        }

        const index = state.tabs.filter((tab) => tab.kind === kind).length + 1;
        const tab: WorkspaceTab = {
          id: `${threadId}-${kind}-${++workspaceTabSerial.current}`,
          kind,
          title: pathTitle ?? (index > 1 ? `${baseTitle} ${index}` : baseTitle),
          ...(options.path ? { path: options.path } : {}),
          ...(options.revision ? { revision: options.revision } : {}),
          ...(options.url ? { url: options.url } : {}),
        };
        return {
          ...current,
          [threadId]: reduceWorkspaceTabs(state, {
            type: "open",
            tab,
          }),
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
        const url = normalizeBrowserAddress(href);
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
  const openAutomationThread = useCallback(
    async (threadId: string) => {
      const refreshed = await window.artemis.getSnapshot();
      setSnapshot((current) => preserveLoadedEvents(refreshed, current));
      const thread = refreshed.threads.find(
        (candidate) => candidate.id === threadId,
      );
      if (!thread) return;
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
        environmentPanelOpen ? ENVIRONMENT_PANEL_RESERVED_WORKSPACE_WIDTH : 0,
      ),
    [environmentPanelOpen],
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
      return clampWorkspaceDockWidth(
        drag.startWidth + drag.startX - clientX,
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
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const currentWidth =
        workspaceDock.current?.getBoundingClientRect().width ??
        workspaceDockWidthRef.current ??
        currentWorkspaceDockBounds().min;
      const step = event.shiftKey ? 64 : 24;
      const width = clampWorkspaceDockWidth(
        currentWidth + (event.key === "ArrowLeft" ? step : -step),
        currentWorkspaceDockBounds(),
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
    if (theme === "system") {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = theme;
    }
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
    if (
      runtimeSettings?.workspaceDockWidth !== undefined &&
      !workspaceDockResizing
    ) {
      setWorkspaceDockWidth(runtimeSettings.workspaceDockWidth);
    }
  }, [runtimeSettings?.workspaceDockWidth, workspaceDockResizing]);

  useLayoutEffect(() => {
    if (!workspaceDockOpen || workspaceDockWidth !== undefined) return;
    const timer = window.setTimeout(() => {
      const measured = workspaceDock.current?.getBoundingClientRect().width;
      if (measured) setWorkspaceDockWidth(Math.round(measured));
    }, 280);
    return () => window.clearTimeout(timer);
  }, [workspaceDockOpen, workspaceDockWidth]);

  useEffect(() => {
    if (!skillCommandMenuOpen) return;
    let mounted = true;
    setSkillsLoading(true);
    setSkillsError(undefined);
    void Promise.all([
      window.artemis.listInstalledSkills(),
      window.artemis.listCodexPlugins().catch(() => []),
    ])
      .then(([skills, plugins]) => {
        if (!mounted) return;
        setInstalledSkills(skills);
        setInstalledPlugins(plugins);
      })
      .catch((error) => {
        if (mounted) {
          setSkillsError(
            error instanceof Error ? error.message : String(error),
          );
        }
      })
      .finally(() => {
        if (mounted) setSkillsLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [skillCommandMenuOpen]);

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
    const optionTop = option.offsetTop;
    const optionBottom = optionTop + option.offsetHeight;
    if (optionTop < menu.scrollTop) {
      menu.scrollTop = Math.max(0, optionTop - 6);
    } else if (optionBottom > menu.scrollTop + menu.clientHeight) {
      menu.scrollTop = optionBottom - menu.clientHeight + 6;
    }
  }, [
    activeSlashSuggestion,
    skillCommandMenuOpen,
    slashCommandSuggestions.length,
  ]);

  useEffect(() => {
    let mounted = true;
    void window.artemis.getSnapshot().then((value) => {
      if (!mounted) return;
      setSnapshot(value);
      const project = value.projects[0];
      setActiveProjectId(project?.id);
      setActiveThreadId(undefined);
      setMode("execute");
    });
    void window.artemis
      .getSettings()
      .then((value) => {
        if (mounted) {
          projectOrderPersistence.current?.initialize(value.projectOrder ?? []);
          setApprovalPolicy(value.approvalPolicy);
          setRuntimeSettings(value);
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
        const grouped = new Map<string, AgentEvent[]>();
        for (const event of batch) {
          const events = grouped.get(event.threadId) ?? [];
          events.push(event);
          grouped.set(event.threadId, events);
        }
        const events = { ...current.events };
        for (const [threadId, incoming] of grouped) {
          const existing = events[threadId] ?? [];
          const appended = [...existing];
          let lastSeq = appended.at(-1)?.seq ?? -1;
          for (const event of incoming) {
            if (
              event.seq <= lastSeq &&
              appended.some((candidate) => candidate.eventId === event.eventId)
            ) {
              continue;
            }
            appended.push(event);
            lastSeq = Math.max(lastSeq, event.seq);
          }
          events[threadId] = appended;
        }
        const threadEvents = batch.filter(eventChangesThread);
        return {
          ...current,
          events,
          threads:
            threadEvents.length === 0
              ? current.threads
              : current.threads.map((thread) => {
                  const updates = threadEvents.filter(
                    (event) => event.threadId === thread.id,
                  );
                  if (updates.length === 0) return thread;
                  return updates.reduce(
                    (updated, event) => ({
                      ...updated,
                      status: updateThreadStatus(updated, event),
                      mode:
                        event.payload.type === "turn.started"
                          ? event.payload.mode
                          : updated.mode,
                    }),
                    thread,
                  );
                }),
        };
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
          if (activeThreadIdRef.current === event.threadId) {
            setWorkspaceDockOpen(true);
          }
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
          const message = `${appCopy(localeRef.current).turnError} ${event.payload.message}`;
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
          const recoveredMessages = event.payload.messages;
          recoveredQueueEventIds.current.add(event.eventId);
          setComposerDrafts((current) =>
            restoreComposerMessages(
              current,
              conversationDraftKey(undefined, event.threadId),
              recoveredMessages,
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
      unsubscribe();
      unsubscribeBatch();
      unsubscribeActivities();
      if (pendingAgentFrame.current !== undefined) {
        window.cancelAnimationFrame(pendingAgentFrame.current);
        pendingAgentFrame.current = undefined;
      }
      pendingAgentEvents.current = [];
    };
  }, []);

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

    const readyTimer = setTimeout(() => {
      window.artemis.rendererReady();
    }, 0);
    return () => clearTimeout(readyTimer);
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
  const temporaryThreads = sortProjectThreads(
    (snapshot?.threads ?? [])
      .filter((thread) => !thread.projectId && !thread.archived)
      .filter((thread) => !isWorkspaceDraftThread(thread))
      .filter(
        (thread) =>
          !query.trim() ||
          thread.title.toLowerCase().includes(query.trim().toLowerCase()),
      ),
    snapshot?.events ?? {},
    promptSubmittedAtByThread,
  );
  const activeProject = projects.find(
    (project) => project.id === activeProjectId,
  );
  const activeThread = (snapshot?.threads ?? []).find(
    (thread) => thread.id === activeThreadId,
  );
  const activeWorkspaceLabel = activeProject?.name ?? t.temporaryConversation;
  const [emptyConversationPrefix, emptyConversationSuffix = ""] =
    t.emptyConversationPrompt.split("{{workspace}}");
  const emptyConversationLabel = activeProject
    ? `${emptyConversationPrefix}${activeProject.name}${emptyConversationSuffix}`
    : t.temporaryConversationPrompt;
  const activeTurnFailure = activeThreadId
    ? turnFailureNotices[activeThreadId]
    : undefined;
  const dockWidthBounds = workspaceDockWidthBounds(
    workspaceContent.current?.clientWidth ?? window.innerWidth,
    window.innerWidth,
    environmentPanelOpen ? ENVIRONMENT_PANEL_RESERVED_WORKSPACE_WIDTH : 0,
  );
  const dockWidthNow = clampWorkspaceDockWidth(
    workspaceDockWidth ?? dockWidthBounds.min,
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
      reviewDiff?.files.find((file) => file.id === selectedReviewFileId) ??
      reviewDiff?.files[0],
    [reviewDiff, selectedReviewFileId],
  );
  useEffect(() => {
    if (!activeThreadId) return;
    void window.artemis.prepareThread(activeThreadId).catch(() => {
      // Starting the turn reports an actionable error if background warming failed.
    });
  }, [activeThreadId]);
  useEffect(() => {
    if (
      !activeThreadId ||
      loadedEventThreads.current.has(activeThreadId) ||
      loadingEventThreads.current.has(activeThreadId)
    ) {
      return;
    }
    const threadId = activeThreadId;
    let mounted = true;
    loadingEventThreads.current.add(threadId);
    void window.artemis
      .getThreadEvents(threadId)
      .then((history) => {
        if (!mounted) return;
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
        if (mounted) {
          setToast(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        loadingEventThreads.current.delete(threadId);
      });
    return () => {
      mounted = false;
    };
  }, [activeThreadId]);
  const activeEvents = activeThread
    ? (snapshot?.events[activeThread.id] ?? [])
    : [];
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
      cached.mode === activeThread.mode &&
      cached.eventCount <= activeEvents.length &&
      (cached.eventCount === 0 ||
        activeEvents[cached.eventCount - 1]?.eventId === cached.lastEventId);
    const state = prefixMatches
      ? reduceAgentEventBatch(
          cached.state,
          activeEvents.slice(cached.eventCount),
        )
      : reduceAgentEvents(activeThread.id, activeEvents, activeThread.mode);
    threadStateCache.current.delete(activeThread.id);
    threadStateCache.current.set(activeThread.id, {
      eventCount: activeEvents.length,
      ...(activeEvents.at(-1)
        ? { lastEventId: activeEvents.at(-1)!.eventId }
        : {}),
      mode: activeThread.mode,
      state,
    });
    if (threadStateCache.current.size > 8) {
      const oldestThreadId = threadStateCache.current.keys().next().value;
      if (oldestThreadId) threadStateCache.current.delete(oldestThreadId);
    }
    const liveActivities = liveChildActivities[activeThread.id];
    if (!liveActivities) return state;
    const childAgents = { ...state.childAgents };
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
    return { ...state, childAgents };
  }, [activeEvents, activeThread?.id, activeThread?.mode, liveChildActivities]);
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
    () => Object.values(threadState?.childAgents ?? {}),
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
    if (
      latestAgentTeam.status !== "completed" &&
      latestAgentTeam.status !== "aborted"
    ) {
      setWorkspaceDockOpen(true);
    }
  }, [activeThreadId, latestAgentTeam, t.agentTeam]);
  const activePendingUserInputId = threadState?.order
    .filter((entry) => entry.startsWith("input:"))
    .map((entry) => entry.slice("input:".length))
    .find((id) => threadState.userInputs[id]?.status === "pending");
  useEffect(() => {
    const previousId = previousPendingUserInputId.current;
    previousPendingUserInputId.current = activePendingUserInputId;
    if (!previousId || activePendingUserInputId) return;
    const frame = window.requestAnimationFrame(() => {
      promptInput.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activePendingUserInputId]);
  const turnActive =
    threadState?.status === "running" ||
    threadState?.status === "waiting-approval" ||
    threadState?.status === "waiting-user-input";
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
  const activeModelHighestThinkingLevel =
    activeModel?.thinkingLevels?.at(-1) ??
    activeModel?.highestThinkingLevel ??
    "high";
  const activeUltraMode =
    activeModelSupportsReasoning && activeSelection?.ultraMode === true;
  const activeThinkingLevel = activeUltraMode
    ? t.ultraMode
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
  const modelPickerThinkingLevels = thinkingLevelsForModel(activeModel);

  const switchComposerModel = useCallback(
    async (model: SettingsSnapshot["models"][number]) => {
      if (!runtimeSettings || turnActive || busy) return;
      setModelPickerOpen(false);
      setBusy(true);
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
        setBusy(false);
      }
    },
    [
      activeProjectId,
      activeSelection,
      activeThread,
      busy,
      createThread,
      runtimeSettings,
      t.modelSwitchFailed,
      turnActive,
    ],
  );

  const switchComposerThinking = useCallback(
    async (thinkingLevel: ThinkingLevel, ultraMode = false) => {
      if (!activeSelection || turnActive || busy) return;
      setModelPickerOpen(false);
      setBusy(true);
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
        setBusy(false);
      }
    },
    [
      activeProjectId,
      activeSelection,
      activeThread,
      busy,
      createThread,
      t.modelSwitchFailed,
      turnActive,
    ],
  );
  const runPresentation = useMemo(
    () => deriveRunPresentation(activeEvents, clockMs),
    [activeEvents, clockMs],
  );
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

  useEffect(() => {
    if (!turnActive) return;
    setClockMs(Date.now());
    const timer = window.setInterval(() => setClockMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [turnActive]);

  useEffect(() => {
    document.body.classList.toggle("sidebar-collapsed", !sidebarOpen);
    return () => document.body.classList.remove("sidebar-collapsed");
  }, [sidebarOpen]);

  useEffect(() => {
    timelinePinned.current = true;
    const frame = window.requestAnimationFrame(() => {
      const container = timelineScroll.current;
      if (container) container.scrollTop = container.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeThreadId]);

  useLayoutEffect(() => {
    const container = timelineScroll.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    let frame: number | undefined;
    const observer = new ResizeObserver(() => {
      if (!timelinePinned.current) return;
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = undefined;
        if (timelinePinned.current) {
          container.scrollTop = container.scrollHeight;
        }
      });
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      if (frame !== undefined) window.cancelAnimationFrame(frame);
    };
  }, []);

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

  const reviewDiffCacheKey = useCallback(
    (threadId: string, scope: ReviewScope) => {
      const baseRef = scope === "branch" ? reviewBaseRef.trim() : "";
      const version = reviewDiffVersion.current.get(threadId) ?? 0;
      return `${threadId}\u0000${scope}\u0000${baseRef}\u0000${threadState?.lastSeq ?? 0}\u0000${version}`;
    },
    [reviewBaseRef, threadState?.lastSeq],
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
    [reviewBaseRef, reviewDiffCacheKey],
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

  const prefetchReviewDiffs = useCallback(
    async (force = false) => {
      if (!activeThreadId) return;
      const eagerScopes: ReviewScope[] = ["unstaged", "staged"];
      await Promise.all(
        eagerScopes.map((scope) =>
          loadCachedReviewDiff(activeThreadId, scope, force).catch(
            () => undefined,
          ),
        ),
      );
    },
    [activeThreadId, loadCachedReviewDiff],
  );

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
    const cached = activeThreadId
      ? reviewDiffCache.current.get(reviewDiffCacheKey(activeThreadId, scope))
      : undefined;
    setReviewDiff(cached);
    setSelectedReviewFileId(undefined);
    setCommentLineId(undefined);
    setCommentBody("");
  };

  const openReviewScopePanel = (scope: ReviewScope) => {
    selectReviewScope(scope);
    openReviewPanel();
  };

  useEffect(() => {
    if (workspaceDockOpen && activeWorkspaceTab?.kind === "review") {
      void prefetchReviewDiffs();
      void refreshDiff();
    }
  }, [
    activeWorkspaceTab?.kind,
    prefetchReviewDiffs,
    refreshDiff,
    threadState?.changedFiles.length,
    workspaceDockOpen,
  ]);

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
        await Promise.all([refreshDiff(true), prefetchReviewDiffs(true)]);
      } catch (error) {
        setToast(error instanceof Error ? error.message : String(error));
      } finally {
        setReviewBusy(false);
      }
    },
    [
      activeThreadId,
      invalidateReviewDiffCache,
      prefetchReviewDiffs,
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
      if (!activeThreadId || !commentBody.trim() || reviewBusy) return;
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
          setMode("execute");
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

  const deleteThread = useCallback(
    async (thread: Thread) => {
      if (!(await requestConfirmation(t.deleteTaskConfirm, "danger"))) return;
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
        if (activeThreadId === thread.id) {
          setActiveThreadId(nextThread?.id);
          setMode(nextThread?.mode ?? "execute");
          setWorkspaceDockOpen(false);
          window.requestAnimationFrame(() => promptInput.current?.focus());
        }
      } catch (error) {
        setToast(
          `${t.taskError} ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        setThreadMenuId(undefined);
      }
    },
    [
      activeThreadId,
      requestConfirmation,
      snapshot?.threads,
      t.deleteTaskConfirm,
      t.taskError,
    ],
  );

  const setThreadArchived = useCallback(
    async (thread: Thread, archived: boolean) => {
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
        } else {
          setActiveView("workspace");
          setActiveProjectId(updated.projectId);
          setActiveThreadId(updated.id);
          setMode(updated.mode);
          window.requestAnimationFrame(() => promptInput.current?.focus());
        }
      } catch (error) {
        setToast(
          `${t.taskError} ${error instanceof Error ? error.message : String(error)}`,
        );
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
    ) => {
      try {
        await window.artemis.resolveApproval({
          approvalId: approval.approvalId,
          nonce: approval.nonce,
          approved,
          scope,
        });
      } catch (error) {
        setToast(
          `${t.taskError} ${error instanceof Error ? error.message : String(error)}`,
        );
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
    (selected: PromptAttachment[]) => {
      const next = [...attachments];
      let imageCount = next.filter(isPromptImage).length;
      let limited = false;
      for (const attachment of selected) {
        if (
          next.length >= MAX_PROMPT_ATTACHMENTS ||
          (isPromptImage(attachment) && imageCount >= MAX_PROMPT_IMAGES)
        ) {
          limited = true;
          continue;
        }
        next.push(attachment);
        if (isPromptImage(attachment)) {
          imageCount += 1;
        }
      }
      setAttachments(next);
      if (limited) {
        setToast(t.attachmentLimit);
      }
    },
    [attachments, setAttachments, t.attachmentLimit],
  );

  const selectPromptAttachments = useCallback(async () => {
    if (attachments.length >= MAX_PROMPT_ATTACHMENTS) {
      setToast(t.attachmentLimit);
      return;
    }
    try {
      const selected = await window.artemis.selectPromptAttachments();
      if (selected?.length) {
        addPromptAttachments(selected);
      }
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
        addPromptAttachments(await window.artemis.readPromptAttachments(files));
      } catch (error) {
        setToast(
          `${t.taskError} ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
    [addPromptAttachments, t.taskError],
  );

  const handleAttachmentPaste = useCallback(
    async (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
      const files = Array.from(event.clipboardData.files);
      if (files.length === 0) return;
      event.preventDefault();
      try {
        addPromptAttachments(await window.artemis.readPromptAttachments(files));
      } catch (error) {
        setToast(
          `${t.taskError} ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
    [addPromptAttachments, t.taskError],
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
      setPromptHistory((current) =>
        addPromptHistoryEntry(current, submittedPrompt),
      );
      promptHistoryNavigation.current = { index: -1, draft: "" };
      setPrompt("");
      setSelectedComposerSkillNames([]);
    },
    [setPrompt, setSelectedComposerSkillNames],
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

  const sendPrompt = useCallback(async () => {
    const rawPrompt = prompt.trim();
    if (busy) return;
    const runModeCommand = parseRunModeCommand(rawPrompt);
    if (runModeCommand && runModeCommand.kind === "multiple") {
      setToast({ error: true, message: t.multipleModeCommands });
      return;
    }
    if (runModeCommand && runModeCommand.kind === "command" && turnActive) {
      setToast({ error: true, message: t.modeCommandWhileRunning });
      return;
    }
    const submittedMode =
      runModeCommand?.kind === "command" ? runModeCommand.mode : mode;
    const commandPrompt =
      runModeCommand?.kind === "command" ? runModeCommand.prompt : rawPrompt;
    if (runModeCommand?.kind === "command") {
      setMode(submittedMode);
      if (
        !commandPrompt &&
        attachments.length === 0 &&
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
    const goalMatch = commandPrompt.match(/^\/goal(?:\s+([\s\S]*))?$/iu);
    const goalArgument = goalMatch?.[1]?.trim();
    if (goalMatch && !goalArgument) {
      setToast(
        activeThread?.goal ? `${t.goal}: ${activeThread.goal}` : t.noGoal,
      );
      clearSubmittedPrompt(rawPrompt);
      return;
    }

    const clearingGoal = goalArgument?.toLocaleLowerCase() === "clear";
    if (goalMatch && clearingGoal && !activeThread) {
      setToast(t.noGoal);
      clearSubmittedPrompt(rawPrompt);
      return;
    }

    const visibleText =
      goalMatch && goalArgument && !clearingGoal
        ? goalArgument
        : commandPrompt || (attachments.length ? t.inspectAttachments : "");
    const text = goalMatch
      ? visibleText
      : promptWithSelectedSkills(visibleText, selectedSkills);
    if (!text || busy) return;
    const pendingAttachments = attachments;
    const submittedAt = Date.now();
    let createdThread: Thread | undefined;
    setBusy(true);
    try {
      if (compactMatch && activeThread) {
        clearSubmittedPrompt(rawPrompt);
        await window.artemis.compactThread(
          activeThread.id,
          compactInstructions,
        );
        return;
      }
      if (goalMatch && clearingGoal && activeThread) {
        const updated = await window.artemis.setThreadGoal(
          activeThread.id,
          null,
        );
        updateThreadInSnapshot(updated);
        clearSubmittedPrompt(rawPrompt);
        setToast(t.goalCleared);
        return;
      }

      const thread = activeThread ?? (await createThread());
      if (!thread) return;
      if (!activeThread) createdThread = thread;
      let currentThread = thread;
      if (goalMatch && goalArgument) {
        currentThread = await window.artemis.setThreadGoal(
          thread.id,
          goalArgument,
        );
        updateThreadInSnapshot(currentThread);
        setToast(t.goalSet);
      }

      if (activeThread && turnActive) {
        await window.artemis.followUpTurn({
          threadId: currentThread.id,
          text,
          ...(pendingAttachments.length
            ? { attachments: pendingAttachments }
            : {}),
        });
        recordPromptSubmission(currentThread.id, submittedAt);
        clearSubmittedPrompt(rawPrompt);
        setAttachments([]);
        return;
      }
      const result = await window.artemis.startTurn({
        threadId: currentThread.id,
        text,
        mode: submittedMode,
        submittedAt,
        ...(pendingAttachments.length
          ? { attachments: pendingAttachments }
          : {}),
      });
      recordPromptSubmission(currentThread.id, submittedAt);
      updateThreadInSnapshot(result.thread);
      clearSubmittedPrompt(rawPrompt);
      setAttachments([]);
    } catch (error) {
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
    attachments,
    busy,
    clearSubmittedPrompt,
    createThread,
    mode,
    prompt,
    recordPromptSubmission,
    selectedSkills,
    t.compactFailed,
    t.compactRequiresTask,
    t.compactWhileRunning,
    t.goal,
    t.goalCleared,
    t.goalSet,
    t.inspectAttachments,
    t.modeCommandWhileRunning,
    t.multipleModeCommands,
    t.noGoal,
    t.taskError,
    turnActive,
    updateThreadInSnapshot,
  ]);

  const replaceQueuedMessages = useCallback(
    async (followUp: string[]) => {
      if (!activeThread || busy) return;
      setBusy(true);
      try {
        await window.artemis.replaceTurnQueue({
          threadId: activeThread.id,
          followUp,
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
    [activeThread, busy, t.taskError],
  );

  const deleteQueuedMessage = useCallback(
    (index: number) => {
      if (!queuedFollowUps[index]) return;
      return replaceQueuedMessages(
        queuedFollowUps.filter((_message, candidate) => candidate !== index),
      );
    },
    [queuedFollowUps, replaceQueuedMessages],
  );

  const moveQueuedMessageToFront = useCallback(
    (index: number) => {
      const message = queuedFollowUps[index];
      if (!message || index === 0) return;
      return replaceQueuedMessages([
        message,
        ...queuedFollowUps.slice(0, index),
        ...queuedFollowUps.slice(index + 1),
      ]);
    },
    [queuedFollowUps, replaceQueuedMessages],
  );

  const saveQueuedMessage = useCallback(
    (index: number, value: string) => {
      const message = value.trim();
      if (!message || !queuedFollowUps[index]) return;
      return replaceQueuedMessages(
        queuedFollowUps.map((candidate, candidateIndex) =>
          candidateIndex === index ? message : candidate,
        ),
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
        setModelPickerSection("model");
      } else if (modifier && event.altKey && event.key.toLowerCase() === "b") {
        event.preventDefault();
        toggleReviewPanel();
      } else if (modifier && event.key.toLowerCase() === "b") {
        event.preventDefault();
        setSidebarOpen((open) => !open);
      } else if (modifier && event.key.toLowerCase() === "j") {
        event.preventDefault();
        toggleTerminalPanel();
      } else if (modifier && event.key.toLowerCase() === "n") {
        event.preventDefault();
        beginNewConversation();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [beginNewConversation, toggleReviewPanel, toggleTerminalPanel]);

  if (!snapshot) {
    return (
      <main className="loading-shell">
        <ArtemisMark />
        <span>Artemis</span>
      </main>
    );
  }

  return (
    <main
      className="app-shell"
      data-platform={snapshot.platform}
      data-renderer-ready="true"
      style={
        {
          "--project-sidebar-width": sidebarOpen
            ? `${projectSidebarWidth ?? PROJECT_SIDEBAR_WIDTH_DEFAULT}px`
            : "0px",
        } as CSSProperties
      }
    >
      <aside className="activity-bar">
        <ArtemisMark />
        <button
          className={
            activeView === "workspace"
              ? "activity-button active"
              : "activity-button"
          }
          aria-label={t.projects}
          aria-expanded={sidebarOpen}
          onClick={() => {
            if (activeView === "workspace") {
              setSidebarOpen((open) => !open);
            } else {
              setActiveView("workspace");
              setSidebarOpen(true);
            }
          }}
          title={t.projects}
        >
          <FolderIcon />
        </button>
        <button
          aria-label={t.resourceCenter}
          className={
            activeView === "resources"
              ? "activity-button active"
              : "activity-button"
          }
          onClick={() => setActiveView("resources")}
          title={t.resourceCenter}
        >
          <ResourceIcon />
        </button>
        <button
          className={
            activeView === "token-usage"
              ? "activity-button active"
              : "activity-button"
          }
          onClick={() => setActiveView("token-usage")}
          aria-label={t.tokenUsage}
          title={t.tokenUsage}
        >
          <TokenUsageIcon />
        </button>
        <button
          aria-label={t.automations}
          className={
            activeView === "automations"
              ? "activity-button active"
              : "activity-button"
          }
          onClick={() => setActiveView("automations")}
          title={t.automations}
        >
          <AutomationIcon />
        </button>
        <button
          aria-label={t.archiveLibrary}
          className={
            activeView === "archive"
              ? "activity-button active"
              : "activity-button"
          }
          onClick={() => setActiveView("archive")}
          title={t.archiveLibrary}
        >
          <ArchiveIcon />
        </button>
        <div className="activity-spacer" />
        <button
          aria-label={t.settings}
          className="activity-button"
          onClick={() => openSettings()}
          title={t.settings}
        >
          <SettingsIcon />
        </button>
      </aside>

      <aside className="sidebar" ref={projectSidebar}>
        <div className="sidebar-header">
          <span>{t.tasks}</span>
          <div className="sidebar-header-actions">
            <label
              className={query ? "sidebar-search has-query" : "sidebar-search"}
            >
              <SearchIcon />
              <input
                aria-label={t.search}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t.search}
                value={query}
              />
            </label>
            <button
              className="icon-button"
              onClick={() => void openProject()}
              title={t.openProject}
            >
              <PlusIcon />
            </button>
          </div>
        </div>
        <div className="project-tree">
          <section className="project-group project-collection">
            <div className="project-row">
              <button
                aria-expanded={projectsOpen}
                aria-label={
                  projectsOpen ? t.collapseProjects : t.expandProjects
                }
                className="project-toggle"
                onClick={() => setProjectsOpen((open) => !open)}
                title={projectsOpen ? t.collapseProjects : t.expandProjects}
                type="button"
              >
                <FolderIcon open={projectsOpen} />
              </button>
              <button
                aria-expanded={projectsOpen}
                className="project-select"
                onClick={() => setProjectsOpen((open) => !open)}
                type="button"
              >
                <span className="project-title">{t.projects}</span>
              </button>
            </div>
          </section>
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
            const projectThreads = sortProjectThreads(
              snapshot.threads
                .filter(
                  (thread) =>
                    thread.projectId === project.id && !thread.archived,
                )
                .filter((thread) => !isWorkspaceDraftThread(thread))
                .filter(
                  (thread) =>
                    matchesProject ||
                    thread.title
                      .toLowerCase()
                      .includes(query.trim().toLowerCase()),
                ),
              snapshot.events,
              promptSubmittedAtByThread,
            );
            const expanded = expandedProjectIds.has(project.id);
            const projectOpen = !collapsedProjectIds.has(project.id);
            const visibleThreads = expanded
              ? projectThreads
              : projectThreads.slice(0, PROJECT_THREAD_PREVIEW_LIMIT);
            return (
              <section
                aria-level={2}
                className={`project-group nested-project${
                  draggedProjectId === project.id ? " dragging" : ""
                }${
                  projectDropTarget?.projectId === project.id
                    ? ` drop-${projectDropTarget.edge}`
                    : ""
                }`}
                hidden={!projectsOpen && !query.trim()}
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
                role="group"
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
                    aria-controls={`project-thread-list-${project.id}`}
                    aria-expanded={projectOpen}
                    aria-label={
                      projectOpen
                        ? t.collapseProjectHistory
                        : t.expandProjectHistory
                    }
                    className="project-toggle"
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
                    aria-controls={`project-thread-list-${project.id}`}
                    aria-expanded={projectOpen}
                    className="project-select"
                    onClick={() => toggleProjectHistory(project.id)}
                    title={project.path}
                  >
                    <span className="project-title">{project.name}</span>
                  </button>
                  <button
                    aria-label={`${t.newTask}: ${project.name}`}
                    className="project-new-thread"
                    onClick={() => beginNewConversation(project.id)}
                    title={t.newTask}
                  >
                    <PlusIcon />
                  </button>
                  <button
                    aria-label={t.moreProjectActions}
                    className="project-action"
                    onClick={() => {
                      setThreadMenuId(undefined);
                      setProjectMenuId((current) =>
                        current === project.id ? undefined : project.id,
                      );
                    }}
                    title={t.moreProjectActions}
                  >
                    ···
                  </button>
                  {projectMenuId === project.id && (
                    <div className="project-menu">
                      <button
                        className="danger"
                        disabled={hasActiveTask}
                        onClick={() => void removeProject(project)}
                        title={
                          hasActiveTask
                            ? t.stopTasksBeforeRemove
                            : t.removeProject
                        }
                      >
                        {t.removeProject}
                      </button>
                    </div>
                  )}
                </div>
                {projectOpen && (
                  <div
                    className="project-thread-list"
                    id={`project-thread-list-${project.id}`}
                  >
                    {visibleThreads.map((thread) => (
                      <div
                        className={`project-thread-row ${thread.id === activeThreadId ? "selected" : ""}`}
                        key={thread.id}
                      >
                        {threadRename?.threadId === thread.id ? (
                          <form
                            className="thread-rename-form"
                            onSubmit={(event) => {
                              event.preventDefault();
                              void renameThread(thread, threadRename.title);
                            }}
                          >
                            <input
                              aria-label={t.taskNamePrompt}
                              autoFocus
                              className="thread-rename-input"
                              onBlur={(event) =>
                                void renameThread(
                                  thread,
                                  event.currentTarget.value,
                                )
                              }
                              onChange={(event) =>
                                setThreadRename((current) =>
                                  current?.threadId === thread.id
                                    ? {
                                        ...current,
                                        title: event.target.value,
                                      }
                                    : current,
                                )
                              }
                              onKeyDown={(event) => {
                                if (event.key === "Escape") {
                                  event.preventDefault();
                                  setThreadRename(undefined);
                                }
                              }}
                              value={threadRename.title}
                            />
                          </form>
                        ) : (
                          <>
                            <button
                              className="thread-select"
                              onClick={() => {
                                discardNewConversationDraft();
                                setActiveView("workspace");
                                setActiveProjectId(project.id);
                                setActiveThreadId(thread.id);
                                setMode(thread.mode);
                                setThreadMenuId(undefined);
                              }}
                            >
                              {thread.status !== "idle" && (
                                <span
                                  className={`status-dot ${thread.status}`}
                                />
                              )}
                              <span
                                className="thread-title"
                                onPointerEnter={prepareThreadTitleScroll}
                                title={visibleThreadTitle(thread.title)}
                              >
                                <span className="thread-title-text">
                                  {visibleThreadTitle(thread.title)}
                                </span>
                              </span>
                            </button>
                            <button
                              aria-label={t.moreActions}
                              className="thread-action"
                              onClick={() => {
                                setProjectMenuId(undefined);
                                setThreadMenuId((current) =>
                                  current === thread.id ? undefined : thread.id,
                                );
                              }}
                              title={t.moreActions}
                            >
                              ···
                            </button>
                            {threadMenuId === thread.id && (
                              <div className="thread-menu">
                                <button
                                  onClick={() => beginRenameThread(thread)}
                                >
                                  {t.renameTask}
                                </button>
                                <button
                                  disabled={
                                    thread.status === "running" ||
                                    thread.status === "waiting-approval"
                                  }
                                  onClick={() => void forkThread(thread)}
                                >
                                  {t.forkTask}
                                </button>
                                <button
                                  disabled={
                                    thread.status === "running" ||
                                    thread.status === "waiting-approval"
                                  }
                                  onClick={() =>
                                    void setThreadArchived(thread, true)
                                  }
                                >
                                  {t.archiveTask}
                                </button>
                                <button
                                  className="danger"
                                  disabled={
                                    thread.status === "running" ||
                                    thread.status === "waiting-approval"
                                  }
                                  onClick={() => void deleteThread(thread)}
                                >
                                  {t.deleteTask}
                                </button>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    ))}
                    {projectThreads.length > PROJECT_THREAD_PREVIEW_LIMIT && (
                      <button
                        className="project-expand-toggle"
                        onClick={() =>
                          setExpandedProjectIds((current) => {
                            const next = new Set(current);
                            if (next.has(project.id)) next.delete(project.id);
                            else next.add(project.id);
                            return next;
                          })
                        }
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
          <section className="project-group temporary-conversations">
            <div className={`project-row ${!activeProjectId ? "active" : ""}`}>
              <span className="project-toggle" aria-hidden="true">
                <FolderIcon open />
              </span>
              <button
                className="project-select"
                onClick={beginTemporaryConversation}
                title={t.temporaryConversations}
                type="button"
              >
                <span className="project-title">
                  {t.temporaryConversations}
                </span>
              </button>
              <button
                aria-label={`${t.newTask}: ${t.temporaryConversations}`}
                className="project-new-thread"
                onClick={beginTemporaryConversation}
                title={t.newTask}
                type="button"
              >
                <PlusIcon />
              </button>
            </div>
            <div className="project-thread-list">
              {temporaryThreads.map((thread) => (
                <div
                  className={`project-thread-row ${thread.id === activeThreadId ? "selected" : ""}`}
                  key={thread.id}
                >
                  {threadRename?.threadId === thread.id ? (
                    <form
                      className="thread-rename-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void renameThread(thread, threadRename.title);
                      }}
                    >
                      <input
                        aria-label={t.taskNamePrompt}
                        autoFocus
                        className="thread-rename-input"
                        onBlur={(event) =>
                          void renameThread(thread, event.currentTarget.value)
                        }
                        onChange={(event) =>
                          setThreadRename((current) =>
                            current?.threadId === thread.id
                              ? { ...current, title: event.target.value }
                              : current,
                          )
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            event.preventDefault();
                            setThreadRename(undefined);
                          }
                        }}
                        value={threadRename.title}
                      />
                    </form>
                  ) : (
                    <>
                      <button
                        className="thread-select"
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
                        {thread.status !== "idle" && (
                          <span className={`status-dot ${thread.status}`} />
                        )}
                        <span
                          className="thread-title"
                          onPointerEnter={prepareThreadTitleScroll}
                          title={visibleThreadTitle(thread.title)}
                        >
                          <span className="thread-title-text">
                            {visibleThreadTitle(thread.title)}
                          </span>
                        </span>
                      </button>
                      <button
                        aria-label={t.moreActions}
                        className="thread-action"
                        onClick={() => {
                          setProjectMenuId(undefined);
                          setThreadMenuId((current) =>
                            current === thread.id ? undefined : thread.id,
                          );
                        }}
                        title={t.moreActions}
                        type="button"
                      >
                        ···
                      </button>
                      {threadMenuId === thread.id && (
                        <div className="thread-menu">
                          <button onClick={() => beginRenameThread(thread)}>
                            {t.renameTask}
                          </button>
                          <button
                            disabled={
                              thread.status === "running" ||
                              thread.status === "waiting-approval"
                            }
                            onClick={() => void forkThread(thread)}
                          >
                            {t.forkTask}
                          </button>
                          <button
                            disabled={
                              thread.status === "running" ||
                              thread.status === "waiting-approval"
                            }
                            onClick={() => void setThreadArchived(thread, true)}
                          >
                            {t.archiveTask}
                          </button>
                          <button
                            className="danger"
                            disabled={
                              thread.status === "running" ||
                              thread.status === "waiting-approval"
                            }
                            onClick={() => void deleteThread(thread)}
                          >
                            {t.deleteTask}
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
              {query.trim() && temporaryThreads.length === 0 && (
                <span className="project-no-matches">{t.noTasks}</span>
              )}
            </div>
          </section>
        </div>
        <div className="sidebar-footer">
          <span className="local-indicator" title={username}>
            <span aria-hidden="true" className="sidebar-profile-avatar">
              {runtimeSettings?.profileAvatar ? (
                <img alt="" src={runtimeSettings.profileAvatar} />
              ) : (
                userInitials(username)
              )}
            </span>
            <span className="local-user-name">{username}</span>
          </span>
          {runtimeSettings?.update.currentVersion && (
            <button
              aria-label={`${t.currentVersion} ${runtimeSettings.update.currentVersion}`}
              className="app-version"
              onClick={() => openSettings("maintenance")}
              title={`${t.currentVersion} ${runtimeSettings.update.currentVersion}`}
              type="button"
            >
              v{runtimeSettings.update.currentVersion}
            </button>
          )}
        </div>
      </aside>

      <div
        aria-label={t.resizeProjectsSidebar}
        aria-orientation="vertical"
        aria-valuemax={PROJECT_SIDEBAR_WIDTH_MAX}
        aria-valuemin={PROJECT_SIDEBAR_WIDTH_MIN}
        aria-valuenow={projectSidebarWidth ?? PROJECT_SIDEBAR_WIDTH_DEFAULT}
        className="project-sidebar-resizer"
        data-open={sidebarOpen}
        onKeyDown={resizeProjectSidebarFromKeyboard}
        onPointerCancel={cancelProjectSidebarResize}
        onPointerDown={beginProjectSidebarResize}
        onPointerMove={moveProjectSidebarResize}
        onPointerUp={finishProjectSidebarResize}
        role="separator"
        tabIndex={sidebarOpen ? 0 : -1}
      />

      <section className="workspace">
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
              locale={locale}
              onConfirm={requestConfirmation}
              onOpenThread={(threadId) => void openAutomationThread(threadId)}
              projects={projects}
            />
          </Suspense>
        ) : activeView === "archive" ? (
          <ArchivePage
            locale={locale}
            onOpen={(thread) => {
              discardNewConversationDraft();
              setActiveProjectId(thread.projectId);
              setActiveThreadId(thread.id);
              setMode(thread.mode);
              setActiveView("workspace");
            }}
            onDelete={(thread) => void deleteThread(thread)}
            onRestore={(thread) => void setThreadArchived(thread, false)}
            projects={projects}
            threads={snapshot.threads}
          />
        ) : activeView === "resources" ? (
          <Suspense fallback={<div className="view-loading">…</div>}>
            <ResourceCenter
              locale={locale}
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
            <header className="workspace-header">
              <div className="workspace-header-leading">
                <button
                  aria-expanded={sidebarOpen}
                  aria-label={t.leftSidebar}
                  className="left-sidebar-toggle"
                  onClick={() => setSidebarOpen((open) => !open)}
                  title={t.leftSidebar}
                >
                  <LeftSidebarIcon />
                </button>
                <div className="workspace-heading">
                  <strong>{activeWorkspaceLabel}</strong>
                  {activeThread && (
                    <>
                      <span className="header-separator">/</span>
                      <span className="workspace-thread-title">
                        {activeThread.title}
                      </span>
                      {activeThread.goal && (
                        <span className="goal-pill" title={activeThread.goal}>
                          <span aria-hidden="true">◎</span>
                          {t.goal}
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>
              <div className="header-actions">
                <span className="status-pill">
                  <span
                    className={`status-dot ${runPresentation.status === "completed" ? "idle" : runPresentation.status}`}
                  />
                  {runPresentation.status === "completed"
                    ? t.completed
                    : statusLabel(threadState, locale)}
                  {runPresentation.status !== "idle" && (
                    <time
                      dateTime={`PT${Math.floor(runPresentation.elapsedMs / 1_000)}S`}
                    >
                      {formatRunDuration(runPresentation.elapsedMs)}
                    </time>
                  )}
                </span>
                {activeProject && (
                  <EnvironmentPanel
                    actionsDisabled={
                      projectBranchActionsDisabled ||
                      Boolean(activeThread?.archived)
                    }
                    agents={environmentAgents}
                    attachments={attachments}
                    defaultOpen={!workspaceDockOpen}
                    dockOffset={
                      workspaceDockOpen ? Math.max(0, dockWidthNow - 50) : 0
                    }
                    dockOpen={workspaceDockOpen}
                    key={`${activeProject.id}:${activeThread?.id ?? "draft"}`}
                    locale={locale}
                    mcpUsages={environmentMcpUsages}
                    onAddProject={() => void openProject()}
                    onAddSources={() => void selectPromptAttachments()}
                    onConfirm={requestConfirmation}
                    onMessage={(message, error) =>
                      setToast(error ? { error: true, message } : message)
                    }
                    onOpenChange={setEnvironmentPanelOpen}
                    onOpenAgent={openChildAgentPanel}
                    onOpenReview={openReviewScopePanel}
                    onOpenTeam={openAgentTeamPanel}
                    project={activeProject}
                    {...(environmentRefreshKey
                      ? { refreshKey: environmentRefreshKey }
                      : {})}
                    sources={environmentSources}
                    taskTitle={activeThread?.title ?? activeProject.name}
                    teams={environmentTeams}
                  />
                )}
                {!activeThread?.archived && (
                  <button
                    aria-expanded={workspaceDockOpen}
                    aria-label={t.rightSidebar}
                    className="right-sidebar-toggle"
                    onClick={toggleRightSidebar}
                    title={t.rightSidebar}
                  >
                    <RightSidebarIcon />
                  </button>
                )}
              </div>
            </header>

            <div
              className="workspace-content"
              data-resizing={workspaceDockResizing || undefined}
              ref={workspaceContent}
            >
              <section className="conversation">
                <div
                  className="timeline-scroll"
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
                    timelinePinned.current = resolveTimelinePinned({
                      clientHeight: container.clientHeight,
                      pinned: timelinePinned.current,
                      scrollHeight: container.scrollHeight,
                      scrollTop: container.scrollTop,
                      userInitiated:
                        timelineScrollIntent.current ||
                        timelineScrollbarPointerActive.current,
                    });
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
                  {!activeThread ||
                  (!activeThread.archived &&
                    loadedEventThreads.current.has(activeThread.id) &&
                    activeEvents.length === 0 &&
                    !busy) ? (
                    <div className="conversation-empty-state">
                      <ArtemisMark />
                      <h1 aria-label={emptyConversationLabel}>
                        {activeProject ? (
                          <>
                            {emptyConversationPrefix}
                            <span className="conversation-project-name">
                              {activeProject.name}
                            </span>
                            {emptyConversationSuffix}
                          </>
                        ) : (
                          t.temporaryConversationPrompt
                        )}
                      </h1>
                    </div>
                  ) : (
                    <Timeline
                      installedPlugins={installedPlugins}
                      installedSkills={installedSkills}
                      locale={locale}
                      onExternalLink={openConversationExternalLink}
                      onFileLink={openConversationFileLink}
                      onFileLinkContextMenu={openConversationFileLinkMenu}
                      onOpenChildAgent={openChildAgentPanel}
                      onResolve={(approval, approved, scope) =>
                        void resolveApprovalRequest(approval, approved, scope)
                      }
                      onResolveUserInput={resolveUserInputRequest}
                      state={threadState!}
                    />
                  )}
                  {activeThread &&
                    runPresentation.status !== "idle" &&
                    !latestTimelineEntryIsCompaction && (
                      <div
                        aria-live="polite"
                        className={`turn-status ${runPresentation.status}`}
                        role="status"
                      >
                        <span
                          className={`status-dot ${runPresentation.status === "completed" ? "idle" : runPresentation.status}`}
                        />
                        <span>
                          {runPresentation.status === "running"
                            ? statusLabel(threadState, locale)
                            : runPresentation.status === "waiting-approval"
                              ? t.waiting
                              : runPresentation.status === "waiting-user-input"
                                ? t.waitingInput
                                : runPresentation.status === "failed"
                                  ? t.failed
                                  : t.completed}
                        </span>
                        <time
                          dateTime={`PT${Math.floor(runPresentation.elapsedMs / 1_000)}S`}
                          title={t.elapsed}
                        >
                          {formatRunDuration(runPresentation.elapsedMs)}
                        </time>
                      </div>
                    )}
                </div>

                {activeTurnFailure && (
                  <div className="turn-error-banner" role="alert">
                    <span>{activeTurnFailure}</span>
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
                  </div>
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

                {!activeThread?.archived && (
                  <div className="composer-wrap">
                    {taskPlan && (
                      <TaskPlanProgress locale={locale} plan={taskPlan} />
                    )}
                    {toast && (
                      <TransientNotice
                        notice={toast}
                        onDismiss={() => setToast(undefined)}
                        placement="composer"
                      />
                    )}
                    <>
                      <ComposerContextBar
                        {...(activeProject ? { activeProject } : {})}
                        branchActionsDisabled={projectBranchActionsDisabled}
                        locale={locale}
                        mode={mode}
                        onClearProject={() => {
                          discardNewConversationDraft();
                          beginTemporaryConversation();
                        }}
                        onError={(message) =>
                          setToast({ error: true, message })
                        }
                        onModeChange={setMode}
                        onOpenProject={openProject}
                        onSelectProject={(project) => {
                          discardNewConversationDraft();
                          beginNewConversation(project.id);
                        }}
                        projects={projects}
                      />
                      {!snapshot.sandbox.available && (
                        <div className="sandbox-notice">
                          <Icon size={16}>
                            <path
                              d="M12 3.5 20 7v5.8c0 4.1-3.1 6.8-8 8.2-4.9-1.4-8-4.1-8-8.2V7l8-3.5Z"
                              stroke="currentColor"
                              strokeLinejoin="round"
                              strokeWidth="1.5"
                            />
                            <path
                              d="M12 8v5m0 3v.1"
                              stroke="currentColor"
                              strokeLinecap="round"
                              strokeWidth="1.5"
                            />
                          </Icon>
                          <span>
                            <strong>{t.sandboxUnavailable}</strong>
                            <small>{t.sandboxDetail}</small>
                          </span>
                        </div>
                      )}
                      {queuedFollowUps.length > 0 && (
                        <div
                          aria-label={t.queuedMessages.replace(
                            "{{count}}",
                            String(queuedFollowUps.length),
                          )}
                          className="queued-message-bar"
                          role="status"
                        >
                          <div className="queued-message-heading">
                            <QueueIcon />
                            <strong>
                              {t.queuedMessages.replace(
                                "{{count}}",
                                String(queuedFollowUps.length),
                              )}
                            </strong>
                          </div>
                          <ol className="queued-message-list">
                            {queuedFollowUps.map((message, index) => {
                              const editing =
                                editingQueuedMessage?.index === index;
                              const itemLabel = t.queueItem.replace(
                                "{{number}}",
                                String(index + 1),
                              );
                              return (
                                <li
                                  className="queued-message-item"
                                  key={`${index}:${message}`}
                                >
                                  <span
                                    aria-hidden="true"
                                    className="queued-message-index"
                                  >
                                    {index + 1}
                                  </span>
                                  {editing ? (
                                    <div className="queued-message-editor">
                                      <textarea
                                        aria-label={t.queueEdit}
                                        onChange={(event) =>
                                          setEditingQueuedMessage({
                                            index,
                                            value: event.target.value,
                                          })
                                        }
                                        rows={2}
                                        value={editingQueuedMessage.value}
                                      />
                                      <div className="queued-message-editor-actions">
                                        <button
                                          disabled={
                                            busy ||
                                            !editingQueuedMessage.value.trim()
                                          }
                                          onClick={() =>
                                            void saveQueuedMessage(
                                              index,
                                              editingQueuedMessage.value,
                                            )
                                          }
                                          type="button"
                                        >
                                          {t.queueSave}
                                        </button>
                                        <button
                                          disabled={busy}
                                          onClick={() =>
                                            setEditingQueuedMessage(undefined)
                                          }
                                          type="button"
                                        >
                                          {t.queueCancel}
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <>
                                      <span
                                        className="queued-message-content"
                                        title={message}
                                      >
                                        {message}
                                      </span>
                                      <div className="queued-message-actions">
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
                                      </div>
                                    </>
                                  )}
                                </li>
                              );
                            })}
                          </ol>
                        </div>
                      )}
                      <div
                        className="composer"
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
                            {goalSuggestionIndex >= 0 && (
                              <button
                                aria-selected={
                                  goalSuggestionIndex === activeSlashSuggestion
                                }
                                className={`slash-command-suggestion${goalSuggestionIndex === activeSlashSuggestion ? " active" : ""}`}
                                id={`skill-command-option-${goalSuggestionIndex}`}
                                onClick={() => selectComposerCommand("/goal ")}
                                role="option"
                                tabIndex={-1}
                              >
                                <span className="slash-command-icon">◎</span>
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
                                <span className="slash-command-icon">
                                  <Icon size={18}>
                                    <path
                                      d="M8 3v5H3m13-5v5h5M8 21v-5H3m13 5v-5h5"
                                      stroke="currentColor"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth="1.5"
                                    />
                                  </Icon>
                                </span>
                                <span>
                                  <strong>{t.compactCommand}</strong>
                                  <small>{t.compactCommandDetail}</small>
                                </span>
                              </button>
                            )}
                            {initSuggestionIndex >= 0 && (
                              <button
                                aria-selected={
                                  initSuggestionIndex === activeSlashSuggestion
                                }
                                className={`slash-command-suggestion${initSuggestionIndex === activeSlashSuggestion ? " active" : ""}`}
                                id={`skill-command-option-${initSuggestionIndex}`}
                                onClick={() => selectComposerCommand("/init")}
                                role="option"
                                tabIndex={-1}
                              >
                                <span className="slash-command-icon">
                                  <Icon size={18}>
                                    <path
                                      d="M6.5 3.5h7l4 4v13h-11v-17Zm7 0v4h4M9 12h6m-6 4h6"
                                      stroke="currentColor"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth="1.5"
                                    />
                                  </Icon>
                                </span>
                                <span>
                                  <strong>{t.initCommand}</strong>
                                  <small>{t.initCommandDetail}</small>
                                </span>
                              </button>
                            )}
                            {modeSuggestions.map(({ index, mode }) => {
                              const commandLabel =
                                mode === "plan"
                                  ? t.planCommand
                                  : mode === "execute"
                                    ? t.executeCommand
                                    : t.reviewCommand;
                              const commandDetail =
                                mode === "plan"
                                  ? t.planCommandDetail
                                  : mode === "execute"
                                    ? t.executeCommandDetail
                                    : t.reviewCommandDetail;
                              return (
                                <button
                                  aria-selected={
                                    index === activeSlashSuggestion
                                  }
                                  className={`slash-command-suggestion${index === activeSlashSuggestion ? " active" : ""}`}
                                  id={`skill-command-option-${index}`}
                                  key={mode}
                                  onClick={() =>
                                    selectComposerCommand(`/${mode} `)
                                  }
                                  role="option"
                                  tabIndex={-1}
                                >
                                  <span className="slash-command-icon">
                                    <ModeIcon />
                                  </span>
                                  <span>
                                    <strong>{commandLabel}</strong>
                                    <small>{commandDetail}</small>
                                  </span>
                                </button>
                              );
                            })}
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
                                {pluginSkillSuggestions.length > 0 && (
                                  <div className="slash-command-heading">
                                    {t.installedPlugins}
                                  </div>
                                )}
                                {pluginSkillSuggestions.map(
                                  ({ index, plugin, skill }) => (
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
                                      <span className="slash-command-icon plugin-icon">
                                        {plugin.iconDataUrl ? (
                                          <img
                                            alt=""
                                            draggable={false}
                                            src={plugin.iconDataUrl}
                                          />
                                        ) : (
                                          <ResourceIcon />
                                        )}
                                      </span>
                                      <span>
                                        <strong>{skill.name}</strong>
                                        <small title={skill.description}>
                                          {plugin.displayName} ·{" "}
                                          {skill.description}
                                        </small>
                                      </span>
                                    </button>
                                  ),
                                )}
                                {standaloneSkillSuggestions.length > 0 && (
                                  <div className="slash-command-heading">
                                    {t.installedSkills}
                                  </div>
                                )}
                                {standaloneSkillSuggestions.map(
                                  ({ index, skill }) => (
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
                                      <span className="slash-command-icon">
                                        ✦
                                      </span>
                                      <span>
                                        <strong>{skill.name}</strong>
                                        <small>{skill.description}</small>
                                      </span>
                                    </button>
                                  ),
                                )}
                              </>
                            ) : (
                              <div className="slash-command-status">
                                {installedSkills.some((skill) => skill.enabled)
                                  ? t.noMatchingSkills
                                  : t.noInstalledSkills}
                              </div>
                            )}
                          </div>
                        )}
                        {!skillCommandMenuOpen &&
                          selectedSkills.map((skill) => {
                            const plugin = installedPluginBySkillName.get(
                              skill.name,
                            );
                            return (
                              <div
                                className="composer-selected-skill"
                                key={skill.id}
                              >
                                <span
                                  className={`slash-command-icon${plugin ? " plugin-icon" : ""}`}
                                >
                                  {plugin?.iconDataUrl ? (
                                    <img
                                      alt=""
                                      draggable={false}
                                      src={plugin.iconDataUrl}
                                    />
                                  ) : plugin ? (
                                    <ResourceIcon />
                                  ) : (
                                    "✦"
                                  )}
                                </span>
                                <span className="composer-selected-skill-copy">
                                  <small>{t.selectedSkill}</small>
                                  <strong>{skill.name}</strong>
                                </span>
                                <button
                                  aria-label={`${t.removeSelectedSkill}: ${skill.name}`}
                                  className="composer-selected-skill-remove"
                                  onClick={() =>
                                    removeSelectedSkill(skill.name)
                                  }
                                  title={t.removeSelectedSkill}
                                  type="button"
                                >
                                  ×
                                </button>
                              </div>
                            );
                          })}
                        {attachments.length > 0 && (
                          <div className="composer-attachments">
                            {attachments.map((attachment, index) => (
                              <figure
                                className="composer-attachment"
                                key={`${attachment.name}-${index}`}
                              >
                                {isPromptImage(attachment) ? (
                                  <img
                                    alt={attachment.name}
                                    src={`data:${attachment.mimeType};base64,${attachment.data}`}
                                  />
                                ) : (
                                  <div
                                    aria-label={attachment.mimeType}
                                    className="composer-file-preview"
                                  >
                                    <FileIcon />
                                    <span>
                                      {attachment.name
                                        .split(".")
                                        .pop()
                                        ?.slice(0, 8)
                                        .toLocaleUpperCase() || "FILE"}
                                    </span>
                                  </div>
                                )}
                                <button
                                  aria-label={`${t.removeAttachment}: ${attachment.name}`}
                                  onClick={() =>
                                    setAttachments((current) =>
                                      current.filter(
                                        (_candidate, candidateIndex) =>
                                          candidateIndex !== index,
                                      ),
                                    )
                                  }
                                  title={t.removeAttachment}
                                >
                                  ×
                                </button>
                                <figcaption title={attachment.name}>
                                  {attachment.name}
                                </figcaption>
                              </figure>
                            ))}
                          </div>
                        )}
                        <textarea
                          aria-activedescendant={
                            skillCommandMenuOpen &&
                            slashCommandSuggestions.length > 0
                              ? `skill-command-option-${activeSlashSuggestion}`
                              : undefined
                          }
                          aria-autocomplete="list"
                          aria-controls={
                            skillCommandMenuOpen
                              ? "skill-command-menu"
                              : undefined
                          }
                          aria-expanded={skillCommandMenuOpen}
                          aria-label={t.prompt}
                          onChange={(event) => {
                            const value = event.target.value;
                            setPrompt(value);
                            setSkillMenuDismissed(false);
                            promptHistoryNavigation.current = {
                              index: -1,
                              draft: value,
                            };
                          }}
                          onKeyDown={(event) => {
                            if (
                              event.key === "Tab" &&
                              event.shiftKey &&
                              !event.nativeEvent.isComposing &&
                              !turnActive &&
                              !busy
                            ) {
                              event.preventDefault();
                              setMode((current) => nextRunMode(current));
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
                              if (event.key === "Enter" && !event.shiftKey) {
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
                                  suggestion?.kind === "execute" ||
                                  suggestion?.kind === "review"
                                ) {
                                  selectComposerCommand(`/${suggestion.kind} `);
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
                              !skillCommandMenuOpen &&
                              !event.nativeEvent.isComposing &&
                              (event.key === "ArrowUp" ||
                                event.key === "ArrowDown")
                            ) {
                              const navigation = navigatePromptHistory(
                                activePromptHistory,
                                prompt,
                                promptHistoryNavigation.current,
                                event.key === "ArrowUp" ? "previous" : "next",
                              );
                              if (navigation) {
                                event.preventDefault();
                                promptHistoryNavigation.current = navigation;
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
                          onPaste={handleAttachmentPaste}
                          placeholder={t.prompt}
                          ref={promptInput}
                          rows={3}
                          value={prompt}
                        />
                        <div className="composer-toolbar">
                          <div className="composer-leading">
                            <button
                              aria-label={t.addAttachments}
                              className="composer-icon-button"
                              onClick={() => void selectPromptAttachments()}
                              title={t.addAttachments}
                            >
                              <PlusIcon />
                            </button>
                            <div className="approval-policy-control">
                              <button
                                aria-expanded={approvalMenuOpen}
                                aria-haspopup="menu"
                                className="approval-policy-trigger"
                                disabled={approvalChangeLocked}
                                onClick={() => {
                                  setModelPickerOpen(false);
                                  setApprovalMenuOpen((current) => !current);
                                }}
                                title={t.approvalPolicy}
                              >
                                <ApprovalIcon
                                  warning={approvalPolicy === "full-access"}
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
                                  <strong className="approval-policy-heading">
                                    {t.approvalPolicy}
                                  </strong>
                                  <button
                                    aria-checked={approvalPolicy === "ask"}
                                    className={
                                      approvalPolicy === "ask" ? "selected" : ""
                                    }
                                    disabled={approvalChangeLocked}
                                    onClick={() =>
                                      void changeApprovalPolicy("ask")
                                    }
                                    role="menuitemradio"
                                  >
                                    <ApprovalIcon />
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
                                    <ApprovalIcon />
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
                                    <ApprovalIcon warning />
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
                                  <button
                                    aria-checked={approvalPolicy === "custom"}
                                    className={
                                      approvalPolicy === "custom"
                                        ? "selected"
                                        : ""
                                    }
                                    disabled={approvalChangeLocked}
                                    onClick={() =>
                                      void changeApprovalPolicy("custom")
                                    }
                                    role="menuitemradio"
                                  >
                                    <ModeIcon />
                                    <span>
                                      <strong>{t.customApproval}</strong>
                                      <small>{t.customApprovalDetail}</small>
                                    </span>
                                    <b aria-hidden="true">
                                      {approvalPolicy === "custom" ? "✓" : ""}
                                    </b>
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="composer-trailing">
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
                                onClick={() => {
                                  setApprovalMenuOpen(false);
                                  setModelPickerSection("model");
                                  setModelPickerOpen((current) => !current);
                                }}
                                title={t.modelPicker}
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
                                    <small>{activeThinkingLevel}</small>
                                  )}
                                </span>
                                <ChevronIcon />
                              </button>
                              {modelPickerOpen && (
                                <div
                                  aria-label={t.modelPicker}
                                  className="model-picker-menu"
                                  onMouseEnter={cancelModelPickerHoverClose}
                                  onMouseLeave={scheduleModelPickerHoverClose}
                                  role="menu"
                                >
                                  <div className="model-picker-navigation">
                                    <button
                                      className={
                                        modelPickerSection === "model"
                                          ? "selected"
                                          : ""
                                      }
                                      onClick={() =>
                                        setModelPickerSection("model")
                                      }
                                      onMouseEnter={() =>
                                        setModelPickerSection("model")
                                      }
                                      role="menuitem"
                                      type="button"
                                    >
                                      <strong>{t.modelPickerModel}</strong>
                                      <span>{activeModelLabel}</span>
                                      <i aria-hidden="true">
                                        <ChevronIcon />
                                      </i>
                                    </button>
                                    <button
                                      className={
                                        modelPickerSection === "thinking"
                                          ? "selected"
                                          : ""
                                      }
                                      disabled={
                                        !activeSelection ||
                                        !activeModelSupportsReasoning
                                      }
                                      onClick={() =>
                                        setModelPickerSection("thinking")
                                      }
                                      onMouseEnter={() =>
                                        setModelPickerSection("thinking")
                                      }
                                      role="menuitem"
                                      type="button"
                                    >
                                      <strong>{t.thinking}</strong>
                                      <span>{activeThinkingLevel ?? "—"}</span>
                                      <i aria-hidden="true">
                                        <ChevronIcon />
                                      </i>
                                    </button>
                                  </div>
                                  <div
                                    aria-label={
                                      modelPickerSection === "model"
                                        ? t.modelPickerModel
                                        : t.thinking
                                    }
                                    className="model-picker-options"
                                    role="menu"
                                  >
                                    {modelPickerSection === "thinking" && (
                                      <div className="model-picker-options-heading">
                                        {t.thinking}
                                      </div>
                                    )}
                                    {modelPickerSection === "model"
                                      ? switchableModels.map((model) => {
                                          const selected =
                                            model.providerId ===
                                              activeSelection?.providerId &&
                                            model.modelId ===
                                              activeSelection.modelId;
                                          return (
                                            <button
                                              aria-checked={selected}
                                              className={
                                                selected ? "selected" : ""
                                              }
                                              key={modelIdentity(
                                                model.providerId,
                                                model.modelId,
                                              )}
                                              onClick={() =>
                                                void switchComposerModel(model)
                                              }
                                              role="menuitemradio"
                                              type="button"
                                            >
                                              <span>
                                                <strong>{model.name}</strong>
                                              </span>
                                              <b aria-hidden="true">
                                                {selected ? "✓" : ""}
                                              </b>
                                            </button>
                                          );
                                        })
                                      : modelPickerThinkingLevels.map(
                                          (level) => {
                                            const selected =
                                              activeSelection?.ultraMode !==
                                                true &&
                                              level ===
                                                activeSelection?.thinkingLevel;
                                            return (
                                              <button
                                                aria-checked={selected}
                                                className={
                                                  selected ? "selected" : ""
                                                }
                                                key={level}
                                                onClick={() =>
                                                  void switchComposerThinking(
                                                    level,
                                                  )
                                                }
                                                role="menuitemradio"
                                                type="button"
                                              >
                                                <span>
                                                  <strong>
                                                    {thinkingLevelLabel(
                                                      level,
                                                      locale,
                                                    )}
                                                  </strong>
                                                </span>
                                                <b aria-hidden="true">
                                                  {selected ? "✓" : ""}
                                                </b>
                                              </button>
                                            );
                                          },
                                        )}
                                    {modelPickerSection === "thinking" &&
                                      activeModelSupportsReasoning && (
                                        <button
                                          aria-checked={activeUltraMode}
                                          className={`ultra-mode-option${
                                            activeUltraMode ? " selected" : ""
                                          }`}
                                          onClick={() =>
                                            void switchComposerThinking(
                                              activeModelHighestThinkingLevel,
                                              true,
                                            )
                                          }
                                          role="menuitemradio"
                                          type="button"
                                        >
                                          <span>
                                            <strong>{t.ultraMode}</strong>
                                            <small>{t.ultraModeQuota}</small>
                                          </span>
                                          <b aria-hidden="true">
                                            {activeUltraMode ? "✓" : ""}
                                          </b>
                                        </button>
                                      )}
                                  </div>
                                </div>
                              )}
                            </div>
                            {turnActive ? (
                              <div className="run-actions">
                                <button
                                  className="send-button"
                                  disabled={
                                    (!prompt.trim() &&
                                      attachments.length === 0 &&
                                      selectedSkills.length === 0) ||
                                    busy
                                  }
                                  onClick={() => void sendPrompt()}
                                  title={t.followUp}
                                >
                                  <Icon size={17}>
                                    <path
                                      d="m6 12 6-6 6 6m-6-6v12"
                                      stroke="currentColor"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth="1.8"
                                    />
                                  </Icon>
                                </button>
                                <button
                                  className="send-button stop"
                                  onClick={() => void cancelActiveTurn()}
                                  title={t.stop}
                                >
                                  <span />
                                </button>
                              </div>
                            ) : (
                              <button
                                className="send-button"
                                disabled={
                                  (!prompt.trim() &&
                                    attachments.length === 0 &&
                                    selectedSkills.length === 0) ||
                                  busy
                                }
                                onClick={() => void sendPrompt()}
                                title={t.send}
                              >
                                <Icon size={17}>
                                  <path
                                    d="m6 12 6-6 6 6m-6-6v12"
                                    stroke="currentColor"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth="1.8"
                                  />
                                </Icon>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </>
                  </div>
                )}
              </section>

              {!activeThread?.archived && (
                <>
                  <div
                    aria-controls="workspace-tool-dock"
                    aria-hidden={!workspaceDockOpen}
                    aria-label={t.resizeRightSidebar}
                    aria-orientation="vertical"
                    aria-valuemax={dockWidthBounds.max}
                    aria-valuemin={dockWidthBounds.min}
                    aria-valuenow={dockWidthNow}
                    className="workspace-dock-resizer"
                    data-open={workspaceDockOpen}
                    onKeyDown={resizeWorkspaceDockFromKeyboard}
                    onPointerCancel={cancelWorkspaceDockResize}
                    onPointerDown={beginWorkspaceDockResize}
                    onPointerMove={moveWorkspaceDockResize}
                    onPointerUp={finishWorkspaceDockResize}
                    role="separator"
                    tabIndex={workspaceDockOpen ? 0 : -1}
                  />
                  <aside
                    aria-hidden={!workspaceDockOpen}
                    aria-label={t.rightSidebar}
                    className="workspace-tool-dock"
                    data-open={workspaceDockOpen}
                    id="workspace-tool-dock"
                    ref={workspaceDock}
                    style={
                      workspaceDockWidth === undefined && !environmentPanelOpen
                        ? undefined
                        : ({
                            "--workspace-dock-width": `${environmentPanelOpen ? dockWidthNow : workspaceDockWidth}px`,
                          } as CSSProperties)
                    }
                  >
                    <div className="workspace-tab-bar" role="tablist">
                      <div
                        className="workspace-tab-scroll-shell"
                        data-overflow={workspaceTabScrollState.hasOverflow}
                      >
                        {workspaceTabScrollState.hasOverflow && (
                          <button
                            aria-label={t.scrollTabsLeft}
                            className="workspace-tab-scroll-button left"
                            disabled={!workspaceTabScrollState.canScrollLeft}
                            onClick={() => scrollWorkspaceTabs(-1)}
                            title={t.scrollTabsLeft}
                            type="button"
                          >
                            <TabScrollIcon direction="left" />
                          </button>
                        )}
                        <div
                          className="workspace-tab-scroll"
                          onScroll={syncWorkspaceTabScrollState}
                          onWheel={handleWorkspaceTabWheel}
                          ref={workspaceTabScroll}
                        >
                          <div
                            className="workspace-tab-track"
                            ref={workspaceTabTrack}
                          >
                            {workspaceTabs.tabs.map((tab) => (
                              <div
                                className={
                                  workspaceTabs.activeTabId === tab.id
                                    ? "workspace-tab active"
                                    : "workspace-tab"
                                }
                                key={tab.id}
                                ref={
                                  workspaceTabs.activeTabId === tab.id
                                    ? activeWorkspaceTabElement
                                    : undefined
                                }
                              >
                                <button
                                  aria-selected={
                                    workspaceTabs.activeTabId === tab.id
                                  }
                                  className="workspace-tab-select"
                                  onClick={() =>
                                    dispatchWorkspaceTab({
                                      type: "activate",
                                      tabId: tab.id,
                                    })
                                  }
                                  role="tab"
                                  title={tab.path ?? tab.title}
                                >
                                  <WorkspaceTabIcon
                                    identity={
                                      tab.childAgentId ?? tab.agentTeamId
                                    }
                                    kind={tab.kind}
                                    path={tab.path}
                                  />
                                  <span>{tab.title}</span>
                                </button>
                                <button
                                  aria-label={`${t.closeTab}: ${tab.title}`}
                                  className="workspace-tab-close"
                                  onClick={() => closeWorkspaceTab(tab.id)}
                                  title={t.closeTab}
                                >
                                  <CloseIcon />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                        {workspaceTabScrollState.hasOverflow && (
                          <button
                            aria-label={t.scrollTabsRight}
                            className="workspace-tab-scroll-button right"
                            disabled={!workspaceTabScrollState.canScrollRight}
                            onClick={() => scrollWorkspaceTabs(1)}
                            title={t.scrollTabsRight}
                            type="button"
                          >
                            <TabScrollIcon direction="right" />
                          </button>
                        )}
                      </div>
                      <div className="workspace-tab-add-wrap">
                        <button
                          aria-expanded={workspaceTabMenuOpen}
                          aria-label={t.addTab}
                          className="workspace-tab-add"
                          onClick={() =>
                            setWorkspaceTabMenuOpen((open) => !open)
                          }
                          title={t.addTab}
                        >
                          <PlusIcon />
                        </button>
                        {workspaceTabMenuOpen && (
                          <div className="workspace-tab-menu">
                            {(
                              [
                                ...(activeProject
                                  ? ([
                                      ["review", t.reviewPanel, <ReviewIcon />],
                                    ] as const)
                                  : []),
                                ["terminal", t.terminal, <TerminalIcon />],
                                ["browser", t.browser, <BrowserIcon />],
                                ["file", t.files, <FilesIcon />],
                              ] as const
                            ).map(([kind, label, icon]) => (
                              <button
                                key={kind}
                                onClick={() =>
                                  openWorkspaceTab(kind, { forceNew: true })
                                }
                              >
                                {icon}
                                <span>{label}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="workspace-tab-content">
                      {workspaceTabs.tabs.length === 0 && (
                        <div className="right-sidebar-launcher">
                          <div className="right-sidebar-launcher-actions">
                            {activeProject && (
                              <button
                                className="right-sidebar-launcher-item"
                                onClick={openReviewPanel}
                              >
                                <ReviewIcon />
                                <span>{t.reviewPanel}</span>
                                <kbd>Ctrl+Alt+B</kbd>
                              </button>
                            )}
                            <button
                              className="right-sidebar-launcher-item"
                              onClick={openTerminalPanel}
                            >
                              <TerminalIcon />
                              <span>{t.terminal}</span>
                              <kbd>Ctrl+J</kbd>
                            </button>
                            <button
                              className="right-sidebar-launcher-item"
                              onClick={openBrowserPanel}
                            >
                              <BrowserIcon />
                              <span>{t.browser}</span>
                            </button>
                            <button
                              className="right-sidebar-launcher-item"
                              onClick={openFilesPanel}
                            >
                              <FilesIcon />
                              <span>{t.files}</span>
                            </button>
                          </div>
                        </div>
                      )}
                      {workspaceTabs.tabs.map((tab) => (
                        <div
                          className={
                            workspaceTabs.activeTabId === tab.id
                              ? "workspace-tab-pane active"
                              : "workspace-tab-pane"
                          }
                          hidden={workspaceTabs.activeTabId !== tab.id}
                          key={tab.id}
                          role="tabpanel"
                        >
                          {tab.kind === "review" && (
                            <section
                              aria-busy={reviewTransitionPending || !reviewDiff}
                              className="review-panel"
                            >
                              <header className="review-comparison-toolbar">
                                <div className="review-comparison-primary">
                                  <div className="review-scope-select">
                                    <CodexSelect<ReviewScope>
                                      ariaLabel={t.comparison}
                                      onChange={selectReviewScope}
                                      options={[
                                        {
                                          value: "unstaged",
                                          label: t.unstaged,
                                        },
                                        { value: "staged", label: t.staged },
                                        {
                                          value: "last-turn",
                                          label: t.lastTurn,
                                        },
                                        { value: "branch", label: t.branch },
                                      ]}
                                      value={reviewScope}
                                    />
                                  </div>
                                  <button
                                    aria-label={t.refreshDiff}
                                    className="review-toolbar-action"
                                    onClick={() => void refreshDiff(true)}
                                    title={t.refreshDiff}
                                    type="button"
                                  >
                                    <RefreshIcon />
                                  </button>
                                </div>
                                <div className="review-comparison-route">
                                  {reviewScope === "branch" ? (
                                    <>
                                      <label className="base-ref-field">
                                        <span>{t.baseRef}</span>
                                        <input
                                          aria-label={t.baseRef}
                                          onChange={(event) =>
                                            setReviewBaseRef(event.target.value)
                                          }
                                          placeholder={
                                            reviewDiff?.baseRef ?? "main"
                                          }
                                          value={reviewBaseRef}
                                        />
                                      </label>
                                      <span aria-hidden="true">→</span>
                                      <strong>HEAD</strong>
                                    </>
                                  ) : (
                                    <>
                                      <span>HEAD</span>
                                      <span aria-hidden="true">→</span>
                                      <strong>
                                        {reviewScope === "unstaged"
                                          ? t.unstaged
                                          : reviewScope === "staged"
                                            ? t.staged
                                            : t.lastTurn}
                                      </strong>
                                    </>
                                  )}
                                </div>
                              </header>
                              <div className="review-workspace">
                                <main className="review-diff-reader">
                                  {!reviewDiff && (
                                    <div className="review-empty">…</div>
                                  )}
                                  {reviewDiff?.available &&
                                    !reviewDiff.files.length && (
                                      <div className="review-empty">
                                        <div className="review-empty-illustration">
                                          <ReviewEmptyIcon />
                                        </div>
                                        <strong>{t.noChanges}</strong>
                                        <p>{t.changesAppearHere}</p>
                                      </div>
                                    )}
                                  {reviewDiff && !reviewDiff.available && (
                                    <div className="review-empty error">
                                      {reviewDiff.message ?? ""}
                                    </div>
                                  )}
                                  {reviewDiff?.available &&
                                    selectedReviewFile && (
                                      <div
                                        className="review-file"
                                        key={selectedReviewFile.id}
                                      >
                                        <div className="changed-file review-diff-file-header">
                                          <span className="file-status">
                                            {selectedReviewFile.status ===
                                            "added"
                                              ? "A"
                                              : selectedReviewFile.status ===
                                                  "deleted"
                                                ? "D"
                                                : "M"}
                                          </span>
                                          <span className="review-file-path">
                                            {selectedReviewFile.path}
                                          </span>
                                          <span className="review-file-stats">
                                            <span className="addition">
                                              +{selectedReviewFile.additions}
                                            </span>
                                            <span className="deletion">
                                              −{selectedReviewFile.deletions}
                                            </span>
                                          </span>
                                          <span className="review-actions">
                                            {reviewScope === "unstaged" && (
                                              <>
                                                <button
                                                  className="review-action"
                                                  disabled={
                                                    reviewBusy || turnActive
                                                  }
                                                  onClick={() =>
                                                    void mutateReview("stage", {
                                                      kind: "file",
                                                      id: selectedReviewFile.id,
                                                    })
                                                  }
                                                >
                                                  {t.stage}
                                                </button>
                                                <button
                                                  className="review-action danger"
                                                  disabled={
                                                    reviewBusy || turnActive
                                                  }
                                                  onClick={() =>
                                                    void mutateReview(
                                                      "revert",
                                                      {
                                                        kind: "file",
                                                        id: selectedReviewFile.id,
                                                      },
                                                    )
                                                  }
                                                >
                                                  {t.revert}
                                                </button>
                                              </>
                                            )}
                                            {reviewScope === "staged" && (
                                              <button
                                                className="review-action"
                                                disabled={
                                                  reviewBusy || turnActive
                                                }
                                                onClick={() =>
                                                  void mutateReview("unstage", {
                                                    kind: "file",
                                                    id: selectedReviewFile.id,
                                                  })
                                                }
                                              >
                                                {t.unstage}
                                              </button>
                                            )}
                                          </span>
                                        </div>
                                        {selectedReviewFile.hunks.map(
                                          (hunk) => (
                                            <div
                                              className="review-hunk-block"
                                              key={hunk.id}
                                            >
                                              <div className="review-hunk">
                                                <code title={hunk.header}>
                                                  {hunk.header}
                                                </code>
                                                <span className="review-file-stats">
                                                  <span className="addition">
                                                    +{hunk.additions}
                                                  </span>
                                                  <span className="deletion">
                                                    −{hunk.deletions}
                                                  </span>
                                                </span>
                                                <span className="review-actions">
                                                  {reviewScope ===
                                                    "unstaged" && (
                                                    <>
                                                      <button
                                                        className="review-action"
                                                        disabled={
                                                          reviewBusy ||
                                                          turnActive
                                                        }
                                                        onClick={() =>
                                                          void mutateReview(
                                                            "stage",
                                                            {
                                                              kind: "hunk",
                                                              id: hunk.id,
                                                            },
                                                          )
                                                        }
                                                      >
                                                        {t.stage}
                                                      </button>
                                                      <button
                                                        className="review-action danger"
                                                        disabled={
                                                          reviewBusy ||
                                                          turnActive
                                                        }
                                                        onClick={() =>
                                                          void mutateReview(
                                                            "revert",
                                                            {
                                                              kind: "hunk",
                                                              id: hunk.id,
                                                            },
                                                          )
                                                        }
                                                      >
                                                        {t.revert}
                                                      </button>
                                                    </>
                                                  )}
                                                  {reviewScope === "staged" && (
                                                    <button
                                                      className="review-action"
                                                      disabled={
                                                        reviewBusy || turnActive
                                                      }
                                                      onClick={() =>
                                                        void mutateReview(
                                                          "unstage",
                                                          {
                                                            kind: "hunk",
                                                            id: hunk.id,
                                                          },
                                                        )
                                                      }
                                                    >
                                                      {t.unstage}
                                                    </button>
                                                  )}
                                                </span>
                                              </div>
                                              <div className="review-lines">
                                                {hunk.lines.map((line) => {
                                                  const comments =
                                                    reviewComments.filter(
                                                      (comment) =>
                                                        comment.scope ===
                                                          reviewScope &&
                                                        comment.lineId ===
                                                          line.id,
                                                    );
                                                  return (
                                                    <div
                                                      className="review-line-group"
                                                      key={line.id}
                                                    >
                                                      <div
                                                        className={`review-line ${line.kind}`}
                                                        data-line-id={line.id}
                                                      >
                                                        <button
                                                          aria-label={
                                                            t.addComment
                                                          }
                                                          className="review-comment-trigger"
                                                          onClick={() => {
                                                            setCommentLineId(
                                                              line.id,
                                                            );
                                                            setCommentBody("");
                                                          }}
                                                          title={t.addComment}
                                                        >
                                                          +
                                                        </button>
                                                        <span className="review-line-number">
                                                          {line.oldLine ?? ""}
                                                        </span>
                                                        <span className="review-line-number">
                                                          {line.newLine ?? ""}
                                                        </span>
                                                        <code>
                                                          <HighlightedCodeLine
                                                            content={
                                                              line.text || " "
                                                            }
                                                            path={
                                                              selectedReviewFile.path
                                                            }
                                                          />
                                                        </code>
                                                      </div>
                                                      {comments.map(
                                                        (comment) => (
                                                          <div
                                                            className="review-comment"
                                                            key={comment.id}
                                                          >
                                                            <p>
                                                              {comment.body}
                                                            </p>
                                                            <button
                                                              aria-label={
                                                                t.deleteComment
                                                              }
                                                              className="text-button danger"
                                                              disabled={
                                                                reviewBusy
                                                              }
                                                              onClick={() =>
                                                                void deleteReviewComment(
                                                                  comment,
                                                                )
                                                              }
                                                            >
                                                              {t.deleteComment}
                                                            </button>
                                                          </div>
                                                        ),
                                                      )}
                                                      {commentLineId ===
                                                        line.id && (
                                                        <div className="review-comment-editor">
                                                          <textarea
                                                            aria-label={
                                                              t.commentPlaceholder
                                                            }
                                                            autoFocus
                                                            onChange={(event) =>
                                                              setCommentBody(
                                                                event.target
                                                                  .value,
                                                              )
                                                            }
                                                            placeholder={
                                                              t.commentPlaceholder
                                                            }
                                                            value={commentBody}
                                                          />
                                                          <span>
                                                            <button
                                                              className="text-button"
                                                              onClick={() => {
                                                                setCommentLineId(
                                                                  undefined,
                                                                );
                                                                setCommentBody(
                                                                  "",
                                                                );
                                                              }}
                                                            >
                                                              {t.cancelComment}
                                                            </button>
                                                            <button
                                                              className="primary-button compact"
                                                              disabled={
                                                                reviewBusy ||
                                                                !commentBody.trim()
                                                              }
                                                              onClick={() =>
                                                                void saveReviewComment(
                                                                  line.id,
                                                                )
                                                              }
                                                            >
                                                              {t.saveComment}
                                                            </button>
                                                          </span>
                                                        </div>
                                                      )}
                                                    </div>
                                                  );
                                                })}
                                              </div>
                                            </div>
                                          ),
                                        )}
                                      </div>
                                    )}
                                </main>
                                <aside
                                  aria-label={t.changedFiles}
                                  className="review-file-sidebar"
                                >
                                  <label className="review-file-filter">
                                    <SearchIcon />
                                    <input
                                      aria-label={t.filterFiles}
                                      onChange={(event) =>
                                        setReviewFileQuery(event.target.value)
                                      }
                                      placeholder={t.filterFiles}
                                      value={reviewFileQuery}
                                    />
                                  </label>
                                  <div className="file-summary">
                                    <span>{t.changedFiles}</span>
                                    <strong>
                                      {reviewDiff?.files.length ?? 0}
                                    </strong>
                                  </div>
                                  <div className="review-file-list">
                                    {filteredReviewFiles.map((file) => (
                                      <button
                                        aria-pressed={
                                          selectedReviewFile?.id === file.id
                                        }
                                        className={
                                          selectedReviewFile?.id === file.id
                                            ? "review-file-entry selected"
                                            : "review-file-entry"
                                        }
                                        key={file.id}
                                        onClick={() =>
                                          setSelectedReviewFileId(file.id)
                                        }
                                        title={file.path}
                                        type="button"
                                      >
                                        <span className="file-status">
                                          {file.status === "added"
                                            ? "A"
                                            : file.status === "deleted"
                                              ? "D"
                                              : "M"}
                                        </span>
                                        <span className="review-file-path">
                                          {file.path}
                                        </span>
                                        <span className="review-file-stats">
                                          <span className="addition">
                                            +{file.additions}
                                          </span>
                                          <span className="deletion">
                                            −{file.deletions}
                                          </span>
                                        </span>
                                      </button>
                                    ))}
                                    {Boolean(
                                      reviewDiff?.files.length &&
                                      !filteredReviewFiles.length,
                                    ) && (
                                      <div className="review-file-list-empty">
                                        {t.noMatchingFiles}
                                      </div>
                                    )}
                                  </div>
                                </aside>
                              </div>
                            </section>
                          )}
                          {tab.kind === "terminal" && (
                            <Suspense
                              fallback={
                                <section className="terminal-panel view-loading">
                                  …
                                </section>
                              }
                            >
                              <TerminalPanel
                                threadId={activeThread?.id}
                                title={tab.title}
                                emptyMessage={t.terminalLocked}
                                theme={runtimeSettings?.theme ?? "system"}
                              />
                            </Suspense>
                          )}
                          {tab.kind === "browser" && (
                            <WorkspaceBrowserPanel
                              addressPlaceholder={t.browserAddress}
                              backLabel={t.browserBack}
                              emptyMessage={t.noHtmlPreview}
                              forwardLabel={t.browserForward}
                              goLabel={t.browserGo}
                              initialUrl={tab.url}
                              locale={locale}
                              path={
                                tab.url
                                  ? undefined
                                  : (tab.path ?? latestHtmlChange?.path)
                              }
                              refreshLabel={t.refreshPreview}
                              revision={
                                tab.revision ?? latestHtmlChange?.eventId
                              }
                              threadId={activeThreadId}
                              title={tab.title}
                            />
                          )}
                          {tab.kind === "markdown" && (
                            <MarkdownReaderPanel
                              editLabel={t.editFile}
                              emptyMessage={t.noMarkdownPreview}
                              path={tab.path ?? latestMarkdownChange?.path}
                              refreshLabel={t.refreshPreview}
                              revision={
                                tab.revision ?? latestMarkdownChange?.eventId
                              }
                              richLabel={t.richText}
                              saveLabel={t.saveFile}
                              savedLabel={t.saved}
                              savingLabel={t.saving}
                              sourceLabel={t.sourceText}
                              threadId={activeThreadId}
                              title={tab.title}
                              unsavedLabel={t.unsaved}
                            />
                          )}
                          {tab.kind === "file" && (
                            <WorkspaceFilesPanel
                              binaryMessage={t.binaryFile}
                              editFileLabel={t.editFile}
                              filterPlaceholder={t.filterFiles}
                              onFileSelected={(path) =>
                                dispatchWorkspaceTab({
                                  type: "update",
                                  tabId: tab.id,
                                  updates: {
                                    path,
                                    title:
                                      path
                                        .replaceAll("\\", "/")
                                        .split("/")
                                        .at(-1) ?? t.files,
                                  },
                                })
                              }
                              onOpenHtml={openHtmlFromFiles}
                              openFileMessage={t.openFileFromTree}
                              refreshLabel={t.refreshPreview}
                              richLabel={t.richText}
                              saveLabel={t.saveFile}
                              savedLabel={t.saved}
                              selectedPath={tab.path}
                              savingLabel={t.saving}
                              sourceLabel={t.sourceText}
                              threadId={activeThreadId}
                              title={tab.title}
                              unsavedLabel={t.unsaved}
                            />
                          )}
                          {tab.kind === "agent-team" && (
                            <AgentTeamPanel
                              active={workspaceTabs.activeTabId === tab.id}
                              controlPending={agentTeamControlPending}
                              locale={locale}
                              members={Object.values(
                                threadState?.childAgents ?? {},
                              ).filter(
                                (child) => child.teamId === tab.agentTeamId,
                              )}
                              messages={(
                                threadState?.agentTeamMessageOrder ?? []
                              )
                                .map(
                                  (messageId) =>
                                    threadState?.agentTeamMessages[messageId],
                                )
                                .filter(
                                  (message): message is AgentTeamMessageState =>
                                    Boolean(
                                      message &&
                                      message.teamId === tab.agentTeamId,
                                    ),
                                )}
                              onOpenChildAgent={openChildAgentPanel}
                              onStop={(team) => void stopAgentTeam(team)}
                              runtimeAvailable={turnActive}
                              team={
                                tab.agentTeamId
                                  ? threadState?.agentTeams[tab.agentTeamId]
                                  : undefined
                              }
                            />
                          )}
                          {tab.kind === "child-agent" && (
                            <ChildAgentPanel
                              active={workspaceTabs.activeTabId === tab.id}
                              child={
                                tab.childAgentId
                                  ? threadState?.childAgents[tab.childAgentId]
                                  : undefined
                              }
                              clockMs={clockMs}
                              locale={locale}
                              onControl={(child, action) =>
                                void controlChildAgent(child, action)
                              }
                              pendingAction={childAgentControlPending}
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  </aside>
                </>
              )}
            </div>
          </>
        )}
      </section>

      {settingsOpen && (
        <Suspense
          fallback={
            <div className="settings-backdrop">
              <div className="settings-panel settings-loading">…</div>
            </div>
          }
        >
          <SettingsPanel
            initialSettings={runtimeSettings}
            initialTab={settingsTab}
            locale={locale}
            onClose={() => setSettingsOpen(false)}
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
        <div
          className="confirmation-backdrop"
          onMouseDown={() => resolveConfirmation(false)}
        >
          <section
            aria-describedby="confirmation-message"
            aria-labelledby="confirmation-title"
            aria-modal={true}
            className={`confirmation-dialog ${confirmation.tone}`}
            onMouseDown={(event) => event.stopPropagation()}
            role="alertdialog"
          >
            <div className="confirmation-icon" aria-hidden="true">
              !
            </div>
            <div className="confirmation-copy">
              <h2 id="confirmation-title">
                {confirmation.tone === "danger"
                  ? t.confirmationDangerTitle
                  : t.confirmationTitle}
              </h2>
              <p id="confirmation-message">{confirmation.message}</p>
            </div>
            <div className="confirmation-actions">
              <button
                className="secondary-button"
                onClick={() => resolveConfirmation(false)}
                ref={confirmationCancelButton}
              >
                {t.confirmationCancel}
              </button>
              <button
                className={
                  confirmation.tone === "danger"
                    ? "primary-button danger"
                    : "primary-button"
                }
                onClick={() => resolveConfirmation(true)}
              >
                {t.confirmationAccept}
              </button>
            </div>
          </section>
        </div>
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

      {toast && (activeView !== "workspace" || activeThread?.archived) && (
        <TransientNotice
          notice={toast}
          onDismiss={() => setToast(undefined)}
          placement="view"
        />
      )}
    </main>
  );
}

function AgentTeamPanel({
  active,
  controlPending,
  locale,
  members,
  messages,
  onOpenChildAgent,
  onStop,
  runtimeAvailable,
  team,
}: {
  active: boolean;
  controlPending: boolean;
  locale: Locale;
  members: ChildAgentState[];
  messages: AgentTeamMessageState[];
  onOpenChildAgent: (child: ChildAgentState) => void;
  onStop: (team: AgentTeamState) => void;
  runtimeAvailable: boolean;
  team: AgentTeamState | undefined;
}) {
  const messageList = useRef<HTMLDivElement>(null);
  const labels = localizedCopy(
    locale,
    "app",
    {
      "zh-CN": {
        title: "Agent 团队",
        members: "成员与任务",
        collaboration: "协作记录",
        noMessages: "团队消息会在这里按顺序出现。",
        unavailable: "团队记录尚未加载或当前不可用。",
        history: "历史只读",
        stop: "停止团队",
        parent: "主 Agent",
        everyone: "全体成员",
        total: "总计",
        active: "活跃",
        queued: "排队",
        waiting: "等待",
        expand: "展开子树",
        collapse: "折叠子树",
      },
      en: {
        title: "Agent team",
        members: "Members and tasks",
        collaboration: "Collaboration log",
        noMessages: "Team messages will appear here in sequence.",
        unavailable: "The team record is not loaded or is unavailable.",
        history: "Read-only history",
        stop: "Stop team",
        parent: "Parent agent",
        everyone: "Everyone",
        total: "Total",
        active: "Active",
        queued: "Queued",
        waiting: "Waiting",
        expand: "Expand subtree",
        collapse: "Collapse subtree",
      },
    }[legacyLocale(locale)],
  );
  const teamStatusLabels = localizedCopy(
    locale,
    "app",
    {
      "zh-CN": {
        forming: "正在组队",
        running: "协作中",
        blocked: "存在阻塞",
        integrating: "等待主 Agent 集成",
        completed: "已完成",
        aborted: "已中止",
      },
      en: {
        forming: "Forming",
        running: "Collaborating",
        blocked: "Blocked",
        integrating: "Awaiting parent integration",
        completed: "Completed",
        aborted: "Aborted",
      },
    }[legacyLocale(locale)],
  );
  const messageKindLabels = localizedCopy(
    locale,
    "app",
    {
      "zh-CN": {
        finding: "发现",
        request: "请求",
        blocker: "阻塞",
        handoff: "交接",
      },
      en: {
        finding: "Finding",
        request: "Request",
        blocker: "Blocker",
        handoff: "Handoff",
      },
    }[legacyLocale(locale)],
  );
  const teamRunning =
    team &&
    (team.status === "forming" ||
      team.status === "running" ||
      team.status === "blocked" ||
      team.status === "integrating");
  const teamId = team?.teamId ?? "";
  const memberAgentIds = team?.memberAgentIds;
  const { memberById, currentMembers, childrenByParent } = useMemo(
    () => indexAgentTeamTree(members, memberAgentIds ?? []),
    [memberAgentIds, members],
  );
  const [expandedAgentIds, setExpandedAgentIds] = useState<Set<string>>(
    () => new Set(),
  );
  const expansionTeamId = useRef(teamId);
  const manuallyToggledAgentIds = useRef(new Set<string>());
  useEffect(() => {
    const defaultExpanded = currentMembers
      .filter(
        (member) =>
          (member.depth ?? 1) === 1 &&
          (childrenByParent.get(member.agentId)?.length ?? 0) > 0,
      )
      .map((member) => member.agentId);
    if (expansionTeamId.current !== teamId) {
      expansionTeamId.current = teamId;
      manuallyToggledAgentIds.current.clear();
      setExpandedAgentIds(new Set(defaultExpanded));
      return;
    }
    setExpandedAgentIds((current) => {
      const next = new Set(current);
      let changed = false;
      for (const agentId of defaultExpanded) {
        if (
          !next.has(agentId) &&
          !manuallyToggledAgentIds.current.has(agentId)
        ) {
          next.add(agentId);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [childrenByParent, currentMembers, teamId]);
  const visibleMembers = useMemo(() => {
    return visibleAgentTeamMembers(childrenByParent, expandedAgentIds);
  }, [childrenByParent, expandedAgentIds]);
  const memberCounts = useMemo(
    () => ({
      total: currentMembers.length,
      active: currentMembers.filter(
        (member) =>
          member.status === "running" || member.status === "cancelling",
      ).length,
      queued: currentMembers.filter((member) => member.status === "queued")
        .length,
      waiting: currentMembers.filter(
        (member) =>
          member.status === "blocked" ||
          member.coordinationStatus === "waiting-dependency",
      ).length,
    }),
    [currentMembers],
  );
  const agentName = (agentId: string) =>
    agentId === "parent"
      ? labels.parent
      : agentId === "all"
        ? labels.everyone
        : (memberById.get(agentId)?.label ?? agentId);

  useLayoutEffect(() => {
    if (!active || !messageList.current) return;
    messageList.current.scrollTop = messageList.current.scrollHeight;
  }, [active, messages.length]);

  if (!team) {
    return (
      <section className="agent-team-panel unavailable">
        <div className="agent-team-empty">
          <ChildAgentIcon
            className="agent-team-empty-icon"
            identity="agent-team"
          />
          <strong>{labels.title}</strong>
          <p>{labels.unavailable}</p>
          <span aria-hidden="true" className="agent-team-skeleton">
            <i />
            <i />
            <i />
          </span>
        </div>
      </section>
    );
  }

  return (
    <section className={`agent-team-panel ${team.status}`}>
      <header className="agent-team-header">
        <div>
          <span className="agent-team-eyebrow">{labels.title}</span>
          <strong>{team.mission}</strong>
          <small>
            {teamStatusLabels[team.status]}
            {!runtimeAvailable && teamRunning ? ` · ${labels.history}` : ""}
          </small>
        </div>
        {teamRunning && runtimeAvailable && (
          <button
            className="secondary-button compact danger"
            disabled={controlPending}
            onClick={() => onStop(team)}
            type="button"
          >
            {labels.stop}
          </button>
        )}
      </header>
      {team.error && <p className="agent-team-error">{team.error}</p>}
      <div className="agent-team-grid">
        <aside className="agent-team-members">
          <h3>{labels.members}</h3>
          <dl className="agent-team-member-counts">
            <div>
              <dt>{labels.total}</dt>
              <dd>{memberCounts.total}</dd>
            </div>
            <div>
              <dt>{labels.active}</dt>
              <dd>{memberCounts.active}</dd>
            </div>
            <div>
              <dt>{labels.queued}</dt>
              <dd>{memberCounts.queued}</dd>
            </div>
            <div>
              <dt>{labels.waiting}</dt>
              <dd>{memberCounts.waiting}</dd>
            </div>
          </dl>
          <div className="agent-team-member-list">
            {visibleMembers.map((member) => {
              const childCount =
                childrenByParent.get(member.agentId)?.length ?? 0;
              const expanded = expandedAgentIds.has(member.agentId);
              return (
                <div
                  className={`agent-team-member ${member.status}`}
                  key={member.agentId}
                  style={{
                    paddingLeft: 8 + ((member.depth ?? 1) - 1) * 16,
                  }}
                >
                  {childCount > 0 ? (
                    <button
                      aria-expanded={expanded}
                      aria-label={`${expanded ? labels.collapse : labels.expand}: ${member.label}`}
                      className="agent-team-member-disclosure"
                      onClick={() => {
                        manuallyToggledAgentIds.current.add(member.agentId);
                        setExpandedAgentIds((current) => {
                          const next = new Set(current);
                          if (next.has(member.agentId)) {
                            next.delete(member.agentId);
                          } else {
                            next.add(member.agentId);
                          }
                          return next;
                        });
                      }}
                      type="button"
                    >
                      <svg viewBox="0 0 16 16">
                        <path d="m6 3.5 4.5 4.5L6 12.5" />
                      </svg>
                    </button>
                  ) : (
                    <span className="agent-team-member-disclosure spacer" />
                  )}
                  <button
                    className="agent-team-member-open"
                    onClick={() => onOpenChildAgent(member)}
                    type="button"
                  >
                    <ChildAgentIcon
                      className="agent-team-member-icon"
                      identity={member.agentId}
                    />
                    <span>
                      <strong>{member.label}</strong>
                      <small>
                        {member.subtreeStatus ?? "leaf"}
                        {childCount > 0 ? ` · ${childCount}` : ""}
                      </small>
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        </aside>
        <section className="agent-team-collaboration">
          <h3>{labels.collaboration}</h3>
          <div className="agent-team-message-list" ref={messageList}>
            {messages.length === 0 ? (
              <p className="agent-team-message-empty">{labels.noMessages}</p>
            ) : (
              messages.map((message) => (
                <article
                  className={`agent-team-message ${message.kind}`}
                  key={message.messageId}
                >
                  <header>
                    <strong>
                      {agentName(message.fromAgentId)} →{" "}
                      {agentName(message.recipient)}
                    </strong>
                    <span>{messageKindLabels[message.kind]}</span>
                    <time>
                      {new Intl.DateTimeFormat(locale, {
                        hour: "2-digit",
                        minute: "2-digit",
                      }).format(new Date(message.createdAt))}
                    </time>
                  </header>
                  <p>{message.content}</p>
                </article>
              ))
            )}
          </div>
        </section>
      </div>
    </section>
  );
}

function ChildAgentPanel({
  active,
  child,
  clockMs,
  locale,
  onControl,
  pendingAction,
}: {
  active: boolean;
  child: ChildAgentState | undefined;
  clockMs: number;
  locale: Locale;
  onControl: (
    child: ChildAgentState,
    action: "steer" | "cancel" | "retry",
  ) => void;
  pendingAction: string | undefined;
}) {
  const CHILD_AGENT_SCROLL_THRESHOLD = 64;
  const childAgentScrollContainer = useRef<HTMLDivElement>(null);
  const childAgentFollowOutput = useRef(true);
  const labels = localizedCopy(
    locale,
    "app",
    {
      "zh-CN": {
        queued: "等待开始",
        running: "已开始工作",
        blocked: "被依赖阻塞",
        cancelling: "正在停止",
        completed: "已完成",
        failed: "失败",
        cancelled: "已停止",
        waiting: "等待子智能体输出…",
        unavailable: "此子智能体的输出当前不可用。",
        task: "任务",
        elapsed: "运行时长",
        lastActivity: "最后活动",
        currentTool: "当前工具",
        suspect: "疑似卡住",
        nudge: "催办",
        stop: "停止此子代理",
        retry: "重试",
        justNow: "刚刚",
        ago: "{{duration}}前",
        subagent: "子智能体",
      },
      en: {
        queued: "Waiting to start",
        running: "Started working",
        blocked: "Blocked by dependency",
        cancelling: "Stopping",
        completed: "Completed",
        failed: "Failed",
        cancelled: "Stopped",
        waiting: "Waiting for subagent output…",
        unavailable: "This subagent output is currently unavailable.",
        task: "Task",
        elapsed: "Runtime",
        lastActivity: "Last activity",
        currentTool: "Current tool",
        suspect: "Possibly stuck",
        nudge: "Nudge",
        stop: "Stop subagent",
        retry: "Retry",
        justNow: "just now",
        ago: "{{duration}} ago",
        subagent: "Subagent",
      },
    }[legacyLocale(locale)],
  );
  const content = child?.error ?? child?.output ?? child?.activity;
  const running = child?.status === "queued" || child?.status === "running";
  const lastActivityMs = child?.lastActivityAt
    ? Date.parse(child.lastActivityAt)
    : undefined;
  const silentMilliseconds = lastActivityMs
    ? Math.max(0, clockMs - lastActivityMs)
    : 0;
  const health =
    child?.health === "stalled" || child?.health === "suspect"
      ? child.health
      : running && silentMilliseconds >= 60_000
        ? "suspect"
        : "healthy";
  const startedMilliseconds = child?.startedAt
    ? Date.parse(child.startedAt)
    : child?.updatedAt
      ? Date.parse(child.updatedAt)
      : clockMs;
  const elapsedMilliseconds = Math.max(0, clockMs - startedMilliseconds);
  const lastActivityLabel =
    silentMilliseconds < 1_000
      ? labels.justNow
      : labels.ago.replace(
          "{{duration}}",
          formatRunDuration(silentMilliseconds),
        );
  const currentToolElapsed = child?.currentToolStartedAt
    ? Math.max(0, clockMs - Date.parse(child.currentToolStartedAt))
    : undefined;
  const controlPending = child
    ? pendingAction?.startsWith(`${child.agentId}:`)
    : false;
  const handleChildAgentScroll = (event: ReactUIEvent<HTMLElement>) => {
    const { clientHeight, scrollHeight, scrollTop } = event.currentTarget;
    childAgentFollowOutput.current =
      scrollHeight - scrollTop - clientHeight <= CHILD_AGENT_SCROLL_THRESHOLD;
  };

  useLayoutEffect(() => {
    if (!active || !childAgentFollowOutput.current) return;
    const container = childAgentScrollContainer.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [active, content, child?.status]);

  return (
    <section
      aria-live="polite"
      className={`child-agent-panel ${child?.status ?? "unavailable"} ${health}`}
    >
      <header className="child-agent-panel-header">
        <ChildAgentIcon
          className="child-agent-panel-icon"
          identity={child?.agentId}
        />
        <span>
          <strong>{child?.label ?? labels.subagent}</strong>
          {child && (
            <small>
              {labels[child.status]}
              {health !== "healthy" ? ` · ${labels.suspect}` : ""}
            </small>
          )}
        </span>
        {child && (
          <div className="child-agent-panel-actions">
            {running && (
              <button
                className="secondary-button compact"
                disabled={controlPending}
                onClick={() => onControl(child, "steer")}
                type="button"
              >
                {labels.nudge}
              </button>
            )}
            {(running || child.status === "cancelling") && (
              <button
                className="secondary-button compact danger"
                disabled={controlPending || child.status === "cancelling"}
                onClick={() => onControl(child, "cancel")}
                type="button"
              >
                {labels.stop}
              </button>
            )}
            {(child.status === "completed" ||
              child.status === "failed" ||
              child.status === "blocked" ||
              child.status === "cancelled") && (
              <button
                className="secondary-button compact"
                disabled={controlPending}
                onClick={() => onControl(child, "retry")}
                type="button"
              >
                {labels.retry}
              </button>
            )}
          </div>
        )}
      </header>
      {child && (
        <div className="child-agent-panel-runtime-bar">
          <dl className="child-agent-panel-runtime">
            <div>
              <dt>{labels.elapsed}</dt>
              <dd>{formatRunDuration(elapsedMilliseconds)}</dd>
            </div>
            <div>
              <dt>{labels.lastActivity}</dt>
              <dd>{lastActivityLabel}</dd>
            </div>
            <div>
              <dt>{labels.currentTool}</dt>
              <dd>
                {child.currentTool ?? "—"}
                {child.currentTool && currentToolElapsed !== undefined
                  ? ` · ${formatRunDuration(currentToolElapsed)}`
                  : ""}
              </dd>
            </div>
            {health !== "healthy" && (
              <div className="child-agent-panel-health">
                <dt>{labels.suspect}</dt>
                <dd>{labels.suspect}</dd>
              </div>
            )}
          </dl>
        </div>
      )}
      <div
        className="child-agent-panel-body"
        onScroll={handleChildAgentScroll}
        ref={childAgentScrollContainer}
      >
        <div className="child-agent-panel-body-inner">
          {!child ? (
            <p className="child-agent-panel-empty">{labels.unavailable}</p>
          ) : (
            <>
              {child.task && (
                <section className="child-agent-panel-task">
                  <span>{labels.task}</span>
                  <p>{child.task}</p>
                </section>
              )}
              {content ? (
                <MarkdownContent
                  className={
                    child.error
                      ? "child-agent-panel-output error"
                      : "child-agent-panel-output"
                  }
                  text={content}
                />
              ) : (
                <p className="child-agent-panel-empty">{labels.waiting}</p>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function UserInputCard({
  input,
  active,
  locale,
  onResolve,
}: {
  input: UserInputState;
  active: boolean;
  locale: Locale;
  onResolve: (resolution: UserInputResolution) => Promise<void>;
}) {
  const t = appCopy(locale);
  const recommendedOptionIndex = Math.max(
    0,
    input.options.findIndex((option) => option.recommended),
  );
  const otherOptionIndex = input.options.length;
  const optionCount = input.options.length + 1;
  const [showOther, setShowOther] = useState(false);
  const [otherAnswer, setOtherAnswer] = useState("");
  const [resolving, setResolving] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const [activeOptionIndex, setActiveOptionIndex] = useState(
    recommendedOptionIndex,
  );
  const optionButtons = useRef<Array<HTMLButtonElement | null>>([]);
  const interactionBusy = resolving;

  useEffect(() => {
    if (input.status !== "pending") return;
    setClock(Date.now());
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [input.requestId, input.status]);

  useLayoutEffect(() => {
    if (!active || input.status !== "pending") return;
    setActiveOptionIndex(recommendedOptionIndex);
    const frame = window.requestAnimationFrame(() => {
      optionButtons.current[recommendedOptionIndex]?.focus({
        preventScroll: true,
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active, input.requestId, input.status, recommendedOptionIndex]);

  if (input.status === "pending" && !active) return null;

  const resolve = async (
    choice: Pick<UserInputResolution, "selectedOption" | "customAnswer">,
  ) => {
    if (interactionBusy) return;
    setResolving(true);
    try {
      await onResolve({
        requestId: input.requestId,
        nonce: input.nonce,
        ...choice,
      });
    } catch {
      setResolving(false);
    }
  };

  const closeOther = () => {
    setShowOther(false);
    window.requestAnimationFrame(() => {
      optionButtons.current[otherOptionIndex]?.focus({ preventScroll: true });
    });
  };

  const handleOptionKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ) => {
    const key = event.key;
    if (
      key !== "ArrowDown" &&
      key !== "ArrowUp" &&
      key !== "Home" &&
      key !== "End"
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const nextIndex = moveUserInputOptionFocus(
      activeOptionIndex,
      optionCount,
      key,
    );
    if (nextIndex < 0) return;
    setActiveOptionIndex(nextIndex);
    optionButtons.current[nextIndex]?.focus();
  };

  return (
    <article className={`user-input-card ${input.status}`}>
      <header>
        <span aria-hidden="true" className="user-input-mark">
          <Icon size={18}>
            <path
              d="M9.2 9.1a2.9 2.9 0 1 1 4.4 2.5c-1 .6-1.6 1.1-1.6 2.2"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="1.7"
            />
            <path
              d="M12 17.5h.01"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="2.2"
            />
          </Icon>
        </span>
        <div className="user-input-heading">
          <small className="user-input-eyebrow">{input.header}</small>
          <strong className="user-input-question">{input.question}</strong>
        </div>
        {input.status === "pending" && (
          <time
            aria-label={t.timeoutHint}
            className="user-input-timeout"
            dateTime={input.expiresAt}
            title={t.timeoutHint}
          >
            {formatUserInputCountdown(Date.parse(input.expiresAt) - clock)}
          </time>
        )}
      </header>
      {input.status === "pending" ? (
        <>
          <div className="user-input-options-scroll">
            <div
              aria-label={input.question}
              className="user-input-options"
              role="listbox"
            >
              {input.options.map((option, index) => (
                <button
                  aria-keyshortcuts="ArrowUp ArrowDown Home End Enter"
                  aria-selected={activeOptionIndex === index}
                  className={`user-input-option${option.recommended ? " recommended" : ""}${activeOptionIndex === index ? " active" : ""}`}
                  disabled={interactionBusy}
                  key={option.label}
                  onClick={() => void resolve({ selectedOption: index })}
                  onFocus={() => setActiveOptionIndex(index)}
                  onKeyDown={handleOptionKeyDown}
                  onMouseEnter={() => setActiveOptionIndex(index)}
                  ref={(button) => {
                    optionButtons.current[index] = button;
                  }}
                  role="option"
                  tabIndex={activeOptionIndex === index ? 0 : -1}
                  type="button"
                >
                  <span aria-hidden="true" className="user-input-option-index">
                    {index + 1}
                  </span>
                  <span className="user-input-option-copy">
                    <span className="user-input-option-title">
                      <strong>{option.label}</strong>
                      {option.recommended && (
                        <small className="recommendation-badge">
                          {t.recommended}
                        </small>
                      )}
                    </span>
                    <small>{option.description}</small>
                  </span>
                  <span aria-hidden="true" className="user-input-option-enter">
                    <Icon size={17}>
                      <path
                        d="m9 5 7 7-7 7"
                        fill="none"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="1.7"
                      />
                    </Icon>
                  </span>
                </button>
              ))}
              {!showOther && (
                <button
                  aria-keyshortcuts="ArrowUp ArrowDown Home End Enter"
                  aria-selected={activeOptionIndex === otherOptionIndex}
                  className={`user-input-option other${activeOptionIndex === otherOptionIndex ? " active" : ""}`}
                  disabled={interactionBusy}
                  onClick={() => {
                    setActiveOptionIndex(otherOptionIndex);
                    setShowOther(true);
                  }}
                  onFocus={() => setActiveOptionIndex(otherOptionIndex)}
                  onKeyDown={handleOptionKeyDown}
                  onMouseEnter={() => setActiveOptionIndex(otherOptionIndex)}
                  ref={(button) => {
                    optionButtons.current[otherOptionIndex] = button;
                  }}
                  role="option"
                  tabIndex={activeOptionIndex === otherOptionIndex ? 0 : -1}
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    className="user-input-option-index user-input-other-icon"
                  >
                    <Icon size={15}>
                      <path
                        d="m5 16 1-3L15.5 3.5a1.8 1.8 0 0 1 2.6 2.6L8.5 15.5 5 16Z"
                        fill="none"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="1.5"
                      />
                    </Icon>
                  </span>
                  <span className="user-input-option-copy">
                    <span className="user-input-option-title">
                      <strong>{t.otherAnswer}</strong>
                    </span>
                    <small>{t.otherAnswerDetail}</small>
                  </span>
                  <span aria-hidden="true" className="user-input-option-enter">
                    <Icon size={17}>
                      <path
                        d="m9 5 7 7-7 7"
                        fill="none"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="1.7"
                      />
                    </Icon>
                  </span>
                </button>
              )}
            </div>
            {showOther && (
              <form
                className="user-input-other-inline"
                onSubmit={(event) => {
                  event.preventDefault();
                  const customAnswer = otherAnswer.trim();
                  if (customAnswer) void resolve({ customAnswer });
                }}
              >
                <span aria-hidden="true" className="user-input-other-edit-icon">
                  <Icon size={16}>
                    <path
                      d="m5 16 1-3L15.5 3.5a1.8 1.8 0 0 1 2.6 2.6L8.5 15.5 5 16Z"
                      fill="none"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="1.5"
                    />
                  </Icon>
                </span>
                <input
                  aria-label={t.customAnswer}
                  autoFocus
                  disabled={interactionBusy}
                  maxLength={2_000}
                  onChange={(event) => setOtherAnswer(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Escape") return;
                    event.preventDefault();
                    event.stopPropagation();
                    closeOther();
                  }}
                  placeholder={t.customAnswer}
                  value={otherAnswer}
                />
                <button
                  aria-label={t.submitAnswer}
                  className="user-input-other-submit"
                  disabled={interactionBusy || !otherAnswer.trim()}
                  title={t.submitAnswer}
                  type="submit"
                >
                  <Icon size={16}>
                    <path
                      d="m6 12 6-6 6 6m-6-6v12"
                      fill="none"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="1.7"
                    />
                  </Icon>
                </button>
              </form>
            )}
          </div>
        </>
      ) : (
        <div className="user-input-result">
          <span>
            {input.status === "timed-out"
              ? t.timedOut
              : input.status === "cancelled"
                ? t.inputCancelled
                : t.answered}
          </span>
          {input.answer && <strong>{input.answer}</strong>}
        </div>
      )}
    </article>
  );
}

function ToolActivityGroupCard({
  active,
  locale,
  onFileLink,
  tools,
}: {
  active: boolean;
  locale: Locale;
  onFileLink: (href: string) => void;
  tools: readonly ToolState[];
}) {
  const [open, setOpen] = useState(false);
  const status = tools.some((tool) => tool.status === "running")
    ? "running"
    : tools.some((tool) => tool.status === "failed")
      ? "failed"
      : "completed";
  const visualStatus = active && status === "completed" ? "running" : status;
  const representative =
    [...tools].reverse().find((tool) => tool.status === "running") ??
    [...tools]
      .reverse()
      .find((tool) => toolActivityKind(tool.name, tool.input) === "search") ??
    tools.at(-1);
  const kind = representative
    ? toolActivityKind(representative.name, representative.input)
    : "generic";
  const summary = summarizeToolGroup(tools, locale);
  const toolLabels = localizedCopy(
    locale,
    "app",
    {
      en: {
        running: "Running",
        completed: "Completed",
        failed: "Failed",
        collapse: "Collapse",
        expand: "Expand",
      },
      "zh-CN": {
        running: "正在运行",
        completed: "已完成",
        failed: "失败",
        collapse: "收起",
        expand: "展开",
      },
    }[legacyLocale(locale)],
  );
  const statusLabel = toolLabels[status];
  const bashTranscript =
    kind === "bash" ? formatBashTranscript(tools) : undefined;
  const fileActivity = kind === "read" || kind === "write" || kind === "search";

  return (
    <section className={`tool-card ${visualStatus}${open ? " open" : ""}`}>
      <div className="tool-summary-row">
        <span aria-hidden="true" className="tool-activity-icon">
          <ToolActivityIcon kind={kind} />
        </span>
        <span className="tool-summary-label" title={summary}>
          {summary}
        </span>
        <button
          aria-expanded={open}
          aria-label={`${open ? toolLabels.collapse : toolLabels.expand}: ${summary}, ${statusLabel}`}
          className="tool-disclosure"
          onClick={() => setOpen((value) => !value)}
          type="button"
        >
          <svg viewBox="0 0 16 16">
            <path d="m6 3.5 4.5 4.5L6 12.5" />
          </svg>
        </button>
      </div>
      {open && fileActivity && (
        <ol className="tool-activity-list">
          {tools.map((tool) => {
            const itemKind = toolActivityKind(tool.name, tool.input);
            const detail = summarizeToolDetail(tool, locale);
            const path = toolActivityPath(tool.input);
            const prefix =
              path && detail.endsWith(path)
                ? detail.slice(0, -path.length)
                : detail;
            return (
              <li className={tool.status} key={tool.id}>
                <span aria-hidden="true" className="tool-item-icon">
                  <ToolActivityIcon kind={itemKind} />
                </span>
                <span className="tool-item-label">
                  {prefix}
                  {path && detail.endsWith(path) && (
                    <button
                      className="tool-file-link"
                      onClick={() => onFileLink(path)}
                      type="button"
                    >
                      {path}
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {open && kind === "bash" && bashTranscript && (
        <pre aria-live="polite" className="bash-transcript" role="log">
          {bashTranscript}
        </pre>
      )}
      {open && !fileActivity && kind !== "bash" && (
        <div className="tool-details">
          {tools.map((tool) => {
            const input = formatToolInput(tool.name, tool.input);
            const output = formatToolOutput(tool.name, tool.output);
            if (!input && !output) return null;
            return (
              <section key={tool.id}>
                <span>{summarizeToolDetail(tool, locale)}</span>
                {input && <pre>{input}</pre>}
                {output && <pre>{output}</pre>}
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Timeline({
  installedPlugins,
  installedSkills,
  state,
  locale,
  onExternalLink,
  onFileLink,
  onFileLinkContextMenu,
  onOpenChildAgent,
  onResolve,
  onResolveUserInput,
}: {
  installedPlugins: readonly InstalledCodexPlugin[];
  installedSkills: readonly InstalledSkill[];
  state: ThreadViewState;
  locale: Locale;
  onExternalLink: (href: string) => void;
  onFileLink: (href: string) => void;
  onFileLinkContextMenu: (
    href: string,
    position: { x: number; y: number },
  ) => void;
  onOpenChildAgent: (child: ChildAgentState) => void;
  onResolve: (
    approval: ApprovalState,
    approved: boolean,
    scope: "once" | "session" | "project",
  ) => void;
  onResolveUserInput: (resolution: UserInputResolution) => Promise<void>;
}) {
  const t = appCopy(locale);
  const timelineCache = useRef<{
    entries: ReturnType<typeof groupTimelineActivities>;
    orderLength: number;
    lastEntry?: string;
  }>(undefined);
  const timelineEntries = useMemo(() => {
    const cached = timelineCache.current;
    const prefixMatches =
      cached &&
      cached.orderLength <= state.order.length &&
      (cached.orderLength === 0 ||
        state.order[cached.orderLength - 1] === cached.lastEntry);
    const entries = prefixMatches
      ? appendTimelineActivities(
          cached.entries,
          state.order,
          state.tools,
          cached.orderLength,
        )
      : groupTimelineActivities(state.order, state.tools);
    const lastEntry = state.order.at(-1);
    timelineCache.current = {
      entries,
      orderLength: state.order.length,
      ...(lastEntry ? { lastEntry } : {}),
    };
    return entries;
  }, [state.order, state.tools]);
  const activeToolGroupKey =
    state.status === "running" && state.queue.steering.length === 0
      ? latestVisibleToolGroupKey(timelineEntries, state.messageParts)
      : undefined;
  const childStatusLabels = localizedCopy(
    locale,
    "app",
    {
      "zh-CN": {
        queued: "等待开始",
        running: "已开始工作",
        blocked: "被阻塞",
        cancelling: "正在停止",
        completed: "已完成",
        failed: "失败",
        cancelled: "已停止",
      },
      en: {
        queued: "Waiting to start",
        running: "Started working",
        blocked: "Blocked",
        cancelling: "Stopping",
        completed: "Completed",
        failed: "Failed",
        cancelled: "Stopped",
      },
    }[legacyLocale(locale)],
  );
  return (
    <div className="timeline">
      {timelineEntries.map((timelineEntry) => {
        if (timelineEntry.kind === "tool-group") {
          const tools = timelineEntry.toolIds.flatMap((toolId) => {
            const tool = state.tools[toolId];
            return tool ? [tool] : [];
          });
          return tools.length > 0 ? (
            <ToolActivityGroupCard
              active={timelineEntry.key === activeToolGroupKey}
              key={timelineEntry.key}
              locale={locale}
              onFileLink={onFileLink}
              tools={tools}
            />
          ) : null;
        }
        const entry = timelineEntry.entry;
        const separator = entry.indexOf(":");
        const kind = entry.slice(0, separator);
        const id = entry.slice(separator + 1);
        if (separator < 0 || !id) return null;
        if (kind === "user") {
          const message = state.userMessages[id];
          if (!message) return null;
          const skillNames = selectedSkillNamesForPrompt(message.text);
          const visibleText = promptWithoutSelectedSkills(message.text);
          return (
            <article className="user-message" key={entry}>
              {skillNames.length > 0 && (
                <div className="user-message-capabilities">
                  {skillNames.map((name) => {
                    const skill = installedSkills.find(
                      (candidate) => candidate.name === name,
                    );
                    const plugin = installedPlugins.find((candidate) =>
                      candidate.skillNames.includes(name),
                    );
                    return (
                      <span className="user-message-capability" key={name}>
                        <span
                          className={`user-message-capability-icon${plugin ? " plugin-icon" : ""}`}
                        >
                          {plugin?.iconDataUrl ? (
                            <img
                              alt=""
                              draggable={false}
                              src={plugin.iconDataUrl}
                            />
                          ) : plugin ? (
                            <ResourceIcon />
                          ) : (
                            "✦"
                          )}
                        </span>
                        <strong>{skill?.name ?? name}</strong>
                      </span>
                    );
                  })}
                </div>
              )}
              {visibleText && (
                <div className="user-message-text">{visibleText}</div>
              )}
            </article>
          );
        }
        if (kind === "compaction") {
          const compaction = state.contextCompactions[id];
          if (!compaction) return null;
          return (
            <article
              aria-live="polite"
              className={`turn-status compaction-status ${compaction.status}`}
              key={entry}
              role="status"
            >
              <span
                className={`status-dot ${compaction.status === "completed" ? "idle" : "running"}`}
              />
              <span>
                {compaction.status === "running"
                  ? t.contextCompacting
                  : t.contextCompacted}
              </span>
            </article>
          );
        }
        if (kind === "part") {
          const part = state.messageParts[id];
          if (!part) return null;
          if (part.type === "thinking") return null;
          return (
            <article className="assistant-message" key={entry}>
              <MarkdownContent
                fileLinkIcons
                onExternalLink={onExternalLink}
                onFileLink={onFileLink}
                onFileLinkContextMenu={onFileLinkContextMenu}
                text={part.text}
              />
            </article>
          );
        }
        if (kind === "input") {
          const input = state.userInputs[id];
          if (!input) return null;
          return (
            <UserInputCard
              active={input.status === "pending"}
              input={input}
              key={entry}
              locale={locale}
              onResolve={onResolveUserInput}
            />
          );
        }
        if (kind === "approval") {
          const approval = state.approvals[id];
          if (!approval) return null;
          const approvalCopy = (
            <div className="approval-card-copy">
              <strong>{approval.summary}</strong>
              <small>{approval.command ?? approval.paths.join(", ")}</small>
              {approval.actorAgentId && (
                <small>
                  {t.agentActor}:{" "}
                  {state.childAgents[approval.actorAgentId]?.label ??
                    approval.actorAgentId}
                </small>
              )}
            </div>
          );
          const modelReason = approval.modelReason ? (
            <p className="approval-model-reason">
              <span>{t.modelReason}</span>
              {approval.modelReason}
            </p>
          ) : null;
          if (approval.status !== "pending") {
            return (
              <details
                className={`approval-card ${approval.status}`}
                key={entry}
              >
                <summary>
                  <span className="approval-shield">
                    <ApprovalIcon neutral />
                  </span>
                  <strong>
                    {approval.status === "approved"
                      ? t.approvalApproved
                      : t.approvalDenied}
                  </strong>
                  <span className="approval-card-chevron">
                    <ChevronIcon />
                  </span>
                </summary>
                <div className="approval-resolved-details">
                  {approvalCopy}
                  {modelReason}
                </div>
              </details>
            );
          }
          return (
            <article className={`approval-card ${approval.status}`} key={entry}>
              <header>
                <span className="approval-shield">
                  <ApprovalIcon neutral />
                </span>
                {approvalCopy}
              </header>
              {modelReason}
              <div className="approval-actions">
                <button
                  className="secondary-button"
                  onClick={() => onResolve(approval, false, "once")}
                >
                  {t.deny}
                  {approval.modelRecommendation === "deny" && (
                    <small className="recommendation-badge">
                      {t.recommended}
                    </small>
                  )}
                </button>
                {approval.allowedScopes.includes("project") && (
                  <button
                    className="secondary-button"
                    onClick={() => onResolve(approval, true, "project")}
                  >
                    {t.approveProject}
                  </button>
                )}
                {approval.allowedScopes.includes("session") && (
                  <button
                    className="secondary-button"
                    onClick={() => onResolve(approval, true, "session")}
                  >
                    {t.approveSession}
                  </button>
                )}
                {approval.allowedScopes.includes("once") && (
                  <button
                    className="primary-button compact"
                    onClick={() => onResolve(approval, true, "once")}
                  >
                    {t.approveOnce}
                    {approval.modelRecommendation === "approve" && (
                      <small className="recommendation-badge">
                        {t.recommended}
                      </small>
                    )}
                  </button>
                )}
              </div>
            </article>
          );
        }
        if (kind === "child") {
          const child = state.childAgents[id];
          if (child?.parentAgentId && child.parentAgentId !== "parent") {
            return null;
          }
          return child ? (
            <button
              aria-label={`${child.label}, ${childStatusLabels[child.status]}`}
              className={`child-agent-card ${child.status} ${child.health ?? "healthy"}`}
              key={entry}
              onClick={() => onOpenChildAgent(child)}
              type="button"
            >
              <span className="child-agent-pill">
                <ChildAgentIcon
                  className="child-agent-icon"
                  identity={child.agentId}
                />
                <strong>{child.label}</strong>
              </span>
              <span className="child-agent-status">
                {childStatusLabels[child.status]}
              </span>
              <span aria-hidden="true" className="child-agent-open-icon">
                <Icon size={14}>
                  <path
                    d="m9 6 6 6-6 6"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.7"
                  />
                </Icon>
              </span>
            </button>
          ) : null;
        }
        return null;
      })}
      {state.queue.steering.map((message, index) => (
        <article
          className="user-message steering-message"
          key={`steering:${index}:${message}`}
        >
          {message}
        </article>
      ))}
      {state.error && <div className="error-card">{state.error}</div>}
    </div>
  );
}
