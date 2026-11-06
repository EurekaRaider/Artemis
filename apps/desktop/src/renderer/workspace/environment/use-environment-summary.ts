import {
  projectPullRequestCheckSummary,
  type ProjectPullRequestCheckSummary,
  projectPullRequestCoverageWarning,
  environmentGitAction,
  environmentBranchMenuBranches,
} from "./environment-values.js";

import { type AgentTeamState, type ChildAgentState } from "@artemis/protocol";

import type {
  ProjectGitInfo,
  ProjectPullRequestLookup,
} from "../../../shared/api.js";

interface UseEnvironmentSummaryContext {
  readonly pullRequestLookup: ProjectPullRequestLookup | undefined;
  readonly t: {
    trigger: string;
    close: string;
    workspaceLabel: string;
    viewChanges: string;
    changedFiles: (count: number) => string;
    title: string;
    addProject: string;
    changes: string;
    local: string;
    branch: string;
    branchMenu: string;
    branchSearch: (project: string) => string;
    branches: string;
    noBranches: string;
    createBranch: string;
    branchName: string;
    branchNameHelp: string;
    create: string;
    changingBranch: string;
    detached: string;
    detachedBlocked: string;
    compareBranch: string;
    noCompareBase: string;
    commitOrPush: string;
    commitMessage: string;
    commitMessagePlaceholder: string;
    generatingCommit: string;
    generatingPush: string;
    includeUnstaged: string;
    commit: string;
    commitAndPush: string;
    push: string;
    commitAndPushConfirm: (count: number, upstream: string) => string;
    commitDestination: string;
    newBranch: string;
    newBranchPlaceholder: string;
    noSelectedChanges: string;
    commitChangesFirst: string;
    cancel: string;
    pushCommits: (count: number) => string;
    pushConfirm: (count: number, upstream: string) => string;
    synced: string;
    noUpstream: string;
    behind: string;
    conflicts: string;
    commitAndSwitch: string;
    stopTasks: string;
    committing: string;
    pushing: string;
    commitCreated: (commit: string) => string;
    pushCompleted: (upstream: string) => string;
    loading: string;
    retry: string;
    notGit: string;
    githubChecking: string;
    githubStale: string;
    pullRequestDraft: string;
    pullRequestOpen: string;
    pullRequestMerged: string;
    pullRequestClosed: string;
    checksPassed: string;
    checksFailed: string;
    checksPending: string;
    checksSkipped: string;
    checksCancelled: string;
    checksNone: string;
    checkDetails: string;
    localChangesNotChecked: string;
    unpushedCommitNotChecked: string;
    differentHeadNotChecked: string;
    agents: string;
    taskContext: string;
    sourceSummary: (attachments: number, calls: number) => string;
    agentSummary: (total: number, active: number) => string;
    noAgents: string;
    teams: string;
    agentQueued: string;
    agentRunning: string;
    agentBlocked: string;
    agentCancelling: string;
    agentCompleted: string;
    agentFailed: string;
    agentCancelled: string;
    teamForming: string;
    teamRunning: string;
    teamBlocked: string;
    teamIntegrating: string;
    teamCompleted: string;
    teamAborted: string;
    active: string;
    queued: string;
    blocked: string;
    completed: string;
    viewAll: string;
    details: string;
    showLess: string;
    sources: string;
    addSources: string;
    noSources: string;
    webSearch: string;
  };
  readonly gitInfo: ProjectGitInfo | undefined;
  readonly includeUnstaged: boolean;
  readonly creatingCommitBranch: boolean;
  readonly newCommitBranch: string;
  readonly actionsDisabled: boolean;
  readonly pendingSwitchBranch: string | undefined;
  readonly teams: AgentTeamState[];
  readonly displayAgents: ChildAgentState[];
  readonly showAllAgents: boolean;
  readonly branchQuery: string;
}
export function useEnvironmentSummary(context: UseEnvironmentSummaryContext) {
  const {
    pullRequestLookup,
    t,
    gitInfo,
    includeUnstaged,
    creatingCommitBranch,
    newCommitBranch,
    actionsDisabled,
    pendingSwitchBranch,
    teams,
    displayAgents,
    showAllAgents,
    branchQuery,
  } = context;
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
  const latestTeam = teams.at(-1);
  const visibleAgents = showAllAgents
    ? displayAgents
    : displayAgents.slice(0, activityPreviewLimit);
  const teamGroups = teams.map((team) => ({
    team,
    agents: visibleAgents.filter((agent) =>
      agent.teamId
        ? agent.teamId === team.teamId
        : team.memberAgentIds.includes(agent.agentId),
    ),
  }));
  const groupedAgentIds = new Set(
    teamGroups.flatMap((group) => group.agents.map((agent) => agent.agentId)),
  );
  const standaloneAgents = visibleAgents.filter(
    (agent) => !groupedAgentIds.has(agent.agentId),
  );
  const visibleBranches = environmentBranchMenuBranches(
    gitInfo?.branches ?? [],
    branchQuery,
  );
  return {
    pullRequest,
    checkSummary,
    checkSummaryLabels,
    pullRequestStateLabel,
    coverageWarningLabel,
    commitDisabledReason,
    commitAndPushDisabledReason,
    pushDisabledReason,
    panelGitAction,
    latestTeam,
    visibleAgents,
    teamGroups,
    standaloneAgents,
    visibleBranches,
  };
}
