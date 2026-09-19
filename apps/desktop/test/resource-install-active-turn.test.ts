import { readFileSync } from "node:fs";
import { join } from "node:path";
import { transformSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";

const main = readFileSync(
  new URL("../src/main/main.ts", import.meta.url),
  "utf8",
);

function between(start: string, end: string): string {
  const from = main.indexOf(start);
  const to = main.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`Missing source: ${start}`);
  return main.slice(from, to);
}

const channels = [
  "resourcePluginInstall",
  "resourcePluginRuntimeInstall",
  "resourceSkillInstall",
  "resourceSkillInstallLocal",
] as const;

function fixture(channel: (typeof channels)[number]) {
  let handler: (...args: unknown[]) => Promise<unknown>;
  const install = vi.fn(async () => ({
    plugin: { id: "new-plugin", skillNames: ["new-skill"] },
    warnings: [],
    path: "/tmp/new-skill",
  }));
  const scope = {
    IPC: Object.fromEntries(channels.map((name) => [name, name])),
    ipcMain: {
      handle: (_name: string, value: typeof handler) => {
        handler = value;
      },
    },
    agentProcess: { request: vi.fn() },
    activeTurns: new Map([["running-thread", "running-turn"]]),
    openedThreads: new Set(["running-thread", "idle-thread"]),
    openingThreads: new Map(),
    randomUUID: () => "request",
    resourceInstallOperationId: (id: string) => id,
    publishResourceInstallProgress: vi.fn(),
    codexPluginService: {
      install,
      loadBundledArtifactMarketplace: async () => ({
        name: "Bundled plugins",
        plugins: [{ source: { kind: "bundled", pluginName: "documents" } }],
      }),
      remove: vi.fn(),
    },
    resourceCatalogService: {
      installSkill: install,
      installLocalSkill: install,
    },
    settingsStore: { setSkillEnabled: vi.fn() },
    enableManagedPluginSkills: vi.fn(),
    applyAgentRuntime: vi.fn(),
    codexPluginMutationResult: (warnings: string[]) => ({ warnings }),
    mainWindow: {},
    dialog: {
      showOpenDialog: async () => ({ filePaths: ["/tmp/new-skill"] }),
    },
    restoreResourceDialogFocus: vi.fn(),
    mainText: () => "Select skill",
    currentLocale: () => "en",
    join,
  };
  const reset = new Function(
    ...Object.keys(scope),
    transformSync(
      between(
        "async function resetAgentThreadsForToolChange(",
        "type ModelSettingsSnapshot",
      ) +
        between(`  ipcMain.handle(\n    IPC.${channel},`, "  ipcMain.handle(") +
        "\nreturn resetAgentThreadsForToolChange;",
      { loader: "ts" },
    ).code,
  )(...Object.values(scope)) as () => Promise<void>;
  return {
    scope,
    install,
    reset,
    run: () =>
      channel === "resourcePluginRuntimeInstall" ||
      channel === "resourceSkillInstallLocal"
        ? handler({ sender: {} }, "operation")
        : handler(
            { sender: {} },
            channel === "resourcePluginInstall"
              ? { kind: "bundled", pluginName: "documents" }
              : "owner/repository/new-skill",
            "operation",
          ),
  };
}

describe("resource installation during an active turn", () => {
  it.each(channels)(
    "allows %s without closing any session",
    async (channel) => {
      const f = fixture(channel);
      await f.run();
      expect(f.install).toHaveBeenCalledOnce();
      expect(f.scope.applyAgentRuntime).toHaveBeenCalledOnce();
      expect(f.scope.agentProcess.request).not.toHaveBeenCalled();
      expect(f.scope.activeTurns.get("running-thread")).toBe("running-turn");
      expect([...f.scope.openedThreads]).toEqual([
        "running-thread",
        "idle-thread",
      ]);
      expect(f.scope.publishResourceInstallProgress).toHaveBeenLastCalledWith(
        {},
        expect.objectContaining({ percent: 100 }),
      );
    },
  );

  it("reports installation failures without publishing success or changing the running turn", async () => {
    const f = fixture("resourcePluginInstall");
    f.install.mockRejectedValueOnce(new Error("Plugin source unavailable"));
    await expect(f.run()).rejects.toThrow("Plugin source unavailable");
    expect(f.scope.applyAgentRuntime).not.toHaveBeenCalled();
    expect(f.scope.agentProcess.request).not.toHaveBeenCalled();
    expect(f.scope.activeTurns.get("running-thread")).toBe("running-turn");
    expect(f.scope.publishResourceInstallProgress).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ percent: 100 }),
    );
  });

  it("still protects operations that replace or remove live tools", async () => {
    const f = fixture("resourcePluginInstall");
    await expect(f.reset()).rejects.toThrow(
      "Stop active turns before changing Agent tools.",
    );
    expect(f.scope.agentProcess.request).not.toHaveBeenCalled();
  });
});
