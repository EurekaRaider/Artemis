import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const source = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

const appSource = source("../../src/renderer/app/App.tsx");
const taskPlanSource = source(
  "../../src/renderer/conversation/TaskPlanProgress.tsx",
);
const taskPlanPatternSource = source(
  "../../../../packages/ui/src/patterns.tsx",
);
const stylesSource = source("../../src/renderer/styles/styles.css");
const tokenUsagePageSource = source(
  "../../src/renderer/conversation/TokenUsagePage.tsx",
);

function sourceBetween(value: string, start: string, end: string): string {
  const startIndex = value.indexOf(start);
  const endIndex = value.indexOf(end, startIndex + start.length);
  expect(startIndex, `Missing source start: ${start}`).toBeGreaterThanOrEqual(
    0,
  );
  expect(endIndex, `Missing source end: ${end}`).toBeGreaterThan(startIndex);
  return value.slice(startIndex, endIndex);
}

function cssDeclarations(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = stylesSource.match(
    new RegExp(`${escaped}\\s*\\{(?<body>[^}]*)\\}`, "u"),
  );
  expect(match, `Missing CSS selector ${selector}`).not.toBeNull();
  return match?.groups?.body ?? "";
}

describe("reported issue regressions #70-#72", () => {
  it("keeps loading a conversation after switching away and restores its scroll state", () => {
    const historyLoad = sourceBetween(
      appSource,
      ".getThreadEvents(threadId)",
      "const activeEvents =",
    );

    expect(historyLoad).toContain("loadedEventThreads.current.add(threadId)");
    expect(historyLoad).not.toContain("if (!mounted) return");
    expect(appSource).toContain("timelineScrollSnapshots");
    expect(appSource).toContain("resolveTimelineScrollTarget");
  });

  it("limits plan hover intent to the capsule instead of its full-width row", () => {
    const root = sourceBetween(
      taskPlanPatternSource,
      "<div\n      {...attributes}",
      "<button\n        aria-controls={stepsId}",
    );
    const trigger = sourceBetween(
      taskPlanPatternSource,
      "<button\n        aria-controls={stepsId}",
      "</button>",
    );

    expect(root).not.toContain("onPointerEnter");
    expect(trigger).toContain("onPointerEnter={scheduleOpen}");
    expect(trigger).toContain("onPointerLeave={cancelScheduledOpen}");
    expect(cssDeclarations(".task-plan-progress")).toContain(
      "width: fit-content",
    );
    expect(taskPlanSource).toContain('className="task-plan-progress"');
  });

  it("keeps documented cache hit metrics alongside model token bars", () => {
    const summary = sourceBetween(
      tokenUsagePageSource,
      "const summary =",
      "const observations =",
    );
    const rows = sourceBetween(
      tokenUsagePageSource,
      'className="token-usage-model-bars"',
      'className="token-usage-details"',
    );
    expect(tokenUsagePageSource).not.toContain("<table");
    expect(rows).not.toContain("model.usageEvents");
    expect(rows).toContain("model.totalTokens");
    expect(summary).toContain("label: t.cacheHitRate");
    expect(summary).toContain("percent.format(cacheMetrics.hitRate)");
    expect(tokenUsagePageSource).toMatch(
      /title=\{\s*item.label === t.cacheHitRate\s*\? t.cacheHitRateDescription\s*: undefined\s*\}/u,
    );
  });
});
