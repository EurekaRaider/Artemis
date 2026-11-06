import { readSettingsPanelSources } from "../fixtures/application/settings-source.js";
import {
  readPreloadBridgeSources,
  readSharedApiSources,
} from "../fixtures/application/api-source.js";
import { readResourceCenterSources } from "../fixtures/application/resource-center-source.js";
import { readRendererAppSources } from "../fixtures/application/renderer-source.js";
import { readMainProcessSources } from "../fixtures/application/main-source.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const source = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

const mainSource = readMainProcessSources();
const smokeSource = [
  "../../scripts/verify/ui/smoke/window-capture.ts",
  "../../scripts/verify/ui/smoke/prepare-view.ts",
  "../fixtures/smoke/startup.ts",
]
  .map(source)
  .join("\n");
const preloadSource = readPreloadBridgeSources();
const resourceCenterSource = readResourceCenterSources();
const settingsPanelSource = readSettingsPanelSources();
const appSource = readRendererAppSources();
const apiSource = readSharedApiSources();
const ciWorkflowSource = source("../../../../.github/workflows/ci.yml");
const gitAttributesSource = source("../../../../.gitattributes");
const environmentVerifierSource = source(
  "../../scripts/verify/ui/verify-environment-panel-responsive.mjs",
);
const screenshotMatrixSource = source(
  "../../scripts/verify/ui/capture-screenshot-matrix.mjs",
);
const conversationVerifierSource = source(
  "../../scripts/verify/ui/verify-conversation-timeline.mjs",
);
const packageJson = JSON.parse(source("../../package.json")) as {
  scripts: Record<string, string>;
  build: {
    mac?: { artifactName?: string; icon?: string };
    nsis?: unknown;
    portable?: unknown;
    win?: { artifactName?: string };
  };
};

