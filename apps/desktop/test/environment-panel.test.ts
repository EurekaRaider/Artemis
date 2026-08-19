import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type {
  AgentTeamState,
  ChildAgentState,
  McpToolUsageState,
} from "@artemis/protocol";

import type { ProjectGitInfo } from "../src/shared/api.js";
import { childAgentMarkForIdentity } from "../src/renderer/ChildAgentIcon.js";
import {
  ENVIRONMENT_PANEL_MIN_WORKSPACE_WIDTH,
  environmentPanelVisibilityAfterResize,
  environmentAgentCounts,
  environmentDisplayAgents,
  environmentGitAction,
  groupMcpUsage,
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
    expect(stylesSource).toContain(
      "max-height: min(440px, calc(100vh - 64px))",
    );
    expect(stylesSource).toContain("min-height: 42px");
  });

  it("hides optional task sections until they contain activity", () => {
    expect(panelSource).toContain(
      "(displayAgents.length > 0 || teams.length > 0) &&",
    );
    expect(panelSource).toContain("mcpGroups.length > 0 &&");
    expect(panelSource).toContain("combinedSources.length > 0 &&");
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
    expect(panelSource).toContain('onOpenReview("branch")');
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
    expect(panelSource).toContain("onClick={onAddSources}");
    expect(panelSource).not.toMatch(/picture.?in.?picture|画中画/iu);
  });

  it("suggests a safe Codex-prefixed branch from the task title", () => {
    expect(suggestedEnvironmentBranchName("Codex Git 面板")).toBe(
      "codex/codex-git-面板",
    );
    expect(suggestedEnvironmentBranchName("---")).toBe("codex/changes");
  });

  it("stays open on outside clicks while supporting Escape, scrolling, RTL, and narrow windows", () => {
    expect(panelSource).not.toContain(
      'document.addEventListener("pointerdown"',
    );
    expect(panelSource).toContain('event.key !== "Escape"');
    expect(panelSource).toContain("trigger.current?.focus()");
    expect(panelSource).toContain('role="dialog"');
    expect(stylesSource).toContain("overscroll-behavior: contain");
    expect(stylesSource).toContain("inset-inline-end:");
    expect(stylesSource).toContain("@media (max-width: 680px)");
    expect(stylesSource).toContain("max-height: calc(100vh - 64px)");
  });

  it("keeps the timeline centered and auto-hides the panel before they overlap", () => {
    expect(ENVIRONMENT_PANEL_MIN_WORKSPACE_WIDTH).toBe(1_472);
    expect(shouldAutoHideEnvironmentPanel(1_471)).toBe(true);
    expect(shouldAutoHideEnvironmentPanel(1_472)).toBe(false);
    expect(panelSource).toContain('closest(".workspace")');
    expect(panelSource).toContain("new window.ResizeObserver");
    expect(stylesSource).not.toContain(
      '.workspace:has(.environment-trigger[aria-expanded="true"]) .timeline-scroll',
    );
    expect(stylesSource).toMatch(
      /\.timeline\s*\{[^}]*margin:\s*0 auto;[^}]*max-width:\s*960px;/su,
    );
  });

  it("reserves space for the whole conversation while the panel is open", () => {
    expect(stylesSource).toContain("--environment-panel-inline-size: 304px");
    expect(stylesSource).toMatch(
      /\.workspace:has\(\.environment-trigger\[aria-expanded="true"\]\)\s+\.conversation\s*\{[^}]*margin-inline-end:\s*calc\(\s*var\(--environment-panel-inline-size\)\s*\+\s*var\(--environment-panel-layout-gap\)\s*\);/su,
    );
    expect(stylesSource).not.toMatch(
      /\.workspace:has\(\.environment-trigger\[aria-expanded="true"\]\)\s+:(?:is|where)\([^)]*(?:timeline|composer)/su,
    );
    expect(stylesSource).toMatch(
      /@media \(max-width: 680px\)[\s\S]*?\.workspace:has\(\.environment-trigger\[aria-expanded="true"\]\)\s+\.conversation\s*\{[^}]*margin-inline-end:\s*0;/u,
    );
    expect(panelSource).toContain("onOpenChange(open)");
    expect(appSource).toContain(
      "environmentPanelOpen ? ENVIRONMENT_PANEL_RESERVED_WORKSPACE_WIDTH : 0",
    );
  });

  it("restores the panel after an auto-hidden narrow layout becomes wide", () => {
    const autoHidden = environmentPanelVisibilityAfterResize(
      { open: true, autoHidden: false },
      1_471,
    );
    expect(autoHidden).toEqual({ open: false, autoHidden: true });
    expect(environmentPanelVisibilityAfterResize(autoHidden, 1_472)).toEqual({
      open: true,
      autoHidden: false,
    });
    expect(
      environmentPanelVisibilityAfterResize(
        { open: false, autoHidden: false },
        1_472,
      ),
    ).toEqual({ open: false, autoHidden: false });
  });

  it("provides a deterministic Chinese Electron smoke fixture", () => {
    expect(mainSource).toContain("seedSmokeEnvironmentFixture");
    expect(mainSource).toContain("ARTEMIS_SMOKE_WINDOW_WIDTH");
    expect(mainSource).toContain("ARTEMIS_SMOKE_RESIZE_WIDTH");
    expect(mainSource).toContain("view === 'environment-agents'");
    expect(mainSource).toContain("view === 'environment-open'");
    expect(mainSource).toContain(
      'ARTEMIS_SMOKE_VIEW?.startsWith("environment")',
    );
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
    expect(mainSource).toContain("environment-conversation-overlap");
    expect(mainSource).toContain('type: "mcp.tool.used"');
    expect(mainSource).toContain('type: "task.source.added"');
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
});
