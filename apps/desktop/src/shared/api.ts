import type {
  AgentEvent,
  AgentHostEvent,
  AppLanguage,
  AppSnapshot,
  AppTheme,
  ApprovalPolicy,
  ApprovalResolution,
  Automation,
  AutomationEvent,
  AutomationRun,
  AutomationSchedule,
  AutomationTarget,
  PromptAttachment,
  ProviderConnection,
  Project,
  ReviewAction,
  ReviewMutationInput,
  ReviewQuery,
  ReviewScope,
  RunMode,
  ShellRuntimeConfiguration,
  TaskWorktree,
  Thread,
  UserInputResolution,
  WorkspaceTarget,
} from "@artemis/protocol";
import type {
  AgentConcurrencyPreference,
  AgentConcurrencyStatus,
} from "./agent-concurrency.js";

export type {
  AgentConcurrencyPreference,
  AgentConcurrencyPressureReason,
  AgentConcurrencyStatus,
} from "./agent-concurrency.js";
import type {
  AgentModelInfo,
  ExtensionRuntimeTool,
  McpRuntimeTool,
  ModelSelection,
  RuntimeCredential,
} from "@artemis/protocol";

export type {
  ReviewAction,
  ReviewMutationInput,
  ReviewQuery,
  ReviewScope,
} from "@artemis/protocol";

export interface CreateThreadInput {
  projectId?: string;
  mode: RunMode;
  target: WorkspaceTarget;
}

export interface StartTurnInput {
  threadId: string;
  text: string;
  mode: RunMode;
  attachments?: PromptAttachment[];
  submittedAt?: number;
}

export interface StartTurnResult {
  turnId: string;
  thread: Thread;
}

export interface SaveAutomationInput {
  id?: string;
  projectId: string;
  name: string;
  prompt: string;
  mode: RunMode;
  target: AutomationTarget;
  schedule: AutomationSchedule;
  enabled: boolean;
}

export interface QueueTurnInput {
  threadId: string;
  text: string;
  attachments?: PromptAttachment[];
}

export interface QueuedTurnMessages {
  steering: string[];
  followUp: string[];
}

export interface ReplaceQueuedTurnInput {
  threadId: string;
  followUp: string[];
}

export interface SteerQueuedTurnInput {
  threadId: string;
  followUpIndex: number;
  expectedFollowUp: string[];
}

export interface ChildAgentControlInput {
  threadId: string;
  agentId: string;
  action: "status" | "steer" | "cancel" | "retry";
  message?: string;
}

export interface ChildAgentControlResult {
  agentId: string;
  status: string;
}

export interface AgentTeamControlInput {
  threadId: string;
  teamId: string;
  action: "cancel";
}

export interface AgentTeamControlResult {
  team: {
    teamId: string;
    status: string;
  };
}

export interface ForkThreadResult {
  thread: Thread;
  events: AgentEvent[];
  worktree?: TaskWorktree;
}

export interface ReviewHunk {
  id: string;
  header: string;
  additions: number;
  deletions: number;
  lines: ReviewLine[];
}

export interface ReviewLine {
  id: string;
  kind: "context" | "addition" | "deletion";
  text: string;
  oldLine?: number;
  newLine?: number;
}

export interface ReviewCommentAnchor {
  scope: ReviewScope;
  lineId: string;
  path: string;
  kind: ReviewLine["kind"];
  text: string;
  oldLine?: number;
  newLine?: number;
}

