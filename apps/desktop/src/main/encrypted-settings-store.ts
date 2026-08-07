import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type {
  AgentRuntimeConfiguration,
  AppLanguage,
  AppTheme,
  ApprovalPolicy,
  ModelSelection,
  ProviderConnection,
  RuntimeCredential,
} from "@artemis/protocol";
import {
  appLanguageSchema,
  appThemeSchema,
  approvalPolicySchema,
  contextWindowSchema,
  providerConnectionSchema,
} from "@artemis/protocol";

import {
  parseAgentConcurrencyPreference,
  type AgentConcurrencyPreference,
} from "../shared/agent-concurrency.js";

export interface SafeStorageAdapter {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

interface EncryptedCredential {
  type: RuntimeCredential["type"];
  encrypted: string;
}

export interface AddedModelConfiguration {
  providerId: string;
  modelId: string;
  contextWindow: number;
}

interface PersistedSettings {
  version: 1;
  model?: ModelSelection;
  addedModels?: AddedModelConfiguration[];
  language?: AppLanguage;
  theme?: AppTheme;
  approvalPolicy?: ApprovalPolicy;
  localFullAccess?: boolean;
  contextWindow?: number;
  credentials: Record<string, EncryptedCredential>;
  providers?: Record<string, ProviderConnection>;
  disabledSkillFiles?: string[];
  agentConcurrency?: AgentConcurrencyPreference;
}

export interface CredentialSummary {
  providerId: string;
  type: RuntimeCredential["type"];
}

const EMPTY_SETTINGS: PersistedSettings = {
  version: 1,
  addedModels: [],
  credentials: {},
  providers: {},
};

function validateProviderId(providerId: string): string {
  const normalized = providerId.trim();
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/u.test(normalized)) {
    throw new Error("Provider ID is invalid");
  }
  return normalized;
}

function validateModelId(modelId: string): string {
  const normalized = modelId.trim();
  if (!normalized || Buffer.byteLength(normalized, "utf8") > 1_024) {
    throw new Error("Model ID is invalid");
  }
  return normalized;
}

function validateAddedModel(
  input: AddedModelConfiguration,
): AddedModelConfiguration {
  return {
    providerId: validateProviderId(input.providerId),
    modelId: validateModelId(input.modelId),
    contextWindow: contextWindowSchema.parse(input.contextWindow),
  };
}

export function parseRuntimeCredential(value: unknown): RuntimeCredential {
  if (!value || typeof value !== "object") {
    throw new Error("Credential must be an object");
  }
  const record = value as Record<string, unknown>;
  if (record.type === "api_key") {
    if (record.key !== undefined && typeof record.key !== "string") {
      throw new Error("API key must be a string");
    }
    const env =
      record.env && typeof record.env === "object"
        ? Object.fromEntries(
            Object.entries(record.env).map(([key, envValue]) => {
              if (typeof envValue !== "string") {
                throw new Error(
                  "Credential environment values must be strings",
                );
              }
              return [key, envValue];
            }),
          )
        : undefined;
    return {
      type: "api_key",
      ...(record.key ? { key: record.key } : {}),
      ...(env ? { env } : {}),
    };
  }
  if (
    record.type === "oauth" &&
    typeof record.refresh === "string" &&
    record.refresh &&
    typeof record.access === "string" &&
    record.access &&
    typeof record.expires === "number" &&
    Number.isFinite(record.expires)
  ) {
    return structuredClone(record) as RuntimeCredential;
  }
  throw new Error("Credential type or fields are invalid");
}

export class EncryptedSettingsStore {
  private settings: PersistedSettings | undefined;

  constructor(
    private readonly filePath: string,
    private readonly safeStorage: SafeStorageAdapter,
  ) {}

  get encryptionAvailable(): boolean {
    return this.safeStorage.isEncryptionAvailable();
  }

