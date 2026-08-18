import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { contextMenuLayout } from "../src/renderer/ComposerContextBar.js";

const appSource = readFileSync(
  fileURLToPath(new URL("../src/renderer/App.tsx", import.meta.url)),
  "utf8",
);
const composerContextSource = readFileSync(
  fileURLToPath(
    new URL("../src/renderer/ComposerContextBar.tsx", import.meta.url),
  ),
  "utf8",
);
const automationPageSource = readFileSync(
  fileURLToPath(new URL("../src/renderer/AutomationPage.tsx", import.meta.url)),
  "utf8",
);
const archivePageSource = readFileSync(
  fileURLToPath(new URL("../src/renderer/ArchivePage.tsx", import.meta.url)),
  "utf8",
);
const stylesSource = readFileSync(
  fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url)),
  "utf8",
);
const settingsSource = readFileSync(
  fileURLToPath(new URL("../src/renderer/SettingsPanel.tsx", import.meta.url)),
  "utf8",
);
const resourceCenterSource = readFileSync(
  fileURLToPath(new URL("../src/renderer/ResourceCenter.tsx", import.meta.url)),
  "utf8",
);
const resourceIconsSource = readFileSync(
  fileURLToPath(new URL("../src/renderer/resource-icons.tsx", import.meta.url)),
  "utf8",
);
const mcpServerEditorSource = readFileSync(
  fileURLToPath(
    new URL("../src/renderer/McpServerEditor.tsx", import.meta.url),
  ),
  "utf8",
);
const apiSource = readFileSync(
  fileURLToPath(new URL("../src/shared/api.ts", import.meta.url)),
  "utf8",
);
const browserLocaleSource = readFileSync(
  fileURLToPath(new URL("../src/shared/browser-locale.ts", import.meta.url)),
  "utf8",
);
const preloadSource = readFileSync(
  fileURLToPath(new URL("../src/preload/preload.ts", import.meta.url)),
  "utf8",
);
const terminalSource = readFileSync(
  fileURLToPath(new URL("../src/renderer/TerminalPanel.tsx", import.meta.url)),
  "utf8",
);
const workspacePreviewSource = readFileSync(
  fileURLToPath(
    new URL("../src/renderer/WorkspacePreviewPanel.tsx", import.meta.url),
  ),
  "utf8",
);
const workspaceFilesSource = readFileSync(
  fileURLToPath(
    new URL("../src/renderer/WorkspaceFilesPanel.tsx", import.meta.url),
  ),
  "utf8",
);
const mainProcessSource = readFileSync(
  fileURLToPath(new URL("../src/main/main.ts", import.meta.url)),
  "utf8",
);
const rendererHtmlSource = readFileSync(
  fileURLToPath(new URL("../index.html", import.meta.url)),
  "utf8",
);
const runtimeSource = readFileSync(
  fileURLToPath(
    new URL("../../../packages/agent-host/src/runtime.ts", import.meta.url),
  ),
  "utf8",
);
const agentProcessSource = readFileSync(
  fileURLToPath(new URL("../src/main/agent-process.ts", import.meta.url)),
  "utf8",
);
const macPackageScriptPath = fileURLToPath(
  new URL("../scripts/package-mac-lite.mjs", import.meta.url),
);
const macPackageScriptSource = readFileSync(macPackageScriptPath, "utf8");
const windowsPackageScriptSource = readFileSync(
  fileURLToPath(
    new URL("../scripts/package-windows-lite.mjs", import.meta.url),
  ),
  "utf8",
);
const engineeringBuilderSource = readFileSync(
  fileURLToPath(
    new URL("../scripts/engineering-builder.config.cjs", import.meta.url),
  ),
  "utf8",
);
const releaseBuilderSource = readFileSync(
  fileURLToPath(
    new URL("../scripts/release-builder.config.cjs", import.meta.url),
  ),
  "utf8",
);
const bundledMarketplaceSource = readFileSync(
  fileURLToPath(
    new URL(
      "../resources/bundled-artifact-plugins/.agents/plugins/marketplace.json",
      import.meta.url,
    ),
  ),
  "utf8",
);
const taskPlanSource = readFileSync(
  fileURLToPath(
    new URL("../src/renderer/TaskPlanProgress.tsx", import.meta.url),
  ),
  "utf8",
);
const codexSelectSource = readFileSync(
  fileURLToPath(new URL("../src/renderer/CodexSelect.tsx", import.meta.url)),
  "utf8",
);
const skillCommandsSource = readFileSync(
  fileURLToPath(new URL("../src/renderer/skill-commands.ts", import.meta.url)),
  "utf8",
);
const promptHistorySource = readFileSync(
  fileURLToPath(new URL("../src/renderer/prompt-history.ts", import.meta.url)),
  "utf8",
);
const toolActivityGroupsSource = readFileSync(
  fileURLToPath(
    new URL("../src/renderer/tool-activity-groups.ts", import.meta.url),
  ),
  "utf8",
);
const desktopPackage = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../package.json", import.meta.url)),
    "utf8",
  ),
) as {
  scripts: Record<string, string>;
  build: {
    extraResources: Array<{ from: string; to: string }>;
    mac: {
      icon?: string;
      target: Array<{ target: string; arch: string[] }>;
    };
  };
};
const rootPackage = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../../package.json", import.meta.url)),
    "utf8",
  ),
) as { scripts: Record<string, string> };
const appIconSource = readFileSync(
  fileURLToPath(new URL("../build/icon.png", import.meta.url)),
);
const composerIconSource = readFileSync(
  fileURLToPath(
    new URL(
      "../build/icon.icon/Assets/ArtemisForeground-v2.png",
      import.meta.url,
    ),
  ),
);
const composerIconManifest = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../build/icon.icon/icon.json", import.meta.url)),
    "utf8",
  ),
) as {
  groups?: Array<{ layers?: Array<{ "image-name"?: string }> }>;
  "supported-platforms"?: { squares?: string[] };
};

function cssRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = stylesSource.match(
    new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, "u"),
  );
  expect(match, `Missing CSS rule for ${selector}`).not.toBeNull();
  return match?.[1] ?? "";
}

function cssAtRule(pattern: RegExp): string | undefined {
  const match = pattern.exec(stylesSource);
  if (!match) return undefined;
  const openBrace = stylesSource.indexOf("{", match.index);
  if (openBrace < 0) return undefined;
  let depth = 1;
  for (let index = openBrace + 1; index < stylesSource.length; index += 1) {
    if (stylesSource[index] === "{") depth += 1;
    if (stylesSource[index] === "}") depth -= 1;
    if (depth === 0) return stylesSource.slice(openBrace + 1, index);
  }
  return undefined;
}

function cssDeclarationsForSelector(selector: string): string | undefined {
  const rules = stylesSource.matchAll(
    /(?<selectors>[^{}]+)\{(?<declarations>[^{}]*)\}/gu,
  );
  for (const rule of rules) {
    const selectors =
      rule.groups?.selectors.split(",").map((item) => item.trim()) ?? [];
    if (selectors.includes(selector)) {
      return rule.groups?.declarations;
    }
  }
  return undefined;
}

function hexProperty(declarations: string, property: string): string {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const value = declarations.match(
    new RegExp(`\\b${escaped}:\\s*["']?(?<value>#[\\da-f]{6})`, "iu"),
  )?.groups?.value;
  expect(value, `Missing ${property} hex color`).toBeDefined();
  return value!;
}

function relativeLuminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/[\da-f]{2}/giu)!
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    );
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrastRatio(first: string, second: string): number {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("renderer layout contract", () => {
  it("offers Plan, Execute, and Review in that order", () => {
    const plan = composerContextSource.indexOf(
      '{ value: "plan", label: t.plan }',
    );
    const execute = composerContextSource.indexOf(
      '{ value: "execute", label: t.execute }',
    );
    const review = composerContextSource.indexOf(
      '{ value: "review", label: t.review }',
    );
    expect(plan).toBeGreaterThan(-1);
    expect(execute).toBeGreaterThan(plan);
    expect(review).toBeGreaterThan(execute);
    expect(automationPageSource).toContain(
      '["plan", "execute", "review"] as const',
    );
    expect(runtimeSource).toContain('name: "office_document"');
    expect(runtimeSource).toContain("hosted.executeTools");
  });

  it("scrolls the timeline inside the conversation instead of the document", () => {
    expect(appSource).toContain('className="timeline-scroll"');
    expect(appSource).not.toContain("scrollIntoView");
  });

  it("keeps the workspace and conversation height-constrained", () => {
    expect(cssRule(".workspace")).toMatch(/\bheight:\s*100%/u);
    expect(cssRule(".workspace")).toMatch(/\boverflow:\s*hidden/u);
    expect(cssRule(".workspace-content")).toMatch(/\boverflow:\s*hidden/u);
    expect(cssRule(".conversation")).toMatch(/\bmin-height:\s*0/u);
    expect(cssRule(".conversation")).toMatch(/\boverflow:\s*hidden/u);
  });

  it("reserves a draggable macOS title-bar area above the app content", () => {
    expect(appSource).toContain("data-platform={snapshot.platform}");
    expect(mainProcessSource).toContain(
      'titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default"',
    );

    const macShell = cssRule('.app-shell[data-platform="darwin"]');
    expect(macShell).toMatch(/\bpadding-top:\s*28px/u);
    expect(macShell).toMatch(/\bposition:\s*relative/u);

    const dragRegion = cssRule('.app-shell[data-platform="darwin"]::before');
    expect(dragRegion).toMatch(/-webkit-app-region:\s*drag/u);
    expect(dragRegion).toMatch(/\bheight:\s*28px/u);
    expect(dragRegion).toMatch(/\bposition:\s*absolute/u);
  });

  it("uses an Icon Composer asset without a packaged PNG Dock override", () => {
    expect(mainProcessSource).toContain("function applyMacDockIcon()");
    expect(mainProcessSource).toContain('process.platform !== "darwin"');
    expect(mainProcessSource).toContain("app.isPackaged");
    expect(mainProcessSource).toContain("app.dock?.setIcon(iconPath)");
    expect(mainProcessSource).not.toContain(
      'join(process.resourcesPath, "icon.png")',
    );
    expect(desktopPackage.build.mac.icon).toBe("build/icon.icon");
    expect(desktopPackage.build.extraResources).not.toContainEqual({
      from: "build/icon.png",
      to: "icon.png",
    });
    expect(composerIconManifest["supported-platforms"]?.squares).toEqual([
      "macOS",
    ]);
    expect(composerIconManifest.groups?.[0]?.layers?.[0]?.["image-name"]).toBe(
      "ArtemisForeground-v2.png",
    );
    expect(composerIconSource.equals(appIconSource)).toBe(false);
  });

  it("makes the timeline container independently scrollable", () => {
    const rule = cssRule(".timeline-scroll");

    expect(rule).toMatch(/\bmin-height:\s*0/u);
    expect(rule).toMatch(/\boverflow-y:\s*auto/u);
  });

  it("keeps the composer in a fixed layout row instead of a sticky overlay", () => {
    const composer = cssRule(".composer-wrap");
    const conversation = cssRule(".conversation");

    expect(composer).not.toMatch(/\bposition:\s*sticky/u);
    expect(`${composer}\n${conversation}`).toMatch(
      /\bflex:\s*0\s+0\s+auto|\bgrid-template-rows:\s*minmax\(0,\s*1fr\)\s+auto/u,
    );
  });

  it("places transient notices above the composer without covering the task-step capsule", () => {
    const composerStart = appSource.indexOf('<div className="composer-wrap">');
    const taskPlanIndex = appSource.indexOf("<TaskPlanProgress", composerStart);
    const noticeIndex = appSource.indexOf("<TransientNotice", taskPlanIndex);
    const contextIndex = appSource.indexOf("<ComposerContextBar", noticeIndex);

    expect(taskPlanIndex).toBeGreaterThan(composerStart);
    expect(noticeIndex).toBeGreaterThan(taskPlanIndex);
    expect(contextIndex).toBeGreaterThan(noticeIndex);
    expect(appSource).toContain("const TOAST_VISIBLE_MILLISECONDS = 10_000;");
    expect(appSource).toContain("const TOAST_FADE_MILLISECONDS = 600;");
    expect(appSource).toContain("setToastState((current) =>");
    expect(appSource).toContain("fading: true");
    expect(cssRule(".composer-notice")).not.toMatch(
      /\bposition:\s*(?:fixed|absolute)/u,
    );
    expect(cssRule(".transient-notice")).toMatch(
      /\btransition:[\s\S]*\bopacity\s+600ms\s+ease/u,
    );
    expect(cssRule(".transient-notice.fading")).toMatch(/\bopacity:\s*0/u);
    expect(stylesSource).not.toMatch(/\.toast\s*\{[^}]*\bbottom:/su);
  });

  it("lets the active projects button restore a collapsed sidebar", () => {
    expect(appSource).toContain('activeView === "workspace"');
    expect(appSource).toContain('setActiveView("workspace")');
    expect(appSource).toContain("setSidebarOpen(true)");
  });

  it("keeps settings as the final activity action without the obsolete command menu", () => {
    const activityBarStart = appSource.indexOf(
      '<aside className="activity-bar">',
    );
    const activityBarEnd = appSource.indexOf("</aside>", activityBarStart);
    const activityBarSource = appSource.slice(activityBarStart, activityBarEnd);
    const settingsLabelIndex = activityBarSource.indexOf(
      "aria-label={t.settings}",
    );
    const settingsButtonStart = activityBarSource.lastIndexOf(
      "<button",
      settingsLabelIndex,
    );
    const settingsButtonEnd =
      activityBarSource.indexOf("</button>", settingsLabelIndex) +
      "</button>".length;
    const settingsButtonSource = activityBarSource.slice(
      settingsButtonStart,
      settingsButtonEnd,
    );
    const settingsIconStart = appSource.indexOf("function SettingsIcon()");
    const settingsIconEnd = appSource.indexOf(
      "function ReviewIcon()",
      settingsIconStart,
    );
    const settingsIconSource = appSource.slice(
      settingsIconStart,
      settingsIconEnd,
    );
    const sidebarFooterStart = appSource.indexOf('className="sidebar-footer"');
    const sidebarFooterEnd = appSource.indexOf("</aside>", sidebarFooterStart);
    const sidebarFooterSource = appSource.slice(
      sidebarFooterStart,
      sidebarFooterEnd,
    );

    expect(activityBarStart).toBeGreaterThan(-1);
    expect(activityBarEnd).toBeGreaterThan(activityBarStart);
    expect(settingsLabelIndex).toBeGreaterThan(-1);
    expect(settingsButtonSource).toContain("<SettingsIcon />");
    expect(activityBarSource.slice(settingsButtonEnd).trim()).toBe("");
    expect(activityBarSource).not.toContain("t.commandMenu");
    expect(appSource).not.toContain("commandMenuOpen");
    expect(appSource).not.toContain('className="command-backdrop"');
    expect(stylesSource).not.toContain(".command-backdrop");
    expect(settingsIconSource).toContain("<Icon size={17}>");
    expect(settingsIconSource).toContain("<path");
    expect(settingsIconSource).toContain("<circle");
    expect(sidebarFooterStart).toBeGreaterThan(-1);
    expect(sidebarFooterEnd).toBeGreaterThan(sidebarFooterStart);
    expect(sidebarFooterSource).not.toContain('className="avatar-button"');
    expect(sidebarFooterSource).not.toContain("setSettingsOpen(true)");
    expect(sidebarFooterSource).not.toMatch(/>\s*TS\s*</u);
  });

  it("preserves the former command menu actions through their existing entry points", () => {
    expect(appSource).toContain("onClick={() => void openProject()}");
    expect(appSource).toContain('selectComposerCommand("/goal ")');
    expect(appSource).toContain("onClick={openReviewPanel}");
    expect(appSource).toContain("onClick={openTerminalPanel}");
    expect(appSource).toContain("toggleReviewPanel();");
    expect(appSource).toContain("toggleTerminalPanel();");
  });

  it("shows the current version in the sidebar footer and opens update settings", () => {
    const sidebarFooterStart = appSource.indexOf(
      '<div className="sidebar-footer">',
    );
    const sidebarFooterEnd = appSource.indexOf("</div>", sidebarFooterStart);
    const sidebarFooterSource = appSource.slice(
      sidebarFooterStart,
      sidebarFooterEnd,
    );

    expect(sidebarFooterStart).toBeGreaterThan(-1);
    expect(sidebarFooterEnd).toBeGreaterThan(sidebarFooterStart);
    expect(sidebarFooterSource).toContain('className="app-version"');
    expect(sidebarFooterSource).toContain(
      "runtimeSettings?.update.currentVersion",
    );
    expect(sidebarFooterSource).toContain('openSettings("maintenance")');
    expect(sidebarFooterSource).toContain(
      "v{runtimeSettings.update.currentVersion}",
    );
    expect(appSource).toContain("initialTab={settingsTab}");
    expect(settingsSource).toContain('initialTab = "general"');
    expect(settingsSource).toContain("useState<SettingsTab>(initialTab)");
    expect(cssRule(".app-version")).toMatch(/\bfont-size:\s*11px/u);
    expect(cssRule(".app-version")).toMatch(/\bcolor:\s*var\(--muted-2\)/u);
    expect(cssRule(".app-version")).toMatch(/\bbackground:\s*transparent/u);
    expect(cssRule(".sidebar-footer")).toContain("padding: 0 11px 6px 14px");
  });

  it("keeps archived conversations out of the task sidebar and opens them from a library", () => {
    expect(appSource).toContain(
      "thread.projectId === project.id && !thread.archived",
    );
    expect(appSource).toContain("<ArchivePage");
    expect(appSource).toContain('activeView === "archive"');
    expect(appSource).toContain("setThreadArchived(thread, false)");
    expect(archivePageSource).toContain('className="archive-panel"');
    expect(archivePageSource).toContain('className="archive-header"');
    expect(archivePageSource).toContain('className="archive-search"');
    expect(archivePageSource).toContain('className="archive-empty"');
    expect(archivePageSource).not.toContain('className="library-hero"');
    expect(cssRule(".archive-page")).toContain(
      "background: var(--codex-workspace-bg)",
    );
    expect(cssRule(".archive-panel")).toContain("border-radius: 14px");
    expect(cssRule(".archive-results")).toContain(
      "border: 1px solid var(--border)",
    );
    expect(cssRule(".archive-empty")).not.toContain("border: 1px dashed");
  });

  it("keeps projectless temporary conversations visible and composable", () => {
    expect(appSource).toContain(
      'className="project-group temporary-conversations"',
    );
    expect(appSource).toContain("!thread.projectId && !thread.archived");
    expect(appSource).toContain("beginTemporaryConversation");
    expect(appSource).toContain("{!activeThread?.archived && (");
    expect(appSource).not.toContain(
      "{activeProject && !activeThread?.archived && (",
    );
    expect(appSource).toContain("if (!activeProjectId) return;");
    expect(appSource).toContain("...(activeProject");
    expect(appSource).toContain("{activeProject && (");
    expect(archivePageSource).toContain("t.temporary");
  });

  it("routes composer model changes to only the selected conversation", () => {
    expect(appSource).toContain("window.artemis.setThreadModelSelection(");
    expect(appSource).toContain(
      "activeThread?.modelSelection ?? runtimeSettings?.selection",
    );
    expect(apiSource).toContain("setThreadModelSelection(");
    expect(preloadSource).toContain("IPC.threadModelSet");
    expect(mainProcessSource).toContain('type: "thread.model.set"');
    expect(runtimeSource).toContain("async setThreadModel(");
  });

  it("exposes MCP, Skills, and persistent task goals as first-class navigation", () => {
    expect(appSource).toContain("<ResourceCenter");
    expect(appSource).toContain('activeView === "resources"');
    expect(appSource).toContain('selectComposerCommand("/goal ")');
    expect(appSource).toContain("window.artemis.setThreadGoal");
  });

  it("gives every project a removable sidebar action", () => {
    expect(appSource).toContain('className="project-action"');
    expect(appSource).toContain("removeProject(project)");
    expect(appSource).toContain('className="project-menu"');
  });

  it("uses a Codex-style context strip and compact composer toolbar", () => {
    const contextIndex = appSource.indexOf("<ComposerContextBar");
    const composerIndex = appSource.indexOf('className="composer"');

    expect(contextIndex).toBeGreaterThan(-1);
    expect(composerIndex).toBeGreaterThan(contextIndex);
    expect(appSource).toContain('className="composer-leading"');
    expect(appSource).toContain('className="composer-trailing"');
    expect(appSource).toContain("selectPromptAttachments()");
    expect(appSource).toContain('className="composer-attachments"');
    expect(cssRule(".composer-context")).toMatch(/\bdisplay:\s*flex/u);
    expect(cssRule(".composer-context-trigger")).toMatch(
      /\bmax-width:\s*100%[\s\S]*\boverflow:\s*hidden[\s\S]*\bwidth:\s*100%/u,
    );
    expect(cssRule(".composer-context-picker")).toMatch(
      /\bflex:\s*0\s+0\s+auto/u,
    );
    expect(cssRule(".composer-context-picker .codex-select-menu")).toMatch(
      /\bleft:\s*auto[\s\S]*\bright:\s*0/u,
    );
    expect(cssRule(".composer-context-menu")).toMatch(
      /\bdisplay:\s*flex[\s\S]*\bwidth:\s*min\(350px,\s*calc\(100cqi\s*-\s*64px\)\)/u,
    );
    expect(cssRule(".composer-wrap")).toMatch(/\bz-index:\s*20/u);
    expect(composerContextSource).toContain(
      "new ResizeObserver(updateMenuLayout)",
    );
    expect(composerContextSource).toContain("focus({ preventScroll: true })");
    expect(composerContextSource).toContain("conversation.scrollLeft = 0");
    expect(cssRule(".composer")).toMatch(/\bborder-radius:\s*18px/u);
    expect(cssRule(".composer")).toContain("border: 1px solid var(--border)");
    expect(cssRule(".composer-context")).toContain("margin: 0 20px 1px");
  });

  it("keeps context menus inside the resized conversation", () => {
    expect(contextMenuLayout(260, 0, 500)).toEqual({
      left: 0,
      maxHeight: 484,
      width: 260,
    });
    expect(contextMenuLayout(260, 120, 500)).toEqual({
      left: -120,
      maxHeight: 484,
      width: 260,
    });
    expect(contextMenuLayout(500, 400, 500)).toEqual({
      left: -250,
      maxHeight: 484,
      width: 350,
    });
  });

  it("keeps the task mode select from scrolling the conversation", () => {
    expect(codexSelectSource).toContain("focus({ preventScroll: true })");
    expect(codexSelectSource).toContain("scrollOptionIntoListbox(");
    expect(codexSelectSource).not.toContain(".scrollIntoView(");
    expect(codexSelectSource).toContain("conversation.scrollLeft = 0");
    expect(codexSelectSource).toContain("conversation.scrollTop = 0");
  });

  it("keeps fixed composer controls and the trailing send action visible in a narrow workspace", () => {
    const composerStart = appSource.indexOf('className="composer-toolbar"');
    const composerEnd = appSource.indexOf(
      'className="workspace-tool-dock"',
      composerStart,
    );
    const composerSource = appSource.slice(composerStart, composerEnd);

    expect(composerStart).toBeGreaterThan(-1);
    expect(composerEnd).toBeGreaterThan(composerStart);
    expect(composerSource.indexOf('className="composer-leading"')).toBeLessThan(
      composerSource.indexOf('className="composer-trailing"'),
    );
    expect(composerSource.indexOf("<ContextUsageIndicator")).toBeLessThan(
      composerSource.indexOf('className="model-button"'),
    );
    expect(composerSource.indexOf('className="model-button"')).toBeLessThan(
      composerSource.indexOf('className="send-button'),
    );

    expect(cssRule(".conversation")).toMatch(
      /\bcontainer-type:\s*inline-size/u,
    );
    expect(cssRule(".composer-trailing")).toMatch(/\bflex:\s*0\s+0\s+auto/u);
    expect(cssRule(".composer-trailing")).toMatch(/\bmargin-left:\s*auto/u);
    expect(stylesSource).toMatch(
      /\.composer-icon-button,\s*\.context-usage-indicator,\s*\.send-button,\s*\.run-actions\s*\{[^}]*\bflex:\s*0\s+0\s+auto/isu,
    );
  });

  it("keeps the model controls visually balanced with the compact Codex proportions", () => {
    expect(cssRule(".composer-trailing")).toMatch(/\bgap:\s*4px/u);
    expect(cssRule(".context-usage-indicator")).toMatch(/\bwidth:\s*24px/u);
    expect(cssRule(".context-usage-ring")).toMatch(
      /\bheight:\s*14px[\s\S]*\bwidth:\s*14px/u,
    );
    expect(cssRule(".model-button")).toMatch(
      /\bheight:\s*28px[\s\S]*\bpadding:\s*0\s+4px\s+0\s+6px/u,
    );
    expect(cssRule(".model-information strong")).toMatch(
      /\bfont-size:\s*14px[\s\S]*\bfont-weight:\s*400/u,
    );
    expect(cssRule(".model-information small")).toMatch(/\bfont-size:\s*13px/u);
    expect(cssRule(".send-button")).toMatch(
      /\bborder-radius:\s*50%[\s\S]*\bheight:\s*28px[\s\S]*\bwidth:\s*28px/u,
    );
  });

  it("compacts verbose approval and model labels only at narrow composer width", () => {
    const compactComposer = cssAtRule(/@container\s*\(max-width:\s*\d+px\)/u);

    expect(compactComposer).toBeDefined();
    expect(compactComposer).toMatch(
      /\.approval-policy-trigger\s*>\s*span\s*\{[^}]*\bdisplay:\s*none/isu,
    );
    expect(compactComposer).toMatch(
      /\.model-information\s+small\s*\{[^}]*\bdisplay:\s*none/isu,
    );
    expect(compactComposer).toMatch(
      /\.model-information\s+strong\s*\{[^}]*\bmax-width:\s*\d+px[^}]*\boverflow:\s*hidden/isu,
    );
    expect(compactComposer).toMatch(
      /\.model-compact-icon\s*\{[^}]*\bdisplay:\s*(?:inline-)?flex/isu,
    );
    expect(compactComposer).toMatch(
      /\.model-information\s*\{[^}]*\bdisplay:\s*none/isu,
    );
    expect(compactComposer).toMatch(
      /\.model-picker-menu\s*\{[^}]*\bgrid-template-columns:\s*minmax\(0,\s*1fr\)[^}]*\bwidth:\s*min\(320px,\s*calc\(100cqi\s*-\s*48px\)\)/isu,
    );
    expect(compactComposer).toMatch(
      /\.model-picker-navigation\s*\{[^}]*\balign-self:\s*stretch[^}]*\bgrid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/isu,
    );
    expect(compactComposer).toMatch(
      /\.model-picker-options\s*\{[^}]*\bmargin-left:\s*0[^}]*\bmargin-top:\s*-1px/isu,
    );

    const composerStart = appSource.indexOf('className="composer-toolbar"');
    const composerEnd = appSource.indexOf(
      "\n                      </div>\n                    </div>",
      composerStart,
    );
    const composerSource = appSource.slice(composerStart, composerEnd);
    expect(composerSource).toContain("<span>{approvalPolicyLabel}</span>");
    expect(composerSource).toContain('className="model-information"');
    expect(composerSource).toContain('className="model-compact-icon"');
    expect(composerSource).toContain("<strong>{activeModelLabel}</strong>");
    expect(composerSource).toContain("<small>{activeThinkingLevel}</small>");
  });

  it("uses a compact Codex-style slash menu and keeps selected Skills visible", () => {
    expect(appSource).toContain(".listInstalledSkills()");
    expect(appSource).toContain(".listCodexPlugins()");
    expect(appSource).toContain('className="slash-command-menu"');
    expect(appSource).toContain("ref={slashCommandMenu}");
    expect(appSource).toContain("installedPluginBySkillName");
    expect(appSource).toContain("plugin.iconDataUrl");
    expect(appSource).toContain("menu.scrollTop =");
    expect(appSource).toContain('role="listbox"');
    expect(appSource).toContain('aria-autocomplete="list"');
    expect(appSource).toContain("{t.initCommand}");
    expect(appSource).toContain('selectComposerCommand("/init")');
    expect(appSource).toContain("{t.compactCommand}");
    expect(appSource).toContain('selectComposerCommand("/compact")');
    expect(appSource).toContain('className="composer-selected-skill"');
    expect(appSource).toContain("selectedComposerSkillNames");
    expect(appSource).toContain('replaceActiveSlashCommand(current, "")');
    expect(appSource).toContain("promptWithSelectedSkills(");
    expect(appSource).toContain('className="composer-selected-skill-remove"');
    expect(appSource).toContain("selectedSkills.length === 0");
    expect(appSource).toContain("unavailablePluginSkillNames");
    expect(appSource).toContain("<strong>{skill.name}</strong>");
    expect(appSource).not.toContain(
      "<strong>{`/skill:${skill.name}`}</strong>",
    );
    expect(skillCommandsSource).toContain("skill.enabled");
    expect(skillCommandsSource).toContain("`/skill:${skill.name} `");
    expect(cssRule(".slash-command-menu")).toMatch(/\boverflow-y:\s*auto/u);
    expect(cssRule(".slash-command-menu")).toMatch(/\bmax-height:\s*286px/u);
    expect(cssRule(".slash-command-menu")).toMatch(/\bposition:\s*absolute/u);
    expect(cssRule(".slash-command-menu")).toMatch(
      /\bbottom:\s*calc\(100%\s*\+\s*10px\)/u,
    );
    expect(cssRule(".slash-command-suggestion")).toMatch(/\bborder:\s*0/u);
    expect(cssRule(".slash-command-suggestion")).toMatch(
      /\bmin-height:\s*42px/u,
    );
    expect(cssRule(".slash-command-suggestion > span:last-child")).toMatch(
      /\bflex-direction:\s*row/u,
    );
    expect(cssRule(".slash-command-suggestion > span:last-child")).toMatch(
      /\bjustify-content:\s*space-between/u,
    );
    expect(cssRule(".slash-command-icon.plugin-icon img")).toMatch(
      /\bobject-fit:\s*contain/u,
    );
  });

  it("loads persisted prompt history and navigates it with arrow keys", () => {
    expect(apiSource).toContain("getPromptHistory(): Promise<string[]>");
    expect(preloadSource).toContain(
      "getPromptHistory: () => ipcRenderer.invoke(IPC.promptHistory)",
    );
    expect(mainProcessSource).toContain("store.listPromptHistory()");
    expect(appSource).toContain(".getPromptHistory()");
    expect(appSource).toContain('event.key === "ArrowUp"');
    expect(appSource).toContain('event.key === "ArrowDown"');
    expect(appSource).toContain("navigatePromptHistory(");
    expect(promptHistorySource).toContain("state.draft");
  });

  it("uses model risk and exact user authorization for Agent approval", () => {
    expect(mainProcessSource).not.toContain(
      'request.document.operation !== "delete"',
    );
    expect(mainProcessSource).toContain("modelApproval: request.modelApproval");
    expect(mainProcessSource).toContain(
      "risk: effectiveApprovalRisk(approvalOperation)",
    );
    expect(appSource).toContain(
      "低、中风险自动批准；高风险仅在你明确要求该操作时自动批准",
    );
  });

  it("collapses resolved approval details and keeps pending cards aligned", () => {
    expect(appSource).toContain('if (approval.status !== "pending")');
    expect(appSource).toContain("<details");
    expect(appSource).toContain("<summary>");
    expect(appSource).toContain('className="approval-resolved-details"');
    expect(appSource).not.toContain("<details open");
    expect(stylesSource).toMatch(
      /\.approval-card > header,\s*\.approval-card > summary\s*\{[^}]*\balign-items:\s*center/u,
    );
    expect(appSource).toContain("<ApprovalIcon neutral />");
    expect(appSource).not.toContain(
      '<span className="approval-shield">!</span>',
    );
  });

  it("renders one recommended workflow choice and wires its resolution", () => {
    expect(apiSource).toContain(
      "resolveUserInput(resolution: UserInputResolution): Promise<void>",
    );
    expect(preloadSource).toContain(
      "ipcRenderer.invoke(IPC.userInputResolve, resolution)",
    );
    expect(mainProcessSource).toContain("USER_INPUT_TIMEOUT_MILLISECONDS");
    expect(mainProcessSource).toContain("selectedOption: recommendedOption");
    expect(mainProcessSource).toContain('        "timeout",');
    expect(appSource).toContain("activePendingUserInputId");
    expect(toolActivityGroupsSource).toContain('"request_user_input"');
    expect(appSource).toContain("recommendation-badge");
    expect(appSource).toContain("5 分钟内未选择将自动采用模型推荐项");
  });

  it("replaces the composer with the active workflow choice in one keyboard-navigable column", () => {
    const composerStart = appSource.indexOf('<div className="composer-wrap">');
    const pendingBranch = appSource.indexOf(
      "{activePendingUserInput ? (",
      composerStart,
    );
    const fallbackBranch = appSource.indexOf(") : (", pendingBranch);
    const composerChoice = appSource.indexOf(
      'placement="composer"',
      pendingBranch,
    );
    const composerContext = appSource.indexOf(
      "<ComposerContextBar",
      fallbackBranch,
    );
    const timelineStart = appSource.indexOf("function Timeline(");
    const timelineSource = appSource.slice(timelineStart);
    const userInputStart = appSource.indexOf("function UserInputCard(");
    const userInputEnd = appSource.indexOf(
      "function ToolActivityGroupCard(",
      userInputStart,
    );
    const userInputSource = appSource.slice(userInputStart, userInputEnd);

    expect(appSource).toContain("activePendingUserInputId");
    expect(appSource).toContain("const activePendingUserInput =");
    expect(composerStart).toBeGreaterThan(-1);
    expect(pendingBranch).toBeGreaterThan(composerStart);
    expect(fallbackBranch).toBeGreaterThan(pendingBranch);
    expect(composerChoice).toBeGreaterThan(composerStart);
    expect(composerChoice).toBeLessThan(fallbackBranch);
    expect(composerContext).toBeGreaterThan(fallbackBranch);
    expect(appSource.slice(pendingBranch, fallbackBranch)).not.toContain(
      "<ComposerContextBar",
    );
    expect(appSource.slice(pendingBranch, fallbackBranch)).not.toContain(
      'className="composer"',
    );
    expect(appSource.slice(pendingBranch, fallbackBranch)).toContain(
      'className="pending-user-input-model"',
    );
    expect(timelineSource).toContain(
      'if (!input || input.status === "pending") return null;',
    );
    expect(userInputSource).not.toContain("new ResizeObserver");
    expect(appSource).toContain("moveUserInputOptionFocus(");
    expect(appSource).toContain('role="listbox"');
    expect(appSource).toContain('role="option"');
    expect(appSource).toContain("optionButtons.current[nextIndex]?.focus()");

    expect(cssRule(".user-input-card")).toMatch(/\bborder-radius:\s*14px/u);
    expect(cssRule(".user-input-options")).toMatch(
      /grid-template-columns:\s*minmax\(0,\s*1fr\)/u,
    );
    expect(cssRule(".user-input-card.composer-placement")).toMatch(
      /\bborder-radius:\s*24px/u,
    );
    expect(cssRule(".user-input-card.composer-placement")).toMatch(
      /\bmargin:\s*0/u,
    );
    expect(cssRule(".user-input-options-scroll")).toMatch(
      /\boverflow-y:\s*auto/u,
    );
    expect(cssRule(".user-input-option.active")).toMatch(
      /\bborder-color:\s*color-mix/u,
    );
  });

  it("cancels a pending turn from close or Skip without resolving an answer", () => {
    const cardStart = appSource.indexOf("function UserInputCard(");
    const cardEnd = appSource.indexOf(
      "function ToolActivityGroupCard(",
      cardStart,
    );
    const cardSource = appSource.slice(cardStart, cardEnd);
    const cancelStart = cardSource.indexOf("const cancel = async () =>");
    const cancelEnd = cardSource.indexOf("const closeOther", cancelStart);
    const cancelSource = cardSource.slice(cancelStart, cancelEnd);

    expect(appSource).toContain("onCancel={cancelActiveTurn}");
    expect(appSource).toContain("window.artemis.cancelTurn(activeThreadId)");
    expect(cardSource).toContain(
      "const interactionBusy = resolving || cancelling",
    );
    expect(
      cardSource.match(/onClick=\{\(\) => void cancel\(\)\}/gu),
    ).toHaveLength(2);
    expect(cancelSource).toContain("await onCancel()");
    expect(cancelSource).not.toContain("onResolve");
    expect(cardSource).toContain('className="user-input-other-inline"');
    expect(cardSource).toContain('event.key !== "Escape"');
    expect(cardSource).toContain("closeOther();");
    expect(cardSource).toContain("disabled={interactionBusy}");
    expect(cardSource).toContain(
      "disabled={interactionBusy || !otherAnswer.trim()}",
    );
  });

  it("keeps desktop tasks local and exposes no Worktree controls", () => {
    const createThreadStart = appSource.indexOf(
      "const createThread = useCallback",
    );
    const createThreadEnd = appSource.indexOf(
      "const renameThread = useCallback",
      createThreadStart,
    );
    const createThreadSource = appSource.slice(
      createThreadStart,
      createThreadEnd,
    );

    expect(createThreadSource).toContain('target: "local"');
    expect(createThreadSource).not.toContain("workspaceTarget");
    expect(appSource).not.toContain(
      "const changeWorkspaceTarget = useCallback",
    );
    expect(appSource).not.toContain("const branchizeWorktree = useCallback");
    expect(appSource).not.toContain("const cleanupWorktree = useCallback");
    expect(appSource).not.toContain(
      "const restoreWorktreeSnapshot = useCallback",
    );
    expect(appSource).not.toContain("<CodexSelect<WorkspaceTarget>");
    expect(appSource).not.toContain('className="target-switcher"');
    expect(appSource).not.toContain('className="workspace-target-badge"');
    expect(appSource).not.toContain('className="branch-glyph"');
    expect(appSource).not.toContain("window.artemis.handoffWorkspace");
    expect(appSource).not.toContain("window.artemis.branchizeWorktree");
    expect(appSource).not.toContain("window.artemis.cleanupWorktree");
    expect(appSource).not.toContain("window.artemis.restoreWorktreeSnapshot");
  });

  it("renames sidebar tasks inline without relying on a browser prompt", () => {
    expect(appSource).not.toContain("window.prompt(t.taskNamePrompt");
    expect(appSource).toContain(
      "const [threadRename, setThreadRename] = useState",
    );
    expect(appSource).toContain('className="thread-rename-input"');
    expect(appSource).toContain("beginRenameThread(thread)");
    expect(appSource).toContain('event.key === "Escape"');
    expect(appSource).toContain("window.artemis.renameThread(");
    expect(cssRule(".thread-rename-input")).toMatch(
      /\bborder:\s*1px solid var\(--blue\)/u,
    );
  });

  it("accepts dropped files and images through the isolated preload bridge", () => {
    expect(preloadSource).toContain("webUtils.getPathForFile");
    expect(preloadSource).toContain("readPromptAttachments");
    expect(appSource).toContain("onDragEnter={handleAttachmentDragEnter}");
    expect(appSource).toContain("onDragOver={handleAttachmentDragOver}");
    expect(appSource).toContain("onDrop={handleAttachmentDrop}");
    expect(appSource).toContain('className="composer-drop-overlay"');
    expect(cssRule(".composer-drop-overlay")).toMatch(
      /\bposition:\s*absolute/u,
    );
  });

  it("accepts pasted files and images through the attachment bridge", () => {
    expect(appSource).toContain("onPaste={handleAttachmentPaste}");
    expect(appSource).toContain("event.clipboardData.files");
    expect(preloadSource).toContain("readPromptAttachmentsFromFiles");
  });

  it("uses custom Codex-style context menus and modern UI typography", () => {
    expect(composerContextSource).not.toContain("<select");
    expect(composerContextSource).toContain("<CodexSelect");
    expect(composerContextSource).toContain('from "./CodexSelect.js"');
    expect(cssRule(":root").replace(/\s+/gu, " ")).toContain(
      '--ui-font: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;',
    );
    expect(cssRule(".codex-select-menu")).toMatch(/\bposition:\s*absolute/u);
    expect(cssRule(".codex-select-menu")).toMatch(/\bborder-radius:\s*10px/u);
    expect(cssRule(".codex-select-option.selected")).toMatch(/\bbackground:/u);
  });

  it("uses the same custom selector for every product dropdown", () => {
    const rendererSources = `${appSource}\n${settingsSource}\n${mcpServerEditorSource}`;
    const settingsSelectors =
      settingsSource.match(/<CodexSelect(?:<[^>]+>)?/gu) ?? [];
    const mcpEditorSelectors =
      mcpServerEditorSource.match(/<CodexSelect(?:<[^>]+>)?/gu) ?? [];

    expect(rendererSources).not.toMatch(/<select\b/gu);
    expect(settingsSource).toContain('from "./CodexSelect.js"');
    expect(settingsSelectors).toHaveLength(7);
    expect(mcpEditorSelectors).toHaveLength(1);
    expect(cssRule(".settings-codex-select .codex-select-trigger")).toMatch(
      /\bwidth:\s*100%/u,
    );
    expect(cssRule(".settings-codex-select .codex-select-menu")).toMatch(
      /\bwidth:\s*100%/u,
    );
  });

  it("keeps large custom menus on one keyboard tab stop", () => {
    expect(codexSelectSource).toContain("aria-activedescendant=");
    expect(codexSelectSource).toContain(
      "tabIndex={searchPlaceholder ? -1 : 0}",
    );
    expect(codexSelectSource).toContain('role="option"');
    expect(codexSelectSource).not.toMatch(
      /<button[\s\S]{0,500}?role="option"/u,
    );
  });

  it("adds fuzzy model search inside the Settings model selector", () => {
    expect(settingsSource).toContain("searchPlaceholder={t.modelSearch}");
    expect(settingsSource).toContain("noResultsLabel={t.modelSearchEmpty}");
    expect(settingsSource).toContain(
      "searchText: `${model.providerId} ${model.name} ${model.modelId}`",
    );
    expect(codexSelectSource).toContain('role="combobox"');
    expect(codexSelectSource).toContain('type="search"');
    expect(codexSelectSource).toContain("filterCodexSelectOptions(");
    expect(cssRule(".codex-select-search")).toMatch(/\bheight:\s*34px/u);
    expect(cssRule(".codex-select-empty")).toMatch(
      /\bcolor:\s*var\(--muted\)/u,
    );
  });

  it("imports only global instructions, Skills, and MCP configuration", () => {
    expect(settingsSource).toContain('>(["instructions", "skills", "mcp"]);');
    expect(settingsSource).not.toContain("importModel:");
    expect(settingsSource).not.toContain('["model", t.importModel]');
    expect(mainProcessSource).toContain(
      '["instructions", "skills", "mcp"].includes(category)',
    );
    expect(mainProcessSource).not.toContain("applyImportedModel(");
  });

  it("shows real task steps with status-specific progress markers", () => {
    expect(appSource).toContain("deriveTaskPlan(activeEvents, turnActive)");
    expect(appSource).toContain("<TaskPlanProgress");
    expect(taskPlanSource).toContain(
      "className={`task-step-marker ${status}`}",
    );
    expect(taskPlanSource).toContain("function visibleStepStatus(");
    expect(taskPlanSource).toMatch(
      /visibleStepStatus\(\s*step\.status,\s*index === plan\.currentIndex,\s*\)/u,
    );
    expect(taskPlanSource).toContain(
      'visibleStepStatus(current?.status ?? "pending", true)',
    );
    expect(stylesSource).toContain(".task-step-marker.in_progress");
    expect(stylesSource).toContain(".task-step-marker.pending");
    expect(stylesSource).toContain(".task-step-marker.completed");
    expect(stylesSource).toContain("@keyframes task-step-spin");
    expect(runtimeSource).toContain('name: "update_plan"');
    expect(runtimeSource).toContain('"update_plan"');
  });

  it("opens task-plan details on hover and preserves keyboard access", () => {
    expect(taskPlanSource).toContain("onPointerEnter={() => setOpen(true)}");
    expect(taskPlanSource).toContain("onPointerLeave={() => setOpen(false)}");
    expect(taskPlanSource).toContain("onFocus={() => setOpen(true)}");
    expect(taskPlanSource).toContain("aria-expanded={open}");
  });

  it("keeps expanded task steps inside the conversation when the right sidebar opens", () => {
    const taskPlanList = cssRule(".task-plan-list");

    expect(cssRule(".conversation")).toMatch(
      /\bcontainer-type:\s*inline-size/u,
    );
    expect(taskPlanList).toMatch(
      /\bwidth:\s*min\(560px,\s*calc\(100cqw\s*-\s*40px\)\)/u,
    );
    expect(taskPlanList).not.toMatch(/100vw/u);
    expect(taskPlanList).toMatch(/\bz-index:\s*1/u);
  });

  it("shows each sub-agent once as a compact task-labelled pill", () => {
    expect(toolActivityGroupsSource).toContain('"spawn_agent"');
    expect(appSource).not.toContain("<SubagentList");
    expect(appSource).toContain('className="child-agent-pill"');
    expect(appSource).toContain("<strong>{child.label}</strong>");
    expect(appSource).toContain("onOpenChildAgent(child)");
    expect(appSource).toContain("function ChildAgentPanel(");
    expect(appSource).toContain(
      "child?.error ?? child?.output ?? child?.activity",
    );
    expect(runtimeSource).toContain("const childAdapter = new PiAdapter(");
    expect(runtimeSource).toContain("scheduleActivityUpdate");
    const childSessionStart = runtimeSource.indexOf(
      "const created = await createAgentSession({",
    );
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
    expect(runtimeSource).toMatch(
      /configuredMcpTools\s*\.filter\(\(tool\) => tool\.readOnly\)/u,
    );
    expect(cssRule(".child-agent-pill")).toMatch(/\bborder-radius:\s*999px/u);
  });

  it("renders context compaction progress and completion in the timeline", () => {
    expect(appSource).toContain('running: "Thinking"');
    expect(appSource).toContain('running: "思考中"');
    expect(appSource).toContain('contextCompacting: "Compacting context"');
    expect(appSource).toContain('contextCompacting: "正在压缩上下文"');
    expect(appSource).toContain('contextCompacted: "Compact completed"');
    expect(appSource).toContain('contextCompacted: "Compact 已完成"');
    expect(appSource).toContain('if (kind === "compaction")');
    expect(appSource).toContain("state.contextCompactions[id]");
    expect(appSource).toContain("!latestTimelineEntryIsCompaction");
    expect(cssRule(".turn-status.running > span:nth-child(2)")).toMatch(
      /\banimation:\s*tool-summary-shimmer\b/u,
    );
    expect(cssRule(".timeline > .turn-status")).toMatch(/\bwidth:\s*100%/u);
  });

  it("uses Codex-scale conversation typography without a timeline Thinking row", () => {
    const assistant = cssRule(".assistant-message");
    expect(assistant).toContain("font-family: var(--ui-font)");
    expect(assistant).toContain("font-size: 15px");
    expect(cssRule(".tool-summary-label")).toContain("font-size: 14px");
    expect(appSource).not.toContain('thinkingStatus: "Thinking"');
    expect(appSource).not.toContain('className="thinking-status"');
    expect(appSource).toContain('if (part.type === "thinking") return null;');
    expect(appSource).not.toContain('className="thinking-card"');
    expect(appSource).not.toContain("<p>{part.text}</p>");
  });

  it("keeps recoverable failed tool rows neutral while preserving failure details", () => {
    const failedToolRule = cssRule(".tool-card.failed .tool-summary-label");
    expect(failedToolRule).toMatch(/\bcolor:\s*var\(--muted\)/u);
    expect(failedToolRule).not.toMatch(/\bcolor:\s*var\(--danger\)/u);
    expect(appSource).toContain('failed: "Failed"');
    expect(appSource).toContain("formatToolOutput(tool.name, tool.output)");
  });

  it("emits the cancelled completion against the active turn", () => {
    const cancelStart = mainProcessSource.indexOf("IPC.turnCancel");
    const cancelEnd = mainProcessSource.indexOf(
      "ipcMain.handle(",
      cancelStart + "IPC.turnCancel".length,
    );
    const cancelHandler = mainProcessSource.slice(cancelStart, cancelEnd);

    expect(cancelHandler).toContain(
      "const turnId = activeTurns.get(command.threadId);",
    );
    expect(cancelHandler).toContain("emitPayload(command.threadId, turnId, {");
  });

  it("renders all approval policies and persists the selected policy", () => {
    expect(appSource).toContain('className="approval-policy-trigger"');
    expect(appSource).toContain('className="approval-policy-menu"');
    expect(appSource).toContain('changeApprovalPolicy("ask")');
    expect(appSource).toContain('changeApprovalPolicy("agent")');
    expect(appSource).toContain('changeApprovalPolicy("full-access")');
    expect(appSource).toContain('changeApprovalPolicy("custom")');
    expect(appSource).toContain("window.artemis.setApprovalPolicy(policy)");
    expect(cssRule(".approval-policy-control")).toMatch(
      /\bposition:\s*static/u,
    );
    expect(cssRule(".approval-policy-menu")).toMatch(
      /\bbox-sizing:\s*border-box[\s\S]*\bleft:\s*12px[\s\S]*\boverflow-y:\s*auto[\s\S]*\bposition:\s*absolute[\s\S]*\bwidth:\s*min\(410px,\s*calc\(100%\s*-\s*24px\)\)/u,
    );
  });

  it("shows the selected model name in the composer with catalog-free fallbacks", () => {
    expect(appSource).toContain(
      "const activeProviderModel = activeProvider?.models.find(",
    );
    expect(appSource).toContain(
      "activeModel?.name ??\n    activeProviderModel?.name ??\n    activeSelection?.modelId ??\n    t.model",
    );
    expect(appSource).toContain("provider.id === activeSelection.providerId");
    expect(appSource).toContain("thinkingLevelLabel");
    expect(appSource).toContain('className="model-information"');
  });

  it("switches added models and reasoning from a Codex-style composer menu", () => {
    const modelButtonStart = appSource.indexOf('className="model-button"');
    const sendButtonStart = appSource.indexOf(
      'className="send-button',
      modelButtonStart,
    );
    const modelPickerSource = appSource.slice(
      modelButtonStart,
      sendButtonStart,
    );

    expect(modelPickerSource).toContain('className="model-picker-menu"');
    expect(modelPickerSource).toContain('modelPickerSection === "model"');
    expect(modelPickerSource).toContain('modelPickerSection === "thinking"');
    expect(modelPickerSource).toMatch(/switchComposerModel\(\s*model,?\s*\)/u);
    expect(modelPickerSource).toMatch(
      /switchComposerThinking\(\s*level,?\s*\)/u,
    );
    expect(modelPickerSource).toMatch(
      /switchComposerThinking\(\s*activeModelHighestThinkingLevel,\s*true,?\s*\)/u,
    );
    expect(modelPickerSource).toContain("ultra-mode-option");
    expect(modelPickerSource).toContain("{t.ultraModeQuota}");
    expect(appSource).toContain('ultraMode: "Ultra Mode"');
    expect(appSource).toContain('ultraMode: "极致模式"');
    expect(appSource).toContain('ultraModeQuota: "Uses your quota faster"');
    expect(appSource).toContain('ultraModeQuota: "更快消耗使用额度"');
    expect(appSource).toContain("activeSelection?.ultraMode === true");
    expect(appSource).toContain("preserveUltraMode");
    expect(modelPickerSource).toContain(
      'className="model-picker-options-heading"',
    );
    expect(modelPickerSource).not.toContain("{model.providerId}");
    expect(modelPickerSource).not.toContain("setSettingsOpen(true)");
    expect(appSource).toContain(
      'const MODEL_PICKER_THINKING_LEVELS: ThinkingLevel[] = [\n  "minimal",',
    );
    expect(appSource).toContain("runtimeSettings.addedModels.map");
    expect(appSource).toContain(
      "runtimeSettings.providers.map((provider) => provider.id)",
    );
    expect(appSource).toContain("window.artemis.setThreadModelSelection(");
    expect(cssRule(".model-picker-menu")).toMatch(/\bposition:\s*absolute/u);
    expect(cssRule(".model-picker-menu")).toMatch(/\bgrid-template-columns:/u);
    expect(cssRule(".model-picker-navigation")).toMatch(/\balign-self:\s*end/u);
    expect(cssRule(".model-picker-options")).toMatch(
      /\bmax-height:[\s\S]*\bmargin-left:\s*-1px[\s\S]*\boverflow-y:\s*auto/u,
    );
    expect(cssRule(".model-picker-options > button")).toMatch(
      /\bmin-height:\s*32px/u,
    );
    expect(cssRule(".model-picker-options > button.ultra-mode-option")).toMatch(
      /\bmin-height:\s*50px/u,
    );
    expect(
      cssRule(".model-picker-options > button.ultra-mode-option small"),
    ).toMatch(/\bwhite-space:\s*normal/u);
  });

  it("shows context usage beside the model and configures the context window", () => {
    const usageIndex = appSource.indexOf("<ContextUsageIndicator");
    const modelIndex = appSource.indexOf('className="model-button"');

    expect(usageIndex).toBeGreaterThan(-1);
    expect(modelIndex).toBeGreaterThan(usageIndex);
    expect(appSource).toContain("threadState?.contextUsage");
    expect(settingsSource).toContain("aria-label={t.contextWindow}");
    expect(settingsSource).toContain("contextWindowHint");
    expect(stylesSource).toContain(
      ".context-usage-indicator:hover .context-usage-popover",
    );
    expect(cssRule(".context-usage-indicator")).toMatch(
      /\bposition:\s*static/u,
    );
    expect(cssRule(".context-usage-popover")).toMatch(
      /\bbox-sizing:\s*border-box[\s\S]*\bright:\s*12px[\s\S]*\bwhite-space:\s*normal[\s\S]*\bwidth:\s*min\(320px,\s*calc\(100%\s*-\s*24px\)\)/u,
    );
  });

  it("supports provider base URLs, language selection, and model-save feedback", () => {
    expect(settingsSource).toContain("baseUrl");
    expect(settingsSource).toContain("providerApi");
    expect(settingsSource).toContain('"openai-responses"');
    expect(settingsSource).toContain(
      "const DEFAULT_PROVIDER_CONTEXT_WINDOW = 1_000_000;",
    );
    expect(settingsSource).toContain(
      "const DEFAULT_PROVIDER_MAX_TOKENS = 128_000;",
    );
    expect(settingsSource).toContain("value={providerContextWindow}");
    expect(settingsSource).toContain("value={providerMaxTokens}");
    const providerFormSource = settingsSource.slice(
      settingsSource.indexOf(
        '<form\n                    className="credential-form provider-form"',
      ),
      settingsSource.indexOf("{t.configuredProviders}"),
    );
    expect(providerFormSource.match(/step=\{1\}/gu)).toHaveLength(2);
    expect(providerFormSource).not.toContain("step={1_024}");
    expect(settingsSource).toContain(
      "const providerIdPattern = /^[a-z0-9][a-z0-9._-]*$/u;",
    );
    expect(settingsSource).toContain(
      'event.target.value.toLocaleLowerCase("en-US")',
    );
    expect(settingsSource).toContain('pattern="[a-z0-9][a-z0-9._-]*"');
    expect(settingsSource).toContain("!providerIdValid");
    expect(settingsSource).toContain(
      "contextWindow: parsedProviderContextWindow",
    );
    expect(settingsSource).toContain("maxTokens: parsedProviderMaxTokens");
    expect(settingsSource).toContain("editProviderConnection(provider)");
    expect(settingsSource).toContain("saveProviderConnection");
    const providerSaveHandler = mainProcessSource.slice(
      mainProcessSource.indexOf("IPC.settingsProviderSave"),
      mainProcessSource.indexOf("IPC.settingsCredentialDelete"),
    );
    expect(providerSaveHandler).toContain(
      "const activatesProvider = !configuration.selection;",
    );
    expect(providerSaveHandler).toContain(
      "configuration.selection = providerSelection;",
    );
    expect(providerSaveHandler).toContain("await settingsStore.setModel(");
    expect(providerSaveHandler).toContain("providerContextWindow");
    expect(settingsSource).toContain("setLanguage");
    expect(settingsSource).toContain('className="model-apply-dialog"');
    expect(settingsSource).toContain("modelSaved");
    expect(settingsSource).toContain("modelSaveFailed");
  });

  it("creates, edits, and deletes multiple provider connections", () => {
    const providerSaveHandler = mainProcessSource.slice(
      mainProcessSource.indexOf("IPC.settingsProviderSave"),
      mainProcessSource.indexOf("IPC.settingsProviderDelete"),
    );
    const providerDeleteHandler = mainProcessSource.slice(
      mainProcessSource.indexOf("IPC.settingsProviderDelete"),
      mainProcessSource.indexOf("IPC.settingsCredentialDelete"),
    );

    expect(settingsSource).toContain("editingProviderId");
    expect(settingsSource).toContain("function resetProviderForm()");
    expect(settingsSource).toContain("resetProviderForm();");
    expect(settingsSource).toContain(
      "disabled={busy || Boolean(editingProviderId)}",
    );
    expect(settingsSource).toMatch(
      /window\.artemis\.deleteProviderConnection\(\s*provider\.id,?\s*\)/u,
    );
    expect(settingsSource).toContain('className="text-button danger"');
    expect(apiSource).toMatch(
      /deleteProviderConnection\(providerId: string\): Promise<SettingsSnapshot>/u,
    );
    expect(apiSource).toContain(
      'settingsProviderDelete: "artemis:settings-provider-delete"',
    );
    expect(preloadSource).toContain(
      "deleteProviderConnection: (providerId) =>",
    );
    expect(providerSaveHandler).toContain("updatesActiveProvider");
    expect(providerSaveHandler).toContain("configuration.selection?.modelId");
    expect(providerSaveHandler).toContain(
      "selectedProviderModel ?? providerModel",
    );
    expect(providerSaveHandler).toContain(
      "configuration.selection = providerSelection",
    );
    expect(providerSaveHandler).toContain("await settingsStore.setModel(");
    expect(providerDeleteHandler).toContain(
      "await settingsStore.deleteProviderConnection(",
    );
    expect(providerDeleteHandler).toContain(
      "delete configuration.credentials[provider.id]",
    );
  });

  it("adds a built-in model and its API key without using the switch API", () => {
    const generalTabStart = settingsSource.indexOf('{activeTab === "general"');
    const providersTabStart = settingsSource.indexOf(
      '{activeTab === "providers"',
    );
    const agentsTabStart = settingsSource.indexOf('{activeTab === "agents"');
    const generalTabSource = settingsSource.slice(
      generalTabStart,
      providersTabStart,
    );
    const providersTabSource = settingsSource.slice(
      providersTabStart,
      agentsTabStart,
    );

    const addModelSource = settingsSource.slice(
      settingsSource.indexOf("async function addModel()"),
      settingsSource.indexOf("async function setLanguage"),
    );
    const modelAddHandler = mainProcessSource.slice(
      mainProcessSource.indexOf("IPC.settingsModelAdd"),
      mainProcessSource.indexOf("IPC.settingsModelDelete"),
    );
    const modelDeleteHandler = mainProcessSource.slice(
      mainProcessSource.indexOf("IPC.settingsModelDelete"),
      mainProcessSource.indexOf("IPC.settingsModelSet"),
    );
    const modelSwitchHandler = mainProcessSource.slice(
      mainProcessSource.indexOf("IPC.settingsModelSet"),
      mainProcessSource.indexOf("IPC.settingsApiKeySave"),
    );

    expect(generalTabSource).toContain("<h3>{t.model}</h3>");
    expect(generalTabSource).not.toContain("{t.thinking}");
    expect(generalTabSource).not.toContain("<h3>{t.apiKey}</h3>");
    expect(generalTabSource).toContain("aria-label={t.apiKey}");
    expect(generalTabSource).toContain("selectedModelInfo?.providerId");
    expect(generalTabSource).toContain("onClick={addModel}");
    expect(generalTabSource).not.toContain("onClick={saveKey}");
    expect(generalTabSource).not.toContain("keyProviderId");
    expect(
      generalTabSource.match(/className="settings-primary-action"/gu) ?? [],
    ).toHaveLength(1);
    expect(generalTabSource).not.toContain("settings.credentials.map");
    expect(generalTabSource).not.toContain("window.artemis.deleteCredential");
    expect(generalTabSource).toContain("settings.addedModels.map");
    expect(generalTabSource).toContain("setModelDeleteTarget(model)");
    expect(generalTabSource).toContain("importPiCredentials");
    expect(addModelSource).toContain("keyApiKey.trim() || undefined");
    expect(apiSource).toMatch(
      /addModel\(\s*model: AddedModelConfiguration,\s*apiKey\?: string,/u,
    );
    expect(preloadSource).toContain("addModel: (model, apiKey)");
    expect(apiSource).toContain("removeModel(");
    expect(preloadSource).toContain("removeModel: (model)");
    expect(modelAddHandler).toContain("apiKeyInput?: string");
    expect(modelAddHandler).toContain(
      "configuration.credentials[selectedModel.providerId]",
    );
    expect(modelAddHandler).toContain("await settingsStore.addModel(");
    expect(modelDeleteHandler).toContain("activeTurns.size > 0");
    expect(modelDeleteHandler).toContain("await settingsStore.removeModel(");
    expect(modelDeleteHandler).toContain(
      "delete configuration.credentials[target.providerId]",
    );
    expect(modelSwitchHandler).not.toContain("apiKeyInput");
    expect(modelSwitchHandler).toContain(
      "await settingsStore.setModel(resolved.selection, resolved.contextWindow)",
    );
    expect(mainProcessSource).toContain(
      'typeof selection.ultraMode !== "boolean"',
    );
    expect(mainProcessSource).toContain("normalizeModelSelection(");
    expect(mainProcessSource).toContain("selectedModel.reasoning");
    expect(mainProcessSource).toContain("selectedModel.highestThinkingLevel");
    expect(mainProcessSource).toContain("selection.ultraMode === true");

    // Custom provider setup keeps its independent, working connection flow.
    expect(providersTabSource).toContain("<h3>{t.customProviders}</h3>");
    expect(providersTabSource).toContain("saveProviderConnection");
    expect(providersTabSource).toContain("t.optionalApiKey");
    expect(providersTabSource).not.toContain("onClick={saveKey}");
    expect(providersTabSource).not.toContain("keyProviderId");
  });

  it("uses a centered settings dialog with left tabs and one active content panel", () => {
    expect(settingsSource).toContain('role="dialog"');
    expect(settingsSource).toContain('aria-modal="true"');
    expect(settingsSource).toContain('className="settings-tabs"');
    expect(settingsSource).toContain('role="tablist"');
    expect(settingsSource).toContain('role="tabpanel"');
    expect(settingsSource).toContain('activeTab === "general"');
    expect(settingsSource).toContain('activeTab === "providers"');
    expect(settingsSource).toContain('activeTab === "agents"');
    expect(settingsSource).toContain('activeTab === "capabilities"');
    expect(settingsSource).toContain('activeTab === "maintenance"');
    expect(cssRule(".settings-backdrop")).toMatch(
      /\bjustify-content:\s*center/u,
    );
    expect(cssRule(".settings-panel")).toMatch(/\bborder-radius:/u);
    expect(cssRule(".settings-body")).toMatch(/\bdisplay:\s*flex/u);
    expect(cssRule(".settings-tabs")).toMatch(/\bflex:\s*0\s+0\s+190px/u);
  });

  it("loads task history lazily and batches live renderer updates", () => {
    const agentWarmupIndex = mainProcessSource.indexOf(
      "agentRuntimeReady = applyAgentRuntime()",
    );
    const windowCreationIndex = mainProcessSource.lastIndexOf(
      "mainWindow = createMainWindow()",
    );

    expect(mainProcessSource).toContain("includeEvents: false");
    expect(agentWarmupIndex).toBeGreaterThan(-1);
    expect(windowCreationIndex).toBeGreaterThan(agentWarmupIndex);
    expect(
      mainProcessSource.slice(agentWarmupIndex, windowCreationIndex),
    ).not.toContain("await agentRuntimeReady");
    expect(appSource).toContain(".getThreadEvents(threadId)");
    expect(appSource).toContain("reduceAgentEventBatch");
    expect(appSource).toContain(
      "window.requestAnimationFrame(flushAgentEvents)",
    );
    expect(appSource).toContain(
      "Promise.all([loadResourceCenter(), loadSettingsPanel()])",
    );
    expect(appSource).toContain(
      "const idleCallback = window.requestIdleCallback(",
    );
    expect(appSource).toContain('import("./TerminalPanel.js")');
    expect(stylesSource).toContain("content-visibility: auto");
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

  it("switches between system, light, and dark themes immediately", () => {
    expect(settingsSource).toContain("window.artemis.setTheme(theme)");
    expect(settingsSource).toContain(
      '{ value: "system", label: t.themeSystem }',
    );
    expect(settingsSource).toContain('{ value: "light", label: t.themeLight }');
    expect(settingsSource).toContain('{ value: "dark", label: t.themeDark }');
    expect(appSource).toContain("document.documentElement.dataset.theme");
    expect(stylesSource).toContain(':root[data-theme="light"]');
    expect(stylesSource).toContain(':root[data-theme="dark"]');
    expect(stylesSource).toContain(":root:not([data-theme])");
  });

  it("keeps the terminal and native window chrome aligned with the theme", () => {
    expect(appSource).toContain('theme={runtimeSettings?.theme ?? "system"}');
    expect(terminalSource).toContain(
      'window.matchMedia("(prefers-color-scheme: dark)")',
    );
    expect(terminalSource).toContain("terminal.options.theme =");
    expect(cssRule(".terminal-panel")).toMatch(
      /\bbackground:\s*var\(--terminal-background\)/u,
    );
    expect(stylesSource).toContain(
      "background: var(--terminal-header-background);",
    );
    expect(mainProcessSource).toContain("nativeTheme.themeSource = theme");
    expect(mainProcessSource).toContain("window.setBackgroundColor");
  });

  it("keeps DOM and canvas xterm internals deep and high-contrast, not only its outer panel", () => {
    const darkTheme = terminalSource.match(
      /\bdark:\s*\{(?<declarations>[^}]*)\}/u,
    )?.groups?.declarations;

    expect(darkTheme).toBeDefined();
    const background = hexProperty(darkTheme!, "background");
    const foreground = hexProperty(darkTheme!, "foreground");
    expect(relativeLuminance(background)).toBeLessThan(0.02);
    expect(contrastRatio(background, foreground)).toBeGreaterThanOrEqual(7);

    const rootTheme = cssRule(":root");
    expect(rootTheme).toContain(`--terminal-background: ${background};`);
    expect(rootTheme).toContain(`--terminal-text: ${foreground};`);

    for (const selector of [
      ".terminal-host .xterm-screen",
      ".terminal-host .xterm-rows",
      ".terminal-host .xterm-screen canvas",
      ".terminal-host .xterm-helper-textarea",
      ".terminal-host .xterm .xterm-viewport",
    ]) {
      const declarations = cssDeclarationsForSelector(selector);
      expect
        .soft(declarations, `Missing CSS rule for ${selector}`)
        .toBeDefined();
      expect
        .soft(declarations ?? "", `Wrong background for ${selector}`)
        .toMatch(/\bbackground(?:-color)?:\s*var\(--terminal-background\)/u);
    }

    for (const selector of [
      ".terminal-host .xterm-screen",
      ".terminal-host .xterm-rows",
    ]) {
      const declarations = cssDeclarationsForSelector(selector);
      expect
        .soft(declarations ?? "", `Wrong foreground for ${selector}`)
        .toMatch(/\bcolor:\s*var\(--terminal-text\)/u);
    }
  });

  it("fits the terminal with xterm cell measurements instead of hand-estimated dimensions", () => {
    expect(terminalSource).toContain('from "@xterm/addon-fit"');
    expect(terminalSource).toContain("new FitAddon()");
    expect(terminalSource).toContain("terminal.loadAddon(fitAddon)");
    expect(terminalSource).toContain("fitAddon.fit()");
    expect(terminalSource).not.toContain("function terminalDimensions");
    expect(terminalSource).not.toMatch(
      /client(?:Width|Height)\s*\/\s*\d+(?:\.\d+)?/u,
    );
  });

  it("prefetches and caches Unstaged and Staged Review data for instant scope switching", () => {
    expect(appSource).toContain("useTransition");
    expect(appSource).toContain(
      "const reviewDiffCache = useRef(new Map<string, ReviewDiff>());",
    );
    expect(appSource).toContain("const reviewDiffInFlight = useRef(");
    expect(appSource).toContain(
      'const eagerScopes: ReviewScope[] = ["unstaged", "staged"];',
    );
    expect(appSource).toMatch(
      /selectReviewScope\s*=\s*\([^)]*scope[^)]*\)\s*=>\s*\{[\s\S]*?setReviewScope\(scope\);[\s\S]*?reviewDiffCache\.current\.get\([\s\S]*?setReviewDiff\(cached\);[\s\S]*?\}/u,
    );
    expect(appSource).toContain("onChange={selectReviewScope}");
    expect(appSource).toMatch(
      /startReviewTransition\(\(\)\s*=>\s*\{?[\s\S]*?setReviewDiff\(diff\);?[\s\S]*?\}?\);/u,
    );
    const refreshDiff = appSource.slice(
      appSource.indexOf("const refreshDiff = useCallback"),
      appSource.indexOf(
        "const selectReviewScope",
        appSource.indexOf("const refreshDiff = useCallback"),
      ),
    );
    expect(refreshDiff).not.toMatch(
      /Promise\.all\(\[[\s\S]*?getReviewDiff[\s\S]*?listReviewComments/u,
    );
  });

  it("initializes both Review scopes to branch by default", () => {
    expect.soft(appSource).toContain('useState<ReviewScope>("branch")');
    expect
      .soft(appSource)
      .toMatch(
        /useState<ReviewDiff \| undefined>\(\{[\s\S]*?scope:\s*"branch"/u,
      );
  });

  it("lays out Review as a comparison toolbar, central diff reader, and searchable file sidebar", () => {
    const reviewStart = appSource.indexOf('className="review-panel"');
    const reviewEnd = appSource.indexOf(
      '{tab.kind === "terminal"',
      reviewStart,
    );
    const reviewSource = appSource.slice(reviewStart, reviewEnd);
    const toolbar = reviewSource.indexOf(
      'className="review-comparison-toolbar"',
    );
    const reader = reviewSource.indexOf('className="review-diff-reader"');
    const sidebar = reviewSource.indexOf('className="review-file-sidebar"');

    expect(reviewStart).toBeGreaterThan(-1);
    expect(reviewEnd).toBeGreaterThan(reviewStart);
    expect(toolbar).toBeGreaterThan(-1);
    expect(reader).toBeGreaterThan(toolbar);
    expect(sidebar).toBeGreaterThan(reader);
    expect(reviewSource).toContain('className="review-scope-select"');
    expect(reviewSource).toContain('className="review-file-filter"');
    expect(reviewSource).toContain("setReviewFileQuery");
    expect(reviewSource).toContain("setSelectedReviewFileId");
    expect(reviewSource).toContain('className="review-empty-illustration"');
    expect(reviewSource).toContain("{t.changesAppearHere}");
    expect(reviewSource).not.toContain('className="review-scopes"');
    expect(appSource).toMatch(
      /file\.path\.toLowerCase\(\)\.includes\(normalizedQuery\)/u,
    );
    for (const preservedAction of [
      'mutateReview("stage"',
      'mutateReview("unstage"',
      "saveReviewComment(",
    ]) {
      expect(reviewSource).toContain(preservedAction);
    }
    expect(reviewSource).toMatch(/mutateReview\(\s*"revert"/u);

    const workspace = cssRule(".review-workspace");
    const fileSidebar = cssRule(".review-file-sidebar");
    expect(workspace).toMatch(/\bdisplay:\s*(?:flex|grid)/u);
    expect(fileSidebar).toMatch(/\bborder-left:/u);
    expect(fileSidebar).toMatch(/\bwidth:/u);
  });

  it("contains offscreen Review files and avoids rendering the full diff twice", () => {
    const reviewFile = cssRule(".review-file");

    expect(reviewFile).toMatch(/\bcontent-visibility:\s*auto/u);
    expect(reviewFile).toMatch(/\bcontain-intrinsic-size:/u);
    expect(appSource).not.toMatch(
      /<pre[^>]*className="diff-view"[^>]*>[\s\S]*?reviewDiff\.text[\s\S]*?<\/pre>/u,
    );
  });

  it("opens a tabbed workspace launcher before mounting Review or Terminal", () => {
    const launcher = cssRule(".right-sidebar-launcher");
    const launcherItem = cssRule(".right-sidebar-launcher-item");
    const resizer = cssRule(".workspace-dock-resizer");
    const launcherStart = appSource.indexOf(
      '<div className="right-sidebar-launcher">',
    );
    const launcherEnd = appSource.indexOf(
      "{workspaceTabs.tabs.map((tab) => (",
      launcherStart,
    );
    const launcherSource = appSource.slice(launcherStart, launcherEnd);

    expect(appSource).toContain('from "./workspace-tabs.js"');
    expect(appSource).toContain("const [workspaceTabsByThread");
    expect(appSource).toContain('className="right-sidebar-toggle"');
    expect(appSource).toContain('className="workspace-tab-bar"');
    expect(appSource).toContain("workspaceTabs.tabs.length === 0");
    expect(appSource).toContain('tab.kind === "review"');
    expect(appSource).toContain('tab.kind === "terminal"');
    expect(appSource).toContain('tab.kind === "browser"');
    expect(appSource).toContain('tab.kind === "markdown"');
    expect(appSource).toContain('tab.kind === "file"');
    expect(appSource).toContain("onClick={openReviewPanel}");
    expect(appSource).toContain("onClick={openTerminalPanel}");
    expect(appSource).toContain("onClick={openBrowserPanel}");
    expect(appSource).toContain("onClick={openFilesPanel}");
    expect(launcherStart).toBeGreaterThan(-1);
    expect(launcherEnd).toBeGreaterThan(launcherStart);
    expect(launcherSource).not.toContain("openMarkdownPanel");
    expect(launcherSource).not.toContain("{t.markdownReader}");
    expect(appSource).not.toContain("const [reviewOpen");
    expect(appSource).not.toContain("const [terminalOpen");
    expect(resizer).toMatch(/\bcursor:\s*col-resize/u);
    expect(launcher).toMatch(/\bmin-width:/u);
    expect(launcherItem).toMatch(/\bgrid-template-columns:/u);
  });

  it("materializes a task before opening workspace tools from a fresh conversation", () => {
    const createThreadStart = appSource.indexOf(
      "const createThread = useCallback(",
    );
    const createThreadEnd = appSource.indexOf(
      "const ensureWorkspaceThread =",
      createThreadStart,
    );
    const createThreadSource = appSource.slice(
      createThreadStart,
      createThreadEnd,
    );
    const openWorkspaceTabStart = appSource.indexOf(
      "const openWorkspaceTab = useCallback(",
    );
    const openWorkspaceTabEnd = appSource.indexOf(
      "const openResolvedWorkspaceFile =",
      openWorkspaceTabStart,
    );
    const openWorkspaceTabSource = appSource.slice(
      openWorkspaceTabStart,
      openWorkspaceTabEnd,
    );

    expect(openWorkspaceTabStart).toBeGreaterThan(-1);
    expect(openWorkspaceTabEnd).toBeGreaterThan(openWorkspaceTabStart);
    expect(createThreadSource).toContain("isWorkspaceDraftThread(thread)");
    expect(createThreadSource).toContain("reusableWorkspaceDraft");
    expect(openWorkspaceTabSource).toContain("ensureWorkspaceThread()");
    expect(openWorkspaceTabSource).not.toContain("if (!activeThreadId) return");
    expect(appSource).toContain("moveComposerDraft(");
    expect(appSource).toContain(
      ".filter((thread) => !isWorkspaceDraftThread(thread))",
    );
  });

  it("opens HTML from explicit file links without auto-opening file changes", () => {
    const htmlChangeStart = appSource.indexOf("const latestHtmlChange =");
    const htmlChangeEnd = appSource.indexOf(
      "const openHtmlFromFiles =",
      htmlChangeStart,
    );
    const conversationLinkStart = appSource.indexOf(
      "const openResolvedWorkspaceFile =",
    );
    const conversationLinkEnd = appSource.indexOf(
      "const openConversationFileLinkMenu =",
      conversationLinkStart,
    );

    expect(htmlChangeStart).toBeGreaterThan(-1);
    expect(htmlChangeEnd).toBeGreaterThan(htmlChangeStart);
    expect(appSource.slice(htmlChangeStart, htmlChangeEnd)).not.toContain(
      'openWorkspaceTab("browser"',
    );
    expect(appSource).not.toContain("autoOpenedHtmlChanges");
    expect(conversationLinkStart).toBeGreaterThan(-1);
    expect(conversationLinkEnd).toBeGreaterThan(conversationLinkStart);
    expect(
      appSource.slice(conversationLinkStart, conversationLinkEnd),
    ).toContain("inspectWorkspaceFileLink(");
    expect(
      appSource.slice(conversationLinkStart, conversationLinkEnd),
    ).toContain("openWorkspaceTab(file.viewer, { path: file.path });");
    expect(workspacePreviewSource).toContain("<webview");
    expect(workspacePreviewSource).toContain("normalizeBrowserAddress");
    expect(workspacePreviewSource).toContain("browserNavigationSnapshot");
    expect(workspacePreviewSource).toContain('"dom-ready"');
    expect(workspacePreviewSource).toContain(
      "shouldReloadBrowserForLocaleChange",
    );
    expect(workspacePreviewSource).toContain("reloadIgnoringCache()");
    expect(workspacePreviewSource).toContain(
      "partition={BROWSER_SESSION_PARTITION}",
    );
    expect(appSource).toMatch(
      /<WorkspaceBrowserPanel[\s\S]*?locale=\{locale\}[\s\S]*?\/>/u,
    );
    expect(workspacePreviewSource).toContain('"did-navigate"');
    expect(workspacePreviewSource).not.toContain("<iframe");
    expect(workspacePreviewSource).not.toContain("connect-src 'none'");
    expect(mainProcessSource).toContain("webviewTag: true");
    expect(mainProcessSource).toContain('"will-attach-webview"');
    expect(mainProcessSource).toContain("delete webPreferences.preload");
    expect(mainProcessSource).toContain(
      "webPreferences.nodeIntegration = false",
    );
    expect(mainProcessSource).toContain(
      "webPreferences.contextIsolation = true",
    );
    expect(mainProcessSource).toContain("webPreferences.sandbox = true");
    expect(mainProcessSource).toContain("configureBrowserLocaleSession();");
    expect(mainProcessSource).toMatch(
      /electronSession\.fromPartition\(\s*BROWSER_SESSION_PARTITION,?\s*\)/u,
    );
    expect(mainProcessSource).toContain('urls: ["http://*/*", "https://*/*"]');
    expect(browserLocaleSource).toContain("withBrowserAcceptLanguage");
    expect(apiSource).toContain("readWorkspaceTextFile(");
    expect(preloadSource).toContain("IPC.workspaceTextFileRead");
    expect(mainProcessSource).toContain("IPC.workspaceTextFileRead");
  });

  it("opens assistant HTTP links in the reusable Artemis Browser tab", () => {
    const externalLinkStart = appSource.indexOf(
      "const openConversationExternalLink =",
    );
    const externalLinkEnd = appSource.indexOf(
      "const openConversationFileLinkMenu =",
      externalLinkStart,
    );
    const externalLinkSource = appSource.slice(
      externalLinkStart,
      externalLinkEnd,
    );

    expect(externalLinkStart).toBeGreaterThan(-1);
    expect(externalLinkEnd).toBeGreaterThan(externalLinkStart);
    expect(externalLinkSource).toContain("normalizeBrowserAddress(href)");
    expect(externalLinkSource).toContain('openWorkspaceTab("browser"');
    expect(externalLinkSource).toContain("reuseKind: true");
    expect(externalLinkSource).toContain("url");
    expect(appSource).toContain(
      "onExternalLink={openConversationExternalLink}",
    );
    expect(appSource).toContain("initialUrl={tab.url}");
    expect(workspacePreviewSource).toContain("initialUrl?: string");
    expect(workspacePreviewSource).toContain(
      'workspaceDocument?.url ?? props.initialUrl ?? "about:blank"',
    );
  });

  it("switches the Markdown reader between rich and source views", () => {
    expect(workspacePreviewSource).toContain("<MarkdownContent");
    expect(workspacePreviewSource).toContain('useState<"rich" | "source">');
    expect(workspacePreviewSource).toContain('setView("rich")');
    expect(workspacePreviewSource).toContain('setView("source")');
    expect(workspacePreviewSource).toContain(
      'className="markdown-reader-mode-toggle"',
    );
    expect(workspacePreviewSource).toContain("readWorkspaceImage(");
    expect(workspacePreviewSource).toContain("resolveImage={resolveImage}");
    expect(apiSource).toContain("readWorkspaceImage(");
    expect(preloadSource).toContain("IPC.workspaceImageRead");
    expect(mainProcessSource).toContain("IPC.workspaceImageRead");
    expect(rendererHtmlSource).toMatch(/img-src[^;]*https:[^;]*http:/u);
  });

  it("routes HTML to Browser and opens Markdown in place through the file reader", () => {
    const openFileStart = workspaceFilesSource.indexOf(
      "const openFile = (entry:",
    );
    const openFileEnd = workspaceFilesSource.indexOf(
      "const saveFile =",
      openFileStart,
    );
    const openFileSource = workspaceFilesSource.slice(
      openFileStart,
      openFileEnd,
    );

    expect(openFileStart).toBeGreaterThan(-1);
    expect(openFileEnd).toBeGreaterThan(openFileStart);
    expect(workspaceFilesSource).toContain("listWorkspaceDirectory");
    expect(openFileSource).toContain("onOpenHtml(entry.path)");
    expect(openFileSource).toContain("readWorkspaceFile(threadId, entry.path)");
    expect(openFileSource).not.toContain("onOpenMarkdown");
    expect(workspaceFilesSource).not.toContain(
      "onOpenMarkdown(path: string): void",
    );
    expect(workspaceFilesSource).toContain('className="workspace-file-filter"');
    expect(appSource).toContain('tab.kind === "file"');
    expect(appSource).toContain('openWorkspaceTab("browser"');
    expect(apiSource).toContain("listWorkspaceDirectory(");
    expect(apiSource).toContain("readWorkspaceFile(");
  });

  it("docks selected right-sidebar content beside the conversation", () => {
    const workspaceContentIndex = appSource.indexOf(
      'className="workspace-content"',
    );
    const reviewIndex = appSource.indexOf('className="review-panel"');
    const terminalIndex = appSource.indexOf("<TerminalPanel");
    const terminalPanel = cssRule(".terminal-panel");
    const dock = cssRule(".workspace-tool-dock");
    const resizer = cssRule(".workspace-dock-resizer");

    expect(workspaceContentIndex).toBeGreaterThan(-1);
    expect(reviewIndex).toBeGreaterThan(workspaceContentIndex);
    expect(terminalIndex).toBeGreaterThan(workspaceContentIndex);
    expect(resizer).toMatch(/\bcursor:\s*col-resize/u);
    expect(resizer).toMatch(/\btouch-action:\s*none/u);
    expect(terminalPanel).toMatch(/\bmin-width:/u);
    expect(terminalPanel).toMatch(/\bheight:\s*100%/u);
    expect(terminalPanel).not.toMatch(/\bheight:\s*190px/u);
    expect(terminalPanel).not.toMatch(/\bborder-top:/u);
  });

  it("keeps both sidebars compact, directly toggleable, and smoothly animated", () => {
    const shell = cssRule(".app-shell");
    const sidebar = cssRule(".sidebar");
    const collapsedSidebar = cssRule("body.sidebar-collapsed .sidebar");
    const dock = cssRule(".workspace-tool-dock");
    const resizer = cssRule(".workspace-dock-resizer");
    const closedDock = cssRule('.workspace-tool-dock[data-open="false"]');
    const reducedMotion = cssAtRule(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)/u,
    );

    expect(appSource).toContain("function LeftSidebarIcon()");
    expect(appSource).toContain('leftSidebar: "Left sidebar"');
    expect(appSource).toContain('leftSidebar: "左侧边栏"');
    expect(appSource).toContain('className="left-sidebar-toggle"');
    expect(appSource).toContain("aria-expanded={sidebarOpen}");
    expect(appSource).toContain(
      "onClick={() => setSidebarOpen((open) => !open)}",
    );
    expect(appSource).toContain("data-open={workspaceDockOpen}");
    expect(appSource).toContain("aria-hidden={!workspaceDockOpen}");
    expect(appSource).toContain('role="separator"');
    expect(appSource).toContain('aria-orientation="vertical"');
    expect(appSource).toContain("onPointerDown={beginWorkspaceDockResize}");
    expect(appSource).toContain("onKeyDown={resizeWorkspaceDockFromKeyboard}");
    expect(apiSource).toContain("setWorkspaceDockWidth(width: number)");
    expect(preloadSource).toContain("setWorkspaceDockWidth: (width)");

    expect(shell).toMatch(/--project-sidebar-width:\s*252px/u);
    expect(shell).toMatch(/transition:\s*grid-template-columns\s+240ms/u);
    expect(sidebar).toMatch(/transition:/u);
    expect(sidebar).toMatch(/\btransform:/u);
    expect(collapsedSidebar).toMatch(/\bopacity:\s*0/u);
    expect(collapsedSidebar).toMatch(/\btransform:\s*translateX\(-/u);

    expect(dock).toMatch(
      /\bflex:\s*0\s+1\s+var\(--workspace-dock-width,\s*62%\)/u,
    );
    expect(dock).toMatch(/\bwidth:\s*var\(--workspace-dock-width/u);
    expect(dock).toMatch(/calc\(100%\s*-\s*327px\)/u);
    expect(dock).toMatch(/transition:/u);
    expect(resizer).toMatch(/\bflex:\s*0\s+0\s+7px/u);
    expect(closedDock).toMatch(/\bflex-basis:\s*0/u);
    expect(closedDock).toMatch(/\bopacity:\s*0/u);
    expect(closedDock).toMatch(/\btransform:\s*translateX\(/u);

    expect(reducedMotion).toContain(".app-shell");
    expect(reducedMotion).toContain(".sidebar");
    expect(reducedMotion).toContain(".workspace-dock-resizer");
    expect(reducedMotion).toContain(".workspace-tool-dock");
    expect(reducedMotion).toMatch(/transition:\s*none/u);
  });

  it("keeps PowerShell input legible and prevents an xterm horizontal scrollbar", () => {
    const viewport = cssRule(".terminal-host .xterm .xterm-viewport");

    expect(terminalSource).toContain('brightYellow: "#6b5700"');
    expect(terminalSource).toContain('cursorStyle: "bar"');
    expect(viewport).toMatch(/\boverflow-x:\s*hidden/u);
  });

  it("uses a real provider form with editable controls and a submit action", () => {
    expect(settingsSource).toMatch(
      /<form\s+className="credential-form provider-form"/u,
    );
    expect(settingsSource).toContain(
      "onSubmit={(event) => void saveProviderConnection(event)}",
    );
    expect(settingsSource).toContain('type="submit"');
    expect(settingsSource).toContain('className="settings-primary-action"');
  });

  it("localizes every task mode in the Simplified Chinese menu", () => {
    expect(appSource).toContain('execute: "执行"');
    expect(appSource).toContain('plan: "计划"');
    expect(appSource).toContain('review: "审查"');
  });

  it("uses a standalone structured MCP editor for installed stdio servers", () => {
    expect(resourceCenterSource).toContain('mode === "mcp-editor"');
    expect(resourceCenterSource).toContain("<McpServerEditor");
    expect(resourceCenterSource).toContain("function openMcpEditor");
    expect(mcpServerEditorSource).toContain('className="mcp-editor-card"');
    expect(mcpServerEditorSource).toContain('className="mcp-argument-row"');
    expect(mcpServerEditorSource).toContain('className="mcp-environment-row"');
    expect(mcpServerEditorSource).toContain("{t.environmentVariables}");
    expect(mcpServerEditorSource).toContain(
      "{t.environmentVariablePassthrough}",
    );
    expect(mcpServerEditorSource).toContain("t.transportChangeHint");
    expect(settingsSource).not.toContain("window.artemis.saveMcpServer");
    expect(settingsSource).not.toContain("window.artemis.removeMcpServer");
  });

  it("exposes persisted MCP and Skill switches in the capability center", () => {
    expect(resourceCenterSource).toContain(
      "window.artemis.setMcpServerEnabled",
    );
    expect(resourceCenterSource).toContain("window.artemis.setSkillEnabled");
    expect(resourceCenterSource).toContain('role="switch"');
    expect(stylesSource).toContain(".resource-switch");
  });

  it("uses the requested plug mark for the capability-center entry", () => {
    const iconStart = appSource.indexOf("function ResourceIcon()");
    const iconEnd = appSource.indexOf("function TokenUsageIcon()", iconStart);
    const icon = appSource.slice(iconStart, iconEnd);

    expect(icon).toContain('d="M8 3v5m8-5v5M6 8h12');
    expect(icon).toContain('d="M12 16.5V21m-2.5 0h5"');
    expect(icon).not.toContain('<circle cx="6" cy="12"');
  });

  it("keeps the Codex-style marketplace and manager on one centered grid", () => {
    const pageChildren = cssRule(".resource-page > *");
    const toolbar = cssRule(".resource-management-toolbar");

    expect(resourceCenterSource).toContain(
      'className="resource-installed-overview"',
    );
    expect(resourceCenterSource).toContain(
      'className="resource-management-tabs" role="tablist"',
    );
    expect(pageChildren).toMatch(/\bmax-width:\s*920px/u);
    expect(toolbar).toMatch(/\bdisplay:\s*flex/u);
    expect(toolbar).toMatch(/\bjustify-content:\s*space-between/u);
    expect(stylesSource).toMatch(
      /\.resource-scope-tabs,\s*\.resource-management-tabs\s*\{[\s\S]*?display:\s*flex/u,
    );
  });

  it("scopes app-owned Google authorization to the Artemis Plugin Shop tab", () => {
    expect(resourceCenterSource).toContain(
      'selectedMarketplaceSource?.marketplaceName === "artemis-plugin-shop"',
    );
    expect(resourceCenterSource).toContain(
      "{isArtemisPluginShop && !marketplaceFilter && (",
    );
    expect(resourceCenterSource).toContain(
      'className="resource-runtime-banner resource-marketplace-account-banner"',
    );
    expect(resourceCenterSource).not.toContain("Import client JSON");
    expect(resourceCenterSource).not.toContain("导入客户端 JSON");
    expect(resourceCenterSource).not.toContain("importGoogleOAuthClient");
    expect(resourceCenterSource).toContain(
      "googleAccount?.grants[grant].authorized ? (",
    );
    expect(resourceCenterSource).toContain('"已授权"');
    expect(resourceCenterSource).toContain('"Authorized"');
    expect(resourceCenterSource).not.toContain("Workspace 本地边界");
    expect(resourceCenterSource).not.toContain("Local Workspace boundary");
    expect(resourceCenterSource).not.toContain("saveGoogleBoundary");
    expect(resourceCenterSource).not.toContain("setGoogleWorkspaceBoundary");
    expect(resourceCenterSource).toContain(
      "此版本的 Artemis 未包含应用级 Google OAuth 客户端",
    );
    expect(resourceCenterSource).toContain(
      "This Artemis build does not include its application-level Google OAuth client.",
    );
    expect(resourceCenterSource).toContain(
      "Google 未授予此插件所需的全部权限。请在授权页面允许所有请求的权限后重试。",
    );
    expect(resourceCenterSource).toContain(
      "Google did not grant all permissions required by this plugin. Allow every requested permission and try again.",
    );
    expect(mainProcessSource).toContain(
      "await loadGoogleOAuthClient(googleOAuthClientPath())",
    );
    expect(apiSource).not.toContain("googleAccountImportClient");
    expect(apiSource).not.toContain("GoogleOAuthClientImportResult");
    expect(apiSource).not.toContain("GoogleWorkspaceBoundaryInput");
    expect(apiSource).not.toContain("googleAccountBoundarySet");
    expect(preloadSource).not.toContain("setGoogleWorkspaceBoundary");
    expect(mainProcessSource).not.toContain('"com.artemis.google/config"');
  });

  it("refreshes renderer MCP state after Google grant authorization", () => {
    const authorizeStart = resourceCenterSource.indexOf(
      "async function authorizeGoogleGrant",
    );
    const authorizeEnd = resourceCenterSource.indexOf(
      "async function disconnectGoogleGrant",
      authorizeStart,
    );
    const authorize = resourceCenterSource.slice(authorizeStart, authorizeEnd);
    const grant = authorize.indexOf("window.artemis.authorizeGoogleGrant");
    const settings = authorize.indexOf("window.artemis.getSettings");

    expect(grant).toBeGreaterThan(-1);
    expect(settings).toBeGreaterThan(grant);
    expect(authorize).toContain("setMcpServers(next.mcpServers)");
    expect(authorize).toContain("onSettingsChange(next)");
  });

  it("refreshes renderer MCP state after disconnecting Google grants", () => {
    const grantStart = resourceCenterSource.indexOf(
      "async function disconnectGoogleGrant",
    );
    const accountStart = resourceCenterSource.indexOf(
      "async function disconnectGoogleAccount",
      grantStart,
    );
    const accountEnd = resourceCenterSource.indexOf(
      "async function removeMarketplace",
      accountStart,
    );
    const grantDisconnect = resourceCenterSource.slice(
      grantStart,
      accountStart,
    );
    const accountDisconnect = resourceCenterSource.slice(
      accountStart,
      accountEnd,
    );

    for (const disconnect of [grantDisconnect, accountDisconnect]) {
      expect(disconnect).toContain("window.artemis.getSettings");
      expect(disconnect).toContain("setMcpServers(next.mcpServers)");
      expect(disconnect).toContain("onSettingsChange(next)");
    }
  });

  it("renders disconnected MCP servers with their switches off", () => {
    const mcpStart = resourceCenterSource.indexOf('managementTab === "mcp" &&');
    const mcpEnd = resourceCenterSource.indexOf(
      'managementTab === "skills" &&',
      mcpStart,
    );
    const mcpSection = resourceCenterSource.slice(mcpStart, mcpEnd);
    expect(mcpSection).toContain('checked={server.state === "connected"}');
    expect(mcpSection).not.toContain("checked={server.config.enabled}");
  });

  it("keeps configuration import source checkboxes compact", () => {
    const checkbox = cssRule(
      ".settings-section .configuration-import-source > input",
    );

    expect(checkbox).toMatch(/\bflex:\s*0 0 auto/u);
    expect(checkbox).toMatch(/\bheight:\s*auto/u);
    expect(checkbox).toMatch(/\bwidth:\s*auto/u);
  });

  it("lets capability-center MCP entries be removed", () => {
    expect(resourceCenterSource).toContain("window.artemis.removeMcpServer");
    expect(resourceCenterSource).toContain(
      'className="resource-icon-button danger"',
    );
  });

  it("keeps resource search editable and notices aligned after installation", () => {
    const noticeRule = cssDeclarationsForSelector(".catalog-message");
    expect(noticeRule).toMatch(/\bmargin:\s*0 auto 9px/u);
    expect(noticeRule).toMatch(/\bwidth:\s*100%/u);
    expect(resourceCenterSource).toContain("ref={catalogSearchRef}");
    expect(resourceCenterSource).toContain("focusCatalogSearch()");
    expect(resourceCenterSource).toContain("value={catalogQuery}");
    expect(resourceCenterSource).not.toMatch(
      /<input[\s\S]*?disabled=\{installProgress/u,
    );
  });

  it("distinguishes active, empty, and untouched MCP and Skill searches", () => {
    expect(resourceCenterSource).toContain("catalogSearchPhase");
    expect(resourceCenterSource).toContain("setMcpResults([])");
    expect(resourceCenterSource).toContain("setSkillResults([])");
    expect(resourceCenterSource).toContain("t.searchingMcp");
    expect(resourceCenterSource).toContain("t.searchingSkills");
    expect(resourceCenterSource).toContain("t.noMcpCatalogResults");
    expect(resourceCenterSource).toContain("t.noSkillCatalogResults");
    expect(resourceCenterSource).toContain('role="status"');
    expect(stylesSource).toContain(".resource-search-spinner");
    const mcpSearch = resourceCenterSource.indexOf("aria-label={t.searchMcp}");
    const mcpList = resourceCenterSource.indexOf(
      'className="resource-management-list grouped"',
      mcpSearch,
    );
    const skillSearch = resourceCenterSource.indexOf(
      "aria-label={t.searchSkills}",
    );
    const skillList = resourceCenterSource.indexOf(
      'className="resource-management-list"',
      skillSearch,
    );
    expect(mcpSearch).toBeGreaterThan(-1);
    expect(mcpList).toBeGreaterThan(mcpSearch);
    expect(skillSearch).toBeGreaterThan(-1);
    expect(skillList).toBeGreaterThan(skillSearch);
    for (const view of [
      "mcp-search-loading",
      "mcp-search-empty",
      "skill-search-loading",
      "skill-search-empty",
    ]) {
      expect(mainProcessSource).toContain(view);
    }
  });

  it("uses the in-app confirmation dialog while preserving native file-picker focus", () => {
    expect(resourceCenterSource).not.toContain("window.confirm(");
    expect(resourceCenterSource).not.toContain("confirmResourceAction");
    expect(resourceCenterSource).toContain("await onConfirm(");
    expect(appSource).toContain('role="alertdialog"');
    expect(appSource).toContain('className="confirmation-backdrop"');
    expect(mainProcessSource).toContain("restoreResourceDialogFocus");
    expect(mainProcessSource).toMatch(
      /selection = await dialog\.showOpenDialog[\s\S]*?restoreResourceDialogFocus\(/u,
    );
  });

  it("keeps the composer keyboard-focusable after an archived task is restored", () => {
    const archiveHandlerStart = appSource.indexOf(
      "const setThreadArchived = useCallback(",
    );
    const archiveHandlerEnd = appSource.indexOf(
      "\n  const forkThread",
      archiveHandlerStart,
    );
    const archiveHandler = appSource.slice(
      archiveHandlerStart,
      archiveHandlerEnd,
    );

    expect(archiveHandlerStart).toBeGreaterThan(-1);
    expect(archiveHandlerEnd).toBeGreaterThan(archiveHandlerStart);
    expect(archiveHandler).not.toContain("window.confirm(");
    expect(archiveHandler).toContain(
      "await requestConfirmation(t.archiveConfirm)",
    );
    expect(archiveHandler).toMatch(
      /setActiveThreadId\(updated\.id\);[\s\S]*?requestAnimationFrame\(\(\) =>\s*promptInput\.current\?\.focus\(\)/u,
    );
  });

  it("shows real Skill and MCP installation progress through isolated IPC", () => {
    expect(apiSource).toContain("export interface ResourceInstallProgress");
    expect(apiSource).toContain("onResourceInstallProgress(");
    expect(apiSource).toContain(
      'resourceInstallProgress: "artemis:resource-install-progress"',
    );
    expect(preloadSource).toContain(
      "ipcRenderer.on(IPC.resourceInstallProgress",
    );
    expect(mainProcessSource).toContain("IPC.resourceInstallProgress");
    expect(resourceCenterSource).toContain('role="progressbar"');
    expect(resourceCenterSource).toContain(
      'className="catalog-progress-track"',
    );
    expect(resourceCenterSource).toContain("installProgress.percent");
  });

  it("makes the local Skill installer visibly interactive", () => {
    expect(resourceCenterSource).toContain(
      'className="resource-add-button subtle"',
    );
    const action = cssRule(".resource-add-button.subtle");
    expect(action).toMatch(/\bborder-color:\s*var\(--border-soft\)/u);
    expect(action).toMatch(/\bcolor:\s*var\(--text\)/u);
    expect(cssRule(".resource-add-button.subtle:hover:not(:disabled)")).toMatch(
      /\bbackground:\s*var\(--hover\)/u,
    );
  });

  it("installs a local Skill only from the Skills tab and refreshes the installed cache", () => {
    expect(resourceCenterSource).toContain(
      'installLocalSkill: "Install local Skill"',
    );
    expect(resourceCenterSource).toContain('managementTab === "skills" &&');
    expect(resourceCenterSource).toContain(
      "window.artemis.installLocalSkill(operationId)",
    );
    expect(resourceCenterSource).toContain("if (!installed) return;");
    expect(resourceCenterSource).toContain(
      "installedSkillsCache = await window.artemis.listInstalledSkills()",
    );
    expect(resourceCenterSource).toContain(
      "setInstalledSkills(installedSkillsCache)",
    );
  });

  it("routes local Skill installation through a native directory-picker IPC contract", () => {
    expect(apiSource).toContain(
      "installLocalSkill(operationId: string): Promise<InstalledSkill | undefined>;",
    );
    expect(apiSource).toContain(
      'resourceSkillInstallLocal: "artemis:resource-skill-install-local"',
    );
    expect(preloadSource).toMatch(
      /installLocalSkill:\s*\(operationId\)\s*=>\s*ipcRenderer\.invoke\(IPC\.resourceSkillInstallLocal,\s*operationId\)/u,
    );
    expect(mainProcessSource).toContain("IPC.resourceSkillInstallLocal");
    expect(mainProcessSource).toContain('properties: ["openDirectory"]');
    expect(mainProcessSource).toMatch(
      /if\s*\(\s*selection\.canceled\s*\|\|\s*selection\.filePaths\.length\s*!==\s*1\s*\)\s*return undefined;/u,
    );
    expect(mainProcessSource).toContain(
      "resourceCatalogService.installLocalSkill(",
    );
    expect(mainProcessSource).toContain("selection.filePaths[0]");
    expect(mainProcessSource).toContain(
      "(percent) => publish(10 + percent * 0.7)",
    );
  });

  it("lets installed Skills be removed through the managed catalog root", () => {
    expect(resourceCenterSource).toContain("window.artemis.removeSkill");
    expect(apiSource).toContain(
      "removeSkill(skillId: string): Promise<InstalledSkill[]>;",
    );
    expect(apiSource).toContain(
      'resourceSkillRemove: "artemis:resource-skill-remove"',
    );
    expect(preloadSource).toMatch(
      /removeSkill:\s*\(skillId\)\s*=>\s*ipcRenderer\.invoke\(IPC\.resourceSkillRemove,\s*skillId\)/u,
    );
    expect(mainProcessSource).toContain("IPC.resourceSkillRemove");
    expect(mainProcessSource).toContain("resourceCatalogService.removeSkill");
  });

  it("routes multi-marketplace plugin compatibility through isolated Resource Center IPC", () => {
    expect(resourceCenterSource).toContain('plugins: "Plugins"');
    expect(resourceCenterSource).toContain('plugins: "插件"');
    expect(resourceCenterSource).toContain(
      "window.artemis.getCodexPluginMarketplaces()",
    );
    expect(resourceCenterSource).toContain(
      "window.artemis.inspectLocalCodexPlugin()",
    );
    expect(resourceCenterSource).toContain(
      "window.artemis.addCodexPluginMarketplace(",
    );
    expect(resourceCenterSource).toContain(
      "window.artemis.refreshCodexPluginMarketplace(",
    );
    expect(resourceCenterSource).toContain(
      "window.artemis.reorderCodexPluginMarketplaces(",
    );
    expect(resourceCenterSource).toContain(
      "window.artemis.removeCodexPluginMarketplace(",
    );
    expect(resourceCenterSource).toContain(
      "window.artemis.installCodexPlugin(",
    );
    expect(resourceCenterSource).toContain("window.artemis.updateCodexPlugin(");
    expect(resourceCenterSource).toContain("window.artemis.removeCodexPlugin(");
    expect(resourceCenterSource).toContain(
      "MCP servers and Connectors will be installed disabled",
    );

    for (const method of [
      "listCodexPlugins",
      "inspectLocalCodexPlugin",
      "loadCodexPluginMarketplace",
      "getCodexPluginMarketplaces",
      "addCodexPluginMarketplace",
      "selectCodexPluginMarketplace",
      "refreshCodexPluginMarketplace",
      "removeCodexPluginMarketplace",
      "reorderCodexPluginMarketplaces",
      "loadCodexRuntimeMarketplace",
      "installCodexRuntimePlugins",
      "installCodexPlugin",
      "updateCodexPlugin",
      "setCodexPluginEnabled",
      "removeCodexPlugin",
    ]) {
      expect(apiSource).toContain(`${method}(`);
      expect(preloadSource).toContain(`${method}:`);
    }
    for (const channel of [
      "resourcePluginList",
      "resourcePluginInspectLocal",
      "resourcePluginMarketplaceLoad",
      "resourcePluginMarketplaceList",
      "resourcePluginMarketplaceAdd",
      "resourcePluginMarketplaceSelect",
      "resourcePluginMarketplaceRefresh",
      "resourcePluginMarketplaceRemove",
      "resourcePluginMarketplaceReorder",
      "resourcePluginRuntimeMarketplace",
      "resourcePluginRuntimeInstall",
      "resourcePluginInstall",
      "resourcePluginUpdate",
      "resourcePluginEnable",
      "resourcePluginRemove",
    ]) {
      expect(apiSource).toContain(channel);
      expect(preloadSource).toContain(`IPC.${channel}`);
      expect(mainProcessSource).toContain(`IPC.${channel}`);
    }
    expect(mainProcessSource).toContain("new CodexPluginService({");
    expect(mainProcessSource).toContain('"codex-plugins"');
    expect(mainProcessSource).toContain('"codex-plugins.json"');
    expect(mainProcessSource).toContain('"codex-plugin-marketplaces.json"');
    expect(mainProcessSource).toContain(
      "bundledArtifactRoot: bundledArtifactPluginsPath()",
    );
    expect(mainProcessSource).toContain(
      'join(process.resourcesPath, "resources", "bundled-artifact-plugins")',
    );
    expect(resourceCenterSource).toContain(
      "managedMcpIds.has(server.config.id)",
    );
    expect(resourceCenterSource).toContain("managedSkillNames.has(skill.name)");
    expect(resourceCenterSource).toContain(
      '(["plugins", "connectors", "mcp", "skills"] as const)',
    );
    expect(resourceCenterSource).not.toContain('managementTab === "apps"');
    expect(resourceCenterSource).toContain('managementTab === "connectors" &&');
    expect(resourceCenterSource).toContain('resourceKind: "connector"');
    expect(resourceCenterSource).toContain("authorizeMcpServer(serverId)");
    const labelsStart = resourceCenterSource.indexOf("const labels =");
    const labelsEnd = resourceCenterSource.indexOf(
      "function CatalogIcon",
      labelsStart,
    );
    const visibleLabels = resourceCenterSource.slice(labelsStart, labelsEnd);
    expect(visibleLabels).not.toMatch(
      /:\s*["'`][^"'`\n]*(?:Codex|OpenAI)[^"'`\n]*["'`]/u,
    );
    expect(resourceCenterSource).toContain("function pluginPageText");
    expect(resourceCenterSource).toContain(
      "pluginPageText(plugin.displayName)",
    );
    expect(resourceCenterSource).toContain("pluginPageText(message)");
    expect(resourceCenterSource).toContain(
      "pluginPageText(server.config.name)",
    );
    expect(resourceCenterSource).toContain("marketplaceSourceLabel(source)");
    expect(resourceCenterSource).toContain("t.marketplaceStale");
    expect(resourceCenterSource).toContain("pluginSkillConflict(plugin)");
    expect(resourceCenterSource).toContain(
      "plugin.source.pluginName === skill.name",
    );
    expect(resourceCenterSource).toContain("pluginsForMarketplace(source.id)");
    expect(resourceCenterSource).not.toContain(
      "pluginsForMarketplace(source.id, false)",
    );
    expect(resourceCenterSource).toContain("marketplaceGroups.length === 0");
    expect(stylesSource).toContain(".resource-marketplace-source-row");
    expect(resourceCenterSource).toContain(
      "data-tooltip={t.removeMarketplace}",
    );
    expect(resourceCenterSource).toContain(
      "resource-marketplace-remove-button",
    );
    expect(stylesSource).toContain(
      ".resource-marketplace-remove-button:hover::after",
    );
    expect(stylesSource).toContain(".plugin-market-source");
    expect(resourceCenterSource).not.toContain("{marketplace.name}");
    expect(resourceCenterSource).toContain(
      "(skill) => !managedSkillNames.has(skill.name)",
    );
    expect(apiSource).toContain("iconDataUrl?: string;");
    expect(resourceCenterSource).toContain("function visualForPlugin");
    expect(resourceCenterSource).toContain(
      "iconDataUrl: bundled?.iconDataUrl ?? plugin.iconDataUrl",
    );
    expect(resourceCenterSource).toMatch(
      /plugin\.source\.kind === "bundled" \|\| plugin\.source\.kind === "runtime"[\s\S]*?\? undefined[\s\S]*?: sourceId/u,
    );
    expect(mainProcessSource).toContain("MCP server is managed by plugin");
    const skillEnableHandler = mainProcessSource.slice(
      mainProcessSource.indexOf("IPC.resourceSkillEnable"),
      mainProcessSource.indexOf("IPC.resourceSkillRemove"),
    );
    const skillRemoveHandler = mainProcessSource.slice(
      mainProcessSource.indexOf("IPC.resourceSkillRemove"),
      mainProcessSource.indexOf("IPC.resourcePluginList"),
    );
    expect(skillEnableHandler).not.toContain("Skill is managed by plugin");
    expect(skillRemoveHandler).toContain("Skill is managed by plugin");
    expect(mainProcessSource).toContain("current.url !== previous.url");
    expect(mainProcessSource).toContain("reconcileManagedPluginSkills(");
    expect(mainProcessSource).toContain("previousSkillState");
    expect(resourceCenterSource).toContain("marketplaceStateCache");
    expect(resourceCenterSource).toContain("runtimeMarketplaceCache");
    expect(resourceCenterSource).toContain("void runtimeRequest");
    expect(resourceCenterSource).toContain("void marketplaceRequest");
    expect(resourceCenterSource).not.toContain(
      "Promise.allSettled([marketplaceRequest, runtimeRequest])",
    );
    expect(resourceCenterSource).toContain(
      ".filter((plugin) => plugin.installable)",
    );
    expect(resourceCenterSource).toContain("Boolean(conflict)");
    expect(resourceCenterSource).toContain("data-tooltip={item.name}");
    expect(resourceCenterSource).toContain(
      'resourceIconName(skill.name, "skill")',
    );
    expect(resourceCenterSource).toContain(
      "onError={() => setImageFailed(true)}",
    );
    expect(resourceCenterSource).toContain(
      "data-icon={semanticVisible ? semanticIcon : undefined}",
    );
    expect(resourceIconsSource).toContain("MagicWandIcon");
    expect(resourceIconsSource).toContain("PlugsConnectedIcon");
    expect(resourceIconsSource).toContain('weight="duotone"');
    expect(stylesSource).toContain(
      ".resource-avatar[data-icon] .resource-semantic-icon path[opacity]",
    );
    expect(resourceCenterSource).toContain("plugin.iconDataUrl");
    expect(stylesSource).toContain(".resource-installed-icon-button::after");
    expect(stylesSource).toContain(".resource-runtime-banner");
    expect(runtimeSource).toContain('name: "load_workspace_dependencies"');
    expect(runtimeSource).toContain("resolveCodexWorkspaceDependencies()");
    expect(agentProcessSource).toContain("ARTEMIS_CODEX_RUNTIME_ROOT");
  });

  it("starts OAuth only after an explicit enable action needs authorization", () => {
    expect(mainProcessSource).toContain(
      'status.state === "authorization-required"',
    );
    const saveMcpStart = mainProcessSource.indexOf(
      "async function saveMcpConfiguration",
    );
    const saveMcpEnd = mainProcessSource.indexOf(
      "async function refreshTrustedExtensions",
      saveMcpStart,
    );
    expect(mainProcessSource.slice(saveMcpStart, saveMcpEnd)).toContain(
      "await connectMcpServer(saved, true, connectionOptions)",
    );

    const pluginEnableStart = mainProcessSource.indexOf(
      "IPC.resourcePluginEnable",
    );
    const pluginEnableEnd = mainProcessSource.indexOf(
      "IPC.resourcePluginRemove",
      pluginEnableStart,
    );
    expect(mainProcessSource.slice(pluginEnableStart, pluginEnableEnd)).toMatch(
      /reconnectEnabledMcpServers\([\s\S]*?,\s*true,?\s*\)/u,
    );

    const startupStart = mainProcessSource.indexOf(
      "async function initializeOptionalCapabilities",
    );
    const startupEnd = mainProcessSource.indexOf(
      "function pathIsInside",
      startupStart,
    );
    const startupSource = mainProcessSource.slice(startupStart, startupEnd);
    expect(startupSource).not.toContain("authorizeMcpServer(");
    expect(startupSource).not.toContain("connectMcpServer(");
  });

  it("waits for cold Registry npm MCP startup and rejects failed connections", () => {
    const connectStart = mainProcessSource.indexOf(
      "async function connectMcpServer",
    );
    const connectEnd = mainProcessSource.indexOf(
      "async function ensureGoogleMcpReady",
      connectStart,
    );
    const connectSource = mainProcessSource.slice(connectStart, connectEnd);
    expect(connectSource).toContain('status.state === "failed"');
    expect(connectSource).toContain("throw new Error(");

    const installStart = mainProcessSource.indexOf("IPC.resourceMcpInstall");
    const installEnd = mainProcessSource.indexOf(
      "IPC.resourceSkillSearch",
      installStart,
    );
    const installSource = mainProcessSource.slice(installStart, installEnd);
    expect(installSource).toContain("MCP_REGISTRY_NPM_STARTUP_TIMEOUT_MS");
    expect(installSource).toContain("startupTimeoutMs:");
  });

  it("packages four runtime-free Lite artifact plugins on macOS and Windows", () => {
    expect(rootPackage.scripts["package:mac"]).toBe(
      "npm run package:mac -w @artemis/desktop",
    );
    expect(rootPackage.scripts["package:mac:arm64"]).toBe(
      "npm run package:mac:arm64 -w @artemis/desktop",
    );
    expect(rootPackage.scripts["package:mac:x64"]).toBe(
      "npm run package:mac:x64 -w @artemis/desktop",
    );
    expect(desktopPackage.scripts["package:mac"]).toBe(
      "node scripts/package-mac-lite.mjs all",
    );
    expect(desktopPackage.scripts["package:mac:arm64"]).toBe(
      "node scripts/package-mac-lite.mjs arm64",
    );
    expect(desktopPackage.scripts["package:mac:x64"]).toBe(
      "node scripts/package-mac-lite.mjs x64",
    );
    for (const target of desktopPackage.build.mac.target) {
      expect(target.arch).toEqual(["arm64", "x64"]);
    }
    expect(desktopPackage.scripts["release:mac"]).toBe(
      "node scripts/package-mac-lite.mjs all --release",
    );
    expect(macPackageScriptSource).toContain(
      '"scripts/release-builder.config.cjs"',
    );
    expect(macPackageScriptSource).toContain(
      '["scripts/validate-release-env.mjs", "mac"]',
    );
    expect(macPackageScriptSource).toContain(
      '["scripts/finalize-release.mjs"]',
    );
    expect(releaseBuilderSource).toContain(
      "...(process.env.ARTEMIS_WINDOWS_PUBLISHER",
    );
    expect(releaseBuilderSource).toContain(
      "? { publisherName: process.env.ARTEMIS_WINDOWS_PUBLISHER }",
    );
    const invalidArchitecture = spawnSync(
      process.execPath,
      [macPackageScriptPath, "universal"],
      { encoding: "utf8" },
    );
    expect(invalidArchitecture.status).not.toBe(0);
    expect(invalidArchitecture.stderr).toContain(
      "Unsupported macOS package architecture: universal. Expected all, arm64 or x64.",
    );
    expect(macPackageScriptSource).toContain(
      'const packageName = "@napi-rs/canvas-darwin-x64"',
    );
    expect(macPackageScriptSource).toContain(
      "await cleanupStagedDependencies()",
    );
    expect(desktopPackage.scripts["package:win"]).toBe(
      "node scripts/package-windows-lite.mjs",
    );
    expect(windowsPackageScriptSource).toContain(
      '[npmCli, "run", "verify:bundled-plugins"]',
    );
    expect(windowsPackageScriptSource).toContain('"--win"');
    expect(windowsPackageScriptSource).toContain('"zip"');
    expect(windowsPackageScriptSource).toContain('"--x64"');
    expect(desktopPackage.scripts["package:win:portable"]).toBeUndefined();
    expect(desktopPackage.scripts["release:win"]).toContain(
      "node scripts/package-windows-lite.mjs --release",
    );
    for (const plugin of [
      "documents",
      "pdf",
      "spreadsheets",
      "presentations",
    ]) {
      expect(bundledMarketplaceSource).toContain(`"${plugin}"`);
    }
    expect(macPackageScriptSource).toContain('"build:core"');
    expect(macPackageScriptSource).toContain('"verify:bundled-plugins"');
    expect(macPackageScriptSource).toContain(
      'output("/usr/bin/xcrun", ["--find", "actool"])',
    );
    expect(macPackageScriptSource).toContain("Xcode 26 or later is required");
    expect(engineeringBuilderSource).toContain('icon: "build/icon.png"');
    expect(engineeringBuilderSource).toContain("identity: null");
    expect(engineeringBuilderSource).toContain(
      'afterPack: "scripts/apply-engineering-package-permissions.cjs"',
    );
    expect(
      `${macPackageScriptSource}\n${windowsPackageScriptSource}\n${engineeringBuilderSource}\n${JSON.stringify(desktopPackage.scripts)}`,
    ).not.toContain("codex-primary-runtime");
  });

  it("lets users edit global AGENTS.md and selectively import other agents", () => {
    expect(settingsSource).toContain("settings.globalAgents.content");
    expect(settingsSource).toContain("window.artemis.saveGlobalAgents");
    expect(settingsSource).toContain("window.artemis.scanConfigurationImports");
    expect(settingsSource).toContain("window.artemis.importConfiguration");
    expect(settingsSource).toContain('"Codex"');
    expect(settingsSource).toContain('"OpenCode"');
    expect(settingsSource).toContain('"Claude Code"');
  });

  it("edits an installed stdio MCP server with structured Codex-style fields", () => {
    expect(apiSource).toContain("env: Record<string, string>;");
    expect(apiSource).toContain("envVars: string[];");
    expect(mcpServerEditorSource).toContain("server.config.command");
    expect(mcpServerEditorSource).toContain("server.config.args");
    expect(mcpServerEditorSource).toContain("server.config.env");
    expect(mcpServerEditorSource).toContain("server.config.envVars");
    expect(mcpServerEditorSource).toContain("server.config.workspacePath");
    expect(mcpServerEditorSource).toMatch(/argumentsList\.map\(/u);
    expect(mcpServerEditorSource).toMatch(/environment\.map\(/u);
    expect(mcpServerEditorSource).toMatch(/environmentVariables\.map\(/u);
    expect(mcpServerEditorSource).not.toContain(
      "MCP arguments must be a JSON string array",
    );
    expect(mcpServerEditorSource).toContain("window.artemis.saveMcpServer");
    expect(mcpServerEditorSource).toContain("window.artemis.removeMcpServer");
  });

  it("omits identity and transport controls from the MCP editor", () => {
    expect(mcpServerEditorSource).not.toContain(
      "<strong>{t.serverId}</strong>",
    );
    expect(mcpServerEditorSource).not.toContain(
      "<strong>{t.serverName}</strong>",
    );
    expect(mcpServerEditorSource).not.toContain(
      "<strong>{t.transport}</strong>",
    );
    expect(mcpServerEditorSource).not.toContain(
      '<CodexSelect<McpServerConfig["transport"]>',
    );
  });

  it("enables Save and connect from the command or URL and prefills imported servers", () => {
    expect(mcpServerEditorSource).toMatch(
      /className="mcp-editor-save"\s+disabled=\{busy \|\| !endpoint\.trim\(\)\}/u,
    );
    expect(mcpServerEditorSource).not.toContain("!workspace.trim()");
    expect(mcpServerEditorSource).not.toContain("!serverId.trim()");
    expect(mcpServerEditorSource).not.toContain("!name.trim()");
    expect(mcpServerEditorSource).toContain("server.config.command");
    expect(mcpServerEditorSource).toContain("server.config.args");
    expect(mcpServerEditorSource).toContain(
      "Object.entries(server.config.env)",
    );
    expect(mcpServerEditorSource).toContain("server.config.envVars");
    expect(mcpServerEditorSource).toContain("server.config.workspacePath");
    expect(mcpServerEditorSource).toContain("server.config.url");
  });

  it("renders settings actions as visually distinct primary and secondary buttons", () => {
    const buttonBefore = (label: string) => {
      const labelIndex = settingsSource.indexOf(`{t.${label}}`);
      expect(labelIndex).toBeGreaterThan(-1);
      const buttonIndex = settingsSource.lastIndexOf("<button", labelIndex);
      return settingsSource.slice(buttonIndex, labelIndex);
    };

    for (const label of ["saveModel", "saveProvider", "saveGlobalAgents"]) {
      expect(buttonBefore(label)).toContain(
        'className="settings-primary-action"',
      );
    }

    for (const label of [
      "importPi",
      "scanImports",
      "exportDiagnostics",
      "checkUpdates",
    ]) {
      expect(buttonBefore(label)).toContain(
        'className="settings-secondary-action"',
      );
    }

    expect(cssRule(".settings-primary-action")).toMatch(
      /\bbackground:\s*var\(--accent\)/u,
    );
    expect(cssRule(".settings-secondary-action")).toMatch(
      /\bborder:\s*1px solid/u,
    );
    expect(stylesSource).toContain(
      ".settings-section .settings-secondary-action:disabled",
    );
  });

  it("keeps settings primary actions visible in the light theme above generic button rules", () => {
    const lightTheme = stylesSource.match(
      /:root\[data-theme="light"\]\s*\{(?<declarations>[^}]*)\}/u,
    )?.groups?.declarations;
    const primaryAction = cssRule(".settings-primary-action");
    const genericSelector = stylesSource.match(
      /(?<selector>\.settings-section\s*>\s*button[^,{]*,\s*\.credential-form\s*>\s*button[^{]*)\{/u,
    )?.groups?.selector;
    const scopedOverride = stylesSource.match(
      /\.settings-section\s*>\s*\.settings-primary-action(?:\s*,\s*\.credential-form\s*>\s*\.settings-primary-action)?\s*\{(?<declarations>[^}]*)\}/u,
    )?.groups?.declarations;

    expect(lightTheme).toMatch(/--accent:\s*#202124/u);
    expect(lightTheme).toMatch(/--accent-text:\s*#ffffff/u);
    expect(primaryAction).toMatch(/\bbackground:\s*var\(--accent\)/u);
    expect(primaryAction).toMatch(/\bcolor:\s*var\(--accent-text\)/u);
    expect(
      genericSelector?.includes(":not(.settings-primary-action)") ||
        Boolean(scopedOverride),
      "the generic settings button rule must exclude primary actions or have a higher-specificity primary override",
    ).toBe(true);
    if (scopedOverride) {
      expect(scopedOverride).toMatch(/\bbackground:\s*var\(--accent\)/u);
      expect(scopedOverride).toMatch(/\bcolor:\s*var\(--accent-text\)/u);
    }
  });

  it("moves plugin and extension installation out of Settings", () => {
    const labelIndex = resourceCenterSource.lastIndexOf("{t.trustExtension}");
    expect(labelIndex).toBeGreaterThan(-1);
    const buttonIndex = resourceCenterSource.lastIndexOf("<button", labelIndex);
    const trustButton = resourceCenterSource.slice(buttonIndex, labelIndex);

    expect(trustButton).toContain("onClick={() => void trustExtension()}");
    expect(resourceCenterSource).toContain('mode === "add-plugin"');
    expect(resourceCenterSource).toContain("{t.gitMarketplace}");
    expect(resourceCenterSource).toContain("{t.offlineMarketplace}");
    expect(resourceCenterSource).toContain(
      "inspectOfflineCodexPluginMarketplace",
    );
    expect(resourceCenterSource).toContain("addOfflineCodexPluginMarketplace");
    expect(resourceCenterSource).toContain("{t.localPlugin}");
    expect(settingsSource).not.toContain("window.artemis.trustExtension");
    expect(settingsSource).not.toContain("window.artemis.retrustExtension");
  });
});
