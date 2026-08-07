import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    "utf8",
  );
}

const appSource = source("../src/renderer/App.tsx");
const stylesSource = source("../src/renderer/styles.css");
const apiSource = source("../src/shared/api.ts");
const mainSource = source("../src/main/main.ts");
const workerSource = source("../src/agent/agent-worker.ts");

describe("agent-team workbench", () => {
  it("opens a non-stealing right-dock team tab from the first persisted event", () => {
    expect(appSource).toContain('event.payload.type === "agent-team.status"');
    expect(appSource).toContain("agentTeamWorkspaceTab(");
    expect(appSource).toContain("reconcileAgentTeamWorkspaceTab(");
    expect(appSource).toContain('tab.kind === "agent-team"');
    expect(appSource).toContain("<AgentTeamPanel");
  });

  it("shows collaboration messages and complete team runtime states", () => {
    expect(appSource).toContain("function AgentTeamPanel(");
    expect(appSource).toContain("message.fromAgentId");
    expect(appSource).toContain('blocked: "存在阻塞"');
    expect(appSource).toContain('integrating: "等待主 Agent 集成"');
    expect(appSource).toContain('aborted: "已中止"');
    expect(stylesSource).toContain(".agent-team-grid");
    expect(stylesSource).toContain(".agent-team-skeleton");
  });

  it("stacks the member queue above the collaboration log", () => {
    expect(stylesSource).toMatch(
      /\.agent-team-grid \{[\s\S]*?display: flex;[\s\S]*?flex-direction: column;/,
    );
    expect(stylesSource).toMatch(
      /\.agent-team-members \{[\s\S]*?border-bottom: 1px solid var\(--border\);/,
    );
    expect(stylesSource).toMatch(
      /\.agent-team-collaboration \{[\s\S]*?flex: 1 1 0;/,
    );
  });

  it("opens the subagent page directly from an icon-and-name member row", () => {
    const memberButton = appSource.match(
      /<button\s+className=\{`agent-team-member[^>]*>([\s\S]*?)<\/button>/,
    )?.[0];

    expect(memberButton).toContain("onClick={() => onOpenChildAgent(member)}");
    expect(memberButton).toContain("<ChildAgentIcon");
    expect(memberButton).toContain("identity={member.agentId}");
    expect(memberButton).toContain("{member.label}");
    expect(memberButton).not.toContain("member.role");
    expect(memberButton).not.toContain("member.task");
    expect(memberButton).not.toContain("member.writePaths");
    expect(appSource).not.toContain("labels.openAgent");
    expect(appSource).not.toContain("agent-team-member-details");
  });

  it("assigns stable colors and geometric marks to child agent identities", () => {
    expect(appSource).toContain("const CHILD_AGENT_MARK_COLORS = [");
    expect(appSource).toContain(
      "function childAgentMarkHash(identity: string)",
    );
    expect(appSource).toContain("const shape = (hash >>> 8) % 8");
    expect(appSource).toContain("identity={child.agentId}");
    expect(appSource).toContain("identity={child?.agentId}");
    expect(appSource).toContain('"#4f86ff"');
    expect(appSource).toContain('"#1fc9ae"');
    expect(appSource).toContain('opacity="0.32"');
    expect(stylesSource).toContain(".child-agent-mark {");
  });

  it("cancels the team without routing through turn cancellation", () => {
    expect(apiSource).toContain("controlAgentTeam(");
    expect(apiSource).toContain(
      'agentTeamControl: "artemis:agent-team-control"',
    );
    expect(appSource).toContain("window.artemis.controlAgentTeam");
    expect(mainSource).toContain("IPC.agentTeamControl");
    expect(mainSource).toContain('type: "team.cancel"');
    expect(workerSource).toContain('case "team.cancel"');
  });
});
