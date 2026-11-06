import { createBrowserSessionPolicy } from "./browser/browser-session-policy.js";
import { createTaskWorkspaces } from "./workspace/task-workspaces.js";
import { createPluginRuntime } from "./plugins/plugin-runtime.js";
import { createHookRuntime } from "./hooks/hook-runtime.js";
import { createAttachmentRuntime } from "./conversation/attachment-runtime.js";
import { createStartupRuntime } from "./platform/startup-runtime.js";
import { createWindowAppearance } from "./appearance/window-appearance.js";
import { createOfficeRuntime } from "./office/office-runtime.js";
import { createAutomationController } from "./automation/automation-controller.js";
import { createConnectionCoordinator } from "./mcp/connection-coordinator.js";
import { createSettingsSnapshot } from "./settings/settings-snapshot.js";
import { createModelRuntime } from "./settings/model-runtime.js";
import { createTaskRouting } from "./notifications/task-routing.js";
import { createEventPipeline } from "./conversation/event-pipeline.js";
import { createTurnLatency } from "./diagnostics/turn-latency.js";
import { createCapacityMonitor } from "./agent/capacity-monitor.js";
import { createRuntimeCoordinator } from "./agent/runtime-coordinator.js";
import { createApprovalBroker } from "./broker/approval.js";
import { createExtensionBroker } from "./broker/extensions.js";
import { createMcpBroker } from "./broker/mcp.js";
import { createPluginBroker } from "./broker/plugins.js";
import { createMemoryBroker } from "./broker/memory.js";
import { createDocumentBroker } from "./broker/documents.js";
import { createLocalFileBroker } from "./broker/local-files.js";
import { createShellBroker } from "./broker/shell.js";
import { createUserInputBroker } from "./broker/user-input.js";
import { createBrokerDispatch } from "./broker/dispatch.js";
import { createGoalRuntime } from "./conversation/goal-runtime.js";
import type {
  PendingApproval,
  MultiQuestionUserInputRequest,
  PendingUserInput,
  PendingMultiUserInput,
  TurnLatencyTrace,
  ModelSettingsSnapshot,
  LocalFileBrokerRequest,
  GoalBrokerRequest,
} from "./application/runtime-types.js";
import { createSessionRuntime } from "./conversation/session-runtime.js";
import { createTurnQueueRuntime } from "./conversation/turn-queue-runtime.js";
import { createTurnExecution } from "./conversation/turn-execution.js";
import { createTurnControl } from "./conversation/turn-control.js";
import { createApplicationWindow } from "./application/main-window.js";
import { startApplication } from "./application/startup.js";
import { installApplicationLifecycle } from "./application/lifecycle.js";
import { registerIpc as registerApplicationIpc } from "./ipc/register-ipc.js";

import { BrowserSessionHost } from "./workspace/browser-session-host.js";

import { ConversationShareService } from "./conversation/conversation-share-service.js";
import { ComputerPreviewHost } from "./computer-use/preview-host.js";
import { ComputerPreviewWindow } from "./computer-use/preview-window.js";

import { readFileSync as readStartupFile } from "node:fs";

import { DesignPanelHost } from "./design/design-plugin-panel-host.js";

import { type PluginDispatch } from "./design/design-plugin-dispatch.js";

import { PanelSendEntryService } from "./design/design-plugin-send-entry.js";
import { ProviderLoginService } from "./settings/provider-login-service.js";

import { AppearanceService } from "./appearance/appearance-service.js";

import {
  type MaterialPreference,
  type WindowMaterial,
} from "../shared/window-material.js";
import { HooksService, type HookContext } from "./hooks/hooks-service.js";

import { ComputerUseRuntime } from "./computer-use/runtime.js";

import { ComputerUseHost } from "./computer-use/host.js";

import { resolveComputerTaskApproval } from "./computer-use/approval.js";

import type { HookQuery } from "@artemis/protocol";
import { ipcMain as electronIpcMain } from "electron";
import { applicationIpc } from "./application/application-ipc.js";
import { applicationHost } from "./application/application-host.js";
const ipcMain = applicationIpc(electronIpcMain);

import { ThreadHistoryService } from "./conversation/thread-history-service.js";

import { WorkspacePdfPreview } from "./workspace/workspace-pdf-preview.js";

import { WorkspaceVideoPreview } from "./workspace/workspace-video-preview.js";
import { AttachmentStore } from "./conversation/attachment-store.js";
import { WorkspaceHtmlPreview } from "./workspace/workspace-html-preview.js";

import { SleepPrevention } from "./platform/sleep-prevention.js";
import { ImService } from "./im/im-service.js";

import { type TurnCheckpoint } from "./conversation/turn-recovery.js";
import type { TurnRecovery } from "@artemis/protocol";

import { execFile } from "node:child_process";

import { TaskNotifications } from "./conversation/task-notifications.js";

import { type IntervalHistogram } from "node:perf_hooks";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { promisify } from "node:util";

import {
  app,
  BrowserWindow,
  powerSaveBlocker,
  type WebContents,
} from "electron";
import electronUpdater from "electron-updater";

import type {
  AgentEvent,
  AgentConcurrencyRuntimeStatus,
  AgentHostEvent,
  AgentRuntimeCatalog,
  AgentRuntimeConfiguration,
  AgentPayload,
  AppLanguage,
  AppLocale,
  AppTheme,
  ApprovalResolution,
  Automation,
  AutomationEvent,
  AutomationRun,
  BrokerExecutionRequest,
  ModelSelection,
  PromptAttachment,
  Project,
  RiskLevel,
  TaskWorktree,
  Thread,
  ThreadGoal,
  ThreadCommand,
  UserInputResolution,
  UserInputMultiQuestionResolution,
} from "@artemis/protocol";

import { threadCommandSchema, type PlanAcceptance } from "@artemis/protocol";

import {
  AgentProcess,
  type AgentProcessHandlers,
} from "./agent/agent-process.js";
import {
  AgentCapacityController,
  type AgentCapacityChange,
} from "./agent/agent-capacity-controller.js";

import { TaskSourceImageStore } from "./conversation/task-source-images.js";

import { AutomationScheduler } from "./automation/automation-scheduler.js";

import { PendingApprovalRegistry } from "./security/approval-policy.js";
import {
  PendingMultiUserInputRegistry,
  PendingUserInputRegistry,
} from "./security/user-input-policy.js";

import { createOfficeWorkbench } from "./office/office-workbench.js";

let officeWorkbench: ReturnType<typeof createOfficeWorkbench> | undefined;
function getOfficeWorkbench(): ReturnType<typeof createOfficeWorkbench> {
  return officeRuntime.getOfficeWorkbench();
}

import { RecoverableTurnQueues } from "./conversation/recoverable-turn-queue.js";

import { removeManagedWorktree as removeManagedWorktreeFromGit } from "./workspace/git-worktree.js";
import { WorktreeCapacity } from "./workspace/worktree-capacity.js";
import { AppStore } from "./settings/store.js";
import { TurnChangeSetService } from "./workspace/turn-change-set.js";
import { DiagnosticBundleService } from "./platform/diagnostic-bundle.js";
import { EncryptedSettingsStore } from "./settings/encrypted-settings-store.js";
import { ConfigurationImportService } from "./settings/configuration-import.js";
import { GlobalInstructionsStore } from "./settings/global-instructions-store.js";
import { MemoryStore } from "./memory/memory-store.js";

import { McpClientManager } from "./mcp/mcp-client-manager.js";
import type {
  McpConnectionAuthentication,
  McpConnectOptions,
} from "./mcp/mcp-client-manager.js";
import { McpConfigStore } from "./mcp/mcp-config-store.js";

import { McpOAuthStore } from "./mcp/mcp-oauth-store.js";
import { McpSecretStore } from "./mcp/mcp-secret-store.js";
import { ResourceCatalogService } from "./plugins/resource-catalog.js";
import { ArtemisPluginService } from "./plugins/artemis-plugin-service.js";

import { ConnectorService } from "./connectors/connector-service.js";

import { type PreparedNodePtyRuntime } from "./terminal/node-pty-runtime.js";
import {
  AutomaticTaskTitles,
  type ImTaskTitleContext,
} from "./conversation/task-title.js";

import { TerminalService } from "./terminal/terminal-service.js";
import { ReleaseUpdateManager } from "./updates/release-update-manager.js";
import { TrustedExtensionManager } from "./plugins/trusted-extension-manager.js";
import { TrustedExtensionStore } from "./plugins/trusted-extension-store.js";
import { readWorkspaceFile } from "./workspace/workspace-text-file.js";
import { type ResolvedWorkspaceFileLink } from "./workspace/workspace-file-link.js";

import {
  type AgentConcurrencyStatus,
  type ConfigurationImportRequest,
  type ArtemisPluginMutationResult,
  type CreateThreadInput,
  type InstalledSkill,
  type InstalledArtemisPlugin,
  type QueueTurnInput,
  type ReplaceQueuedTurnInput,
  type SteerQueuedTurnInput,
  type McpServerConfig,
  type ResourceInstallProgress,
  type StartTurnInput,
  type StartTurnResult,
  type SettingsSnapshot,
  type SaveAutomationInput,
} from "../shared/api.js";

