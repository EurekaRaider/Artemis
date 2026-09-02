import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type {
  AgentTeamState,
  ChildAgentState,
  McpToolUsageState,
} from "@artemis/protocol";

import type { ProjectGitInfo, ProjectPullRequest } from "../src/shared/api.js";
import { childAgentMarkForIdentity } from "../src/renderer/ChildAgentIcon.js";
import {
  ENVIRONMENT_PANEL_MIN_CONVERSATION_WIDTH,
  environmentBranchDisplayName,
  environmentBranchMenuBranches,
  environmentBranchMenuLayout,
  environmentPanelConversationWidth,
  environmentPanelVisibilityAfterResize,
  environmentAgentCounts,
  environmentDisplayAgents,
  environmentGitAction,
  groupMcpUsage,
  projectPullRequestCheckSummary,
  projectPullRequestCoverageWarning,
  shouldAutoHideEnvironmentPanel,
  suggestedEnvironmentBranchName,
} from "../src/renderer/EnvironmentPanel.js";

const source = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

const appSource = source("../src/renderer/App.tsx");
const panelSource = source("../src/renderer/EnvironmentPanel.tsx");
const stylesSource = source("../src/renderer/styles.css");
const mainSource = source("../src/main/main.ts");

const copy = {
  stopTasks: "stop tasks",
  conflicts: "resolve conflicts",
  behind: "reconcile upstream",
  noUpstream: "no upstream",
  synced: "synced",
  detachedBlocked: "switch branch",
};

const panelLayout = (workspaceWidth: number) => ({
  workspaceWidth,
  panelWidth: 304,
  layoutGap: 24,
  minimumConversationWidth: ENVIRONMENT_PANEL_MIN_CONVERSATION_WIDTH,
});

function gitInfo(overrides: Partial<ProjectGitInfo> = {}): ProjectGitInfo {
  return {
    managed: true,
    detached: false,
    root: "/tmp/project",
    currentBranch: "main",
    changeCount: 0,
    additions: 0,
    deletions: 0,
    stagedAdditions: 0,
    stagedDeletions: 0,
    stagedCount: 0,
    unstagedCount: 0,
    untrackedCount: 0,
    conflictCount: 0,
    upstream: "origin/main",
    ahead: 0,
    behind: 0,
    branches: [{ name: "main", current: true }],
    ...overrides,
  };
}

function pullRequest(
  overrides: Partial<ProjectPullRequest> = {},
): ProjectPullRequest {
  return {
    number: 80,
    title: "Stop stalled model streams",
    url: "https://github.com/EurekaRaider/Artemis/pull/80",
    state: "OPEN",
    isDraft: false,
    headRefName: "codex/fix-stall",
    headRefOid: "a".repeat(40),
    checks: [],
    ...overrides,
  };
}

