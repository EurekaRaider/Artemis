import { readSettingsPanelSources } from "../fixtures/application/settings-source.js";
import { readPreloadBridgeSources } from "../fixtures/application/api-source.js";
import { readMainProcessSources } from "../fixtures/application/main-source.js";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const mainSource = readMainProcessSources();
const preloadSource = readPreloadBridgeSources();
const settingsSource = readSettingsPanelSources();

describe("shell runtime settings", () => {
  it("validates and applies shell changes through the existing runtime reset boundary", () => {
    expect(mainSource).toContain(
      "shellRuntimeConfigurationSchema.parse(value)",
    );
    expect(mainSource).toMatch(
      /IPC\.settingsShellRuntimeSet[\s\S]*?resetAgentThreadsForToolChange\(\)[\s\S]*?setShellRuntimeConfiguration\(configuration\)[\s\S]*?applyAgentRuntime\(\)/u,
    );
    expect(preloadSource).toContain("IPC.settingsShellRuntimeSet");
  });

  it("offers PowerShell priority and profile compatibility choices", () => {
    expect(settingsSource).toContain('value: "powershell7"');
    expect(settingsSource).toContain('value: "windows-powershell"');
    expect(settingsSource).toContain('value: "environment"');
    expect(settingsSource).toContain('value: "full"');
    expect(settingsSource).toContain('value: "disabled"');
  });
});