import {
  createStartupTiming,
  type StartupTimingMark,
} from "./platform/startup-timing.js";

const { autoUpdater } = electronUpdater;

const execFileAsync = promisify(execFile);

let mainWindow: BrowserWindow | undefined;
let materialPreference: MaterialPreference = "glass";
let windowMaterial: WindowMaterial =
  process.platform === "darwin" ? "vibrancy" : "web";
let store: AppStore | undefined;
// S1 design-plugin panel host; created in the ready handler below.
let designPanelHost: DesignPanelHost | undefined;
// Artifact-write dispatches land outside registerIpc's scope; registerIpc
// installs this sink so they can trigger the debounced snapshot push.
let designArtifactWriteSink: ((threadId: string) => void) | undefined;
let pluginDispatch: PluginDispatch | undefined;
/**
 * Design-plugin availability gate, installed during startup (the design
 * capability runtime section). Non-null reason = plugin removed: panel
 * mounts and tool dispatches refuse. Undefined (before install) = usable.
 */
let designPluginAvailabilityGate:
  ((threadId?: string) => Promise<string | null>) | undefined;
let panelSendEntry: PanelSendEntryService | undefined;
let threadHistoryService: ThreadHistoryService | undefined;
let taskNotifications: TaskNotifications | undefined;
let pendingNotificationThreadId: string | undefined;
let pendingThreadLinkId: string | null | undefined;
let threadLinksReady = false;
let queuedThreadLink: string | undefined;
let notificationRendererReady = false;
let turnChangeSetService: TurnChangeSetService | undefined;
const automaticTaskTitles = new AutomaticTaskTitles();
const turnChangeSetCompletionTails = new Map<string, Promise<void>>();
let agentProcess: AgentProcess | undefined;
let terminalService: TerminalService | undefined;
let packagedNodePtyRuntime: PreparedNodePtyRuntime | undefined;
let packagedNodePtyRuntimeReady: Promise<void> | undefined;
let providerLoginService: ProviderLoginService | undefined;
let conversationShareService: ConversationShareService | undefined;
let settingsStore: EncryptedSettingsStore | undefined;
let globalInstructionsStore: GlobalInstructionsStore | undefined;
let configurationImportService: ConfigurationImportService | undefined;
let languagePreference: AppLanguage = "system";
let resolvedLocalePreference: AppLocale = "en";
let mcpConfigStore: McpConfigStore | undefined;
let mcpClientManager: McpClientManager | undefined;
let computerUseHost: ComputerUseHost | undefined;
let browserSessionHost: BrowserSessionHost | undefined;
let computerPreviewHost: ComputerPreviewHost | undefined;
let computerPreviewWindow: ComputerPreviewWindow | undefined;
let computerUseRuntime: ComputerUseRuntime | undefined;
let computerUseCalls = 0;
let computerUseServerId: string | undefined;
const activeMcpCalls = new Map<
  string,
  { threadId: string; serverId: string; controller: AbortController }
>();
let mcpOAuthStore: McpOAuthStore | undefined;
let mcpSecretStore: McpSecretStore | undefined;
let connectorService: ConnectorService | undefined;
let resourceCatalogService: ResourceCatalogService | undefined;
let artemisPluginService: ArtemisPluginService | undefined;
let appearanceService: AppearanceService | undefined;
const appearanceSystemPauseReasons = new Set<"sleep" | "lock">();
function syncAppearanceMedia(): void {
  return windowAppearance.syncAppearanceMedia();
}
function requireAppearanceSender(
  event: Electron.IpcMainInvokeEvent,
): AppearanceService {
  return windowAppearance.requireAppearanceSender(event);
}
let trustedExtensionStore: TrustedExtensionStore | undefined;
let trustedExtensionManager: TrustedExtensionManager | undefined;
let releaseUpdateManager: ReleaseUpdateManager | undefined;
let preparingUpdate = false;
let releaseUpdateReady: Promise<void> = Promise.resolve();
let diagnosticBundleService: DiagnosticBundleService | undefined;
let taskSourceImageStore: TaskSourceImageStore | undefined;
let agentCapacityController: AgentCapacityController | undefined;
let agentCapacityTimer: ReturnType<typeof setInterval> | undefined;
let agentCapacityEventLoopDelay: IntervalHistogram | undefined;
let agentCapacityRuntime: AgentConcurrencyRuntimeStatus | undefined;
let agentCapacityApplyTail: Promise<void> = Promise.resolve();
let agentCapacityMetricsWarningRecorded = false;
let automationScheduler: AutomationScheduler | undefined;
let agentRuntimeReady: Promise<void> = Promise.resolve();
let optionalCapabilitiesReady: Promise<void> = Promise.resolve();
let activeRuntimeSelection: ModelSelection | undefined;
let cachedAgentCatalog: AgentRuntimeCatalog = { models: [] };
let runtimeToolCount = 0;
let runtimeMcpToolCount = 0;
let enabledMcpServerCount = 0;
const AGENT_RUNTIME_CONFIGURATION_TIMEOUT_MS = 120_000;
const MCP_REGISTRY_NPM_STARTUP_TIMEOUT_MS = 60_000;
const memoryStores = new Map<string, MemoryStore>();
const startupTiming = createStartupTiming();
const startupTimings: StartupTimingMark[] = [];
let recordedStartupTimingCount = 0;

function markStartupStage(stage: string): void {
  return startupRuntime.markStartupStage(stage);
}

function ensureNodePtyRuntime(): Promise<void> {
  return startupRuntime.ensureNodePtyRuntime();
}

const turnLatencyTraces = new Map<string, TurnLatencyTrace>();

function recordAgentCapacityChange(change: AgentCapacityChange): void {
  return capacityMonitor.recordAgentCapacityChange(change);
}

function applyAgentCapacityChange(change: AgentCapacityChange): Promise<void> {
  return capacityMonitor.applyAgentCapacityChange(change);
}

function scheduleAgentCapacityChange(change: AgentCapacityChange): void {
  return capacityMonitor.scheduleAgentCapacityChange(change);
}

function agentConcurrencyStatus(
  refreshRuntime = true,
): Promise<AgentConcurrencyStatus> {
  return capacityMonitor.agentConcurrencyStatus(refreshRuntime);
}

function startAgentCapacityMonitoring(): void {
  return capacityMonitor.startAgentCapacityMonitoring();
}

function stopAgentCapacityMonitoring(): void {
  return capacityMonitor.stopAgentCapacityMonitoring();
}

function windowBackgroundColor(): string {
  return windowAppearance.windowBackgroundColor();
}

function applyMacDockIcon(): void {
  return windowAppearance.applyMacDockIcon();
}

function syncWindowBackgroundColors(): void {
  return windowAppearance.syncWindowBackgroundColors();
}

function syncMainWindowMaterial(window: BrowserWindow): void {
  return windowAppearance.syncMainWindowMaterial(window);
}

function applyNativeTheme(theme: AppTheme): void {
  return windowAppearance.applyNativeTheme(theme);
}

function memoryStore(path: string, maxBytes: number): MemoryStore {
  return attachmentRuntime.memoryStore(path, maxBytes);
}
let imService: ImService | undefined;
const openedThreads = new Set<string>();
const openingThreads = new Map<string, Promise<void>>();
const activeTurns = new Map<string, string>();
const cleaningWorktreeThreads = new Set<string>();
const cancellingTurns = new Set<string>();
const compactingThreads = new Set<string>();
const sleepPrevention = new SleepPrevention(powerSaveBlocker);
const compactionFollowUps = new RecoverableTurnQueues();
const pendingApprovals = new PendingApprovalRegistry<PendingApproval>();
const pendingUserInputs = new PendingUserInputRegistry<PendingUserInput>();
const pendingMultiUserInputs =
  new PendingMultiUserInputRegistry<PendingMultiUserInput>();
const scheduledGoalContinuations = new Set<string>();
const goalTurnContexts = new Map<
  string,
  {
    threadId: string;
    goalId: string;
    mode: StartTurnInput["mode"];
    source: "user" | "goal-continuation";
  }
>();
const goalCreationAuthorizations = new Set<string>();
const goalBlockerRecordedTurns = new Set<string>();
const activeTurnDispatches = new Map<string, string>();
let shuttingDown = false;
let endingHookSessions = false;
let hookSessionsEnded = false;
let recoveringUpdate = false;
if (process.platform === "win32") {
  try {
    recoveringUpdate = Boolean(
      JSON.parse(
        readStartupFile(
          join(app.getPath("userData"), "windows-update/recovery.json"),
          "utf8",
        ),
      ).pending,
    );
  } catch {
    /* A fresh installation has no recovery transaction. */
  }
}
const recoverableTurnQueues = new RecoverableTurnQueues();
let agentHostRestart: Promise<void> | undefined;

let attachmentStoreInstance: AttachmentStore | undefined;
const attachmentReads = new Map<string, Set<AbortController>>();
function attachmentStore(): AttachmentStore {
  return attachmentRuntime.attachmentStore();
}
function attachmentScope(threadId: string): string {
  return attachmentRuntime.attachmentScope(threadId);
}
function taskSourceImages(): TaskSourceImageStore {
  return attachmentRuntime.taskSourceImages();
}

function elapsed(
  start: number | undefined,
  end: number | undefined,
): number | undefined {
  return turnLatency.elapsed(start, end);
}

