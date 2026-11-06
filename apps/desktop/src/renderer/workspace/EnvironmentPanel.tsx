import {
  PullRequestChecksSummary,
  PullRequestChecksPopover,
} from "./environment/pull-request-checks.js";
import {
  EnvironmentIcon,
  BranchIcon,
  ChangesIcon,
  PushIcon,
  PullRequestIcon,
} from "./environment/environment-icons.js";
import { type McpGroup, groupMcpUsage } from "./environment/mcp-usage.js";
import {
  type AgentEnvironmentCounts,
  environmentAgentCounts,
  environmentDisplayAgents,
  environmentTopLevelAgents,
  useEnvironmentActivityAgents,
} from "./environment/agent-activity.js";
import {
  suggestedEnvironmentBranchName,
  type EnvironmentBranchMenuLayout,
  environmentBranchMenuLayout,
  projectPullRequestCheckSummary,
  type ProjectPullRequestCheckSummary,
  projectPullRequestCoverageWarning,
  environmentGitAction,
  environmentBranchMenuBranches,
  type ProjectPullRequestCoverageWarning,
  type GitEnvironmentAction,
  environmentBranchDisplayName,
} from "./environment/environment-values.js";
import { useEnvironmentState } from "./environment/use-environment-state.js";
import { useEnvironmentDisclosure } from "./environment/use-environment-disclosure.js";
import { useEnvironmentReservation } from "./environment/use-environment-reservation.js";
import { useEnvironmentGitSubscriptions } from "./environment/use-environment-git-subscriptions.js";
import { useEnvironmentDismissal } from "./environment/use-environment-dismissal.js";
import { useEnvironmentSummary } from "./environment/use-environment-summary.js";
import { useEnvironmentGitActions } from "./environment/use-environment-git-actions.js";
import { AgentActivityStatus } from "../conversation/WorkRecord.js";
import { ResourceAvatar } from "../plugins/resource-icons.js";
import type {
  InstalledArtemisPlugin,
  InstalledSkill,
} from "../../shared/api.js";
import { Fragment } from "react";
import { Keycap } from "@artemis/ui/actions";
import { uiText } from "../../shared/i18n/ui-text.js";
import { Switch } from "@artemis/ui/forms";
import { SegmentedControl } from "@artemis/ui/navigation";
import { WorkspaceFileIcon } from "./WorkspaceFilesPanel.js";
import { filePresentation } from "./workspace-file-presentation.js";
import { UI_COPY } from "../../shared/i18n/ui-copy.js";

import { createPortal } from "react-dom";
import {
  type AgentTeamState,
  type AppLocale,
  type ChildAgentState,
  type ImGroupContext,
  type McpToolUsageState,
  type Project,
  type PromptAttachment,
  type TaskSourceState,
} from "@artemis/protocol";
import { LoadingState } from "@artemis/ui/feedback";
import { ArtemisIcon } from "@artemis/ui/icons";
import {
  EnvironmentControl,
  EnvironmentPanelSurface,
  EnvironmentSection,
  EnvironmentTrigger,
} from "@artemis/ui/workflow";

import type { ReviewScope } from "../../shared/api.js";
import { customAgentInstanceIdentity } from "../settings/custom-agent-identity.js";
import { EnvironmentWorkspaceMenu } from "./EnvironmentWorkspaceMenu.js";
import { EnvironmentPullRequestError } from "./EnvironmentPullRequestError.js";
import { ImGroupMembers } from "../im/ImGroupMembers.js";
import { ImGroupContextSummary } from "../im/ImGroupContextSummary.js";
import type { ThreadConnection } from "../im/ImThreadConnection.js";
import {
  EnvironmentAddIcon,
  EnvironmentAgentsIcon,
  EnvironmentCheckIcon,
  EnvironmentChevronIcon,
  EnvironmentCommitIcon,
  EnvironmentCompareIcon,
  EnvironmentExternalIcon,
  EnvironmentGithubIcon,
  EnvironmentSearchIcon,
  EnvironmentSourcesIcon,
} from "./EnvironmentPanelIcons.js";