export interface ReviewComment extends ReviewCommentAnchor {
  id: string;
  threadId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface AddReviewCommentInput extends ReviewQuery {
  lineId: string;
  body: string;
}

export interface ReviewFile {
  id: string;
  path: string;
  status: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
  binary: boolean;
  untracked: boolean;
  hunks: ReviewHunk[];
}

export interface ReviewDiff {
  scope: ReviewScope;
  text: string;
  available: boolean;
  files: ReviewFile[];
  baseRef?: string;
  message?: string;
}

export interface ReviewMutationResult {
  recoveryPath?: string;
}

export interface CleanupWorktreeResult {
  thread: Thread;
  worktree: TaskWorktree;
}

export interface RestoreWorktreeSnapshotResult {
  worktree: TaskWorktree;
  restoredFiles: string[];
}

export interface HandoffWorkspaceResult {
  thread: Thread;
  worktree?: TaskWorktree;
  bundlePath: string;
}

export interface TerminalOpenInput {
  threadId: string;
  cols: number;
  rows: number;
}

export interface WorkspaceTextFile {
  path: string;
  kind: "html" | "markdown";
  content: string;
}

export interface WorkspaceImageFile {
  path: string;
  mimeType:
    | "image/avif"
    | "image/gif"
    | "image/jpeg"
    | "image/png"
    | "image/svg+xml"
    | "image/webp";
  data: string;
}

export interface WorkspaceDirectoryEntry {
  name: string;
  path: string;
  kind: "directory" | "file" | "symlink";
}

export interface WorkspaceFileContent {
  path: string;
  binary: boolean;
  content?: string;
}

export interface WorkspaceFileLink {
  path: string;
  viewer: "markdown" | "browser" | "file";
  executable: boolean;
  line?: number;
  column?: number;
}

export interface TerminalDescriptor {
  terminalId: string;
  shell: string;
  sandboxImplementation: string;
}

export interface TerminalData {
  terminalId: string;
  data: string;
}

export interface TerminalExit {
  terminalId: string;
  exitCode: number;
  signal?: number;
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
  profileAvatar?: string;
  projectOrder?: string[];
  projectThreadOrder?: Record<string, string[]>;
  projectSidebarWidth?: number;
  temporaryConversationsOpen?: boolean;
  workspaceDockWidth?: number;
  selection?: ModelSelection;
}

export interface GlobalAgentsSnapshot {
  path: string;
  content: string;
}

export type ConfigurationImportSource = "codex" | "opencode" | "claude";
export type ConfigurationImportCategory = "instructions" | "skills" | "mcp";

export interface ConfigurationImportCounts {
  instructions: number;
  skills: number;
  mcp: number;
}

export interface ConfigurationImportSourcePreview {
  source: ConfigurationImportSource;
  detected: boolean;
  paths: string[];
  counts: ConfigurationImportCounts;
  warnings: string[];
}

export interface ConfigurationImportPreview {
  sources: ConfigurationImportSourcePreview[];
}

export interface ConfigurationImportRequest {
  sources: ConfigurationImportSource[];
  categories: ConfigurationImportCategory[];
}

export interface ConfigurationImportSummary {
  imported: ConfigurationImportCounts;
  skipped: string[];
  warnings: string[];
}

export interface ConfigurationImportResult {
  settings: SettingsSnapshot;
  summary: ConfigurationImportSummary;
}

export interface ReleaseUpdateStatus {
  state:
    | "disabled"
    | "idle"
    | "checking"
    | "available"
    | "downloading"
    | "downloaded"
    | "error";
  currentVersion: string;
  availableVersion?: string;
  progress?: number;
  rollbackAvailable: boolean;
  message?: string;
}

export interface TrustedExtensionConfig {
  id: string;
  name: string;
  path: string;
  sha256: string;
  enabled: boolean;
  allowNetwork: boolean;
  trustedAt: string;
}

export interface TrustedExtensionStatus {
  config: TrustedExtensionConfig;
  state: "disabled" | "ready" | "changed" | "failed";
  tools: ExtensionRuntimeTool[];
  unsupported?: {
    handlers: number;
    commands: number;
    flags: number;
    shortcuts: number;
  };
  error?: string;
}

export interface McpResourceMetadata {
  resourceKind?: "mcp" | "connector";
  connectorId?: string;
  hostAuth?: GoogleMcpHostAuth;
}

export interface GoogleMcpHostAuth {
  provider: "google";
  grant: "google-workspace" | "gmail";
  scopes: string[];
}

export type GoogleGrantId = "google-workspace" | "gmail";

export interface GoogleAccountStatus {
  encryptionAvailable: boolean;
  clientConfigured: boolean;
  connected: boolean;
  email?: string;
  grants: Record<GoogleGrantId, { authorized: boolean; scopes: string[] }>;
}

export type McpServerConfig = (
  | {
      id: string;
      name: string;
      transport: "stdio";
      enabled: boolean;
      command: string;
      args: string[];
      env: Record<string, string>;
      envVars: string[];
      credentialEnvVars?: string[];
      workspacePath: string;
      allowNetwork: boolean;
      fullAccess?: boolean;
    }
  | {
      id: string;
      name: string;
      transport: "streamable-http";
      enabled: boolean;
      url: string;
      auth?: "none" | "bearer" | "oauth" | "headers";
      credentialProviderId?: string;
      headerNames?: string[];
    }
) &
  McpResourceMetadata;

export interface McpServerStatus {
  config: McpServerConfig;
  state:
    | "disconnected"
    | "connecting"
    | "authorization-required"
    | "authorizing"
    | "connected"
    | "failed";
  error?: string;
  tools: McpRuntimeTool[];
}

export interface McpCatalogItem {
  configId: string;
  registryName: string;
  title: string;
  description: string;
  version: string;
  installable: boolean;
  installMode: "ready" | "needs-input" | "unsupported";
  installed: boolean;
  installOption?: McpCatalogInstallOption;
  remoteUrl?: string;
  repositoryUrl?: string;
  reason?: string;
}

export interface McpCatalogInstallInput {
  id: string;
  label: string;
  description?: string;
  required: boolean;
  secret: boolean;
  defaultValue?: string;
}

export interface McpCatalogInstallOption {
  id: string;
  kind: "remote" | "npm-stdio";
  label: string;
  detail: string;
  inputs: McpCatalogInstallInput[];
}

export interface McpCatalogInstallRequest {
  registryName: string;
  version: string;
  optionId: string;
  inputValues: Record<string, string>;
  operationId: string;
}

export interface SkillCatalogItem {
  id: string;
  slug: string;
  name: string;
  source: string;
  installs: number;
  installed: boolean;
  sourceUrl?: string;
  catalogUrl?: string;
}

export interface InstalledSkill {
  id: string;
  name: string;
  description: string;
  path: string;
  enabled: boolean;
  source?: string;
  installedAt?: string;
}

export type CodexPluginSource =
  | { kind: "local"; path: string }
  | { kind: "bundled"; pluginName: string }
  // Kept so installations created before Lite mode can update in place.
  | { kind: "runtime"; pluginName: string }
  | {
      kind: "git";
      marketplaceUrl: string;
      marketplaceName: string;
      pluginName: string;
    };

export interface CodexPluginSkillPreview {
  name: string;
  description: string;
}

export interface CodexPluginMcpPreview {
  name: string;
  transport: "stdio" | "streamable-http" | "unsupported";
  endpoint: string;
  importable: boolean;
  requiresSetup: boolean;
}

export interface CodexPluginAppPreview {
  name: string;
  connectorId?: string;
  required?: boolean;
  url?: string;
  auth?: "none" | "bearer" | "oauth";
}

export interface CodexPluginPreview {
  id: string;
  name: string;
  displayName: string;
  version: string;
  description: string;
  shortDescription?: string;
  category?: string;
  brandColor?: string;
  iconDataUrl?: string;
  source: CodexPluginSource;
  installed: boolean;
  installable: boolean;
  skills: CodexPluginSkillPreview[];
  mcpServers: CodexPluginMcpPreview[];
  apps: CodexPluginAppPreview[];
  unsupported: string[];
  warnings: string[];
}

export interface InstalledCodexPlugin extends CodexPluginPreview {
  contentHash: string;
  installedAt: string;
  updatedAt: string;
  skillNames: string[];
  mcpServerIds: string[];
}

export interface CodexPluginMarketplace {
  name: string;
  marketplaceName: string;
  url: string;
  plugins: CodexPluginPreview[];
  warnings: string[];
}

export interface CodexPluginMarketplaceSource {
  id: string;
  url: string;
  marketplaceName: string;
  displayName: string;
  repository: string;
  builtIn: boolean;
  removable: boolean;
  offline: boolean;
  refreshable: boolean;
  order: number;
  addedAt?: string;
  signingKeyFingerprint?: string;
}

export interface CodexPluginMarketplaceTrustPreview {
  url: string;
  repository: string;
  marketplaceName: string;
  displayName: string;
  signed: boolean;
  signingKeyFingerprint?: string;
}

export interface CodexPluginOfflineMarketplacePreview {
  path: string;
  trust: CodexPluginMarketplaceTrustPreview;
}

export interface CodexPluginMarketplaceEntry {
  sourceId: string;
  marketplace: CodexPluginMarketplace;
}

export interface CodexPluginMarketplaceError {
  sourceId: string;
  message: string;
}

export interface CodexPluginMarketplaceState {
  selectedView: string;
  sources: CodexPluginMarketplaceSource[];
  marketplaces: CodexPluginMarketplaceEntry[];
  errors: CodexPluginMarketplaceError[];
}

export interface CodexPluginMutationResult {
  plugins: InstalledCodexPlugin[];
  skills: InstalledSkill[];
  settings: SettingsSnapshot;
  warnings: string[];
}

export interface ResourceInstallProgress {
  operationId: string;
  kind: "mcp" | "skill" | "plugin";
  resourceId: string;
  percent: number;
}

export interface RendererDiagnostic {
  kind: "error" | "unhandled-rejection";
  message: string;
  stack?: string;
}

export interface DesktopSnapshot extends AppSnapshot {
  userName: string;
}

export interface ProjectGitBranch {
  name: string;
  current: boolean;
  upstream?: string;
}

export interface ProjectGitInfo {
  managed: boolean;
  root?: string;
  currentBranch?: string;
  head?: string;
  headOid?: string;
  detached: boolean;
  changeCount: number;
  additions: number;
  deletions: number;
  stagedAdditions: number;
  stagedDeletions: number;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  conflictCount: number;
  upstream?: string;
  ahead: number;
  behind: number;
  branches: ProjectGitBranch[];
}

export type ProjectPullRequestState = "OPEN" | "CLOSED" | "MERGED";
export type ProjectPullRequestCheckStatus =
  "passed" | "failed" | "pending" | "skipped" | "cancelled";

export interface ProjectPullRequestCheck {
  name: string;
  status: ProjectPullRequestCheckStatus;
  detailsUrl?: string;
  workflowName?: string;
}

export interface ProjectPullRequest {
  number: number;
  title: string;
  url: string;
  state: ProjectPullRequestState;
  isDraft: boolean;
  headRefName: string;
  headRefOid: string;
  checks: ProjectPullRequestCheck[];
}

export type ProjectPullRequestLookup =
  | { status: "found"; pullRequest: ProjectPullRequest }
  | { status: "not-found" }
  | {
      status: "unavailable";
      reason: "gh-not-installed" | "authentication-required";
    };

export interface ProjectGitCommitResult {
  commit: string;
  gitInfo: ProjectGitInfo;
}

export interface ProjectGitPushResult {
  upstream: string;
  gitInfo: ProjectGitInfo;
}

export interface ArtemisApi {
  getSnapshot(): Promise<DesktopSnapshot>;
  getThreadEvents(threadId: string): Promise<AgentEvent[]>;
  getTokenUsageEvents(): Promise<AgentEvent[]>;
  getPromptHistory(): Promise<string[]>;
  rendererReady(): void;
  openProject(): Promise<Project | undefined>;
  removeProject(projectId: string): Promise<void>;
  getProjectGitInfo(projectId: string): Promise<ProjectGitInfo>;
  getProjectPullRequest(projectId: string): Promise<ProjectPullRequestLookup>;
  switchProjectBranch(
    projectId: string,
    branchName: string,
  ): Promise<ProjectGitInfo>;
  createProjectBranch(
    projectId: string,
    branchName: string,
  ): Promise<ProjectGitInfo>;
  commitProjectChanges(
    projectId: string,
    message: string,
    includeUnstaged: boolean,
  ): Promise<ProjectGitCommitResult>;
  pushProjectBranch(projectId: string): Promise<ProjectGitPushResult>;
  selectPromptAttachments(): Promise<PromptAttachment[] | undefined>;
  readPromptAttachments(files: File[]): Promise<PromptAttachment[]>;
  createThread(input: CreateThreadInput): Promise<Thread | undefined>;
  setThreadModelSelection(
    threadId: string,
    selection: ModelSelection,
  ): Promise<Thread>;
  renameThread(threadId: string, title: string): Promise<Thread>;
  setThreadGoal(threadId: string, goal: string | null): Promise<Thread>;
  archiveThread(threadId: string, archived: boolean): Promise<Thread>;
  deleteThread(threadId: string): Promise<void>;
  forkThread(threadId: string, entryId?: string): Promise<ForkThreadResult>;
  compactThread(threadId: string, instructions?: string): Promise<void>;
  prepareThread(threadId: string): Promise<void>;
  branchizeWorktree(
    threadId: string,
    branchName: string,
  ): Promise<TaskWorktree>;
  cleanupWorktree(
    threadId: string,
    force: boolean,
  ): Promise<CleanupWorktreeResult>;
  restoreWorktreeSnapshot(
    worktreeId: string,
  ): Promise<RestoreWorktreeSnapshotResult>;
  handoffWorkspace(
    threadId: string,
    destination: "local" | "managed-worktree",
  ): Promise<HandoffWorkspaceResult>;
  startTurn(input: StartTurnInput): Promise<StartTurnResult>;
  reportTurnRendered(turnId: string, renderedAt: number): void;
  steerTurn(input: QueueTurnInput): Promise<void>;
  followUpTurn(input: QueueTurnInput): Promise<void>;
  clearTurnQueue(threadId: string): Promise<QueuedTurnMessages>;
  steerTurnQueue(threadId: string): Promise<void>;
  steerQueuedTurn(input: SteerQueuedTurnInput): Promise<void>;
  replaceTurnQueue(input: ReplaceQueuedTurnInput): Promise<void>;
  cancelTurn(threadId: string): Promise<void>;
  controlChildAgent(
    input: ChildAgentControlInput,
  ): Promise<ChildAgentControlResult>;
  controlAgentTeam(
    input: AgentTeamControlInput,
  ): Promise<AgentTeamControlResult>;
  resolveApproval(resolution: ApprovalResolution): Promise<void>;
  resolveUserInput(resolution: UserInputResolution): Promise<void>;
  listAutomations(projectId?: string): Promise<Automation[]>;
  listAutomationRuns(
    automationId: string,
    limit?: number,
  ): Promise<AutomationRun[]>;
  saveAutomation(input: SaveAutomationInput): Promise<Automation>;
  setAutomationEnabled(id: string, enabled: boolean): Promise<Automation>;
  authorizeAutomation(id: string): Promise<Automation | undefined>;
  deleteAutomation(id: string): Promise<void>;
  runAutomationNow(id: string): Promise<AutomationRun>;
  getReviewDiff(query: ReviewQuery): Promise<ReviewDiff>;
  mutateReviewDiff(input: ReviewMutationInput): Promise<ReviewMutationResult>;
  listReviewComments(threadId: string): Promise<ReviewComment[]>;
  addReviewComment(input: AddReviewCommentInput): Promise<ReviewComment>;
  deleteReviewComment(threadId: string, commentId: string): Promise<void>;
  readWorkspaceTextFile(
    threadId: string,
    path: string,
  ): Promise<WorkspaceTextFile>;
  readWorkspaceImage(
    threadId: string,
    markdownPath: string,
    href: string,
  ): Promise<WorkspaceImageFile>;
  listWorkspaceDirectory(
    threadId: string,
    path: string,
  ): Promise<WorkspaceDirectoryEntry[]>;
  readWorkspaceFile(
    threadId: string,
    path: string,
  ): Promise<WorkspaceFileContent>;
  writeWorkspaceFile(
    threadId: string,
    path: string,
    content: string,
  ): Promise<WorkspaceFileContent>;
  inspectWorkspaceFileLink(
    threadId: string,
    href: string,
  ): Promise<WorkspaceFileLink>;
  revealWorkspaceFile(threadId: string, path: string): Promise<void>;
  runWorkspaceFile(threadId: string, path: string): Promise<void>;
  openTerminal(input: TerminalOpenInput): Promise<TerminalDescriptor>;
  writeTerminal(terminalId: string, data: string): Promise<void>;
  resizeTerminal(terminalId: string, cols: number, rows: number): Promise<void>;
  closeTerminal(terminalId: string): Promise<void>;
  onTerminalData(listener: (event: TerminalData) => void): () => void;
  onTerminalExit(listener: (event: TerminalExit) => void): () => void;
  getSettings(): Promise<SettingsSnapshot>;
  setLanguage(language: AppLanguage): Promise<SettingsSnapshot>;
  setTheme(theme: AppTheme): Promise<SettingsSnapshot>;
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
  setProjectOrder(order: string[]): Promise<string[]>;
  setProjectThreadOrder(projectId: string, order: string[]): Promise<string[]>;
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
  importPiCredentials(): Promise<
    { imported: number; settings: SettingsSnapshot } | undefined
  >;
  saveGlobalAgents(content: string): Promise<SettingsSnapshot>;
  scanConfigurationImports(): Promise<ConfigurationImportPreview>;
  importConfiguration(
    request: ConfigurationImportRequest,
  ): Promise<ConfigurationImportResult>;
  saveMcpServer(
    config: McpServerConfig,
    bearerToken?: string,
  ): Promise<SettingsSnapshot>;
  setMcpServerEnabled(
    serverId: string,
    enabled: boolean,
  ): Promise<SettingsSnapshot>;
  reconnectMcpServer(serverId: string): Promise<SettingsSnapshot>;
  authorizeMcpServer(serverId: string): Promise<SettingsSnapshot>;
  removeMcpServer(serverId: string): Promise<SettingsSnapshot>;
  confirmResourceAction(message: string): Promise<boolean>;
  listMcpServers(): Promise<McpServerStatus[]>;
  searchMcpCatalog(query: string): Promise<McpCatalogItem[]>;
  installMcpCatalog(
    request: McpCatalogInstallRequest,
  ): Promise<SettingsSnapshot>;
  searchSkillCatalog(query: string): Promise<SkillCatalogItem[]>;
  listInstalledSkills(): Promise<InstalledSkill[]>;
  installSkillCatalog(
    skillId: string,
    operationId: string,
  ): Promise<InstalledSkill>;
  installLocalSkill(operationId: string): Promise<InstalledSkill | undefined>;
  setSkillEnabled(skillId: string, enabled: boolean): Promise<InstalledSkill[]>;
  removeSkill(skillId: string): Promise<InstalledSkill[]>;
  listCodexPlugins(): Promise<InstalledCodexPlugin[]>;
  inspectLocalCodexPlugin(): Promise<CodexPluginPreview | undefined>;
  loadCodexPluginMarketplace(
    url: string,
    operationId: string,
    refresh?: boolean,
  ): Promise<CodexPluginMarketplace>;
  getCodexPluginMarketplaces(
    sourceId?: string,
  ): Promise<CodexPluginMarketplaceState>;
  addCodexPluginMarketplace(
    url: string,
    operationId: string,
    signingKeyFingerprint?: string,
  ): Promise<CodexPluginMarketplaceState>;
  inspectCodexPluginMarketplaceTrust(
    url: string,
  ): Promise<CodexPluginMarketplaceTrustPreview>;
  inspectOfflineCodexPluginMarketplace(): Promise<
    CodexPluginOfflineMarketplacePreview | undefined
  >;
  addOfflineCodexPluginMarketplace(
    path: string,
    operationId: string,
    signingKeyFingerprint: string,
  ): Promise<CodexPluginMarketplaceState>;
  getGoogleAccountStatus(): Promise<GoogleAccountStatus>;
  authorizeGoogleGrant(grant: GoogleGrantId): Promise<GoogleAccountStatus>;
  disconnectGoogleGrant(grant: GoogleGrantId): Promise<GoogleAccountStatus>;
  disconnectGoogleAccount(): Promise<GoogleAccountStatus>;
  selectCodexPluginMarketplace(
    sourceId: string,
  ): Promise<CodexPluginMarketplaceState>;
  refreshCodexPluginMarketplace(
    sourceId: string,
    operationId: string,
  ): Promise<CodexPluginMarketplaceState>;
  removeCodexPluginMarketplace(
    sourceId: string,
  ): Promise<CodexPluginMarketplaceState>;
  reorderCodexPluginMarketplaces(
    sourceIds: string[],
  ): Promise<CodexPluginMarketplaceState>;
  loadCodexRuntimeMarketplace(): Promise<CodexPluginMarketplace | undefined>;
  installCodexRuntimePlugins(
    operationId: string,
  ): Promise<CodexPluginMutationResult>;
  installCodexPlugin(
    source: CodexPluginSource,
    operationId: string,
  ): Promise<CodexPluginMutationResult>;
  updateCodexPlugin(
    pluginId: string,
    operationId: string,
  ): Promise<CodexPluginMutationResult>;
  setCodexPluginEnabled(
    pluginId: string,
    enabled: boolean,
  ): Promise<CodexPluginMutationResult>;
  removeCodexPlugin(pluginId: string): Promise<CodexPluginMutationResult>;
  trustExtension(): Promise<SettingsSnapshot | undefined>;
  retrustExtension(extensionId: string): Promise<SettingsSnapshot>;
  setTrustedExtensionEnabled(
    extensionId: string,
    enabled: boolean,
  ): Promise<SettingsSnapshot>;
  setTrustedExtensionNetwork(
    extensionId: string,
    allowNetwork: boolean,
  ): Promise<SettingsSnapshot>;
  removeTrustedExtension(extensionId: string): Promise<SettingsSnapshot>;
  checkForUpdates(): Promise<ReleaseUpdateStatus>;
  installUpdate(): Promise<void>;
  exportDiagnostics(): Promise<string | undefined>;
  reportRendererError(diagnostic: RendererDiagnostic): void;
  onResourceInstallProgress(
    listener: (progress: ResourceInstallProgress) => void,
  ): () => void;
  onUpdateStatus(listener: (status: ReleaseUpdateStatus) => void): () => void;
  onAgentEvent(listener: (event: AgentEvent) => void): () => void;
  onAgentEvents(listener: (events: AgentEvent[]) => void): () => void;
  onAgentActivities(listener: (events: AgentHostEvent[]) => void): () => void;
  onAutomationEvent(listener: (event: AutomationEvent) => void): () => void;
  onAutomationThreadOpen(listener: (threadId: string) => void): () => void;
}

export const IPC = {
  snapshot: "artemis:snapshot",
  threadEvents: "artemis:thread-events",
  tokenUsageEvents: "artemis:token-usage-events",
  promptHistory: "artemis:prompt-history",
  rendererReady: "artemis:renderer-ready",
  projectOpen: "artemis:project-open",
  projectRemove: "artemis:project-remove",
  projectGitInfo: "artemis:project-git-info",
  projectPullRequest: "artemis:project-pull-request",
  projectGitBranchSwitch: "artemis:project-git-branch-switch",
  projectGitBranchCreate: "artemis:project-git-branch-create",
  projectGitCommit: "artemis:project-git-commit",
  projectGitPush: "artemis:project-git-push",
  promptAttachmentsSelect: "artemis:prompt-attachments-select",
  promptAttachmentsRead: "artemis:prompt-attachments-read",
  threadCreate: "artemis:thread-create",
  threadModelSet: "artemis:thread-model-set",
  threadRename: "artemis:thread-rename",
  threadGoal: "artemis:thread-goal",
  threadArchive: "artemis:thread-archive",
  threadDelete: "artemis:thread-delete",
  threadFork: "artemis:thread-fork",
  threadCompact: "artemis:thread-compact",
  threadPrepare: "artemis:thread-prepare",
  worktreeBranchize: "artemis:worktree-branchize",
  worktreeCleanup: "artemis:worktree-cleanup",
  worktreeRestoreSnapshot: "artemis:worktree-restore-snapshot",
  worktreeHandoff: "artemis:worktree-handoff",
  turnStart: "artemis:turn-start",
  turnRendered: "artemis:turn-rendered",
  turnSteer: "artemis:turn-steer",
  turnFollowUp: "artemis:turn-follow-up",
  turnQueueClear: "artemis:turn-queue-clear",
  turnQueueSteer: "artemis:turn-queue-steer",
  turnQueueSteerItem: "artemis:turn-queue-steer-item",
  turnQueueReplace: "artemis:turn-queue-replace",
  turnCancel: "artemis:turn-cancel",
  childAgentControl: "artemis:child-agent-control",
  agentTeamControl: "artemis:agent-team-control",
  approvalResolve: "artemis:approval-resolve",
  userInputResolve: "artemis:user-input-resolve",
  automationList: "artemis:automation-list",
  automationRunList: "artemis:automation-run-list",
  automationSave: "artemis:automation-save",
  automationEnable: "artemis:automation-enable",
  automationAuthorize: "artemis:automation-authorize",
  automationDelete: "artemis:automation-delete",
  automationRunNow: "artemis:automation-run-now",
  automationEvent: "artemis:automation-event",
  automationThreadOpen: "artemis:automation-thread-open",
  reviewDiff: "artemis:review-diff",
  reviewMutate: "artemis:review-mutate",
  reviewCommentList: "artemis:review-comment-list",
  reviewCommentAdd: "artemis:review-comment-add",
  reviewCommentDelete: "artemis:review-comment-delete",
  workspaceTextFileRead: "artemis:workspace-text-file-read",
  workspaceImageRead: "artemis:workspace-image-read",
  workspaceDirectoryList: "artemis:workspace-directory-list",
  workspaceFileRead: "artemis:workspace-file-read",
  workspaceFileWrite: "artemis:workspace-file-write",
  workspaceFileLinkInspect: "artemis:workspace-file-link-inspect",
  workspaceFileReveal: "artemis:workspace-file-reveal",
  workspaceFileRun: "artemis:workspace-file-run",
  terminalOpen: "artemis:terminal-open",
  terminalWrite: "artemis:terminal-write",
  terminalResize: "artemis:terminal-resize",
  terminalClose: "artemis:terminal-close",
  terminalData: "artemis:terminal-data",
  terminalExit: "artemis:terminal-exit",
  settingsGet: "artemis:settings-get",
  settingsLanguageSet: "artemis:settings-language-set",
  settingsThemeSet: "artemis:settings-theme-set",
  settingsApprovalPolicySet: "artemis:settings-approval-policy-set",
  settingsLocalFullAccessSet: "artemis:settings-local-full-access-set",
  settingsShellRuntimeSet: "artemis:settings-shell-runtime-set",
  settingsAgentConcurrencySet: "artemis:settings-agent-concurrency-set",
  settingsModelAdd: "artemis:settings-model-add",
  settingsModelDelete: "artemis:settings-model-delete",
  settingsModelSet: "artemis:settings-model-set",
  settingsProfileAvatarSet: "artemis:settings-profile-avatar-set",
  settingsProjectOrderSet: "artemis:settings-project-order-set",
  settingsProjectThreadOrderSet: "artemis:settings-project-thread-order-set",
  settingsProjectSidebarWidthSet: "artemis:settings-project-sidebar-width-set",
  settingsTemporaryConversationsOpenSet:
    "artemis:settings-temporary-conversations-open-set",
  settingsWorkspaceDockWidthSet: "artemis:settings-workspace-dock-width-set",
  settingsApiKeySave: "artemis:settings-api-key-save",
  settingsProviderSave: "artemis:settings-provider-save",
  settingsProviderDelete: "artemis:settings-provider-delete",
  settingsCredentialDelete: "artemis:settings-credential-delete",
  settingsPiImport: "artemis:settings-pi-import",
  settingsGlobalAgentsSave: "artemis:settings-global-agents-save",
  settingsImportScan: "artemis:settings-import-scan",
  settingsImportApply: "artemis:settings-import-apply",
  mcpServerSave: "artemis:mcp-server-save",
  mcpServerEnable: "artemis:mcp-server-enable",
  mcpServerReconnect: "artemis:mcp-server-reconnect",
  mcpServerAuthorize: "artemis:mcp-server-authorize",
  mcpServerRemove: "artemis:mcp-server-remove",
  resourceConfirm: "artemis:resource-confirm",
  resourceMcpList: "artemis:resource-mcp-list",
  resourceMcpSearch: "artemis:resource-mcp-search",
  resourceMcpInstall: "artemis:resource-mcp-install",
  resourceSkillSearch: "artemis:resource-skill-search",
  resourceSkillList: "artemis:resource-skill-list",
  resourceSkillInstall: "artemis:resource-skill-install",
  resourceSkillInstallLocal: "artemis:resource-skill-install-local",
  resourceSkillEnable: "artemis:resource-skill-enable",
  resourceSkillRemove: "artemis:resource-skill-remove",
  resourcePluginList: "artemis:resource-plugin-list",
  resourcePluginInspectLocal: "artemis:resource-plugin-inspect-local",
  resourcePluginMarketplaceLoad: "artemis:resource-plugin-marketplace-load",
  resourcePluginMarketplaceList: "artemis:resource-plugin-marketplace-list",
  resourcePluginMarketplaceAdd: "artemis:resource-plugin-marketplace-add",
  resourcePluginMarketplaceTrust: "artemis:resource-plugin-marketplace-trust",
  resourcePluginMarketplaceInspectOffline:
    "artemis:resource-plugin-marketplace-inspect-offline",
  resourcePluginMarketplaceAddOffline:
    "artemis:resource-plugin-marketplace-add-offline",
  googleAccountStatus: "artemis:google-account-status",
  googleAccountAuthorizeGrant: "artemis:google-account-authorize-grant",
  googleAccountDisconnectGrant: "artemis:google-account-disconnect-grant",
  googleAccountDisconnect: "artemis:google-account-disconnect",
  resourcePluginMarketplaceSelect: "artemis:resource-plugin-marketplace-select",
  resourcePluginMarketplaceRefresh:
    "artemis:resource-plugin-marketplace-refresh",
  resourcePluginMarketplaceRemove: "artemis:resource-plugin-marketplace-remove",
  resourcePluginMarketplaceReorder:
    "artemis:resource-plugin-marketplace-reorder",
  resourcePluginRuntimeMarketplace:
    "artemis:resource-plugin-runtime-marketplace",
  resourcePluginRuntimeInstall: "artemis:resource-plugin-runtime-install",
  resourcePluginInstall: "artemis:resource-plugin-install",
  resourcePluginUpdate: "artemis:resource-plugin-update",
  resourcePluginEnable: "artemis:resource-plugin-enable",
  resourcePluginRemove: "artemis:resource-plugin-remove",
  resourceInstallProgress: "artemis:resource-install-progress",
  extensionTrust: "artemis:extension-trust",
  extensionRetrust: "artemis:extension-retrust",
  extensionEnable: "artemis:extension-enable",
  extensionNetwork: "artemis:extension-network",
  extensionRemove: "artemis:extension-remove",
  updateCheck: "artemis:update-check",
  updateInstall: "artemis:update-install",
  diagnosticsExport: "artemis:diagnostics-export",
  diagnosticsRendererError: "artemis:diagnostics-renderer-error",
  updateStatus: "artemis:update-status",
  agentEvent: "artemis:agent-event",
  agentEvents: "artemis:agent-events",
  agentActivities: "artemis:agent-activities",
} as const;
