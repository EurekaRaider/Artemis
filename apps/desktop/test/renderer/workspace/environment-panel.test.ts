import { readDesktopStyles } from "../../fixtures/application/styles-source.js";
import { readRendererAppSources } from "../../fixtures/application/renderer-source.js";
import { readMainProcessSources } from "../../fixtures/application/main-source.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type {
  AgentTeamState,
  ChildAgentState,
  McpToolUsageState,
} from "@artemis/protocol";

import type {
  ProjectGitInfo,
  ProjectPullRequest,
} from "../../../src/shared/api.js";
import { childAgentMarkForIdentity } from "../../../src/renderer/components/ChildAgentIcon.js";
import {
  environmentBranchDisplayName,
  environmentBranchMenuBranches,
  environmentBranchMenuLayout,
  environmentAgentCounts,
  environmentDisplayAgents,
  environmentTopLevelAgents,
  environmentGitAction,
  groupMcpUsage,
  projectPullRequestCheckSummary,
  projectPullRequestCoverageWarning,
  suggestedEnvironmentBranchName,
} from "../../../src/renderer/workspace/EnvironmentPanel.js";

const source = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

const appSource = readRendererAppSources();
const panelSource = source(
  "../../../src/renderer/workspace/EnvironmentPanel.tsx",
);
const stylesSource = readDesktopStyles("styles");
const nocturneStylesSource = readDesktopStyles("nocturne");
const workflowSource = source("../../../../../packages/ui/src/workflow.tsx");
const publicUiStylesSource = source(
  "../../../../../packages/ui/src/styles.css",
);
const mainSource = readMainProcessSources();
const smokeSource = [
  "../../../test/fixtures/smoke/workspace.ts",
  "../../../test/fixtures/smoke/ipc/workspace.ts",
  "../../../scripts/verify/ui/smoke/window-capture.ts",
  "../../../scripts/verify/ui/smoke/prepare-view.ts",
  "../../../scripts/verify/ui/smoke/collect-evidence.ts",
]
  .map(source)
  .join("\n");
const watcherSource = source(
  "../../../src/main/workspace/project-git-watcher.ts",
);

