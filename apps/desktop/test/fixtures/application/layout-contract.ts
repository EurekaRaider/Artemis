import { readAutomationPageSources } from "./automation-source.js";
import { readSettingsPanelSources } from "./settings-source.js";
import {
  readSharedApiSources,
  readPreloadBridgeSources,
} from "./api-source.js";
import { readResourceCenterSources } from "./resource-center-source.js";
import { readAgentRuntimeSources } from "./agent-runtime-source.js";
import { readDesktopStyles } from "./styles-source.js";
import { readRendererAppSources } from "./renderer-source.js";
import { readMainProcessSources } from "./main-source.js";

import { findCssDeclarations } from "../../contracts/css-test-utils.js";

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";

export const appSource = readRendererAppSources();
export const approvalDecisionSource = readFileSync(
  new URL(
    "../../../src/renderer/conversation/ApprovalDecisionCard.tsx",
    import.meta.url,
  ),
  "utf8",
);
export const userInputSource = readFileSync(
  new URL(
    "../../../src/renderer/conversation/UserInputCard.tsx",
    import.meta.url,
  ),
  "utf8",
);
export const decisionSource = readFileSync(
  new URL(
    "../../../src/renderer/conversation/DecisionCard.tsx",
    import.meta.url,
  ),
  "utf8",
);
export const composerContextSource = readFileSync(
  fileURLToPath(
    new URL(
      "../../../src/renderer/conversation/ComposerContextBar.tsx",
      import.meta.url,
    ),
  ),
  "utf8",
);
export const automationPageSource = readAutomationPageSources();
export const archivePageSource = readFileSync(
  fileURLToPath(
    new URL("../../../src/renderer/app/ArchivePage.tsx", import.meta.url),
  ),
  "utf8",
);
export const stylesSource = readDesktopStyles("styles");
export const nocturneStylesSource = readDesktopStyles("nocturne");
export const compositionStylesSource = readDesktopStyles("prototype-migration");
export const publicUiStylesSource = readFileSync(
  fileURLToPath(
    new URL("../../../../../packages/ui/src/styles.css", import.meta.url),
  ),
  "utf8",
);
export const publicUiSurfacesSource = readFileSync(
  fileURLToPath(
    new URL("../../../../../packages/ui/src/surfaces.tsx", import.meta.url),
  ),
  "utf8",
);
export const publicUiProfessionalSource = readFileSync(
  fileURLToPath(
    new URL("../../../../../packages/ui/src/professional.tsx", import.meta.url),
  ),
  "utf8",
);
export const settingsSource = readSettingsPanelSources();
export const providerWorkspaceSource = readFileSync(
  fileURLToPath(
    new URL(
      "../../../src/renderer/settings/ProviderWorkspace.tsx",
      import.meta.url,
    ),
  ),
  "utf8",
);
export const resourceCenterSource = readResourceCenterSources();
export const resourceIconsSource = readFileSync(
  fileURLToPath(
    new URL(
      "../../../src/renderer/plugins/resource-icons.tsx",
      import.meta.url,
    ),
  ),
  "utf8",
);
export const mcpServerEditorSource = readFileSync(
  fileURLToPath(
    new URL("../../../src/renderer/mcp/McpServerEditor.tsx", import.meta.url),
  ),
  "utf8",
);
export const apiSource = readSharedApiSources();
export const browserLocaleSource = readFileSync(
  fileURLToPath(
    new URL("../../../src/shared/i18n/browser-locale.ts", import.meta.url),
  ),
  "utf8",
);
export const preloadSource = readPreloadBridgeSources();
export const terminalSource = readFileSync(
  fileURLToPath(
    new URL(
      "../../../src/renderer/terminal/TerminalPanel.tsx",
      import.meta.url,
    ),
  ),
  "utf8",
);
export const workspacePreviewSource = readFileSync(
  fileURLToPath(
    new URL(
      "../../../src/renderer/workspace/WorkspacePreviewPanel.tsx",
      import.meta.url,
    ),
  ),
  "utf8",
);
export const workspaceFilesSource = readFileSync(
  fileURLToPath(
    new URL(
      "../../../src/renderer/workspace/WorkspaceFilesPanel.tsx",
      import.meta.url,
    ),
  ),
  "utf8",
);
export const workspaceDockLayoutSource = readFileSync(
  fileURLToPath(
    new URL(
      "../../../src/renderer/workspace/workspace-dock-layout.ts",
      import.meta.url,
    ),
  ),
  "utf8",
);
export const mainProcessSource = readMainProcessSources();
export const smokeSource = [
  "../../../scripts/verify/ui/smoke/prepare-view.ts",
  "../../../scripts/verify/ui/smoke/window-capture.ts",
  "../../../scripts/verify/ui/smoke/collect-evidence.ts",
  "../smoke/ipc/resources.ts",
]
  .map((path) => readFileSync(new URL(path, import.meta.url), "utf8"))
  .join("\n");