function finalizeTurnLatency(trace: TurnLatencyTrace): void {
  return turnLatency.finalizeTurnLatency(trace);
}

function observeTurnPayload(
  turnId: string | undefined,
  payload: AgentPayload,
): void {
  return turnLatency.observeTurnPayload(turnId, payload);
}

function withPersistedTurnDuration(
  turnId: string | undefined,
  payload: AgentPayload,
): AgentPayload {
  return turnLatency.withPersistedTurnDuration(turnId, payload);
}

function errorDetails(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
    };
  }
  return { message: String(error) };
}

process.on("uncaughtExceptionMonitor", (error) => {
  diagnosticBundleService?.record({
    source: "main",
    severity: "fatal",
    ...errorDetails(error),
  });
});

process.on("unhandledRejection", (reason) => {
  diagnosticBundleService?.record({
    source: "main",
    severity: "error",
    ...errorDetails(reason),
  });
});

function parseThreadCommand<T extends ThreadCommand["type"]>(
  command: Extract<ThreadCommand, { type: T }>,
): Extract<ThreadCommand, { type: T }> {
  return threadCommandSchema.parse(command) as Extract<
    ThreadCommand,
    { type: T }
  >;
}

function currentLocale(): AppLocale {
  return applicationHost.locale ?? resolvedLocalePreference;
}

const workspacePdfPreview = new WorkspacePdfPreview(async (threadId, path) => {
  const thread = store?.getThread(threadId);
  if (!thread || thread.archived) throw new Error("Active task not found.");
  const context = await resolveThreadWorkspace(thread);
  return readWorkspaceFile(context.workspacePath, path);
});

const workspaceVideoPreview = new WorkspaceVideoPreview(async (threadId) => {
  const thread = store?.getThread(threadId);
  if (!thread || thread.archived) throw new Error("Active task not found.");
  return (await resolveThreadWorkspace(thread)).workspacePath;
});

const workspaceHtmlPreview = new WorkspaceHtmlPreview(async (threadId) => {
  const thread = store?.getThread(threadId);
  if (!thread || thread.archived) throw new Error("Active task not found.");
  return (await resolveThreadWorkspace(thread)).workspacePath;
});

function configureBrowserLocaleSession(): void {
  return browserSessionPolicy.configureBrowserLocaleSession();
}

function currentPlatform(): "win32" | "darwin" | "other" {
  return process.platform === "win32" || process.platform === "darwin"
    ? process.platform
    : "other";
}

function managedWorktreeRoot(projectId: string): string {
  return join(app.getPath("userData"), "worktrees", projectId);
}

function worktreeRecoveryRoot(projectId: string): string {
  return join(app.getPath("userData"), "worktree-recovery", projectId);
}

function handoffBundleRoot(projectId: string, threadId: string): string {
  return join(app.getPath("userData"), "handoff-recovery", projectId, threadId);
}

function installOfficeSuite(): Promise<void> {
  return officeRuntime.installOfficeSuite();
}

function windowsSandboxHelperPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "resources", "windows-sandbox.ps1")
    : join(app.getAppPath(), "resources", "windows-sandbox.ps1");
}

function extensionWorkerPath(): string {
  return join(import.meta.dirname, "extension-worker.js");
}

function rollbackScriptPath(): string {
  const fileName =
    process.platform === "darwin"
      ? "update-rollback.sh"
      : "update-rollback.ps1";
  return app.isPackaged
    ? join(process.resourcesPath, "resources", fileName)
    : join(app.getAppPath(), "resources", fileName);
}

function bundledArtifactPluginsPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "resources", "bundled-artifact-plugins")
    : join(app.getAppPath(), "resources", "bundled-artifact-plugins");
}

function codexPrimaryRuntimePath(): string | undefined {
  const configured = process.env.ARTEMIS_CODEX_RUNTIME_ROOT;
  if (configured && isAbsolute(configured)) return configured;
  if (app.isPackaged) return undefined;
  return join(
    app.getPath("home"),
    ".cache",
    "codex-runtimes",
    "codex-primary-runtime",
  );
}

function installedApplicationPath(): string {
  return process.platform === "darwin"
    ? resolve(dirname(process.execPath), "..", "..")
    : process.execPath;
}

function normalizeModelSelection(
  selection: ModelSelection,
  supportsReasoning: boolean,
  highestThinkingLevel: ModelSelection["thinkingLevel"] = "high",
): ModelSelection {
  return modelRuntime.normalizeModelSelection(
    selection,
    supportsReasoning,
    highestThinkingLevel,
  );
}

function resolveModelSelection(
  selection: ModelSelection,
  currentSelection?: ModelSelection,
): Promise<{ selection: ModelSelection; contextWindow: number }> {
  return modelRuntime.resolveModelSelection(selection, currentSelection);
}

function agentProcessHandlers(): AgentProcessHandlers {
  return runtimeCoordinator.agentProcessHandlers();
}

let hooksService: HooksService | undefined;
function getHooksService(): HooksService {
  return hookRuntime.getHooksService();
}
function hookContext(query: HookQuery): Promise<HookContext> {
  return hookRuntime.hookContext(query);
}
function hookCatalog(
  query: HookQuery,
): Promise<import("@artemis/protocol").HookCatalog> {
  return hookRuntime.hookCatalog(query);
}
function contextForHook(query: HookQuery, id: string): Promise<HookContext> {
  return hookRuntime.contextForHook(query, id);
}
function hookPermission(
  request: BrokerExecutionRequest,
): Promise<"allow" | "deny" | undefined> {
  return hookRuntime.hookPermission(request);
}

function endHookSession(threadId: string): Promise<void> {
  return hookRuntime.endHookSession(threadId);
}

function createAgentHostProcess(): AgentProcess {
  return runtimeCoordinator.createAgentHostProcess();
}

function interruptTurnsAfterAgentHostExit(): void {
  return runtimeCoordinator.interruptTurnsAfterAgentHostExit();
}

function restartAgentHost(code: number | null): void {
  return runtimeCoordinator.restartAgentHost(code);
}

function applyAgentRuntime(
  configuration?: AgentRuntimeConfiguration,
): Promise<void> {
  return runtimeCoordinator.applyAgentRuntime(configuration);
}

function mcpBearerToken(config: McpServerConfig): Promise<string | undefined> {
  return connectionCoordinator.mcpBearerToken(config);
}

function mcpAuthentication(
  config: McpServerConfig,
): Promise<string | McpConnectionAuthentication | undefined> {
  return connectionCoordinator.mcpAuthentication(config);
}

function authorizeMcpServer(config: McpServerConfig): Promise<void> {
  return connectionCoordinator.authorizeMcpServer(config);
}

function connectMcpServer(
  config: McpServerConfig,
  authorizeMissingOAuth = false,
  options?: McpConnectOptions,
): Promise<void> {
  return connectionCoordinator.connectMcpServer(
    config,
    authorizeMissingOAuth,
    options,
  );
}

function ensureConnectorReady(config: McpServerConfig): Promise<void> {
  return connectionCoordinator.ensureConnectorReady(config);
}

function disableConnector(id: string): Promise<void> {
  return connectionCoordinator.disableConnector(id);
}

function resetAgentThreadsForToolChange(): Promise<void> {
  return runtimeCoordinator.resetAgentThreadsForToolChange();
}

/**
 * PR#245 P1-5：绑定设计插件后立刻收紧会话。若线程本进程内已按普通
 * profile 打开会话，原子关闭并按（已持久化的）受限 profile 重开——
 * 「打开面板即绑定」不能只改数据库不换会话。回合进行中无法安全关闭：
 * 保留旧会话并记录（主进程执行边界重检已按当前持久化 profile 拒绝能力
 * 型请求，窗口期不放大权限；下一次 openThread 的复用守卫会再重建）。
 */
function tightenThreadToRestrictedProfile(threadId: string): Promise<void> {
  return runtimeCoordinator.tightenThreadToRestrictedProfile(threadId);
}

function getModelSettingsSnapshot(): Promise<ModelSettingsSnapshot> {
  return modelRuntime.getModelSettingsSnapshot();
}

function getSettingsSnapshot(): Promise<SettingsSnapshot> {
  return settingsSnapshot.getSettingsSnapshot();
}

function getMcpServerStatuses(): Promise<SettingsSnapshot["mcpServers"]> {
  return settingsSnapshot.getMcpServerStatuses();
}

function installedSkillsWithState(): Promise<InstalledSkill[]> {
  return settingsSnapshot.installedSkillsWithState();
}

function pluginsWithHookState(): Promise<InstalledArtemisPlugin[]> {
  return settingsSnapshot.pluginsWithHookState();
}

function artemisPluginMutationResult(
  warnings: string[],
): Promise<ArtemisPluginMutationResult> {
  return pluginRuntime.artemisPluginMutationResult(warnings);
}

function enableManagedPluginSkills(skillNames: string[]): Promise<void> {
  return pluginRuntime.enableManagedPluginSkills(skillNames);
}

function reconcileManagedPluginSkills(
  previousNames: string[],
  nextNames: string[],
  previousEnabled: ReadonlyMap<string, boolean>,
  newSkillsEnabled = true,
): Promise<void> {
  return pluginRuntime.reconcileManagedPluginSkills(
    previousNames,
    nextNames,
    previousEnabled,
    newSkillsEnabled,
  );
}