describe("desktop startup latency guardrails", () => {
  it("shares thread-opening work and warms the selected task in the background", () => {
    expect(mainSource).toContain(
      "const openingThreads = new Map<string, Promise<void>>()",
    );
    expect(mainSource).toContain("openingThreads.get(thread.id)");
    expect(mainSource).toContain("openingThreads.set(thread.id, opening)");
    expect(apiSource).toContain(
      "prepareThread(threadId: string): Promise<void>",
    );
    expect(preloadSource).toContain("IPC.threadPrepare");
    expect(appSource).toContain("window.artemis.prepareThread(activeThreadId)");
  });

  it("creates the renderer without awaiting Agent runtime warm-up", () => {
    const startup = source("../../src/main/application/startup.ts");
    const warmup = startup.indexOf(
      "services.agentRuntimeReady = applyAgentRuntime();",
    );
    const createWindow = startup.indexOf(
      "services.mainWindow = createMainWindow();",
    );

    expect(warmup).toBeGreaterThanOrEqual(0);
    expect(createWindow).toBeGreaterThan(warmup);
    expect(startup.slice(warmup, createWindow)).not.toContain(
      "await agentRuntimeReady",
    );
    expect(startup).not.toContain("await applyAgentRuntime();");
  });

  it("shows the first window before update recovery and terminal runtime preparation", () => {
    const startup = source("../../src/main/application/startup.ts");
    const createWindow = startup.indexOf(
      "services.mainWindow = createMainWindow();",
    );
    const updateRecovery = startup.indexOf(
      "services.releaseUpdateReady = services.releaseUpdateManager.initialize();",
    );

    expect(createWindow).toBeGreaterThanOrEqual(0);
    expect(updateRecovery).toBeGreaterThan(createWindow);
    expect(startup.slice(0, createWindow)).not.toContain(
      "preparePackagedNodePtyRuntime(",
    );
    expect(mainSource).toContain("show: hostOptions?.show ?? true");
    expect(mainSource).toContain("await services.releaseUpdateReady");

    const terminalOpen = mainSource.slice(
      mainSource.indexOf("IPC.terminalOpen"),
      mainSource.indexOf("IPC.terminalWrite"),
    );
    expect(terminalOpen).toContain("ensureNodePtyRuntime()");
  });

  it("records startup phases and exposes a native responsive-window check", () => {
    for (const stage of [
      "app-ready",
      "diagnostics-ready",
      "core-state-ready",
      "window-created",
      "renderer-ready",
      "update-ready",
    ]) {
      expect(mainSource).toContain(`markStartupStage("${stage}")`);
    }
    expect(mainSource).toContain("startupTimings");
    expect(packageJson.scripts["verify:environment-panel"]).toContain(
      "verify-environment-panel-responsive.mjs",
    );
  });

  it("pins three-platform visual convergence to the source head on public hosted runners", () => {
    const visualJob = ciWorkflowSource.slice(
      ciWorkflowSource.indexOf("visual-convergence-electron:"),
      ciWorkflowSource.indexOf("\n  hooks-native:"),
    );
    const exactSourceHead = "github.sha";

    expect(visualJob).toContain(`ref: \${{ ${exactSourceHead} }}`);
    expect(visualJob).toContain(
      `ARTEMIS_EXPECTED_HEAD: \${{ ${exactSourceHead} }}`,
    );
    expect(visualJob).toContain("macos-visual-shards:");
    expect(visualJob).toContain("runs-on: macos-15\n");
    expect(visualJob).toContain("macos-x64-visual-shards:");
    expect(visualJob).toContain("runs-on: macos-15-intel");
    expect(visualJob).not.toContain("github.event.repository.private");
    expect(ciWorkflowSource).toContain("workflow_call:");
    expect(visualJob).toContain("runner: windows-2025");
    expect(visualJob).toContain("runs-on: ${{ matrix.runner }}");
    expect(ciWorkflowSource).toMatch(/^  push:/mu);
    expect(ciWorkflowSource).toMatch(/^  pull_request:/mu);
    expect(ciWorkflowSource).not.toContain(
      "github.event.pull_request.head.repo.full_name == github.repository",
    );
    expect(visualJob).not.toContain("npm run package:win");
    expect(gitAttributesSource).toContain("* text=auto eol=lf");
  });

  it("makes animation, visibility, and explicit theme evidence deterministic", () => {
    expect(environmentVerifierSource).toContain(
      '"--force-prefers-no-reduced-motion"',
    );
    expect(environmentVerifierSource).toContain(
      "dock.feedbackLayout?.reducedMotion === false",
    );
    expect(smokeSource).toContain(
      "await settingsStore.setThemePreference(smokeTheme)",
    );
    expect(screenshotMatrixSource).toContain(
      "accessibility.themePreference === variant.theme",
    );
    expect(smokeSource).toContain(
      "const actionOpacityDeadline = performance.now() + 1_000",
    );
    expect(smokeSource).toContain("Number(actionOpacity) >= 0.99");
    expect(conversationVerifierSource).toContain(
      "Math.round(20 * devicePixelRatio) - 1",
    );
    expect(conversationVerifierSource).toContain(
      "visibleDevicePixels >= minimumVisibleDevicePixels",
    );
  });

  it("loads installed MCP configuration without waiting for full settings", () => {
    expect(apiSource).toContain(
      "listMcpServers(): Promise<McpServerStatus[]>;",
    );
    expect(apiSource).toContain('resourceMcpList: "artemis:resource-mcp-list"');
    expect(preloadSource).toContain(
      "listMcpServers: () => ipcRenderer.invoke(IPC.resourceMcpList)",
    );
    expect(mainSource).toContain("IPC.resourceMcpList");
    expect(mainSource).toContain("getMcpServerStatuses()");
    const mcpStatusLoader = mainSource.slice(
      mainSource.indexOf("async function getMcpServerStatuses"),
      mainSource.indexOf("async function installedSkillsWithState"),
    );
    expect(mcpStatusLoader).not.toContain("optionalCapabilitiesReady");
    expect(mcpStatusLoader).not.toContain("agentRuntimeReady");
    expect(resourceCenterSource).toContain(".listMcpServers()");
    expect(resourceCenterSource).toContain("const [mcpServers, setMcpServers]");
    expect(resourceCenterSource).toContain("const visibleMcp = mcpServers");
    expect(resourceCenterSource).toContain(
      '(server) => server.config.resourceKind !== "connector"',
    );
    expect(resourceCenterSource).toContain("visibleMcp.map((server)");
  });

  it("opens settings from cached state without waiting for optional capabilities", () => {
    const modelSettingsSnapshot = mainSource.slice(
      mainSource.indexOf("async function getModelSettingsSnapshot"),
      mainSource.indexOf("async function getSettingsSnapshot"),
    );
    const settingsSnapshot = mainSource.slice(
      mainSource.indexOf("async function getSettingsSnapshot"),
      mainSource.indexOf("async function getMcpServerStatuses"),
    );

    expect(settingsSnapshot).not.toContain("optionalCapabilitiesReady");
    expect(settingsSnapshot).not.toContain("agentProcess.request");
    expect(modelSettingsSnapshot).toContain("mergeBundledModelCatalog(");
    expect(settingsSnapshot).toContain("getModelSettingsSnapshot()");
    expect(settingsSnapshot).toContain("agentConcurrencyStatus(false)");
    expect(settingsPanelSource).toContain("initialSettings?: SettingsSnapshot");
    expect(settingsPanelSource).toContain("useState(initialSettings)");
    expect(appSource).toContain("initialSettings={runtimeSettings}");
  });

  it("switches models without refreshing unrelated settings and updates the UI optimistically", () => {
    const selectionResolver = mainSource.slice(
      mainSource.indexOf("async function resolveModelSelection"),
      mainSource.indexOf("async function applyAgentRuntime"),
    );
    const rendererModelSwitch = appSource.slice(
      appSource.indexOf("const switchComposerModel"),
      appSource.indexOf("const switchComposerThinking"),
    );

    expect(selectionResolver).not.toContain("getSettingsSnapshot()");
    expect(
      rendererModelSwitch.indexOf("setPendingModelSelection("),
    ).toBeLessThan(
      rendererModelSwitch.indexOf(
        "await window.artemis.setThreadModelSelection(",
      ),
    );
  });

  it("ships Windows with a per-user installer and manual ZIP", () => {
    expect(packageJson.build.nsis).toMatchObject({
      perMachine: false,
      allowElevation: false,
    });
    expect(packageJson.build.portable).toBeUndefined();
  });

  it("includes the platform and architecture in package artifact names", () => {
    expect(packageJson.build.mac?.artifactName).toBe(
      "Artemis-macOS-${arch}-${version}.${ext}",
    );
    expect(packageJson.build.win?.artifactName).toBe(
      "Artemis-Windows-${arch}-${version}.${ext}",
    );
    expect(packageJson.build.mac?.icon).toBe("build/icon.icns");
    expect(
      readFileSync(
        fileURLToPath(new URL("../../build/icon.icns", import.meta.url)),
      )
        .subarray(0, 4)
        .toString("hex"),
    ).toBe("69636e73");
  });
});
