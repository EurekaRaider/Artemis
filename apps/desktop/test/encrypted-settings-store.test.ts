import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { APP_LOCALES, type ProviderConnection } from "@artemis/protocol";

import {
  EncryptedSettingsStore,
  type SafeStorageAdapter,
} from "../src/main/encrypted-settings-store.js";

const cleanupPaths: string[] = [];

class FakeSafeStorage implements SafeStorageAdapter {
  isEncryptionAvailable() {
    return true;
  }
  encryptString(value: string) {
    return Buffer.from(`encrypted:${value}`, "utf8");
  }
  decryptString(value: Buffer) {
    return value.toString("utf8").replace(/^encrypted:/u, "");
  }
}

afterEach(async () => {
  for (const path of cleanupPaths.splice(0)) {
    await rm(path, { recursive: true, force: true });
  }
});

async function createStore() {
  const directory = await mkdtemp(join(tmpdir(), "artemis-settings-"));
  cleanupPaths.push(directory);
  const filePath = join(directory, "settings.json");
  return {
    filePath,
    store: new EncryptedSettingsStore(filePath, new FakeSafeStorage()),
  };
}

describe("EncryptedSettingsStore", () => {
  it("persists a validated workspace dock width", async () => {
    const { filePath, store } = await createStore();
    await expect(store.workspaceDockWidth()).resolves.toBeUndefined();
    await expect(store.setWorkspaceDockWidth(720)).resolves.toBe(720);

    const reopened = new EncryptedSettingsStore(
      filePath,
      new FakeSafeStorage(),
    );
    await expect(reopened.workspaceDockWidth()).resolves.toBe(720);
    await expect(reopened.setWorkspaceDockWidth(319)).rejects.toThrow(
      "320 to 1080",
    );
    await expect(reopened.setWorkspaceDockWidth(1_081)).rejects.toThrow(
      "320 to 1080",
    );
    await expect(reopened.setWorkspaceDockWidth(640.5)).rejects.toThrow(
      "integer",
    );
  });

  it("persists validated agent concurrency preferences and defaults to automatic", async () => {
    const { filePath, store } = await createStore();
    await expect(store.agentConcurrencyPreference()).resolves.toEqual({
      mode: "auto",
    });
    await store.setAgentConcurrencyPreference({ mode: "manual", limit: 12 });

    const reopened = new EncryptedSettingsStore(
      filePath,
      new FakeSafeStorage(),
    );
    await expect(reopened.agentConcurrencyPreference()).resolves.toEqual({
      mode: "manual",
      limit: 12,
    });
    await expect(
      reopened.setAgentConcurrencyPreference({ mode: "manual", limit: 1 }),
    ).rejects.toThrow("2 to 16");
    await expect(
      reopened.setAgentConcurrencyPreference({ mode: "manual", limit: 17 }),
    ).rejects.toThrow("2 to 16");
  });

  it("persists local full access and defaults it to off", async () => {
    const { filePath, store } = await createStore();
    const inspectable = store as EncryptedSettingsStore & {
      localFullAccess?: () => Promise<boolean>;
      setLocalFullAccess?: (enabled: boolean) => Promise<void>;
    };

    expect(inspectable.localFullAccess).toBeTypeOf("function");
    expect(inspectable.setLocalFullAccess).toBeTypeOf("function");
    if (!inspectable.localFullAccess || !inspectable.setLocalFullAccess) return;

    await expect(inspectable.localFullAccess()).resolves.toBe(false);
    await inspectable.setLocalFullAccess(true);

    const reopened = new EncryptedSettingsStore(
      filePath,
      new FakeSafeStorage(),
    ) as EncryptedSettingsStore & {
      localFullAccess?: () => Promise<boolean>;
    };
    expect(reopened.localFullAccess).toBeTypeOf("function");
    await expect(reopened.localFullAccess?.()).resolves.toBe(true);
  });

  it("persists the language preference and defaults to the system language", async () => {
    const { filePath, store } = await createStore();
    expect(await store.languagePreference()).toBe("system");

    await store.setLanguagePreference("zh-CN");
    const reopened = new EncryptedSettingsStore(
      filePath,
      new FakeSafeStorage(),
    );

    expect(await reopened.languagePreference()).toBe("zh-CN");

    for (const language of APP_LOCALES) {
      await reopened.setLanguagePreference(language);
      expect(await reopened.languagePreference()).toBe(language);
    }
  });

  it("persists the theme preference and defaults to the system theme", async () => {
    const { filePath, store } = await createStore();
    expect(await store.themePreference()).toBe("system");

    await store.setThemePreference("light");
    const reopened = new EncryptedSettingsStore(
      filePath,
      new FakeSafeStorage(),
    );

    expect(await reopened.themePreference()).toBe("light");
  });

  it("persists the selected approval policy and defaults to agent approval", async () => {
    const { filePath, store } = await createStore();
    expect(await store.approvalPolicy()).toBe("agent");

    await store.setApprovalPolicy("ask");
    const reopened = new EncryptedSettingsStore(
      filePath,
      new FakeSafeStorage(),
    );

    expect(await reopened.approvalPolicy()).toBe("ask");
  });

  it("persists the configured context window in the runtime configuration", async () => {
    const { filePath, store } = await createStore();
    expect(await store.contextWindowPreference()).toBeUndefined();

    await store.setModel(
      {
        providerId: "openai",
        modelId: "gpt-5.6",
        thinkingLevel: "xhigh",
      },
      258_000,
    );
    const reopened = new EncryptedSettingsStore(
      filePath,
      new FakeSafeStorage(),
    );

    expect(await reopened.contextWindowPreference()).toBe(258_000);
    expect(await reopened.modelSelection()).toEqual({
      providerId: "openai",
      modelId: "gpt-5.6",
      thinkingLevel: "xhigh",
    });
    expect(await reopened.runtimeConfiguration()).toMatchObject({
      contextWindow: 258_000,
    });
  });

  it("persists Ultra Mode separately from the provider thinking level", async () => {
    const { filePath, store } = await createStore();

    await store.setModel(
      {
        providerId: "openai",
        modelId: "gpt-5.6",
        thinkingLevel: "max",
        ultraMode: true,
      },
      258_000,
    );

    const reopened = new EncryptedSettingsStore(
      filePath,
      new FakeSafeStorage(),
    );
    await expect(reopened.modelSelection()).resolves.toEqual({
      providerId: "openai",
      modelId: "gpt-5.6",
      thinkingLevel: "max",
      ultraMode: true,
    });
    await expect(reopened.runtimeConfiguration()).resolves.toMatchObject({
      selection: {
        thinkingLevel: "max",
        ultraMode: true,
      },
    });
  });

  it("persists a selected model and its provider API key together", async () => {
    const { filePath, store } = await createStore();

    await store.setModel(
      {
        providerId: "moonshotai",
        modelId: "kimi-k3",
        thinkingLevel: "max",
      },
      1_000_000,
      "moonshot-secret",
    );

    const disk = await readFile(filePath, "utf8");
    expect(disk).not.toContain("moonshot-secret");

    const reopened = new EncryptedSettingsStore(
      filePath,
      new FakeSafeStorage(),
    );
    expect(await reopened.runtimeConfiguration()).toEqual({
      credentials: {
        moonshotai: { type: "api_key", key: "moonshot-secret" },
      },
      selection: {
        providerId: "moonshotai",
        modelId: "kimi-k3",
        thinkingLevel: "max",
      },
      contextWindow: 1_000_000,
    });
  });

  it("adds a model and encrypted API key without changing the active selection", async () => {
    const { filePath, store } = await createStore();

    await store.addModel(
      {
        providerId: "moonshotai",
        modelId: "kimi-k3",
        contextWindow: 1_000_000,
      },
      "moonshot-secret",
    );

    const disk = await readFile(filePath, "utf8");
    expect(disk).not.toContain("moonshot-secret");

    const reopened = new EncryptedSettingsStore(
      filePath,
      new FakeSafeStorage(),
    );
    expect(await reopened.addedModels()).toEqual([
      {
        providerId: "moonshotai",
        modelId: "kimi-k3",
        contextWindow: 1_000_000,
      },
    ]);
    expect(await reopened.modelSelection()).toBeUndefined();
    expect(await reopened.contextWindowPreference()).toBeUndefined();
    expect(await reopened.runtimeConfiguration()).toEqual({
      credentials: {
        moonshotai: { type: "api_key", key: "moonshot-secret" },
      },
    });
  });

  it("removes added models and deletes a provider credential only with the last model", async () => {
    const { store } = await createStore();
    await store.addModel(
      { providerId: "openai", modelId: "gpt-5", contextWindow: 128_000 },
      "shared-secret",
    );
    await store.addModel({
      providerId: "openai",
      modelId: "gpt-5-mini",
      contextWindow: 64_000,
    });

    await expect(
      store.removeModel(
        { providerId: "openai", modelId: "gpt-5" },
        { deleteCredential: true },
      ),
    ).resolves.toBe(true);
    await expect(store.credentialSummaries()).resolves.toEqual([
      { providerId: "openai", type: "api_key" },
    ]);

    await expect(
      store.removeModel(
        { providerId: "openai", modelId: "gpt-5-mini" },
        { deleteCredential: true },
      ),
    ).resolves.toBe(true);
    await expect(store.addedModels()).resolves.toEqual([]);
    await expect(store.credentialSummaries()).resolves.toEqual([]);
    await expect(
      store.removeModel(
        { providerId: "openai", modelId: "gpt-5-mini" },
        { deleteCredential: true },
      ),
    ).resolves.toBe(false);
  });

  it("keeps a custom provider credential and active selection when its added marker is removed", async () => {
    const { store } = await createStore();
    const provider: ProviderConnection = {
      id: "local-proxy",
      name: "Local proxy",
      baseUrl: "http://127.0.0.1:11434/v1",
      models: [
        {
          id: "local-model",
          name: "Local model",
          reasoning: false,
          input: ["text"],
          contextWindow: 128_000,
          maxTokens: 32_000,
        },
      ],
    };
    await store.saveProviderConnection(provider, "local-secret");
    await store.addModel({
      providerId: provider.id,
      modelId: provider.models[0]!.id,
      contextWindow: provider.models[0]!.contextWindow,
    });
    await store.setModel(
      {
        providerId: provider.id,
        modelId: provider.models[0]!.id,
        thinkingLevel: "off",
      },
      provider.models[0]!.contextWindow,
    );

    await store.removeModel(
      { providerId: provider.id, modelId: provider.models[0]!.id },
      { deleteCredential: true },
    );

    await expect(store.addedModels()).resolves.toEqual([]);
    await expect(store.credentialSummaries()).resolves.toEqual([
      { providerId: provider.id, type: "api_key" },
    ]);
    await expect(store.modelSelection()).resolves.toMatchObject({
      providerId: provider.id,
      modelId: provider.models[0]!.id,
    });
  });

  it("makes the legacy active model available to the conversation picker", async () => {
    const { filePath } = await createStore();
    await writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        credentials: {},
        providers: {},
        model: {
          providerId: "openai",
          modelId: "gpt-5.6",
          thinkingLevel: "high",
        },
        contextWindow: 258_000,
      }),
      "utf8",
    );

    const reopened = new EncryptedSettingsStore(
      filePath,
      new FakeSafeStorage(),
    );
    expect(await reopened.addedModels()).toEqual([
      {
        providerId: "openai",
        modelId: "gpt-5.6",
        contextWindow: 258_000,
      },
    ]);
  });

  it("persists disabled global skills as runtime resource policy", async () => {
    const { filePath, store } = await createStore();
    const skillFile = "C:\\Users\\me\\.pi\\agent\\skills\\demo\\SKILL.md";

    await store.setSkillEnabled(skillFile, false);
    const reopened = new EncryptedSettingsStore(
      filePath,
      new FakeSafeStorage(),
    );

    expect(await reopened.disabledSkillFiles()).toEqual([skillFile]);
    expect(await reopened.runtimeConfiguration()).toMatchObject({
      disabledSkillFiles: [skillFile],
    });

    await reopened.setSkillEnabled(skillFile, true);
    expect(await reopened.disabledSkillFiles()).toEqual([]);
  });

  it("persists only encrypted credentials and non-secret summaries", async () => {
    const { filePath, store } = await createStore();
    await store.saveCredential("openai", {
      type: "api_key",
      key: "sk-private",
    });

    const disk = await readFile(filePath, "utf8");
    expect(disk).not.toContain("sk-private");
    expect(await store.credentialSummaries()).toEqual([
      { providerId: "openai", type: "api_key" },
    ]);
    expect(await store.runtimeConfiguration()).toEqual({
      credentials: {
        openai: { type: "api_key", key: "sk-private" },
      },
    });
  });

  it("persists an Ollama-compatible provider while keeping its API key encrypted", async () => {
    const { filePath, store } = await createStore();
    const provider: ProviderConnection = {
      id: "ollama",
      name: "Ollama",
      baseUrl: "http://127.0.0.1:11434/v1",
      api: "openai-responses",
      models: [
        {
          id: "qwen2.5-coder:7b",
          name: "Qwen 2.5 Coder 7B",
          reasoning: false,
          input: ["text"],
          contextWindow: 128_000,
          maxTokens: 32_000,
        },
      ],
    };

    await store.saveProviderConnection(provider, "local-secret");

    const disk = await readFile(filePath, "utf8");
    expect(disk).toContain(provider.baseUrl);
    expect(disk).not.toContain("local-secret");
    expect(await store.providerConnections()).toEqual([provider]);
    expect(await store.runtimeConfiguration()).toEqual({
      credentials: {
        ollama: { type: "api_key", key: "local-secret" },
      },
      providers: [provider],
    });
  });

  it("deletes a provider, its models, and its credential while preserving a replacement selection", async () => {
    const { store } = await createStore();
    const primary: ProviderConnection = {
      id: "primary-proxy",
      name: "Primary proxy",
      baseUrl: "http://127.0.0.1:11434/v1",
      models: [
        {
          id: "primary-model",
          name: "Primary model",
          reasoning: true,
          input: ["text"],
          contextWindow: 128_000,
          maxTokens: 32_000,
        },
      ],
    };
    const backup: ProviderConnection = {
      id: "backup-proxy",
      name: "Backup proxy",
      baseUrl: "http://127.0.0.1:22434/v1",
      models: [
        {
          id: "backup-model",
          name: "Backup model",
          reasoning: false,
          input: ["text"],
          contextWindow: 96_000,
          maxTokens: 24_000,
        },
      ],
    };
    const replacement = {
      selection: {
        providerId: backup.id,
        modelId: backup.models[0]!.id,
        thinkingLevel: "off" as const,
      },
      contextWindow: backup.models[0]!.contextWindow,
    };

    await store.saveProviderConnection(primary, "primary-secret");
    await store.saveProviderConnection(backup, "backup-secret");
    await store.addModel({
      providerId: primary.id,
      modelId: primary.models[0]!.id,
      contextWindow: primary.models[0]!.contextWindow,
    });
    await store.addModel({
      providerId: backup.id,
      modelId: backup.models[0]!.id,
      contextWindow: backup.models[0]!.contextWindow,
    });
    await store.setModel(
      {
        providerId: primary.id,
        modelId: primary.models[0]!.id,
        thinkingLevel: "medium",
      },
      primary.models[0]!.contextWindow,
    );

    expect(await store.providerConnections()).toEqual([backup, primary]);

    const inspectable = store as EncryptedSettingsStore & {
      deleteProviderConnection?: (
        providerId: string,
        replacement?: {
          selection: typeof replacement.selection;
          contextWindow: number;
        },
      ) => Promise<void>;
    };
    expect(inspectable.deleteProviderConnection).toBeTypeOf("function");
    if (!inspectable.deleteProviderConnection) return;

    await inspectable.deleteProviderConnection(primary.id, replacement);

    expect(await store.providerConnections()).toEqual([backup]);
    expect(await store.addedModels()).toEqual([
      {
        providerId: backup.id,
        modelId: backup.models[0]!.id,
        contextWindow: backup.models[0]!.contextWindow,
      },
    ]);
    expect(await store.credentialSummaries()).toEqual([
      { providerId: backup.id, type: "api_key" },
    ]);
    expect(await store.runtimeConfiguration()).toEqual({
      credentials: {
        [backup.id]: { type: "api_key", key: "backup-secret" },
      },
      providers: [backup],
      selection: replacement.selection,
      contextWindow: replacement.contextWindow,
    });

    await inspectable.deleteProviderConnection(backup.id);
    expect(await store.runtimeConfiguration()).toEqual({ credentials: {} });
  });

  it("imports API key and OAuth credentials from Pi auth.json", async () => {
    const { store } = await createStore();
    expect(
      await store.importPiAuth({
        openai: { type: "api_key", key: "key" },
        anthropic: {
          type: "oauth",
          access: "access",
          refresh: "refresh",
          expires: 123,
        },
      }),
    ).toBe(2);
    expect(await store.credentialSummaries()).toHaveLength(2);
  });

  it("refuses plaintext fallback when OS encryption is unavailable", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-settings-"));
    cleanupPaths.push(directory);
    const adapter: SafeStorageAdapter = {
      isEncryptionAvailable: () => false,
      encryptString: () => Buffer.alloc(0),
      decryptString: () => "",
    };
    const store = new EncryptedSettingsStore(
      join(directory, "settings.json"),
      adapter,
    );

    await expect(
      store.saveCredential("openai", {
        type: "api_key",
        key: "must-not-write",
      }),
    ).rejects.toThrow("encryption is unavailable");
  });

  it("rejects malformed imported credentials", async () => {
    const { filePath, store } = await createStore();
    await writeFile(filePath, JSON.stringify({ version: 1, credentials: {} }));

    await expect(
      store.importPiAuth({
        openai: { type: "oauth", access: "missing fields" },
      }),
    ).rejects.toThrow("invalid");
  });
});