export function EnvironmentPanel({
  actionsDisabled,
  commitRequest,
  agents,
  attachments,
  contextSkills = [],
  defaultOpen,
  dockOpen,
  imGroup,
  imConnection,
  onManageGroupAuthorization,
  onMentionMember,
  onRemoveMember,
  memberRemovalDisabled,
  executing,
  workspaceIsWorktree,
  worktreeCount,
  onWorkspaceHandoff,
  onWorktreesChanged,
  onOpenUsage,
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
  teams,
  threadId,
}: {
  actionsDisabled: boolean;
  commitRequest?: number;
  agents: ChildAgentState[];
  attachments: PromptAttachment[];
  contextSkills?: (Pick<InstalledSkill, "id" | "name" | "description"> & {
    plugin?:
      | Pick<InstalledArtemisPlugin, "name" | "iconDataUrl" | "brandColor">
      | undefined;
  })[];
  defaultOpen: boolean;
  dockOpen: boolean;
  imGroup?: ImGroupContext | undefined;
  imConnection?: ThreadConnection | undefined;
  onManageGroupAuthorization?:
    ((trigger: HTMLButtonElement) => void) | undefined;
  onMentionMember?: ((token: string) => void) | undefined;
  onRemoveMember?: ((deviceId: string) => Promise<boolean>) | undefined;
  memberRemovalDisabled?: boolean | undefined;
  executing?: boolean | undefined;
  workspaceIsWorktree?: boolean | undefined;
  worktreeCount?: number | undefined;
  onOpenUsage?: (() => void) | undefined;
  onWorktreesChanged?: (() => Promise<void>) | undefined;
  onWorkspaceHandoff?:
    ((destination: "local" | "managed-worktree") => Promise<void>) | undefined;
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
  teams: AgentTeamState[];
  threadId?: string;
}) {
  const {
    t,
    panelId,
    control,
    panel,
    trigger,
    gitRequest,
    pullRequestRequest,
    checksTrigger,
    checksPopover,
    branchTrigger,
    branchMenu,
    branchSearch,
    checksCloseTimer,
    wantsOpen,
    manuallyOpened,
    focusOnOpen,
    openRef,
    open,
    setOpen,
    gitInfo,
    setGitInfo,
    gitError,
    setGitError,
    changedFiles,
    setChangedFiles,
    changesError,
    setChangesError,
    pullRequestLookup,
    setPullRequestLookup,
    pullRequestError,
    setPullRequestError,
    pullRequestLoading,
    setPullRequestLoading,
    checksOpen,
    setChecksOpen,
    gitBusy,
    setGitBusy,
    commitOpen,
    setCommitOpen,
    commitMessage,
    setCommitMessage,
    includeUnstaged,
    setIncludeUnstaged,
    creatingCommitBranch,
    setCreatingCommitBranch,
    newCommitBranch,
    setNewCommitBranch,
    branchOpen,
    setBranchOpen,
    branchQuery,
    setBranchQuery,
    branchMenuPosition,
    setBranchMenuPosition,
    creatingMenuBranch,
    setCreatingMenuBranch,
    menuBranchName,
    setMenuBranchName,
    pendingSwitchBranch,
    setPendingSwitchBranch,
    showAllAgents,
    setShowAllAgents,
  } = useEnvironmentState({ locale, taskTitle });

  const displayAgents = useEnvironmentActivityAgents(agents, teams);
  const contextAttachments = [
    ...attachments.map((attachment, index) => ({
      id: `draft:${index}`,
      name:
        "name" in attachment
          ? attachment.name
          : uiText(locale, "SourcesPanel_labels.openImage"),
    })),
    ...sources.flatMap((source) =>
      source.kind === "file" || source.kind === "image"
        ? [{ id: source.sourceId, name: source.name }]
        : [],
    ),
  ];
  const webSearchCount = sources.filter(
    (source) => source.kind === "web-search",
  ).length;
  const hasSourcePanelDetails =
    contextAttachments.length +
      contextSkills.length +
      webSearchCount +
      mcpUsages.length >
    0;

  const hasPanelContent =
    gitInfo?.managed === true ||
    Boolean(gitError) ||
    displayAgents.length > 0 ||
    teams.length > 0 ||
    hasSourcePanelDetails ||
    Boolean(imGroup);
  const panelVisible = open && (hasPanelContent || manuallyOpened.current);
  const reservationActive =
    panelVisible || ((wantsOpen.current ?? defaultOpen) && hasPanelContent);

  const {
    hidePanel,
    closePanel,
    togglePanel,
    cancelChecksClose,
    closeChecks,
    closeBranchMenu,
    showChecks,
    showChecksWithFocus,
    scheduleChecksClose,
  } = useEnvironmentDisclosure({
    manuallyOpened,
    openRef,
    setOpen,
    wantsOpen,
    focusOnOpen,
    checksCloseTimer,
    setChecksOpen,
    setBranchOpen,
    setBranchQuery,
    setBranchMenuPosition,
    setCreatingMenuBranch,
    setMenuBranchName,
    branchTrigger,
    checksPopover,
    branchOpen,
    creatingMenuBranch,
    branchMenuPosition,
    branchSearch,
    commitRequest,
    setGitError,
    setCommitOpen,
  });

  useEnvironmentReservation({
    control,
    panel,
    manuallyOpened,
    dockOpen,
    hasPanelContent,
    wantsOpen,
    defaultOpen,
    openRef,
    setOpen,
    reservationActive,
    hidePanel,
    panelVisible,
  });

  const { loadGit, loadPullRequest } = useEnvironmentGitSubscriptions({
    gitRequest,
    setGitError,
    project,
    threadId,
    setGitInfo,
    setChangedFiles,
    setChangesError,
    open,
    gitInfo,
    pullRequestRequest,
    setPullRequestLoading,
    setPullRequestError,
    setPullRequestLookup,
    setChecksOpen,
    setCommitOpen,
    setCommitMessage,
    setIncludeUnstaged,
    setCreatingCommitBranch,
    taskTitle,
    setNewCommitBranch,
    setBranchOpen,
    setBranchQuery,
    setBranchMenuPosition,
    setCreatingMenuBranch,
    setMenuBranchName,
    setPendingSwitchBranch,
    closeBranchMenu,
    defaultOpen,
    refreshKey,
    workspaceIsWorktree,
  });

  useEnvironmentDismissal({
    defaultOpen,
    openRef,
    project,
    threadId,
    loadGit,
    loadPullRequest,
    open,
    panel,
    focusOnOpen,
    pullRequestLookup,
    cancelChecksClose,
    branchOpen,
    branchTrigger,
    branchMenu,
    closeBranchMenu,
    commitOpen,
    closePanel,
    trigger,
    setCreatingMenuBranch,
    setMenuBranchName,
    setGitError,
    creatingMenuBranch,
    setCommitOpen,
    setCreatingCommitBranch,
    setCommitMessage,
    closeChecks,
    checksTrigger,
    checksOpen,
  });

  const {
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
  } = useEnvironmentSummary({
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
  });

  const {
    viewAllSources,
    closeCommitDialog,
    commit,
    push,
    commitAndPush,
    switchBranch,
    createBranchFromMenu,
  } = useEnvironmentGitActions({
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
  });

  const renderAgentRow = (agent: ChildAgentState) => (
    <button
      className="environment-activity-row"
      data-status={agent.status}
      key={agent.agentId}
      onClick={() => {
        hidePanel();
        onOpenAgent(agent);
      }}
      type="button"
    >
      <span className="environment-row-icon">
        <ArtemisIcon name="agent" width={14} height={14} />
      </span>
      <span>
        <strong title={agent.label}>{agent.label}</strong>
        <small>
          <AgentActivityStatus child={agent} locale={locale} />
          {agent.customAgent
            ? ` · ${customAgentInstanceIdentity(agent.customAgent, locale)}`
            : ""}
          {agent.currentTool ? ` · ${agent.currentTool}` : ""}
        </small>
      </span>
    </button>
  );

  const commitSubview = gitInfo?.managed ? (
    <form
      aria-label={uiText(locale, "EnvironmentPanel_labels.commitOrPushTitle")}
      aria-busy={Boolean(gitBusy)}
      className="environment-git-dialog"
      onKeyDown={(event) => {
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
    >
      <div className="environment-commit-heading">
        <span className="environment-field-label">{t.commitMessage}</span>
      </div>
      <label className="environment-git-message">
        <textarea
          aria-label={t.commitMessage}
          autoFocus={!creatingCommitBranch}
          disabled={Boolean(gitBusy)}
          maxLength={10_000}
          onChange={(event) => setCommitMessage(event.target.value)}
          placeholder={t.commitMessagePlaceholder}
          rows={3}
          value={commitMessage}
        />
      </label>

      <Switch
        className="environment-git-include"
        label={t.includeUnstaged}
        checked={includeUnstaged}
        disabled={Boolean(gitBusy)}
        onCheckedChange={setIncludeUnstaged}
      />

      <label className="environment-field-label">{t.commitDestination}</label>
      <SegmentedControl
        className="environment-commit-destination"
        label={t.commitDestination}
        value={creatingCommitBranch ? "new" : "current"}
        disabled={Boolean(gitBusy) || actionsDisabled}
        options={[
          {
            value: "current",
            label: gitInfo.currentBranch ?? t.detached,
            icon: <BranchIcon />,
          },
          { value: "new", label: t.newBranch, icon: <EnvironmentAddIcon /> },
        ]}
        onValueChange={(value) => {
          setCreatingCommitBranch(value === "new");
          if (value === "new")
            setNewCommitBranch(suggestedEnvironmentBranchName(taskTitle));
        }}
      />

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

      {gitBusy && (
        <p className="environment-git-progress" role="status">
          <ArtemisIcon name="clock" width={14} height={14} />
          {gitBusy === "push"
            ? t.pushing
            : gitBusy === "commit-push"
              ? commitMessage.trim()
                ? t.pushing
                : t.generatingPush
              : commitMessage.trim()
                ? t.committing
                : t.generatingCommit}
        </p>
      )}
      <div className="environment-push-info">
        {gitInfo.upstream && (
          <span>
            <ArtemisIcon name="push" width={14} height={14} />
            <span
              title={uiText(locale, "Review01.pushAfter", {
                count: gitInfo.ahead + 1,
                branch: gitInfo.upstream,
              })}
            >
              {uiText(locale, "Review01.pushAfter", {
                count: gitInfo.ahead + 1,
                branch: "{upstream}",
              })
                .split("{upstream}")
                .map((part, index) => (
                  <Fragment key={index}>
                    {index > 0 && (
                      <bdi className="environment-upstream">
                        {gitInfo.upstream}
                      </bdi>
                    )}
                    {part}
                  </Fragment>
                ))}
            </span>
          </span>
        )}
        <button
          className="environment-push-only"
          disabled={Boolean(pushDisabledReason) || Boolean(gitBusy)}
          onClick={() => void push()}
          title={pushDisabledReason}
          type="button"
        >
          <PushIcon />
          <strong>{gitBusy === "push" ? t.pushing : t.push}</strong>
        </button>{" "}
      </div>
      <div className="environment-git-actions">
        <button
          disabled={Boolean(commitDisabledReason) || Boolean(gitBusy)}
          title={commitDisabledReason}
          type="submit"
        >
          <strong>
            {gitBusy === "commit"
              ? commitMessage.trim()
                ? t.committing
                : t.generatingCommit
              : t.commit}
          </strong>
          <Keycap>⌘↵</Keycap>
        </button>
        <button
          className="primary"
          disabled={Boolean(commitAndPushDisabledReason) || Boolean(gitBusy)}
          onClick={() => void commitAndPush()}
          title={commitAndPushDisabledReason}
          type="button"
        >
          <PushIcon />
          <strong>
            {gitBusy === "commit-push"
              ? commitMessage.trim()
                ? t.pushing
                : t.generatingPush
              : t.commitAndPush}
          </strong>
        </button>
      </div>

      {gitError && (
        <p className="environment-git-dialog-error" role="alert">
          {gitError}
        </p>
      )}
    </form>
  ) : null;

  return (
    <EnvironmentControl
      data-dock-open={dockOpen}
      open={panelVisible}
      ref={control}
    >
      <EnvironmentTrigger
        controls={panelId}
        expanded={panelVisible}
        icon={<EnvironmentIcon />}
        label={t.trigger}
        onClick={togglePanel}
        ref={trigger}
        title={t.trigger}
      />
      {panelVisible && (
        <EnvironmentPanelSurface
          data-group={imGroup ? "true" : undefined}
          id={panelId}
          label={
            commitOpen
              ? uiText(locale, "EnvironmentPanel_labels.commitOrPushTitle")
              : t.title
          }
          ref={panel}
        >
          <header className="environment-panel-header">
            {commitOpen && (
              <button
                aria-label={t.title}
                className="environment-header-action environment-back"
                disabled={Boolean(gitBusy)}
                onClick={closeCommitDialog}
                type="button"
              >
                <ArtemisIcon name="chev-left" />
              </button>
            )}
            {!commitOpen && (
              <ArtemisIcon name="layers" width={16} height={16} />
            )}
            <strong title={project.name}>
              {commitOpen
                ? uiText(locale, "EnvironmentPanel_labels.commitOrPushTitle")
                : t.title}
            </strong>
            {commitOpen && gitInfo && (
              <small>
                {uiText(locale, "Review01.filesToCommit", {
                  count: includeUnstaged
                    ? gitInfo.changeCount
                    : gitInfo.stagedCount,
                })}
              </small>
            )}
            {!commitOpen && (
              <span className="environment-project-name" title={project.name}>
                {project.name}
              </span>
            )}
            {!commitOpen && (
              <button
                aria-label={t.close}
                className="environment-header-action"
                onClick={closePanel}
                title={t.close}
                type="button"
              >
                <ArtemisIcon name="close" />
              </button>
            )}
          </header>
          {commitOpen ? (
            commitSubview
          ) : (
            <>
              {imGroup && (
                <>
                  <ImGroupMembers
                    managePermissions
                    executing={executing}
                    group={imGroup}
                    locale={locale}
                    onMention={onMentionMember}
                    onRemove={onRemoveMember}
                    removalDisabled={memberRemovalDisabled}
                  />
                  <ImGroupContextSummary
                    group={imGroup}
                    connection={imConnection}
                    project={project}
                    locale={locale}
                    onManageAuthorization={onManageGroupAuthorization}
                  />
                </>
              )}
              {!gitInfo?.managed && (gitError || manuallyOpened.current) && (
                <EnvironmentSection
                  className="git-environment-section"
                  title={
                    <>
                      <EnvironmentGithubIcon />
                      <span>Git</span>
                    </>
                  }
                >
                  {gitError ? (
                    <div className="environment-inline-error" role="alert">
                      <span>{gitError}</span>
                      <button onClick={() => void loadGit()} type="button">
                        {t.retry}
                      </button>
                    </div>
                  ) : gitInfo ? (
                    <div className="environment-setting-row" role="status">
                      <ArtemisIcon name="git-branch" />
                      <span>{t.notGit}</span>
                    </div>
                  ) : (
                    <LoadingState label={t.loading} lines={3} />
                  )}
                </EnvironmentSection>
              )}
              {gitInfo?.managed && (
                <>
                  <EnvironmentSection
                    className="git-environment-section environment-workspace-section"
                    title={uiText(locale, "AutomationPage_text.target")}
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
                  >
                    <div className="environment-rows">
                      <EnvironmentWorkspaceMenu
                        placement="block-end"
                        worktreeCount={worktreeCount}
                        locale={locale}
                        path={gitInfo.root ?? project.path}
                        worktree={workspaceIsWorktree}
                        disabled={actionsDisabled || Boolean(gitBusy)}
                        onHandoff={onWorkspaceHandoff}
                        onWorktreesChanged={onWorktreesChanged}
                        onOpenUsage={onOpenUsage}
                        onMessage={onMessage}
                      />
                      <div className="environment-setting-row environment-branch-row">
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
                            title={gitInfo.currentBranch ?? t.detached}
                            type="button"
                          >
                            <BranchIcon />
                            <span className="environment-row-copy">
                              <strong>
                                {gitInfo.currentBranch ?? t.detached}
                              </strong>
                            </span>
                            <span
                              className="environment-sync-count"
                              title={gitInfo.upstream ?? t.noUpstream}
                            >
                              {gitInfo.ahead > 0 ? `↑${gitInfo.ahead}` : ""}
                              {gitInfo.behind > 0 ? ` ↓${gitInfo.behind}` : ""}
                            </span>
                            <span
                              className="environment-chevron"
                              aria-hidden="true"
                            >
                              <EnvironmentChevronIcon />
                            </span>
                          </button>
                        </div>
                      </div>

                      <button
                        className="environment-compare-row"
                        onClick={() => {
                          hidePanel();
                          onOpenReview("branch", gitInfo.compareBase);
                        }}
                        type="button"
                      >
                        <EnvironmentCompareIcon />
                        <span>{t.compareBranch}</span>
                        <strong>
                          {gitInfo.compareBase ?? t.noCompareBase}
                        </strong>
                      </button>
                      <small className="environment-sync-status">
                        {gitInfo.currentBranch &&
                          gitInfo.upstream &&
                          gitInfo.ahead === 0 &&
                          gitInfo.behind === 0 && (
                            <ArtemisIcon name="check" width={14} height={14} />
                          )}
                        {!gitInfo.currentBranch
                          ? t.detached
                          : !gitInfo.upstream
                            ? t.noUpstream
                            : gitInfo.behind > 0
                              ? t.behind
                              : gitInfo.ahead === 0
                                ? t.synced
                                : gitInfo.upstream}
                      </small>
                    </div>
                  </EnvironmentSection>
                  <EnvironmentSection
                    className="environment-github-section"
                    title="GitHub"
                    action={
                      <button
                        aria-label={uiText(locale, "Review02.refreshGithub")}
                        className="environment-header-action"
                        disabled={pullRequestLoading}
                        onClick={() => void loadPullRequest()}
                        type="button"
                      >
                        <ArtemisIcon name="refresh" />
                      </button>
                    }
                  >
                    {pullRequestLoading &&
                      !pullRequestLookup &&
                      !pullRequestError && (
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
                        chevronIcon={
                          <EnvironmentChevronIcon aria-hidden="true" />
                        }
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
                        staleLabel={
                          pullRequestError ? t.githubStale : undefined
                        }
                        staleTitle={pullRequestError}
                        stateLabel={pullRequestStateLabel}
                        summaryLabel={checkSummaryLabels[checkSummary]}
                        triggerRef={checksTrigger}
                        warningLabel={coverageWarningLabel}
                      />
                    )}
                    {pullRequestError && !pullRequest && (
                      <EnvironmentPullRequestError
                        key={`${project.id}:${threadId ?? ""}:${pullRequestError}`}
                        error={pullRequestError}
                        loading={pullRequestLoading}
                        locale={locale}
                        onRetry={() => void loadPullRequest()}
                      />
                    )}

                    {!pullRequest &&
                      !pullRequestLoading &&
                      !pullRequestError && (
                        <p className="environment-pr-empty">
                          {!gitInfo.upstream
                            ? t.noUpstream
                            : uiText(
                                locale,
                                "EnvironmentPanel.githubNoPullRequest",
                              )}
                        </p>
                      )}
                    {!gitInfo.upstream && (
                      <p className="environment-pr-empty">
                        {uiText(
                          locale,
                          "EnvironmentPanel.pushBeforePullRequest",
                        )}
                      </p>
                    )}
                  </EnvironmentSection>
                  <EnvironmentSection
                    className="environment-changes-section"
                    title={t.viewChanges}
                    action={
                      <span className="environment-diff-total">
                        {gitInfo.additions > 0 && <i>+{gitInfo.additions}</i>}
                        {gitInfo.deletions > 0 && <b>−{gitInfo.deletions}</b>}
                      </span>
                    }
                  >
                    <div className="environment-changed-files">
                      {changedFiles.map((file) => (
                        <button
                          className="environment-file-row"
                          key={file.path}
                          title={file.path}
                          type="button"
                          onClick={() => {
                            hidePanel();
                            onOpenReview(file.scope);
                          }}
                        >
                          <WorkspaceFileIcon
                            path={file.path}
                            presentation={filePresentation(file.path)}
                            symlink={false}
                          />
                          <span className="environment-file-name">
                            {file.path}
                          </span>
                          <span className="environment-diff-total">
                            {file.additions > 0 && <i>+{file.additions}</i>}
                            {file.deletions > 0 && <b>−{file.deletions}</b>}
                          </span>
                          <span
                            className="file-status"
                            data-status={file.status}
                          >
                            {file.status === "added"
                              ? "A"
                              : file.status === "deleted"
                                ? "D"
                                : "M"}
                          </span>
                        </button>
                      ))}
                      {gitInfo.changeCount === 0 && (
                        <p className="environment-pr-empty">
                          {UI_COPY.App_copy[locale].noChanges}
                        </p>
                      )}
                      {changesError && (
                        <p className="environment-inline-error" role="alert">
                          {changesError}
                        </p>
                      )}
                    </div>
                    <div className="environment-change-actions">
                      <button
                        className="environment-text-action"
                        onClick={() => {
                          hidePanel();
                          onOpenReview(
                            gitInfo.unstagedCount > 0 ||
                              gitInfo.untrackedCount > 0
                              ? "unstaged"
                              : "staged",
                          );
                        }}
                        type="button"
                      >
                        <ChangesIcon />
                        <span>{UI_COPY.App_copy[locale].reviewChanges}</span>
                      </button>
                      <button
                        className="environment-text-action commit-push-row"
                        disabled={
                          Boolean(gitBusy) ||
                          Boolean(panelGitAction.disabledReason)
                        }
                        onClick={() => {
                          setGitError(undefined);
                          setCommitOpen(true);
                        }}
                        title={panelGitAction.disabledReason}
                        type="button"
                      >
                        <EnvironmentCommitIcon />
                        <span>{t.commitOrPush}</span>
                      </button>
                    </div>
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
                  </EnvironmentSection>
                </>
              )}

              {(displayAgents.length > 0 || teams.length > 0) && (
                <EnvironmentSection
                  action={
                    <button
                      className="environment-text-action"
                      type="button"
                      onClick={() => {
                        if (latestTeam) {
                          hidePanel();
                          onOpenTeam(latestTeam);
                        } else setShowAllAgents((current) => !current);
                      }}
                    >
                      {showAllAgents && !latestTeam ? t.showLess : t.details}
                    </button>
                  }
                  title={t.agents}
                >
                  <div className="environment-activity-list">
                    {teamGroups.map(({ team, agents: members }) => (
                      <div
                        aria-label={team.mission}
                        className="environment-agent-group"
                        key={team.teamId}
                        role="group"
                      >
                        <div className="environment-agent-team-children">
                          {members.map(renderAgentRow)}
                        </div>
                      </div>
                    ))}
                    {standaloneAgents.map(renderAgentRow)}
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
                  title={t.taskContext}
                >
                  <div className="environment-context-list">
                    {contextAttachments.slice(0, 3).map((attachment) => (
                      <button
                        className="environment-context-row"
                        aria-label={attachment.name}
                        key={attachment.id}
                        onClick={viewAllSources}
                        title={attachment.name}
                        type="button"
                      >
                        <WorkspaceFileIcon
                          path={attachment.name}
                          presentation={filePresentation(attachment.name)}
                          symlink={false}
                        />
                        <span>{attachment.name}</span>
                        <small>{uiText(locale, "Review06.attachment")}</small>
                      </button>
                    ))}
                    {contextSkills.map((skill) => (
                      <button
                        className="environment-context-row"
                        key={skill.id}
                        onClick={viewAllSources}
                        type="button"
                      >
                        <ResourceAvatar
                          kind="skill"
                          id={skill.id}
                          name={skill.name}
                          description={skill.description}
                          pluginName={skill.plugin?.name}
                          iconDataUrl={skill.plugin?.iconDataUrl}
                          brandColor={skill.plugin?.brandColor}
                        />
                        <span>{skill.name}</span>
                      </button>
                    ))}
                    {webSearchCount > 0 && (
                      <button
                        className="environment-context-row"
                        onClick={viewAllSources}
                        type="button"
                      >
                        <ArtemisIcon name="web" />
                        <span>{t.webSearch}</span>
                        <small>{webSearchCount}</small>
                      </button>
                    )}
                    {mcpUsages.length > 0 && (
                      <button
                        className="environment-context-row"
                        onClick={viewAllSources}
                        type="button"
                      >
                        <ResourceAvatar
                          kind="mcp"
                          name={
                            mcpUsages[0]?.serverName ??
                            mcpUsages[0]?.serverId ??
                            ""
                          }
                        />
                        <span>
                          {uiText(
                            locale,
                            "App_disclosureLabels.toolGroupCalls",
                          )}
                        </span>
                        <small>{mcpUsages.length}</small>
                      </button>
                    )}
                    <button
                      className="environment-view-all environment-text-action"
                      onClick={viewAllSources}
                      type="button"
                    >
                      {t.viewAll}
                      <ArtemisIcon name="chev-right" width={12} height={12} />
                    </button>
                  </div>
                </EnvironmentSection>
              )}
            </>
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
                <label htmlFor="environment-new-branch">
                  <BranchIcon />
                  {t.branchName}
                </label>
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
                    <EnvironmentAddIcon aria-hidden="true" />
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
                  <EnvironmentCompareIcon />
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
                    visibleBranches.map((branch, index) => (
                      <Fragment key={branch.name}>
                        {(index === 0 ||
                          Boolean(visibleBranches[index - 1]?.remote) !==
                            Boolean(branch.remote)) &&
                          visibleBranches.some((item) => item.remote) && (
                            <div className="environment-branch-heading">
                              {uiText(
                                locale,
                                branch.remote
                                  ? "Review03.remoteBranches"
                                  : "Review03.localBranches",
                              )}
                            </div>
                          )}
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
                          <span title={branch.name}>
                            {environmentBranchDisplayName(branch).length > 32
                              ? `${environmentBranchDisplayName(branch).slice(0, 12)}…${environmentBranchDisplayName(branch).slice(-12)}`
                              : environmentBranchDisplayName(branch)}
                          </span>
                          <i aria-hidden="true">
                            {branch.current ? <EnvironmentCheckIcon /> : null}
                          </i>
                        </button>
                      </Fragment>
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
                <p className="environment-branch-hint">
                  {uiText(locale, "Review03.branchStash")}
                </p>
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
    </EnvironmentControl>
  );
}

export {
  suggestedEnvironmentBranchName,
  type EnvironmentBranchMenuLayout,
  environmentBranchMenuLayout,
  projectPullRequestCheckSummary,
  type ProjectPullRequestCheckSummary,
  projectPullRequestCoverageWarning,
  environmentGitAction,
  environmentBranchMenuBranches,
  type ProjectPullRequestCoverageWarning,
  type GitEnvironmentAction,
  environmentBranchDisplayName,
} from "./environment/environment-values.js";

export {
  type AgentEnvironmentCounts,
  environmentAgentCounts,
  environmentDisplayAgents,
  environmentTopLevelAgents,
  useEnvironmentActivityAgents,
} from "./environment/agent-activity.js";

export { type McpGroup, groupMcpUsage } from "./environment/mcp-usage.js";

export {
  PullRequestChecksSummary,
  PullRequestChecksPopover,
} from "./environment/pull-request-checks.js";
