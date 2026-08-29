import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const source = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

const appSource = source("../src/renderer/App.tsx");
const apiSource = source("../src/shared/api.ts");
const preloadSource = source("../src/preload/preload.ts");
const mainSource = source("../src/main/main.ts");
const settingsSource = source("../src/renderer/SettingsPanel.tsx");
const stylesSource = source("../src/renderer/styles.css");
const tokenUsageSource = source("../src/renderer/TokenUsagePage.tsx");

function cssDeclarations(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = stylesSource.match(
    new RegExp(`${escaped}\\s*\\{(?<body>[^}]*)\\}`, "u"),
  );
  expect(match, `Missing CSS selector ${selector}`).not.toBeNull();
  return match?.groups?.body ?? "";
}

describe("reported issue regressions #31-#42", () => {
  it("separates adjacent conversation states and tightens the first project gap", () => {
    expect(cssDeclarations(".project-thread-list")).toContain("gap: 2px");
    expect(
      cssDeclarations(".project-collection-rows > .nested-project:first-child"),
    ).toContain("margin-top: 6px");
  });

  it("keeps the provider menu name aligned with its combined scope", () => {
    expect(settingsSource).toContain('tabProviders: "供应商及模型配置"');
    expect(settingsSource).toContain('tabProviders: "Providers & models"');
  });

  it("aligns the completed turn row with the timeline and composer content", () => {
    const status = cssDeclarations(".turn-status");
    expect(status).toContain("max-width: 960px");
    expect(status).toContain("padding: 0 20px");
    expect(status).toContain("width: 100%");
    expect(cssDeclarations(".timeline > .turn-status")).toContain("padding: 0");
  });

  it("adds the requested environment offset and activity/sidebar divider", () => {
    expect(cssDeclarations(".environment-popover")).toContain(
      "top: calc(100% + 20px)",
    );
    expect(cssDeclarations(".sidebar")).toContain(
      "border-inline-start: 1px solid var(--border)",
    );
  });

  it("persists drag ordering and renders insertion feedback", () => {
    expect(appSource).toContain("orderProjectsByPreference");
    expect(appSource).toContain("reorderProjectIds");
    expect(appSource).toContain("draggable");
    expect(appSource).toContain("window.artemis.setProjectOrder");
    expect(apiSource).toContain("setProjectOrder(order: string[])");
    expect(preloadSource).toContain("IPC.settingsProjectOrderSet");
    expect(mainSource).toContain("settingsStore.setProjectOrder(order)");
    expect(stylesSource).toContain(".nested-project.drop-before::before");
    expect(stylesSource).toContain(".nested-project.drop-after::after");
  });

  it("uploads a local avatar and shows it on the token usage dashboard", () => {
    expect(settingsSource).toContain("prepareProfileAvatar");
    expect(settingsSource).toContain(
      'accept="image/jpeg,image/png,image/webp"',
    );
    expect(apiSource).toContain("setProfileAvatar(avatar?: string)");
    expect(preloadSource).toContain("IPC.settingsProfileAvatarSet");
    expect(mainSource).toContain("settingsStore.setProfileAvatar(avatar)");
    expect(tokenUsageSource).toContain("profileAvatar");
    expect(tokenUsageSource).toContain('className="token-usage-avatar-image"');
  });

  it("marks the active conversation model instead of the global default", () => {
    const picker = appSource.slice(
      appSource.indexOf("switchableModels.map((model)"),
      appSource.indexOf(": modelPickerThinkingLevels.map("),
    );
    expect(picker).toContain("activeSelection?.providerId");
    expect(picker).toContain("activeSelection.modelId");
    expect(picker).not.toContain("runtimeSettings?.selection");
  });
});
