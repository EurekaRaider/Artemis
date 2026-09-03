import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const desktopRoot = join(import.meta.dirname, "..");

describe("agent capacity settings surface", () => {
  it("exposes automatic and manual global concurrency through the isolated preload API", async () => {
    const [apiSource, preloadSource, settingsSource] = await Promise.all([
      readFile(join(desktopRoot, "src/shared/api.ts"), "utf8"),
      readFile(join(desktopRoot, "src/preload/preload.ts"), "utf8"),
      readFile(join(desktopRoot, "src/renderer/SettingsPanel.tsx"), "utf8"),
    ]);
    expect(apiSource).toContain("setAgentConcurrency(");
    expect(apiSource).toContain("settingsAgentConcurrencySet");
    expect(preloadSource).toContain("setAgentConcurrency: (preference)");
    expect(settingsSource).toContain('<Select<"auto" | "manual">');
    expect(settingsSource).toContain(
      "onValueChange={(mode) =>\n                        void setAgentConcurrencyMode(mode)",
    );
    expect(settingsSource).toContain(
      "settings.agentConcurrency.effectiveLimit",
    );
    expect(settingsSource).toContain("settings.agentConcurrency.queued");
    expect(settingsSource).toContain("settings.agentConcurrency.waiting");
    expect(settingsSource).toContain("settings.agentConcurrency.logicalLimit");
    expect(settingsSource).toContain(
      "settings.agentConcurrency.configuredLimit",
    );
    expect(settingsSource).toContain(
      "settings.agentConcurrency.automaticSafeLimit",
    );
    expect(settingsSource).toContain(
      "高并发会更快消耗额度并可能触发 Provider 限流；系统压力下 Artemis 仍会自动降载。",
    );
  });

  it("keeps logical tree capacity separate from active global capacity", async () => {
    const runtimeSource = await readFile(
      join(desktopRoot, "../../packages/agent-host/src/runtime.ts"),
      "utf8",
    );
    expect(runtimeSource).toContain("AGENT_TEAM_LOGICAL_MAXIMUM");
    expect(runtimeSource).toContain("AGENT_TEAM_MAXIMUM_DEPTH");
    expect(runtimeSource).toContain("AGENT_TEAM_MAXIMUM_DIRECT_CHILDREN");
    expect(runtimeSource).toContain("queues work above the active capacity");
    expect(runtimeSource).not.toContain("limits all active Pi agents to ten");
  });
});