function disconnectMcpServers(serverIds: string[]): Promise<void> {
  return connectionCoordinator.disconnectMcpServers(serverIds);
}

function reconnectEnabledMcpServers(
  configs: McpServerConfig[],
  authorizeMissingOAuth = false,
): Promise<void> {
  return connectionCoordinator.reconnectEnabledMcpServers(
    configs,
    authorizeMissingOAuth,
  );
}

function mcpSecretBinding(config: McpServerConfig): string | undefined {
  return connectionCoordinator.mcpSecretBinding(config);
}

function assertMcpSecretsAvailable(config: McpServerConfig): Promise<void> {
  return connectionCoordinator.assertMcpSecretsAvailable(config);
}

function removeMcpAuthentication(config: McpServerConfig): Promise<void> {
  return connectionCoordinator.removeMcpAuthentication(config);
}

function cleanupRemovedMcpAuthentication(
  before: McpServerConfig[],
  after: McpServerConfig[],
  scopedIds: ReadonlySet<string>,
): Promise<void> {
  return connectionCoordinator.cleanupRemovedMcpAuthentication(
    before,
    after,
    scopedIds,
  );
}

function resourceInstallOperationId(input: unknown): string {
  return pluginRuntime.resourceInstallOperationId(input);
}

function publishResourceInstallProgress(
  sender: WebContents,
  progress: ResourceInstallProgress,
): void {
  return pluginRuntime.publishResourceInstallProgress(sender, progress);
}

function restoreResourceDialogFocus(sender: WebContents): void {
  return pluginRuntime.restoreResourceDialogFocus(sender);
}

function validateConfigurationImportRequest(
  input: ConfigurationImportRequest,
): ConfigurationImportRequest {
  const sources = Array.isArray(input?.sources)
    ? [...new Set(input.sources)]
    : [];
  const categories = Array.isArray(input?.categories)
    ? [...new Set(input.categories)]
    : [];
  if (
    !sources.length ||
    !sources.every((source) =>
      ["codex", "opencode", "claude"].includes(source),
    ) ||
    !categories.length ||
    !categories.every((category) =>
      ["instructions", "skills", "mcp"].includes(category),
    )
  ) {
    throw new Error("Configuration import selection is invalid.");
  }
  return { sources, categories };
}

function saveMcpConfiguration(
  input: McpServerConfig,
  bearerToken?: string,
  connectionOptions?: McpConnectOptions,
  rejectConnectionFailure = false,
  credentialEnv?: Record<string, string>,
): Promise<SettingsSnapshot> {
  return connectionCoordinator.saveMcpConfiguration(
    input,
    bearerToken,
    connectionOptions,
    rejectConnectionFailure,
    credentialEnv,
  );
}

function refreshTrustedExtensions(): Promise<void> {
  return pluginRuntime.refreshTrustedExtensions();
}

function initializeOptionalCapabilities(): Promise<void> {
  return pluginRuntime.initializeOptionalCapabilities();
}

function pathIsInside(root: string, path: string): boolean {
  return taskWorkspaces.pathIsInside(root, path);
}

function pathsEqual(left: string, right: string): boolean {
  return taskWorkspaces.pathsEqual(left, right);
}

function approvalProjectId(thread: Thread): string {
  return taskWorkspaces.approvalProjectId(thread);
}

function resolveThreadWorkspace(thread: Thread): Promise<{
  project: Project;
  workspacePath: string;
  worktree?: TaskWorktree;
  temporary: boolean;
}> {
  return taskWorkspaces.resolveThreadWorkspace(thread);
}

function linkedWorkspaceFile(
  threadIdInput: string,
  hrefInput: string,
): Promise<ResolvedWorkspaceFileLink> {
  return taskWorkspaces.linkedWorkspaceFile(threadIdInput, hrefInput);
}

function launchWorkspaceFile(file: ResolvedWorkspaceFileLink): Promise<void> {
  return taskWorkspaces.launchWorkspaceFile(file);
}

const worktreeCapacity = new WorktreeCapacity(currentLocale);

function removeManagedWorktree(
  input: Parameters<typeof removeManagedWorktreeFromGit>[0],
): ReturnType<typeof removeManagedWorktreeFromGit> {
  return taskWorkspaces.removeManagedWorktree(input);
}

function createManagedTaskWorktree(
  project: Project,
  threadId: string,
  startPoint?: string,
): Promise<TaskWorktree> {
  return taskWorkspaces.createManagedTaskWorktree(
    project,
    threadId,
    startPoint,
  );
}

function createPermanentTaskWorktree(
  project: Project,
  threadId: string,
  worktreePath: string,
): Promise<TaskWorktree> {
  return taskWorkspaces.createPermanentTaskWorktree(
    project,
    threadId,
    worktreePath,
  );
}

function applyPayloadSideEffects(
  threadId: string,
  payload: AgentPayload,
  threadAlreadyUpdated = false,
  turnId?: string,
): void {
  return eventPipeline.applyPayloadSideEffects(
    threadId,
    payload,
    threadAlreadyUpdated,
    turnId,
  );
}

function applyGoalContinuationFailure(
  threadId: string,
  goalId: string,
  failure: { message: string; code?: string | undefined },
): { goal: ThreadGoal; continuationDelayMs: number } | undefined {
  return goalRuntime.applyGoalContinuationFailure(threadId, goalId, failure);
}

function scheduleGoalContinuation(
  threadId: string,
  goalId: string,
  delayMs = 0,
): void {
  return goalRuntime.scheduleGoalContinuation(threadId, goalId, delayMs);
}

function goalObjectiveRoot(): string {
  return goalRuntime.goalObjectiveRoot();
}

function materializeGoalObjective(objective: string): Promise<string> {
  return goalRuntime.materializeGoalObjective(objective);
}

function readGoalObjective(objective: string): Promise<string> {
  return goalRuntime.readGoalObjective(objective);
}

function cleanupGoalObjective(objective: string | undefined): Promise<void> {
  return goalRuntime.cleanupGoalObjective(objective);
}

function steerGoalObjectiveUpdate(goal: ThreadGoal): Promise<void> {
  return goalRuntime.steerGoalObjectiveUpdate(goal);
}

function accountGoalPayload(
  turnId: string | undefined,
  payload: AgentPayload,
): void {
  return goalRuntime.accountGoalPayload(turnId, payload);
}

/**
 * Routing audits (D#152 PR5) carry the trusted projectId from the thread
 * record; the runtime emits null and no model-visible field can supply it.
 */
function enrichCustomAgentRoutePayload(
  threadId: string,
  payload: AgentPayload,
): AgentPayload {
  return eventPipeline.enrichCustomAgentRoutePayload(threadId, payload);
}

function emitPayload(
  threadId: string,
  turnId: string | undefined,
  payload: AgentPayload,
  // Optional stamp override used by the multi-question expiry clamp: the
  // emitted timestamp is pinned onto the question's frozen deadline so the
  // reducer's time gates always agree with the main-process gate (review
  // item 1, scenarios A and B).
  timestamp?: string,
): AgentEvent {
  return eventPipeline.emitPayload(threadId, turnId, payload, timestamp);
}

function emitPayloadBatch(events: readonly AgentHostEvent[]): AgentEvent[] {
  return eventPipeline.emitPayloadBatch(events);
}

function observeTaskNotification(
  event: AgentEvent,
  deferNative = false,
): ReturnType<AppStore["notifications"]["observe"]> {
  return taskRouting.observeTaskNotification(event, deferNative);
}

export function openThreadLink(url: string): void {
  return taskRouting.openThreadLink(url);
}
function registerThreadLinks(): void {
  return taskRouting.registerThreadLinks();
}

function openTaskNotification(threadId: string): void {
  return taskRouting.openTaskNotification(threadId);
}

function scheduleTurnChangeSetCompletion(
  threadId: string,
  turnId: string | undefined,
  payload: AgentPayload,
): void {
  return eventPipeline.scheduleTurnChangeSetCompletion(
    threadId,
    turnId,
    payload,
  );
}

function prepareRecoverableQueuePayload(
  threadId: string,
  payload: AgentPayload,
  turnId?: string,
): AgentPayload {
  return eventPipeline.prepareRecoverableQueuePayload(
    threadId,
    payload,
    turnId,
  );
}

function emitInitialTurn(
  threadId: string,
  turnId: string,
  text: string,
  mode: StartTurnInput["mode"],
  attachments: PromptAttachment[],
  visibleUserMessage = true,
  checkpoint?: TurnCheckpoint,
  acceptance?: PlanAcceptance,
): Promise<AgentEvent[]> {
  return eventPipeline.emitInitialTurn(
    threadId,
    turnId,
    text,
    mode,
    attachments,
    visibleUserMessage,
    checkpoint,
    acceptance,
  );
}

function publishAutomationEvent(event: AutomationEvent): void {
  return automationController.publishAutomationEvent(event);
}

function publishAutomationRun(run: AutomationRun | undefined): void {
  return automationController.publishAutomationRun(run);
}

function automationAutoApproval(request: BrokerExecutionRequest): boolean {
  return automationController.automationAutoApproval(request);
}

