import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  type AgentTeamState,
  type AppLocale,
  type ChildAgentState,
  type McpToolUsageState,
  type Project,
  type PromptAttachment,
  type TaskSourceState,
} from "@artemis/protocol";

import type {
  ProjectGitInfo,
  ProjectPullRequest,
  ProjectPullRequestCheck,
  ProjectPullRequestLookup,
  ReviewScope,
} from "../shared/api.js";
import { localizedCopy } from "../shared/i18n-resources.js";
import { legacyLocale } from "../shared/locales.js";
import { ChildAgentIcon } from "./ChildAgentIcon.js";

export const ENVIRONMENT_PANEL_RESERVED_WORKSPACE_WIDTH = 328;
export const ENVIRONMENT_PANEL_MIN_CONVERSATION_WIDTH = 720;

export interface EnvironmentPanelLayoutSpace {
  workspaceWidth: number;
  panelWidth: number;
  layoutGap: number;
  minimumConversationWidth: number;
}

export function environmentPanelConversationWidth(
  layout: Readonly<EnvironmentPanelLayoutSpace>,
) {
  return Math.max(
    0,
    layout.workspaceWidth - layout.panelWidth - layout.layoutGap,
  );
}

export function shouldAutoHideEnvironmentPanel(
  layout: Readonly<EnvironmentPanelLayoutSpace>,
) {
  return (
    environmentPanelConversationWidth(layout) < layout.minimumConversationWidth
  );
}

export function environmentPanelVisibilityAfterResize(
  current: Readonly<{ open: boolean; autoHidden: boolean }>,
  layout: Readonly<EnvironmentPanelLayoutSpace>,
) {
  if (shouldAutoHideEnvironmentPanel(layout) && current.open) {
    return { open: false, autoHidden: true };
  }
  if (!shouldAutoHideEnvironmentPanel(layout) && current.autoHidden) {
    return { open: true, autoHidden: false };
  }
  return current;
}

function cssPixels(
  styles: CSSStyleDeclaration,
  property: string,
  fallback: number,
) {
  const value = Number.parseFloat(styles.getPropertyValue(property));
  return Number.isFinite(value) ? value : fallback;
}

const labels = {
  en: {
    trigger: "Task environment",
    title: "Environment",
    addProject: "Add project",
    changes: "Changes",
    filesChanged: (count: number) =>
      `${count} changed ${count === 1 ? "file" : "files"}`,
    local: "Local",
    branch: "Branch",
    detached: "Detached HEAD",
    detachedBlocked: "Switch to a branch first",
    compareBranch: "Compare branch",
    commitOrPush: "Commit or push",
    commitMessage: "Commit message",
    commitMessagePlaceholder: "Commit message (leave blank to generate)…",
    includeUnstaged: "Include unstaged changes",
    commit: "Commit",
    commitAndPush: "Commit and push",
    push: "Push",
    commitAndPushConfirm: (count: number, upstream: string) =>
      `Commit these changes and push ${count} ${count === 1 ? "commit" : "commits"} to ${upstream}?`,
    commitDestination: "Commit to",
    newBranch: "New branch",
    newBranchPlaceholder: "codex/my-branch",
    noSelectedChanges: "There are no selected changes to commit.",
    commitChangesFirst: "Commit the working tree changes first",
    cancel: "Cancel",
    pushCommits: (count: number) =>
      `Push ${count} ${count === 1 ? "commit" : "commits"}`,
    pushConfirm: (count: number, upstream: string) =>
      `Push ${count} ${count === 1 ? "commit" : "commits"} to ${upstream}?`,
    synced: "Up to date",
    noUpstream: "No upstream configured",
    behind: "Pull or reconcile the upstream first",
    conflicts: "Resolve conflicts first",
    stopTasks: "Stop active local tasks first",
    committing: "Committing…",
    pushing: "Pushing…",
    commitCreated: (commit: string) => `Created commit ${commit}`,
    pushCompleted: (upstream: string) => `Pushed to ${upstream}`,
    loading: "Loading environment…",
    retry: "Retry",
    notGit: "This project is not a Git repository.",
    githubChecking: "Checking GitHub pull request…",
    githubUnavailable: "Install GitHub CLI to show pull request checks.",
    githubAuthentication: "Sign in with gh to show pull request checks.",
    githubStale: "Last known GitHub state · refresh failed",
    pullRequestDraft: "Draft",
    pullRequestOpen: "Open",
    pullRequestMerged: "Merged",
    pullRequestClosed: "Closed",
    checksPassed: "Checks passed",
    checksFailed: "Checks failed",
    checksPending: "Checks running",
    checksSkipped: "Checks skipped",
    checksCancelled: "Checks cancelled",
    checksNone: "No checks reported",
    checkDetails: "Pull request checks",
    localChangesNotChecked: "Checks do not include local working tree changes.",
    unpushedCommitNotChecked: "Checks do not include unpushed commits.",
    differentHeadNotChecked: "Checks ran against a different commit.",
    agents: "Sub-agents",
    agentSummary: (total: number, active: number) =>
      `${total} total · ${active} active`,
    noAgents: "No sub-agents have been used in this task.",
    teams: "Teams",
    parentAgent: "Parent agent",
    usedBy: "Used by",
    agentQueued: "Waiting to start",
    agentRunning: "Started working",
    agentBlocked: "Blocked",
    agentCancelling: "Stopping",
    agentCompleted: "Completed",
    agentFailed: "Failed",
    agentCancelled: "Stopped",
    teamForming: "Forming",
    teamRunning: "Running",
    teamBlocked: "Blocked",
    teamIntegrating: "Awaiting parent integration",
    teamCompleted: "Completed",
    teamAborted: "Aborted",
    active: "Active",
    queued: "Queued",
    blocked: "Blocked",
    completed: "Completed",
    viewAll: "View all",
    showLess: "Show less",
    usedMcp: "Used MCP",
    noMcp: "No MCP server has been used in this task.",
    mcpSummary: (calls: number, agents: number) =>
      `${calls} ${calls === 1 ? "call" : "calls"} · ${agents} ${agents === 1 ? "agent" : "agents"}`,
    sources: "Sources",
    addSources: "Add sources",
    noSources: "No sources have been attached to this task.",
    draft: "Draft",
    sent: "Sent",
    webSearchSummary: (engine: string, count: number) =>
      `${engine} · ${count} ${count === 1 ? "result" : "results"}`,
  },
  "zh-CN": {
    trigger: "任务环境",
    title: "环境信息",
    addProject: "添加项目",
    changes: "变更",
    filesChanged: (count: number) => `${count} 个文件发生变更`,
    local: "本地",
    branch: "分支",
    detached: "分离的 HEAD",
    detachedBlocked: "请先切换到一个分支",
    compareBranch: "比较分支",
    commitOrPush: "提交或推送",
    commitMessage: "提交说明",
    commitMessagePlaceholder: "提交信息（留空将自动生成）…",
    includeUnstaged: "包含未暂存的更改",
    commit: "提交",
    commitAndPush: "提交并推送",
    push: "推送",
    commitAndPushConfirm: (count: number, upstream: string) =>
      `提交这些更改，并将共 ${count} 个提交推送到 ${upstream}？`,
    commitDestination: "提交到",
    newBranch: "新分支",
    newBranchPlaceholder: "codex/my-branch",
    noSelectedChanges: "没有可提交的已选更改",
    commitChangesFirst: "请先提交工作区更改",
    cancel: "取消",
    pushCommits: (count: number) => `推送 ${count} 个提交`,
    pushConfirm: (count: number, upstream: string) =>
      `将 ${count} 个提交推送到 ${upstream}？`,
    synced: "已与远端同步",
    noUpstream: "当前分支没有 upstream",
    behind: "请先拉取或处理远端分叉",
    conflicts: "请先解决冲突",
    stopTasks: "请先停止正在运行的本地任务",
    committing: "正在提交…",
    pushing: "正在推送…",
    commitCreated: (commit: string) => `已创建提交 ${commit}`,
    pushCompleted: (upstream: string) => `已推送到 ${upstream}`,
    loading: "正在加载环境信息…",
    retry: "重试",
    notGit: "当前项目不是 Git 仓库。",
    githubChecking: "正在检查 GitHub 拉取请求…",
    githubUnavailable: "安装 GitHub CLI 后可显示拉取请求检查。",
    githubAuthentication: "登录 gh 后可显示拉取请求检查。",
    githubStale: "GitHub 上次状态 · 刷新失败",
    pullRequestDraft: "草稿",
    pullRequestOpen: "开放",
    pullRequestMerged: "已合并",
    pullRequestClosed: "已关闭",
    checksPassed: "检查通过",
    checksFailed: "检查失败",
    checksPending: "检查运行中",
    checksSkipped: "检查已跳过",
    checksCancelled: "检查已取消",
    checksNone: "未报告检查",
    checkDetails: "拉取请求检查",
    localChangesNotChecked: "检查不包含本地工作区更改。",
    unpushedCommitNotChecked: "检查不包含尚未推送的提交。",
    differentHeadNotChecked: "检查运行于另一个提交。",
    agents: "子代理",
    agentSummary: (total: number, active: number) =>
      `共 ${total} 个 · ${active} 个活跃`,
    noAgents: "当前任务尚未使用子代理。",
    teams: "团队",
    parentAgent: "父 Agent",
    usedBy: "使用 Agent",
    agentQueued: "等待开始",
    agentRunning: "已开始工作",
    agentBlocked: "被阻塞",
    agentCancelling: "正在停止",
    agentCompleted: "已完成",
    agentFailed: "失败",
    agentCancelled: "已停止",
    teamForming: "组建中",
    teamRunning: "运行中",
    teamBlocked: "阻塞",
    teamIntegrating: "等待父 Agent 集成",
    teamCompleted: "已完成",
    teamAborted: "已中止",
    active: "活跃",
    queued: "排队",
    blocked: "阻塞",
    completed: "完成",
    viewAll: "查看全部",
    showLess: "收起",
    usedMcp: "已使用的 MCP",
    noMcp: "当前任务尚未使用 MCP。",
    mcpSummary: (calls: number, agents: number) =>
      `${calls} 次调用 · ${agents} 个 Agent`,
    sources: "来源",
    addSources: "添加来源",
    noSources: "当前任务尚未添加来源。",
    draft: "草稿",
    sent: "已发送",
    webSearchSummary: (engine: string, count: number) =>
      `${engine} · ${count} 个结果`,
  },
} satisfies Record<"en" | "zh-CN", Record<string, unknown>>;

