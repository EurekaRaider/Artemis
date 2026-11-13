import type {
  ProviderLoginOption,
  ProviderLoginState,
} from "../provider-login.js";
import type {
  AppLanguage,
  AppSnapshot,
  AppTheme,
  ApprovalPolicy,
  ProviderConnection,
  ShellRuntimeConfiguration,
} from "@artemis/protocol";
import type {
  AgentConcurrencyPreference,
  AgentConcurrencyStatus,
} from "../agent-concurrency.js";
import type {
  AgentModelInfo,
  ModelSelection,
  RuntimeCredential,
} from "@artemis/protocol";
import type { McpServerStatus } from "./mcp.js";
import type { TrustedExtensionStatus } from "./extensions.js";
import type { ReleaseUpdateStatus } from "./updates-diagnostics.js";
import type { CustomAgentSummary } from "./custom-agents.js";
export interface SettingsApi {
  getSettings(): Promise<SettingsSnapshot>;
  setLanguage(language: AppLanguage): Promise<SettingsSnapshot>;
  setTheme(theme: AppTheme): Promise<SettingsSnapshot>;
  setMaterial(
    material: import("../window-material.js").MaterialPreference,
  ): Promise<SettingsSnapshot>;
  setComposerPredictions(enabled: boolean): Promise<SettingsSnapshot>;
  setPreventSleep(enabled: boolean): Promise<SettingsSnapshot>;
  setApprovalPolicy(policy: ApprovalPolicy): Promise<SettingsSnapshot>;
  setLocalFullAccess(enabled: boolean): Promise<SettingsSnapshot>;
  setShellRuntimeConfiguration(
    configuration: ShellRuntimeConfiguration,
  ): Promise<SettingsSnapshot>;
  setAgentConcurrency(
    preference: AgentConcurrencyPreference,
  ): Promise<SettingsSnapshot>;
  setModelSelection(selection: ModelSelection): Promise<SettingsSnapshot>;
  addModel(
    model: AddedModelConfiguration,
    apiKey?: string,
  ): Promise<SettingsSnapshot>;
  removeModel(
    model: Pick<AddedModelConfiguration, "providerId" | "modelId">,
  ): Promise<SettingsSnapshot>;
  setProfileAvatar(avatar?: string): Promise<SettingsSnapshot>;
  /** Blank or omitted clears the saved name. */
  setProfileName(name?: string): Promise<SettingsSnapshot>;
  setProjectOrder(order: string[]): Promise<string[]>;
  setProjectThreadOrder(projectId: string, order: string[]): Promise<string[]>;
  setCollapsedProjectIds(projectIds: string[]): Promise<string[]>;
  setExpandedProjectIds(projectIds: string[]): Promise<string[]>;
  setWorkspaceDockWidth(width: number): Promise<number>;
  setProjectSidebarWidth(width: number): Promise<number>;
  setTemporaryConversationsOpen(open: boolean): Promise<boolean>;
  saveApiKey(providerId: string, apiKey: string): Promise<SettingsSnapshot>;
  saveProviderConnection(
    provider: ProviderConnection,
    apiKey?: string,
  ): Promise<SettingsSnapshot>;
  deleteProviderConnection(providerId: string): Promise<SettingsSnapshot>;
  deleteCredential(providerId: string): Promise<SettingsSnapshot>;
  providerLoginOptions(): Promise<ProviderLoginOption[]>;
  providerLoginStart(
    providerId: string,
    type: "api_key" | "oauth",
  ): Promise<ProviderLoginState>;
  providerLoginStatus(id: string): Promise<ProviderLoginState>;
  providerLoginAnswer(
    id: string,
    promptId: string,
    value: string,
  ): Promise<ProviderLoginState>;
  providerLoginCancel(id: string): Promise<void>;
  importPiCredentials(): Promise<
    { imported: number; settings: SettingsSnapshot } | undefined
  >;
  saveGlobalAgents(content: string): Promise<SettingsSnapshot>;
}

export interface CredentialSummary {
  providerId: string;
  type: RuntimeCredential["type"];
}

export interface AddedModelConfiguration {
  providerId: string;
  modelId: string;
  contextWindow: number;
}

export interface SettingsSnapshot {
  platform: "win32" | "darwin" | "other";
  encryptionAvailable: boolean;
  language: AppLanguage;
  theme: AppTheme;
  material?: import("../window-material.js").MaterialPreference;
  preventSleep?: boolean;
  composerPredictions?: boolean;
  resolvedLocale: AppSnapshot["locale"];
  approvalPolicy: ApprovalPolicy;
  localFullAccess: boolean;
  shell: ShellRuntimeConfiguration;
  fullAccessAvailable: boolean;
  contextWindow: number;
  models: AgentModelInfo[];
  addedModels: AddedModelConfiguration[];
  credentials: CredentialSummary[];
  providers: ProviderConnection[];
  mcpServers: McpServerStatus[];
  globalAgents: GlobalAgentsSnapshot;
  trustedExtensions: TrustedExtensionStatus[];
  update: ReleaseUpdateStatus;
  agentConcurrency: AgentConcurrencyStatus;
  /** Custom sub-agent definitions (metadata only, no instructions). */
  customAgents: CustomAgentSummary[];
  profileAvatar?: string;
  /** Saved name; absent when the default name applies. */
  profileName?: string;
  /** System user name, used when no name is saved. */
  defaultUserName: string;
  projectOrder?: string[];
  projectThreadOrder?: Record<string, string[]>;
  collapsedProjectIds?: string[];
  expandedProjectIds?: string[];
  projectSidebarWidth?: number;
  temporaryConversationsOpen?: boolean;
  workspaceDockWidth?: number;
  selection?: ModelSelection;
}

export interface GlobalAgentsSnapshot {
  path: string;
  content: string;
}
