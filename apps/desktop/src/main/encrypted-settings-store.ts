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
  ShellRuntimeConfiguration,
} from "@artemis/protocol";
import {
  DEFAULT_SHELL_RUNTIME_CONFIGURATION,
  appLanguageSchema,
  appThemeSchema,
  approvalPolicySchema,
  contextWindowSchema,
  providerConnectionSchema,
  shellRuntimeConfigurationSchema,
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
  shell?: ShellRuntimeConfiguration;
  contextWindow?: number;
  credentials: Record<string, EncryptedCredential>;
  providers?: Record<string, ProviderConnection>;
  disabledSkillFiles?: string[];
  agentConcurrency?: AgentConcurrencyPreference;
  profileAvatar?: string;
  projectOrder?: string[];
  projectSidebarWidth?: number;
  temporaryConversationsOpen?: boolean;
  workspaceDockWidth?: number;
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

export const WORKSPACE_DOCK_WIDTH_MIN = 320;
export const WORKSPACE_DOCK_WIDTH_MAX = 1_080;
export const PROJECT_SIDEBAR_WIDTH_MIN = 208;
export const PROJECT_SIDEBAR_WIDTH_MAX = 420;
const PROFILE_AVATAR_MAX_BYTES = 512 * 1024;
const PROJECT_ORDER_MAXIMUM = 10_000;

function validateProjectOrder(order: readonly string[]): string[] {
  if (
    !Array.isArray(order) ||
    order.length > PROJECT_ORDER_MAXIMUM ||
    !order.every(
      (projectId) =>
        typeof projectId === "string" &&
        projectId.length > 0 &&
        Buffer.byteLength(projectId, "utf8") <= 1_024,
    )
  ) {
    throw new Error("Project order is invalid");
  }
  if (new Set(order).size !== order.length) {
    throw new Error("Project order entries must be unique");
  }
  return [...order];
}

function validateProfileAvatar(avatar: string): string {
  const match = avatar.match(
    /^data:image\/(?:jpeg|png|webp);base64,(?<data>[A-Za-z0-9+/]+={0,2})$/u,
  );
  if (!match?.groups?.data) {
    throw new Error("Profile avatar must be a PNG, JPEG, or WebP image");
  }
  if (
    Buffer.from(match.groups.data, "base64").byteLength >
    PROFILE_AVATAR_MAX_BYTES
  ) {
    throw new Error("Profile avatar must not exceed 512 KiB");
  }
  return avatar;
}

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

function validateWorkspaceDockWidth(width: number): number {
  if (
    !Number.isInteger(width) ||
    width < WORKSPACE_DOCK_WIDTH_MIN ||
    width > WORKSPACE_DOCK_WIDTH_MAX
  ) {
    throw new Error(
      `Workspace dock width must be an integer from ${WORKSPACE_DOCK_WIDTH_MIN} to ${WORKSPACE_DOCK_WIDTH_MAX}`,
    );
  }
  return width;
}

function validateProjectSidebarWidth(width: number): number {
  if (
    !Number.isInteger(width) ||
    width < PROJECT_SIDEBAR_WIDTH_MIN ||
    width > PROJECT_SIDEBAR_WIDTH_MAX
  ) {
    throw new Error(
      `Project sidebar width must be an integer from ${PROJECT_SIDEBAR_WIDTH_MIN} to ${PROJECT_SIDEBAR_WIDTH_MAX}`,
    );
  }
  return width;
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
  private loading: Promise<PersistedSettings> | undefined;
  private persistence = Promise.resolve();

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
      ...(settings.shell ? { shell: structuredClone(settings.shell) } : {}),
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

  async profileAvatar(): Promise<string | undefined> {
    return (await this.load()).profileAvatar;
  }

  async setProfileAvatar(
    avatar: string | undefined,
  ): Promise<string | undefined> {
    const settings = await this.load();
    if (avatar === undefined) {
      delete settings.profileAvatar;
    } else {
      settings.profileAvatar = validateProfileAvatar(avatar);
    }
    await this.save(settings);
    return settings.profileAvatar;
  }

  async projectOrder(): Promise<string[]> {
    return [...((await this.load()).projectOrder ?? [])];
  }

  async setProjectOrder(order: readonly string[]): Promise<string[]> {
    const validated = validateProjectOrder(order);
    const settings = await this.load();
    settings.projectOrder = validated;
    await this.save(settings);
    return [...validated];
  }

  async workspaceDockWidth(): Promise<number | undefined> {
    return (await this.load()).workspaceDockWidth;
  }

  async projectSidebarWidth(): Promise<number | undefined> {
    return (await this.load()).projectSidebarWidth;
  }

  async setProjectSidebarWidth(width: number): Promise<number> {
    const validated = validateProjectSidebarWidth(width);
    const settings = await this.load();
    settings.projectSidebarWidth = validated;
    await this.save(settings);
    return validated;
  }

  async temporaryConversationsOpen(): Promise<boolean> {
    return (await this.load()).temporaryConversationsOpen ?? true;
  }

  async setTemporaryConversationsOpen(open: boolean): Promise<boolean> {
    if (typeof open !== "boolean") {
      throw new Error("Temporary conversation disclosure state is invalid");
    }
    const settings = await this.load();
    settings.temporaryConversationsOpen = open;
    await this.save(settings);
    return open;
  }

  async setWorkspaceDockWidth(width: number): Promise<number> {
    const validated = validateWorkspaceDockWidth(width);
    const settings = await this.load();
    settings.workspaceDockWidth = validated;
    await this.save(settings);
    return validated;
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

  async removeModel(
    modelInput: Pick<AddedModelConfiguration, "providerId" | "modelId">,
    options: {
      deleteCredential: boolean;
      replacement?: {
        selection: ModelSelection;
        contextWindow: number;
      };
    },
  ): Promise<boolean> {
    const providerId = validateProviderId(modelInput.providerId);
    const modelId = validateModelId(modelInput.modelId);
    const replacement = options.replacement
      ? {
          selection: {
            ...structuredClone(options.replacement.selection),
            providerId: validateProviderId(
              options.replacement.selection.providerId,
            ),
            modelId: validateModelId(options.replacement.selection.modelId),
          },
          contextWindow: contextWindowSchema.parse(
            options.replacement.contextWindow,
          ),
        }
      : undefined;
    if (
      replacement?.selection.providerId === providerId &&
      replacement.selection.modelId === modelId
    ) {
      throw new Error("Replacement model cannot be the deleted model");
    }

    const settings = await this.load();
    const exists = (settings.addedModels ?? []).some(
      (model) => model.providerId === providerId && model.modelId === modelId,
    );
    if (!exists) return false;

    settings.addedModels = (settings.addedModels ?? []).filter(
      (model) => model.providerId !== providerId || model.modelId !== modelId,
    );
    const selectionRemainsAvailable = Boolean(
      settings.providers?.[providerId]?.models.some(
        (model) => model.id === modelId,
      ),
    );
    if (
      !selectionRemainsAvailable &&
      settings.model?.providerId === providerId &&
      settings.model.modelId === modelId
    ) {
      if (replacement) {
        settings.model = replacement.selection;
        settings.contextWindow = replacement.contextWindow;
      } else {
        delete settings.model;
        delete settings.contextWindow;
      }
    }
    const providerStillUsesCredential =
      Boolean(settings.providers?.[providerId]) ||
      settings.addedModels.some((model) => model.providerId === providerId);
    if (options.deleteCredential && !providerStillUsesCredential) {
      delete settings.credentials[providerId];
    }
    await this.save(settings);
    return true;
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

  async shellRuntimeConfiguration(): Promise<ShellRuntimeConfiguration> {
    return structuredClone(
      (await this.load()).shell ?? DEFAULT_SHELL_RUNTIME_CONFIGURATION,
    );
  }

  async setShellRuntimeConfiguration(
    configuration: ShellRuntimeConfiguration,
  ): Promise<void> {
    const settings = await this.load();
    settings.shell = shellRuntimeConfigurationSchema.parse(configuration);
    await this.save(settings);
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
    this.loading ??= this.loadUncached();
    try {
      return await this.loading;
    } finally {
      this.loading = undefined;
    }
  }

  private async loadUncached(): Promise<PersistedSettings> {
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
        (parsed.shell !== undefined &&
          !shellRuntimeConfigurationSchema.safeParse(parsed.shell).success) ||
        (parsed.contextWindow !== undefined &&
          !contextWindowSchema.safeParse(parsed.contextWindow).success) ||
        (parsed.profileAvatar !== undefined &&
          (() => {
            try {
              validateProfileAvatar(parsed.profileAvatar);
              return false;
            } catch {
              return true;
            }
          })()) ||
        (parsed.projectOrder !== undefined &&
          (() => {
            try {
              validateProjectOrder(parsed.projectOrder);
              return false;
            } catch {
              return true;
            }
          })()) ||
        (parsed.projectSidebarWidth !== undefined &&
          (() => {
            try {
              validateProjectSidebarWidth(parsed.projectSidebarWidth);
              return false;
            } catch {
              return true;
            }
          })()) ||
        (parsed.temporaryConversationsOpen !== undefined &&
          typeof parsed.temporaryConversationsOpen !== "boolean") ||
        (parsed.workspaceDockWidth !== undefined &&
          (() => {
            try {
              validateWorkspaceDockWidth(parsed.workspaceDockWidth);
              return false;
            } catch {
              return true;
            }
          })()) ||
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
    const snapshot = structuredClone(settings);
    const operation = this.persistence.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.tmp`;
      await writeFile(
        temporaryPath,
        `${JSON.stringify(snapshot, undefined, 2)}\n`,
        { encoding: "utf8", mode: 0o600 },
      );
      await rename(temporaryPath, this.filePath);
    });
    this.persistence = operation.catch(() => undefined);
    await operation;
  }
}