export interface McpGroup {
  id: string;
  name: string;
  calls: number;
  tools: string[];
  agents: string[];
}

type EnvironmentSourceItem =
  | {
      id: string;
      name: string;
      mimeType: string;
      kind: "file" | "image";
      draft: true;
      attachment: PromptAttachment;
    }
  | {
      id: string;
      name: string;
      mimeType: string;
      kind: "file" | "image";
      draft: false;
    }
  | {
      id: string;
      kind: "web-search";
      query: string;
      engine: string;
      resultCount: number;
      draft: false;
    };

export type ProjectPullRequestCheckSummary =
  "passed" | "failed" | "pending" | "skipped" | "cancelled" | "none";

export type ProjectPullRequestCoverageWarning =
  "working-tree" | "unpushed" | "head-mismatch";

export function projectPullRequestCheckSummary(
  checks: readonly ProjectPullRequestCheck[],
): ProjectPullRequestCheckSummary {
  if (checks.length === 0) return "none";
  if (checks.some((check) => check.status === "failed")) return "failed";
  if (checks.some((check) => check.status === "pending")) return "pending";
  if (checks.some((check) => check.status === "cancelled")) return "cancelled";
  if (checks.every((check) => check.status === "skipped")) return "skipped";
  return "passed";
}

export function projectPullRequestCoverageWarning(
  gitInfo: ProjectGitInfo,
  pullRequest: ProjectPullRequest,
): ProjectPullRequestCoverageWarning | undefined {
  if (gitInfo.changeCount > 0) return "working-tree";
  if (
    gitInfo.ahead > 0 &&
    (!gitInfo.headOid || gitInfo.headOid !== pullRequest.headRefOid)
  ) {
    return "unpushed";
  }
  if (gitInfo.headOid && gitInfo.headOid !== pullRequest.headRefOid) {
    return "head-mismatch";
  }
  return undefined;
}

export function environmentChecksPopoverPosition(
  anchor: Readonly<{
    left: number;
    right: number;
    top: number;
    bottom: number;
  }>,
  viewport: Readonly<{ width: number; height: number }>,
): { left: number; top: number } {
  const margin = 12;
  const gap = 10;
  const width = Math.min(360, Math.max(0, viewport.width - margin * 2));
  const height = Math.min(340, Math.max(0, viewport.height - margin * 2));
  const left =
    anchor.left >= width + gap + margin
      ? anchor.left - width - gap
      : Math.min(
          Math.max(margin, anchor.right + gap),
          Math.max(margin, viewport.width - width - margin),
        );
  const top = Math.min(
    Math.max(margin, anchor.top),
    Math.max(margin, viewport.height - height - margin),
  );
  return { left, top };
}

export interface AgentEnvironmentCounts {
  total: number;
  active: number;
  queued: number;
  blocked: number;
  completed: number;
}

export type GitEnvironmentAction =
  | { kind: "commit"; disabledReason?: string }
  | { kind: "push"; disabledReason?: string }
  | { kind: "idle"; disabledReason: string };

export function suggestedEnvironmentBranchName(title: string): string {
  const slug = title
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 60)
    .replace(/-+$/gu, "");
  return `codex/${slug || "changes"}`;
}

export function environmentAgentCounts(
  agents: readonly ChildAgentState[],
): AgentEnvironmentCounts {
  return agents.reduce<AgentEnvironmentCounts>(
    (counts, agent) => {
      counts.total += 1;
      if (agent.status === "running" || agent.status === "cancelling") {
        counts.active += 1;
      } else if (agent.status === "queued") {
        counts.queued += 1;
      } else if (agent.status === "blocked") {
        counts.blocked += 1;
      } else if (agent.status === "completed") {
        counts.completed += 1;
      }
      return counts;
    },
    { total: 0, active: 0, queued: 0, blocked: 0, completed: 0 },
  );
}

export function environmentDisplayAgents(
  agents: readonly ChildAgentState[],
  teams: readonly AgentTeamState[],
): ChildAgentState[] {
  const teamStatuses = new Map(
    teams.map((team) => [team.teamId, team.status] as const),
  );
  return agents.map((agent) => {
    if (
      !agent.teamId ||
      agent.status === "completed" ||
      agent.status === "failed" ||
      agent.status === "cancelled"
    ) {
      return agent;
    }
    const teamStatus = teamStatuses.get(agent.teamId);
    const status =
      teamStatus === "completed"
        ? "completed"
        : teamStatus === "aborted"
          ? "cancelled"
          : undefined;
    if (!status) return agent;
    const displayAgent: ChildAgentState = { ...agent, status };
    delete displayAgent.currentTool;
    delete displayAgent.currentToolStartedAt;
    return displayAgent;
  });
}