  async runtimeConfiguration(): Promise<AgentRuntimeConfiguration> {
    const settings = await this.load();
    const credentials: Record<string, RuntimeCredential> = {};
    if (this.encryptionAvailable) {
      for (const [providerId, encrypted] of Object.entries(
        settings.credentials,
      )) {
        const plainText = this.safeStorage.decryptString(
          Buffer.from(encrypted.encrypted, "base64"),
        );
        credentials[providerId] = parseRuntimeCredential(JSON.parse(plainText));
      }
    }
    const providers = Object.values(settings.providers ?? {}).sort(
      (left, right) => left.id.localeCompare(right.id),
    );
    return {
      credentials,
      ...(providers.length ? { providers: structuredClone(providers) } : {}),
      ...(settings.model ? { selection: structuredClone(settings.model) } : {}),
      ...(settings.contextWindow
        ? { contextWindow: settings.contextWindow }
        : {}),
      ...(settings.disabledSkillFiles?.length
        ? {
            disabledSkillFiles: structuredClone(settings.disabledSkillFiles),
          }
        : {}),
    };
  }

  async disabledSkillFiles(): Promise<string[]> {
    return structuredClone((await this.load()).disabledSkillFiles ?? []);
  }

  async setSkillEnabled(skillFile: string, enabled: boolean): Promise<void> {
    const normalized = skillFile.trim();
    if (!normalized || Buffer.byteLength(normalized, "utf8") > 16 * 1024) {
      throw new Error("Skill path is invalid");
    }
    const settings = await this.load();
    const comparable = (value: string) =>
      process.platform === "win32" ? value.toLowerCase() : value;
    const disabled = (settings.disabledSkillFiles ?? []).filter(
      (candidate) => comparable(candidate) !== comparable(normalized),
    );
    if (!enabled) disabled.push(normalized);
    settings.disabledSkillFiles = disabled.sort((left, right) =>
      left.localeCompare(right),
    );
    await this.save(settings);
  }

  async languagePreference(): Promise<AppLanguage> {
    return (await this.load()).language ?? "system";
  }

  async setLanguagePreference(language: AppLanguage): Promise<void> {
    const settings = await this.load();
    settings.language = appLanguageSchema.parse(language);
    await this.save(settings);
  }

  async themePreference(): Promise<AppTheme> {
    return (await this.load()).theme ?? "system";
  }

  async setThemePreference(theme: AppTheme): Promise<void> {
    const settings = await this.load();
    settings.theme = appThemeSchema.parse(theme);
    await this.save(settings);
  }

  async credentialSummaries(): Promise<CredentialSummary[]> {
    const settings = await this.load();
    return Object.entries(settings.credentials)
      .map(([providerId, credential]) => ({
        providerId,
        type: credential.type,
      }))
      .sort((left, right) => left.providerId.localeCompare(right.providerId));
  }

