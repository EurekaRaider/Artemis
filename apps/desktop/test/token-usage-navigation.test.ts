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
// D#76 PR9B §2.7 migration: the heatmap cell markup now lives in
// TokenUsageHeatmap.tsx. The guarded read keeps the other suites green if
// the component file is temporarily absent.
const tokenUsageHeatmapSource = (() => {
  try {
    return readFileSync(
      fileURLToPath(
        new URL("../src/renderer/TokenUsageHeatmap.tsx", import.meta.url),
      ),
      "utf8",
    );
  } catch {
    return "";
  }
})();
const publicDataSource = readFileSync(
  fileURLToPath(new URL("../../../packages/ui/src/data.tsx", import.meta.url)),
  "utf8",
);
const publicUiStylesSource = readFileSync(
  fileURLToPath(
    new URL("../../../packages/ui/src/styles.css", import.meta.url),
  ),
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
const navigationVerifierSource = readFileSync(
  fileURLToPath(
    new URL("../scripts/verify-navigation-controls.mjs", import.meta.url),
  ),
  "utf8",
);

describe("token usage navigation", () => {
  it("uses public Tabs with exact tab-panel relations for the three usage views", () => {
    expect(tokenUsagePageSource).toContain(
      'import { Tabs } from "@artemis/ui/navigation";',
    );
    expect(tokenUsagePageSource).toContain("<Tabs");
    expect(tokenUsagePageSource).toContain("label={t.activity}");
    expect(tokenUsagePageSource).toContain(
      "id: `token-usage-${candidate}-tab`",
    );
    expect(tokenUsagePageSource).toContain(
      "panelId: `token-usage-${candidate}-panel`",
    );
    expect(tokenUsagePageSource).toContain('role="tabpanel"');
    expect(tokenUsagePageSource).toContain(
      "aria-labelledby={`token-usage-${candidate}-tab`}",
    );
    expect(tokenUsagePageSource).toContain("TOKEN_USAGE_VIEWS.map((candidate)");
    expect(tokenUsagePageSource).toContain("hidden={candidate !== view}");
    expect(tokenUsagePageSource).toContain(
      "id={`token-usage-${candidate}-panel`}",
    );
    expect(tokenUsagePageSource).toContain("candidate === view ? (");
  });

  it("binds production navigation evidence to its exact head and live renderer security", () => {
    expect(navigationVerifierSource).toContain(
      'const candidateHead = runGit(["rev-parse", "HEAD"]);',
    );
    expect(navigationVerifierSource).toContain(
      'const completedHead = runGit(["rev-parse", "HEAD"]);',
    );
    expect(navigationVerifierSource).toContain(
      'runGit(["status", "--porcelain"])',
    );
    expect(navigationVerifierSource).toContain("ARTEMIS_EXPECTED_HEAD");
    expect(navigationVerifierSource).toContain('"renderer-runtime-security"');
    expect(navigationVerifierSource).toContain('"renderer-console-clean"');
    expect(navigationVerifierSource).toContain("button.controlledPanel?.id");
    expect(preloadSource).toContain("process.contextIsolated === true");
    expect(preloadSource).toContain("process.sandboxed === true");
    expect(mainSource).toContain('window.webContents.on("console-message"');
    expect(mainSource).toContain("processType: typeof globalThis.process");
    expect(mainSource).toContain("requireType: typeof globalThis.require");

    const focusEvidenceStart = mainSource.indexOf("const focusEvidenceView =");
    const readyToShowEnd = mainSource.indexOf(
      'window.on("unresponsive"',
      focusEvidenceStart,
    );
    const focusEvidenceSetup = mainSource.slice(
      focusEvidenceStart,
      readyToShowEnd,
    );
    const focusBranchEnd = focusEvidenceSetup.indexOf("} else {");
    const focusBranch = focusEvidenceSetup.slice(0, focusBranchEnd);
    expect(focusEvidenceStart).toBeGreaterThan(-1);
    expect(readyToShowEnd).toBeGreaterThan(focusEvidenceStart);
    expect(focusBranchEnd).toBeGreaterThan(-1);
    expect(focusEvidenceSetup).toContain('view === "navigation-token-usage"');
    expect(focusEvidenceSetup).toContain(
      'view === "markdown-editor-navigation-toolbar"',
    );
    expect(focusEvidenceSetup).toContain(
      'view === "markdown-editor-navigation-preview"',
    );
    expect(focusBranch).toContain("window.center()");
    expect(focusBranch).toContain("window.show()");
    expect(focusBranch).not.toContain("window.showInactive()");
  });

  it("places the Token Usage button immediately after MCP & Skills and opens its page", () => {
    const activityStart = appSource.indexOf("<ActivityBar");
    const activityEnd = appSource.indexOf("</ActivityBar>", activityStart);
    const activity = appSource.slice(activityStart, activityEnd);
    const resourceLabel = activity.indexOf("label={t.resourceCenter}");
    const resourceButtonEnd =
      activity.indexOf("/>", resourceLabel) + "/>".length;
    const tokenLabel = activity.indexOf("label={t.tokenUsage}");
    const tokenButtonStart = activity.lastIndexOf(
      "<ActivityBarItem",
      tokenLabel,
    );
    const tokenButtonEnd = activity.indexOf("/>", tokenLabel) + "/>".length;
    const tokenButton = activity.slice(tokenButtonStart, tokenButtonEnd);

    expect(activityStart).toBeGreaterThan(-1);
    expect(activityEnd).toBeGreaterThan(activityStart);
    expect(resourceLabel).toBeGreaterThan(-1);
    expect(tokenLabel).toBeGreaterThan(resourceLabel);
    expect(activity.slice(resourceButtonEnd, tokenButtonStart).trim()).toBe("");
    expect(tokenButton).toContain('activeView === "token-usage"');
    expect(tokenButton).toContain('setActiveView("token-usage")');
    expect(appSource).toContain("<TokenUsagePage");
    expect(appSource).toContain('activeView === "token-usage"');
  });

  it("localizes the Token Usage activity button in English and Simplified Chinese", () => {
    expect(appSource).toContain('tokenUsage: "Token usage"');
    expect(appSource).toContain('tokenUsage: "Token 用量"');
    expect(appSource).toContain("title={t.tokenUsage}");
    expect(appSource).toContain("label={t.tokenUsage}");
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
    expect(tokenUsageHeatmapSource).toContain("<DataHeatmap");
    expect(tokenUsageHeatmapSource).toContain(
      "onActiveCellChange={(cellId) =>",
    );
    expect(publicDataSource).toContain("onMouseEnter={() => {");
    expect(publicDataSource).toContain("onFocus={() => {");
    expect(publicDataSource).toContain(
      "if (!disabled) onActiveCellChange(cell.id);",
    );
    expect(publicDataSource).toContain('role="tooltip"');
    expect(publicUiStylesSource).toMatch(
      /\[data-artemis-component="data-heatmap"\][\s\S]*?\[data-part="cell"\]:is\(:hover, :focus-visible\)\s*\{(?=[^}]*\btransform:\s*scale\(1\.08\))(?=[^}]*\bz-index:\s*1)[^}]*\}/u,
    );
    expect(stylesSource).toMatch(
      /\.token-usage-activity\s*\{(?=[^}]*\binline-size:\s*100%;)(?=[^}]*\bmin-inline-size:\s*0;)[^}]*\}/u,
    );
  });
});
