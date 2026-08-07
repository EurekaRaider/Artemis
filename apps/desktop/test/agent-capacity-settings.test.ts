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
    expect(settingsSource).toContain('CodexSelect<"auto" | "manual">');
    expect(settingsSource).toContain(
      "settings.agentConcurrency.effectiveLimit",
    );
    expect(settingsSource).toContain("settings.agentConcurrency.queued");
  });

  it("keeps the single-team member limit separate from global capacity", async () => {
    const runtimeSource = await readFile(
      join(desktopRoot, "../../packages/agent-host/src/runtime.ts"),
      "utf8",
    );
    expect(runtimeSource).toContain("const TEAM_MAX_MEMBERS = 4;");
    expect(runtimeSource).toContain(
      "the desktop applies a dynamic global active-agent limit and queues excess work",
    );
    expect(runtimeSource).not.toContain("limits all active Pi agents to ten");
  });
});
