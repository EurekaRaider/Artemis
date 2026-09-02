import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    "utf8",
  );
}

function between(
  value: string,
  startMarker: string,
  endMarker: string,
): string {
  const start = value.indexOf(startMarker);
  const end = value.indexOf(endMarker, start + startMarker.length);

  expect(start, `Missing start marker: ${startMarker}`).toBeGreaterThan(-1);
  expect(end, `Missing end marker: ${endMarker}`).toBeGreaterThan(start);
  return value.slice(start, end);
}

const appSource = source("../src/renderer/App.tsx");
const stylesSource = source("../src/renderer/styles.css");
const workspaceTabsSource = source("../src/renderer/workspace-tabs.ts");

describe("Codex-style child-agent workspace tabs", () => {
  it("opens a child-agent row in the right workspace dock instead of inline details", () => {
    const timelineSource = appSource.slice(
      appSource.indexOf("function Timeline("),
    );
    const childRowSource = between(
      timelineSource,
      'if (kind === "child")',
      "return null;\n  };",
    );

    expect(childRowSource).toContain("<AgentActivity");
    expect(childRowSource).toContain(
      "onActivate={() => onOpenChildAgent(child)}",
    );
    expect(childRowSource).not.toContain("<details");
    expect(childRowSource).not.toContain('className="child-agent-details"');
    expect(childRowSource).toContain('child.parentAgentId !== "parent"');
    expect(appSource).toContain("onOpenChildAgent={openChildAgentPanel}");
    expect(appSource).toContain("setWorkspaceDockOpen(true)");
    expect(workspaceTabsSource).toContain('"child-agent"');
  });

  it("renders each open child agent from the live protocol reducer state", () => {
    const dockSource = between(
      appSource,
      'className="workspace-tool-dock"',
      "{settingsOpen && (",
    );

    expect(dockSource).toContain('tab.kind === "child-agent"');
    expect(dockSource).toContain("threadState?.childAgents[tab.childAgentId]");
    expect(dockSource).toContain("<ChildAgentPanel");
    expect(appSource).toContain("function ChildAgentPanel(");
    expect(appSource).toContain("<MarkdownContent");
  });

  it("shows runtime health and exposes bounded intervention controls", () => {
    const panelSource = between(
      appSource,
      "function ChildAgentPanel(",
      "function Timeline(",
    );

    expect(panelSource).toContain("clockMs");
    expect(panelSource).toContain("child.lastActivityAt");
    expect(panelSource).toContain("child.currentTool");
    expect(panelSource).toContain('"长时间运行"');
    expect(panelSource).toContain('"疑似无响应"');
    expect(panelSource).toContain('"Long-running"');
    expect(panelSource).toContain('"Possibly unresponsive"');
    expect(panelSource).toContain("CHILD_UNRESPONSIVE_SILENCE_MILLISECONDS");
    expect(panelSource).toContain("!child?.currentTool");
    expect(panelSource).toContain('"催办"');
    expect(panelSource).toContain('"停止此子代理"');
    expect(panelSource).toContain('"重试"');
    expect(panelSource).toContain('onControl(child, "steer")');
    expect(panelSource).toContain('onControl(child, "cancel")');
    expect(panelSource).toContain('onControl(child, "retry")');
    expect(appSource).toContain("window.artemis.controlChildAgent");
  });

  it("closes only the selected output tab and never sends an agent lifecycle command", () => {
    const closeButtonSource = between(
      appSource,
      'className="workspace-tab-close"',
      "</button>",
    );
    const closeHandlerSource = between(
      appSource,
      "const closeWorkspaceTab = useCallback(",
      "\n  const openWorkspaceTabForThread",
    );

    expect(closeButtonSource).toContain("closeWorkspaceTab(tab.id, {");
    expect(closeHandlerSource).toContain('type: "close"');
    expect(closeHandlerSource).toContain("tabId");
    expect(`${closeButtonSource}\n${closeHandlerSource}`).not.toMatch(
      /window\.artemis|cancel|stop|delete|terminate|interrupt/iu,
    );
  });

  it("keeps child identity and runtime chrome fixed above scrollable output", () => {
    const panelSource = between(
      appSource,
      "function ChildAgentPanel(",
      "function Timeline(",
    );
    expect(stylesSource).toMatch(
      /\.child-agent-card\s*\{[^}]*\bcursor:\s*pointer[^}]*\bdisplay:\s*flex/isu,
    );
    expect(stylesSource).toContain(".child-agent-card:focus-visible");
    expect(stylesSource).toMatch(
      /\.child-agent-panel\s*\{[^}]*\bdisplay:\s*flex[^}]*\boverflow:\s*hidden/isu,
    );
    expect(stylesSource).toMatch(
      /\.child-agent-panel-body\s*\{[^}]*\bflex:\s*1 1 auto[^}]*\boverflow:\s*auto/isu,
    );
    expect(stylesSource).toContain(".child-agent-panel-header");
    expect(stylesSource).toContain(".child-agent-panel-runtime-bar");
    expect(stylesSource).toContain(".child-agent-panel-output");
    expect(panelSource.indexOf("child-agent-panel-header")).toBeLessThan(
      panelSource.indexOf("child-agent-panel-runtime-bar"),
    );
    expect(panelSource.indexOf("child-agent-panel-runtime-bar")).toBeLessThan(
      panelSource.indexOf("child-agent-panel-body"),
    );
  });

  it("follows live output only while the active child-agent view remains near the bottom", () => {
    const panelSource = between(
      appSource,
      "function ChildAgentPanel(",
      "function Timeline(",
    );
    const threshold = panelSource.match(
      /const CHILD_AGENT_SCROLL_THRESHOLD\s*=\s*(\d+)/u,
    )?.[1];

    expect(threshold).toBeDefined();
    expect(Number(threshold)).toBeGreaterThanOrEqual(24);
    expect(Number(threshold)).toBeLessThanOrEqual(96);
    expect(panelSource).toMatch(
      /scrollHeight\s*-\s*scrollTop\s*-\s*clientHeight\s*<=\s*CHILD_AGENT_SCROLL_THRESHOLD/u,
    );
    expect(panelSource).toContain("childAgentFollowOutput.current =");
    expect(panelSource).toMatch(
      /if\s*\(\s*!active\s*\|\|\s*!childAgentFollowOutput\.current\s*\)\s*return/u,
    );
    expect(panelSource).toMatch(
      /childAgentScrollContainer\.current[\s\S]*?scrollTop\s*=\s*[\s\S]*?scrollHeight/u,
    );
    expect(panelSource).toMatch(
      /useLayoutEffect\([\s\S]*?\[[^\]]*\bactive\b[^\]]*\bcontent\b[^\]]*\]/u,
    );
    expect(panelSource).toContain("ref={childAgentScrollContainer}");
    expect(panelSource).toContain("onScroll={handleChildAgentScroll}");
    expect(panelSource).toMatch(
      /className="child-agent-panel-body"[\s\S]*?onScroll=\{handleChildAgentScroll\}[\s\S]*?ref=\{childAgentScrollContainer\}/u,
    );
    expect(appSource).toContain(
      "active={workspaceTabs.activeTabId === tab.id}",
    );
  });
});