export function groupMcpUsage(
  usages: readonly McpToolUsageState[],
): McpGroup[] {
  const groups = new Map<
    string,
    { name: string; calls: number; tools: Set<string>; agents: Set<string> }
  >();
  for (const usage of usages) {
    const group = groups.get(usage.serverId) ?? {
      name: usage.serverName,
      calls: 0,
      tools: new Set<string>(),
      agents: new Set<string>(),
    };
    group.calls += 1;
    group.tools.add(usage.toolName);
    group.agents.add(usage.agentId);
    groups.set(usage.serverId, group);
  }
  return [...groups.entries()].map(([id, group]) => ({
    id,
    name: group.name,
    calls: group.calls,
    tools: [...group.tools],
    agents: [...group.agents],
  }));
}

export function environmentGitAction(
  info: ProjectGitInfo,
  actionsDisabled: boolean,
  copy: {
    stopTasks: string;
    conflicts: string;
    behind: string;
    noUpstream: string;
    synced: string;
    detachedBlocked: string;
  },
): GitEnvironmentAction {
  if (info.changeCount > 0) {
    return {
      kind: "commit",
      ...(actionsDisabled
        ? { disabledReason: copy.stopTasks }
        : !info.currentBranch
          ? { disabledReason: copy.detachedBlocked }
          : info.conflictCount > 0
            ? { disabledReason: copy.conflicts }
            : {}),
    };
  }
  if (info.ahead > 0) {
    return {
      kind: "push",
      ...(actionsDisabled
        ? { disabledReason: copy.stopTasks }
        : info.behind > 0
          ? { disabledReason: copy.behind }
          : !info.upstream
            ? { disabledReason: copy.noUpstream }
            : {}),
    };
  }
  return {
    kind: "idle",
    disabledReason: !info.currentBranch
      ? copy.detachedBlocked
      : !info.upstream
        ? copy.noUpstream
        : info.behind > 0
          ? copy.behind
          : copy.synced,
  };
}

function EnvironmentIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M4 7h8m4 0h4M4 17h4m4 0h8" />
      <circle cx="14" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </svg>
  );
}

function BranchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="7" cy="5" r="2" />
      <circle cx="17" cy="5" r="2" />
      <circle cx="7" cy="19" r="2" />
      <path d="M7 7v10m0-5c6 0 10-1 10-5" />
    </svg>
  );
}

function ChangesIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <rect height="16" rx="3" width="14" x="5" y="4" />
      <path d="M9 9h6m-3-3v6m-3 4h6" />
    </svg>
  );
}

function LocalIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M4 6.5h16v10H4zM2.5 19h19" />
    </svg>
  );
}

function McpIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="6" cy="12" r="2" />
      <circle cx="18" cy="6" r="2" />
      <circle cx="18" cy="18" r="2" />
      <path d="m8 11 8-4m-8 6 8 4" />
    </svg>
  );
}

function CompareIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="7" cy="6" r="2" />
      <circle cx="17" cy="18" r="2" />
      <path d="M7 8v5c0 3 2 5 5 5h3M17 16v-5c0-3-2-5-5-5H9" />
    </svg>
  );
}

function PushIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M8 17H6.5a4.5 4.5 0 0 1-.7-8.95A6.5 6.5 0 0 1 18.3 7a4 4 0 0 1-.8 7.92H16" />
      <path d="m9 13 3-3 3 3M12 10v9" />
    </svg>
  );
}

function PullRequestIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="6" cy="5" r="2" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="5" r="2" />
      <path d="M6 7v10m12-10v3c0 4-3 7-7 7H9m6-9 3-3 3 3" />
    </svg>
  );
}

function WebSourceIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="8" />
      <path d="M4 12h16M12 4c2.5 2.2 3.7 4.8 3.7 8s-1.2 5.8-3.7 8c-2.5-2.2-3.7-4.8-3.7-8S9.5 6.2 12 4Z" />
    </svg>
  );
}

function SourceIcon({ image }: { image: boolean }) {
  return image ? (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <rect height="16" rx="3" width="18" x="3" y="4" />
      <circle cx="9" cy="10" r="2" />
      <path d="m5 18 5-5 3 3 2-2 4 4" />
    </svg>
  ) : (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M6 3h8l4 4v14H6zM14 3v5h4" />
    </svg>
  );
}

