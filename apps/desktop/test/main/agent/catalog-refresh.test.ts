import type { AgentRuntimeCatalog } from "@artemis/protocol";
import { expect, it, vi } from "vitest";
import { createRuntimeCoordinator } from "../../../src/main/agent/runtime-coordinator.js";
import { registerPreferencesIpc } from "../../../src/main/ipc/preferences.js";
import { IPC } from "../../../src/shared/api.js";

vi.mock("electron", () => ({ app: {}, utilityProcess: {} }));

it("refreshes stale settings reads once and gives a newer configuration precedence", async () => {
  const initial = { models: [] };
  const request = vi.fn().mockResolvedValue(initial);
  const services = { agentProcess: { request }, cachedAgentCatalog: initial };
  const coordinator = createRuntimeCoordinator(services as never);
  const handlers = new Map<string, () => Promise<AgentRuntimeCatalog>>();
  registerPreferencesIpc({
    ipcMain: {
      handle: (key: string, fn: () => Promise<AgentRuntimeCatalog>) =>
        handlers.set(key, fn),
    },
    refreshAgentCatalogIfStale: () => coordinator.refreshAgentCatalog(true),
    getSettingsSnapshot: async () => services.cachedAgentCatalog,
  } as never);
  const getSettings = handlers.get(IPC.settingsGet)!;
  vi.useFakeTimers();
  try {
    await getSettings();
    expect(request).not.toHaveBeenCalled();
    await coordinator.refreshAgentCatalog();
    await getSettings();
    expect(request).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    const stale = Promise.withResolvers<AgentRuntimeCatalog>();
    request.mockReturnValueOnce(stale.promise);
    const reads = [getSettings(), getSettings()];
    expect(request).toHaveBeenCalledTimes(2);
    const latest = { models: [], authoritativeProviderIds: ["openai-codex"] };
    request.mockResolvedValueOnce(latest);
    await coordinator.refreshAgentCatalog();
    stale.resolve(initial);
    expect(await Promise.all(reads)).toEqual([latest, latest]);
  } finally {
    vi.useRealTimers();
  }
});