export const rendererHtmlSource = readFileSync(
  fileURLToPath(new URL("../../../index.html", import.meta.url)),
  "utf8",
);
export const runtimeSource = readAgentRuntimeSources();
export const agentProcessSource = readFileSync(
  fileURLToPath(
    new URL("../../../src/main/agent/agent-process.ts", import.meta.url),
  ),
  "utf8",
);
export const macPackageScriptPath = fileURLToPath(
  new URL("../../../scripts/packaging/package-mac-lite.mjs", import.meta.url),
);
export const macPackageScriptSource = readFileSync(
  macPackageScriptPath,
  "utf8",
);
export const macIconBuildScriptPath = fileURLToPath(
  new URL("../../../scripts/build/build-macos-icon.mjs", import.meta.url),
);
export const macIconBuildSource = existsSync(macIconBuildScriptPath)
  ? readFileSync(macIconBuildScriptPath, "utf8")
  : "";
export const macIconPngPath = fileURLToPath(
  new URL("../../../build/icon-macos.png", import.meta.url),
);
export const windowsPackageScriptSource = readFileSync(
  fileURLToPath(
    new URL(
      "../../../scripts/packaging/package-windows-lite.mjs",
      import.meta.url,
    ),
  ),
  "utf8",
);
export const engineeringBuilderSource = readFileSync(
  fileURLToPath(
    new URL(
      "../../../scripts/packaging/engineering-builder.config.cjs",
      import.meta.url,
    ),
  ),
  "utf8",
);
export const releaseBuilderSource = readFileSync(
  fileURLToPath(
    new URL(
      "../../../scripts/packaging/release-builder.config.cjs",
      import.meta.url,
    ),
  ),
  "utf8",
);
export const bundledMarketplaceSource = readFileSync(
  fileURLToPath(
    new URL(
      "../../../resources/bundled-artifact-plugins/.artemis/marketplace.json",
      import.meta.url,
    ),
  ),
  "utf8",
);
export const taskPlanSource = readFileSync(
  fileURLToPath(
    new URL(
      "../../../src/renderer/conversation/TaskPlanProgress.tsx",
      import.meta.url,
    ),
  ),
  "utf8",
);
export const codexSelectSource = readFileSync(
  fileURLToPath(
    new URL(
      "../../../src/renderer/components/CodexSelect.tsx",
      import.meta.url,
    ),
  ),
  "utf8",
);
export const uiFormsSource = readFileSync(
  fileURLToPath(
    new URL("../../../../../packages/ui/src/forms.tsx", import.meta.url),
  ),
  "utf8",
);
export const uiManagementSource = readFileSync(
  fileURLToPath(
    new URL("../../../../../packages/ui/src/management.tsx", import.meta.url),
  ),
  "utf8",
);
export const uiPatternsSource = readFileSync(
  fileURLToPath(
    new URL("../../../../../packages/ui/src/patterns.tsx", import.meta.url),
  ),
  "utf8",
);
export const uiStylesSource = readFileSync(
  fileURLToPath(
    new URL("../../../../../packages/ui/src/styles.css", import.meta.url),
  ),
  "utf8",
);
export const skillCommandsSource = readFileSync(
  fileURLToPath(
    new URL("../../../src/renderer/plugins/skill-commands.ts", import.meta.url),
  ),
  "utf8",
);
export const promptHistorySource = readFileSync(
  fileURLToPath(
    new URL(
      "../../../src/renderer/conversation/prompt-history.ts",
      import.meta.url,
    ),
  ),
  "utf8",
);
export const toolActivityGroupsSource = readFileSync(
  fileURLToPath(
    new URL(
      "../../../src/renderer/conversation/tool-activity-groups.ts",
      import.meta.url,
    ),
  ),
  "utf8",
);
export const desktopPackage = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../../package.json", import.meta.url)),
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
export const rootPackage = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../../../../package.json", import.meta.url)),
    "utf8",
  ),
) as { scripts: Record<string, string> };
export const macIconSource = readFileSync(
  fileURLToPath(new URL("../../../build/icon.icns", import.meta.url)),
);
export function cssRule(selector: string): string {
  const declarations = findCssDeclarations(stylesSource, selector);
  expect(declarations, `Missing CSS rule for ${selector}`).toBeDefined();
  return declarations ?? "";
}
export function publicUiCssRule(selector: string): string {
  const declarations = findCssDeclarations(publicUiStylesSource, selector);
  expect(declarations, `Missing CSS rule for ${selector}`).toBeDefined();
  return declarations ?? "";
}
export function cssAtRule(pattern: RegExp): string | undefined {
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
export function cssDeclarationsForSelector(
  selector: string,
): string | undefined {
  return findCssDeclarations(stylesSource, selector);
}
export function publicUiCssDeclarationsForSelector(
  selector: string,
): string | undefined {
  return findCssDeclarations(publicUiStylesSource, selector);
}
export function hexProperty(declarations: string, property: string): string {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const value = declarations.match(
    new RegExp(`\\b${escaped}:\\s*["']?(?<value>#[\\da-f]{6})`, "iu"),
  )?.groups?.value;
  expect(value, `Missing ${property} hex color`).toBeDefined();
  return value!;
}
export function relativeLuminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/[\da-f]{2}/giu)!
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    );
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}
export function contrastRatio(first: string, second: string): number {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}
