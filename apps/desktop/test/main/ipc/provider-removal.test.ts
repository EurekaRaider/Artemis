import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { EncryptedSettingsStore } from "../../../src/main/settings/encrypted-settings-store.js";
import { registerModelsProvidersIpc } from "../../../src/main/ipc/models-providers.js";
import { IPC } from "../../../src/shared/api.js";

vi.mock("electron", () => ({ app: {}, dialog: {} }));
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "artemis-provider-removal-"));
  directories.push(directory);
  const settingsStore = new EncryptedSettingsStore(
    join(directory, "settings.json"),
    {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(value),
      decryptString: (value) => value.toString(),
    },
  );
  await settingsStore.saveCredential("openai", {
    type: "api_key",
    key: "fixture-only",
  });
  await settingsStore.addModel({
    providerId: "openai",
    modelId: "fixture-model",
    contextWindow: 64000,
  });
  await settingsStore.setModel(
    { providerId: "openai", modelId: "fixture-model", thinkingLevel: "off" },
    64000,
  );
  const handlers = new Map<string, (...args: any[]) => Promise<unknown>>();
  const activeTurns = new Map();
  const applyAgentRuntime = vi.fn(async () => {});
  const resetAgentThreadsForToolChange = vi.fn(async () => {});
  const updateThread = vi.fn();
  const getSettingsSnapshot = async () => ({
    providers: await settingsStore.providerConnections(),
    credentials: await settingsStore.credentialSummaries(),
    addedModels: await settingsStore.addedModels(),
    models: (await settingsStore.addedModels()).map((model) => ({
      ...model,
      configured: true,
      reasoning: false,
    })),
  });
  registerModelsProvidersIpc({
    settingsStore,
    getSettingsSnapshot,
    activeTurns,
    applyAgentRuntime,
    resetAgentThreadsForToolChange,
    ipcMain: {
      handle: (
        channel: string,
        handler: (...args: any[]) => Promise<unknown>,
      ) => handlers.set(channel, handler),
    },
    store: {
      listThreads: () => [
        {
          id: "thread",
          modelSelection: { providerId: "openai", modelId: "fixture-model" },
        },
      ],
      updateThread,
    },
  } as never);
  return {
    settingsStore,
    activeTurns,
    applyAgentRuntime,
    updateThread,
    resetAgentThreadsForToolChange,
    remove: (id = "openai") =>
      handlers.get(IPC.settingsProviderDelete)!({}, id),
  };
}

it("removes built-in credentials and models and clears defaults and thread selections", async () => {
  const h = await setup();
  await h.remove();
  expect(await h.settingsStore.credentialSummaries()).toEqual([]);
  expect(await h.settingsStore.addedModels()).toEqual([]);
  expect(await h.settingsStore.runtimeConfiguration()).toEqual({
    credentials: {},
  });
  expect(h.resetAgentThreadsForToolChange).toHaveBeenCalledOnce();
  expect(h.updateThread).toHaveBeenCalledWith("thread", {
    modelSelection: null,
    contextWindow: null,
  });
});

it("moves defaults and affected threads to another configured built-in model", async () => {
  const h = await setup();
  await h.settingsStore.saveCredential("deepseek", {
    type: "api_key",
    key: "other-fixture-only",
  });
  await h.settingsStore.addModel({
    providerId: "deepseek",
    modelId: "backup",
    contextWindow: 64000,
  });
  await h.remove();
  expect((await h.settingsStore.runtimeConfiguration()).selection).toEqual({
    providerId: "deepseek",
    modelId: "backup",
    thinkingLevel: "off",
  });
  expect(h.updateThread).toHaveBeenCalledWith("thread", {
    modelSelection: {
      providerId: "deepseek",
      modelId: "backup",
      thinkingLevel: "off",
    },
    contextWindow: 64000,
  });
});

it("keeps built-in credentials and models when an active turn prevents deletion", async () => {
  const h = await setup();
  h.activeTurns.set("thread", {});
  await expect(h.remove()).rejects.toThrow("Stop the active turn");
  expect(await h.settingsStore.credentialSummaries()).toHaveLength(1);
  expect(await h.settingsStore.addedModels()).toHaveLength(1);
  expect(h.applyAgentRuntime).not.toHaveBeenCalled();
});

it("rejects unknown providers without changing runtime or settings", async () => {
  const h = await setup();
  await expect(h.remove("unknown")).rejects.toThrow(
    "Provider connection was not found",
  );
  expect(h.applyAgentRuntime).not.toHaveBeenCalled();
  expect(await h.settingsStore.credentialSummaries()).toHaveLength(1);
});
