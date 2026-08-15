import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const mainSource = readFileSync(
  new URL("../src/main/main.ts", import.meta.url),
  "utf8",
);
const preloadSource = readFileSync(
  new URL("../src/preload/preload.ts", import.meta.url),
  "utf8",
);
const settingsSource = readFileSync(
  new URL("../src/renderer/SettingsPanel.tsx", import.meta.url),
  "utf8",
);

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
