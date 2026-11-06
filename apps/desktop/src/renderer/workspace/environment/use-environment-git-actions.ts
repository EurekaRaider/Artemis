import { suggestedEnvironmentBranchName } from "./environment-values.js";

import { type FormEvent, type RefObject } from "react";

import type {
  ProjectGitInfo,
  ProjectPullRequestLookup,
} from "../../../shared/api.js";

interface UseEnvironmentGitActionsContext {
  readonly hidePanel: () => void;
  readonly onViewAllSources: () => void;
  readonly setCommitOpen: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  readonly setPendingSwitchBranch: import("react").Dispatch<
    import("react").SetStateAction<string | undefined>
  >;
  readonly setCreatingCommitBranch: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  readonly taskTitle: string;
  readonly setNewCommitBranch: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly setCommitMessage: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly gitRequest: RefObject<number>;
  readonly pullRequestRequest: RefObject<number>;
  readonly setPullRequestLookup: import("react").Dispatch<
    import("react").SetStateAction<ProjectPullRequestLookup | undefined>
  >;
  readonly setPullRequestLoading: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  readonly setChecksOpen: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  readonly setGitInfo: import("react").Dispatch<
    import("react").SetStateAction<ProjectGitInfo | undefined>
  >;
  readonly gitInfo: ProjectGitInfo | undefined;
  readonly creatingCommitBranch: boolean;
  readonly newCommitBranch: string;
  readonly project: {
    id: string;
    name: string;
    path: string;
    createdAt: string;
    updatedAt: string;
  };
  readonly threadId: string | undefined;
  readonly gitBusy: "commit" | "push" | "commit-push" | "branch" | undefined;
  readonly commitDisabledReason: string | undefined;
  readonly setGitBusy: import("react").Dispatch<
    import("react").SetStateAction<
      "commit" | "push" | "commit-push" | "branch" | undefined
    >
  >;
  readonly setGitError: import("react").Dispatch<
    import("react").SetStateAction<string | undefined>
  >;
  readonly commitMessage: string;
  readonly includeUnstaged: boolean;
  readonly pendingSwitchBranch: string | undefined;
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
  readonly onMessage: (message: string, error?: boolean) => void;
  readonly loadPullRequest: () => Promise<void>;
  readonly loadGit: () => Promise<void>;
  readonly pushDisabledReason: string | undefined;
  readonly onConfirm: (message: string) => Promise<boolean>;
  readonly commitAndPushDisabledReason: string | undefined;
  readonly actionsDisabled: boolean;
  readonly closeBranchMenu: () => void;
  readonly menuBranchName: string;
}
export function useEnvironmentGitActions(
  context: UseEnvironmentGitActionsContext,
) {
  const {
    hidePanel,
    onViewAllSources,
    setCommitOpen,
    setPendingSwitchBranch,
    setCreatingCommitBranch,
    taskTitle,
    setNewCommitBranch,
    setCommitMessage,
    gitRequest,
    pullRequestRequest,
    setPullRequestLookup,
    setPullRequestLoading,
    setChecksOpen,
    setGitInfo,
    gitInfo,
    creatingCommitBranch,
    newCommitBranch,
    project,
    threadId,
    gitBusy,
    commitDisabledReason,
    setGitBusy,
    setGitError,
    commitMessage,
    includeUnstaged,
    pendingSwitchBranch,
    t,
    onMessage,
    loadPullRequest,
    loadGit,
    pushDisabledReason,
    onConfirm,
    commitAndPushDisabledReason,
    actionsDisabled,
    closeBranchMenu,
    menuBranchName,
  } = context;
  const viewAllSources = () => {
    hidePanel();
    onViewAllSources();
  };

  const closeCommitDialog = () => {
    setCommitOpen(false);
    setPendingSwitchBranch(undefined);
    setCreatingCommitBranch(false);
    setNewCommitBranch(suggestedEnvironmentBranchName(taskTitle));
    setCommitMessage("");
  };

  const applyGitMutation = (info: ProjectGitInfo) => {
    ++gitRequest.current;
    ++pullRequestRequest.current;
    setPullRequestLookup(undefined);
    setPullRequestLoading(false);
    setChecksOpen(false);
    setGitInfo(info);
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
    applyGitMutation(info);
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
      applyGitMutation(afterCommit);
      setPendingSwitchBranch(undefined);
      closeCommitDialog();
      onMessage(t.commitCreated(result.commit.slice(0, 7)));
      void loadPullRequest();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await loadGit();
      setGitError(message);
      onMessage(message, true);
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
      applyGitMutation(result.gitInfo);
      closeCommitDialog();
      onMessage(t.pushCompleted(result.upstream));
      void loadPullRequest();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await loadGit();
      setGitError(message);
      onMessage(message, true);
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
      applyGitMutation(committed.gitInfo);
      const pushed = await window.artemis.pushProjectBranch(
        project.id,
        threadId,
      );
      applyGitMutation(pushed.gitInfo);
      closeCommitDialog();
      onMessage(t.pushCompleted(pushed.upstream));
      void loadPullRequest();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await loadGit();
      setGitError(message);
      onMessage(message, true);
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
      applyGitMutation(
        await window.artemis.switchProjectBranch(project.id, branch, threadId),
      );
      closeBranchMenu();
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
      applyGitMutation(
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
  return {
    viewAllSources,
    closeCommitDialog,
    commit,
    push,
    commitAndPush,
    switchBranch,
    createBranchFromMenu,
  };
}
