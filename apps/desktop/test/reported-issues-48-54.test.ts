import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
}

const appSource = source("../src/renderer/App.tsx");
const automationSource = source("../src/renderer/AutomationPage.tsx");
const planProgressSource = source("../src/renderer/TaskPlanProgress.tsx");
const stylesSource = source("../src/renderer/styles.css");

describe("reported issues #48–#54", () => {
  it("uses conversation-scoped history once an active conversation has messages", () => {
    expect(appSource).toContain("const activePromptHistory = useMemo(");
    expect(appSource).toContain("promptHistoryForConversation(");
    expect(appSource).toContain("activePromptHistory,");
  });

  it("localizes the empty conversation heading", () => {
    const emptyStateStart = appSource.indexOf(
      'className="conversation-empty-state"',
    );
    const emptyStateEnd = appSource.indexOf("<Timeline", emptyStateStart);
    const emptyState = appSource.slice(emptyStateStart, emptyStateEnd);

    expect(appSource).toContain(
      'emptyConversationPrompt: "What should we build in {{workspace}}?"',
    );
    expect(appSource).toContain(
      'emptyConversationPrompt: "想在 {{workspace}} 中构建什么？"',
    );
    expect(emptyState).toContain("emptyConversationLabel");
    expect(emptyState).toContain("emptyConversationPrefix");
    expect(emptyState).not.toContain("What should we build in");
  });

  it("shows a profile avatar or initials instead of the meaningless status dot", () => {
    const footerStart = appSource.indexOf('<div className="sidebar-footer">');
    const footerEnd = appSource.indexOf("</aside>", footerStart);
    const footer = appSource.slice(footerStart, footerEnd);

    expect(footer).toContain('className="sidebar-profile-avatar"');
    expect(footer).toContain("runtimeSettings?.profileAvatar");
    expect(footer).toContain("userInitials(username)");
    expect(footer).not.toContain('className="status-dot idle"');
    expect(stylesSource).toMatch(
      /\.sidebar-profile-avatar\s*\{[^}]*border-radius:\s*50%/u,
    );
  });

  it("dismisses a completed task-plan pill after a brief confirmation state", () => {
    expect(planProgressSource).toContain("isTaskPlanCompleted(plan)");
    expect(planProgressSource).toContain("window.setTimeout");
    expect(planProgressSource).toContain("2_500");
    expect(planProgressSource).toContain("if (!visible) return null;");
  });

  it("offers a persisted time window with an interval, timezone, and weekdays", () => {
    expect(automationSource).toContain('kind: "windowed-interval"');
    expect(automationSource).toContain("windowStart");
    expect(automationSource).toContain("windowEnd");
    expect(automationSource).toContain("windowIntervalUnit");
    expect(automationSource).toContain('className="automation-window-fields"');
    expect(automationSource).toContain('draft.preset === "windowed-interval"');
  });

  it("does not render a trailing chevron in user instruction messages", () => {
    const timelineStart = appSource.indexOf("function Timeline(");
    const userMessageStart = appSource.indexOf(
      'if (kind === "user")',
      timelineStart,
    );
    const userMessageEnd = appSource.indexOf(
      'if (kind === "compaction")',
      userMessageStart,
    );
    const userMessage = appSource.slice(userMessageStart, userMessageEnd);

    expect(userMessage).toContain('className="user-message"');
    expect(userMessage).not.toContain("ChevronIcon");
    expect(userMessage).not.toContain("child-agent-open-icon");
  });
});
