import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const apiSource = readFileSync(
  new URL("../src/shared/api.ts", import.meta.url),
  "utf8",
);
const preloadSource = readFileSync(
  new URL("../src/preload/preload.ts", import.meta.url),
  "utf8",
);
const mainSource = readFileSync(
  new URL("../src/main/main.ts", import.meta.url),
  "utf8",
);
const settingsPanelSource = readFileSync(
  new URL("../src/renderer/SettingsPanel.tsx", import.meta.url),
  "utf8",
);
const mcpServerEditorSource = readFileSync(
  new URL("../src/renderer/McpServerEditor.tsx", import.meta.url),
  "utf8",
);
const mcpManagerSource = readFileSync(
  new URL("../src/main/mcp-client-manager.ts", import.meta.url),
  "utf8",
);
const extensionManagerSource = readFileSync(
  new URL("../src/main/trusted-extension-manager.ts", import.meta.url),
  "utf8",
);
const terminalServiceSource = readFileSync(
  new URL("../src/main/terminal-service.ts", import.meta.url),
  "utf8",
);
const agentRuntimeSource = readFileSync(
  new URL("../../../packages/agent-host/src/runtime.ts", import.meta.url),
  "utf8",
);

describe("local full access setting", () => {
  it("wires the default-off setting through the snapshot and isolated IPC", () => {
    expect(apiSource).toContain("localFullAccess: boolean;");
    expect(apiSource).toContain(
      "setLocalFullAccess(enabled: boolean): Promise<SettingsSnapshot>;",
    );
    expect(apiSource).toMatch(
      /settingsLocalFullAccessSet:\s*"artemis:settings-local-full-access-set"/u,
    );
    expect(preloadSource).toContain(
      "setLocalFullAccess: (enabled) =>\n    ipcRenderer.invoke(IPC.settingsLocalFullAccessSet, enabled)",
    );
    expect(mainSource).toContain("settingsStore.localFullAccess(),");
    expect(mainSource).toMatch(/\n\s*localFullAccess,\n/u);
    expect(mainSource).toContain(
      "ipcMain.handle(\n    IPC.settingsLocalFullAccessSet",
    );
    expect(mainSource).toContain(
      "await settingsStore.setLocalFullAccess(Boolean(enabled))",
    );
  });

  it("shows a bilingual master switch and saves its checked state", () => {
    expect(settingsPanelSource).toContain(
      'localFullAccess: "Full local access"',
    );
    expect(settingsPanelSource).toContain('localFullAccess: "完整本机访问"');
    expect(settingsPanelSource).toContain("checked={settings.localFullAccess}");
    expect(settingsPanelSource).toMatch(
      /onCheckedChange=\{\(checked\)\s*=>[\s\S]*?window\.artemis\.setLocalFullAccess\(checked\)/u,
    );
    expect(settingsPanelSource).toContain("setSettings(updated)");
    expect(settingsPanelSource).toContain("onSettingsChange(updated)");
    expect(settingsPanelSource).toMatch(
      /localFullAccessDetail:\s*"Allow executable extensions to run with your desktop permissions\."/u,
    );
    expect(settingsPanelSource).toContain(
      'localFullAccessDetail: "允许可执行扩展使用当前桌面用户权限运行。"',
    );
  });

  it("makes stdio MCP network and compatibility access explicit per-server choices", () => {
    expect(mcpServerEditorSource).toMatch(
      /mcpAllowNetwork:\s*"Allow network access"/u,
    );
    expect(mcpServerEditorSource).toContain(
      'mcpFullAccess: "完整本机访问（兼容模式）"',
    );
    expect(mcpServerEditorSource).toContain("{t.mcpFullAccessHint}");
    expect(mcpServerEditorSource).toContain("setMcpAllowNetwork");
    expect(mcpServerEditorSource).toContain("setMcpFullAccess");
    expect(mcpServerEditorSource).toMatch(
      /transport:\s*"stdio"[\s\S]*?allowNetwork:\s*mcpFullAccess \|\| mcpAllowNetwork[\s\S]*?fullAccess:\s*mcpFullAccess/u,
    );
    expect(settingsPanelSource).not.toContain("{t.mcpFullAccessHint}");
  });

  it("sandboxes stdio MCP by default while keeping extension access separate", () => {
    expect(mcpManagerSource).toContain(
      "buildDesktopUserLaunch(sandboxCommand)",
    );
    expect(mcpManagerSource).not.toContain("localFullAccess");
    expect(mcpManagerSource).toContain("buildWindowsAppContainerLaunch");
    expect(mcpManagerSource).toContain("buildSeatbeltLaunch");
    expect(mcpManagerSource).toContain("config.fullAccess");

    expect(extensionManagerSource).toContain("localFullAccess");
    expect(extensionManagerSource).toContain("buildDesktopUserLaunch(command)");
    expect(extensionManagerSource).toContain(
      "buildWindowsAppContainerLaunch(command, policy",
    );
    expect(extensionManagerSource).toContain(
      "buildSeatbeltLaunch(command, policy)",
    );
  });

  it("does not reconnect MCP or pass the extension-only setting to it", () => {
    const handlerStart = mainSource.indexOf("IPC.settingsLocalFullAccessSet");
    const handlerEnd = mainSource.indexOf(
      "ipcMain.handle(",
      handlerStart + "IPC.settingsLocalFullAccessSet".length,
    );
    const handler = mainSource.slice(handlerStart, handlerEnd);
    const approvedMcp = mainSource.slice(
      mainSource.indexOf("async function executeApprovedMcp"),
      mainSource.indexOf("async function executeApprovedExtension"),
    );

    expect(handler).toContain(
      "await settingsStore.setLocalFullAccess(Boolean(enabled))",
    );
    expect(handler).not.toContain("mcpClientManager");
    expect(handler).not.toContain("initializeOptionalCapabilities");
    expect(approvedMcp).not.toContain("localFullAccess");
  });

  it("keeps HTTP MCP, Bash, and Terminal outside the new toggle", () => {
    const httpTransport = mcpManagerSource.slice(
      mcpManagerSource.indexOf("const createTransport = () =>"),
      mcpManagerSource.indexOf(
        "return {",
        mcpManagerSource.indexOf("const createTransport = () =>"),
      ),
    );

    expect(httpTransport).toContain("StreamableHTTPClientTransport");
    expect(httpTransport).not.toContain("localFullAccess");
    expect(terminalServiceSource).not.toContain("localFullAccess");
    expect(agentRuntimeSource).not.toContain("localFullAccess");
  });
});