function createAutomationApproval(
  request: BrokerExecutionRequest,
  details: {
    summary: string;
    paths?: string[];
    network?: string[];
    risk: RiskLevel;
  },
): ApprovalResolution | undefined {
  return automationController.createAutomationApproval(request, details);
}

function completeUserInput(
  resolution: UserInputResolution,
  source: "user" | "timeout",
): void {
  return userInputBroker.completeUserInput(resolution, source);
}

function handleUserInputBrokerRequest(
  workerRequestId: string,
  request: Extract<BrokerExecutionRequest, { kind: "user.input" }>,
): void {
  return userInputBroker.handleUserInputBrokerRequest(workerRequestId, request);
}

// IPC dispatch discrimination (D#76 PR10C): the union's single-question
// member declares the multi-question fields as z.unknown() so its
// superRefine can observe key presence, which erases the literal
// discriminant TypeScript needs for automatic narrowing — so the dispatch
// uses an explicit predicate instead of a bare `kind ===` comparison.
function isMultiQuestionUserInputResolution(
  resolution: UserInputResolution,
): resolution is UserInputMultiQuestionResolution {
  return userInputBroker.isMultiQuestionUserInputResolution(resolution);
}

function completeMultiUserInputQuestion(
  requestId: string,
  nonce: string,
  questionId: string,
  source: "user" | "timeout",
  selection: {
    selectedOptionLabel?: string;
    customAnswer?: string;
    skipped?: true;
  } = {},
): void {
  return userInputBroker.completeMultiUserInputQuestion(
    requestId,
    nonce,
    questionId,
    source,
    selection,
  );
}

function handleMultiQuestionUserInputBrokerRequest(
  workerRequestId: string,
  request: MultiQuestionUserInputRequest,
): void {
  return userInputBroker.handleMultiQuestionUserInputBrokerRequest(
    workerRequestId,
    request,
  );
}

function executeApprovedShell(
  workerRequestId: string,
  request: Extract<BrokerExecutionRequest, { kind: "shell.execute" }>,
  resolution: ApprovalResolution,
): Promise<void> {
  return shellBroker.executeApprovedShell(workerRequestId, request, resolution);
}

function handleShellBrokerRequest(
  workerRequestId: string,
  request: Extract<BrokerExecutionRequest, { kind: "shell.execute" }>,
): Promise<void> {
  return shellBroker.handleShellBrokerRequest(workerRequestId, request);
}

function localFileRequestSummary(request: LocalFileBrokerRequest): string {
  return localFileBroker.localFileRequestSummary(request);
}

function executeApprovedLocalFile(
  workerRequestId: string,
  request: LocalFileBrokerRequest,
  resolution: ApprovalResolution,
): Promise<void> {
  return localFileBroker.executeApprovedLocalFile(
    workerRequestId,
    request,
    resolution,
  );
}

function handleLocalFileBrokerRequest(
  workerRequestId: string,
  request: LocalFileBrokerRequest,
): Promise<void> {
  return localFileBroker.handleLocalFileBrokerRequest(workerRequestId, request);
}

function openAgentThread(
  thread: Thread,
  resolvedWorkspacePath?: string,
): Promise<void> {
  return sessionRuntime.openAgentThread(thread, resolvedWorkspacePath);
}

function handleBrokerRequest(
  workerRequestId: string,
  request: BrokerExecutionRequest,
): Promise<void> {
  return brokerDispatch.handleBrokerRequest(workerRequestId, request);
}

function emitGoalUpdated(goal: ThreadGoal, turnId?: string): void {
  return goalRuntime.emitGoalUpdated(goal, turnId);
}

function emitGoalCleared(
  threadId: string,
  cleared: { goalId: string; revision: number },
  turnId?: string,
): void {
  return goalRuntime.emitGoalCleared(threadId, cleared, turnId);
}

function resolveGoalBrokerRequest(
  workerRequestId: string,
  request: GoalBrokerRequest,
  data: unknown,
): void {
  return goalRuntime.resolveGoalBrokerRequest(workerRequestId, request, data);
}

function handleGoalBrokerRequest(
  workerRequestId: string,
  request: GoalBrokerRequest,
): Promise<void> {
  return goalRuntime.handleGoalBrokerRequest(workerRequestId, request);
}

function handleMemoryAppendBrokerRequest(
  workerRequestId: string,
  request: Extract<BrokerExecutionRequest, { kind: "memory.append" }>,
): Promise<void> {
  return memoryBroker.handleMemoryAppendBrokerRequest(workerRequestId, request);
}

function handleOfficeDocumentBrokerRequest(
  workerRequestId: string,
  request: Extract<BrokerExecutionRequest, { kind: "office.document" }>,
): Promise<void> {
  return documentBroker.handleOfficeDocumentBrokerRequest(
    workerRequestId,
    request,
  );
}

function handlePluginToolBrokerRequest(
  workerRequestId: string,
  request: Extract<BrokerExecutionRequest, { kind: "plugin.tool" }>,
): Promise<void> {
  return pluginBroker.handlePluginToolBrokerRequest(workerRequestId, request);
}

function handleMcpBrokerRequest(
  workerRequestId: string,
  request: Extract<BrokerExecutionRequest, { kind: "mcp.call" }>,
): Promise<void> {
  return mcpBroker.handleMcpBrokerRequest(workerRequestId, request);
}

function handleExtensionBrokerRequest(
  workerRequestId: string,
  request: Extract<BrokerExecutionRequest, { kind: "extension.call" }>,
): Promise<void> {
  return extensionBroker.handleExtensionBrokerRequest(workerRequestId, request);
}

function rejectBrokerRequest(
  workerRequestId: string,
  request: BrokerExecutionRequest,
  error: string,
): void {
  return brokerDispatch.rejectBrokerRequest(workerRequestId, request, error);
}

function executeApprovedWrite(
  workerRequestId: string,
  request: Extract<BrokerExecutionRequest, { kind: "workspace.write" }>,
  resolution: ApprovalResolution,
): Promise<void> {
  return localFileBroker.executeApprovedWrite(
    workerRequestId,
    request,
    resolution,
  );
}

function executeApprovedOffice(
  workerRequestId: string,
  request: Extract<BrokerExecutionRequest, { kind: "office.document" }>,
  resolution: ApprovalResolution,
  emitApprovalResolution: boolean,
): Promise<void> {
  return documentBroker.executeApprovedOffice(
    workerRequestId,
    request,
    resolution,
    emitApprovalResolution,
  );
}

function currentSandboxEscalationError(
  request: Extract<
    BrokerExecutionRequest,
    { kind: "mcp.call" | "extension.call" }
  >,
): string | undefined {
  return approvalBroker.currentSandboxEscalationError(request);
}

function recordSandboxEscalation(
  request: Extract<
    BrokerExecutionRequest,
    { kind: "mcp.call" | "extension.call" }
  >,
  resolution: ApprovalResolution,
): void {
  return approvalBroker.recordSandboxEscalation(request, resolution);
}

function currentComputerTaskApproval(
  request: Extract<BrokerExecutionRequest, { kind: "mcp.call" }>,
  config: McpServerConfig | undefined,
): ReturnType<typeof resolveComputerTaskApproval> {
  return mcpBroker.currentComputerTaskApproval(request, config);
}

function executeApprovedMcp(
  workerRequestId: string,
  request: Extract<BrokerExecutionRequest, { kind: "mcp.call" }>,
  resolution: ApprovalResolution,
  computerTaskGrant?: string,
): Promise<void> {
  return mcpBroker.executeApprovedMcp(
    workerRequestId,
    request,
    resolution,
    computerTaskGrant,
  );
}

function executeApprovedExtension(
  workerRequestId: string,
  request: Extract<BrokerExecutionRequest, { kind: "extension.call" }>,
  resolution: ApprovalResolution,
): Promise<void> {
  return extensionBroker.executeApprovedExtension(
    workerRequestId,
    request,
    resolution,
  );
}

function executeApprovedRemote(
  workerRequestId: string,
  request: Extract<BrokerExecutionRequest, { kind: "remote.operation" }>,
  resolution: ApprovalResolution,
): Promise<void> {
  return approvalBroker.executeApprovedRemote(
    workerRequestId,
    request,
    resolution,
  );
}

function resolveApproval(resolution: ApprovalResolution): Promise<void> {
  return approvalBroker.resolveApproval(resolution);
}

function createTaskThread(
  input: CreateThreadInput,
  title?: string,
  taskId?: string,
): Promise<Thread | undefined> {
  return sessionRuntime.createTaskThread(input, title, taskId);
}

const startingTurns = new Set<string>();
const acceptingPlans = new Map<string, Promise<StartTurnResult>>();

function startTaskTurn(
  input: StartTurnInput,
  options: Parameters<typeof startTaskTurnUnchecked>[1] = {},
): Promise<StartTurnResult> {
  return turnControl.startTaskTurn(input, options);
}

function startTaskTurnUnchecked(
  input: StartTurnInput,
  options: {
    origin?: "desktop" | "im";
    displayText?: string;
    titleContext?: ImTaskTitleContext;
    source?: "user" | "goal-continuation";
    expectedGoalId?: string;
    delegationContinuationId?: string;
    afterCompaction?: boolean;
    acceptance?: PlanAcceptance;
  } = {},
): Promise<StartTurnResult> {
  return turnExecution.startTaskTurnUnchecked(input, options);
}

