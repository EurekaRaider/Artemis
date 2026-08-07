import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const appSource = readFileSync(
  fileURLToPath(new URL("../src/renderer/App.tsx", import.meta.url)),
  "utf8",
);
const tokenUsagePageSource = readFileSync(
  fileURLToPath(new URL("../src/renderer/TokenUsagePage.tsx", import.meta.url)),
  "utf8",
);
const stylesSource = readFileSync(
  fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url)),
  "utf8",
);
const apiSource = readFileSync(
  fileURLToPath(new URL("../src/shared/api.ts", import.meta.url)),
  "utf8",
);
const preloadSource = readFileSync(
  fileURLToPath(new URL("../src/preload/preload.ts", import.meta.url)),
  "utf8",
);
const mainSource = readFileSync(
  fileURLToPath(new URL("../src/main/main.ts", import.meta.url)),
  "utf8",
);

describe("token usage navigation", () => {
  it("places the Token Usage button immediately after MCP & Skills and opens its page", () => {
    const activityStart = appSource.indexOf('<aside className="activity-bar">');
    const activityEnd = appSource.indexOf("</aside>", activityStart);
    const activity = appSource.slice(activityStart, activityEnd);
    const resourceLabel = activity.indexOf("aria-label={t.resourceCenter}");
    const resourceButtonEnd =
      activity.indexOf("</button>", resourceLabel) + "</button>".length;
    const tokenLabel = activity.indexOf("aria-label={t.tokenUsage}");
    const tokenButtonStart = activity.lastIndexOf("<button", tokenLabel);

    expect(activityStart).toBeGreaterThan(-1);
    expect(activityEnd).toBeGreaterThan(activityStart);
    expect(resourceLabel).toBeGreaterThan(-1);
    expect(tokenLabel).toBeGreaterThan(resourceLabel);
    expect(activity.slice(resourceButtonEnd, tokenButtonStart).trim()).toBe("");
    expect(activity.slice(tokenButtonStart, tokenLabel)).toContain(
      'activeView === "token-usage"',
    );
    expect(activity.slice(tokenButtonStart, tokenLabel)).toContain(
      'setActiveView("token-usage")',
    );
    expect(appSource).toContain("<TokenUsagePage");
    expect(appSource).toContain('activeView === "token-usage"');
  });

  it("localizes the Token Usage activity button in English and Simplified Chinese", () => {
    expect(appSource).toContain('tokenUsage: "Token usage"');
    expect(appSource).toContain('tokenUsage: "Token 用量"');
    expect(appSource).toContain("title={t.tokenUsage}");
    expect(appSource).toContain("aria-label={t.tokenUsage}");
  });

  it("wires persisted token usage history through the isolated IPC API", () => {
    expect(apiSource).toContain(
      "getTokenUsageEvents(): Promise<AgentEvent[]>;",
    );
    expect(apiSource).toContain(
      'tokenUsageEvents: "artemis:token-usage-events"',
    );
    expect(preloadSource).toContain(
      "getTokenUsageEvents: () => ipcRenderer.invoke(IPC.tokenUsageEvents)",
    );
    expect(mainSource).toContain(
      "ipcMain.handle(IPC.tokenUsageEvents, () => {",
    );
    expect(mainSource).toContain("return store.getTokenUsageEvents();");
    expect(tokenUsagePageSource).toContain(
      "window.artemis\n      .getTokenUsageEvents()",
    );
  });

  it("shows the same cell tooltip from pointer hover and keyboard focus", () => {
    const cellClass = tokenUsagePageSource.indexOf(
      "className={`token-usage-cell",
    );
    const cellStart = tokenUsagePageSource.lastIndexOf("<button", cellClass);
    const cellEnd =
      tokenUsagePageSource.indexOf("</button>", cellClass) + "</button>".length;
    const cellSource = tokenUsagePageSource.slice(cellStart, cellEnd);

    expect(cellClass).toBeGreaterThan(-1);
    expect(cellStart).toBeGreaterThan(-1);
    expect(cellEnd).toBeGreaterThan(cellStart);
    expect(cellSource).toContain("onMouseEnter={() => setHovered(cell)}");
    expect(cellSource).toContain("onFocus={() => setHovered(cell)}");
    expect(cellSource).toContain("hovered?.date === cell.date");
    expect(cellSource).toContain('role="tooltip"');
    expect(stylesSource).toMatch(
      /\.token-usage-cell:hover,\s*\.token-usage-cell:focus-visible\s*\{(?=[^}]*\btransform:\s*scale\(1\.08\))(?=[^}]*\bz-index:\s*1)[^}]*\}/u,
    );
  });
});