export function EnvironmentPanel({
  actionsDisabled,
  agents,
  attachments,
  defaultOpen,
  dockOffset,
  dockOpen,
  locale,
  mcpUsages,
  onAddProject,
  onAddSources,
  onConfirm,
  onMessage,
  onOpenChange,
  onOpenAgent,
  onOpenReview,
  onOpenTeam,
  onOpenUrl,
  onViewAllSources,
  project,
  refreshKey,
  sources,
  taskTitle,
  teams,
}: {
  actionsDisabled: boolean;
  agents: ChildAgentState[];
  attachments: PromptAttachment[];
  defaultOpen: boolean;
  dockOffset: number;
  dockOpen: boolean;
  locale: AppLocale;
  mcpUsages: McpToolUsageState[];
  onAddProject: () => void;
  onAddSources: () => void;
  onConfirm: (message: string) => Promise<boolean>;
  onMessage: (message: string, error?: boolean) => void;
  onOpenChange: (open: boolean) => void;
  onOpenAgent: (agent: ChildAgentState) => void;
  onOpenReview: (scope: ReviewScope) => void;
  onOpenTeam: (team: AgentTeamState) => void;
  onOpenUrl: (url: string) => void;
  onViewAllSources: () => void;
  project: Project;
  refreshKey?: string;
  sources: TaskSourceState[];
  taskTitle: string;
  teams: AgentTeamState[];
}) {
  const t = localizedCopy(locale, "app", labels[legacyLocale(locale)]);
  const control = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const gitRequest = useRef(0);
  const pullRequestRequest = useRef(0);
  const checksTrigger = useRef<HTMLButtonElement>(null);
  const checksPopover = useRef<HTMLDivElement>(null);
  const checksCloseTimer = useRef<number | undefined>(undefined);
  const autoHidden = useRef(false);
  const openRef = useRef(defaultOpen);
  const [open, setOpen] = useState(defaultOpen);
  const [gitInfo, setGitInfo] = useState<ProjectGitInfo>();
  const [gitError, setGitError] = useState<string>();
  const [gitLoading, setGitLoading] = useState(false);
  const [pullRequestLookup, setPullRequestLookup] =
    useState<ProjectPullRequestLookup>();
  const [pullRequestError, setPullRequestError] = useState<string>();
  const [pullRequestLoading, setPullRequestLoading] = useState(false);
  const [checksOpen, setChecksOpen] = useState(false);
  const [checksPosition, setChecksPosition] = useState({ left: 12, top: 12 });
  const [gitBusy, setGitBusy] = useState<
    "commit" | "push" | "commit-push" | "branch"
  >();
  const [commitOpen, setCommitOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [includeUnstaged, setIncludeUnstaged] = useState(true);
  const [commitBranchOpen, setCommitBranchOpen] = useState(false);
  const [creatingCommitBranch, setCreatingCommitBranch] = useState(false);
  const [newCommitBranch, setNewCommitBranch] = useState(() =>
    suggestedEnvironmentBranchName(taskTitle),
  );
  const [branchOpen, setBranchOpen] = useState(false);
  const [showAllAgents, setShowAllAgents] = useState(false);

  useLayoutEffect(() => {
    onOpenChange(open);
    return () => onOpenChange(false);
  }, [onOpenChange, open]);

  const closePanel = useCallback(() => {
    autoHidden.current = false;
    openRef.current = false;
    setOpen(false);
  }, []);

  const togglePanel = useCallback(() => {
    autoHidden.current = false;
    openRef.current = !openRef.current;
    setOpen(openRef.current);
  }, []);

  const cancelChecksClose = useCallback(() => {
    if (checksCloseTimer.current !== undefined) {
      window.clearTimeout(checksCloseTimer.current);
      checksCloseTimer.current = undefined;
    }
  }, []);

  const closeChecks = useCallback(() => {
    cancelChecksClose();
    setChecksOpen(false);
  }, [cancelChecksClose]);

  const showChecks = useCallback(() => {
    cancelChecksClose();
    const anchor = checksTrigger.current?.getBoundingClientRect();
    if (anchor) {
      setChecksPosition(
        environmentChecksPopoverPosition(anchor, {
          width: window.innerWidth,
          height: window.innerHeight,
        }),
      );
    }
    setChecksOpen(true);
  }, [cancelChecksClose]);

  const showChecksWithFocus = useCallback(() => {
    showChecks();
    window.requestAnimationFrame(() => checksPopover.current?.focus());
  }, [showChecks]);

  const scheduleChecksClose = useCallback(() => {
    cancelChecksClose();
    checksCloseTimer.current = window.setTimeout(() => {
      checksCloseTimer.current = undefined;
      setChecksOpen(false);
    }, 140);
  }, [cancelChecksClose]);

  const syncVisibility = useCallback(() => {
    const workspace = control.current?.closest(".workspace");
    if (!(workspace instanceof HTMLElement)) return;
    const styles = window.getComputedStyle(workspace);
    const current = {
      open: openRef.current,
      autoHidden: autoHidden.current,
    };
    const next = environmentPanelVisibilityAfterResize(current, {
      workspaceWidth: workspace.getBoundingClientRect().width,
      panelWidth: cssPixels(styles, "--environment-panel-inline-size", 304),
      layoutGap: cssPixels(styles, "--environment-panel-layout-gap", 24),
      minimumConversationWidth: cssPixels(
        styles,
        "--environment-panel-min-conversation-inline-size",
        ENVIRONMENT_PANEL_MIN_CONVERSATION_WIDTH,
      ),
    });
    if (next === current) return;
    autoHidden.current = next.autoHidden;
    openRef.current = next.open;
    setOpen(next.open);
  }, []);

  useLayoutEffect(() => {
    const workspace = control.current?.closest(".workspace");
    if (
      !(workspace instanceof HTMLElement) ||
      typeof window.ResizeObserver !== "function"
    ) {
      return;
    }

    syncVisibility();
    const observer = new window.ResizeObserver(syncVisibility);
    observer.observe(workspace);
    return () => observer.disconnect();
  }, [syncVisibility]);

  useLayoutEffect(() => {
    autoHidden.current = false;
    openRef.current = !dockOpen;
    setOpen(!dockOpen);
    if (!dockOpen) syncVisibility();
  }, [dockOpen, syncVisibility]);

  const loadGit = useCallback(async () => {
    const id = ++gitRequest.current;
    setGitLoading(true);
    setGitError(undefined);
    try {
      const info = await window.artemis.getProjectGitInfo(project.id);
      if (gitRequest.current === id) setGitInfo(info);
    } catch (error) {
      if (gitRequest.current === id) {
        setGitError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (gitRequest.current === id) setGitLoading(false);
    }
  }, [project.id]);

  const loadPullRequest = useCallback(async () => {
    const id = ++pullRequestRequest.current;
    setPullRequestLoading(true);
    setPullRequestError(undefined);
    try {
      const lookup = await window.artemis.getProjectPullRequest(project.id);
      if (pullRequestRequest.current !== id) return;
      setPullRequestLookup(lookup);
      if (lookup.status !== "found") setChecksOpen(false);
    } catch (error) {
      if (pullRequestRequest.current === id) {
        setPullRequestError(
          error instanceof Error ? error.message : String(error),
        );
      }
    } finally {
      if (pullRequestRequest.current === id) setPullRequestLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    setGitInfo(undefined);
    setPullRequestLookup(undefined);
    setPullRequestError(undefined);
    setChecksOpen(false);
    setCommitOpen(false);
    setCommitMessage("");
    setIncludeUnstaged(true);
    setCommitBranchOpen(false);
    setCreatingCommitBranch(false);
    setNewCommitBranch(suggestedEnvironmentBranchName(taskTitle));
    setBranchOpen(false);
  }, [project.id, taskTitle]);

  useEffect(() => {
    if (open) return;
    setBranchOpen(false);
    setChecksOpen(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    void loadGit();
    void loadPullRequest();
  }, [loadGit, loadPullRequest, open, refreshKey]);

  useEffect(() => {
    if (!open) return;
    const refreshOnFocus = () => {
      void loadGit();
      void loadPullRequest();
    };
    window.addEventListener("focus", refreshOnFocus);
    const frame = window.requestAnimationFrame(() => panel.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [loadGit, loadPullRequest, open]);

  useEffect(() => {
    if (
      !open ||
      pullRequestLookup?.status !== "found" ||
      pullRequestLookup.pullRequest.state !== "OPEN" ||
      !pullRequestLookup.pullRequest.checks.some(
        (check) => check.status === "pending",
      )
    ) {
      return;
    }
    const interval = window.setInterval(() => void loadPullRequest(), 15_000);
    return () => window.clearInterval(interval);
  }, [loadPullRequest, open, pullRequestLookup]);

  useEffect(
    () => () => {
      cancelChecksClose();
    },
    [cancelChecksClose],
  );

  useEffect(() => {
    if (!checksOpen) return;
    const closeOutside = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        checksTrigger.current?.contains(target) ||
        checksPopover.current?.contains(target)
      ) {
        return;
      }
      closeChecks();
    };
    window.addEventListener("mousedown", closeOutside);
    return () => window.removeEventListener("mousedown", closeOutside);
  }, [checksOpen, closeChecks]);

  useEffect(() => {
    if (!open && !commitOpen) return;
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (checksOpen) {
        closeChecks();
        checksTrigger.current?.focus();
      } else if (commitBranchOpen) {
        setCommitBranchOpen(false);
      } else if (commitOpen) {
        setCommitOpen(false);
        setCreatingCommitBranch(false);
        setCommitMessage("");
      } else if (branchOpen) {
        setBranchOpen(false);
      } else {
        closePanel();
        window.requestAnimationFrame(() => trigger.current?.focus());
      }
    };
    window.addEventListener("keydown", closeEscape);
    return () => window.removeEventListener("keydown", closeEscape);
  }, [
    branchOpen,
    checksOpen,
    closeChecks,
    closePanel,
    commitBranchOpen,
    commitOpen,
    open,
  ]);

  const displayAgents = useMemo(
    () => environmentDisplayAgents(agents, teams),
    [agents, teams],
  );
  const counts = useMemo(
    () => environmentAgentCounts(displayAgents),
    [displayAgents],
  );
  const mcpGroups = useMemo(() => groupMcpUsage(mcpUsages), [mcpUsages]);
  const agentNames = useMemo(
    () =>
      new Map<string, string>([
        ["parent", t.parentAgent],
        ...displayAgents.map((agent) => [agent.agentId, agent.label] as const),
      ]),
    [displayAgents, t.parentAgent],
  );
  const agentStatusLabels: Record<ChildAgentState["status"], string> = {
    queued: t.agentQueued,
    running: t.agentRunning,
    blocked: t.agentBlocked,
    cancelling: t.agentCancelling,
    completed: t.agentCompleted,
    failed: t.agentFailed,
    cancelled: t.agentCancelled,
  };
  const teamStatusLabels: Record<AgentTeamState["status"], string> = {
    forming: t.teamForming,
    running: t.teamRunning,
    blocked: t.teamBlocked,
    integrating: t.teamIntegrating,
    completed: t.teamCompleted,
    aborted: t.teamAborted,
  };
  const pullRequest =
    pullRequestLookup?.status === "found"
      ? pullRequestLookup.pullRequest
      : undefined;
  const checkSummary = projectPullRequestCheckSummary(
    pullRequest?.checks ?? [],
  );
  const checkSummaryLabels: Record<ProjectPullRequestCheckSummary, string> = {
    passed: t.checksPassed,
    failed: t.checksFailed,
    pending: t.checksPending,
    skipped: t.checksSkipped,
    cancelled: t.checksCancelled,
    none: t.checksNone,
  };
  const pullRequestStateLabel = pullRequest?.isDraft
    ? t.pullRequestDraft
    : pullRequest?.state === "OPEN"
      ? t.pullRequestOpen
      : pullRequest?.state === "MERGED"
        ? t.pullRequestMerged
        : t.pullRequestClosed;
  const coverageWarning =
    gitInfo && pullRequest
      ? projectPullRequestCoverageWarning(gitInfo, pullRequest)
      : undefined;
  const coverageWarningLabel = coverageWarning
    ? {
        "working-tree": t.localChangesNotChecked,
        unpushed: t.unpushedCommitNotChecked,
        "head-mismatch": t.differentHeadNotChecked,
      }[coverageWarning]
    : undefined;
  const selectedChangeCount = gitInfo
    ? includeUnstaged
      ? gitInfo.changeCount
      : gitInfo.stagedCount
    : 0;
  const commitDisabledReason = !gitInfo
    ? t.loading
    : actionsDisabled
      ? t.stopTasks
      : gitInfo.conflictCount > 0
        ? t.conflicts
        : !creatingCommitBranch && !gitInfo.currentBranch
          ? t.detachedBlocked
          : creatingCommitBranch && !newCommitBranch.trim()
            ? t.newBranchPlaceholder
            : selectedChangeCount === 0
              ? t.noSelectedChanges
              : undefined;
  const commitAndPushDisabledReason =
    commitDisabledReason ??
    (!includeUnstaged &&
    ((gitInfo?.unstagedCount ?? 0) > 0 || (gitInfo?.untrackedCount ?? 0) > 0)
      ? t.commitChangesFirst
      : creatingCommitBranch
        ? t.noUpstream
        : !gitInfo?.upstream
          ? t.noUpstream
          : gitInfo.behind > 0
            ? t.behind
            : undefined);
  const pushDisabledReason = !gitInfo
    ? t.loading
    : actionsDisabled
      ? t.stopTasks
      : gitInfo.conflictCount > 0
        ? t.conflicts
        : creatingCommitBranch || !gitInfo.currentBranch
          ? creatingCommitBranch
            ? t.noUpstream
            : t.detachedBlocked
          : gitInfo.changeCount > 0
            ? t.commitChangesFirst
            : !gitInfo.upstream
              ? t.noUpstream
              : gitInfo.behind > 0
                ? t.behind
                : gitInfo.ahead === 0
                  ? t.synced
                  : undefined;
  const activityPreviewLimit = 2;
  const visibleTeams = showAllAgents
    ? teams
    : teams.slice(0, activityPreviewLimit);
  const visibleAgents = showAllAgents
    ? displayAgents
    : displayAgents.slice(
        0,
        Math.max(0, activityPreviewLimit - visibleTeams.length),
      );
  const visibleMcp = mcpGroups.slice(0, 3);
  const combinedSources: EnvironmentSourceItem[] = [
    ...attachments.map((attachment, index) => ({
      id: `draft:${index}:${attachment.name}`,
      name: attachment.name,
      mimeType: attachment.mimeType,
      kind: "type" in attachment ? ("file" as const) : ("image" as const),
      draft: true as const,
      attachment,
    })),
    ...sources.map((source): EnvironmentSourceItem =>
      source.kind === "web-search"
        ? {
            id: source.sourceId,
            kind: "web-search",
            query: source.query,
            engine: source.engine,
            resultCount: source.resultCount,
            draft: false,
          }
        : {
            id: source.sourceId,
            name: source.name,
            mimeType: source.mimeType,
            kind: source.kind,
            draft: false,
          },
    ),
  ];
  const sourcePreviewLimit =
    displayAgents.length > 0 || teams.length > 0 || mcpGroups.length > 0
      ? 1
      : 3;
  const visibleSources = combinedSources.slice(0, sourcePreviewLimit);
  const hasSourcePanelDetails =
    combinedSources.length > visibleSources.length ||
    mcpGroups.length > 0 ||
    sources.some(
      (source) => source.kind === "web-search" && source.links.length > 0,
    );

  const viewAllSources = () => {
    closePanel();
    onViewAllSources();
  };

  const closeCommitDialog = () => {
    setCommitOpen(false);
    setCommitBranchOpen(false);
    setCreatingCommitBranch(false);
    setNewCommitBranch(suggestedEnvironmentBranchName(taskTitle));
    setCommitMessage("");
  };

  const createCommitDestination = async (): Promise<
    ProjectGitInfo | undefined
  > => {
    if (!creatingCommitBranch) return gitInfo;
    if (!newCommitBranch.trim()) return undefined;
    const info = await window.artemis.createProjectBranch(
      project.id,
      newCommitBranch,
    );
    setGitInfo(info);
    setCreatingCommitBranch(false);
    return info;
  };

  const commit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (gitBusy || commitDisabledReason) return;
    setGitBusy("commit");
    setGitError(undefined);
    try {
      if (!(await createCommitDestination())) return;
      const result = await window.artemis.commitProjectChanges(
        project.id,
        commitMessage,
        includeUnstaged,
      );
      setGitInfo(result.gitInfo);
      closeCommitDialog();
      onMessage(t.commitCreated(result.commit.slice(0, 7)));
      void loadPullRequest();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setGitError(message);
      onMessage(message, true);
      await loadGit();
    } finally {
      setGitBusy(undefined);
    }
  };

  const push = async (confirmed = false) => {
    if (!gitInfo?.upstream || gitBusy || pushDisabledReason) return;
    if (
      !confirmed &&
      !(await onConfirm(t.pushConfirm(gitInfo.ahead, gitInfo.upstream)))
    ) {
      return;
    }
    setGitBusy("push");
    setGitError(undefined);
    try {
      const result = await window.artemis.pushProjectBranch(project.id);
      setGitInfo(result.gitInfo);
      closeCommitDialog();
      onMessage(t.pushCompleted(result.upstream));
      void loadPullRequest();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setGitError(message);
      onMessage(message, true);
      await loadGit();
    } finally {
      setGitBusy(undefined);
    }
  };

  const commitAndPush = async () => {
    if (!gitInfo?.upstream || gitBusy || commitAndPushDisabledReason) return;
    if (
      !(await onConfirm(
        t.commitAndPushConfirm(gitInfo.ahead + 1, gitInfo.upstream),
      ))
    ) {
      return;
    }
    setGitBusy("commit-push");
    setGitError(undefined);
    try {
      const committed = await window.artemis.commitProjectChanges(
        project.id,
        commitMessage,
        includeUnstaged,
      );
      setGitInfo(committed.gitInfo);
      const pushed = await window.artemis.pushProjectBranch(project.id);
      setGitInfo(pushed.gitInfo);
      closeCommitDialog();
      onMessage(t.pushCompleted(pushed.upstream));
      void loadPullRequest();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setGitError(message);
      onMessage(message, true);
      await loadGit();
    } finally {
      setGitBusy(undefined);
    }
  };

  const switchBranch = async (branch: string) => {
    if (actionsDisabled || gitBusy) return;
    setGitBusy("branch");
    setGitError(undefined);
    try {
      setGitInfo(await window.artemis.switchProjectBranch(project.id, branch));
      setBranchOpen(false);
      setCommitBranchOpen(false);
      setCreatingCommitBranch(false);
      await loadPullRequest();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setGitError(message);
      onMessage(message, true);
    } finally {
      setGitBusy(undefined);
    }
  };

  return (
    <div
      className="environment-control"
      data-dock-open={dockOpen}
      ref={control}
      style={dockOffset > 0 ? { marginInlineEnd: dockOffset } : undefined}
    >
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={t.trigger}
        className={`environment-trigger${open ? " active" : ""}`}
        onClick={togglePanel}
        ref={trigger}
        title={t.trigger}
        type="button"
      >
        <EnvironmentIcon />
      </button>
      {open && (
        <div
          aria-label={t.title}
          className="environment-popover"
          ref={panel}
          role="dialog"
          tabIndex={-1}
        >
          <section className="environment-section git-environment-section">
            <header>
              <h2>{t.title}</h2>
              <button
                aria-label={t.addProject}
                className="environment-header-action"
                onClick={onAddProject}
                title={t.addProject}
                type="button"
              >
                +
              </button>
            </header>
            {gitLoading && !gitInfo ? (
              <div className="environment-empty" role="status">
                {t.loading}
              </div>
            ) : gitError && !gitInfo ? (
              <div className="environment-empty error" role="alert">
                <span>{gitError}</span>
                <button onClick={() => void loadGit()} type="button">
                  {t.retry}
                </button>
              </div>
            ) : !gitInfo?.managed ? (
              <div className="environment-empty">{t.notGit}</div>
            ) : (
              <div className="environment-rows">
                <button
                  className="environment-row"
                  disabled={gitInfo.changeCount === 0}
                  onClick={() => {
                    closePanel();
                    onOpenReview(
                      gitInfo.unstagedCount > 0 || gitInfo.untrackedCount > 0
                        ? "unstaged"
                        : "staged",
                    );
                  }}
                  type="button"
                >
                  <span className="environment-row-icon">
                    <ChangesIcon />
                  </span>
                  <span className="environment-row-copy">
                    <strong>{t.changes}</strong>
                    <small>{t.filesChanged(gitInfo.changeCount)}</small>
                  </span>
                  <span className="environment-diff-total">
                    <i>+{gitInfo.additions}</i>
                    <b>−{gitInfo.deletions}</b>
                  </span>
                </button>
                <div className="environment-row static" title={gitInfo.root}>
                  <span className="environment-row-icon">
                    <LocalIcon />
                  </span>
                  <span className="environment-row-copy">
                    <strong>{t.local}</strong>
                    <small>{gitInfo.root}</small>
                  </span>
                </div>
                <div className="environment-branch-control">
                  <button
                    aria-expanded={branchOpen}
                    className="environment-row"
                    onClick={() => setBranchOpen((current) => !current)}
                    type="button"
                  >
                    <span className="environment-row-icon">
                      <BranchIcon />
                    </span>
                    <span className="environment-row-copy">
                      <strong>{gitInfo.currentBranch ?? t.detached}</strong>
                      <small>{gitInfo.upstream ?? t.branch}</small>
                    </span>
                    <span className="environment-chevron">⌄</span>
                  </button>
                  {branchOpen && (
                    <div className="environment-branch-menu" role="menu">
                      {gitInfo.branches.map((branch) => (
                        <button
                          aria-checked={branch.current}
                          className={branch.current ? "selected" : ""}
                          disabled={
                            Boolean(gitBusy) ||
                            (actionsDisabled && !branch.current)
                          }
                          key={branch.name}
                          onClick={() =>
                            branch.current
                              ? setBranchOpen(false)
                              : void switchBranch(branch.name)
                          }
                          role="menuitemradio"
                          type="button"
                        >
                          <BranchIcon />
                          <span>{branch.name}</span>
                          <i>{branch.current ? "✓" : ""}</i>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  className="environment-row"
                  onClick={() => {
                    closePanel();
                    onOpenReview("branch");
                  }}
                  type="button"
                >
                  <span className="environment-row-icon">
                    <CompareIcon />
                  </span>
                  <span className="environment-row-copy">
                    <strong>{t.compareBranch}</strong>
                    <small>{gitInfo.upstream ?? gitInfo.currentBranch}</small>
                  </span>
                  <span className="environment-external">↗</span>
                </button>
                <button
                  className="environment-row commit-push-row"
                  disabled={Boolean(gitBusy)}
                  onClick={() => {
                    setGitError(undefined);
                    setCommitOpen(true);
                  }}
                  type="button"
                >
                  <span className="environment-row-icon">
                    <ChangesIcon />
                  </span>
                  <span className="environment-row-copy">
                    <strong>{t.commitOrPush}</strong>
                    <small>{gitInfo.upstream ?? commitDisabledReason}</small>
                  </span>
                </button>
                {pullRequestLoading && !pullRequestLookup && (
                  <div className="environment-pr-notice" role="status">
                    <span className="environment-row-icon">
                      <PullRequestIcon />
                    </span>
                    <span>{t.githubChecking}</span>
                  </div>
                )}
                {pullRequestLookup?.status === "unavailable" && (
                  <div className="environment-pr-notice">
                    <span className="environment-row-icon">
                      <PullRequestIcon />
                    </span>
                    <span>
                      {pullRequestLookup.reason === "gh-not-installed"
                        ? t.githubUnavailable
                        : t.githubAuthentication}
                    </span>
                    <button
                      onClick={() => void loadPullRequest()}
                      type="button"
                    >
                      {t.retry}
                    </button>
                  </div>
                )}
                {pullRequest && (
                  <div className="environment-pr-card">
                    <button
                      className="environment-pr-title"
                      onClick={() => onOpenUrl(pullRequest.url)}
                      type="button"
                    >
                      <span className="environment-row-icon">
                        <PullRequestIcon />
                      </span>
                      <span>
                        <strong>{pullRequest.title}</strong>
                        <small>
                          #{pullRequest.number} · {pullRequestStateLabel}
                        </small>
                      </span>
                      <span className="environment-external">↗</span>
                    </button>
                    <button
                      aria-controls="environment-pr-checks"
                      aria-expanded={checksOpen}
                      aria-haspopup="dialog"
                      className="environment-pr-check-summary"
                      onBlur={(event) => {
                        const related = event.relatedTarget;
                        if (
                          related instanceof Node &&
                          checksPopover.current?.contains(related)
                        ) {
                          return;
                        }
                        scheduleChecksClose();
                      }}
                      onClick={() =>
                        checksOpen ? closeChecks() : showChecksWithFocus()
                      }
                      onFocus={showChecks}
                      onKeyDown={(event) => {
                        if (
                          event.key === "ArrowDown" ||
                          event.key === "Enter" ||
                          event.key === " "
                        ) {
                          event.preventDefault();
                          showChecksWithFocus();
                        }
                      }}
                      onMouseEnter={showChecks}
                      onMouseLeave={scheduleChecksClose}
                      ref={checksTrigger}
                      type="button"
                    >
                      <span
                        aria-hidden="true"
                        className="environment-check-indicator"
                        data-status={checkSummary}
                      />
                      <span>{checkSummaryLabels[checkSummary]}</span>
                      <span aria-hidden="true">⌄</span>
                    </button>
                    {coverageWarningLabel && (
                      <p className="environment-pr-warning">
                        {coverageWarningLabel}
                      </p>
                    )}
                    {pullRequestError && (
                      <p
                        className="environment-pr-stale"
                        title={pullRequestError}
                      >
                        {t.githubStale}
                      </p>
                    )}
                  </div>
                )}
                {pullRequestError && !pullRequest && (
                  <div className="environment-pr-notice error" role="alert">
                    <span>{pullRequestError}</span>
                    <button
                      onClick={() => void loadPullRequest()}
                      type="button"
                    >
                      {t.retry}
                    </button>
                  </div>
                )}
                {gitError && (
                  <p className="environment-inline-error" role="alert">
                    {gitError}
                  </p>
                )}
              </div>
            )}
          </section>

          {(displayAgents.length > 0 || teams.length > 0) && (
            <section className="environment-section">
              <header>
                <h2>{t.agents}</h2>
                {displayAgents.length + teams.length > activityPreviewLimit && (
                  <button
                    className="environment-text-action"
                    onClick={() => setShowAllAgents((current) => !current)}
                    type="button"
                  >
                    {showAllAgents ? t.showLess : t.viewAll}
                  </button>
                )}
              </header>
              <div className="environment-activity-list">
                <p className="environment-agent-summary">
                  {t.agentSummary(counts.total, counts.active)}
                </p>
                <div className="environment-summary-grid">
                  <span>
                    <b>{counts.active}</b>
                    {t.active}
                  </span>
                  <span>
                    {t.queued} {counts.queued}
                  </span>
                  <span>
                    {t.blocked} {counts.blocked}
                  </span>
                  <span>
                    {t.completed} {counts.completed}
                  </span>
                </div>
                {visibleTeams.map((team) => (
                  <button
                    className="environment-activity-row"
                    key={team.teamId}
                    onClick={() => {
                      closePanel();
                      onOpenTeam(team);
                    }}
                    type="button"
                  >
                    <span className="environment-row-icon">
                      <ChildAgentIcon
                        className="environment-agent-mark"
                        identity={team.teamId}
                      />
                    </span>
                    <span>
                      <strong>{team.mission}</strong>
                      <small>
                        {t.teams} · {teamStatusLabels[team.status]}
                      </small>
                    </span>
                    <i>›</i>
                  </button>
                ))}
                {visibleAgents.map((agent) => (
                  <button
                    className="environment-activity-row"
                    key={agent.agentId}
                    onClick={() => {
                      closePanel();
                      onOpenAgent(agent);
                    }}
                    type="button"
                  >
                    <span className="environment-row-icon">
                      <ChildAgentIcon
                        className="environment-agent-mark"
                        identity={agent.agentId}
                      />
                    </span>
                    <span>
                      <strong>{agent.label}</strong>
                      <small>
                        {agentStatusLabels[agent.status]}
                        {agent.currentTool ? ` · ${agent.currentTool}` : ""}
                      </small>
                    </span>
                    <i>›</i>
                  </button>
                ))}
              </div>
            </section>
          )}

          {mcpGroups.length > 0 && (
            <section className="environment-section">
              <header>
                <h2>{t.usedMcp}</h2>
                {mcpGroups.length > 3 && (
                  <button
                    className="environment-text-action"
                    onClick={viewAllSources}
                    type="button"
                  >
                    {t.viewAll}
                  </button>
                )}
              </header>
              <div className="environment-activity-list">
                {visibleMcp.map((group) => (
                  <div
                    className="environment-activity-row static"
                    key={group.id}
                  >
                    <span className="environment-row-icon">
                      <McpIcon />
                    </span>
                    <span>
                      <strong>{group.name}</strong>
                      <small>
                        {t.mcpSummary(group.calls, group.agents.length)} ·{" "}
                        {group.tools.join(", ")}
                      </small>
                      <small>
                        {t.usedBy} ·{" "}
                        {group.agents
                          .map((agentId) => agentNames.get(agentId) ?? agentId)
                          .join(", ")}
                      </small>
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {combinedSources.length > 0 && (
            <section className="environment-section sources-section">
              <header>
                <h2>{t.sources}</h2>
                <button
                  aria-label={t.addSources}
                  className="environment-header-action"
                  onClick={onAddSources}
                  title={t.addSources}
                  type="button"
                >
                  +
                </button>
              </header>
              <div className="environment-source-list">
                {visibleSources.map((source) =>
                  source.kind === "web-search" ? (
                    <div
                      className="environment-source-row web-search-source"
                      key={source.id}
                    >
                      <span className="environment-row-icon">
                        <WebSourceIcon />
                      </span>
                      <span>
                        <strong title={source.query}>{source.query}</strong>
                        <small>
                          {t.webSearchSummary(
                            source.engine,
                            source.resultCount,
                          )}
                        </small>
                      </span>
                    </div>
                  ) : (
                    <div className="environment-source-row" key={source.id}>
                      {source.draft &&
                      source.kind === "image" &&
                      source.attachment &&
                      !("type" in source.attachment) ? (
                        <img
                          alt=""
                          src={`data:${source.attachment.mimeType};base64,${source.attachment.data}`}
                        />
                      ) : (
                        <span className="environment-row-icon">
                          <SourceIcon image={source.kind === "image"} />
                        </span>
                      )}
                      <span>
                        <strong title={source.name}>{source.name}</strong>
                        <small>
                          {source.draft ? t.draft : t.sent} · {source.mimeType}
                        </small>
                      </span>
                    </div>
                  ),
                )}
                {hasSourcePanelDetails && (
                  <button
                    className="environment-view-all"
                    onClick={viewAllSources}
                    type="button"
                  >
                    <McpIcon />
                    <span>{t.viewAll}</span>
                  </button>
                )}
              </div>
            </section>
          )}
        </div>
      )}
      {open &&
        checksOpen &&
        pullRequest &&
        createPortal(
          <div
            aria-label={t.checkDetails}
            className="environment-checks-popover"
            id="environment-pr-checks"
            onBlur={(event) => {
              const related = event.relatedTarget;
              if (
                related instanceof Node &&
                (event.currentTarget.contains(related) ||
                  checksTrigger.current?.contains(related))
              ) {
                return;
              }
              scheduleChecksClose();
            }}
            onFocus={cancelChecksClose}
            onMouseEnter={cancelChecksClose}
            onMouseLeave={scheduleChecksClose}
            ref={checksPopover}
            role="dialog"
            style={{ left: checksPosition.left, top: checksPosition.top }}
            tabIndex={-1}
          >
            <header>
              <strong>{t.checkDetails}</strong>
              <small>
                #{pullRequest.number} · {pullRequestStateLabel}
              </small>
            </header>
            <div className="environment-check-list">
              {pullRequest.checks.length === 0 ? (
                <p>{t.checksNone}</p>
              ) : (
                pullRequest.checks.map((check, index) => {
                  const content = (
                    <>
                      <span
                        aria-hidden="true"
                        className="environment-check-indicator"
                        data-status={check.status}
                      />
                      <span>
                        <strong>{check.name}</strong>
                        <small>
                          {check.workflowName ? `${check.workflowName} · ` : ""}
                          {checkSummaryLabels[check.status]}
                        </small>
                      </span>
                      {check.detailsUrl && <i aria-hidden="true">↗</i>}
                    </>
                  );
                  return check.detailsUrl ? (
                    <button
                      key={`${check.name}:${index}`}
                      onClick={() => onOpenUrl(check.detailsUrl!)}
                      type="button"
                    >
                      {content}
                    </button>
                  ) : (
                    <div key={`${check.name}:${index}`}>{content}</div>
                  );
                })
              )}
            </div>
          </div>,
          document.body,
        )}
      {commitOpen &&
        gitInfo?.managed &&
        createPortal(
          <div
            className="environment-git-dialog-backdrop"
            onMouseDown={() => {
              if (!gitBusy) closeCommitDialog();
            }}
          >
            <form
              aria-label={t.commitOrPush}
              aria-modal="true"
              className="environment-git-dialog"
              onKeyDown={(event) => {
                if (event.key === "Tab") {
                  const focusable = [
                    ...event.currentTarget.querySelectorAll<HTMLElement>(
                      "button:not([disabled]), input:not([disabled]), textarea:not([disabled])",
                    ),
                  ];
                  const first = focusable[0];
                  const last = focusable.at(-1);
                  if (
                    first &&
                    last &&
                    ((event.shiftKey && document.activeElement === first) ||
                      (!event.shiftKey && document.activeElement === last))
                  ) {
                    event.preventDefault();
                    (event.shiftKey ? last : first).focus();
                  }
                  return;
                }
                if (
                  event.key === "Enter" &&
                  (event.metaKey || event.ctrlKey) &&
                  !commitDisabledReason &&
                  !gitBusy
                ) {
                  event.preventDefault();
                  event.currentTarget.requestSubmit();
                }
              }}
              onMouseDown={(event) => event.stopPropagation()}
              onSubmit={commit}
              role="dialog"
            >
              <div className="environment-git-destination">
                <button
                  aria-expanded={commitBranchOpen}
                  aria-haspopup="menu"
                  className="environment-git-destination-trigger"
                  disabled={Boolean(gitBusy)}
                  onClick={() => setCommitBranchOpen((current) => !current)}
                  type="button"
                >
                  <BranchIcon />
                  <strong>
                    {creatingCommitBranch
                      ? t.newBranch
                      : (gitInfo.currentBranch ?? t.detached)}
                  </strong>
                  <span>⌄</span>
                </button>
                {commitBranchOpen && (
                  <div
                    aria-label={t.commitDestination}
                    className="environment-git-destination-menu"
                    role="menu"
                  >
                    <h3>{t.commitDestination}</h3>
                    {gitInfo.branches.map((branch) => (
                      <button
                        aria-checked={!creatingCommitBranch && branch.current}
                        className={
                          !creatingCommitBranch && branch.current
                            ? "selected"
                            : ""
                        }
                        disabled={Boolean(gitBusy)}
                        key={branch.name}
                        onClick={() => {
                          if (branch.current) {
                            setCreatingCommitBranch(false);
                            setCommitBranchOpen(false);
                          } else {
                            void switchBranch(branch.name);
                          }
                        }}
                        role="menuitemradio"
                        type="button"
                      >
                        <BranchIcon />
                        <span>{branch.name}</span>
                        <i>
                          {!creatingCommitBranch && branch.current ? "✓" : ""}
                        </i>
                      </button>
                    ))}
                    <button
                      aria-checked={creatingCommitBranch}
                      className={creatingCommitBranch ? "selected" : ""}
                      disabled={actionsDisabled || Boolean(gitBusy)}
                      onClick={() => {
                        setCreatingCommitBranch(true);
                        setNewCommitBranch(
                          suggestedEnvironmentBranchName(taskTitle),
                        );
                        setCommitBranchOpen(false);
                      }}
                      role="menuitemradio"
                      type="button"
                    >
                      <span className="environment-git-new-branch-icon">
                        ＋
                      </span>
                      <span>{t.newBranch}</span>
                      <i />
                    </button>
                  </div>
                )}
              </div>

              {creatingCommitBranch && (
                <label className="environment-git-branch-name">
                  <input
                    aria-label={t.newBranch}
                    autoFocus
                    disabled={Boolean(gitBusy)}
                    maxLength={240}
                    onChange={(event) => setNewCommitBranch(event.target.value)}
                    placeholder={t.newBranchPlaceholder}
                    value={newCommitBranch}
                  />
                </label>
              )}

              <label className="environment-git-message">
                <textarea
                  aria-label={t.commitMessage}
                  autoFocus={!creatingCommitBranch}
                  disabled={Boolean(gitBusy)}
                  maxLength={10_000}
                  onChange={(event) => setCommitMessage(event.target.value)}
                  placeholder={t.commitMessagePlaceholder}
                  rows={4}
                  value={commitMessage}
                />
              </label>

              <label className="environment-git-include">
                <input
                  checked={includeUnstaged}
                  disabled={Boolean(gitBusy)}
                  onChange={(event) => setIncludeUnstaged(event.target.checked)}
                  type="checkbox"
                />
                <span aria-hidden="true">✓</span>
                <strong>{t.includeUnstaged}</strong>
                <span className="environment-diff-total">
                  <i>
                    +
                    {includeUnstaged
                      ? gitInfo.additions
                      : gitInfo.stagedAdditions}
                  </i>
                  <b>
                    −
                    {includeUnstaged
                      ? gitInfo.deletions
                      : gitInfo.stagedDeletions}
                  </b>
                </span>
              </label>

              <div className="environment-git-actions">
                <button
                  className="primary"
                  disabled={Boolean(commitDisabledReason) || Boolean(gitBusy)}
                  title={commitDisabledReason}
                  type="submit"
                >
                  <ChangesIcon />
                  <strong>
                    {gitBusy === "commit" ? t.committing : t.commit}
                  </strong>
                  <kbd>⌘↵</kbd>
                </button>
                <button
                  disabled={
                    Boolean(commitAndPushDisabledReason) || Boolean(gitBusy)
                  }
                  onClick={() => void commitAndPush()}
                  title={commitAndPushDisabledReason}
                  type="button"
                >
                  <PushIcon />
                  <strong>
                    {gitBusy === "commit-push" ? t.pushing : t.commitAndPush}
                  </strong>
                </button>
                <button
                  disabled={Boolean(pushDisabledReason) || Boolean(gitBusy)}
                  onClick={() => void push()}
                  title={pushDisabledReason}
                  type="button"
                >
                  <PushIcon />
                  <strong>{gitBusy === "push" ? t.pushing : t.push}</strong>
                </button>
              </div>

              {gitError && (
                <p className="environment-git-dialog-error" role="alert">
                  {gitError}
                </p>
              )}
            </form>
          </div>,
          document.body,
        )}
    </div>
  );
}
