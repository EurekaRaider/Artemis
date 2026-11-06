import { uiText } from "../../../src/shared/i18n/ui-text.js";
import { findCssDeclarations } from "../css-test-utils.js";

import { describe, expect, it } from "vitest";

import {
  appSource,
  stylesSource,
  nocturneStylesSource,
  mainProcessSource,
  runtimeSource,
  taskPlanSource,
  uiPatternsSource,
  toolActivityGroupsSource,
  cssRule,
  publicUiCssRule,
} from "../../fixtures/application/layout-contract.js";
describe("renderer layout contract", () => {
  it("scrolls the timeline inside the conversation instead of the document", () => {
    expect(appSource).toContain('className="timeline-scroll"');
    expect(appSource).not.toContain("scrollIntoView");
  });
  it("makes the timeline container independently scrollable", () => {
    const rule = publicUiCssRule(
      '[data-artemis-component="timeline-viewport"]',
    );

    expect(rule).toMatch(/\bmin-block-size:\s*0/u);
    expect(rule).toMatch(/\boverflow-y:\s*auto/u);
  });
  it("keeps a pinned timeline at the bottom when its rendered content resizes", () => {
    expect(appSource).toContain("observer.observe(container);");
    expect(appSource).toContain(
      "for (const child of container.children) observer.observe(child);",
    );
    expect(appSource).toContain("[activeEvents.length, activeThreadId]");
  });
  it("shows real task steps with status-specific progress markers", () => {
    expect(appSource).toContain("deriveTaskPlan(activeEvents, turnActive)");
    expect(appSource).toContain("<TaskPlanProgress");
    expect(taskPlanSource).toContain("taskPlanPatternView(plan, locale)");
    expect(taskPlanSource).toContain("<TaskPlanPattern");
    expect(uiPatternsSource).toContain('data-part="marker"');
    expect(uiPatternsSource).toContain("data-status={visibleStatus}");
    expect(uiPatternsSource).toContain(
      'step.id === currentStepId && step.status === "pending"',
    );
    expect(
      cssRule(
        '.task-plan-progress [data-part="marker"][data-status="in_progress"]',
      ),
    ).toBeTruthy();
    expect(
      cssRule(
        '.task-plan-progress [data-part="marker"][data-status="pending"]',
      ),
    ).toBeTruthy();
    expect(
      cssRule(
        '.task-plan-progress [data-part="marker"][data-status="completed"]::after',
      ),
    ).toBeTruthy();
    expect(stylesSource).toContain("@keyframes task-step-breathe");
    expect(stylesSource).toContain("@keyframes task-step-dot-pulse");
    expect(runtimeSource).toContain('name: "update_plan"');
    expect(runtimeSource).toContain('"update_plan"');
  });
  it("opens task-plan details with capsule hover intent and keyboard access", () => {
    expect(uiPatternsSource).toContain("onPointerEnter={scheduleOpen}");
    expect(uiPatternsSource).toContain("onPointerLeave={cancelScheduledOpen}");
    expect(uiPatternsSource).toContain(
      "TASK_PLAN_HOVER_INTENT_MILLISECONDS = 175",
    );
    expect(uiPatternsSource).toContain(
      "cancelScheduledOpen();\n          disclosure.requestExpanded(true);",
    );
    expect(uiPatternsSource).toContain("aria-expanded={disclosure.expanded}");
  });
  it("shows each sub-agent once as a compact task-labelled activity", () => {
    expect(toolActivityGroupsSource).toContain('"spawn_agent"');
    expect(appSource).not.toContain("<SubagentList");
    expect(appSource).toContain("<AgentActivity");
    expect(appSource).toContain("className={`child-agent-card");
    expect(appSource).toContain(
      "label={`${child.label}, ${childStatusLabels[child.status]}`}",
    );
    expect(appSource).toContain('className="tool-step-target"');
    expect(appSource).toContain("onActivate={() => onOpenChildAgent(child)}");
    expect(appSource).toContain("function ChildAgentPanel(");
    expect(appSource).toContain(
      "child?.error ?? child?.output ?? child?.activity",
    );
    expect(runtimeSource).toContain("const childAdapter = new PiAdapter(");
    expect(runtimeSource).toContain("scheduleActivityUpdate");
    const childSessionStart = runtimeSource.indexOf("const childTools = [");
    const childSessionEnd = runtimeSource.indexOf(
      "await child.session.prompt(",
      childSessionStart,
    );
    const childSessionSource = runtimeSource.slice(
      childSessionStart,
      childSessionEnd,
    );
    expect(childSessionSource).toContain("...childMcpTools");
    expect(childSessionSource).toMatch(
      /childMcpTools\.some\(\s*\(candidate\) => candidate\.name === tool\.name,\s*\)/u,
    );
    expect(runtimeSource).not.toMatch(
      /configuredMcpTools\s*\.filter\(\(tool\) => tool\.readOnly\)/u,
    );
    expect(cssRule(".child-agent-card")).toMatch(/\bborder-radius:\s*9px/u);
  });
  it("renders context compaction progress and completion in the timeline", () => {
    expect(uiText("en", "App_copy.running")).toBe("Thinking");
    expect(uiText("zh-CN", "App_copy.running")).toBe("思考中");
    expect(uiText("en", "App_copy.contextCompacting")).toBe(
      "Compacting context",
    );
    expect(uiText("zh-CN", "App_copy.contextCompacting")).toBe(
      "正在压缩上下文",
    );
    expect(uiText("en", "App_copy.contextCompacted")).toBe(
      "Context compaction completed",
    );
    expect(uiText("zh-CN", "App_copy.contextCompacted")).toBe(
      "上下文压缩已完成",
    );
    expect(appSource).toContain('if (kind === "compaction")');
    expect(appSource).toContain("state.contextCompactions[id]");
    expect(appSource).toContain("COMPACTION_COMPLETION_NOTICE_MILLISECONDS");
    expect(appSource).toContain("function ContextCompactionStatus(");
    expect(appSource).toContain("completionDeadline - Date.now()");
    expect(appSource).toContain("setVisible(false)");
    expect(appSource).toContain("!latestTimelineEntryIsCompaction");
    expect(cssRule(".turn-status.running > span:nth-child(2)")).toMatch(
      /\banimation:\s*tool-summary-shimmer\b/u,
    );
    expect(cssRule(".timeline > .turn-status")).toMatch(/\bwidth:\s*100%/u);
  });
  it("uses Codex-scale conversation typography without a timeline Thinking row", () => {
    const conversation = publicUiCssRule(
      '[data-artemis-component="conversation-surface"]',
    );
    const assistant = publicUiCssRule(
      '[data-artemis-component="conversation-message"][data-message-kind="assistant"]',
    );
    expect(conversation).toContain(
      "font-family: var(--artemis-typography-body-family)",
    );
    expect(assistant).toContain(
      "font-size: calc(var(--artemis-typography-body-size) + 0.5px)",
    );
    expect(
      findCssDeclarations(
        nocturneStylesSource,
        '.app-shell .tool-card[data-artemis-component="tool-activity"][data-state]',
      ),
    ).toContain("font-size: 13px");
    expect(
      findCssDeclarations(nocturneStylesSource, ".tool-step-target"),
    ).toContain("white-space: nowrap");
    expect(appSource).not.toContain('thinkingStatus: "Thinking"');
    expect(appSource).not.toContain('className="thinking-status"');
    expect(appSource).toContain('if (part.type === "thinking") return null;');
    expect(appSource).not.toContain('className="thinking-card"');
    expect(appSource).not.toContain("<p>{part.text}</p>");
  });
  it("keeps recoverable failed tool rows neutral while preserving failure details", () => {
    const failedToolRule = findCssDeclarations(
      nocturneStylesSource,
      ".tool-step-verb",
    );
    expect(failedToolRule).toContain("color: var(--muted)");
    expect(failedToolRule).not.toContain("--artemis-color-status-danger");
    expect(
      findCssDeclarations(
        nocturneStylesSource,
        '.tool-step-status[data-status="failed"]',
      ),
    ).toContain("var(--danger)");
    expect(uiText("en", "App_copy.failed")).toBe("Failed");
    expect(appSource).toContain("formatToolOutput(tool.name, tool.output)");
  });
  it("emits the cancelled completion against the active turn", () => {
    const cancelStart = mainProcessSource.indexOf(
      "async function cancelTaskTurn",
    );
    const cancelEnd = mainProcessSource.indexOf(
      "function registerIpc",
      cancelStart,
    );
    const cancelHandler = mainProcessSource.slice(cancelStart, cancelEnd);

    expect(cancelHandler).toContain(
      "const turnId = activeTurns.get(command.threadId);",
    );
    expect(cancelHandler).toContain("emitPayload(command.threadId, turnId, {");
    expect(mainProcessSource).toContain("cancelTaskTurn(threadId)");
  });
  it("raises an accessible in-flow error banner when a live turn fails", () => {
    expect(appSource).toContain('if (event.payload.type === "turn.failed")');
    expect(appSource).toContain("reduceTurnFailureNotices(current");
    expect(appSource).toContain('className="turn-error-banner"');
    expect(appSource).toContain('className="turn-error-banner" role="alert"');
    expect(appSource).toContain("t.dismissTurnError");
    expect(cssRule(".turn-error-banner")).toMatch(
      /\bborder-color:\s*color-mix\(in srgb, var\(--danger\)/u,
    );
    expect(cssRule(".turn-error-banner")).not.toMatch(/\bposition:\s*fixed/u);
  });
});
