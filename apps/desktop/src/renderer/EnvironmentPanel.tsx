import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  type RefObject,
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
import { Popover } from "@artemis/ui/feedback";
import { ArtemisIcon } from "@artemis/ui/icons";
import {
  EnvironmentControl,
  EnvironmentPanelSurface,
  EnvironmentSection,
  EnvironmentTrigger,
} from "@artemis/ui/workflow";

import type {
  ProjectGitBranch,
  ProjectGitInfo,
  ProjectPullRequest,
  ProjectPullRequestCheck,
  ProjectPullRequestLookup,
  ReviewScope,
} from "../shared/api.js";
import { localizedCopy } from "../shared/i18n-resources.js";
import { legacyLocale } from "../shared/locales.js";
import { ChildAgentIcon } from "./ChildAgentIcon.js";
import {
  EnvironmentAddIcon,
  EnvironmentBranchIcon as CodexBranchIcon,
  EnvironmentChangesIcon as CodexChangesIcon,
  EnvironmentCheckIcon,
  EnvironmentChevronIcon,
  EnvironmentCommitIcon,
  EnvironmentExternalIcon,
  EnvironmentPullRequestIcon,
  EnvironmentSearchIcon,
} from "./EnvironmentPanelIcons.js";

const labels = {
  en: {
    trigger: "Task environment",
    close: "Close",
    workspaceLabel: "Local checkout",
    viewChanges: "View changes",
    changedFiles: (count: number) => `${count} changed files`,
    title: "Environment",
    addProject: "Add project",
    changes: "Changes",
    local: "Local",
    branch: "Branch",
    branchMenu: "Branch menu",
    branchSearch: (project: string) => `Search ${project} branches`,
    branches: "Branches",
    noBranches: "No matching branches",
    createBranch: "Create and checkout new branch…",
    branchName: "Branch name",
    branchNameHelp: "The new branch starts at the current HEAD.",
    create: "Create branch",
    changingBranch: "Changing branch…",
    detached: "Detached HEAD",
    detachedBlocked: "Switch to a branch first",
    compareBranch: "Compare branch",
    noCompareBase: "Choose a base in Review",
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
    commitAndSwitch: "Commit and switch branch…",
    stopTasks: "Stop active local tasks first",
    committing: "Committing…",
    pushing: "Pushing…",
    commitCreated: (commit: string) => `Created commit ${commit}`,
    pushCompleted: (upstream: string) => `Pushed to ${upstream}`,
    loading: "Loading environment…",
    retry: "Retry",
    notGit: "This project is not a Git repository.",
    githubChecking: "Checking GitHub pull request…",
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
    agents: "Agent activity",
    mainAgent: "Main agent",
    taskContext: "Context used in this task",
    sourceSummary: (attachments: number, calls: number) =>
      `${attachments} attachments · ${calls} tool calls`,
    agentSummary: (total: number, active: number) =>
      `${total} total · ${active} active`,
    noAgents: "No sub-agents have been used in this task.",
    teams: "Teams",
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
    sources: "Sources",
    addSources: "Add sources",
    noSources: "No sources have been attached to this task.",
    webSearch: "Web search",
  },
  "zh-CN": {
    trigger: "任务环境",
    title: "环境",
    close: "关闭",
    workspaceLabel: "本地工作区",
    viewChanges: "查看更改",
    changedFiles: (count: number) => `${count} 个文件有未提交更改`,
    addProject: "添加项目",
    changes: "变更",
    local: "本地",
    branch: "当前分支",
    branchMenu: "分支菜单",
    branchSearch: (project: string) => `搜索${project}分支`,
    branches: "分支",
    noBranches: "没有匹配的分支",
    createBranch: "创建并检出新分支…",
    branchName: "分支名称",
    branchNameHelp: "新分支将从当前 HEAD 创建。",
    create: "创建分支",
    changingBranch: "正在切换分支…",
    detached: "分离的 HEAD",
    detachedBlocked: "请先切换到一个分支",
    compareBranch: "比较分支",
    noCompareBase: "请在审查中选择基准",
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
    commitAndSwitch: "提交并切换分支…",
    stopTasks: "请先停止正在运行的本地任务",
    committing: "正在提交…",
    pushing: "正在推送…",
    commitCreated: (commit: string) => `已创建提交 ${commit}`,
    pushCompleted: (upstream: string) => `已推送到 ${upstream}`,
    loading: "正在加载环境信息…",
    retry: "重试",
    notGit: "当前项目不是 Git 仓库。",
    githubChecking: "正在检查 GitHub 拉取请求…",
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
    agents: "Agent 活动",
    mainAgent: "主 Agent",
    taskContext: "本次任务所用的上下文",
    sourceSummary: (attachments: number, calls: number) =>
      `${attachments} 个附件 · ${calls} 次工具调用`,
    agentSummary: (total: number, active: number) =>
      `共 ${total} 个 · ${active} 个活跃`,
    noAgents: "当前任务尚未使用子代理。",
    teams: "团队",
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
    sources: "来源",
    addSources: "添加来源",
    noSources: "当前任务尚未添加来源。",
    webSearch: "网页搜索",
  },
} satisfies Record<"en" | "zh-CN", Record<string, unknown>>;