const copy = {
  stopTasks: "stop tasks",
  conflicts: "resolve conflicts",
  behind: "reconcile upstream",
  noUpstream: "no upstream",
  synced: "synced",
  detachedBlocked: "switch branch",
};

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
  it("includes direct team members and standalone agents while excluding the root and nested agents", () => {
    const agents = [
      { agentId: "direct", parentAgentId: "parent", depth: 1 },
      { agentId: "legacy-direct" },
      { agentId: "nested", parentAgentId: "direct", depth: 2 },
      { agentId: "depth-only", depth: 2 },
      { agentId: "member", parentAgentId: "parent", teamId: "team" },
      { agentId: "legacy-member", parentAgentId: "parent" },
      { agentId: "parent" },
      {
        agentId: "team-nested",
        teamId: "team",
        parentAgentId: "member",
        depth: 2,
      },
      { agentId: "root-depth", depth: 0 },
    ] as ChildAgentState[];
    expect(
      environmentTopLevelAgents(agents).map((agent) => agent.agentId),
    ).toEqual(["direct", "legacy-direct", "member", "legacy-member"]);
  });
  it("mounts the popover between task status and the existing right dock", () => {
    const status = appSource.indexOf(
      "className={`status-pill ${statusDotStatus}`}",
    );
    const environment = appSource.indexOf("<EnvironmentPanel", status);
    const dock = appSource.indexOf(
      'className="right-sidebar-toggle"',
      environment,
    );

    expect(status).toBeGreaterThan(-1);
    expect(environment).toBeGreaterThan(status);
    expect(dock).toBeGreaterThan(environment);
  });

  it("enables automatic opening, closes with the dock, and can reopen beside the dock", () => {
    expect(appSource).toContain(
      "defaultOpen={Boolean(threadState?.turnOrder.length)}",
    );
    expect(panelSource).toContain("useState(false)");
    expect(panelSource).toContain("openRef.current = false");
    expect(panelSource).toContain("setOpen(false)");
    expect(panelSource).toContain("data-dock-open={dockOpen}");
  });

  it("links the trigger to the named Environment dialog", () => {
    expect(panelSource).toContain("const panelId = useId()");
    expect(panelSource).toContain("controls={panelId}");
    expect(smokeSource).toContain(
      'rule: "environment-trigger-dialog-relationship"',
    );
  });

  it("keeps loaded Git information mounted while the workspace dock toggles", () => {
    const key = appSource.match(
      /const environmentWorkspaceKey = JSON.stringify\(\[([\s\S]*?)\]\)/u,
    )?.[1];
    expect(key).toContain("activeProject?.path");
    expect(key).toContain("environmentWorktree?.id");
    expect(key).toContain("environmentWorktree?.path");
    expect(key).not.toContain("workspaceDockOpen");
    expect(appSource).not.toContain(
      '${workspaceDockOpen ? "dock-open" : "dock-closed"}',
    );
  });

  it("uses the 304px docked inspector with an opaque reading surface", () => {
    expect(nocturneStylesSource).toContain(
      "--environment-panel-inline-size: 304px",
    );
    expect(nocturneStylesSource).toContain("inset-block: 46px 0");
    expect(nocturneStylesSource).toContain(
      "border-inline-start: 1px solid var(--border-soft)",
    );
    expect(nocturneStylesSource).toContain("backdrop-filter: none");
    expect(panelSource).toContain("window.innerWidth >= 980");
    expect(stylesSource).toContain(".environment-checks-popover");
  });

  it("hides optional task sections until they contain activity", () => {
    expect(panelSource).toContain(
      "(displayAgents.length > 0 || teams.length > 0) &&",
    );
    expect(panelSource).toContain("hasSourcePanelDetails &&");
    expect(panelSource).not.toContain("mcpGroups.length > 0 &&");
  });

  it("uses the standard agent glyph and a running status indicator", () => {
    expect(panelSource).toContain('<ArtemisIcon name="agent"');
    expect(panelSource).not.toContain(
      'className="environment-agent-team-trigger"',
    );
    expect(panelSource).toContain("data-status={agent.status}");
    expect(panelSource).toContain(
      "<AgentActivityStatus child={agent} locale={locale} />",
    );
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
      'onOpenReview("branch", gitInfo?.compareBase)',
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
    expect(panelSource).toContain("onOpenTeam(latestTeam)");
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
    expect(watcherSource).toContain("gitRepositoryWatchPaths(workspacePath)");
    expect(watcherSource).toContain("gitRepositoryMetadataSignature(plan)");
    expect(watcherSource).toContain('changed("metadata")');
    expect(watcherSource).toContain('changed("worktree")');
    expect(watcherSource).toContain("pendingKinds");
    expect(watcherSource).toContain("}, 1_000);");
    expect(watcherSource).toContain("IPC.projectGitChanged");
    expect(appSource).toMatch(/\{ threadId: activeThreadId \}\s*:\s*\{\}\)/u);
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
    expect(workflowSource).toContain('role="dialog"');
    expect(panelSource).not.toContain('aria-modal="true"');
    expect(stylesSource).toContain("overscroll-behavior: contain");
    expect(stylesSource).toContain("inset-inline-end:");
    expect(stylesSource).toContain("@media (max-width: 680px)");
    expect(stylesSource).toContain("max-height: calc(100vh - 64px)");
  });

  it("keeps the compact panel styling while reserving conversation content space", () => {
    expect(nocturneStylesSource).toContain(
      "--environment-panel-inline-size: 304px",
    );
    expect(stylesSource).toContain(
      "--environment-panel-content-safe-inline-size",
    );
    expect(stylesSource).not.toContain(
      "--environment-panel-min-conversation-inline-size",
    );
    expect(panelSource).toContain("new window.ResizeObserver(syncVisibility)");
    expect(panelSource).toContain('className="environment-panel-header"');
    expect(panelSource).toContain("onClick={closePanel}");
    expect(publicUiStylesSource).toMatch(
      /\[data-artemis-component="timeline"\]\s*\{[^}]*max-inline-size:\s*60rem;[^}]*margin-inline:\s*auto;/su,
    );
    expect(appSource).not.toContain("environmentPanelOpen");
  });

  it("provides a deterministic Chinese Electron smoke fixture", () => {
    expect(smokeSource).toContain("seedSmokeEnvironmentFixture");
    expect(smokeSource).toContain("ARTEMIS_SMOKE_WINDOW_WIDTH");
    expect(smokeSource).toContain("ARTEMIS_SMOKE_RESIZE_WIDTH");
    expect(smokeSource).toContain("view === 'environment-agents'");
    expect(smokeSource).toContain("view.startsWith('environment-pr-checks')");
    expect(smokeSource).toContain('"environment-pr-checks-empty"');
    expect(smokeSource).toContain("view === 'environment-sources'");
    expect(smokeSource).toContain("view === 'environment-open'");
    expect(smokeSource).toContain("view === 'environment-branch-menu'");
    expect(smokeSource).toContain('view?.startsWith("environment")');
    expect(smokeSource).toContain(
      'view?.startsWith("icon-sizing-environment")',
    );
    expect(smokeSource).toMatch(
      /const smokeView = process\.env\.ARTEMIS_SMOKE_VIEW;\s+if \(\s+smokeView\?\.startsWith\("environment"\)/u,
    );
    expect(smokeSource).toContain('return { status: "not-found" };');
    expect(smokeSource).toContain('"environment-empty"');
    expect(smokeSource).toContain("environment-repository");
    expect(smokeSource).toContain("view === 'environment-outside-click'");
    expect(smokeSource).toContain("new PointerEvent('pointerdown'");
    expect(smokeSource).toContain("view === 'environment-dock-open'");
    expect(smokeSource).toContain("view === 'environment-commit-dialog'");
    expect(smokeSource).toContain("view === 'environment-commit-new-branch'");
    expect(smokeSource).toContain(
      "view === 'environment-commit-and-push-execute'",
    );
    expect(smokeSource).toContain("view === 'environment-push-execute'");
    expect(smokeSource).toContain(
      "document.querySelector('.right-sidebar-toggle')?.click()",
    );
    expect(smokeSource).toContain("workspaceDock?.getAnimations()");
    expect(smokeSource).toContain("animation.currentTime = duration / 2");
    expect(smokeSource).toContain(
      "document.querySelector('.environment-trigger')?.click()",
    );
    expect(smokeSource).toContain("environmentPanelOpen");
    expect(smokeSource).toContain("workspaceWidth");
    expect(smokeSource).toContain("timelineScrollBounds");
    expect(smokeSource).toContain("timelineContentBounds");
    expect(smokeSource).toContain("workspaceContentBounds");
    expect(smokeSource).toContain("workspaceDockResizerBounds");
    expect(smokeSource).not.toContain("environment-conversation-overlap");
    expect(smokeSource).toContain('type: "mcp.tool.used"');
    expect(smokeSource).toContain('type: "task.source.added"');
    expect(panelSource).toContain('source.kind === "web-search"');
    expect(panelSource).toContain("onViewAllSources()");
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

  it("groups local branches before remote branches with stable current-first ordering", () => {
    const branches = [
      { name: "origin/release-z", current: false, remote: true },
      { name: "feature-z", current: false, remote: false },
      { name: "origin/release-a", current: false, remote: true },
      { name: "main", current: true },
      { name: "feature-a", current: false },
    ];
    const original = structuredClone(branches);
    expect(
      environmentBranchMenuBranches(branches, "").map((branch) => branch.name),
    ).toEqual([
      "main",
      "feature-z",
      "feature-a",
      "origin/release-z",
      "origin/release-a",
    ]);
    expect(branches).toEqual(original);
  });
});