  async providerConnections(): Promise<ProviderConnection[]> {
    const settings = await this.load();
    return Object.values(settings.providers ?? {})
      .map((provider) => structuredClone(provider))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  async addedModels(): Promise<AddedModelConfiguration[]> {
    return structuredClone((await this.load()).addedModels ?? []);
  }

  async addModel(
    modelInput: AddedModelConfiguration,
    apiKey?: string,
  ): Promise<void> {
    const model = validateAddedModel(modelInput);
    let encryptedCredential: EncryptedCredential | undefined;
    if (apiKey !== undefined) {
      if (!this.encryptionAvailable) {
        throw new Error("OS credential encryption is unavailable");
      }
      const credential: RuntimeCredential = { type: "api_key", key: apiKey };
      encryptedCredential = {
        type: credential.type,
        encrypted: this.safeStorage
          .encryptString(JSON.stringify(credential))
          .toString("base64"),
      };
    }
    const settings = await this.load();
    settings.addedModels = [
      ...(settings.addedModels ?? []).filter(
        (candidate) =>
          candidate.providerId !== model.providerId ||
          candidate.modelId !== model.modelId,
      ),
      model,
    ].sort(
      (left, right) =>
        left.providerId.localeCompare(right.providerId) ||
        left.modelId.localeCompare(right.modelId),
    );
    if (encryptedCredential) {
      settings.credentials[model.providerId] = encryptedCredential;
    }
    await this.save(settings);
  }

  async saveProviderConnection(
    providerInput: ProviderConnection,
    apiKey?: string,
  ): Promise<void> {
    const provider = providerConnectionSchema.parse(providerInput);
    const settings = await this.load();
    settings.providers ??= {};
    settings.providers[provider.id] = structuredClone(provider);
    if (apiKey !== undefined) {
      if (!this.encryptionAvailable) {
        throw new Error("OS credential encryption is unavailable");
      }
      const credential: RuntimeCredential = { type: "api_key", key: apiKey };
      settings.credentials[provider.id] = {
        type: credential.type,
        encrypted: this.safeStorage
          .encryptString(JSON.stringify(credential))
          .toString("base64"),
      };
    }
    await this.save(settings);
  }

  async deleteProviderConnection(
    providerId: string,
    replacement?: {
      selection: ModelSelection;
      contextWindow: number;
    },
  ): Promise<void> {
    const normalizedProviderId = validateProviderId(providerId);
    const normalizedReplacement = replacement
      ? {
          selection: {
            ...structuredClone(replacement.selection),
            providerId: validateProviderId(replacement.selection.providerId),
            modelId: validateModelId(replacement.selection.modelId),
          },
          contextWindow: contextWindowSchema.parse(replacement.contextWindow),
        }
      : undefined;
    if (normalizedReplacement?.selection.providerId === normalizedProviderId) {
      throw new Error("Replacement model cannot use the deleted provider");
    }

    const settings = await this.load();
    settings.providers ??= {};
    delete settings.providers[normalizedProviderId];
    delete settings.credentials[normalizedProviderId];
    settings.addedModels = (settings.addedModels ?? []).filter(
      (model) => model.providerId !== normalizedProviderId,
    );
    if (settings.model?.providerId === normalizedProviderId) {
      if (normalizedReplacement) {
        settings.model = normalizedReplacement.selection;
        settings.contextWindow = normalizedReplacement.contextWindow;
      } else {
        delete settings.model;
        delete settings.contextWindow;
      }
    }
    await this.save(settings);
  }

  async contextWindowPreference(): Promise<number | undefined> {
    return (await this.load()).contextWindow;
  }

  async modelSelection(): Promise<ModelSelection | undefined> {
    const selection = (await this.load()).model;
    return selection ? structuredClone(selection) : undefined;
  }

  async setModel(
    selection: ModelSelection,
    contextWindow: number,
    apiKey?: string,
  ): Promise<void> {
    let providerId: string | undefined;
    let encryptedCredential: EncryptedCredential | undefined;
    if (apiKey !== undefined) {
      if (!this.encryptionAvailable) {
        throw new Error("OS credential encryption is unavailable");
      }
      providerId = validateProviderId(selection.providerId);
      const credential: RuntimeCredential = { type: "api_key", key: apiKey };
      encryptedCredential = {
        type: credential.type,
        encrypted: this.safeStorage
          .encryptString(JSON.stringify(credential))
          .toString("base64"),
      };
    }
    const settings = await this.load();
    settings.model = structuredClone(selection);
    settings.contextWindow = contextWindowSchema.parse(contextWindow);
    if (providerId && encryptedCredential) {
      settings.credentials[providerId] = encryptedCredential;
    }
    await this.save(settings);
  }

  async approvalPolicy(): Promise<ApprovalPolicy> {
    return (await this.load()).approvalPolicy ?? "agent";
  }

  async setApprovalPolicy(policy: ApprovalPolicy): Promise<void> {
    const settings = await this.load();
    settings.approvalPolicy = approvalPolicySchema.parse(policy);
    await this.save(settings);
  }

  async localFullAccess(): Promise<boolean> {
    return (await this.load()).localFullAccess ?? false;
  }

  async agentConcurrencyPreference(): Promise<AgentConcurrencyPreference> {
    return structuredClone(
      (await this.load()).agentConcurrency ?? { mode: "auto" },
    );
  }

  async setAgentConcurrencyPreference(
    preference: AgentConcurrencyPreference,
  ): Promise<void> {
    const settings = await this.load();
    settings.agentConcurrency = parseAgentConcurrencyPreference(preference);
    await this.save(settings);
  }

  async setLocalFullAccess(enabled: boolean): Promise<void> {
    const settings = await this.load();
    settings.localFullAccess = Boolean(enabled);
    await this.save(settings);
  }

  async saveCredential(
    providerId: string,
    credentialInput: RuntimeCredential,
  ): Promise<void> {
    if (!this.encryptionAvailable) {
      throw new Error("OS credential encryption is unavailable");
    }
    const normalizedProvider = validateProviderId(providerId);
    const credential = parseRuntimeCredential(credentialInput);
    const settings = await this.load();
    settings.credentials[normalizedProvider] = {
      type: credential.type,
      encrypted: this.safeStorage
        .encryptString(JSON.stringify(credential))
        .toString("base64"),
    };
    await this.save(settings);
  }

  async deleteCredential(providerId: string): Promise<void> {
    const settings = await this.load();
    delete settings.credentials[validateProviderId(providerId)];
    await this.save(settings);
  }

  async importPiAuth(value: unknown): Promise<number> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Pi auth.json must contain a provider object");
    }
    const credentials = Object.entries(value).map(
      ([providerId, credential]) =>
        [
          validateProviderId(providerId),
          parseRuntimeCredential(credential),
        ] as const,
    );
    for (const [providerId, credential] of credentials) {
      await this.saveCredential(providerId, credential);
    }
    return credentials.length;
  }

  private async load(): Promise<PersistedSettings> {
    if (this.settings) {
      return this.settings;
    }
    try {
      const parsed = JSON.parse(
        await readFile(this.filePath, "utf8"),
      ) as PersistedSettings;
      if (
        parsed.version !== 1 ||
        !parsed.credentials ||
        typeof parsed.credentials !== "object" ||
        (parsed.language !== undefined &&
          !appLanguageSchema.safeParse(parsed.language).success) ||
        (parsed.theme !== undefined &&
          !appThemeSchema.safeParse(parsed.theme).success) ||
        (parsed.approvalPolicy !== undefined &&
          !approvalPolicySchema.safeParse(parsed.approvalPolicy).success) ||
        (parsed.localFullAccess !== undefined &&
          typeof parsed.localFullAccess !== "boolean") ||
        (parsed.contextWindow !== undefined &&
          !contextWindowSchema.safeParse(parsed.contextWindow).success) ||
        (parsed.addedModels !== undefined &&
          (!Array.isArray(parsed.addedModels) ||
            !parsed.addedModels.every((model) => {
              try {
                validateAddedModel(model);
                return true;
              } catch {
                return false;
              }
            }))) ||
        (parsed.disabledSkillFiles !== undefined &&
          (!Array.isArray(parsed.disabledSkillFiles) ||
            !parsed.disabledSkillFiles.every(
              (path) =>
                typeof path === "string" &&
                path.length > 0 &&
                Buffer.byteLength(path, "utf8") <= 16 * 1024,
            ))) ||
        (parsed.agentConcurrency !== undefined &&
          (() => {
            try {
              parseAgentConcurrencyPreference(parsed.agentConcurrency);
              return false;
            } catch {
              return true;
            }
          })()) ||
        (parsed.providers !== undefined &&
          (!parsed.providers ||
            typeof parsed.providers !== "object" ||
            !Object.values(parsed.providers).every(
              (provider) =>
                providerConnectionSchema.safeParse(provider).success,
            )))
      ) {
        throw new Error("Artemis settings file is invalid");
      }
      parsed.addedModels ??=
        parsed.model && parsed.contextWindow
          ? [
              validateAddedModel({
                providerId: parsed.model.providerId,
                modelId: parsed.model.modelId,
                contextWindow: parsed.contextWindow,
              }),
            ]
          : [];
      parsed.providers ??= {};
      if (parsed.agentConcurrency) {
        parsed.agentConcurrency = parseAgentConcurrencyPreference(
          parsed.agentConcurrency,
        );
      }
      this.settings = parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      this.settings = structuredClone(EMPTY_SETTINGS);
    }
    return this.settings;
  }

  private async save(settings: PersistedSettings): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(
      temporaryPath,
      `${JSON.stringify(settings, undefined, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    await rename(temporaryPath, this.filePath);
    this.settings = settings;
  }
}