export interface McpGroup {
  id: string;
  name: string;
  calls: number;
  tools: string[];
  agents: string[];
}

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

export interface EnvironmentBranchMenuLayout extends CSSProperties {
  left: number;
  maxHeight: number;
  top: number;
  width: number;
}

export function environmentBranchMenuLayout(
  anchor: Readonly<{
    left: number;
    right: number;
    top: number;
    bottom: number;
  }>,
  viewport: Readonly<{ width: number; height: number }>,
): EnvironmentBranchMenuLayout {
  const margin = 12;
  const width = Math.min(296, Math.max(0, viewport.width - margin * 2));
  const left = Math.min(
    Math.max(margin, anchor.left - width),
    Math.max(margin, viewport.width - width - margin),
  );
  const top = Math.min(
    Math.max(margin, anchor.top),
    Math.max(margin, viewport.height - margin - 160),
  );
  return {
    left,
    maxHeight: Math.max(160, viewport.height - top - margin),
    top,
    width,
  };
}

export function environmentBranchDisplayName(branch: ProjectGitBranch): string {
  return branch.remote ? branch.name.replace(/^[^/]+\//u, "") : branch.name;
}

export function environmentBranchMenuBranches(
  branches: readonly ProjectGitBranch[],
  query: string,
): ProjectGitBranch[] {
  const deduplicated = new Map<string, ProjectGitBranch>();
  for (const branch of branches) {
    const displayName = environmentBranchDisplayName(branch);
    const existing = deduplicated.get(displayName);
    if (!existing || (existing.remote && !branch.remote)) {
      deduplicated.set(displayName, branch);
    }
  }
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return [...deduplicated.values()]
    .filter(
      (branch) =>
        !normalizedQuery ||
        environmentBranchDisplayName(branch)
          .toLocaleLowerCase()
          .includes(normalizedQuery),
    )
    .sort((left, right) => Number(right.current) - Number(left.current));
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
  return <ArtemisIcon height={20} name="environment" width={20} />;
}

function BranchIcon() {
  return <CodexBranchIcon aria-hidden="true" />;
}

function ChangesIcon() {
  return <CodexChangesIcon aria-hidden="true" />;
}

function PushIcon() {
  return <EnvironmentCommitIcon />;
}

function PullRequestIcon() {
  return <EnvironmentPullRequestIcon />;
}

export function PullRequestChecksSummary({
  checkSummary,
  checksOpen,
  chevronIcon,
  externalIcon,
  onBlurredOut,
  onOpenUrl,
  onShowChecks,
  onShowChecksWithFocus,
  onToggleOpen,
  prIcon,
  pullRequest,
  shouldKeepOpen,
  stateLabel,
  staleLabel,
  staleTitle,
  summaryLabel,
  triggerRef,
  warningLabel,
}: {
  checkSummary: ProjectPullRequestCheckSummary;
  checksOpen: boolean;
  chevronIcon: ReactNode;
  externalIcon: ReactNode;
  onBlurredOut: () => void;
  onOpenUrl: (url: string) => void;
  onShowChecks: () => void;
  onShowChecksWithFocus: () => void;
  onToggleOpen: () => void;
  prIcon: ReactNode;
  pullRequest: ProjectPullRequest;
  shouldKeepOpen: (node: Node | null) => boolean;
  stateLabel: string;
  staleLabel?: string | undefined;
  staleTitle?: string | undefined;
  summaryLabel: string;
  triggerRef: RefObject<HTMLButtonElement | null>;
  warningLabel?: string | undefined;
}) {
  return (
    <div className="environment-pr-card">
      <button
        className="environment-pr-title"
        onClick={() => onOpenUrl(pullRequest.url)}
        type="button"
      >
        <span className="environment-row-icon">{prIcon}</span>
        <span>
          <strong>{pullRequest.title}</strong>
          <small>
            #{pullRequest.number} · {stateLabel}
          </small>
        </span>
        <span aria-hidden="true" className="environment-external">
          {externalIcon}
        </span>
      </button>
      <button
        aria-controls="environment-pr-checks"
        aria-expanded={checksOpen}
        aria-haspopup="dialog"
        className="environment-pr-check-summary"
        onBlur={(event) => {
          const related = event.relatedTarget;
          if (related instanceof Node && shouldKeepOpen(related)) {
            return;
          }
          onBlurredOut();
        }}
        onClick={onToggleOpen}
        onFocus={onShowChecks}
        onKeyDown={(event) => {
          if (
            event.key === "ArrowDown" ||
            event.key === "Enter" ||
            event.key === " "
          ) {
            event.preventDefault();
            onShowChecksWithFocus();
          }
        }}
        onMouseEnter={onShowChecks}
        onMouseLeave={onBlurredOut}
        ref={triggerRef}
        type="button"
      >
        <span
          aria-hidden="true"
          className="environment-check-indicator"
          data-status={checkSummary}
        />
        <span>{summaryLabel}</span>
        {chevronIcon}
      </button>
      {warningLabel && <p className="environment-pr-warning">{warningLabel}</p>}
      {staleLabel && staleTitle && (
        <p className="environment-pr-stale" title={staleTitle}>
          {staleLabel}
        </p>
      )}
    </div>
  );
}

export function PullRequestChecksPopover({
  anchorRef,
  checks,
  checkSummaryLabels,
  containerRef,
  externalIcon,
  noneLabel,
  onOpenUrl,
  onScheduleClose,
  onCancelClose,
  onOpenChange,
  open,
  prLabel,
  title,
  triggerContains,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  checks: readonly ProjectPullRequestCheck[];
  checkSummaryLabels: Record<string, string>;
  containerRef: RefObject<HTMLDivElement | null>;
  externalIcon: ReactNode;
  noneLabel: string;
  onOpenUrl: (url: string) => void;
  onScheduleClose: () => void;
  onCancelClose: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  prLabel: string;
  title: string;
  triggerContains: (node: Node | null) => boolean;
}) {
  return (
    <Popover
      align="start"
      anchorRef={anchorRef}
      className="environment-checks-popover"
      contentRef={containerRef}
      focusOnOpen={false}
      id="environment-pr-checks"
      label={title}
      onOpenChange={onOpenChange}
      open={open}
      onBlur={(event) => {
        const related = event.relatedTarget;
        if (
          related instanceof Node &&
          (event.currentTarget.contains(related) || triggerContains(related))
        ) {
          return;
        }
        onScheduleClose();
      }}
      onFocus={onCancelClose}
      onMouseEnter={onCancelClose}
      onMouseLeave={onScheduleClose}
      placement="inline-start"
      tabIndex={-1}
    >
      <header>
        <strong>{title}</strong>
        <small>{prLabel}</small>
      </header>
      <div className="environment-check-list">
        {checks.length === 0 ? (
          <p>{noneLabel}</p>
        ) : (
          checks.map((check, index) => {
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
                {check.detailsUrl && <i aria-hidden="true">{externalIcon}</i>}
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
    </Popover>
  );
}

export function EnvironmentPanel({
  actionsDisabled,
  agents,
  attachments,
  defaultOpen,
  dockOpen,
  locale,
  mcpUsages,
  onAddProject,
  onAddSources,
  onConfirm,
  onMessage,
  onOpenAgent,
  onOpenReview,
  onOpenTeam,
  onOpenUrl,
  onViewAllSources,
  project,
  refreshKey,
  sources,
  taskTitle,
  taskStatusLabel,
  teams,
  threadId,
}: {
  actionsDisabled: boolean;
  agents: ChildAgentState[];
  attachments: PromptAttachment[];
  defaultOpen: boolean;
  dockOpen: boolean;
  locale: AppLocale;
  mcpUsages: McpToolUsageState[];
  onAddProject: () => void;
  onAddSources: () => void;
  onConfirm: (message: string) => Promise<boolean>;
  onMessage: (message: string, error?: boolean) => void;
  onOpenAgent: (agent: ChildAgentState) => void;
  onOpenReview: (scope: ReviewScope, baseRef?: string) => void;
  onOpenTeam: (team: AgentTeamState) => void;
  onOpenUrl: (url: string) => void;
  onViewAllSources: () => void;
  project: Project;
  refreshKey?: string;
  sources: TaskSourceState[];
  taskTitle: string;
  taskStatusLabel?: string;
  teams: AgentTeamState[];
  threadId?: string;
}) {
  const t = localizedCopy(locale, "app", labels[legacyLocale(locale)]);
  const panelId = useId();
  const control = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const gitRequest = useRef(0);
  const pullRequestRequest = useRef(0);
  const checksTrigger = useRef<HTMLButtonElement>(null);
  const checksPopover = useRef<HTMLDivElement>(null);
  const branchTrigger = useRef<HTMLButtonElement>(null);
  const branchMenu = useRef<HTMLDivElement>(null);
  const branchSearch = useRef<HTMLInputElement>(null);
  const checksCloseTimer = useRef<number | undefined>(undefined);
  const wantsOpen = useRef(defaultOpen);
  const focusOnOpen = useRef(false);
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
  const [branchQuery, setBranchQuery] = useState("");
  const [branchMenuPosition, setBranchMenuPosition] =
    useState<EnvironmentBranchMenuLayout>();
  const [creatingMenuBranch, setCreatingMenuBranch] = useState(false);
  const [menuBranchName, setMenuBranchName] = useState("");
  const [pendingSwitchBranch, setPendingSwitchBranch] = useState<string>();
  const [showAllAgents, setShowAllAgents] = useState(false);

  const hidePanel = useCallback(() => {
    openRef.current = false;
    setOpen(false);
  }, []);

  const closePanel = useCallback(() => {
    wantsOpen.current = false;
    hidePanel();
  }, [hidePanel]);

  const togglePanel = useCallback(() => {
    openRef.current = !openRef.current;
    wantsOpen.current = openRef.current;
    focusOnOpen.current = openRef.current;
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

  const closeBranchMenu = useCallback(() => {
    setBranchOpen(false);
    setBranchQuery("");
    setBranchMenuPosition(undefined);
    setCreatingMenuBranch(false);
    setMenuBranchName("");
  }, []);

  const updateBranchMenuPosition = useCallback(() => {
    const anchor = branchTrigger.current?.getBoundingClientRect();
    if (!anchor) return;
    setBranchMenuPosition(
      environmentBranchMenuLayout(anchor, {
        width: window.innerWidth,
        height: window.innerHeight,
      }),
    );
  }, []);

  const showChecks = useCallback(() => {
    cancelChecksClose();
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

  useLayoutEffect(() => {
    if (!branchOpen) return;
    updateBranchMenuPosition();
    const observer =
      typeof window.ResizeObserver === "function" && branchTrigger.current
        ? new window.ResizeObserver(updateBranchMenuPosition)
        : undefined;
    if (branchTrigger.current) observer?.observe(branchTrigger.current);
    window.addEventListener("resize", updateBranchMenuPosition);
    window.addEventListener("scroll", updateBranchMenuPosition, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateBranchMenuPosition);
      window.removeEventListener("scroll", updateBranchMenuPosition, true);
    };
  }, [branchOpen, updateBranchMenuPosition]);

  useEffect(() => {
    if (!branchOpen || creatingMenuBranch || !branchMenuPosition) return;
    branchSearch.current?.focus({ preventScroll: true });
  }, [branchMenuPosition, branchOpen, creatingMenuBranch]);

  useLayoutEffect(() => {
    const workspace = control.current?.closest(".workspace");
    if (!(workspace instanceof HTMLElement)) return;
    const syncVisibility = () => {
      const panelWidth =
        Number.parseFloat(
          window
            .getComputedStyle(workspace)
            .getPropertyValue("--environment-panel-inline-size"),
        ) || 280;
      // Keep at least 720px for the conversation and a 24px gap.
      const enoughSpace =
        workspace.getBoundingClientRect().width >= panelWidth + 24 + 720;
      const nextOpen = wantsOpen.current && !dockOpen && enoughSpace;
      if (nextOpen === openRef.current) return;
      openRef.current = nextOpen;
      setOpen(nextOpen);
    };
    syncVisibility();
    const observer =
      typeof window.ResizeObserver === "function"
        ? new window.ResizeObserver(syncVisibility)
        : undefined;
    observer?.observe(workspace);
    window.addEventListener("resize", syncVisibility);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", syncVisibility);
    };
  }, [dockOpen]);

  const loadGit = useCallback(async () => {
    const id = ++gitRequest.current;
    setGitLoading(true);
    setGitError(undefined);
    try {
      const info = await window.artemis.getProjectGitInfo(project.id, threadId);
      if (gitRequest.current === id) setGitInfo(info);
    } catch (error) {
      if (gitRequest.current === id) {
        setGitError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (gitRequest.current === id) setGitLoading(false);
    }
  }, [project.id, threadId]);

  const loadPullRequest = useCallback(async () => {
    const id = ++pullRequestRequest.current;
    setPullRequestLoading(true);
    setPullRequestError(undefined);
    try {
      const lookup = await window.artemis.getProjectPullRequest(
        project.id,
        threadId,
      );
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
  }, [project.id, threadId]);

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
    setBranchQuery("");
    setBranchMenuPosition(undefined);
    setCreatingMenuBranch(false);
    setMenuBranchName("");
    setPendingSwitchBranch(undefined);
  }, [project.id, taskTitle, threadId]);

  useEffect(() => {
    if (open) return;
    closeBranchMenu();
    setChecksOpen(false);
  }, [closeBranchMenu, open]);

  useEffect(() => {
    if (!open) return;
    void loadGit();
    void loadPullRequest();
  }, [loadGit, loadPullRequest, open, refreshKey]);

  useEffect(
    () =>
      window.artemis.onProjectGitChanged((context) => {
        if (
          !openRef.current ||
          context.projectId !== project.id ||
          context.threadId !== threadId
        ) {
          return;
        }
        void loadGit();
        void loadPullRequest();
      }),
    [loadGit, loadPullRequest, project.id, threadId],
  );

  useEffect(() => {
    if (!open) return;
    const refreshOnFocus = () => {
      void loadGit();
      void loadPullRequest();
    };
    window.addEventListener("focus", refreshOnFocus);
    const frame = focusOnOpen.current
      ? window.requestAnimationFrame(() => panel.current?.focus())
      : undefined;
    focusOnOpen.current = false;
    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
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
    if (!branchOpen) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        branchTrigger.current?.contains(target) ||
        branchMenu.current?.contains(target)
      ) {
        return;
      }
      closeBranchMenu();
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [branchOpen, closeBranchMenu]);

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
      } else if (creatingMenuBranch) {
        setCreatingMenuBranch(false);
        setMenuBranchName("");
        setGitError(undefined);
      } else if (branchOpen) {
        closeBranchMenu();
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
    closeBranchMenu,
    closePanel,
    commitBranchOpen,
    commitOpen,
    creatingMenuBranch,
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
  const commitAndPushDisabledReason = pendingSwitchBranch
    ? t.commitAndSwitch
    : (commitDisabledReason ??
      (!includeUnstaged &&
      ((gitInfo?.unstagedCount ?? 0) > 0 || (gitInfo?.untrackedCount ?? 0) > 0)
        ? t.commitChangesFirst
        : gitInfo?.upstream && gitInfo.behind > 0
          ? t.behind
          : undefined));
  const pushDisabledReason = !gitInfo
    ? t.loading
    : pendingSwitchBranch
      ? t.commitAndSwitch
      : actionsDisabled
        ? t.stopTasks
        : gitInfo.conflictCount > 0
          ? t.conflicts
          : creatingCommitBranch || !gitInfo.currentBranch
            ? creatingCommitBranch
              ? t.newBranchPlaceholder
              : t.detachedBlocked
            : gitInfo.changeCount > 0
              ? t.commitChangesFirst
              : gitInfo.upstream && gitInfo.behind > 0
                ? t.behind
                : gitInfo.upstream && gitInfo.ahead === 0
                  ? t.synced
                  : undefined;
  const panelGitAction = gitInfo
    ? environmentGitAction(gitInfo, actionsDisabled, {
        stopTasks: t.stopTasks,
        conflicts: t.conflicts,
        behind: t.behind,
        noUpstream: t.noUpstream,
        synced: t.synced,
        detachedBlocked: t.detachedBlocked,
      })
    : ({ kind: "idle", disabledReason: t.loading } as const);
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
  const visibleBranches = environmentBranchMenuBranches(
    gitInfo?.branches ?? [],
    branchQuery,
  );
  const attachmentCount =
    attachments.length +
    sources.filter(
      (source) => source.kind === "file" || source.kind === "image",
    ).length;
  const sourceCallCount =
    mcpUsages.length +
    sources.filter((source) => source.kind === "web-search").length;
  const hasSourcePanelDetails = attachmentCount + sourceCallCount > 0;

  const viewAllSources = () => {
    hidePanel();
    onViewAllSources();
  };

  const closeCommitDialog = () => {
    setCommitOpen(false);
    setCommitBranchOpen(false);
    setPendingSwitchBranch(undefined);
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
      threadId,
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
        threadId,
      );
      const afterCommit = pendingSwitchBranch
        ? await window.artemis.switchProjectBranch(
            project.id,
            pendingSwitchBranch,
            threadId,
          )
        : result.gitInfo;
      setGitInfo(afterCommit);
      setPendingSwitchBranch(undefined);
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
    if (!gitInfo?.currentBranch || gitBusy || pushDisabledReason) return;
    const destination = gitInfo.upstream ?? `origin/${gitInfo.currentBranch}`;
    if (
      !confirmed &&
      !(await onConfirm(t.pushConfirm(gitInfo.ahead, destination)))
    ) {
      return;
    }
    setGitBusy("push");
    setGitError(undefined);
    try {
      const result = await window.artemis.pushProjectBranch(
        project.id,
        threadId,
      );
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
    if (!gitInfo || gitBusy || commitAndPushDisabledReason) return;
    const branch = creatingCommitBranch
      ? newCommitBranch.trim()
      : gitInfo.currentBranch;
    if (!branch) return;
    const destination = gitInfo.upstream ?? `origin/${branch}`;
    if (
      !(await onConfirm(t.commitAndPushConfirm(gitInfo.ahead + 1, destination)))
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
        threadId,
      );
      setGitInfo(committed.gitInfo);
      const pushed = await window.artemis.pushProjectBranch(
        project.id,
        threadId,
      );
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
    if (branch === gitInfo?.currentBranch) {
      closeBranchMenu();
      return;
    }
    setGitBusy("branch");
    setGitError(undefined);
    try {
      setGitInfo(
        await window.artemis.switchProjectBranch(project.id, branch, threadId),
      );
      closeBranchMenu();
      setCommitBranchOpen(false);
      setCreatingCommitBranch(false);
      await loadPullRequest();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setGitError(message);
      if (
        /would be overwritten|local changes|uncommitted changes/iu.test(message)
      ) {
        setPendingSwitchBranch(branch);
        closeBranchMenu();
        setCommitOpen(true);
      }
      onMessage(message, true);
    } finally {
      setGitBusy(undefined);
    }
  };

  const createBranchFromMenu = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (actionsDisabled || gitBusy || !menuBranchName.trim()) return;
    setGitBusy("branch");
    setGitError(undefined);
    try {
      setGitInfo(
        await window.artemis.createProjectBranch(
          project.id,
          menuBranchName.trim(),
          threadId,
        ),
      );
      closeBranchMenu();
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
    <EnvironmentControl data-dock-open={dockOpen} open={open} ref={control}>
      <EnvironmentTrigger
        controls={panelId}
        expanded={open}
        icon={<EnvironmentIcon />}
        label={t.trigger}
        onClick={togglePanel}
        ref={trigger}
        title={t.trigger}
      />
      {open && (
        <EnvironmentPanelSurface id={panelId} label={t.title} ref={panel}>
          <header className="environment-panel-header">
            <strong>
              {t.title} · {project.name}
            </strong>
            <button
              className="environment-text-action"
              onClick={closePanel}
              type="button"
            >
              {t.close}
            </button>
          </header>
          <EnvironmentSection
            action={
              <button
                aria-label={t.addProject}
                className="environment-header-action"
                onClick={onAddProject}
                title={t.addProject}
                type="button"
              >
                <EnvironmentAddIcon aria-hidden="true" />
              </button>
            }
            className="git-environment-section"
            title="Git"
          >
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
                <div className="environment-setting-row" title={gitInfo.root}>
                  <span className="environment-setting-copy">
                    <strong>{t.workspaceLabel}</strong>
                    <small>{project.name}</small>
                  </span>
                  <span className="environment-local-badge">Local</span>
                </div>
                <div className="environment-setting-row">
                  <span className="environment-setting-copy">
                    <strong>{t.branch}</strong>
                    <small>{t.changedFiles(gitInfo.changeCount)}</small>
                  </span>
                  <div className="environment-branch-control">
                    <button
                      aria-controls="environment-branch-menu"
                      aria-expanded={branchOpen}
                      aria-haspopup="menu"
                      className="environment-row"
                      onClick={() => {
                        if (branchOpen) closeBranchMenu();
                        else {
                          setCreatingMenuBranch(false);
                          setMenuBranchName("");
                          setBranchOpen(true);
                        }
                      }}
                      ref={branchTrigger}
                      type="button"
                    >
                      <span className="environment-row-copy">
                        <strong>{gitInfo.currentBranch ?? t.detached}</strong>
                      </span>
                      <span className="environment-chevron" aria-hidden="true">
                        <EnvironmentChevronIcon />
                      </span>
                    </button>
                  </div>
                </div>
                <div className="environment-panel-actions">
                  <button
                    className="environment-text-action"
                    onClick={() => {
                      hidePanel();
                      onOpenReview(
                        gitInfo.unstagedCount > 0 || gitInfo.untrackedCount > 0
                          ? "unstaged"
                          : "staged",
                      );
                    }}
                    type="button"
                  >
                    {t.viewChanges}
                  </button>
                  <button
                    className="environment-text-action commit-push-row"
                    disabled={
                      Boolean(gitBusy) || Boolean(panelGitAction.disabledReason)
                    }
                    onClick={() => {
                      setGitError(undefined);
                      setCommitOpen(true);
                    }}
                    title={panelGitAction.disabledReason}
                    type="button"
                  >
                    {t.commitOrPush}
                  </button>
                </div>
                {pullRequestLoading && !pullRequestLookup && (
                  <div className="environment-pr-notice" role="status">
                    <span className="environment-row-icon">
                      <PullRequestIcon />
                    </span>
                    <span>{t.githubChecking}</span>
                  </div>
                )}
                {pullRequest && (
                  <PullRequestChecksSummary
                    checkSummary={checkSummary}
                    checksOpen={checksOpen}
                    chevronIcon={<EnvironmentChevronIcon aria-hidden="true" />}
                    externalIcon={<EnvironmentExternalIcon />}
                    onBlurredOut={scheduleChecksClose}
                    onOpenUrl={onOpenUrl}
                    onShowChecks={showChecks}
                    onShowChecksWithFocus={showChecksWithFocus}
                    onToggleOpen={() =>
                      checksOpen ? closeChecks() : showChecksWithFocus()
                    }
                    prIcon={<PullRequestIcon />}
                    pullRequest={pullRequest}
                    shouldKeepOpen={(node) =>
                      checksPopover.current?.contains(node) ?? false
                    }
                    staleLabel={pullRequestError ? t.githubStale : undefined}
                    staleTitle={pullRequestError}
                    stateLabel={pullRequestStateLabel}
                    summaryLabel={checkSummaryLabels[checkSummary]}
                    triggerRef={checksTrigger}
                    warningLabel={coverageWarningLabel}
                  />
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
                  <div className="environment-inline-error" role="alert">
                    <span>{gitError}</span>
                    {pendingSwitchBranch && (
                      <button
                        onClick={() => {
                          setBranchOpen(false);
                          setCommitOpen(true);
                        }}
                        type="button"
                      >
                        {t.commitAndSwitch}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </EnvironmentSection>

          {(threadId || displayAgents.length > 0 || teams.length > 0) && (
            <EnvironmentSection
              action={
                displayAgents.length + teams.length > activityPreviewLimit ? (
                  <button
                    className="environment-text-action"
                    onClick={() => setShowAllAgents((current) => !current)}
                    type="button"
                  >
                    {showAllAgents ? t.showLess : t.viewAll}
                  </button>
                ) : undefined
              }
              title={t.agents}
            >
              <div className="environment-activity-list">
                {threadId && (
                  <div className="environment-setting-row">
                    <span className="environment-setting-copy">
                      <strong>{t.mainAgent}</strong>
                      <small>{taskTitle}</small>
                    </span>
                    <span className="environment-task-state">
                      {taskStatusLabel}
                    </span>
                  </div>
                )}
                {visibleTeams.map((team) => (
                  <button
                    className="environment-activity-row"
                    key={team.teamId}
                    onClick={() => {
                      hidePanel();
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
                        {team.memberAgentIds.length} ·{" "}
                        {teamStatusLabels[team.status]}
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
                      hidePanel();
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
                {displayAgents.length > 0 && (
                  <p className="environment-agent-summary">
                    {t.agentSummary(counts.total, counts.active)} · {t.queued}{" "}
                    {counts.queued} · {t.blocked} {counts.blocked} ·{" "}
                    {t.completed} {counts.completed}
                  </p>
                )}
              </div>
            </EnvironmentSection>
          )}

          {hasSourcePanelDetails && (
            <EnvironmentSection
              action={
                <button
                  aria-label={t.addSources}
                  className="environment-header-action"
                  onClick={onAddSources}
                  title={t.addSources}
                  type="button"
                >
                  <EnvironmentAddIcon aria-hidden="true" />
                </button>
              }
              className="sources-section"
              title={t.sources}
            >
              <div className="environment-setting-row">
                <span className="environment-setting-copy">
                  <strong>
                    {t.sourceSummary(attachmentCount, sourceCallCount)}
                  </strong>
                  <small>{t.taskContext}</small>
                </span>
                <button
                  className="environment-view-all environment-text-action"
                  onClick={viewAllSources}
                  type="button"
                >
                  {t.viewAll}
                </button>
              </div>
            </EnvironmentSection>
          )}
        </EnvironmentPanelSurface>
      )}
      {open &&
        branchOpen &&
        branchMenuPosition &&
        createPortal(
          <div
            aria-label={t.branchMenu}
            className="environment-branch-menu"
            id="environment-branch-menu"
            ref={branchMenu}
            role="menu"
            style={branchMenuPosition}
          >
            {creatingMenuBranch ? (
              <form
                className="environment-branch-create-form"
                onSubmit={(event) => void createBranchFromMenu(event)}
              >
                <label htmlFor="environment-new-branch">{t.branchName}</label>
                <input
                  autoFocus
                  disabled={Boolean(gitBusy)}
                  id="environment-new-branch"
                  maxLength={240}
                  onChange={(event) => setMenuBranchName(event.target.value)}
                  placeholder={t.newBranchPlaceholder}
                  value={menuBranchName}
                />
                <small>{t.branchNameHelp}</small>
                {gitError && (
                  <p className="environment-branch-error" role="alert">
                    {gitError}
                  </p>
                )}
                <div>
                  <button
                    className="secondary-button"
                    disabled={Boolean(gitBusy)}
                    onClick={() => {
                      setCreatingMenuBranch(false);
                      setMenuBranchName("");
                      setGitError(undefined);
                    }}
                    type="button"
                  >
                    {t.cancel}
                  </button>
                  <button
                    className="primary-button"
                    disabled={Boolean(gitBusy) || !menuBranchName.trim()}
                    type="submit"
                  >
                    {gitBusy === "branch" ? t.changingBranch : t.create}
                  </button>
                </div>
              </form>
            ) : (
              <>
                <button
                  className="environment-compare-action"
                  role="menuitem"
                  onClick={() => {
                    hidePanel();
                    onOpenReview("branch", gitInfo?.compareBase);
                  }}
                  type="button"
                >
                  {t.compareBranch}
                </button>
                <label className="environment-branch-search">
                  <EnvironmentSearchIcon aria-hidden="true" />
                  <input
                    aria-label={t.branchSearch(project.name)}
                    onChange={(event) => setBranchQuery(event.target.value)}
                    placeholder={t.branchSearch(project.name)}
                    ref={branchSearch}
                    value={branchQuery}
                  />
                </label>
                <div className="environment-branch-heading">{t.branches}</div>
                <div className="environment-branch-list">
                  {visibleBranches.length === 0 ? (
                    <p className="environment-branch-empty">{t.noBranches}</p>
                  ) : (
                    visibleBranches.map((branch) => (
                      <button
                        aria-checked={branch.current}
                        className={branch.current ? "selected" : ""}
                        data-remote={branch.remote || undefined}
                        disabled={
                          Boolean(gitBusy) ||
                          (actionsDisabled && !branch.current)
                        }
                        key={branch.name}
                        onClick={() =>
                          branch.current
                            ? closeBranchMenu()
                            : void switchBranch(branch.name)
                        }
                        role="menuitemradio"
                        type="button"
                      >
                        <BranchIcon />
                        <span>{environmentBranchDisplayName(branch)}</span>
                        <i aria-hidden="true">
                          {branch.current ? <EnvironmentCheckIcon /> : null}
                        </i>
                      </button>
                    ))
                  )}
                </div>
                {gitError && (
                  <p className="environment-branch-error" role="alert">
                    {gitError}
                  </p>
                )}
                {actionsDisabled && (
                  <p className="environment-branch-hint">{t.stopTasks}</p>
                )}
                <div className="environment-branch-actions">
                  <button
                    disabled={actionsDisabled || Boolean(gitBusy)}
                    onClick={() => {
                      setCreatingMenuBranch(true);
                      setMenuBranchName("");
                      setGitError(undefined);
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <EnvironmentAddIcon aria-hidden="true" />
                    <span>{t.createBranch}</span>
                  </button>
                </div>
              </>
            )}
          </div>,
          document.body,
        )}
      {open && pullRequest && (
        <PullRequestChecksPopover
          anchorRef={checksTrigger}
          checks={pullRequest.checks}
          checkSummaryLabels={checkSummaryLabels}
          containerRef={checksPopover}
          externalIcon={<EnvironmentExternalIcon />}
          noneLabel={t.checksNone}
          onCancelClose={cancelChecksClose}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) closeChecks();
          }}
          onOpenUrl={onOpenUrl}
          onScheduleClose={scheduleChecksClose}
          open={checksOpen}
          prLabel={`#${pullRequest.number} · ${pullRequestStateLabel}`}
          title={t.checkDetails}
          triggerContains={(node) =>
            checksTrigger.current?.contains(node) ?? false
          }
        />
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
                  <EnvironmentChevronIcon aria-hidden="true" />
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
                        <i aria-hidden="true">
                          {!creatingCommitBranch && branch.current ? (
                            <EnvironmentCheckIcon />
                          ) : null}
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
                        <EnvironmentAddIcon aria-hidden="true" />
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
    </EnvironmentControl>
  );
}