describe("task environment panel state", () => {
  it("mounts the popover between task status and the existing right dock", () => {
    const status = appSource.indexOf('className="status-pill"');
    const environment = appSource.indexOf("<EnvironmentPanel", status);
    const dock = appSource.indexOf(
      'className="right-sidebar-toggle"',
      environment,
    );

    expect(status).toBeGreaterThan(-1);
    expect(environment).toBeGreaterThan(status);
    expect(dock).toBeGreaterThan(environment);
  });

  it("defaults open, closes with the dock, and can reopen beside the dock", () => {
    expect(appSource).toContain("defaultOpen={!workspaceDockOpen}");
    expect(appSource).toContain(
      "workspaceDockOpen ? Math.max(0, dockWidthNow - 50) : 0",
    );
    expect(panelSource).toContain("useState(defaultOpen)");
    expect(panelSource).toContain("openRef.current = !dockOpen");
    expect(panelSource).toContain("setOpen(!dockOpen)");
    expect(panelSource).toContain("data-dock-open={dockOpen}");
    expect(stylesSource).toContain(
      '.environment-control[data-dock-open="true"] .environment-popover',
    );
  });

  it("keeps loaded Git information mounted while the workspace dock toggles", () => {
    expect(appSource).toContain(
      'key={`${activeProject.id}:${activeThread?.id ?? "draft"}`}',
    );
    expect(appSource).not.toContain(
      '${workspaceDockOpen ? "dock-open" : "dock-closed"}',
    );
    expect(panelSource).toContain("gitLoading && !gitInfo");
  });

  it("uses compact Codex-like popover proportions", () => {
    expect(stylesSource).toContain(
      "width: min(var(--environment-panel-inline-size), calc(100vw - 24px))",
    );
    expect(stylesSource).toContain("max-height: calc(100vh - 96px)");
    expect(stylesSource).toContain("scrollbar-width: none");
    expect(stylesSource).toContain("min-height: 28px");
    expect(stylesSource).toContain(".environment-checks-popover");
  });

  it("hides optional task sections until they contain activity", () => {
    expect(panelSource).toContain(
      "(displayAgents.length > 0 || teams.length > 0) &&",
    );
    expect(panelSource).toContain("combinedSources.length > 0 &&");
    expect(panelSource).toContain("...mcpGroups.map((group) => ({");
    expect(panelSource).not.toContain("mcpGroups.length > 0 &&");
  });

  it("shows stable identity marks instead of generic person icons", () => {
    expect(panelSource).toContain("<ChildAgentIcon");
    expect(panelSource).toContain("identity={team.teamId}");
    expect(panelSource).toContain("identity={agent.agentId}");
    expect(panelSource).not.toContain("function AgentIcon(");
    expect(stylesSource).toContain(
      ".environment-row-icon svg:not(.child-agent-mark)",
    );

    const identities = [
      "environment-team",
      "ui-agent",
      "git-agent",
      "test-agent",
    ];
    const marks = identities.map((identity) =>
      JSON.stringify(childAgentMarkForIdentity(identity)),
    );
    expect(new Set(marks).size).toBe(identities.length);
  });

  it("wires real review, branch, commit, push, agent, and source actions", () => {
    expect(panelSource).toContain(
      'onOpenReview("branch", gitInfo.compareBase)',
    );
    expect(panelSource).toContain("window.artemis.switchProjectBranch(");
    expect(panelSource).toContain("window.artemis.commitProjectChanges(");
    expect(panelSource).toContain("window.artemis.pushProjectBranch(");
    expect(panelSource).toContain("window.artemis.createProjectBranch(");
    expect(panelSource).toContain("includeUnstaged");
    expect(panelSource).toContain('className="environment-git-dialog"');
    expect(panelSource).toContain("createPortal(");
    expect(panelSource).toContain("t.commitOrPush");
    expect(panelSource).not.toContain("commitChanges:");
    expect(panelSource).toContain("onOpenAgent(agent)");
    expect(panelSource).toContain("onOpenTeam(team)");
    expect(panelSource).toContain("onClick={onAddProject}");
    expect(appSource).toContain("onAddProject={() => void openProject()}");
    expect(panelSource).toContain("onClick={onAddSources}");
    expect(panelSource).not.toMatch(/picture.?in.?picture|画中画/iu);
  });

  it("binds Git reads and repository notifications to the active task checkout", () => {
    expect(panelSource).toContain("getProjectGitInfo(project.id, threadId)");
    expect(panelSource).toContain("onProjectGitChanged((context)");
    expect(panelSource).toContain("context.threadId !== threadId");
    expect(mainSource).toContain("workspaceForGitRequest(projectId, threadId)");
    expect(mainSource).toContain("gitRepositoryWatchPaths(workspacePath)");
    expect(mainSource).toContain("gitRepositoryMetadataSignature(plan)");
    expect(mainSource).toContain('changed("metadata")');
    expect(mainSource).toContain('changed("worktree")');
    expect(mainSource).toContain("pendingKinds");
    expect(mainSource).toContain("}, 1_000);");
    expect(mainSource).toContain("IPC.projectGitChanged");
    expect(appSource).toContain("{ threadId: activeThreadId } : {})");
  });

  it("suggests a safe Codex-prefixed branch from the task title", () => {
    expect(suggestedEnvironmentBranchName("Codex Git 面板")).toBe(
      "codex/codex-git-面板",
    );
    expect(suggestedEnvironmentBranchName("---")).toBe("codex/changes");
  });

  it("keeps the panel open while its portaled branch menu handles outside clicks and Escape", () => {
    expect(panelSource).toContain('document.addEventListener("pointerdown"');
    expect(panelSource).toContain("branchTrigger.current?.contains(target)");
    expect(panelSource).toContain("branchMenu.current?.contains(target)");
    expect(panelSource).toContain("closeBranchMenu()");
    expect(panelSource).toContain('event.key !== "Escape"');
    expect(panelSource).toContain("trigger.current?.focus()");
    expect(panelSource).toContain('role="dialog"');
    expect(stylesSource).toContain("overscroll-behavior: contain");
    expect(stylesSource).toContain("inset-inline-end:");
    expect(stylesSource).toContain("@media (max-width: 680px)");
    expect(stylesSource).toContain("max-height: calc(100vh - 64px)");
  });

  it("auto-hides the panel before its content safe area becomes too narrow", () => {
    expect(environmentPanelConversationWidth(panelLayout(1_047))).toBe(719);
    expect(shouldAutoHideEnvironmentPanel(panelLayout(1_047))).toBe(true);
    expect(shouldAutoHideEnvironmentPanel(panelLayout(1_048))).toBe(false);
    expect(panelSource).toContain('closest(".workspace")');
    expect(panelSource).toContain("new window.ResizeObserver");
    expect(panelSource).toContain("window.getComputedStyle(workspace)");
    expect(stylesSource).toContain(
      "--environment-panel-min-conversation-inline-size: 720px",
    );
    expect(stylesSource).toMatch(
      /\.timeline\s*\{[^}]*margin:\s*0 auto;[^}]*max-width:\s*960px;/su,
    );
  });

  it("reserves inner content space without moving the timeline scrollbar", () => {
    expect(stylesSource).toContain("--environment-panel-inline-size: 304px");
    expect(stylesSource).toContain(
      "--environment-panel-content-safe-inline-size:",
    );
    expect(stylesSource).toMatch(
      /\.workspace:has\(\s*\.environment-control\[data-dock-open="false"\]\s+\.environment-trigger\[aria-expanded="true"\]\s*\)\s+:is\(\.timeline,\s*\.turn-status,\s*\.composer-wrap\)/su,
    );
    expect(stylesSource).toMatch(
      /max-width:\s*min\(\s*960px,\s*calc\(100%\s*-\s*var\(--environment-panel-content-safe-inline-size\)\)\s*\)/su,
    );
    expect(stylesSource).toMatch(
      /translateX\(\s*calc\(var\(--environment-panel-content-safe-inline-size\)\s*\/\s*-2\)\s*\)/su,
    );
    expect(stylesSource).not.toContain(
      '.workspace:has(.environment-trigger[aria-expanded="true"]) .timeline-scroll',
    );
    expect(stylesSource).not.toMatch(
      /\.workspace:has\(\.environment-trigger\[aria-expanded="true"\]\)\s+\.conversation/su,
    );
    expect(panelSource).toContain(
      'import { Popover } from "@artemis/ui/feedback"',
    );
    expect(appSource).not.toContain("environmentPanelOpen");
    expect(appSource).toContain('className="workspace-tool-dock"');
  });

  it("restores the panel after an auto-hidden narrow layout becomes wide", () => {
    const autoHidden = environmentPanelVisibilityAfterResize(
      { open: true, autoHidden: false },
      panelLayout(1_047),
    );
    expect(autoHidden).toEqual({ open: false, autoHidden: true });
    expect(
      environmentPanelVisibilityAfterResize(autoHidden, panelLayout(1_048)),
    ).toEqual({ open: true, autoHidden: false });
    expect(
      environmentPanelVisibilityAfterResize(
        { open: false, autoHidden: false },
        panelLayout(1_048),
      ),
    ).toEqual({ open: false, autoHidden: false });
  });

  it("provides a deterministic Chinese Electron smoke fixture", () => {
    expect(mainSource).toContain("seedSmokeEnvironmentFixture");
    expect(mainSource).toContain("ARTEMIS_SMOKE_WINDOW_WIDTH");
    expect(mainSource).toContain("ARTEMIS_SMOKE_RESIZE_WIDTH");
    expect(mainSource).toContain("view === 'environment-agents'");
    expect(mainSource).toContain("view === 'environment-pr-checks'");
    expect(mainSource).toContain("view === 'environment-sources'");
    expect(mainSource).toContain("view === 'environment-open'");
    expect(mainSource).toContain("view === 'environment-branch-menu'");
    expect(mainSource).toContain('view?.startsWith("environment")');
    expect(mainSource).toContain('view?.startsWith("icon-sizing-environment")');
    expect(mainSource).toMatch(
      /const smokeView = process\.env\.ARTEMIS_SMOKE_VIEW;\s+if \(\s+smokeView\?\.startsWith\("environment"\)/u,
    );
    expect(mainSource).toContain('return { status: "not-found" };');
    expect(mainSource).toContain('"environment-empty"');
    expect(mainSource).toContain("environment-repository");
    expect(mainSource).toContain("view === 'environment-outside-click'");
    expect(mainSource).toContain("new PointerEvent('pointerdown'");
    expect(mainSource).toContain("view === 'environment-dock-open'");
    expect(mainSource).toContain("view === 'environment-commit-dialog'");
    expect(mainSource).toContain("view === 'environment-commit-new-branch'");
    expect(mainSource).toContain(
      "view === 'environment-commit-and-push-execute'",
    );
    expect(mainSource).toContain("view === 'environment-push-execute'");
    expect(mainSource).toContain(
      "document.querySelector('.right-sidebar-toggle')?.click()",
    );
    expect(mainSource).toContain(
      "document.querySelector('.environment-trigger')?.click()",
    );
    expect(mainSource).toContain("environmentPanelOpen");
    expect(mainSource).toContain("workspaceWidth");
    expect(mainSource).toContain("timelineScrollBounds");
    expect(mainSource).toContain("timelineContentBounds");
    expect(mainSource).toContain("workspaceContentBounds");
    expect(mainSource).toContain("workspaceDockResizerBounds");
    expect(mainSource).not.toContain("environment-conversation-overlap");
    expect(mainSource).toContain('type: "mcp.tool.used"');
    expect(mainSource).toContain('type: "task.source.added"');
    expect(panelSource).toContain('source.kind === "web-search"');
    expect(panelSource).toContain("onViewAllSources()");
    expect(panelSource).toContain(
      "combinedSources.slice(0, sourcePreviewLimit)",
    );
    expect(panelSource).toContain("const activityPreviewLimit = 2");
    expect(panelSource).not.toContain("environment-web-source-links");
    expect(appSource).toContain('tab.kind === "sources"');
    expect(appSource).toContain("onViewAllSources={openSourcesPanel}");
  });

  it("summarizes all child agent states", () => {
    const agents = [
      {
        type: "child-agent.status",
        agentId: "a",
        label: "A",
        status: "running",
      },
      {
        type: "child-agent.status",
        agentId: "b",
        label: "B",
        status: "cancelling",
      },
      {
        type: "child-agent.status",
        agentId: "c",
        label: "C",
        status: "queued",
      },
      {
        type: "child-agent.status",
        agentId: "d",
        label: "D",
        status: "blocked",
      },
      {
        type: "child-agent.status",
        agentId: "e",
        label: "E",
        status: "completed",
      },
      {
        type: "child-agent.status",
        agentId: "f",
        label: "F",
        status: "failed",
      },
    ] satisfies ChildAgentState[];

    expect(environmentAgentCounts(agents)).toEqual({
      total: 6,
      active: 2,
      queued: 1,
      blocked: 1,
      completed: 1,
    });
  });

  it("marks stale active members complete when their team has completed", () => {
    const now = "2026-08-12T00:00:00.000Z";
    const teams = [
      {
        type: "agent-team.status",
        teamId: "done-team",
        mission: "Finished work",
        status: "completed",
        memberAgentIds: ["running", "failed"],
        requiredAgentIds: ["running"],
        maxMembers: 8,
        updatedAt: now,
      },
      {
        type: "agent-team.status",
        teamId: "aborted-team",
        mission: "Stopped work",
        status: "aborted",
        memberAgentIds: ["queued"],
        requiredAgentIds: ["queued"],
        maxMembers: 8,
        updatedAt: now,
      },
    ] satisfies AgentTeamState[];
    const agents = [
      {
        type: "child-agent.status",
        agentId: "running",
        label: "Running",
        teamId: "done-team",
        status: "running",
        currentTool: "bash",
      },
      {
        type: "child-agent.status",
        agentId: "failed",
        label: "Failed",
        teamId: "done-team",
        status: "failed",
      },
      {
        type: "child-agent.status",
        agentId: "queued",
        label: "Queued",
        teamId: "aborted-team",
        status: "queued",
      },
      {
        type: "child-agent.status",
        agentId: "orphan",
        label: "Orphan",
        status: "running",
      },
    ] satisfies ChildAgentState[];

    const displayed = environmentDisplayAgents(agents, teams);

    expect(displayed.map((agent) => agent.status)).toEqual([
      "completed",
      "failed",
      "cancelled",
      "running",
    ]);
    expect(displayed[0]).not.toHaveProperty("currentTool");
    expect(environmentAgentCounts(displayed)).toMatchObject({
      active: 1,
      queued: 0,
      completed: 1,
    });
  });

  it("groups MCP calls by server without retaining tool input or output", () => {
    const usages = [
      {
        type: "mcp.tool.used",
        toolCallId: "call-1",
        serverId: "github",
        serverName: "GitHub",
        toolName: "get_issue",
        agentId: "parent",
        timestamp: "2026-08-12T00:00:00.000Z",
      },
      {
        type: "mcp.tool.used",
        toolCallId: "call-2",
        serverId: "github",
        serverName: "GitHub",
        toolName: "get_issue",
        agentId: "child-1",
        timestamp: "2026-08-12T00:00:01.000Z",
      },
      {
        type: "mcp.tool.used",
        toolCallId: "call-3",
        serverId: "github",
        serverName: "GitHub",
        toolName: "list_comments",
        agentId: "child-1",
        timestamp: "2026-08-12T00:00:02.000Z",
      },
    ] satisfies McpToolUsageState[];

    expect(groupMcpUsage(usages)).toEqual([
      {
        id: "github",
        name: "GitHub",
        calls: 3,
        tools: ["get_issue", "list_comments"],
        agents: ["parent", "child-1"],
      },
    ]);
  });

  it("selects commit, safe push, or a blocked idle state", () => {
    expect(
      environmentGitAction(gitInfo({ changeCount: 2 }), false, copy),
    ).toEqual({ kind: "commit" });
    expect(
      environmentGitAction(gitInfo({ changeCount: 1 }), true, copy),
    ).toEqual({ kind: "commit", disabledReason: "stop tasks" });
    expect(
      environmentGitAction(
        gitInfo({ changeCount: 1, conflictCount: 1 }),
        false,
        copy,
      ),
    ).toEqual({ kind: "commit", disabledReason: "resolve conflicts" });
    expect(environmentGitAction(gitInfo({ ahead: 2 }), false, copy)).toEqual({
      kind: "push",
    });
    expect(
      environmentGitAction(
        gitInfo({ ahead: 1, upstream: undefined }),
        false,
        copy,
      ),
    ).toEqual({ kind: "push" });
    expect(
      environmentGitAction(gitInfo({ ahead: 1, behind: 1 }), false, copy),
    ).toEqual({ kind: "push", disabledReason: "reconcile upstream" });
    expect(environmentGitAction(gitInfo(), false, copy)).toEqual({
      kind: "idle",
      disabledReason: "synced",
    });
    const detached = gitInfo({ detached: true, changeCount: 1 });
    delete detached.currentBranch;
    expect(environmentGitAction(detached, false, copy)).toEqual({
      kind: "commit",
      disabledReason: "switch branch",
    });
  });

  it("summarizes checks and refuses to imply coverage of local-only state", () => {
    expect(
      projectPullRequestCheckSummary([
        { name: "build", status: "passed" },
        { name: "optional", status: "skipped" },
      ]),
    ).toBe("passed");
    expect(
      projectPullRequestCheckSummary([
        { name: "build", status: "failed" },
        { name: "windows", status: "pending" },
      ]),
    ).toBe("failed");
    expect(projectPullRequestCheckSummary([])).toBe("none");

    const pr = pullRequest();
    expect(
      projectPullRequestCoverageWarning(
        gitInfo({ changeCount: 1, headOid: pr.headRefOid }),
        pr,
      ),
    ).toBe("working-tree");
    expect(
      projectPullRequestCoverageWarning(
        gitInfo({ headOid: "b".repeat(40) }),
        pr,
      ),
    ).toBe("head-mismatch");
    expect(
      projectPullRequestCoverageWarning(
        gitInfo({ headOid: "b".repeat(40), ahead: 1 }),
        pr,
      ),
    ).toBe("unpushed");
    expect(
      projectPullRequestCoverageWarning(
        gitInfo({ headOid: pr.headRefOid, ahead: 1 }),
        pr,
      ),
    ).toBeUndefined();
  });

  it("positions the branch menu beside the branch row instead of clipping it inside the panel", () => {
    expect(
      environmentBranchMenuLayout(
        { left: 800, right: 1100, top: 100, bottom: 140 },
        { width: 1200, height: 800 },
      ),
    ).toEqual({ left: 504, top: 100, width: 296, maxHeight: 688 });
    expect(
      environmentBranchMenuLayout(
        { left: 250, right: 280, top: 700, bottom: 740 },
        { width: 320, height: 760 },
      ),
    ).toEqual({ left: 12, top: 588, width: 296, maxHeight: 160 });
    expect(stylesSource).toMatch(
      /\.environment-branch-menu\s*\{[^}]*position:\s*fixed;[^}]*z-index:\s*120;/su,
    );
  });

  it("shows Codex-like branch names without duplicate upstream rows", () => {
    const branches = environmentBranchMenuBranches(
      [
        { name: "main", current: true },
        { name: "origin/main", current: false, remote: true },
        { name: "codex/native-search", current: false },
        {
          name: "origin/release-preview",
          current: false,
          remote: true,
        },
      ],
      "",
    );

    expect(branches.map(environmentBranchDisplayName)).toEqual([
      "main",
      "codex/native-search",
      "release-preview",
    ]);
    expect(branches[0]).toMatchObject({ name: "main", current: true });
    expect(environmentBranchMenuBranches(branches, "release")).toHaveLength(1);
    expect(panelSource).toContain("t.branchSearch(project.name)");
    expect(panelSource).toContain("t.createBranch");
  });
});
