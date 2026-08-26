import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const source = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

const appSource = source("../src/renderer/App.tsx");
const taskPlanSource = source("../src/renderer/TaskPlanProgress.tsx");
const stylesSource = source("../src/renderer/styles.css");
const tokenUsagePageSource = source("../src/renderer/TokenUsagePage.tsx");

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
      taskPlanSource,
      'className="task-plan-progress"',
      "<button\n        aria-controls={detailsId}",
    );
    const trigger = sourceBetween(
      taskPlanSource,
      "<button\n        aria-controls={detailsId}",
      "</button>",
    );

    expect(root).not.toContain("onPointerEnter");
    expect(trigger).toContain("onPointerEnter={scheduleOpen}");
    expect(trigger).toContain("onPointerLeave={cancelScheduledOpen}");
    expect(cssDeclarations(".task-plan-progress")).toContain(
      "width: fit-content",
    );
  });

  it("replaces model response counts with a documented cache hit rate", () => {
    const header = sourceBetween(tokenUsagePageSource, "<thead>", "</thead>");
    const row = sourceBetween(
      tokenUsagePageSource,
      "{usageByModel.map((model) => (",
      "</tbody>",
    );

    expect(header).not.toContain("responsesColumn");
    expect(header).toContain("cacheHitRateDescription");
    expect(row).not.toContain("model.usageEvents");
    expect(row).toContain("model.cacheHitRate");
    expect(row).toContain("percent.format");
  });
});