function dispatchCheckpoint(
  checkpoint: TurnCheckpoint,
  recovery?: TurnRecovery,
): void {
  return turnExecution.dispatchCheckpoint(checkpoint, recovery);
}

function resumeInterruptedTurns(): Promise<void> {
  return turnExecution.resumeInterruptedTurns();
}

function publishCompactionQueue(threadId: string): void {
  return turnQueueRuntime.publishCompactionQueue(threadId);
}

function resumeCompactionFollowUps(thread: Thread): Promise<void> {
  return turnQueueRuntime.resumeCompactionFollowUps(thread);
}

function queueTurn(
  type: "turn.steer" | "turn.follow-up",
  input: QueueTurnInput,
  afterCompaction = false,
  displayText?: string,
): Promise<void> {
  return turnQueueRuntime.queueTurn(type, input, afterCompaction, displayText);
}

function controlTurnQueue(
  type: "turn.queue.clear" | "turn.queue.steer",
  threadId: string,
): Promise<{ steering: string[]; followUp: string[] } | undefined> {
  return turnQueueRuntime.controlTurnQueue(type, threadId);
}

function replaceTurnQueue(input: ReplaceQueuedTurnInput): Promise<void> {
  return turnQueueRuntime.replaceTurnQueue(input);
}

function steerQueuedTurn(input: SteerQueuedTurnInput): Promise<void> {
  return turnQueueRuntime.steerQueuedTurn(input);
}

function automationUpserted(automation: Automation): void {
  return automationController.automationUpserted(automation);
}

function automationDeleted(automationId: string): void {
  return automationController.automationDeleted(automationId);
}

function scheduledNextRun(
  automation: Pick<Automation, "schedule" | "enabled">,
  now: string,
): string | undefined {
  return automationController.scheduledNextRun(automation, now);
}

function saveAutomation(input: SaveAutomationInput): Promise<Automation> {
  return automationController.saveAutomation(input);
}

function setAutomationEnabled(
  id: string,
  enabled: boolean,
): Promise<Automation> {
  return automationController.setAutomationEnabled(id, enabled);
}

function authorizeAutomation(id: string): Promise<Automation | undefined> {
  return automationController.authorizeAutomation(id);
}

function automationRunNotification(
  automation: Automation,
  run: AutomationRun,
): void {
  return automationController.automationRunNotification(automation, run);
}

function cancelTaskTurn(threadId: string): Promise<void> {
  return turnControl.cancelTaskTurn(threadId);
}

function cancelLocalTaskTurn(threadId: string): Promise<void> {
  return turnControl.cancelLocalTaskTurn(threadId);
}

function cancelRunningGoalContinuation(threadId: string): Promise<void> {
  return goalRuntime.cancelRunningGoalContinuation(threadId);
}

const workspaceForGitRequest = async (
  projectId: unknown,
  threadId: unknown,
): Promise<{
  project: Project;
  workspacePath: string;
  threadId?: string;
}> => {
  const project = projectForGitRequest(projectId);
  if (threadId === undefined || threadId === null || threadId === "") {
    return { project, workspacePath: project.path };
  }
  if (typeof threadId !== "string") {
    throw new Error("Thread ID is invalid.");
  }
  const thread = store?.getThread(threadId);
  if (!thread || thread.projectId !== project.id) {
    throw new Error("Task does not belong to this project.");
  }
  const context = await resolveThreadWorkspace(thread);
  return { project, workspacePath: context.workspacePath, threadId };
};
const projectForGitRequest = (projectId: unknown): Project => {
  if (!store) {
    throw new Error("Application store is not ready.");
  }
  if (typeof projectId !== "string" || !projectId.trim()) {
    throw new Error("Project ID is invalid.");
  }
  const project = store.getProject(projectId);
  if (!project) {
    throw new Error("Project not found.");
  }
  return project;
};
function registerIpc(): void {
  registerApplicationIpc(createApplicationServices());
}

function isEmbeddedBrowserNavigationAllowed(url: string): boolean {
  return browserSessionPolicy.isEmbeddedBrowserNavigationAllowed(url);
}

function createMainWindow(): BrowserWindow {
  return createApplicationWindow(createApplicationServices());
}

const sessionRuntime = createSessionRuntime(createApplicationServices());
const turnQueueRuntime = createTurnQueueRuntime(createApplicationServices());
const turnExecution = createTurnExecution(createApplicationServices());
const turnControl = createTurnControl(createApplicationServices());
const goalRuntime = createGoalRuntime(createApplicationServices());
const approvalBroker = createApprovalBroker(createApplicationServices());
const extensionBroker = createExtensionBroker(createApplicationServices());
const mcpBroker = createMcpBroker(createApplicationServices());
const pluginBroker = createPluginBroker(createApplicationServices());
const memoryBroker = createMemoryBroker(createApplicationServices());
const documentBroker = createDocumentBroker(createApplicationServices());
const localFileBroker = createLocalFileBroker(createApplicationServices());
const shellBroker = createShellBroker(createApplicationServices());
const userInputBroker = createUserInputBroker(createApplicationServices());
const brokerDispatch = createBrokerDispatch(createApplicationServices());
const automationController = createAutomationController(
  createApplicationServices(),
);
const connectionCoordinator = createConnectionCoordinator(
  createApplicationServices(),
);
const settingsSnapshot = createSettingsSnapshot(createApplicationServices());
const modelRuntime = createModelRuntime(createApplicationServices());
const taskRouting = createTaskRouting(createApplicationServices());
const eventPipeline = createEventPipeline(createApplicationServices());
const turnLatency = createTurnLatency(createApplicationServices());
const capacityMonitor = createCapacityMonitor(createApplicationServices());
const runtimeCoordinator = createRuntimeCoordinator(
  createApplicationServices(),
);
const browserSessionPolicy = createBrowserSessionPolicy(
  createApplicationServices(),
);
const taskWorkspaces = createTaskWorkspaces(createApplicationServices());
const pluginRuntime = createPluginRuntime(createApplicationServices());
const hookRuntime = createHookRuntime(createApplicationServices());
const attachmentRuntime = createAttachmentRuntime(createApplicationServices());
const startupRuntime = createStartupRuntime(createApplicationServices());
const windowAppearance = createWindowAppearance(createApplicationServices());
const officeRuntime = createOfficeRuntime(createApplicationServices());
installApplicationLifecycle(createApplicationServices());

export function startDesktopApplication(): void {
  startApplication(createApplicationServices());
}

// Keep the store available while renderer IPC drains during window teardown.

export { currentLocale, browserSessionHost, windowMaterial };

// Live application bindings used by dedicated embedding entrypoints.
export {
  store,
  activeTurns,
  pendingMultiUserInputs,
  emitPayload,
  handleUserInputBrokerRequest,
  completeUserInput,
  completeMultiUserInputQuestion,
  agentProcess,
  cancelTaskTurn,
  settingsStore,
  mcpConfigStore,
  taskSourceImages,
  startupTimings,
  isEmbeddedBrowserNavigationAllowed,
  imService,
  getSettingsSnapshot,
  resourceCatalogService,
  workspaceForGitRequest,
};

export function createApplicationServices() {
  return {
    get store(): AppStore | undefined {
      return store;
    },
    set store(value: AppStore | undefined) {
      store = value;
    },
    get mainWindow(): BrowserWindow | undefined {
      return mainWindow;
    },
    set mainWindow(value: BrowserWindow | undefined) {
      mainWindow = value;
    },
    ipcMain,
    get browserSessionHost(): BrowserSessionHost | undefined {
      return browserSessionHost;
    },
    set browserSessionHost(value: BrowserSessionHost | undefined) {
      browserSessionHost = value;
    },
    get computerPreviewHost(): ComputerPreviewHost | undefined {
      return computerPreviewHost;
    },
    set computerPreviewHost(value: ComputerPreviewHost | undefined) {
      computerPreviewHost = value;
    },
    get computerUseHost(): ComputerUseHost | undefined {
      return computerUseHost;
    },
    set computerUseHost(value: ComputerUseHost | undefined) {
      computerUseHost = value;
    },
    hookCatalog,
    contextForHook,
    getHooksService,
    get shuttingDown() {
      return shuttingDown;
    },
    set shuttingDown(value: boolean) {
      shuttingDown = value;
    },
    get taskNotifications(): TaskNotifications | undefined {
      return taskNotifications;
    },
    set taskNotifications(value: TaskNotifications | undefined) {
      taskNotifications = value;
    },
    get computerPreviewWindow(): ComputerPreviewWindow | undefined {
      return computerPreviewWindow;
    },
    set computerPreviewWindow(value: ComputerPreviewWindow | undefined) {
      computerPreviewWindow = value;
    },
    emitPayload,
    get agentProcess(): AgentProcess | undefined {
      return agentProcess;
    },
    set agentProcess(value: AgentProcess | undefined) {
      agentProcess = value;
    },
    currentLocale,
    get settingsStore(): EncryptedSettingsStore | undefined {
      return settingsStore;
    },
    set settingsStore(value: EncryptedSettingsStore | undefined) {
      settingsStore = value;
    },
    currentPlatform,
    get windowMaterial(): WindowMaterial {
      return windowMaterial;
    },
    set windowMaterial(value: WindowMaterial) {
      windowMaterial = value;
    },
    get threadHistoryService(): ThreadHistoryService | undefined {
      return threadHistoryService;
    },
    set threadHistoryService(value: ThreadHistoryService | undefined) {
      threadHistoryService = value;
    },
    get imService(): ImService | undefined {
      return imService;
    },
    set imService(value: ImService | undefined) {
      imService = value;
    },
    requireAppearanceSender,
    getSettingsSnapshot,
    get languagePreference(): AppLanguage {
      return languagePreference;
    },
    set languagePreference(value: AppLanguage) {
      languagePreference = value;
    },
    get resolvedLocalePreference(): AppLocale {
      return resolvedLocalePreference;
    },
    set resolvedLocalePreference(value: AppLocale) {
      resolvedLocalePreference = value;
    },
    get designPanelHost(): DesignPanelHost | undefined {
      return designPanelHost;
    },
    set designPanelHost(value: DesignPanelHost | undefined) {
      designPanelHost = value;
    },
    sleepPrevention,
    get materialPreference(): MaterialPreference {
      return materialPreference;
    },
    set materialPreference(value: MaterialPreference) {
      materialPreference = value;
    },
    syncWindowBackgroundColors,
    applyNativeTheme,
    get appearanceService(): AppearanceService | undefined {
      return appearanceService;
    },
    set appearanceService(value: AppearanceService | undefined) {
      appearanceService = value;
    },
    activeTurns,
    get trustedExtensionManager(): TrustedExtensionManager | undefined {
      return trustedExtensionManager;
    },
    set trustedExtensionManager(value: TrustedExtensionManager | undefined) {
      trustedExtensionManager = value;
    },
    resetAgentThreadsForToolChange,
    refreshTrustedExtensions,
    applyAgentRuntime,
    get agentCapacityController(): AgentCapacityController | undefined {
      return agentCapacityController;
    },
    set agentCapacityController(value: AgentCapacityController | undefined) {
      agentCapacityController = value;
    },
    get agentCapacityApplyTail(): Promise<void> {
      return agentCapacityApplyTail;
    },
    set agentCapacityApplyTail(value: Promise<void>) {
      agentCapacityApplyTail = value;
    },
    applyAgentCapacityChange,
    get releaseUpdateManager(): ReleaseUpdateManager | undefined {
      return releaseUpdateManager;
    },
    set releaseUpdateManager(value: ReleaseUpdateManager | undefined) {
      releaseUpdateManager = value;
    },
    get releaseUpdateReady(): Promise<void> {
      return releaseUpdateReady;
    },
    set releaseUpdateReady(value: Promise<void>) {
      releaseUpdateReady = value;
    },
    get diagnosticBundleService(): DiagnosticBundleService | undefined {
      return diagnosticBundleService;
    },
    set diagnosticBundleService(value: DiagnosticBundleService | undefined) {
      diagnosticBundleService = value;
    },
    agentConcurrencyStatus,
    resolveModelSelection,
    get globalInstructionsStore(): GlobalInstructionsStore | undefined {
      return globalInstructionsStore;
    },
    set globalInstructionsStore(value: GlobalInstructionsStore | undefined) {
      globalInstructionsStore = value;
    },
    get mcpClientManager(): McpClientManager | undefined {
      return mcpClientManager;
    },
    set mcpClientManager(value: McpClientManager | undefined) {
      mcpClientManager = value;
    },
    get configurationImportService(): ConfigurationImportService | undefined {
      return configurationImportService;
    },
    set configurationImportService(
      value: ConfigurationImportService | undefined,
    ) {
      configurationImportService = value;
    },
    get mcpConfigStore(): McpConfigStore | undefined {
      return mcpConfigStore;
    },
    set mcpConfigStore(value: McpConfigStore | undefined) {
      mcpConfigStore = value;
    },
    validateConfigurationImportRequest,
    mcpAuthentication,
    saveMcpConfiguration,
    ensureConnectorReady,
    authorizeMcpServer,
    get artemisPluginService(): ArtemisPluginService | undefined {
      return artemisPluginService;
    },
    set artemisPluginService(value: ArtemisPluginService | undefined) {
      artemisPluginService = value;
    },
    removeMcpAuthentication,
    restoreResourceDialogFocus,
    getMcpServerStatuses,
    get resourceCatalogService(): ResourceCatalogService | undefined {
      return resourceCatalogService;
    },
    set resourceCatalogService(value: ResourceCatalogService | undefined) {
      resourceCatalogService = value;
    },
    get mcpSecretStore(): McpSecretStore | undefined {
      return mcpSecretStore;
    },
    set mcpSecretStore(value: McpSecretStore | undefined) {
      mcpSecretStore = value;
    },
    resourceInstallOperationId,
    publishResourceInstallProgress,
    MCP_REGISTRY_NPM_STARTUP_TIMEOUT_MS,
    installedSkillsWithState,
    get computerUseRuntime(): ComputerUseRuntime | undefined {
      return computerUseRuntime;
    },
    set computerUseRuntime(value: ComputerUseRuntime | undefined) {
      computerUseRuntime = value;
    },
    pluginsWithHookState,
    get connectorService(): ConnectorService | undefined {
      return connectorService;
    },
    set connectorService(value: ConnectorService | undefined) {
      connectorService = value;
    },
    disableConnector,
    installOfficeSuite,
    artemisPluginMutationResult,
    enableManagedPluginSkills,
    reconnectEnabledMcpServers,
    disconnectMcpServers,
    cleanupRemovedMcpAuthentication,
    reconcileManagedPluginSkills,
    get computerUseServerId(): string | undefined {
      return computerUseServerId;
    },
    set computerUseServerId(value: string | undefined) {
      computerUseServerId = value;
    },
    get trustedExtensionStore(): TrustedExtensionStore | undefined {
      return trustedExtensionStore;
    },
    set trustedExtensionStore(value: TrustedExtensionStore | undefined) {
      trustedExtensionStore = value;
    },
    get terminalService(): TerminalService | undefined {
      return terminalService;
    },
    set terminalService(value: TerminalService | undefined) {
      terminalService = value;
    },
    resolveThreadWorkspace,
    ensureNodePtyRuntime,
    linkedWorkspaceFile,
    getOfficeWorkbench,
    workspacePdfPreview,
    workspaceVideoPreview,
    get designPluginAvailabilityGate():
      ((threadId?: string) => Promise<string | null>) | undefined {
      return designPluginAvailabilityGate;
    },
    set designPluginAvailabilityGate(
      value: ((threadId?: string) => Promise<string | null>) | undefined,
    ) {
      designPluginAvailabilityGate = value;
    },
    tightenThreadToRestrictedProfile,
    get panelSendEntry(): PanelSendEntryService | undefined {
      return panelSendEntry;
    },
    set panelSendEntry(value: PanelSendEntryService | undefined) {
      panelSendEntry = value;
    },
    get pluginDispatch(): PluginDispatch | undefined {
      return pluginDispatch;
    },
    set pluginDispatch(value: PluginDispatch | undefined) {
      pluginDispatch = value;
    },
    get designArtifactWriteSink(): ((threadId: string) => void) | undefined {
      return designArtifactWriteSink;
    },
    set designArtifactWriteSink(
      value: ((threadId: string) => void) | undefined,
    ) {
      designArtifactWriteSink = value;
    },
    workspaceHtmlPreview,
    launchWorkspaceFile,
    workspaceForGitRequest,
    pathsEqual,
    attachmentStore,
    attachmentScope,
    taskSourceImages,
    createTaskThread,
    compactingThreads,
    parseThreadCommand,
    openedThreads,
    openAgentThread,
    get providerLoginService(): ProviderLoginService | undefined {
      return providerLoginService;
    },
    set providerLoginService(value: ProviderLoginService | undefined) {
      providerLoginService = value;
    },
    get conversationShareService(): ConversationShareService | undefined {
      return conversationShareService;
    },
    set conversationShareService(value: ConversationShareService | undefined) {
      conversationShareService = value;
    },
    automaticTaskTitles,
    materializeGoalObjective,
    cleanupGoalObjective,
    emitGoalUpdated,
    readGoalObjective,
    steerGoalObjectiveUpdate,
    cancelTaskTurn,
    scheduleGoalContinuation,
    emitGoalCleared,
    cancelRunningGoalContinuation,
    endHookSession,
    turnChangeSetCompletionTails,
    get turnChangeSetService(): TurnChangeSetService | undefined {
      return turnChangeSetService;
    },
    set turnChangeSetService(value: TurnChangeSetService | undefined) {
      turnChangeSetService = value;
    },
    createManagedTaskWorktree,
    managedWorktreeRoot,
    worktreeRecoveryRoot,
    removeManagedWorktree,
    publishCompactionQueue,
    resumeCompactionFollowUps,
    recoverableTurnQueues,
    compactionFollowUps,
    cleaningWorktreeThreads,
    handoffBundleRoot,
    acceptingPlans,
    startTaskTurn,
    cancelLocalTaskTurn,
    turnLatencyTraces,
    queueTurn,
    controlTurnQueue,
    steerQueuedTurn,
    replaceTurnQueue,
    resolveApproval,
    completeMultiUserInputQuestion,
    isMultiQuestionUserInputResolution,
    completeUserInput,
    saveAutomation,
    setAutomationEnabled,
    authorizeAutomation,
    automationDeleted,
    get automationScheduler(): AutomationScheduler | undefined {
      return automationScheduler;
    },
    set automationScheduler(value: AutomationScheduler | undefined) {
      automationScheduler = value;
    },
    get notificationRendererReady(): boolean {
      return notificationRendererReady;
    },
    set notificationRendererReady(value: boolean) {
      notificationRendererReady = value;
    },
    windowBackgroundColor,
    syncMainWindowMaterial,
    get hookSessionsEnded(): boolean {
      return hookSessionsEnded;
    },
    set hookSessionsEnded(value: boolean) {
      hookSessionsEnded = value;
    },
    syncAppearanceMedia,
    isEmbeddedBrowserNavigationAllowed,
    markStartupStage,
    get pendingThreadLinkId(): string | null | undefined {
      return pendingThreadLinkId;
    },
    set pendingThreadLinkId(value: string | null | undefined) {
      pendingThreadLinkId = value;
    },
    get pendingNotificationThreadId(): string | undefined {
      return pendingNotificationThreadId;
    },
    set pendingNotificationThreadId(value: string | undefined) {
      pendingNotificationThreadId = value;
    },
    get recoveringUpdate(): boolean {
      return recoveringUpdate;
    },
    set recoveringUpdate(value: boolean) {
      recoveringUpdate = value;
    },
    applyMacDockIcon,
    windowsSandboxHelperPath,
    openTaskNotification,
    observeTaskNotification,
    cancellingTurns,
    pendingApprovals,
    pendingUserInputs,
    pendingMultiUserInputs,
    openingThreads,
    get activeRuntimeSelection(): ModelSelection | undefined {
      return activeRuntimeSelection;
    },
    set activeRuntimeSelection(value: ModelSelection | undefined) {
      activeRuntimeSelection = value;
    },
    configureBrowserLocaleSession,
    get mcpOAuthStore(): McpOAuthStore | undefined {
      return mcpOAuthStore;
    },
    set mcpOAuthStore(value: McpOAuthStore | undefined) {
      mcpOAuthStore = value;
    },
    bundledArtifactPluginsPath,
    appearanceSystemPauseReasons,
    get computerUseCalls(): number {
      return computerUseCalls;
    },
    set computerUseCalls(value: number) {
      computerUseCalls = value;
    },
    extensionWorkerPath,
    autoUpdater,
    installedApplicationPath,
    rollbackScriptPath,
    startingTurns,
    get preparingUpdate(): boolean {
      return preparingUpdate;
    },
    set preparingUpdate(value: boolean) {
      preparingUpdate = value;
    },
    createAgentHostProcess,
    get agentCapacityRuntime(): AgentConcurrencyRuntimeStatus | undefined {
      return agentCapacityRuntime;
    },
    set agentCapacityRuntime(value: AgentConcurrencyRuntimeStatus | undefined) {
      agentCapacityRuntime = value;
    },
    startAgentCapacityMonitoring,
    get agentRuntimeReady(): Promise<void> {
      return agentRuntimeReady;
    },
    set agentRuntimeReady(value: Promise<void>) {
      agentRuntimeReady = value;
    },
    get optionalCapabilitiesReady(): Promise<void> {
      return optionalCapabilitiesReady;
    },
    set optionalCapabilitiesReady(value: Promise<void>) {
      optionalCapabilitiesReady = value;
    },
    initializeOptionalCapabilities,
    publishAutomationEvent,
    automationRunNotification,
    registerIpc,
    createMainWindow,
    registerThreadLinks,
    resumeInterruptedTurns,
    get endingHookSessions(): boolean {
      return endingHookSessions;
    },
    set endingHookSessions(value: boolean) {
      endingHookSessions = value;
    },
    get hooksService(): HooksService | undefined {
      return hooksService;
    },
    set hooksService(value: HooksService | undefined) {
      hooksService = value;
    },
    get officeWorkbench():
      ReturnType<typeof createOfficeWorkbench> | undefined {
      return officeWorkbench;
    },
    set officeWorkbench(
      value: ReturnType<typeof createOfficeWorkbench> | undefined,
    ) {
      officeWorkbench = value;
    },
    stopAgentCapacityMonitoring,
    get packagedNodePtyRuntime(): PreparedNodePtyRuntime | undefined {
      return packagedNodePtyRuntime;
    },
    set packagedNodePtyRuntime(value: PreparedNodePtyRuntime | undefined) {
      packagedNodePtyRuntime = value;
    },
    get packagedNodePtyRuntimeReady(): Promise<void> | undefined {
      return packagedNodePtyRuntimeReady;
    },
    set packagedNodePtyRuntimeReady(value: Promise<void> | undefined) {
      packagedNodePtyRuntimeReady = value;
    },
    startTaskTurnUnchecked,
    activeMcpCalls,
    attachmentReads,
    activeTurnDispatches,
    get agentHostRestart(): Promise<void> | undefined {
      return agentHostRestart;
    },
    set agentHostRestart(value: Promise<void> | undefined) {
      agentHostRestart = value;
    },
    get enabledMcpServerCount(): number {
      return enabledMcpServerCount;
    },
    set enabledMcpServerCount(value: number) {
      enabledMcpServerCount = value;
    },
    get runtimeToolCount(): number {
      return runtimeToolCount;
    },
    set runtimeToolCount(value: number) {
      runtimeToolCount = value;
    },
    get runtimeMcpToolCount(): number {
      return runtimeMcpToolCount;
    },
    set runtimeMcpToolCount(value: number) {
      runtimeMcpToolCount = value;
    },
    finalizeTurnLatency,
    memoryStore,
    emitInitialTurn,
    goalCreationAuthorizations,
    goalTurnContexts,
    createPermanentTaskWorktree,
    scheduledGoalContinuations,
    goalBlockerRecordedTurns,
    rejectBrokerRequest,
    hookContext,
    executeApprovedRemote,
    handleGoalBrokerRequest,
    handleUserInputBrokerRequest,
    handleShellBrokerRequest,
    handleLocalFileBrokerRequest,
    handleMemoryAppendBrokerRequest,
    handleMcpBrokerRequest,
    handleExtensionBrokerRequest,
    handleOfficeDocumentBrokerRequest,
    handlePluginToolBrokerRequest,
    createAutomationApproval,
    executeApprovedWrite,
    hookPermission,
    approvalProjectId,
    currentSandboxEscalationError,
    recordSandboxEscalation,
    executeApprovedExtension,
    executeApprovedMcp,
    executeApprovedOffice,
    executeApprovedLocalFile,
    executeApprovedShell,
    emitPayloadBatch,
    handleBrokerRequest,
    codexPrimaryRuntimePath,
    AGENT_RUNTIME_CONFIGURATION_TIMEOUT_MS,
    get cachedAgentCatalog(): AgentRuntimeCatalog {
      return cachedAgentCatalog;
    },
    set cachedAgentCatalog(value: AgentRuntimeCatalog) {
      cachedAgentCatalog = value;
    },
    get agentCapacityTimer(): ReturnType<typeof setInterval> | undefined {
      return agentCapacityTimer;
    },
    set agentCapacityTimer(value: ReturnType<typeof setInterval> | undefined) {
      agentCapacityTimer = value;
    },
    get agentCapacityEventLoopDelay(): IntervalHistogram | undefined {
      return agentCapacityEventLoopDelay;
    },
    set agentCapacityEventLoopDelay(value: IntervalHistogram | undefined) {
      agentCapacityEventLoopDelay = value;
    },
    get agentCapacityMetricsWarningRecorded(): boolean {
      return agentCapacityMetricsWarningRecorded;
    },
    set agentCapacityMetricsWarningRecorded(value: boolean) {
      agentCapacityMetricsWarningRecorded = value;
    },
    publishAutomationRun,
    withPersistedTurnDuration,
    observeTurnPayload,
    accountGoalPayload,
    get queuedThreadLink(): string | undefined {
      return queuedThreadLink;
    },
    set queuedThreadLink(value: string | undefined) {
      queuedThreadLink = value;
    },
    get threadLinksReady(): boolean {
      return threadLinksReady;
    },
    set threadLinksReady(value: boolean) {
      threadLinksReady = value;
    },
    getModelSettingsSnapshot,
    startupTiming,
    startupTimings,
    get recordedStartupTimingCount(): number {
      return recordedStartupTimingCount;
    },
    set recordedStartupTimingCount(value: number) {
      recordedStartupTimingCount = value;
    },
    get attachmentStoreInstance(): AttachmentStore | undefined {
      return attachmentStoreInstance;
    },
    set attachmentStoreInstance(value: AttachmentStore | undefined) {
      attachmentStoreInstance = value;
    },
    get taskSourceImageStore(): TaskSourceImageStore | undefined {
      return taskSourceImageStore;
    },
    set taskSourceImageStore(value: TaskSourceImageStore | undefined) {
      taskSourceImageStore = value;
    },
    memoryStores,
    connectMcpServer,
    worktreeCapacity,
  };
}
