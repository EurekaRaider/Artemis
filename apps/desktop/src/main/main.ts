import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { userInfo } from "node:os";
import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  net,
  Notification,
  safeStorage,
  session as electronSession,
  shell,
  type WebContents,
} from "electron";
import electronUpdater from "electron-updater";
import { appendPromptFiles } from "@artemis/agent-host/turn-prompt";
import {
  evaluateModePolicy,
  getPlatformContract,
  resolveShellRuntime,
  resolveWorkspacePath,
} from "@artemis/platform";
import type {
  AgentEvent,
  AgentConcurrencyRuntimeStatus,
  AgentHostEvent,
  AgentModelInfo,
  AgentRuntimeCatalog,
  AgentRuntimeConfiguration,
  AgentPayload,
  AppLanguage,
  AppLocale,
  AppTheme,
  ApprovalPolicy,
  ApprovalResolution,
  Automation,
  AutomationEvent,
  AutomationRun,
  BrokerExecutionRequest,
  ModelSelection,
  PromptAttachment,
  PromptImage,
  Project,
  ProviderConnection,
  RiskLevel,
  ShellRuntimeConfiguration,
  TaskWorktree,
  Thread,
  ThreadGoal,
  ThreadCommand,
  UserInputResolution,
  UserInputMultiQuestionResolution,
} from "@artemis/protocol";

import {
  AGENT_CONCURRENCY_FALLBACK,
  PROTOCOL_VERSION,
  appLocaleSchema,
  appLanguageSchema,
  appThemeSchema,
  approvalPolicySchema,
  approvalResolutionSchema,
  automationScheduleSchema,
  automationSchema,
  automationTargetSchema,
  contextWindowSchema,
  promptAttachmentsSchema,
  promptImageSchema,
  providerConnectionSchema,
  reviewMutationInputSchema,
  reviewQuerySchema,
  runModeSchema,
  shellRuntimeConfigurationSchema,
  threadCommandSchema,
  userInputResolutionSchema,
  worktreeCommandSchema,
} from "@artemis/protocol";

import { AgentProcess, type AgentProcessHandlers } from "./agent-process.js";
import {
  AgentCapacityController,
  type AgentCapacityChange,
  currentAgentCapacityHardware,
  reclaimableMemoryPercent,
  SystemCpuSampler,
} from "./agent-capacity-controller.js";
import { partitionAgentHostEvents } from "./agent-event-routing.js";
import { TaskSourceImageStore } from "./task-source-images.js";
import {
  cleanupGoalObjective as cleanupGoalObjectiveFile,
  materializeGoalObjective as materializeGoalObjectiveFile,
  readGoalObjective as readGoalObjectiveFile,
} from "./goal-objective.js";
import {
  automationAuthorizationFingerprint,
  automationMayAutoApprove,
} from "./automation-authorization.js";
import {
  nextAutomationOccurrence,
  validateAutomationSchedule,
} from "./automation-schedule.js";
import { AutomationScheduler } from "./automation-scheduler.js";
import {
  effectiveApprovalRisk,
  modelMayAutoApprove,
  shouldAutoApprove,
} from "./approval-mode.js";
import {
  PendingApprovalRegistry,
  createApprovalFingerprint,
} from "./approval-policy.js";
import {
  PendingMultiUserInputRegistry,
  PendingUserInputRegistry,
  USER_INPUT_TIMEOUT_MILLISECONDS,
  isMultiQuestionUserInputRequest,
  prepareMultiQuestionUserInputRegistration,
  prepareSingleQuestionUserInputRegistration,
} from "./user-input-policy.js";
import {
  externalHttpUrl,
  isRendererNavigationAllowed,
} from "./navigation-policy.js";
import { OfficeDocumentService } from "./office-document-service.js";
import {
  readLocalTextFile,
  resolveLocalFilePath,
  writeLocalTextFile,
} from "./local-file-access.js";
import {
  deletePiSessionTranscript,
  piSessionsRoot,
} from "./pi-session-delete.js";
import { loadPromptAttachments } from "./prompt-attachments.js";
import { RecoverableTurnQueues } from "./recoverable-turn-queue.js";
import {
  GOAL_CONTINUATION_RETRY_DELAY_MILLISECONDS,
  goalFailureBlocker,
  goalFailureDisposition,
} from "./goal-continuation.js";
import {
  commitProjectChanges,
  createGitBranch,
  gitRepositoryMetadataSignature,
  gitRepositoryWatchPaths,
  inspectGitBranches,
  pushProjectBranch,
  switchGitBranch,
} from "./git-branches.js";
import { inspectProjectPullRequest } from "./github-pull-request.js";
import { getReviewDiff, mutateReviewDiff } from "./git-review.js";
import {
  attachPermanentWorktree,
  branchizeManagedWorktree,
  createManagedWorktree,
  listGitWorktrees,
  removeManagedWorktree,
  restoreWorktreeSnapshot,
} from "./git-worktree.js";
import { AppStore } from "./store.js";
import { TurnChangeSetService } from "./turn-change-set.js";
import {
  DiagnosticBundleService,
  parseContextOverflowTokens,
  type TurnLatencySample,
} from "./diagnostic-bundle.js";
import { EncryptedSettingsStore } from "./encrypted-settings-store.js";
import { ConfigurationImportService } from "./configuration-import.js";
import { GlobalInstructionsStore } from "./global-instructions-store.js";
import {
  GLOBAL_MEMORY_MAX_BYTES,
  MemoryStore,
  PROJECT_MEMORY_MAX_BYTES,
} from "./memory-store.js";
import { recallMemoryForTurn } from "./memory-recall.js";
import { McpClientManager } from "./mcp-client-manager.js";
import type {
  McpConnectionAuthentication,
  McpConnectOptions,
} from "./mcp-client-manager.js";
import { McpConfigStore } from "./mcp-config-store.js";
import { importMcpServers } from "./mcp-import.js";
import {
  customModelThinkingLevels,
  filterVisibleModels,
  loadBundledModelCatalog,
  mergeBundledModelCatalog,
} from "./model-catalog.js";
import {
  SecureMcpOAuthProvider,
  startMcpOAuthCallback,
} from "./mcp-oauth-provider.js";
import { McpOAuthStore } from "./mcp-oauth-store.js";
import { McpSecretStore } from "./mcp-secret-store.js";
import { ResourceCatalogService } from "./resource-catalog.js";
import { CodexPluginService } from "./codex-plugin-service.js";
import {
  GoogleAccountService,
  loadGoogleOAuthClient,
} from "./google-account-service.js";
import {
  installedGoogleMcpServerIdsForGrant,
  readyInstalledGoogleMcpServers,
} from "./google-plugin-activation.js";
import {
  preparePackagedNodePtyRuntime,
  type PreparedNodePtyRuntime,
} from "./node-pty-runtime.js";
import { deriveTaskTitle, isAutomaticTaskTitle } from "./task-title.js";
import { mainText } from "./i18n.js";
import { I18N_RESOURCES } from "../shared/i18n-resources.js";
import {
  assertConversationTarget,
  conversationApprovalScopes,
  conversationMemoryScopeAllowed,
  conversationSupportsProjectFeatures,
  conversationWorkspaceMatches,
  copyTemporaryConversationWorkspace,
  ensureTemporaryConversationWorkspace,
  removeTemporaryConversationWorkspace,
} from "./temporary-conversation.js";
import {
  configureNodePtyRuntime,
  TerminalService,
} from "./terminal-service.js";
import { ReleaseUpdateManager } from "./release-update-manager.js";
import { TrustedExtensionManager } from "./trusted-extension-manager.js";
import { TrustedExtensionStore } from "./trusted-extension-store.js";
import { UpdateRecoveryStore } from "./update-recovery-store.js";
import { ensureWindowsPackageAccess } from "./windows-package-access.js";
import {
  listWorkspaceDirectory,
  readWorkspaceFile,
  readWorkspaceImage,
  readWorkspaceTextFile,
  writeWorkspaceFile,
} from "./workspace-text-file.js";
import {
  resolveWorkspaceFileLink,
  type ResolvedWorkspaceFileLink,
} from "./workspace-file-link.js";
import {
  applyWorkspaceChangeBundle,
  createWorkspaceChangeBundle,
} from "./workspace-handoff.js";
import {
  IPC,
  type AddReviewCommentInput,
  type AddedModelConfiguration,
  type AgentConcurrencyPreference,
  type AgentConcurrencyStatus,
  type AgentTeamControlInput,
  type AgentTeamControlResult,
  type CleanupWorktreeResult,
  type ChildAgentControlInput,
  type ChildAgentControlResult,
  type ConfigurationImportPreview,
  type ConfigurationImportRequest,
  type ConfigurationImportResult,
  type CodexPluginMarketplace,
  type CodexPluginMarketplaceState,
  type CodexPluginMutationResult,
  type CodexPluginPreview,
  type CodexPluginSource,
  type CreateThreadInput,
  type ForkThreadResult,
  type HandoffWorkspaceResult,
  type InstalledSkill,
  type InstalledCodexPlugin,
  type GoogleGrantId,
  type McpCatalogInstallRequest,
  type McpCatalogItem,
  type QueueTurnInput,
  type ReplaceQueuedTurnInput,
  type SteerQueuedTurnInput,
  type McpServerConfig,
  type ProjectGitInfo,
  type ProjectGitCommitResult,
  type ProjectGitPushResult,
  type ProjectPullRequestCheck,
  type ProjectPullRequestLookup,
  type ResourceInstallProgress,
  type ReviewDiff,
  type ReviewComment,
  type ReviewMutationInput,
  type ReviewMutationResult,
  type ReviewQuery,
  type RendererDiagnostic,
  type RestoreWorktreeSnapshotResult,
  type StartTurnInput,
  type StartTurnResult,
  type UndoTurnChangesResult,
  type SettingsSnapshot,
  type SaveAutomationInput,
  type SkillCatalogItem,
  type TerminalOpenInput,
  type WorkspaceDirectoryEntry,
  type WorkspaceFileContent,
  type WorkspaceFileLink,
  type WorkspaceImageFile,
  type WorkspaceTextFile,
} from "../shared/api.js";
import {
  BROWSER_SESSION_PARTITION,
  withBrowserAcceptLanguage,
} from "../shared/browser-locale.js";
import { resolveAppLocale } from "../shared/locales.js";
import {
  createStartupTiming,
  type StartupTimingMark,
} from "./startup-timing.js";

const { autoUpdater } = electronUpdater;
const smokeMode = Boolean(process.env.ARTEMIS_SMOKE_SCREENSHOT);
const execFileAsync = promisify(execFile);

if (smokeMode) {
  app.disableHardwareAcceleration();
}

interface PendingApproval {
  workerRequestId: string;
  request: BrokerExecutionRequest;
  projectId: string;
  fingerprint: string;
}

type SingleQuestionUserInputRequest = Extract<
  Extract<BrokerExecutionRequest, { kind: "user.input" }>,
  { question: string }
>;
type MultiQuestionUserInputRequest = Extract<
  Extract<BrokerExecutionRequest, { kind: "user.input" }>,
  { questions: { questionId: string }[] }
>;

interface PendingUserInput {
  workerRequestId: string;
  request: SingleQuestionUserInputRequest;
  // Assigned synchronously right after registration succeeds (review item
  // 2): registration runs first so a rejected registration can never leak
  // an orphan timer.
  timeout?: ReturnType<typeof setTimeout> | undefined;
}

interface PendingMultiUserInput {
  workerRequestId: string;
  request: MultiQuestionUserInputRequest;
  timeouts: Map<string, ReturnType<typeof setTimeout>>;
}

let mainWindow: BrowserWindow | undefined;
let store: AppStore | undefined;
let turnChangeSetService: TurnChangeSetService | undefined;
const turnChangeSetCompletionTails = new Map<string, Promise<void>>();
let agentProcess: AgentProcess | undefined;
let terminalService: TerminalService | undefined;
let packagedNodePtyRuntime: PreparedNodePtyRuntime | undefined;
let packagedNodePtyRuntimeReady: Promise<void> | undefined;
let settingsStore: EncryptedSettingsStore | undefined;
let globalInstructionsStore: GlobalInstructionsStore | undefined;
let configurationImportService: ConfigurationImportService | undefined;
let languagePreference: AppLanguage = "system";
let resolvedLocalePreference: AppLocale = "en";
let mcpConfigStore: McpConfigStore | undefined;
let mcpClientManager: McpClientManager | undefined;
let mcpOAuthStore: McpOAuthStore | undefined;
let mcpSecretStore: McpSecretStore | undefined;
let googleAccountService: GoogleAccountService | undefined;
let resourceCatalogService: ResourceCatalogService | undefined;
let codexPluginService: CodexPluginService | undefined;
let trustedExtensionStore: TrustedExtensionStore | undefined;
let trustedExtensionManager: TrustedExtensionManager | undefined;
let releaseUpdateManager: ReleaseUpdateManager | undefined;
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
  startupTimings.push(startupTiming.mark(stage));
  while (
    diagnosticBundleService &&
    recordedStartupTimingCount < startupTimings.length
  ) {
    const timing = startupTimings[recordedStartupTimingCount];
    if (!timing) break;
    recordedStartupTimingCount += 1;
    diagnosticBundleService.record({
      source: "main",
      severity: "info",
      message: `Startup ${timing.stage}: ${timing.elapsedMs} ms total (+${timing.deltaMs} ms).`,
    });
  }
}

async function ensureNodePtyRuntime(): Promise<void> {
  if (process.platform !== "darwin" || !app.isPackaged) return;
  if (process.arch !== "arm64" && process.arch !== "x64") {
    throw new Error(`Packaged terminals do not support macOS ${process.arch}.`);
  }
  packagedNodePtyRuntimeReady ??= preparePackagedNodePtyRuntime(
    join(
      process.resourcesPath,
      "app.asar.unpacked",
      "node_modules",
      "node-pty",
    ),
    process.arch,
  ).then((runtime) => {
    packagedNodePtyRuntime = runtime;
    configureNodePtyRuntime(runtime.moduleRoot);
    markStartupStage("terminal-runtime-ready");
  });
  return packagedNodePtyRuntimeReady;
}

interface TurnLatencyTrace {
  turnId: string;
  mainReceivedAt: number;
  submittedAt?: number;
  coldThread: boolean;
  mode: string;
  providerId?: string;
  modelId?: string;
  thinkingLevel?: string;
  enabledMcpServers: number;
  toolCount: number;
  mcpToolCount: number;
  optionalStartedAt: number;
  optionalReadyAt?: number;
  workspaceStartedAt: number;
  workspaceEndedAt?: number;
  threadOpenStartedAt?: number;
  threadOpenEndedAt?: number;
  memoryStartedAt?: number;
  memoryEndedAt?: number;
  hostDispatchedAt?: number;
  hostReceivedAt?: number;
  queuedAt?: number;
  modelRequestedAt?: number;
  firstActivityAt?: number;
  firstTextAt?: number;
  rendererPaintAt?: number;
  completedAt?: number;
  outcome?: "completed" | "failed";
  queueDepth: number;
  eventCount: number;
  contextTokens?: number;
  uncachedInputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cacheReadReported?: boolean;
  cacheWriteReported?: boolean;
  cachePolicy?: TurnLatencySample["cachePolicy"];
  cachePolicyReason?: string;
  cacheKeyFingerprint?: string;
  systemPromptFingerprint?: string;
  toolSchemaFingerprint?: string;
  stablePrefixTokens?: number;
  cacheKeyRequestsPerMinute?: number;
  cacheKeyRateWarning?: boolean;
  providerInputTokens?: number;
  currentEstimatedTokens?: number;
  displayedContextTokens?: number;
  contextSource?: TurnLatencySample["contextSource"];
  providerLimitTokens?: number;
  providerRequestedTokens?: number;
  contextFootprint?: TurnLatencySample["contextFootprint"];
}

const turnLatencyTraces = new Map<string, TurnLatencyTrace>();

function recordAgentCapacityChange(change: AgentCapacityChange): void {
  const pressure = change.pressureReasons.length
    ? ` (${change.pressureReasons.join(", ")})`
    : "";
  diagnosticBundleService?.record({
    source: "main",
    severity: "info",
    message: `Agent concurrency ${change.reason}: effective limit ${change.limit}${pressure}.`,
  });
}

async function applyAgentCapacityChange(
  change: AgentCapacityChange,
): Promise<void> {
  if (!agentProcess?.available) {
    throw new Error("Agent host is unavailable.");
  }
  agentCapacityRuntime =
    await agentProcess.request<AgentConcurrencyRuntimeStatus>(
      {
        type: "runtime.concurrency.set",
        requestId: randomUUID(),
        limit: change.limit,
      },
      10_000,
    );
  recordAgentCapacityChange(change);
}

function scheduleAgentCapacityChange(change: AgentCapacityChange): void {
  agentCapacityApplyTail = agentCapacityApplyTail
    .then(() => applyAgentCapacityChange(change))
    .catch((error) => {
      diagnosticBundleService?.record({
        source: "main",
        severity: "warning",
        message: `Agent concurrency change was not applied: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    });
}

async function agentConcurrencyStatus(
  refreshRuntime = true,
): Promise<AgentConcurrencyStatus> {
  if (!agentCapacityController) {
    throw new Error("Agent capacity controller is not ready.");
  }
  if (refreshRuntime && agentProcess?.available) {
    try {
      agentCapacityRuntime =
        await agentProcess.request<AgentConcurrencyRuntimeStatus>(
          {
            type: "runtime.concurrency.status",
            requestId: randomUUID(),
          },
          10_000,
        );
    } catch (error) {
      diagnosticBundleService?.record({
        source: "main",
        severity: "warning",
        message: `Agent concurrency status is unavailable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
  }
  return agentCapacityController.status(agentCapacityRuntime);
}

function startAgentCapacityMonitoring(): void {
  if (!agentCapacityController || agentCapacityTimer) return;
  const cpuSampler = new SystemCpuSampler();
  agentCapacityEventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
  agentCapacityEventLoopDelay.enable();
  agentCapacityTimer = setInterval(() => {
    try {
      const memory = process.getSystemMemoryInfo();
      const memoryPercent = reclaimableMemoryPercent(process.platform, memory);
      const workingSets = app
        .getAppMetrics()
        .map((metric) => metric.memory?.workingSetSize)
        .filter((value): value is number => Number.isFinite(value));
      const eventLoopP95Milliseconds =
        agentCapacityEventLoopDelay!.percentile(95) / 1_000_000;
      agentCapacityEventLoopDelay!.reset();
      const cpuPercent = cpuSampler.sample();
      const change = agentCapacityController!.observe({
        ...(cpuPercent === undefined ? {} : { cpuPercent }),
        ...(memoryPercent === undefined
          ? {}
          : { reclaimableMemoryPercent: memoryPercent }),
        eventLoopP95Milliseconds,
        ...(workingSets.length
          ? {
              appWorkingSetMiB:
                workingSets.reduce((sum, value) => sum + value, 0) / 1024,
            }
          : {}),
      });
      if (change) scheduleAgentCapacityChange(change);
    } catch (error) {
      if (agentCapacityMetricsWarningRecorded) return;
      agentCapacityMetricsWarningRecorded = true;
      diagnosticBundleService?.record({
        source: "main",
        severity: "warning",
        message: `Agent capacity metrics are unavailable; the current limit will be retained: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
  }, 5_000);
  agentCapacityTimer.unref();
}

function stopAgentCapacityMonitoring(): void {
  if (agentCapacityTimer) clearInterval(agentCapacityTimer);
  agentCapacityTimer = undefined;
  agentCapacityEventLoopDelay?.disable();
  agentCapacityEventLoopDelay = undefined;
}

function windowBackgroundColor(): string {
  return nativeTheme.shouldUseDarkColors ? "#0f1012" : "#f7f7f6";
}

function applyMacDockIcon(): void {
  if (process.platform !== "darwin" || app.isPackaged) return;
  const iconPath = join(app.getAppPath(), "build", "icon.png");
  app.dock?.setIcon(iconPath);
}

function syncWindowBackgroundColors(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.setBackgroundColor(windowBackgroundColor());
  }
}

function applyNativeTheme(theme: AppTheme): void {
  nativeTheme.themeSource = theme;
  syncWindowBackgroundColors();
}

function memoryStore(path: string, maxBytes: number): MemoryStore {
  let existing = memoryStores.get(path);
  if (!existing) {
    existing = new MemoryStore(path, { maxBytes });
    memoryStores.set(path, existing);
  }
  return existing;
}
const openedThreads = new Set<string>();
const openingThreads = new Map<string, Promise<void>>();
const activeTurns = new Map<string, string>();
const cancellingTurns = new Set<string>();
const compactingThreads = new Set<string>();
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
    startedAt: number;
  }
>();
const goalCreationAuthorizations = new Set<string>();
const goalBlockerRecordedTurns = new Set<string>();
const projectGitWatchers = new Map<
  string,
  {
    watchers: FSWatcher[];
    signature: string;
    metadataSignature: string;
    pendingKinds: Set<"metadata" | "worktree">;
    refreshing: boolean;
    timer?: NodeJS.Timeout;
  }
>();
const projectGitWatcherSenders = new Set<number>();
const interruptedAgentHostTurns = new Set<string>();
const recoverableTurnQueues = new RecoverableTurnQueues();
let agentHostRestart: Promise<void> | undefined;

function taskSourceImages(): TaskSourceImageStore {
  taskSourceImageStore ??= new TaskSourceImageStore(
    join(app.getPath("userData"), "task-source-images"),
  );
  return taskSourceImageStore;
}

function elapsed(
  start: number | undefined,
  end: number | undefined,
): number | undefined {
  if (start === undefined || end === undefined) return undefined;
  return Math.round(Math.max(0, end - start) * 10) / 10;
}

function finalizeTurnLatency(trace: TurnLatencyTrace): void {
  if (!trace.completedAt || !trace.outcome) return;
  const origin = trace.submittedAt ?? trace.mainReceivedAt;
  const stagesMs: TurnLatencySample["stagesMs"] = {};
  const addStage = (
    name: keyof TurnLatencySample["stagesMs"],
    start: number | undefined,
    end: number | undefined,
  ) => {
    const value = elapsed(start, end);
    if (value !== undefined) stagesMs[name] = value;
  };
  addStage("submitToMain", trace.submittedAt, trace.mainReceivedAt);
  addStage("localPreModel", trace.mainReceivedAt, trace.hostReceivedAt);
  addStage(
    "optionalCapabilities",
    trace.optionalStartedAt,
    trace.optionalReadyAt,
  );
  addStage(
    "workspaceResolve",
    trace.workspaceStartedAt,
    trace.workspaceEndedAt,
  );
  addStage("threadOpen", trace.threadOpenStartedAt, trace.threadOpenEndedAt);
  addStage("memoryRecall", trace.memoryStartedAt, trace.memoryEndedAt);
  addStage("hostDispatch", trace.hostDispatchedAt, trace.hostReceivedAt);
  addStage("queueWait", trace.queuedAt, trace.modelRequestedAt);
  addStage(
    "modelToFirstActivity",
    trace.modelRequestedAt,
    trace.firstActivityAt,
  );
  addStage("modelToFirstText", trace.modelRequestedAt, trace.firstTextAt);
  addStage("mainToRendererPaint", trace.firstTextAt, trace.rendererPaintAt);
  addStage("total", origin, trace.completedAt);
  const sample: TurnLatencySample = {
    timestamp: new Date().toISOString(),
    outcome: trace.outcome,
    coldThread: trace.coldThread,
    ...(trace.providerId && trace.modelId && trace.thinkingLevel
      ? {
          providerId: trace.providerId,
          modelId: trace.modelId,
          thinkingLevel: trace.thinkingLevel,
        }
      : {}),
    mode: trace.mode,
    enabledMcpServers: trace.enabledMcpServers,
    toolCount: trace.toolCount,
    mcpToolCount: trace.mcpToolCount,
    queueDepth: trace.queueDepth,
    eventCount: trace.eventCount,
    ...(trace.contextTokens === undefined
      ? {}
      : { contextTokens: trace.contextTokens }),
    ...(trace.uncachedInputTokens === undefined
      ? {}
      : { uncachedInputTokens: trace.uncachedInputTokens }),
    ...(trace.cacheReadTokens === undefined
      ? {}
      : { cacheReadTokens: trace.cacheReadTokens }),
    ...(trace.cacheWriteTokens === undefined
      ? {}
      : { cacheWriteTokens: trace.cacheWriteTokens }),
    ...(trace.cacheReadReported === undefined
      ? {}
      : { cacheReadReported: trace.cacheReadReported }),
    ...(trace.cacheWriteReported === undefined
      ? {}
      : { cacheWriteReported: trace.cacheWriteReported }),
    ...(trace.cachePolicy === undefined
      ? {}
      : { cachePolicy: trace.cachePolicy }),
    ...(trace.cachePolicyReason === undefined
      ? {}
      : { cachePolicyReason: trace.cachePolicyReason }),
    ...(trace.cacheKeyFingerprint === undefined
      ? {}
      : { cacheKeyFingerprint: trace.cacheKeyFingerprint }),
    ...(trace.systemPromptFingerprint === undefined
      ? {}
      : { systemPromptFingerprint: trace.systemPromptFingerprint }),
    ...(trace.toolSchemaFingerprint === undefined
      ? {}
      : { toolSchemaFingerprint: trace.toolSchemaFingerprint }),
    ...(trace.stablePrefixTokens === undefined
      ? {}
      : { stablePrefixTokens: trace.stablePrefixTokens }),
    ...(trace.cacheKeyRequestsPerMinute === undefined
      ? {}
      : { cacheKeyRequestsPerMinute: trace.cacheKeyRequestsPerMinute }),
    ...(trace.cacheKeyRateWarning === undefined
      ? {}
      : { cacheKeyRateWarning: trace.cacheKeyRateWarning }),
    ...(trace.providerInputTokens === undefined
      ? {}
      : { providerInputTokens: trace.providerInputTokens }),
    ...(trace.currentEstimatedTokens === undefined
      ? {}
      : { currentEstimatedTokens: trace.currentEstimatedTokens }),
    ...(trace.displayedContextTokens === undefined
      ? {}
      : { displayedContextTokens: trace.displayedContextTokens }),
    ...(trace.contextSource === undefined
      ? {}
      : { contextSource: trace.contextSource }),
    ...(trace.providerLimitTokens === undefined
      ? {}
      : { providerLimitTokens: trace.providerLimitTokens }),
    ...(trace.providerRequestedTokens === undefined
      ? {}
      : { providerRequestedTokens: trace.providerRequestedTokens }),
    ...(trace.contextFootprint === undefined
      ? {}
      : { contextFootprint: trace.contextFootprint }),
    stagesMs,
  };
  diagnosticBundleService?.recordTurnLatency(sample);
  turnLatencyTraces.delete(trace.turnId);
}

function observeTurnPayload(
  turnId: string | undefined,
  payload: AgentPayload,
): void {
  if (!turnId) return;
  const trace = turnLatencyTraces.get(turnId);
  if (!trace) return;
  const now = Date.now();
  trace.eventCount += 1;
  if (payload.type === "turn.activity") {
    if (payload.phase === "queued") {
      trace.queuedAt ??= now;
      trace.queueDepth = Math.max(trace.queueDepth, payload.queueDepth ?? 0);
    } else if (payload.phase === "requesting-model") {
      trace.modelRequestedAt ??= now;
      trace.queueDepth = Math.max(trace.queueDepth, payload.queueDepth ?? 0);
      trace.toolCount = payload.toolCount ?? trace.toolCount;
    } else if (payload.phase === "thinking") {
      trace.firstActivityAt ??= now;
    }
  } else if (
    payload.type === "message.part.delta" &&
    payload.partType === "text"
  ) {
    trace.firstActivityAt ??= now;
    trace.firstTextAt ??= now;
  } else if (payload.type === "tool.started") {
    trace.firstActivityAt ??= now;
  } else if (payload.type === "context.usage") {
    if (payload.tokens !== null) {
      trace.contextTokens = payload.tokens;
      trace.currentEstimatedTokens = payload.tokens;
      trace.displayedContextTokens = payload.tokens;
    }
    if (payload.source !== undefined) trace.contextSource = payload.source;
    if (payload.providerInputTokens !== undefined) {
      trace.providerInputTokens = payload.providerInputTokens;
    }
    if (payload.footprint !== undefined) {
      trace.contextFootprint = payload.footprint;
    }
  } else if (payload.type === "assistant.usage") {
    trace.contextTokens ??=
      payload.inputTokens + payload.cacheReadTokens + payload.cacheWriteTokens;
    trace.uncachedInputTokens =
      (trace.uncachedInputTokens ?? 0) + payload.inputTokens;
    trace.providerInputTokens =
      (trace.providerInputTokens ?? 0) +
      payload.inputTokens +
      payload.cacheReadTokens +
      payload.cacheWriteTokens;
    trace.cacheReadTokens =
      (trace.cacheReadTokens ?? 0) + payload.cacheReadTokens;
    trace.cacheWriteTokens =
      (trace.cacheWriteTokens ?? 0) + payload.cacheWriteTokens;
    if (payload.cacheReadReported !== undefined) {
      trace.cacheReadReported =
        trace.cacheReadReported === true || payload.cacheReadReported;
    }
    if (payload.cacheWriteReported !== undefined) {
      trace.cacheWriteReported =
        trace.cacheWriteReported === true || payload.cacheWriteReported;
    }
    if (payload.cachePolicy !== undefined) {
      trace.cachePolicy = payload.cachePolicy;
    }
    if (payload.cachePolicyReason !== undefined) {
      trace.cachePolicyReason = payload.cachePolicyReason;
    }
    if (payload.cacheKeyFingerprint !== undefined) {
      trace.cacheKeyFingerprint = payload.cacheKeyFingerprint;
    }
    if (payload.systemPromptFingerprint !== undefined) {
      trace.systemPromptFingerprint = payload.systemPromptFingerprint;
    }
    if (payload.toolSchemaFingerprint !== undefined) {
      trace.toolSchemaFingerprint = payload.toolSchemaFingerprint;
    }
    if (payload.stablePrefixTokens !== undefined) {
      trace.stablePrefixTokens = payload.stablePrefixTokens;
    }
    trace.cacheKeyRequestsPerMinute = Math.max(
      trace.cacheKeyRequestsPerMinute ?? 0,
      payload.cacheKeyRequestsPerMinute ?? 0,
    );
    const firstCacheKeyRateWarning =
      trace.cacheKeyRateWarning !== true &&
      payload.cacheKeyRateWarning === true;
    trace.cacheKeyRateWarning =
      trace.cacheKeyRateWarning === true ||
      payload.cacheKeyRateWarning === true;
    if (firstCacheKeyRateWarning) {
      diagnosticBundleService?.record({
        source: "agent-host",
        severity: "warning",
        message: `Prompt cache key ${payload.cacheKeyFingerprint ?? "unknown"} reached ${payload.cacheKeyRequestsPerMinute ?? 0} requests in the rolling one-minute window. Artemis kept the key stable to preserve cache affinity.`,
      });
    }
  } else if (
    payload.type === "turn.completed" ||
    payload.type === "turn.failed"
  ) {
    if (payload.type === "turn.failed") {
      const overflow = parseContextOverflowTokens(payload.message);
      if (overflow) {
        trace.providerLimitTokens = overflow.providerLimitTokens;
        trace.providerRequestedTokens = overflow.providerRequestedTokens;
      }
    }
    trace.completedAt = now;
    trace.outcome = payload.type === "turn.completed" ? "completed" : "failed";
    setTimeout(() => {
      if (turnLatencyTraces.get(turnId) === trace) finalizeTurnLatency(trace);
    }, 250);
  }
}

function withPersistedTurnDuration(
  turnId: string | undefined,
  payload: AgentPayload,
): AgentPayload {
  if (
    !turnId ||
    (payload.type !== "turn.completed" && payload.type !== "turn.failed")
  ) {
    return payload;
  }
  const trace = turnLatencyTraces.get(turnId);
  if (!trace) return payload;
  const startedAt = trace.submittedAt ?? trace.mainReceivedAt;
  return {
    ...payload,
    durationMs: Math.max(0, Math.round(Date.now() - startedAt)),
  };
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
  if (smokeMode) {
    const smokeLocale = appLocaleSchema.safeParse(
      process.env.ARTEMIS_SMOKE_LOCALE,
    );
    if (smokeLocale.success) return smokeLocale.data;
  }
  return resolvedLocalePreference;
}

function configureBrowserLocaleSession(): void {
  const browserSession = electronSession.fromPartition(
    BROWSER_SESSION_PARTITION,
  );
  browserSession.webRequest.onBeforeSendHeaders(
    { urls: ["http://*/*", "https://*/*"] },
    (details, callback) => {
      callback({
        requestHeaders: withBrowserAcceptLanguage(
          details.requestHeaders,
          currentLocale(),
        ),
      });
    },
  );
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

function googleOAuthClientPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "resources", "google-oauth-client.json")
    : join(app.getAppPath(), "resources", "google-oauth-client.json");
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
  const ultraMode = supportsReasoning && selection.ultraMode === true;
  return {
    providerId: selection.providerId,
    modelId: selection.modelId,
    thinkingLevel: supportsReasoning
      ? ultraMode
        ? highestThinkingLevel
        : selection.thinkingLevel
      : "off",
    ...(ultraMode ? { ultraMode: true } : {}),
  };
}

async function resolveModelSelection(
  selection: ModelSelection,
  currentSelection?: ModelSelection,
): Promise<{ selection: ModelSelection; contextWindow: number }> {
  if (!settingsStore) throw new Error("Agent settings are not ready.");
  if (
    !selection ||
    typeof selection.providerId !== "string" ||
    typeof selection.modelId !== "string"
  ) {
    throw new Error("Model selection is invalid.");
  }
  if (
    selection.ultraMode !== undefined &&
    typeof selection.ultraMode !== "boolean"
  ) {
    throw new Error("Ultra mode setting is invalid.");
  }
  const allowedThinking = [
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ];
  if (!allowedThinking.includes(selection.thinkingLevel)) {
    throw new Error("Thinking level is invalid.");
  }
  const snapshot = await getModelSettingsSnapshot();
  const selectedModel = snapshot.models.find(
    (model) =>
      model.providerId === selection.providerId &&
      model.modelId === selection.modelId,
  );
  if (!selectedModel) {
    throw new Error("Selected model is not in the Pi model catalog.");
  }
  const addedModel = snapshot.addedModels.find(
    (model) =>
      model.providerId === selection.providerId &&
      model.modelId === selection.modelId,
  );
  const customProviderModel = snapshot.providers
    .find((provider) => provider.id === selection.providerId)
    ?.models.find((model) => model.id === selection.modelId);
  const isKnownSelection = [snapshot.selection, currentSelection].some(
    (candidate) =>
      candidate?.providerId === selection.providerId &&
      candidate.modelId === selection.modelId,
  );
  if (!addedModel && !customProviderModel && !isKnownSelection) {
    throw new Error("Add this model in Settings before selecting it.");
  }
  const hasStoredCredential = snapshot.credentials.some(
    (credential) => credential.providerId === selection.providerId,
  );
  if (
    !customProviderModel &&
    !hasStoredCredential &&
    !selectedModel.configured
  ) {
    throw new Error("This model no longer has configured credentials.");
  }
  const selectedHighestThinkingLevel =
    selectedModel.highestThinkingLevel ?? "high";
  const supportedSelection =
    selectedModel.reasoning &&
    selectedModel.thinkingLevels &&
    !selectedModel.thinkingLevels.includes(selection.thinkingLevel)
      ? { ...selection, thinkingLevel: selectedHighestThinkingLevel }
      : selection;
  return {
    selection: normalizeModelSelection(
      supportedSelection,
      selectedModel.reasoning,
      selectedHighestThinkingLevel,
    ),
    contextWindow: Math.min(
      addedModel?.contextWindow ??
        customProviderModel?.contextWindow ??
        snapshot.contextWindow,
      selectedModel.contextWindow,
    ),
  };
}

function agentProcessHandlers(): AgentProcessHandlers {
  return {
    onEvent(threadId, turnId, payload) {
      emitPayload(threadId, turnId, payload);
    },
    onEvents(events) {
      emitPayloadBatch(events);
    },
    onTurnTelemetry(event) {
      const trace = turnLatencyTraces.get(event.turnId);
      if (trace && event.stage === "host-received") {
        trace.hostReceivedAt ??= event.timestamp;
      }
    },
    onThreadSession(threadId, sessionFile) {
      if (store?.getThread(threadId)) {
        store.updateThread(threadId, { sessionFile });
      }
    },
    onBrokerRequest: handleBrokerRequest,
    onStderr(data) {
      diagnosticBundleService?.record({
        source: "agent-host",
        severity: "error",
        message: data,
      });
    },
    onExit(code, expected) {
      diagnosticBundleService?.record({
        source: "agent-host",
        severity: expected ? "info" : "fatal",
        message: `Agent host exited with code ${code ?? "unknown"}${expected ? " during shutdown" : ""}.`,
      });
      if (!expected) restartAgentHost(code);
    },
  };
}

function createAgentHostProcess(): AgentProcess {
  const codexRuntimeRoot = codexPrimaryRuntimePath();
  return new AgentProcess(
    join(import.meta.dirname, "agent-worker.js"),
    agentProcessHandlers(),
    {
      ...(codexRuntimeRoot ? { codexRuntimeRoot } : {}),
      agentConcurrencyLimit:
        agentCapacityController?.limit ?? AGENT_CONCURRENCY_FALLBACK,
    },
  );
}

function interruptTurnsAfterAgentHostExit(): void {
  if (!store) return;
  for (const cancelled of pendingApprovals.cancelWhere(() => true)) {
    emitPayload(
      cancelled.value.request.threadId,
      cancelled.value.request.turnId,
      {
        type: "approval.resolved",
        approvalId: cancelled.approvalId,
        nonce: cancelled.nonce,
        approved: false,
        scope: "once",
      },
    );
  }
  for (const cancelled of pendingUserInputs.cancelWhere(() => true)) {
    if (cancelled.value.timeout !== undefined) {
      clearTimeout(cancelled.value.timeout);
    }
    emitPayload(
      cancelled.value.request.threadId,
      cancelled.value.request.turnId,
      {
        type: "user-input.resolved",
        requestId: cancelled.requestId,
        nonce: cancelled.nonce,
        answer: "",
        source: "cancelled",
      },
    );
  }
  for (const cancelled of pendingMultiUserInputs.cancelWhere(() => true)) {
    for (const timeout of cancelled.value.timeouts.values()) {
      clearTimeout(timeout);
    }
    // One kind-less cancelled resolution per request: the reducer's legacy
    // translation layer closes every still-pending question on the card, so
    // no per-question events are needed here.
    emitPayload(
      cancelled.value.request.threadId,
      cancelled.value.request.turnId,
      {
        type: "user-input.resolved",
        requestId: cancelled.requestId,
        nonce: cancelled.nonce,
        answer: "",
        source: "cancelled",
      },
    );
  }
  for (const [threadId, turnId] of [...activeTurns]) {
    interruptedAgentHostTurns.add(turnId);
    const recoveredItems = recoverableTurnQueues.recover(threadId);
    if (recoveredItems.length > 0) {
      emitPayload(threadId, turnId, {
        type: "queue.recovered",
        messages: recoveredItems.map((item) => item.text),
        items: recoveredItems,
      });
    }
    emitPayload(threadId, turnId, {
      type: "queue.updated",
      steering: [],
      followUp: [],
    });
    emitPayload(threadId, turnId, {
      type: "turn.failed",
      code: "AGENT_HOST_INTERRUPTED",
      message:
        "The Agent Host exited during this turn. Artemis restored the host and session state but did not replay the prompt, because completed writes could not be proven safe to repeat.",
    });
  }
}

function restartAgentHost(code: number | null): void {
  if (agentHostRestart) return;
  const reopenedThreadIds = [...openedThreads];
  interruptTurnsAfterAgentHostExit();
  openedThreads.clear();
  openingThreads.clear();
  const restart = (async () => {
    agentProcess = createAgentHostProcess();
    await applyAgentRuntime();
    for (const threadId of reopenedThreadIds) {
      const thread = store?.getThread(threadId);
      if (!thread || thread.archived) continue;
      const context = await resolveThreadWorkspace(thread);
      await openAgentThread(thread, context.workspacePath);
    }
    diagnosticBundleService?.record({
      source: "agent-host",
      severity: "info",
      message: `Agent host recovered after unexpected exit ${code ?? "unknown"}; persisted sessions were reopened without replaying active prompts.`,
    });
  })();
  agentHostRestart = restart;
  agentRuntimeReady = restart;
  void restart
    .catch((error) => {
      diagnosticBundleService?.record({
        source: "agent-host",
        severity: "fatal",
        message: `Agent host recovery failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    })
    .finally(() => {
      if (agentHostRestart === restart) agentHostRestart = undefined;
    });
}

async function applyAgentRuntime(
  configuration?: AgentRuntimeConfiguration,
): Promise<void> {
  if (!agentProcess || !settingsStore) {
    throw new Error("Agent settings are not ready.");
  }
  const resolved =
    configuration ?? (await settingsStore.runtimeConfiguration());
  if (globalInstructionsStore) {
    resolved.globalAgents = await globalInstructionsStore.snapshot();
  }
  resolved.mcpTools = mcpClientManager?.tools() ?? [];
  resolved.extensionTools = trustedExtensionManager?.tools() ?? [];
  await agentProcess.request(
    {
      type: "runtime.configure",
      requestId: randomUUID(),
      configuration: resolved,
    },
    AGENT_RUNTIME_CONFIGURATION_TIMEOUT_MS,
  );
  activeRuntimeSelection = resolved.selection
    ? structuredClone(resolved.selection)
    : undefined;
  void agentProcess
    .request<AgentRuntimeCatalog>(
      {
        type: "runtime.catalog",
        requestId: randomUUID(),
      },
      10_000,
    )
    .then((catalog) => {
      cachedAgentCatalog = catalog;
    })
    .catch((error) => {
      diagnosticBundleService?.record({
        source: "main",
        severity: "warning",
        message: `Agent model catalog refresh failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    });
  runtimeMcpToolCount = resolved.mcpTools.length;
  runtimeToolCount =
    resolved.mcpTools.length + (resolved.extensionTools?.length ?? 0);
  enabledMcpServerCount = mcpConfigStore
    ? (await mcpConfigStore.list()).filter((config) => config.enabled).length
    : 0;
}

async function mcpBearerToken(
  config: McpServerConfig,
): Promise<string | undefined> {
  if (
    config.transport !== "streamable-http" ||
    (config.auth ?? (config.credentialProviderId ? "bearer" : "none")) !==
      "bearer" ||
    !settingsStore
  ) {
    return undefined;
  }
  const credentialProviderId =
    config.credentialProviderId ?? `mcp.${config.id}`;
  const credential = (await settingsStore.runtimeConfiguration()).credentials[
    credentialProviderId
  ];
  return credential?.type === "api_key" ? credential.key : undefined;
}

async function mcpAuthentication(
  config: McpServerConfig,
): Promise<string | McpConnectionAuthentication | undefined> {
  if (config.transport === "stdio") {
    const names = config.credentialEnvVars ?? [];
    if (names.length === 0) return undefined;
    if (!mcpSecretStore) throw new Error("MCP secret service is not ready.");
    const stored = await mcpSecretStore.get(config.id);
    const stdioEnv = Object.fromEntries(
      names.map((name) => {
        const value = stored.env[name];
        if (!value) {
          throw new Error(`MCP credential is unavailable: ${name}`);
        }
        return [name, value];
      }),
    );
    return { stdioEnv };
  }
  const auth = config.auth ?? (config.credentialProviderId ? "bearer" : "none");
  if (auth === "headers") {
    if (!mcpSecretStore) throw new Error("MCP secret service is not ready.");
    const stored = await mcpSecretStore.get(config.id);
    const headers = Object.fromEntries(
      (config.headerNames ?? []).map((name) => {
        const value = stored.headers[name];
        if (!value) {
          throw new Error(`MCP credential is unavailable: ${name}`);
        }
        return [name, value];
      }),
    );
    return { headers };
  }
  if (auth === "bearer") {
    return mcpBearerToken(config);
  }
  if (auth !== "oauth") return undefined;
  if (!mcpOAuthStore) {
    throw new Error("MCP OAuth service is not ready.");
  }
  const stored = mcpOAuthStore.encryptionAvailable
    ? await mcpOAuthStore.get(config.id)
    : {};
  const redirectUrl =
    stored.redirectUrl ??
    `http://127.0.0.1:43729/mcp-oauth/${encodeURIComponent(config.id)}`;
  return {
    oauthProvider: new SecureMcpOAuthProvider(
      config.id,
      redirectUrl,
      mcpOAuthStore,
      () => {},
    ),
  };
}

async function authorizeMcpServer(config: McpServerConfig): Promise<void> {
  if (
    config.transport !== "streamable-http" ||
    config.auth !== "oauth" ||
    !mcpOAuthStore ||
    !mcpClientManager
  ) {
    throw new Error("MCP server is not configured for OAuth.");
  }
  if (!mcpOAuthStore.encryptionAvailable) {
    throw new Error("OS credential encryption is required for MCP OAuth.");
  }
  let provider: SecureMcpOAuthProvider | undefined;
  const callback = await startMcpOAuthCallback(
    config.id,
    (state) => provider?.matchesState(state) ?? false,
  );
  try {
    await mcpOAuthStore.update(config.id, () => ({
      redirectUrl: callback.redirectUrl,
    }));
    provider = new SecureMcpOAuthProvider(
      config.id,
      callback.redirectUrl,
      mcpOAuthStore,
      (url) => shell.openExternal(url.toString()),
    );
    const status = await mcpClientManager.connect(config, {
      oauthProvider: provider,
      authorizationCode: callback.authorizationCode,
    });
    if (status.state !== "connected") {
      throw new Error(status.error ?? "MCP OAuth connection failed.");
    }
  } finally {
    await callback.close();
  }
}

async function connectMcpServer(
  config: McpServerConfig,
  authorizeMissingOAuth = false,
  options?: McpConnectOptions,
): Promise<void> {
  if (!mcpClientManager) {
    throw new Error("MCP service is not ready.");
  }
  await ensureGoogleMcpReady(config);
  const status = await mcpClientManager.connect(
    config,
    await mcpAuthentication(config),
    options,
  );
  if (status.state === "failed") {
    throw new Error(
      status.error ?? `MCP server ${config.name} failed to connect.`,
    );
  }
  if (
    authorizeMissingOAuth &&
    config.transport === "streamable-http" &&
    config.auth === "oauth" &&
    status.state === "authorization-required"
  ) {
    await authorizeMcpServer(config);
  }
}

async function ensureGoogleMcpReady(config: McpServerConfig): Promise<void> {
  if (!config.hostAuth) return;
  if (!googleAccountService || !codexPluginService) {
    throw new Error("Google account service is not ready.");
  }
  await codexPluginService.assertHostAuthTrusted(config);
  await googleAccountService.accessContext(
    config.hostAuth.grant,
    config.hostAuth.scopes,
  );
}

async function enableReadyInstalledGoogleMcpServers(
  serverIds: string[],
): Promise<void> {
  if (!mcpConfigStore || !mcpClientManager) return;
  const before = await mcpConfigStore.list();
  const result = await readyInstalledGoogleMcpServers(
    before,
    serverIds,
    ensureGoogleMcpReady,
  );
  for (const skipped of result.skipped) {
    diagnosticBundleService?.record({
      source: "main",
      severity: "info",
      message: `Google MCP server ${skipped.id} remained disabled after plugin installation: ${skipped.reason}`,
    });
  }
  if (result.ready.length === 0) return;

  const readyById = new Map(result.ready.map((config) => [config.id, config]));
  await mcpConfigStore.replaceAll(
    before.map((config) => readyById.get(config.id) ?? config),
  );
  await reconnectEnabledMcpServers(result.ready);
}

async function disableGoogleGrantConfigs(grant?: GoogleGrantId): Promise<void> {
  if (!mcpConfigStore || !mcpClientManager) return;
  const before = await mcpConfigStore.list();
  const affected = before.filter(
    (config) => config.hostAuth && (!grant || config.hostAuth.grant === grant),
  );
  for (const config of affected) await mcpClientManager.disconnect(config.id);
  if (affected.length) {
    const ids = new Set(affected.map((config) => config.id));
    await mcpConfigStore.replaceAll(
      before.map((config) =>
        ids.has(config.id) ? { ...config, enabled: false } : config,
      ),
    );
    await applyAgentRuntime();
  }
}

async function resetAgentThreadsForToolChange(): Promise<void> {
  if (!agentProcess) return;
  if (activeTurns.size > 0) {
    throw new Error("Stop active turns before changing Agent tools.");
  }
  await Promise.allSettled(openingThreads.values());
  for (const threadId of [...openedThreads]) {
    await agentProcess.request({
      type: "thread.close",
      requestId: randomUUID(),
      threadId,
    });
    openedThreads.delete(threadId);
  }
}

type ModelSettingsSnapshot = Pick<
  SettingsSnapshot,
  | "models"
  | "addedModels"
  | "credentials"
  | "providers"
  | "contextWindow"
  | "selection"
>;

async function getModelSettingsSnapshot(): Promise<ModelSettingsSnapshot> {
  if (!settingsStore) throw new Error("Agent settings are not ready.");
  const [
    providers,
    credentials,
    bundledModels,
    addedModels,
    persistedSelection,
    contextWindowPreference,
  ] = await Promise.all([
    settingsStore.providerConnections(),
    settingsStore.credentialSummaries(),
    loadBundledModelCatalog().catch((error): AgentModelInfo[] => {
      diagnosticBundleService?.record({
        source: "main",
        severity: "error",
        message: `Bundled model catalog could not be loaded: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
      return [];
    }),
    settingsStore.addedModels(),
    settingsStore.modelSelection(),
    settingsStore.contextWindowPreference(),
  ]);
  const catalogModels = mergeBundledModelCatalog(
    bundledModels,
    cachedAgentCatalog.models,
    providers.map((provider) => provider.id),
  );
  const configuredProviderIds = new Set(
    credentials.map((credential) => credential.providerId),
  );
  const modelsByKey = new Map<string, AgentModelInfo>();
  for (const model of catalogModels) {
    modelsByKey.set(`${model.providerId}\0${model.modelId}`, {
      ...model,
      configured:
        model.configured || configuredProviderIds.has(model.providerId),
    });
  }
  for (const provider of providers) {
    for (const model of provider.models) {
      const thinkingLevels = customModelThinkingLevels(model);
      modelsByKey.set(`${provider.id}\0${model.id}`, {
        providerId: provider.id,
        modelId: model.id,
        name: model.name,
        reasoning: model.reasoning,
        thinkingLevels,
        highestThinkingLevel: thinkingLevels.at(-1) ?? "off",
        contextWindow: model.contextWindow,
        configured: true,
      });
    }
  }
  const models = filterVisibleModels(
    [...modelsByKey.values()],
    providers.map((provider) => provider.id),
  );
  const availableSelection = persistedSelection;
  const selection =
    availableSelection &&
    (models.length === 0 ||
      models.some(
        (model) =>
          model.providerId === availableSelection.providerId &&
          model.modelId === availableSelection.modelId,
      ))
      ? availableSelection
      : undefined;
  const selectedModel = selection
    ? models.find(
        (model) =>
          model.providerId === selection.providerId &&
          model.modelId === selection.modelId,
      )
    : undefined;
  const contextWindow =
    contextWindowPreference ??
    selectedModel?.contextWindow ??
    models[0]?.contextWindow ??
    128_000;

  return {
    contextWindow,
    models,
    addedModels,
    credentials,
    providers,
    ...(selection ? { selection } : {}),
  };
}

async function getSettingsSnapshot(): Promise<SettingsSnapshot> {
  if (
    !settingsStore ||
    !globalInstructionsStore ||
    !mcpConfigStore ||
    !mcpClientManager ||
    !trustedExtensionManager
  ) {
    throw new Error("Agent settings are not ready.");
  }
  const contract = getPlatformContract();
  const [
    modelSettings,
    language,
    theme,
    approvalPolicy,
    localFullAccess,
    shellConfiguration,
    mcpServers,
    globalAgents,
    agentConcurrency,
    profileAvatar,
    projectOrder,
    projectThreadOrder,
    projectSidebarWidth,
    temporaryConversationsOpen,
    workspaceDockWidth,
  ] = await Promise.all([
    getModelSettingsSnapshot(),
    settingsStore.languagePreference(),
    settingsStore.themePreference(),
    settingsStore.approvalPolicy(),
    settingsStore.localFullAccess(),
    settingsStore.shellRuntimeConfiguration(),
    getMcpServerStatuses(),
    globalInstructionsStore.snapshot(),
    agentConcurrencyStatus(false),
    settingsStore.profileAvatar(),
    settingsStore.projectOrder(),
    settingsStore.projectThreadOrder(),
    settingsStore.projectSidebarWidth(),
    settingsStore.temporaryConversationsOpen(),
    settingsStore.workspaceDockWidth(),
  ]);
  return {
    platform: contract.platform,
    encryptionAvailable: settingsStore.encryptionAvailable,
    language,
    theme,
    resolvedLocale: currentLocale(),
    approvalPolicy,
    localFullAccess,
    shell: shellConfiguration,
    fullAccessAvailable: contract.sandbox.available,
    ...modelSettings,
    mcpServers,
    globalAgents,
    trustedExtensions: trustedExtensionManager.status(),
    update: releaseUpdateManager?.getStatus() ?? {
      state: "disabled",
      currentVersion: app.getVersion(),
      rollbackAvailable: false,
    },
    agentConcurrency,
    ...(profileAvatar === undefined ? {} : { profileAvatar }),
    projectOrder,
    projectThreadOrder,
    ...(projectSidebarWidth === undefined ? {} : { projectSidebarWidth }),
    temporaryConversationsOpen,
    ...(workspaceDockWidth === undefined ? {} : { workspaceDockWidth }),
  };
}

async function getMcpServerStatuses(): Promise<SettingsSnapshot["mcpServers"]> {
  if (!mcpConfigStore || !mcpClientManager) {
    throw new Error("MCP services are not ready.");
  }
  return mcpClientManager.status(await mcpConfigStore.list());
}

async function installedSkillsWithState(): Promise<InstalledSkill[]> {
  if (!resourceCatalogService || !settingsStore) {
    throw new Error("Resource catalog is not ready.");
  }
  const comparable = (value: string) =>
    process.platform === "win32" ? value.toLowerCase() : value;
  const disabled = new Set(
    (await settingsStore.disabledSkillFiles()).map(comparable),
  );
  return (await resourceCatalogService.listInstalledSkills()).map((skill) => ({
    ...skill,
    enabled: !disabled.has(comparable(join(skill.path, "SKILL.md"))),
  }));
}

async function codexPluginMutationResult(
  warnings: string[],
): Promise<CodexPluginMutationResult> {
  if (!codexPluginService) {
    throw new Error("Plugin service is not ready.");
  }
  return {
    plugins: await codexPluginService.listInstalled(),
    skills: await installedSkillsWithState(),
    settings: await getSettingsSnapshot(),
    warnings,
  };
}

async function enableManagedPluginSkills(skillNames: string[]): Promise<void> {
  if (!settingsStore) throw new Error("Agent settings are not ready.");
  for (const name of skillNames) {
    await settingsStore.setSkillEnabled(
      join(app.getPath("home"), ".pi", "agent", "skills", name, "SKILL.md"),
      true,
    );
  }
}

async function reconcileManagedPluginSkills(
  previousNames: string[],
  nextNames: string[],
  previousEnabled: ReadonlyMap<string, boolean>,
): Promise<void> {
  if (!settingsStore) throw new Error("Agent settings are not ready.");
  const next = new Set(nextNames);
  for (const name of previousNames) {
    if (next.has(name)) continue;
    await settingsStore.setSkillEnabled(
      join(app.getPath("home"), ".pi", "agent", "skills", name, "SKILL.md"),
      true,
    );
  }
  for (const name of nextNames) {
    await settingsStore.setSkillEnabled(
      join(app.getPath("home"), ".pi", "agent", "skills", name, "SKILL.md"),
      previousEnabled.get(name) ?? true,
    );
  }
}

async function disconnectMcpServers(serverIds: string[]): Promise<void> {
  if (!mcpClientManager) throw new Error("MCP service is not ready.");
  await Promise.all(
    serverIds.map((serverId) => mcpClientManager!.disconnect(serverId)),
  );
}

async function reconnectEnabledMcpServers(
  configs: McpServerConfig[],
  authorizeMissingOAuth = false,
): Promise<void> {
  if (!mcpClientManager) return;
  for (const config of configs.filter((candidate) => candidate.enabled)) {
    try {
      await connectMcpServer(config, authorizeMissingOAuth);
    } catch (error) {
      diagnosticBundleService?.record({
        source: "main",
        severity: "warning",
        message: `MCP server ${config.id} did not reconnect after a plugin change: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
  }
}

function mcpSecretBinding(config: McpServerConfig): string | undefined {
  if (
    config.transport === "stdio" &&
    (config.credentialEnvVars?.length ?? 0) > 0
  ) {
    return `env:${[...(config.credentialEnvVars ?? [])].sort().join("\0")}`;
  }
  if (config.transport === "streamable-http" && config.auth === "headers") {
    return `headers:${[...(config.headerNames ?? [])].sort().join("\0")}`;
  }
  return undefined;
}

async function assertMcpSecretsAvailable(
  config: McpServerConfig,
): Promise<void> {
  if (!mcpSecretBinding(config)) return;
  if (!mcpSecretStore) throw new Error("MCP secret service is not ready.");
  const stored = await mcpSecretStore.get(config.id);
  const missing =
    config.transport === "stdio"
      ? (config.credentialEnvVars ?? []).find((name) => !stored.env[name])
      : (config.headerNames ?? []).find((name) => !stored.headers[name]);
  if (missing) {
    throw new Error(`MCP credential is unavailable: ${missing}`);
  }
}

async function removeMcpAuthentication(config: McpServerConfig): Promise<void> {
  if (
    (config.transport === "stdio" &&
      (config.credentialEnvVars?.length ?? 0) > 0) ||
    (config.transport === "streamable-http" && config.auth === "headers")
  ) {
    await mcpSecretStore?.delete(config.id);
  }
  if (
    config.transport === "streamable-http" &&
    (config.auth ?? (config.credentialProviderId ? "bearer" : "none")) ===
      "bearer"
  ) {
    await settingsStore?.deleteCredential(
      config.credentialProviderId ?? `mcp.${config.id}`,
    );
  }
  if (config.transport === "streamable-http" && config.auth === "oauth") {
    await mcpOAuthStore?.delete(config.id);
  }
}

async function cleanupRemovedMcpAuthentication(
  before: McpServerConfig[],
  after: McpServerConfig[],
  scopedIds: ReadonlySet<string>,
): Promise<void> {
  for (const previous of before) {
    if (!scopedIds.has(previous.id)) continue;
    const current = after.find((candidate) => candidate.id === previous.id);
    if (
      !current ||
      current.transport !== previous.transport ||
      (mcpSecretBinding(previous) !== undefined &&
        mcpSecretBinding(current) !== mcpSecretBinding(previous)) ||
      (current.transport === "streamable-http" &&
        previous.transport === "streamable-http" &&
        (current.url !== previous.url ||
          (current.auth ??
            (current.credentialProviderId ? "bearer" : "none")) !==
            (previous.auth ??
              (previous.credentialProviderId ? "bearer" : "none")) ||
          current.credentialProviderId !== previous.credentialProviderId))
    ) {
      await removeMcpAuthentication(previous);
    }
  }
}

function resourceInstallOperationId(input: unknown): string {
  const operationId = String(input ?? "").trim();
  if (!/^[A-Za-z0-9-]{1,128}$/u.test(operationId)) {
    throw new Error("Resource installation operation ID is invalid.");
  }
  return operationId;
}

function publishResourceInstallProgress(
  sender: WebContents,
  progress: ResourceInstallProgress,
): void {
  sender.send(IPC.resourceInstallProgress, {
    ...progress,
    percent: Math.max(0, Math.min(100, Math.round(progress.percent))),
  });
}

function restoreResourceDialogFocus(sender: WebContents): void {
  const owner = BrowserWindow.fromWebContents(sender);
  if (!owner || owner.isDestroyed() || sender.isDestroyed()) return;
  owner.focus();
  sender.focus();
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

async function saveMcpConfiguration(
  input: McpServerConfig,
  bearerToken?: string,
  connectionOptions?: McpConnectOptions,
  rejectConnectionFailure = false,
): Promise<SettingsSnapshot> {
  if (!mcpConfigStore || !mcpClientManager || !settingsStore) {
    throw new Error("MCP service is not ready.");
  }
  await resetAgentThreadsForToolChange();
  const existing = (await mcpConfigStore.list()).find(
    (server) => server.id === input.id,
  );
  let config = structuredClone(input);
  if (
    config.transport === "streamable-http" &&
    config.auth === "bearer" &&
    bearerToken?.trim()
  ) {
    const credentialProviderId = `mcp.${config.id}`;
    await settingsStore.saveCredential(credentialProviderId, {
      type: "api_key",
      key: bearerToken.trim(),
    });
    config = { ...config, credentialProviderId };
  }
  await assertMcpSecretsAvailable(config);
  const saved = await mcpConfigStore.upsert(config);
  if (
    existing &&
    mcpSecretBinding(existing) !== undefined &&
    mcpSecretBinding(saved) !== mcpSecretBinding(existing)
  ) {
    await mcpSecretStore?.delete(existing.id);
  }
  if (
    existing?.transport === "streamable-http" &&
    (existing.auth ?? (existing.credentialProviderId ? "bearer" : "none")) ===
      "bearer" &&
    (saved.transport !== "streamable-http" || saved.auth !== "bearer")
  ) {
    await settingsStore.deleteCredential(
      existing.credentialProviderId ?? `mcp.${existing.id}`,
    );
  }
  if (saved.enabled) {
    try {
      await connectMcpServer(saved, true, connectionOptions);
    } catch (error) {
      if (rejectConnectionFailure || saved.transport !== "stdio") throw error;
      diagnosticBundleService?.record({
        source: "main",
        severity: "warning",
        message: `MCP server ${saved.id} remains enabled but did not connect: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
  } else {
    await mcpClientManager.disconnect(saved.id);
  }
  await applyAgentRuntime();
  return getSettingsSnapshot();
}

async function refreshTrustedExtensions(): Promise<void> {
  if (!trustedExtensionStore || !trustedExtensionManager || !settingsStore) {
    throw new Error("Trusted extension service is not ready.");
  }
  await trustedExtensionManager.refresh(
    await trustedExtensionStore.list(),
    undefined,
    await settingsStore.localFullAccess(),
  );
}

async function initializeOptionalCapabilities(): Promise<void> {
  if (!mcpConfigStore || !mcpClientManager || !settingsStore) {
    throw new Error("MCP services are not ready.");
  }
  const configurations = await mcpConfigStore.list();
  await Promise.all(
    configurations
      .filter((config) => config.enabled)
      .map(async (config) => {
        try {
          await mcpClientManager!.connect(
            config,
            await mcpAuthentication(config),
          );
        } catch (error) {
          diagnosticBundleService?.record({
            source: "main",
            severity: "warning",
            message: `MCP server ${config.id} did not connect during startup: ${
              error instanceof Error ? error.message : String(error)
            }`,
          });
        }
      }),
  );
  try {
    await refreshTrustedExtensions();
  } catch (error) {
    diagnosticBundleService?.record({
      source: "main",
      severity: "warning",
      message: `Trusted extensions did not refresh during startup: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
  }
  await applyAgentRuntime();
}

function pathIsInside(root: string, path: string): boolean {
  const relation = relative(resolve(root), resolve(path));
  return (
    relation !== "" &&
    relation !== ".." &&
    !relation.startsWith(`..${sep}`) &&
    !isAbsolute(relation)
  );
}

function pathsEqual(left: string, right: string): boolean {
  const resolvedLeft = resolve(left);
  const resolvedRight = resolve(right);
  return process.platform === "win32"
    ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase()
    : resolvedLeft === resolvedRight;
}

function approvalProjectId(thread: Thread): string {
  return thread.projectId ?? `temporary:${thread.id}`;
}

async function resolveThreadWorkspace(thread: Thread): Promise<{
  project: Project;
  workspacePath: string;
  worktree?: TaskWorktree;
  temporary: boolean;
}> {
  if (!store) {
    throw new Error("Application store is not ready.");
  }
  assertConversationTarget(thread.projectId, thread.target);
  if (!thread.projectId) {
    const workspacePath = await ensureTemporaryConversationWorkspace(
      app.getPath("userData"),
      thread.id,
    );
    return {
      project: {
        id: `temporary:${thread.id}`,
        name: "Temporary conversation",
        path: workspacePath,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
      },
      workspacePath,
      temporary: true,
    };
  }
  const project = store.getProject(thread.projectId);
  if (!project) {
    throw new Error(`Project not found: ${thread.projectId}`);
  }
  if (thread.target === "local") {
    return { project, workspacePath: project.path, temporary: false };
  }
  const worktree = store.getWorktreeForThread(thread.id);
  if (!worktree || worktree.status !== "active") {
    throw new Error("Task worktree is not active.");
  }
  if (
    worktree.target === "managed-worktree" &&
    !pathIsInside(managedWorktreeRoot(project.id), worktree.path)
  ) {
    throw new Error("Managed worktree path is outside application storage.");
  }
  try {
    const worktreeStat = await stat(worktree.path);
    if (!worktreeStat.isDirectory()) {
      throw new Error("Task worktree path is not a directory.");
    }
  } catch (error) {
    store.updateWorktree(worktree.id, { status: "missing" });
    throw new Error(
      error instanceof Error
        ? `Task worktree is unavailable: ${error.message}`
        : "Task worktree is unavailable.",
    );
  }
  return {
    project,
    workspacePath: worktree.path,
    worktree,
    temporary: false,
  };
}

function closeProjectGitWatchersForSender(senderId: number): void {
  for (const [key, registration] of projectGitWatchers) {
    if (!key.startsWith(`${senderId}\0`)) continue;
    if (registration.timer) clearTimeout(registration.timer);
    for (const watcher of registration.watchers) watcher.close();
    projectGitWatchers.delete(key);
  }
  projectGitWatcherSenders.delete(senderId);
}

async function ensureProjectGitWatcher(
  sender: WebContents,
  projectId: string,
  threadId: string | undefined,
  workspacePath: string,
  initialInfo: ProjectGitInfo,
): Promise<void> {
  const key = `${sender.id}\0${projectId}\0${threadId ?? ""}`;
  if (projectGitWatchers.has(key)) return;
  const plan = await gitRepositoryWatchPaths(workspacePath);
  if (!plan) return;
  const registration: {
    watchers: FSWatcher[];
    signature: string;
    metadataSignature: string;
    pendingKinds: Set<"metadata" | "worktree">;
    refreshing: boolean;
    timer?: NodeJS.Timeout;
  } = {
    watchers: [],
    signature: JSON.stringify(initialInfo),
    metadataSignature: await gitRepositoryMetadataSignature(plan),
    pendingKinds: new Set(),
    refreshing: false,
  };
  const refresh = async () => {
    if (registration.refreshing) return;
    registration.refreshing = true;
    const pendingKinds = new Set(registration.pendingKinds);
    registration.pendingKinds.clear();
    try {
      const metadataSignature = await gitRepositoryMetadataSignature(plan);
      if (
        pendingKinds.size === 1 &&
        pendingKinds.has("metadata") &&
        metadataSignature === registration.metadataSignature
      ) {
        return;
      }
      let signature: string;
      try {
        signature = JSON.stringify(await inspectGitBranches(workspacePath));
      } catch {
        signature = "unavailable";
      }
      registration.metadataSignature =
        await gitRepositoryMetadataSignature(plan);
      if (signature === registration.signature) return;
      registration.signature = signature;
      if (!sender.isDestroyed()) {
        sender.send(IPC.projectGitChanged, {
          projectId,
          ...(threadId ? { threadId } : {}),
        });
      }
    } finally {
      registration.refreshing = false;
      if (registration.pendingKinds.size > 0 && !registration.timer) {
        registration.timer = setTimeout(() => {
          delete registration.timer;
          void refresh();
        }, 1_000);
      }
    }
  };
  const changed = (kind: "metadata" | "worktree") => {
    registration.pendingKinds.add(kind);
    if (registration.timer) clearTimeout(registration.timer);
    registration.timer = setTimeout(() => {
      delete registration.timer;
      void refresh();
    }, 1_000);
  };
  const insideMetadataDirectory = (path: string) =>
    [plan.gitDirectory, plan.commonDirectory].some((directory) => {
      const pathFromDirectory = relative(directory, path);
      return (
        pathFromDirectory === "" ||
        (!pathFromDirectory.startsWith(`..${sep}`) &&
          pathFromDirectory !== ".." &&
          !isAbsolute(pathFromDirectory))
      );
    });
  const worktreeChanged = (
    _eventType: string,
    filename: string | Buffer | null,
  ) => {
    if (filename) {
      const changedPath = resolve(plan.root, filename.toString());
      if (insideMetadataDirectory(changedPath)) return;
    }
    changed("worktree");
  };
  const metadataNames = new Set([
    "HEAD",
    "index",
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "config.worktree",
  ]);
  const commonMetadataNames = new Set(["config", "packed-refs"]);
  const metadataChanged =
    (acceptedNames: ReadonlySet<string> | undefined) =>
    (_eventType: string, filename: string | Buffer | null) => {
      if (acceptedNames && filename) {
        const topLevelName = filename.toString().split(/[\\/]/u, 1)[0];
        if (!topLevelName || !acceptedNames.has(topLevelName)) return;
      }
      changed("metadata");
    };
  const watchPath = (
    path: string,
    recursive: boolean,
    listener: (eventType: string, filename: string | Buffer | null) => void,
  ) => {
    try {
      registration.watchers.push(watch(path, { recursive }, listener));
    } catch {
      try {
        registration.watchers.push(watch(path, listener));
      } catch {
        // A disappearing Git metadata path will be recovered on the next read.
      }
    }
  };
  watchPath(plan.root, true, worktreeChanged);
  watchPath(plan.gitDirectory, false, metadataChanged(metadataNames));
  if (plan.commonDirectory !== plan.gitDirectory) {
    watchPath(
      plan.commonDirectory,
      false,
      metadataChanged(commonMetadataNames),
    );
  } else {
    for (const name of commonMetadataNames) metadataNames.add(name);
  }
  watchPath(
    join(plan.commonDirectory, "refs"),
    true,
    metadataChanged(undefined),
  );
  if (registration.watchers.length === 0) return;
  projectGitWatchers.set(key, registration);
  if (!projectGitWatcherSenders.has(sender.id)) {
    projectGitWatcherSenders.add(sender.id);
    sender.once("destroyed", () => closeProjectGitWatchersForSender(sender.id));
  }
}

async function linkedWorkspaceFile(
  threadIdInput: string,
  hrefInput: string,
): Promise<ResolvedWorkspaceFileLink> {
  if (!store) throw new Error("Application store is not ready.");
  const thread = store.getThread(String(threadIdInput ?? ""));
  if (!thread || thread.archived) {
    throw new Error("Active task not found.");
  }
  const context = await resolveThreadWorkspace(thread);
  return resolveWorkspaceFileLink(
    context.workspacePath,
    String(hrefInput ?? ""),
  );
}

async function launchWorkspaceFile(
  file: ResolvedWorkspaceFileLink,
): Promise<void> {
  if (!file.executable) {
    throw new Error("The selected workspace file is not executable.");
  }
  if (process.platform === "win32") {
    const error = await shell.openPath(file.absolutePath);
    if (error) throw new Error(error);
    return;
  }

  await new Promise<void>((resolveLaunch, rejectLaunch) => {
    const child = spawn(file.absolutePath, [], {
      cwd: dirname(file.absolutePath),
      detached: true,
      stdio: "ignore",
    });
    child.once("error", rejectLaunch);
    child.once("spawn", () => {
      child.unref();
      resolveLaunch();
    });
  });
}

async function createManagedTaskWorktree(
  project: Project,
  threadId: string,
  startPoint?: string,
): Promise<TaskWorktree> {
  const created = await createManagedWorktree({
    repositoryPath: project.path,
    managedRoot: managedWorktreeRoot(project.id),
    id: threadId,
    ...(startPoint ? { startPoint } : {}),
  });
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    threadId,
    projectId: project.id,
    path: created.path,
    target: "managed-worktree",
    head: created.head,
    ...(created.branch ? { branch: created.branch } : {}),
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
}

async function createPermanentTaskWorktree(
  project: Project,
  threadId: string,
  worktreePath: string,
): Promise<TaskWorktree> {
  const attached = await attachPermanentWorktree({
    repositoryPath: project.path,
    worktreePath,
  });
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    threadId,
    projectId: project.id,
    path: attached.path,
    target: "permanent-worktree",
    head: attached.head,
    ...(attached.branch ? { branch: attached.branch } : {}),
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
}

function applyPayloadSideEffects(
  threadId: string,
  payload: AgentPayload,
  threadAlreadyUpdated = false,
): void {
  if (!store) throw new Error("Application store is not ready.");
  switch (payload.type) {
    case "turn.started":
      if (!threadAlreadyUpdated) {
        store.updateThread(threadId, {
          mode: payload.mode,
          status: "running",
        });
      }
      publishAutomationRun(
        store.updateAutomationRunForThread(threadId, "running"),
      );
      break;
    case "approval.requested":
    case "user-input.requested":
      store.updateThread(threadId, { status: "waiting-approval" });
      publishAutomationRun(
        store.updateAutomationRunForThread(threadId, "waiting-approval"),
      );
      break;
    case "approval.resolved":
    case "user-input.resolved": {
      const stillWaiting =
        pendingApprovals.hasWhere(
          (pending) => pending.request.threadId === threadId,
        ) ||
        pendingUserInputs.hasWhere(
          (pending) => pending.request.threadId === threadId,
        ) ||
        pendingMultiUserInputs.hasWhere(
          (pending) => pending.request.threadId === threadId,
        );
      store.updateThread(threadId, {
        status: stillWaiting ? "waiting-approval" : "running",
      });
      publishAutomationRun(
        store.updateAutomationRunForThread(
          threadId,
          stillWaiting ? "waiting-approval" : "running",
        ),
      );
      break;
    }
    case "turn.completed":
      store.updateThread(threadId, { status: "idle" });
      {
        const completion = store.completeAutomationRunForThread(threadId);
        publishAutomationRun(completion?.run);
        if (completion?.deletedAutomationId) {
          automationDeleted(completion.deletedAutomationId);
        }
      }
      activeTurns.delete(threadId);
      break;
    case "turn.failed":
      store.updateThread(threadId, { status: "failed" });
      publishAutomationRun(
        store.updateAutomationRunForThread(threadId, "failed", payload.message),
      );
      activeTurns.delete(threadId);
      break;
  }
}

function applyGoalContinuationFailure(
  threadId: string,
  goalId: string,
  failure: { message: string; code?: string | undefined },
): { goal: ThreadGoal; continuationDelayMs: number } | undefined {
  if (!store) return undefined;
  const current = store.getThreadGoal(threadId);
  if (!current || current.goalId !== goalId || current.status !== "active") {
    return undefined;
  }
  const disposition = goalFailureDisposition(failure);
  if (disposition === "usage-limited") {
    return {
      goal: store.markThreadGoalUsageLimited(threadId, goalId),
      continuationDelayMs: 0,
    };
  }
  if (disposition === "retry") {
    return {
      goal: current,
      continuationDelayMs: GOAL_CONTINUATION_RETRY_DELAY_MILLISECONDS,
    };
  }
  const recorded = store.recordThreadGoalBlocker(
    threadId,
    goalId,
    goalFailureBlocker(failure),
  );
  return {
    goal: recorded.goal,
    continuationDelayMs: GOAL_CONTINUATION_RETRY_DELAY_MILLISECONDS,
  };
}

function scheduleGoalContinuation(
  threadId: string,
  goalId: string,
  delayMs = 0,
): void {
  if (scheduledGoalContinuations.has(threadId)) return;
  scheduledGoalContinuations.add(threadId);
  setTimeout(() => {
    scheduledGoalContinuations.delete(threadId);
    if (!store || !agentProcess) return;
    const thread = store.getThread(threadId);
    if (
      !thread ||
      thread.archived ||
      thread.mode !== "execute" ||
      thread.goal?.goalId !== goalId ||
      thread.goal.status !== "active" ||
      activeTurns.has(threadId) ||
      compactingThreads.has(threadId) ||
      cancellingTurns.has(threadId) ||
      pendingApprovals.hasWhere(
        (pending) => pending.request.threadId === threadId,
      ) ||
      pendingUserInputs.hasWhere(
        (pending) => pending.request.threadId === threadId,
      ) ||
      pendingMultiUserInputs.hasWhere(
        (pending) => pending.request.threadId === threadId,
      )
    ) {
      return;
    }
    void startTaskTurn(
      {
        threadId,
        mode: "execute",
        text: "Continue working toward the active Goal. Inspect current evidence and state, make the next meaningful progress, and call update_goal only when completion or the repeated-blocker rule is actually satisfied.",
      },
      { source: "goal-continuation", expectedGoalId: goalId },
    ).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      const result = applyGoalContinuationFailure(threadId, goalId, {
        message,
      });
      if (result) emitGoalUpdated(result.goal);
      if (result?.goal.status === "active") {
        scheduleGoalContinuation(threadId, goalId, result.continuationDelayMs);
      }
      diagnosticBundleService?.record({
        source: "main",
        severity: "error",
        message: `Goal continuation could not start: ${message}`,
      });
    });
  }, delayMs);
}

function goalObjectiveRoot(): string {
  return join(app.getPath("userData"), "goal-attachments");
}

async function materializeGoalObjective(objective: string): Promise<string> {
  return materializeGoalObjectiveFile(goalObjectiveRoot(), objective);
}

async function readGoalObjective(objective: string): Promise<string> {
  return readGoalObjectiveFile(goalObjectiveRoot(), objective);
}

async function cleanupGoalObjective(
  objective: string | undefined,
): Promise<void> {
  try {
    await cleanupGoalObjectiveFile(goalObjectiveRoot(), objective);
  } catch (error) {
    console.warn(
      `Managed Goal objective cleanup skipped: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function steerGoalObjectiveUpdate(goal: ThreadGoal): Promise<void> {
  if (!agentProcess || !store) return;
  if (goal.status !== "active") return;
  const thread = store.getThread(goal.threadId);
  if (!thread) return;
  if (activeTurns.has(goal.threadId) && openedThreads.has(goal.threadId)) {
    const objective = await readGoalObjective(goal.objective);
    await agentProcess.request({
      type: "turn.steer",
      requestId: randomUUID(),
      threadId: goal.threadId,
      text: `The persistent Goal objective was edited by the user. Pursue the updated objective now:\n\n${objective}`,
    });
    return;
  }
  scheduleGoalContinuation(goal.threadId, goal.goalId);
}

function accountGoalPayload(
  turnId: string | undefined,
  payload: AgentPayload,
): void {
  if (!store || !turnId) return;
  if (payload.type === "turn.completed" || payload.type === "turn.failed") {
    goalCreationAuthorizations.delete(turnId);
    for (const key of goalBlockerRecordedTurns) {
      if (key.startsWith(`${turnId}\0`)) goalBlockerRecordedTurns.delete(key);
    }
  }
  const context = goalTurnContexts.get(turnId);
  if (!context) return;
  const current = store.getThreadGoal(context.threadId);
  if (!current || current.goalId !== context.goalId) {
    goalTurnContexts.delete(turnId);
    return;
  }
  if (payload.type === "assistant.usage") {
    const updated = store.updateThreadGoalAccounting(
      context.threadId,
      context.goalId,
      payload.totalTokens,
      0,
    );
    if (updated) emitGoalUpdated(updated, turnId);
    return;
  }
  if (payload.type !== "turn.completed" && payload.type !== "turn.failed") {
    return;
  }
  goalTurnContexts.delete(turnId);
  let goal = store.updateThreadGoalAccounting(
    context.threadId,
    context.goalId,
    0,
    (Date.now() - context.startedAt) / 1_000,
  );
  if (!goal) return;
  let continuationDelayMs = 0;
  if (goal.status === "active" && payload.type === "turn.failed") {
    const result = applyGoalContinuationFailure(
      context.threadId,
      context.goalId,
      payload,
    );
    if (result) {
      goal = result.goal;
      continuationDelayMs = result.continuationDelayMs;
    }
  } else if (
    goal.status === "active" &&
    payload.type === "turn.completed" &&
    payload.reason === "cancelled"
  ) {
    goal = store.pauseThreadGoal(context.threadId);
  }
  emitGoalUpdated(goal, turnId);
  if (goal.status === "active") {
    scheduleGoalContinuation(
      context.threadId,
      context.goalId,
      continuationDelayMs,
    );
  }
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
  if (!store) {
    throw new Error("Application store is not ready.");
  }
  const preparedPayload = withPersistedTurnDuration(
    turnId,
    prepareRecoverableQueuePayload(threadId, payload),
  );
  observeTurnPayload(turnId, preparedPayload);
  const event = store.appendEvent(
    randomUUID(),
    threadId,
    turnId,
    preparedPayload,
    timestamp,
  );
  mainWindow?.webContents.send(IPC.agentEvent, event);
  applyPayloadSideEffects(threadId, preparedPayload);
  accountGoalPayload(turnId, preparedPayload);
  scheduleTurnChangeSetCompletion(threadId, turnId, preparedPayload);
  return event;
}

function emitPayloadBatch(events: readonly AgentHostEvent[]): AgentEvent[] {
  if (!store || events.length === 0) return [];
  const preparedEvents = events.map((event) => ({
    ...event,
    payload: withPersistedTurnDuration(
      event.turnId,
      prepareRecoverableQueuePayload(event.threadId, event.payload),
    ),
  }));
  const { durable: durableEvents, liveActivities } =
    partitionAgentHostEvents(preparedEvents);
  if (liveActivities.length > 0) {
    mainWindow?.webContents.send(IPC.agentActivities, liveActivities);
  }
  if (durableEvents.length === 0) return [];
  const threadId = durableEvents[0]!.threadId;
  if (durableEvents.some((event) => event.threadId !== threadId)) {
    return durableEvents.map((event) =>
      emitPayload(event.threadId, event.turnId, event.payload),
    );
  }
  for (const event of durableEvents) {
    observeTurnPayload(event.turnId, event.payload);
  }
  const persisted = store.appendEvents(
    threadId,
    durableEvents.map((event) => ({
      eventId: randomUUID(),
      ...(event.turnId ? { turnId: event.turnId } : {}),
      payload: event.payload,
    })),
  );
  mainWindow?.webContents.send(IPC.agentEvents, persisted);
  for (const event of durableEvents) {
    applyPayloadSideEffects(threadId, event.payload);
    accountGoalPayload(event.turnId, event.payload);
    scheduleTurnChangeSetCompletion(threadId, event.turnId, event.payload);
  }
  return persisted;
}

function scheduleTurnChangeSetCompletion(
  threadId: string,
  turnId: string | undefined,
  payload: AgentPayload,
): void {
  if (
    !turnId ||
    !turnChangeSetService ||
    (payload.type !== "turn.completed" && payload.type !== "turn.failed") ||
    turnChangeSetCompletionTails.has(threadId)
  ) {
    return;
  }
  const completion = (async () => {
    try {
      const changeSet = await turnChangeSetService!.complete(
        threadId,
        turnId,
        payload.backgroundProcessesRunning === true,
      );
      if (changeSet) emitPayload(threadId, turnId, changeSet);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await turnChangeSetService?.discard(turnId);
      diagnosticBundleService?.record({
        source: "main",
        severity: "warning",
        message: `Turn change-set capture failed for ${turnId}: ${message}`,
      });
      emitPayload(threadId, turnId, {
        type: "turn.change-set.updated",
        status: "unavailable",
        files: [],
        additions: 0,
        deletions: 0,
        undoAvailable: false,
        message,
      });
    }
  })();
  turnChangeSetCompletionTails.set(threadId, completion);
  void completion.finally(() => {
    if (turnChangeSetCompletionTails.get(threadId) === completion) {
      turnChangeSetCompletionTails.delete(threadId);
    }
  });
}

function prepareRecoverableQueuePayload(
  threadId: string,
  payload: AgentPayload,
): AgentPayload {
  if (payload.type === "queue.updated") {
    const queue = recoverableTurnQueues.reconcile(
      threadId,
      payload.steering,
      payload.followUp,
    );
    return { ...payload, ...queue };
  }
  if (payload.type === "queue.recovered") {
    if (payload.items) {
      recoverableTurnQueues.discard(threadId);
      return payload;
    }
    const items = recoverableTurnQueues.recover(threadId, payload.messages);
    return { ...payload, items };
  }
  if (payload.type === "turn.completed" || payload.type === "turn.failed") {
    recoverableTurnQueues.discard(threadId);
  }
  return payload;
}

async function emitInitialTurn(
  threadId: string,
  turnId: string,
  text: string,
  mode: StartTurnInput["mode"],
  attachments: PromptAttachment[],
  visibleUserMessage = true,
): Promise<AgentEvent[]> {
  if (!store) throw new Error("Application store is not ready.");
  const attachmentPayloads = attachments.map((attachment) => ({
    type: "task.source.added" as const,
    sourceId: randomUUID(),
    name: attachment.name,
    mimeType: attachment.mimeType,
    kind: "type" in attachment ? ("file" as const) : ("image" as const),
    attachment,
  }));
  const savedImages = attachmentPayloads.filter(
    (
      source,
    ): source is typeof source & {
      kind: "image";
      attachment: PromptImage;
    } => source.kind === "image" && !("type" in source.attachment),
  );
  try {
    await Promise.all(
      savedImages.map((source) =>
        taskSourceImages().save(threadId, source.sourceId, source.attachment),
      ),
    );
  } catch (error) {
    await Promise.allSettled(
      savedImages.map((source) =>
        taskSourceImages().delete(threadId, source.sourceId),
      ),
    );
    throw error;
  }
  const payloads: AgentPayload[] = [
    ...(visibleUserMessage
      ? [{ type: "user.message" as const, messageId: randomUUID(), text }]
      : []),
    ...attachmentPayloads.map(
      ({ attachment: _attachment, ...payload }): AgentPayload => payload,
    ),
    { type: "turn.started", mode },
  ];
  for (const payload of payloads) observeTurnPayload(turnId, payload);
  let result: ReturnType<AppStore["appendEventsAndUpdateThread"]>;
  try {
    result = store.appendEventsAndUpdateThread(
      threadId,
      payloads.map((payload) => ({
        eventId: randomUUID(),
        turnId,
        payload,
      })),
      { mode, status: "running" },
    );
  } catch (error) {
    await Promise.allSettled(
      savedImages.map((source) =>
        taskSourceImages().delete(threadId, source.sourceId),
      ),
    );
    throw error;
  }
  mainWindow?.webContents.send(IPC.agentEvents, result.events);
  for (const payload of payloads) {
    applyPayloadSideEffects(threadId, payload, payload.type === "turn.started");
  }
  return result.events;
}

function publishAutomationEvent(event: AutomationEvent): void {
  mainWindow?.webContents.send(IPC.automationEvent, event);
}

function publishAutomationRun(run: AutomationRun | undefined): void {
  if (!run) return;
  publishAutomationEvent({
    protocolVersion: PROTOCOL_VERSION,
    eventId: randomUUID(),
    timestamp: new Date().toISOString(),
    payload: { type: "automation-run.upserted", run },
  });
  if (
    store &&
    (run.state === "failed" ||
      run.state === "skipped" ||
      (run.state === "completed" && !mainWindow?.isFocused()))
  ) {
    const automation = store.getAutomation(run.automationId);
    if (automation) automationRunNotification(automation, run);
  }
}

function automationAutoApproval(request: BrokerExecutionRequest): boolean {
  if (!store) return false;
  const run = store.getAutomationRunForThread(request.threadId);
  const automation = run ? store.getAutomation(run.automationId) : undefined;
  if (
    !run ||
    !automation ||
    automation.authorizationFingerprint !==
      automationAuthorizationFingerprint(automation)
  ) {
    return false;
  }
  return automationMayAutoApprove({
    automationMode: automation.mode,
    authorizationState: automation.authorizationState,
    linkedThreadId: run.threadId,
    requestThreadId: request.threadId,
    activeTurnId: activeTurns.get(request.threadId),
    requestTurnId: request.turnId,
  });
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
  if (!automationAutoApproval(request)) return undefined;
  const nonce = randomUUID();
  emitPayload(request.threadId, request.turnId, {
    type: "approval.requested",
    approvalId: request.approvalId,
    nonce,
    summary: details.summary,
    paths: details.paths ?? [],
    network: details.network ?? [],
    risk: details.risk,
    allowedScopes: ["once"],
    source: "automation",
  });
  return {
    approvalId: request.approvalId,
    nonce,
    approved: true,
    scope: "once",
    source: "automation",
  };
}

function completeUserInput(
  resolution: UserInputResolution,
  source: "user" | "timeout",
): void {
  if (!agentProcess || !store) throw new Error("Application is not ready.");
  const resolved =
    source === "timeout"
      ? pendingUserInputs.consumeRecommended(
          resolution.requestId,
          resolution.nonce,
        )
      : pendingUserInputs.consume(resolution);
  if (resolved.value.timeout !== undefined) {
    clearTimeout(resolved.value.timeout);
  }
  const { request, workerRequestId } = resolved.value;
  emitPayload(request.threadId, request.turnId, {
    type: "user-input.resolved",
    requestId: request.approvalId,
    nonce: resolution.nonce,
    answer: resolved.answer,
    ...(resolved.selectedOption === undefined
      ? {}
      : { selectedOption: resolved.selectedOption }),
    source,
  });
  agentProcess.post({
    type: "broker.resolve",
    requestId: workerRequestId,
    resolution: {
      approvalId: request.approvalId,
      nonce: resolution.nonce,
      approved: true,
      scope: "once",
      source: source === "timeout" ? "policy" : "user",
    },
    result: {
      answer: resolved.answer,
      ...(resolved.selectedOption === undefined
        ? {}
        : {
            selectedOption: resolved.selectedOption,
            selectedLabel: request.options[resolved.selectedOption]?.label,
          }),
      source,
    },
  });
}

function handleUserInputBrokerRequest(
  workerRequestId: string,
  request: Extract<BrokerExecutionRequest, { kind: "user.input" }>,
): void {
  if (!agentProcess || !store) return;
  if (isMultiQuestionUserInputRequest(request)) {
    handleMultiQuestionUserInputBrokerRequest(workerRequestId, request);
    return;
  }
  // Every rejection branch (thread/turn/mode ownership, option shape,
  // frozen-schema parse including a carried `questions` key, duplicate
  // pending) is decided by the pure validator so it stays unit-testable
  // and every failure path answers with one broker reject (review P1-2).
  const thread = store.getThread(request.threadId);
  const prepared = prepareSingleQuestionUserInputRegistration(
    request,
    {
      // getThread returns undefined — never null — for a missing thread
      // (store.ts), so the ownership gate keys on Boolean(thread); a
      // `!== null` comparison is vacuously true and silently disables the
      // gate (review round 3, severity 1).
      threadExists: Boolean(thread),
      turnCancelling: cancellingTurns.has(request.threadId),
      turnActive: activeTurns.get(request.threadId) === request.turnId,
      modeMatches: thread?.mode === request.mode,
      // Duplicates are refused across both registries (review round 3,
      // item 3): the same approval id must never sit in the single and the
      // multi registry at once, or the reducer's fail-closed second request
      // would leave a ghost pending card no user can ever answer.
      duplicatePending:
        pendingUserInputs.hasWhere(
          (pending) => pending.request.approvalId === request.approvalId,
        ) ||
        pendingMultiUserInputs.hasWhere(
          (pending) => pending.request.approvalId === request.approvalId,
        ),
    },
    { nonce: randomUUID(), now: Date.now() },
  );
  if (!prepared.ok) {
    rejectBrokerRequest(workerRequestId, request, prepared.reason);
    return;
  }
  const payload = prepared.payload;
  const nonce = payload.nonce;
  const recommendedOption = payload.options.findIndex(
    (option) => option.recommended,
  );
  // Register before arming the timer (review item 2, single-path closeout):
  // a rejected registration can never leak an orphan timer. Duplicates
  // were already refused by the pure validator above with one broker
  // reject, so the registry register()'s throw plus the catch below is the
  // only single-threaded backstop this path needs (review round 3, item 4
  // removed the unreachable post-prepare duplicate check).
  const pendingValue: PendingUserInput = {
    workerRequestId,
    request,
    timeout: undefined,
  };
  try {
    pendingUserInputs.register({
      requestId: request.approvalId,
      nonce,
      options: payload.options,
      value: pendingValue,
    });
  } catch (error) {
    rejectBrokerRequest(
      workerRequestId,
      request,
      error instanceof Error && error.message.includes("already pending")
        ? "User input is already pending."
        : error instanceof Error
          ? error.message
          : "User input is invalid.",
    );
    return;
  }
  pendingValue.timeout = setTimeout(() => {
    try {
      completeUserInput(
        {
          requestId: request.approvalId,
          nonce,
          selectedOption: recommendedOption,
        },
        "timeout",
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Timed-out user input could not be resolved.";
      diagnosticBundleService?.record({
        source: "main",
        // The user answering just before the timer fires is a normal race,
        // not a fault: keep that noise out of the error channel (nit 8).
        severity:
          message === "User input is no longer pending." ? "warning" : "error",
        message,
      });
    }
  }, USER_INPUT_TIMEOUT_MILLISECONDS);
  emitPayload(request.threadId, request.turnId, payload);
}

// IPC dispatch discrimination (D#76 PR10C): the union's single-question
// member declares the multi-question fields as z.unknown() so its
// superRefine can observe key presence, which erases the literal
// discriminant TypeScript needs for automatic narrowing — so the dispatch
// uses an explicit predicate instead of a bare `kind ===` comparison.
function isMultiQuestionUserInputResolution(
  resolution: UserInputResolution,
): resolution is UserInputMultiQuestionResolution {
  return resolution.kind === "multi-question";
}

function completeMultiUserInputQuestion(
  requestId: string,
  nonce: string,
  questionId: string,
  source: "user" | "timeout",
  selection: { selectedOptionLabel?: string; customAnswer?: string } = {},
): void {
  if (!agentProcess || !store) throw new Error("Application is not ready.");
  // Main-process expiry gate mirroring the reducer's own (review item 1):
  // a user answer past expiresAt is refused before consumption so the
  // caller perceives the rejection, and the emitted timestamp is clamped
  // onto the frozen deadline so the reducer's time gates can never disagree
  // with this gate (scenario A's millisecond race between consume and
  // stamp, scenario B's clock step-back).
  const expiresAt = pendingMultiUserInputs.getQuestionExpiresAt(
    requestId,
    questionId,
  );
  const expiresAtMs =
    expiresAt === undefined ? Number.NaN : Date.parse(expiresAt);
  if (
    source === "user" &&
    Number.isFinite(expiresAtMs) &&
    Date.now() > expiresAtMs
  ) {
    throw new Error("User input has expired.");
  }
  const resolved =
    source === "timeout"
      ? pendingMultiUserInputs.consumeRecommendedQuestion(
          requestId,
          nonce,
          questionId,
        )
      : pendingMultiUserInputs.consumeQuestion({
          requestId,
          nonce,
          questionId,
          source,
          ...selection,
        });
  const { request, workerRequestId, timeouts } = resolved.value;
  const timeout = timeouts.get(questionId);
  if (timeout !== undefined) clearTimeout(timeout);
  // User answers are stamped at or before the deadline; timeouts at or
  // after it — exactly the windows the reducer accepts.
  const resolvedAtMs = Number.isFinite(expiresAtMs)
    ? source === "user"
      ? Math.min(Date.now(), expiresAtMs)
      : Math.max(Date.now(), expiresAtMs)
    : Date.now();
  emitPayload(
    request.threadId,
    request.turnId,
    {
      type: "user-input.resolved",
      kind: "multi-question",
      requestId,
      nonce,
      questionId,
      ...(resolved.selectedOptionLabel === undefined
        ? {}
        : { selectedOptionLabel: resolved.selectedOptionLabel }),
      ...(resolved.customAnswer === undefined
        ? {}
        : { customAnswer: resolved.customAnswer }),
      source,
    },
    new Date(resolvedAtMs).toISOString(),
  );
  if (!resolved.final) return;
  // Dual-channel backfill: the renderer already saw one kind'd resolved
  // event per question; the agent's tool promise settles exactly once with
  // an aggregated result covering every question on the card.
  agentProcess.post({
    type: "broker.resolve",
    requestId: workerRequestId,
    resolution: {
      approvalId: requestId,
      nonce,
      approved: true,
      scope: "once",
      source: source === "timeout" ? "policy" : "user",
    },
    result: {
      // No top-level source (review R2 P1-3): the aggregate spans every
      // question and each answer carries its own provenance, so one
      // card-level source would misstate every question that settled
      // differently from the last one.
      answers: resolved.final.answers,
    },
  });
}

function handleMultiQuestionUserInputBrokerRequest(
  workerRequestId: string,
  request: MultiQuestionUserInputRequest,
): void {
  if (!agentProcess || !store) return;
  const thread = store.getThread(request.threadId);
  // Every rejection branch (thread/turn/mode ownership, question count and
  // shape, frozen-schema parse, duplicate injection) is decided by the pure
  // validator so it stays unit-testable (review item 5) and every failure
  // path answers with one broker reject instead of a thrown error.
  const prepared = prepareMultiQuestionUserInputRegistration(
    request,
    {
      // Same Boolean(thread) ownership gate as the single-question handler:
      // getThread signals a missing thread with undefined, not null (review
      // round 3, severity 1).
      threadExists: Boolean(thread),
      turnCancelling: cancellingTurns.has(request.threadId),
      turnActive: activeTurns.get(request.threadId) === request.turnId,
      modeMatches: thread?.mode === request.mode,
      // Cross-registry duplicate refusal (review round 3, item 3), sharing
      // the "User input is already pending." reject reason with the
      // single-question registry.
      duplicatePending:
        pendingMultiUserInputs.hasWhere(
          (pending) => pending.request.approvalId === request.approvalId,
        ) ||
        pendingUserInputs.hasWhere(
          (pending) => pending.request.approvalId === request.approvalId,
        ),
    },
    { nonce: randomUUID(), now: Date.now() },
  );
  if (!prepared.ok) {
    rejectBrokerRequest(workerRequestId, request, prepared.reason);
    return;
  }
  const payload = prepared.payload;
  // Register before arming the timers (review item 2): a rejected
  // registration can never leak orphan timers that before-quit cleanup
  // cannot reach, and duplicates were already answered above with one
  // broker reject instead of an unhandled throw.
  const pendingValue: PendingMultiUserInput = {
    workerRequestId,
    request,
    timeouts: new Map(),
  };
  try {
    pendingMultiUserInputs.register({
      requestId: request.approvalId,
      nonce: payload.nonce,
      questions: payload.questions.map((question) => ({
        questionId: question.questionId,
        options: question.options,
        expiresAt: question.expiresAt,
      })),
      value: pendingValue,
    });
  } catch (error) {
    rejectBrokerRequest(
      workerRequestId,
      request,
      error instanceof Error && error.message.includes("already pending")
        ? "User input is already pending."
        : error instanceof Error
          ? error.message
          : "User input is invalid.",
    );
    return;
  }
  // Per-question timers (independent five-minute clocks): each expiry
  // resolves only its own question with its own recommended label; the
  // reducer's reverse time gate (timestamp >= expiresAt) accepts exactly
  // these events.
  for (const question of payload.questions) {
    pendingValue.timeouts.set(
      question.questionId,
      setTimeout(() => {
        try {
          completeMultiUserInputQuestion(
            request.approvalId,
            payload.nonce,
            question.questionId,
            "timeout",
          );
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "Timed-out user input could not be resolved.";
          diagnosticBundleService?.record({
            source: "main",
            // The user answering just before the timer fires is a normal
            // race, not a fault: keep that noise out of the error channel
            // (nit 8).
            severity:
              message === "User input is no longer pending."
                ? "warning"
                : "error",
            message,
          });
        }
      }, USER_INPUT_TIMEOUT_MILLISECONDS),
    );
  }
  emitPayload(request.threadId, request.turnId, payload);
}

async function executeApprovedShell(
  workerRequestId: string,
  request: Extract<BrokerExecutionRequest, { kind: "shell.execute" }>,
  resolution: ApprovalResolution,
): Promise<void> {
  if (!agentProcess) return;
  emitPayload(request.threadId, request.turnId, {
    type: "approval.resolved",
    approvalId: resolution.approvalId,
    nonce: resolution.nonce,
    approved: true,
    scope: resolution.scope,
    ...(resolution.source ? { source: resolution.source } : {}),
  });
  agentProcess.post({
    type: "broker.resolve",
    requestId: workerRequestId,
    resolution,
    result: { approved: true },
  });
}

async function handleShellBrokerRequest(
  workerRequestId: string,
  request: Extract<BrokerExecutionRequest, { kind: "shell.execute" }>,
): Promise<void> {
  if (!agentProcess || !store) return;
  if (request.mode !== "execute") {
    rejectBrokerRequest(
      workerRequestId,
      request,
      `${request.mode} mode rejects shell execution.`,
    );
    return;
  }
  const thread = store.getThread(request.threadId);
  if (
    !thread ||
    cancellingTurns.has(request.threadId) ||
    thread.mode !== request.mode ||
    activeTurns.get(request.threadId) !== request.turnId
  ) {
    rejectBrokerRequest(
      workerRequestId,
      request,
      "Shell execution requires the active Execute turn.",
    );
    return;
  }
  let context: Awaited<ReturnType<typeof resolveThreadWorkspace>>;
  try {
    context = await resolveThreadWorkspace(thread);
  } catch (error) {
    rejectBrokerRequest(
      workerRequestId,
      request,
      error instanceof Error ? error.message : String(error),
    );
    return;
  }
  if (
    !conversationWorkspaceMatches(context.workspacePath, request.workspacePath)
  ) {
    rejectBrokerRequest(
      workerRequestId,
      request,
      "Shell workspace does not match the task project.",
    );
    return;
  }
  const decision = evaluateModePolicy(request.mode, {
    kind: "shell",
    summary: request.command,
    command: request.command,
  });
  if (decision.outcome === "deny") {
    rejectBrokerRequest(workerRequestId, request, decision.reason);
    return;
  }
  const automationResolution = createAutomationApproval(request, {
    summary: `Run ${request.command}`,
    risk: decision.outcome === "ask" ? decision.risk : "medium",
  });
  if (automationResolution) {
    await executeApprovedShell(workerRequestId, request, automationResolution);
    return;
  }

  const approvalPolicy = await settingsStore?.approvalPolicy();
  const fullAccessAvailable = getPlatformContract().sandbox.available;
  const fingerprint = createApprovalFingerprint(
    "shell.execute",
    request.command,
  );
  const rememberedScope =
    approvalPolicy === "custom"
      ? store.findApprovalGrant({
          threadId: thread.id,
          projectId: approvalProjectId(thread),
          operation: "shell.execute",
          fingerprint,
        })
      : undefined;
  if (rememberedScope) {
    await executeApprovedShell(workerRequestId, request, {
      approvalId: request.approvalId,
      nonce: randomUUID(),
      approved: true,
      scope: rememberedScope,
      source: "user",
    });
    return;
  }
  const approvalOperation = {
    kind: "shell.execute" as const,
    minimumRisk: decision.outcome === "ask" ? decision.risk : "medium",
    modelApproval: request.modelApproval,
  };
  if (
    decision.outcome === "allow" ||
    shouldAutoApprove(
      approvalPolicy ?? "ask",
      approvalOperation,
      fullAccessAvailable,
    )
  ) {
    await executeApprovedShell(workerRequestId, request, {
      approvalId: request.approvalId,
      nonce: randomUUID(),
      approved: true,
      scope: "once",
      source: approvalPolicy === "agent" ? "model" : "policy",
    });
    return;
  }

  const nonce = randomUUID();
  const allowedScopes =
    approvalPolicy === "custom" && decision.outcome === "ask"
      ? conversationApprovalScopes(thread, decision.allowedScopes)
      : ["once" as const];
  pendingApprovals.register({
    approvalId: request.approvalId,
    nonce,
    allowedScopes: [...allowedScopes],
    value: {
      workerRequestId,
      request,
      projectId: approvalProjectId(thread),
      fingerprint,
    },
  });
  emitPayload(request.threadId, request.turnId, {
    type: "approval.requested",
    approvalId: request.approvalId,
    nonce,
    summary: "Run shell command",
    command: request.command,
    paths: [],
    network: [],
    risk: effectiveApprovalRisk(approvalOperation),
    allowedScopes: [...allowedScopes],
    source: modelMayAutoApprove(approvalOperation) ? "policy" : "model",
    modelRecommendation: modelMayAutoApprove(approvalOperation)
      ? "approve"
      : "deny",
    modelReason: request.modelApproval.reason,
    ...(request.actorAgentId ? { actorAgentId: request.actorAgentId } : {}),
  });
}

type LocalFileBrokerRequest = Extract<
  BrokerExecutionRequest,
  { kind: "local.file.read" | "local.file.write" }
>;

function localFileRequestSummary(request: LocalFileBrokerRequest): string {
  return `${request.kind === "local.file.read" ? "Read" : "Write"} local file ${request.path}`;
}

async function executeApprovedLocalFile(
  workerRequestId: string,
  request: LocalFileBrokerRequest,
  resolution: ApprovalResolution,
): Promise<void> {
  if (!agentProcess) return;
  emitPayload(request.threadId, request.turnId, {
    type: "approval.resolved",
    approvalId: resolution.approvalId,
    nonce: resolution.nonce,
    approved: true,
    scope: resolution.scope,
    ...(resolution.source ? { source: resolution.source } : {}),
  });
  try {
    const result =
      request.kind === "local.file.read"
        ? {
            path: resolveLocalFilePath(request.path),
            content: await readLocalTextFile(request.path),
          }
        : await writeLocalTextFile(request.path, request.content);
    agentProcess.post({
      type: "broker.resolve",
      requestId: workerRequestId,
      resolution,
      result,
    });
  } catch (error) {
    agentProcess.post({
      type: "broker.resolve",
      requestId: workerRequestId,
      resolution: { ...resolution, approved: false },
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleLocalFileBrokerRequest(
  workerRequestId: string,
  request: LocalFileBrokerRequest,
): Promise<void> {
  if (!agentProcess || !store) return;
  if (request.mode !== "execute") {
    rejectBrokerRequest(
      workerRequestId,
      request,
      `${request.mode} mode rejects local file access.`,
    );
    return;
  }
  const thread = store.getThread(request.threadId);
  if (
    !thread ||
    cancellingTurns.has(request.threadId) ||
    thread.mode !== request.mode ||
    activeTurns.get(request.threadId) !== request.turnId
  ) {
    rejectBrokerRequest(
      workerRequestId,
      request,
      "Local file access requires the active Execute turn.",
    );
    return;
  }
  let context: Awaited<ReturnType<typeof resolveThreadWorkspace>>;
  try {
    context = await resolveThreadWorkspace(thread);
  } catch (error) {
    rejectBrokerRequest(
      workerRequestId,
      request,
      error instanceof Error ? error.message : String(error),
    );
    return;
  }
  if (
    !conversationWorkspaceMatches(context.workspacePath, request.workspacePath)
  ) {
    rejectBrokerRequest(
      workerRequestId,
      request,
      "Agent workspace does not match the task project.",
    );
    return;
  }
  let path: string;
  try {
    path = resolveLocalFilePath(request.path);
  } catch (error) {
    rejectBrokerRequest(
      workerRequestId,
      request,
      error instanceof Error ? error.message : String(error),
    );
    return;
  }

  const approvalPolicy = await settingsStore?.approvalPolicy();
  const fullAccessAvailable = getPlatformContract().sandbox.available;
  const fingerprint = createApprovalFingerprint(request.kind, path);
  const rememberedScope =
    approvalPolicy === "custom"
      ? store.findApprovalGrant({
          threadId: thread.id,
          projectId: approvalProjectId(thread),
          operation: request.kind,
          fingerprint,
        })
      : undefined;
  if (rememberedScope) {
    await executeApprovedLocalFile(workerRequestId, request, {
      approvalId: request.approvalId,
      nonce: randomUUID(),
      approved: true,
      scope: rememberedScope,
      source: "user",
    });
    return;
  }

  const approvalOperation = {
    kind: request.kind,
    minimumRisk: "high" as const,
    modelApproval: request.modelApproval,
  };
  if (
    shouldAutoApprove(
      approvalPolicy ?? "ask",
      approvalOperation,
      fullAccessAvailable,
    )
  ) {
    await executeApprovedLocalFile(workerRequestId, request, {
      approvalId: request.approvalId,
      nonce: randomUUID(),
      approved: true,
      scope: "once",
      source: approvalPolicy === "agent" ? "model" : "policy",
    });
    return;
  }

  const nonce = randomUUID();
  const allowedScopes = conversationApprovalScopes(thread, [
    "once",
    "session",
    "project",
  ]);
  pendingApprovals.register({
    approvalId: request.approvalId,
    nonce,
    allowedScopes: [...allowedScopes],
    value: {
      workerRequestId,
      request,
      projectId: approvalProjectId(thread),
      fingerprint,
    },
  });
  emitPayload(request.threadId, request.turnId, {
    type: "approval.requested",
    approvalId: request.approvalId,
    nonce,
    summary: localFileRequestSummary(request),
    paths: [path],
    network: [],
    risk: effectiveApprovalRisk(approvalOperation),
    allowedScopes: [...allowedScopes],
    source: modelMayAutoApprove(approvalOperation) ? "policy" : "model",
    modelRecommendation: modelMayAutoApprove(approvalOperation)
      ? "approve"
      : "deny",
    modelReason: request.modelApproval.reason,
  });
}

async function openAgentThread(
  thread: Thread,
  resolvedWorkspacePath?: string,
): Promise<void> {
  if (openedThreads.has(thread.id)) {
    return;
  }
  const existing = openingThreads.get(thread.id);
  if (existing) {
    await existing;
    return;
  }
  const opening = (async () => {
    await optionalCapabilitiesReady;
    if (openedThreads.has(thread.id)) return;
    if (!store || !agentProcess) {
      throw new Error("Agent process is not ready.");
    }
    const workspacePath =
      resolvedWorkspacePath ??
      (await resolveThreadWorkspace(thread)).workspacePath;
    const defaultConfiguration =
      !thread.modelSelection || !thread.contextWindow
        ? await settingsStore?.runtimeConfiguration()
        : undefined;
    const selection = thread.modelSelection ?? defaultConfiguration?.selection;
    const contextWindow =
      thread.contextWindow ?? defaultConfiguration?.contextWindow;
    if (
      selection &&
      contextWindow &&
      (!thread.modelSelection || !thread.contextWindow)
    ) {
      thread = store.updateThread(thread.id, {
        modelSelection: selection,
        contextWindow,
      });
    }
    const data = await agentProcess.request<{ sessionFile?: string }>({
      type: "thread.open",
      requestId: randomUUID(),
      threadId: thread.id,
      workspacePath,
      target: thread.target,
      ...(thread.sessionFile ? { sessionFile: thread.sessionFile } : {}),
      ...(selection ? { selection } : {}),
      ...(contextWindow ? { contextWindow } : {}),
    });
    if (data.sessionFile) {
      store.updateThread(thread.id, { sessionFile: data.sessionFile });
    }
    openedThreads.add(thread.id);
  })();
  openingThreads.set(thread.id, opening);
  try {
    await opening;
  } finally {
    if (openingThreads.get(thread.id) === opening) {
      openingThreads.delete(thread.id);
    }
  }
}

async function handleBrokerRequest(
  workerRequestId: string,
  request: BrokerExecutionRequest,
): Promise<void> {
  if (!agentProcess || !store) {
    return;
  }
  switch (request.kind) {
    case "goal.get":
    case "goal.create":
    case "goal.update":
      await handleGoalBrokerRequest(workerRequestId, request);
      return;
    case "user.input":
      handleUserInputBrokerRequest(workerRequestId, request);
      return;
    case "shell.execute":
      await handleShellBrokerRequest(workerRequestId, request);
      return;
    case "local.file.read":
    case "local.file.write":
      await handleLocalFileBrokerRequest(workerRequestId, request);
      return;
    case "memory.append":
      await handleMemoryAppendBrokerRequest(workerRequestId, request);
      return;
    case "mcp.call":
      await handleMcpBrokerRequest(workerRequestId, request);
      return;
    case "extension.call":
      await handleExtensionBrokerRequest(workerRequestId, request);
      return;
    case "office.document":
      await handleOfficeDocumentBrokerRequest(workerRequestId, request);
      return;
  }
  const decision = evaluateModePolicy(request.mode, {
    kind: "write",
    summary: `Write ${request.relativePath}`,
    paths: [request.relativePath],
  });

  if (decision.outcome === "deny") {
    rejectBrokerRequest(workerRequestId, request, decision.reason);
    return;
  }

  const thread = store.getThread(request.threadId);
  if (!thread) {
    rejectBrokerRequest(workerRequestId, request, "Task project not found.");
    return;
  }
  let project: Project;
  let taskWorkspace: string;
  try {
    const context = await resolveThreadWorkspace(thread);
    project = context.project;
    taskWorkspace = context.workspacePath;
  } catch (error) {
    rejectBrokerRequest(
      workerRequestId,
      request,
      error instanceof Error ? error.message : String(error),
    );
    return;
  }
  if (!conversationWorkspaceMatches(taskWorkspace, request.workspacePath)) {
    rejectBrokerRequest(
      workerRequestId,
      request,
      "Agent workspace does not match the task project.",
    );
    return;
  }

  let absolutePath: string;
  try {
    absolutePath = resolveWorkspacePath(
      request.workspacePath,
      request.relativePath,
    );
  } catch (error) {
    rejectBrokerRequest(
      workerRequestId,
      request,
      error instanceof Error ? error.message : String(error),
    );
    return;
  }

  const fingerprint = createApprovalFingerprint(
    "workspace.write",
    absolutePath,
  );
  const automationResolution = createAutomationApproval(request, {
    summary: `Write ${request.relativePath}`,
    paths: [request.relativePath],
    risk: decision.outcome === "ask" ? decision.risk : "medium",
  });
  if (automationResolution) {
    await executeApprovedWrite(workerRequestId, request, automationResolution);
    return;
  }
  const approvalPolicy = await settingsStore?.approvalPolicy();
  const fullAccessAvailable = getPlatformContract().sandbox.available;
  const rememberedScope =
    approvalPolicy === "custom"
      ? store.findApprovalGrant({
          threadId: thread.id,
          projectId: project.id,
          operation: "workspace.write",
          fingerprint,
        })
      : undefined;
  if (rememberedScope) {
    await executeApprovedWrite(workerRequestId, request, {
      approvalId: request.approvalId,
      nonce: randomUUID(),
      approved: true,
      scope: rememberedScope,
      source: "user",
    });
    return;
  }

  const approvalOperation = {
    kind: "workspace.write" as const,
    minimumRisk: decision.outcome === "ask" ? decision.risk : "medium",
    modelApproval: request.modelApproval,
  };
  if (
    decision.outcome === "allow" ||
    shouldAutoApprove(
      approvalPolicy ?? "ask",
      approvalOperation,
      fullAccessAvailable,
    )
  ) {
    await executeApprovedWrite(workerRequestId, request, {
      approvalId: request.approvalId,
      nonce: randomUUID(),
      approved: true,
      scope: "once",
      source: approvalPolicy === "agent" ? "model" : "policy",
    });
    return;
  }

  const nonce = randomUUID();
  const allowedScopes =
    approvalPolicy === "custom"
      ? conversationApprovalScopes(thread, decision.allowedScopes)
      : ["once" as const];
  pendingApprovals.register({
    approvalId: request.approvalId,
    nonce,
    allowedScopes: [...allowedScopes],
    value: {
      workerRequestId,
      request,
      projectId: project.id,
      fingerprint,
    },
  });
  emitPayload(request.threadId, request.turnId, {
    type: "approval.requested",
    approvalId: request.approvalId,
    nonce,
    summary: `Write ${request.relativePath}`,
    paths: [request.relativePath],
    network: [],
    risk: effectiveApprovalRisk(approvalOperation),
    allowedScopes: [...allowedScopes],
    source: modelMayAutoApprove(approvalOperation) ? "policy" : "model",
    modelRecommendation: modelMayAutoApprove(approvalOperation)
      ? "approve"
      : "deny",
    modelReason: request.modelApproval.reason,
    ...(request.actorAgentId ? { actorAgentId: request.actorAgentId } : {}),
  });
}

type GoalBrokerRequest = Extract<
  BrokerExecutionRequest,
  { kind: "goal.get" | "goal.create" | "goal.update" }
>;

function emitGoalUpdated(goal: ThreadGoal, turnId?: string): void {
  emitPayload(goal.threadId, turnId, {
    type: "thread.goal.updated",
    goal,
  });
}

function emitGoalCleared(
  threadId: string,
  cleared: { goalId: string; revision: number },
  turnId?: string,
): void {
  emitPayload(threadId, turnId, {
    type: "thread.goal.cleared",
    goalId: cleared.goalId,
    revision: cleared.revision,
  });
}

function resolveGoalBrokerRequest(
  workerRequestId: string,
  request: GoalBrokerRequest,
  data: unknown,
): void {
  agentProcess?.post({
    type: "broker.resolve",
    requestId: workerRequestId,
    resolution: {
      approvalId: request.approvalId,
      nonce: randomUUID(),
      approved: true,
      scope: "once",
      source: "policy",
    },
    result: data,
  });
}

async function handleGoalBrokerRequest(
  workerRequestId: string,
  request: GoalBrokerRequest,
): Promise<void> {
  if (!agentProcess || !store) return;
  const thread = store.getThread(request.threadId);
  if (
    !thread ||
    activeTurns.get(request.threadId) !== request.turnId ||
    thread.mode !== request.mode
  ) {
    rejectBrokerRequest(
      workerRequestId,
      request,
      "Goal tools require the active task turn.",
    );
    return;
  }
  if (request.kind === "goal.get") {
    const goal = store.getThreadGoal(request.threadId);
    resolveGoalBrokerRequest(workerRequestId, request, {
      goal: goal
        ? { ...goal, objective: await readGoalObjective(goal.objective) }
        : null,
      remainingTokens:
        goal?.tokenBudget === undefined
          ? null
          : Math.max(0, goal.tokenBudget - goal.tokensUsed),
    });
    return;
  }
  if (request.mode !== "execute") {
    rejectBrokerRequest(
      workerRequestId,
      request,
      "Goal mutations require Execute mode.",
    );
    return;
  }
  try {
    if (request.kind === "goal.create") {
      if (!goalCreationAuthorizations.has(request.turnId)) {
        throw new Error(
          "A Goal can be created only when the user or system explicitly requested it.",
        );
      }
      const persistedObjective = await materializeGoalObjective(
        request.objective,
      );
      let goal: ThreadGoal;
      try {
        goal = store.setThreadGoal(
          request.threadId,
          persistedObjective,
          request.tokenBudget,
        );
      } catch (error) {
        await cleanupGoalObjective(persistedObjective);
        throw error;
      }
      goalTurnContexts.set(request.turnId, {
        threadId: request.threadId,
        goalId: goal.goalId,
        mode: request.mode,
        source: "user",
        startedAt: Date.now(),
      });
      emitGoalUpdated(goal, request.turnId);
      resolveGoalBrokerRequest(workerRequestId, request, { goal });
      return;
    }
    const goal = store.getThreadGoal(request.threadId);
    if (!goal) throw new Error("This task has no active Goal.");
    if (request.status === "complete") {
      const completed = store.completeThreadGoal(request.threadId, goal.goalId);
      emitGoalUpdated(completed, request.turnId);
      resolveGoalBrokerRequest(workerRequestId, request, { goal: completed });
      return;
    }
    const blocker = request.blocker?.trim().replace(/\s+/gu, " ");
    if (!blocker) throw new Error("A blocked Goal requires a blocker.");
    const blockerTurnKey = `${request.turnId}\0${goal.goalId}`;
    if (goalBlockerRecordedTurns.has(blockerTurnKey)) {
      throw new Error("A blocker can be counted only once in each Goal turn.");
    }
    goalBlockerRecordedTurns.add(blockerTurnKey);
    const recorded = store.recordThreadGoalBlocker(
      request.threadId,
      goal.goalId,
      blocker.toLocaleLowerCase(),
    );
    emitGoalUpdated(recorded.goal, request.turnId);
    if (recorded.attempts < 3) {
      throw new Error(
        `The blocker was recorded for ${recorded.attempts}/3 consecutive Goal turns. Continue if meaningful progress is still possible.`,
      );
    }
    resolveGoalBrokerRequest(workerRequestId, request, {
      goal: recorded.goal,
    });
  } catch (error) {
    rejectBrokerRequest(
      workerRequestId,
      request,
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function handleMemoryAppendBrokerRequest(
  workerRequestId: string,
  request: Extract<BrokerExecutionRequest, { kind: "memory.append" }>,
): Promise<void> {
  if (!agentProcess || !store) return;
  if (
    request.mode !== "execute" ||
    activeTurns.get(request.threadId) !== request.turnId
  ) {
    rejectBrokerRequest(
      workerRequestId,
      request,
      "Reusable memory can be saved only by the active Execute turn.",
    );
    return;
  }
  const thread = store.getThread(request.threadId);
  if (!thread) {
    rejectBrokerRequest(workerRequestId, request, "Task project not found.");
    return;
  }
  if (thread.mode !== "execute" || thread.mode !== request.mode) {
    rejectBrokerRequest(
      workerRequestId,
      request,
      "The active task mode does not allow Memory writes.",
    );
    return;
  }
  let context: Awaited<ReturnType<typeof resolveThreadWorkspace>>;
  try {
    context = await resolveThreadWorkspace(thread);
  } catch (error) {
    rejectBrokerRequest(
      workerRequestId,
      request,
      error instanceof Error ? error.message : String(error),
    );
    return;
  }
  if (
    !conversationWorkspaceMatches(context.workspacePath, request.workspacePath)
  ) {
    rejectBrokerRequest(
      workerRequestId,
      request,
      "Memory request workspace does not match the task project.",
    );
    return;
  }

  if (!conversationMemoryScopeAllowed(thread, request.scope)) {
    rejectBrokerRequest(
      workerRequestId,
      request,
      "Temporary conversations cannot write project memory.",
    );
    return;
  }

  const projectMemoryPath = join(context.project.path, ".artemis", "MEMORY.md");
  const globalMemoryPath = join(
    app.getPath("home"),
    ".pi",
    "agent",
    "MEMORY.md",
  );
  const target =
    request.scope === "global"
      ? memoryStore(globalMemoryPath, GLOBAL_MEMORY_MAX_BYTES)
      : memoryStore(projectMemoryPath, PROJECT_MEMORY_MAX_BYTES);
  try {
    const result = await target.append({
      title: request.title,
      content: request.content,
      keywords: request.keywords,
    });
    agentProcess.post({
      type: "broker.resolve",
      requestId: workerRequestId,
      resolution: {
        approvalId: request.approvalId,
        nonce: randomUUID(),
        approved: true,
        scope: "once",
      },
      result,
    });
  } catch (error) {
    rejectBrokerRequest(
      workerRequestId,
      request,
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function handleOfficeDocumentBrokerRequest(
  workerRequestId: string,
  request: Extract<BrokerExecutionRequest, { kind: "office.document" }>,
): Promise<void> {
  if (!agentProcess || !store) return;
  if (request.mode !== "execute") {
    rejectBrokerRequest(
      workerRequestId,
      request,
      `${request.mode} mode rejects Office document operations.`,
    );
    return;
  }

  const actionKind =
    request.document.operation === "read"
      ? "read"
      : request.document.operation === "delete"
        ? "delete"
        : "write";
  const summary = `${request.document.operation} ${request.document.path}`;
  const decision = evaluateModePolicy(request.mode, {
    kind: actionKind,
    summary,
    paths: [request.document.path],
  });
  if (decision.outcome === "deny") {
    rejectBrokerRequest(workerRequestId, request, decision.reason);
    return;
  }

  const thread = store.getThread(request.threadId);
  if (!thread) {
    rejectBrokerRequest(workerRequestId, request, "Task project not found.");
    return;
  }
  if (thread.mode !== "execute") {
    rejectBrokerRequest(
      workerRequestId,
      request,
      "Office document operations require an active Execute task.",
    );
    return;
  }

  let project: Project;
  let taskWorkspace: string;
  try {
    const context = await resolveThreadWorkspace(thread);
    project = context.project;
    taskWorkspace = context.workspacePath;
  } catch (error) {
    rejectBrokerRequest(
      workerRequestId,
      request,
      error instanceof Error ? error.message : String(error),
    );
    return;
  }
  if (!conversationWorkspaceMatches(taskWorkspace, request.workspacePath)) {
    rejectBrokerRequest(
      workerRequestId,
      request,
      "Office workspace does not match the task project.",
    );
    return;
  }

  let absolutePath: string;
  try {
    absolutePath = resolveWorkspacePath(
      request.workspacePath,
      request.document.path,
    );
  } catch (error) {
    rejectBrokerRequest(
      workerRequestId,
      request,
      error instanceof Error ? error.message : String(error),
    );
    return;
  }

  const fingerprint = createApprovalFingerprint(
    `office.${request.document.operation}`,
    absolutePath,
  );
  const resolution = (
    scope: "once" | "session" | "project",
    source?: ApprovalResolution["source"],
  ) => ({
    approvalId: request.approvalId,
    nonce: randomUUID(),
    approved: true as const,
    scope,
    ...(source ? { source } : {}),
  });

  if (decision.outcome === "allow") {
    await executeApprovedOffice(
      workerRequestId,
      request,
      resolution("once"),
      false,
    );
    return;
  }

  const automationResolution = createAutomationApproval(request, {
    summary,
    paths: [request.document.path],
    risk: decision.risk,
  });
  if (automationResolution) {
    await executeApprovedOffice(
      workerRequestId,
      request,
      automationResolution,
      true,
    );
    return;
  }

  const approvalPolicy = await settingsStore?.approvalPolicy();
  const fullAccessAvailable = getPlatformContract().sandbox.available;
  const rememberedScope =
    approvalPolicy === "custom"
      ? store.findApprovalGrant({
          threadId: thread.id,
          projectId: project.id,
          operation: "office.document",
          fingerprint,
        })
      : undefined;
  if (rememberedScope) {
    await executeApprovedOffice(
      workerRequestId,
      request,
      resolution(rememberedScope, "user"),
      true,
    );
    return;
  }

  const approvalOperation = {
    kind: "workspace.write" as const,
    minimumRisk: decision.risk,
    modelApproval: request.modelApproval,
  };
  const autoApproved = shouldAutoApprove(
    approvalPolicy ?? "ask",
    approvalOperation,
    fullAccessAvailable,
  );
  if (autoApproved) {
    await executeApprovedOffice(
      workerRequestId,
      request,
      resolution("once", approvalPolicy === "agent" ? "model" : "policy"),
      true,
    );
    return;
  }

  const nonce = randomUUID();
  const allowedScopes =
    approvalPolicy === "custom"
      ? conversationApprovalScopes(thread, decision.allowedScopes)
      : ["once" as const];
  pendingApprovals.register({
    approvalId: request.approvalId,
    nonce,
    allowedScopes: [...allowedScopes],
    value: {
      workerRequestId,
      request,
      projectId: project.id,
      fingerprint,
    },
  });
  emitPayload(request.threadId, request.turnId, {
    type: "approval.requested",
    approvalId: request.approvalId,
    nonce,
    summary,
    paths: [request.document.path],
    network: [],
    risk: effectiveApprovalRisk(approvalOperation),
    allowedScopes: [...allowedScopes],
    source: modelMayAutoApprove(approvalOperation) ? "policy" : "model",
    modelRecommendation: modelMayAutoApprove(approvalOperation)
      ? "approve"
      : "deny",
    modelReason: request.modelApproval.reason,
    ...(request.actorAgentId ? { actorAgentId: request.actorAgentId } : {}),
  });
}

async function handleMcpBrokerRequest(
  workerRequestId: string,
  request: Extract<BrokerExecutionRequest, { kind: "mcp.call" }>,
): Promise<void> {
  if (!agentProcess || !store || !mcpClientManager) return;
  if (request.mode !== "execute") {
    rejectBrokerRequest(
      workerRequestId,
      request,
      `${request.mode} mode rejects MCP calls because remote side effects cannot be proven read-only.`,
    );
    return;
  }
  const thread = store.getThread(request.threadId);
  if (!thread) {
    rejectBrokerRequest(workerRequestId, request, "Task project not found.");
    return;
  }
  let context: Awaited<ReturnType<typeof resolveThreadWorkspace>>;
  try {
    context = await resolveThreadWorkspace(thread);
  } catch (error) {
    rejectBrokerRequest(
      workerRequestId,
      request,
      error instanceof Error ? error.message : String(error),
    );
    return;
  }
  if (
    !conversationWorkspaceMatches(context.workspacePath, request.workspacePath)
  ) {
    rejectBrokerRequest(
      workerRequestId,
      request,
      "MCP workspace does not match the task project.",
    );
    return;
  }
  const advertised = mcpClientManager
    .tools()
    .find(
      (tool) =>
        tool.serverId === request.serverId &&
        tool.toolName === request.toolName,
    );
  if (
    !advertised ||
    advertised.transport !== request.transport ||
    advertised.readOnly !== request.readOnly ||
    advertised.destructive !== request.destructive
  ) {
    rejectBrokerRequest(
      workerRequestId,
      request,
      "MCP tool metadata no longer matches the connected server.",
    );
    return;
  }

  const fingerprint = createApprovalFingerprint(
    "mcp.call",
    `${request.serverId}\0${request.toolName}`,
  );
  const mcpConfig = (await mcpConfigStore?.list())?.find(
    (config) => config.id === request.serverId,
  );
  const googleEmail = mcpConfig?.hostAuth
    ? (await googleAccountService?.status())?.email
    : undefined;
  const stdioFullAccess =
    mcpConfig?.transport === "stdio" && Boolean(mcpConfig.fullAccess);
  const stdioAllowsNetwork =
    stdioFullAccess ||
    (mcpConfig?.transport === "stdio" && mcpConfig.allowNetwork);
  const argumentSummary = JSON.stringify(request.arguments, (key, value) =>
    /token|secret|password|authorization/iu.test(key)
      ? "[REDACTED]"
      : typeof value === "string" && value.length > 160
        ? `${value.slice(0, 160)}…`
        : value,
  ).slice(0, 700);
  const approvalSummary = [
    `Call ${request.serverName}: ${request.toolName}`,
    googleEmail ? `Google account: ${googleEmail}` : undefined,
    request.destructive && argumentSummary
      ? `Target/change: ${argumentSummary}`
      : undefined,
  ]
    .filter(Boolean)
    .join("\n");
  const networkTargets = mcpConfig?.hostAuth
    ? ["Google APIs"]
    : request.transport === "streamable-http"
      ? [request.serverName]
      : stdioAllowsNetwork
        ? [request.serverName]
        : [];
  const automationResolution = createAutomationApproval(request, {
    summary: approvalSummary,
    network: networkTargets,
    risk: request.destructive || stdioFullAccess ? "high" : "medium",
  });
  if (automationResolution && !request.destructive && !stdioFullAccess) {
    await executeApprovedMcp(workerRequestId, request, automationResolution);
    return;
  }
  const approvalPolicy = await settingsStore?.approvalPolicy();
  const fullAccessAvailable = getPlatformContract().sandbox.available;
  const rememberedScope =
    !request.destructive &&
    !stdioFullAccess &&
    (approvalPolicy === "agent" || approvalPolicy === "custom")
      ? store.findApprovalGrant({
          threadId: thread.id,
          projectId: approvalProjectId(thread),
          operation: "mcp.call",
          fingerprint,
        })
      : undefined;
  const resolution = (scope: "once" | "session" | "project") => ({
    approvalId: request.approvalId,
    nonce: randomUUID(),
    approved: true as const,
    scope,
  });
  if (rememberedScope) {
    await executeApprovedMcp(
      workerRequestId,
      request,
      resolution(rememberedScope),
    );
    return;
  }
  const approvalOperation = {
    kind: "mcp.call" as const,
    readOnly: request.readOnly,
    destructive: request.destructive,
    network: request.transport === "streamable-http" || stdioAllowsNetwork,
    fullAccess: stdioFullAccess,
    toolName: request.toolName,
    modelApproval: request.modelApproval,
    ...(mcpConfig?.hostAuth ? { googleGrant: mcpConfig.hostAuth.grant } : {}),
  };
  if (
    shouldAutoApprove(
      approvalPolicy ?? "ask",
      approvalOperation,
      fullAccessAvailable,
    )
  ) {
    await executeApprovedMcp(workerRequestId, request, resolution("once"));
    return;
  }

  const nonce = randomUUID();
  const allowedScopes = conversationApprovalScopes(
    thread,
    request.destructive || stdioFullAccess
      ? ["once"]
      : ["once", "session", "project"],
  );
  pendingApprovals.register({
    approvalId: request.approvalId,
    nonce,
    allowedScopes: [...allowedScopes],
    value: {
      workerRequestId,
      request,
      projectId: approvalProjectId(thread),
      fingerprint,
    },
  });
  emitPayload(request.threadId, request.turnId, {
    type: "approval.requested",
    approvalId: request.approvalId,
    nonce,
    summary: approvalSummary,
    paths: [],
    network: networkTargets,
    risk: effectiveApprovalRisk(approvalOperation),
    allowedScopes: [...allowedScopes],
    source: modelMayAutoApprove(approvalOperation) ? "policy" : "model",
    modelRecommendation: modelMayAutoApprove(approvalOperation)
      ? "approve"
      : "deny",
    modelReason: request.modelApproval.reason,
  });
}

async function handleExtensionBrokerRequest(
  workerRequestId: string,
  request: Extract<BrokerExecutionRequest, { kind: "extension.call" }>,
): Promise<void> {
  if (!agentProcess || !store || !trustedExtensionManager) return;
  if (request.mode !== "execute") {
    rejectBrokerRequest(
      workerRequestId,
      request,
      `${request.mode} mode rejects executable extensions.`,
    );
    return;
  }
  const thread = store.getThread(request.threadId);
  if (!thread) {
    rejectBrokerRequest(workerRequestId, request, "Task project not found.");
    return;
  }
  const context = await resolveThreadWorkspace(thread);
  if (
    !conversationWorkspaceMatches(context.workspacePath, request.workspacePath)
  ) {
    rejectBrokerRequest(
      workerRequestId,
      request,
      "Extension workspace does not match the task project.",
    );
    return;
  }
  const status = trustedExtensionManager
    .status()
    .find((candidate) => candidate.config.id === request.extensionId);
  const advertised = status?.tools.find(
    (tool) => tool.toolName === request.toolName,
  );
  if (
    status?.state !== "ready" ||
    !advertised ||
    advertised.extensionName !== request.extensionName
  ) {
    rejectBrokerRequest(
      workerRequestId,
      request,
      "Trusted extension metadata no longer matches the approved file.",
    );
    return;
  }

  const fingerprint = createApprovalFingerprint(
    "extension.call",
    `${request.extensionId}\0${request.toolName}`,
  );
  const automationResolution = createAutomationApproval(request, {
    summary: `Run ${request.extensionName}: ${request.toolName}`,
    network: status.config.allowNetwork ? [request.extensionName] : [],
    risk: status.config.allowNetwork ? "high" : "medium",
  });
  if (automationResolution) {
    await executeApprovedExtension(
      workerRequestId,
      request,
      automationResolution,
    );
    return;
  }
  const approvalPolicy = await settingsStore?.approvalPolicy();
  const fullAccessAvailable = getPlatformContract().sandbox.available;
  const rememberedScope =
    approvalPolicy === "custom"
      ? store.findApprovalGrant({
          threadId: thread.id,
          projectId: approvalProjectId(thread),
          operation: "extension.call",
          fingerprint,
        })
      : undefined;
  const resolution = (
    scope: "once" | "session" | "project",
    source?: ApprovalResolution["source"],
  ) => ({
    approvalId: request.approvalId,
    nonce: randomUUID(),
    approved: true as const,
    scope,
    ...(source ? { source } : {}),
  });
  if (rememberedScope) {
    await executeApprovedExtension(
      workerRequestId,
      request,
      resolution(rememberedScope, "user"),
    );
    return;
  }
  const approvalOperation = {
    kind: "extension.call" as const,
    allowNetwork: status.config.allowNetwork,
    modelApproval: request.modelApproval,
  };
  if (
    shouldAutoApprove(
      approvalPolicy ?? "ask",
      approvalOperation,
      fullAccessAvailable,
    )
  ) {
    await executeApprovedExtension(
      workerRequestId,
      request,
      resolution("once", approvalPolicy === "agent" ? "model" : "policy"),
    );
    return;
  }

  const nonce = randomUUID();
  const allowedScopes =
    approvalPolicy === "custom"
      ? conversationApprovalScopes(thread, ["once", "session", "project"])
      : (["once"] as const);
  pendingApprovals.register({
    approvalId: request.approvalId,
    nonce,
    allowedScopes: [...allowedScopes],
    value: {
      workerRequestId,
      request,
      projectId: approvalProjectId(thread),
      fingerprint,
    },
  });
  emitPayload(request.threadId, request.turnId, {
    type: "approval.requested",
    approvalId: request.approvalId,
    nonce,
    summary: `Run trusted extension ${request.extensionName}: ${request.toolName}`,
    paths: [request.workspacePath],
    network: status.config.allowNetwork ? [request.extensionName] : [],
    risk: effectiveApprovalRisk(approvalOperation),
    allowedScopes: [...allowedScopes],
    source: modelMayAutoApprove(approvalOperation) ? "policy" : "model",
    modelRecommendation: modelMayAutoApprove(approvalOperation)
      ? "approve"
      : "deny",
    modelReason: request.modelApproval.reason,
    ...(request.actorAgentId ? { actorAgentId: request.actorAgentId } : {}),
  });
}

function rejectBrokerRequest(
  workerRequestId: string,
  request: BrokerExecutionRequest,
  error: string,
): void {
  agentProcess?.post({
    type: "broker.resolve",
    requestId: workerRequestId,
    resolution: {
      approvalId: request.approvalId,
      nonce: randomUUID(),
      approved: false,
      scope: "once",
    },
    error,
  });
}

async function executeApprovedWrite(
  workerRequestId: string,
  request: Extract<BrokerExecutionRequest, { kind: "workspace.write" }>,
  resolution: ApprovalResolution,
): Promise<void> {
  if (!agentProcess) {
    return;
  }
  emitPayload(request.threadId, request.turnId, {
    type: "approval.resolved",
    approvalId: resolution.approvalId,
    nonce: resolution.nonce,
    approved: true,
    scope: resolution.scope,
    ...(resolution.source ? { source: resolution.source } : {}),
  });
  try {
    const path = resolveWorkspacePath(
      request.workspacePath,
      request.relativePath,
    );
    let operation: "create" | "update" = "create";
    try {
      await stat(path);
      operation = "update";
    } catch {
      // A missing target is a create operation.
    }
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, request.content, "utf8");
    emitPayload(request.threadId, request.turnId, {
      type: "file.changed",
      path: request.relativePath,
      operation,
    });
    agentProcess.post({
      type: "broker.resolve",
      requestId: workerRequestId,
      resolution,
      result: { path: request.relativePath, operation },
    });
  } catch (error) {
    agentProcess.post({
      type: "broker.resolve",
      requestId: workerRequestId,
      resolution: { ...resolution, approved: false },
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function executeApprovedOffice(
  workerRequestId: string,
  request: Extract<BrokerExecutionRequest, { kind: "office.document" }>,
  resolution: ApprovalResolution,
  emitApprovalResolution: boolean,
): Promise<void> {
  if (!agentProcess) return;
  if (emitApprovalResolution) {
    emitPayload(request.threadId, request.turnId, {
      type: "approval.resolved",
      approvalId: resolution.approvalId,
      nonce: resolution.nonce,
      approved: true,
      scope: resolution.scope,
      ...(resolution.source ? { source: resolution.source } : {}),
    });
  }
  try {
    const documentResult = await new OfficeDocumentService(
      request.workspacePath,
    ).execute(request.document);
    if (documentResult.changed) {
      const operation =
        request.document.operation === "create"
          ? "create"
          : request.document.operation === "delete"
            ? "delete"
            : "update";
      emitPayload(request.threadId, request.turnId, {
        type: "file.changed",
        path: request.document.path,
        operation,
      });
    }
    agentProcess.post({
      type: "broker.resolve",
      requestId: workerRequestId,
      resolution,
      result: documentResult,
    });
  } catch (error) {
    agentProcess.post({
      type: "broker.resolve",
      requestId: workerRequestId,
      resolution: { ...resolution, approved: false },
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function executeApprovedMcp(
  workerRequestId: string,
  request: Extract<BrokerExecutionRequest, { kind: "mcp.call" }>,
  resolution: ApprovalResolution,
): Promise<void> {
  if (!agentProcess || !mcpClientManager) return;
  emitPayload(request.threadId, request.turnId, {
    type: "approval.resolved",
    approvalId: resolution.approvalId,
    nonce: resolution.nonce,
    approved: true,
    scope: resolution.scope,
    ...(resolution.source ? { source: resolution.source } : {}),
  });
  try {
    if (request.mode !== "execute") {
      throw new Error(`${request.mode} mode rejects MCP calls.`);
    }
    const config = (await mcpConfigStore?.list())?.find(
      (candidate) => candidate.id === request.serverId,
    );
    let privateMetadata: Record<string, unknown> | undefined;
    if (config?.hostAuth) {
      if (!googleAccountService || !codexPluginService) {
        throw new Error("Google account service is not ready.");
      }
      await codexPluginService.assertHostAuthTrusted(config);
      const google = await googleAccountService.accessContext(
        config.hostAuth.grant,
        config.hostAuth.scopes,
      );
      privateMetadata = {
        "com.artemis.google/access-token": google.accessToken,
        "com.artemis.google/account-email": google.email,
      };
    }
    const result = await mcpClientManager.call(
      request.serverId,
      request.toolName,
      request.arguments,
      request.workspacePath,
      request.mode,
      privateMetadata,
    );
    agentProcess.post({
      type: "broker.resolve",
      requestId: workerRequestId,
      resolution,
      result,
    });
  } catch (error) {
    agentProcess.post({
      type: "broker.resolve",
      requestId: workerRequestId,
      resolution: { ...resolution, approved: false },
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function executeApprovedExtension(
  workerRequestId: string,
  request: Extract<BrokerExecutionRequest, { kind: "extension.call" }>,
  resolution: ApprovalResolution,
): Promise<void> {
  if (!agentProcess || !trustedExtensionManager) return;
  emitPayload(request.threadId, request.turnId, {
    type: "approval.resolved",
    approvalId: resolution.approvalId,
    nonce: resolution.nonce,
    approved: true,
    scope: resolution.scope,
    ...(resolution.source ? { source: resolution.source } : {}),
  });
  try {
    const result = await trustedExtensionManager.call(
      request.extensionId,
      request.toolName,
      request.arguments,
      request.workspacePath,
      request.mode,
      await settingsStore?.localFullAccess(),
    );
    agentProcess.post({
      type: "broker.resolve",
      requestId: workerRequestId,
      resolution,
      result,
    });
  } catch (error) {
    agentProcess.post({
      type: "broker.resolve",
      requestId: workerRequestId,
      resolution: { ...resolution, approved: false },
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function resolveApproval(resolution: ApprovalResolution): Promise<void> {
  if (!agentProcess || !store) {
    throw new Error("Application is not ready.");
  }
  const pending = pendingApprovals.consume(resolution);
  if (!resolution.approved) {
    emitPayload(pending.request.threadId, pending.request.turnId, {
      type: "approval.resolved",
      approvalId: resolution.approvalId,
      nonce: resolution.nonce,
      approved: false,
      scope: resolution.scope,
    });
    agentProcess.post({
      type: "broker.resolve",
      requestId: pending.workerRequestId,
      resolution,
      error: "The user denied this operation.",
    });
    return;
  }
  if (resolution.scope !== "once") {
    store.saveApprovalGrant({
      scope: resolution.scope,
      subjectId:
        resolution.scope === "session"
          ? pending.request.threadId
          : pending.projectId,
      operation: pending.request.kind,
      fingerprint: pending.fingerprint,
      createdAt: new Date().toISOString(),
    });
  }
  if (pending.request.kind === "shell.execute") {
    await executeApprovedShell(
      pending.workerRequestId,
      pending.request,
      resolution,
    );
  } else if (
    pending.request.kind === "local.file.read" ||
    pending.request.kind === "local.file.write"
  ) {
    await executeApprovedLocalFile(
      pending.workerRequestId,
      pending.request,
      resolution,
    );
  } else if (pending.request.kind === "workspace.write") {
    await executeApprovedWrite(
      pending.workerRequestId,
      pending.request,
      resolution,
    );
  } else if (pending.request.kind === "office.document") {
    await executeApprovedOffice(
      pending.workerRequestId,
      pending.request,
      resolution,
      true,
    );
  } else if (pending.request.kind === "mcp.call") {
    await executeApprovedMcp(
      pending.workerRequestId,
      pending.request,
      resolution,
    );
  } else if (pending.request.kind === "extension.call") {
    await executeApprovedExtension(
      pending.workerRequestId,
      pending.request,
      resolution,
    );
  }
}

async function createTaskThread(
  input: CreateThreadInput,
  title?: string,
): Promise<Thread | undefined> {
  if (!store) {
    throw new Error("Application store is not ready.");
  }
  const command = parseThreadCommand({
    type: "thread.create",
    ...input,
  });
  assertConversationTarget(command.projectId, command.target);
  const project = command.projectId
    ? store.getProject(command.projectId)
    : undefined;
  if (command.projectId && !project) {
    throw new Error(`Project not found: ${command.projectId}`);
  }
  const defaults = await settingsStore?.runtimeConfiguration();
  const now = new Date().toISOString();
  const thread: Thread = {
    id: randomUUID(),
    ...(command.projectId ? { projectId: command.projectId } : {}),
    title: title ?? mainText(currentLocale(), "waitingForTask"),
    mode: command.mode,
    target: command.target,
    status: "idle",
    ...(defaults?.selection
      ? { modelSelection: structuredClone(defaults.selection) }
      : {}),
    ...(defaults?.contextWindow
      ? { contextWindow: defaults.contextWindow }
      : {}),
    pinned: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
  if (command.target === "local") {
    if (!command.projectId) {
      await ensureTemporaryConversationWorkspace(
        app.getPath("userData"),
        thread.id,
      );
      try {
        return store.createThread(thread);
      } catch (error) {
        await removeTemporaryConversationWorkspace(
          app.getPath("userData"),
          thread.id,
        );
        throw error;
      }
    }
    return store.createThread(thread);
  }

  if (!project) throw new Error("Project not found.");

  let worktree: TaskWorktree;
  if (command.target === "permanent-worktree") {
    if (!mainWindow) {
      throw new Error("Application window is not ready.");
    }
    const selection = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
      title: mainText(currentLocale(), "selectPermanentWorktree"),
    });
    const selectedPath = selection.filePaths[0];
    if (selection.canceled || !selectedPath) {
      return undefined;
    }
    worktree = await createPermanentTaskWorktree(
      project,
      thread.id,
      selectedPath,
    );
    return store.createThreadWithWorktree(thread, worktree).thread;
  }

  worktree = await createManagedTaskWorktree(project, thread.id);
  try {
    return store.createThreadWithWorktree(thread, worktree).thread;
  } catch (error) {
    try {
      await removeManagedWorktree({
        repositoryPath: project.path,
        managedRoot: managedWorktreeRoot(project.id),
        worktreePath: worktree.path,
        recoveryRoot: worktreeRecoveryRoot(project.id),
        force: false,
      });
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Task creation failed and its clean worktree could not be removed.",
      );
    }
    throw error;
  }
}

async function startTaskTurn(
  input: StartTurnInput,
  options: {
    source?: "user" | "goal-continuation";
    expectedGoalId?: string;
  } = {},
): Promise<StartTurnResult> {
  const mainReceivedAt = Date.now();
  const source = options.source ?? "user";
  if (agentHostRestart) await agentHostRestart;
  if (!store || !agentProcess) {
    throw new Error("Agent process is not ready.");
  }
  let thread = store.getThread(input.threadId);
  if (!thread) {
    throw new Error(`Thread not found: ${input.threadId}`);
  }
  if (thread.archived) {
    throw new Error("Archived tasks cannot start a turn.");
  }
  if (thread.status === "running" || thread.status === "waiting-approval") {
    throw new Error("Task already has an active turn.");
  }
  if (compactingThreads.has(thread.id)) {
    throw new Error("Wait for context compaction to finish.");
  }
  if (
    source === "goal-continuation" &&
    (thread.goal?.status !== "active" ||
      thread.goal.goalId !== options.expectedGoalId)
  ) {
    throw new Error("The Goal changed before its continuation could start.");
  }
  const text = input.text.trim();
  const attachments = promptAttachmentsSchema.parse(input.attachments ?? []);
  if (!text && attachments.length === 0) {
    throw new Error("Prompt cannot be empty.");
  }
  const requestText =
    text || `Inspect the attached file${attachments.length === 1 ? "" : "s"}.`;
  if (source === "user" && isAutomaticTaskTitle(thread.title)) {
    thread = store.updateThread(thread.id, {
      title: deriveTaskTitle(text, currentLocale()),
    });
  }
  const turnId = randomUUID();
  const now = Date.now();
  const traceSelection = thread.modelSelection ?? activeRuntimeSelection;
  const trace: TurnLatencyTrace = {
    turnId,
    mainReceivedAt,
    ...(typeof input.submittedAt === "number" &&
    Number.isFinite(input.submittedAt) &&
    Math.abs(mainReceivedAt - input.submittedAt) < 5 * 60_000
      ? { submittedAt: input.submittedAt }
      : {}),
    coldThread: !openedThreads.has(thread.id),
    mode: input.mode,
    ...(traceSelection
      ? {
          providerId: traceSelection.providerId,
          modelId: traceSelection.modelId,
          thinkingLevel: traceSelection.thinkingLevel,
        }
      : {}),
    enabledMcpServers: enabledMcpServerCount,
    toolCount: runtimeToolCount,
    mcpToolCount: runtimeMcpToolCount,
    optionalStartedAt: now,
    workspaceStartedAt: now,
    queueDepth: 0,
    eventCount: 0,
  };
  turnLatencyTraces.set(turnId, trace);
  void optionalCapabilitiesReady.then(() => {
    trace.optionalReadyAt ??= Date.now();
  });

  let context: Awaited<ReturnType<typeof resolveThreadWorkspace>>;
  try {
    context = await resolveThreadWorkspace(thread);
    trace.workspaceEndedAt = Date.now();
  } catch (error) {
    trace.workspaceEndedAt = Date.now();
    trace.completedAt = Date.now();
    trace.outcome = "failed";
    finalizeTurnLatency(trace);
    throw error;
  }
  await turnChangeSetCompletionTails.get(thread.id);
  if (input.mode === "execute" && !context.temporary && turnChangeSetService) {
    try {
      await turnChangeSetService.begin({
        threadId: thread.id,
        turnId,
        workspacePath: context.workspacePath,
      });
    } catch (error) {
      diagnosticBundleService?.record({
        source: "main",
        severity: "warning",
        message: `Turn checkpoint was unavailable for ${turnId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
  }
  trace.threadOpenStartedAt = Date.now();
  trace.memoryStartedAt = trace.threadOpenStartedAt;
  const openPromise = openAgentThread(thread, context.workspacePath).then(
    () => {
      trace.threadOpenEndedAt = Date.now();
    },
  );
  const memoryPromise = (async (): Promise<string | undefined> => {
    try {
      const projectMemoryPromise = context.temporary
        ? Promise.resolve({ content: "" })
        : memoryStore(
            join(context.project.path, ".artemis", "MEMORY.md"),
            PROJECT_MEMORY_MAX_BYTES,
          ).snapshot();
      const globalMemoryPath = join(
        app.getPath("home"),
        ".pi",
        "agent",
        "MEMORY.md",
      );
      const [projectMemory, globalMemory] = await Promise.all([
        projectMemoryPromise,
        memoryStore(globalMemoryPath, GLOBAL_MEMORY_MAX_BYTES).snapshot(),
      ]);
      return (
        recallMemoryForTurn({
          prompt: requestText,
          projectMemory: projectMemory.content,
          globalMemory: globalMemory.content,
          limits: {
            maxEntries: 3,
            maxCharacters: 3_500,
            globalMaxEntries: 1,
            globalMaxCharacters: 900,
          },
        }).context || undefined
      );
    } catch (error) {
      console.warn(
        `Memory recall skipped: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    } finally {
      trace.memoryEndedAt = Date.now();
    }
  })();
  let memoryContext: string | undefined;
  try {
    [, memoryContext] = await Promise.all([openPromise, memoryPromise]);
  } catch (error) {
    trace.completedAt = Date.now();
    trace.outcome = "failed";
    finalizeTurnLatency(trace);
    throw error;
  }

  try {
    await emitInitialTurn(
      thread.id,
      turnId,
      requestText,
      input.mode,
      attachments,
      source === "user",
    );
  } catch (error) {
    trace.completedAt = Date.now();
    trace.outcome = "failed";
    finalizeTurnLatency(trace);
    throw error;
  }
  activeTurns.set(thread.id, turnId);
  if (
    source === "user" &&
    /(?:\b(?:create|set|start)\b[^\n]{0,80}\bgoal\b|\bgoal\b[^\n]{0,80}\b(?:create|set|start)\b|(?:创建|设置|开始|建立).{0,40}(?:目标|Goal))/iu.test(
      requestText,
    )
  ) {
    goalCreationAuthorizations.add(turnId);
  }
  if (thread.goal?.status === "active" && input.mode === "execute") {
    goalTurnContexts.set(turnId, {
      threadId: thread.id,
      goalId: thread.goal.goalId,
      mode: input.mode,
      source,
      startedAt: Date.now(),
    });
  }

  trace.hostDispatchedAt = Date.now();
  void agentProcess
    .request({
      type: "turn.prompt",
      requestId: randomUUID(),
      threadId: thread.id,
      turnId,
      text: requestText,
      mode: input.mode,
      ...(attachments.length > 0 ? { attachments } : {}),
      ...(thread.goal ? { goal: thread.goal } : {}),
      ...(memoryContext ? { memoryContext } : {}),
    })
    .catch((error) => {
      if (interruptedAgentHostTurns.delete(turnId)) return;
      emitPayload(thread.id, turnId, {
        type: "turn.failed",
        message: error instanceof Error ? error.message : String(error),
      });
    })
    .finally(() => {
      if (activeTurns.get(thread.id) === turnId) {
        activeTurns.delete(thread.id);
      }
    });
  return { turnId, thread: store.getThread(thread.id) ?? thread };
}

async function queueTurn(
  type: "turn.steer" | "turn.follow-up",
  input: QueueTurnInput,
): Promise<void> {
  if (!store || !agentProcess) {
    throw new Error("Agent process is not ready.");
  }
  const command = parseThreadCommand({ type, ...input });
  const thread = store.getThread(command.threadId);
  if (
    !thread ||
    (thread.status !== "running" && thread.status !== "waiting-approval")
  ) {
    throw new Error("Task has no active turn.");
  }
  const turnId = activeTurns.get(thread.id);
  if (!turnId || !openedThreads.has(thread.id)) {
    throw new Error("Active Pi turn is not available.");
  }

  const recoverableId = recoverableTurnQueues.add(
    thread.id,
    type === "turn.steer" ? "steering" : "followUp",
    command.text,
    command.attachments,
    appendPromptFiles(command.text, command.attachments),
  );
  try {
    await agentProcess.request({
      type,
      requestId: randomUUID(),
      threadId: thread.id,
      text: command.text,
      ...(command.attachments?.length
        ? { attachments: command.attachments }
        : {}),
    });
  } catch (error) {
    recoverableTurnQueues.remove(thread.id, recoverableId);
    throw error;
  }
  for (const attachment of command.attachments ?? []) {
    emitPayload(thread.id, turnId, {
      type: "task.source.added",
      sourceId: randomUUID(),
      name: attachment.name,
      mimeType: attachment.mimeType,
      kind: "type" in attachment ? "file" : "image",
    });
  }
}

async function controlTurnQueue(
  type: "turn.queue.clear" | "turn.queue.steer",
  threadId: string,
): Promise<{ steering: string[]; followUp: string[] } | undefined> {
  if (!store || !agentProcess) {
    throw new Error("Agent process is not ready.");
  }
  const command = parseThreadCommand({ type, threadId });
  const thread = store.getThread(command.threadId);
  if (
    !thread ||
    (thread.status !== "running" && thread.status !== "waiting-approval") ||
    !activeTurns.has(thread.id) ||
    !openedThreads.has(thread.id)
  ) {
    throw new Error("Task has no active turn.");
  }

  const result = await agentProcess.request<{
    steering: string[];
    followUp: string[];
  }>({
    type,
    requestId: randomUUID(),
    threadId: thread.id,
  });
  if (type === "turn.queue.clear") {
    recoverableTurnQueues.discard(thread.id);
  }
  return result;
}

async function replaceTurnQueue(input: ReplaceQueuedTurnInput): Promise<void> {
  if (!store || !agentProcess) {
    throw new Error("Agent process is not ready.");
  }
  const command = parseThreadCommand({ type: "turn.queue.replace", ...input });
  const thread = store.getThread(command.threadId);
  if (
    !thread ||
    (thread.status !== "running" && thread.status !== "waiting-approval") ||
    !activeTurns.has(thread.id) ||
    !openedThreads.has(thread.id)
  ) {
    throw new Error("Task has no active turn.");
  }

  const rollback = recoverableTurnQueues.replaceFollowUp(
    thread.id,
    command.expectedFollowUp,
    command.followUp,
    appendPromptFiles,
  );
  try {
    await agentProcess.request({
      type: "turn.queue.replace",
      requestId: randomUUID(),
      threadId: thread.id,
      expectedFollowUp: rollback.runtimeExpectedFollowUp,
      followUp: rollback.runtimeFollowUp,
    });
  } catch (error) {
    recoverableTurnQueues.rollbackFollowUp(rollback);
    throw error;
  }
}

async function steerQueuedTurn(input: SteerQueuedTurnInput): Promise<void> {
  if (!store || !agentProcess) {
    throw new Error("Agent process is not ready.");
  }
  const command = parseThreadCommand({
    type: "turn.queue.steer-item",
    ...input,
  });
  const thread = store.getThread(command.threadId);
  if (
    !thread ||
    (thread.status !== "running" && thread.status !== "waiting-approval") ||
    !activeTurns.has(thread.id) ||
    !openedThreads.has(thread.id)
  ) {
    throw new Error("Task has no active turn.");
  }

  await agentProcess.request({
    type: "turn.queue.steer-item",
    requestId: randomUUID(),
    threadId: thread.id,
    followUpIndex: command.followUpIndex,
    expectedFollowUp: recoverableTurnQueues.runtimeFollowUpSnapshot(
      thread.id,
      command.expectedFollowUp,
    ),
  });
}

function automationUpserted(automation: Automation): void {
  publishAutomationEvent({
    protocolVersion: PROTOCOL_VERSION,
    eventId: randomUUID(),
    timestamp: new Date().toISOString(),
    payload: { type: "automation.upserted", automation },
  });
}

function automationDeleted(automationId: string): void {
  publishAutomationEvent({
    protocolVersion: PROTOCOL_VERSION,
    eventId: randomUUID(),
    timestamp: new Date().toISOString(),
    payload: { type: "automation.deleted", automationId },
  });
}

function scheduledNextRun(
  automation: Pick<Automation, "schedule" | "enabled">,
  now: string,
): string | undefined {
  if (!automation.enabled) return undefined;
  const next = nextAutomationOccurrence(automation.schedule, now);
  if (!next) {
    throw new Error("The enabled automation has no future occurrence.");
  }
  return next;
}

async function saveAutomation(input: SaveAutomationInput): Promise<Automation> {
  if (!store) throw new Error("Application store is not ready.");
  const project = store.getProject(input.projectId);
  if (!project) throw new Error(`Project not found: ${input.projectId}`);
  const current = input.id ? store.getAutomation(input.id) : undefined;
  if (input.id && !current)
    throw new Error(`Automation not found: ${input.id}`);
  if (current && current.projectId !== input.projectId) {
    throw new Error("An automation cannot move to another project.");
  }

  const now = new Date().toISOString();
  const schedule = automationScheduleSchema.parse(input.schedule);
  validateAutomationSchedule(schedule);
  const mode = runModeSchema.parse(input.mode);
  const target = automationTargetSchema.parse(input.target);
  const draft = {
    projectId: input.projectId,
    prompt: input.prompt.trim(),
    mode,
    target,
    schedule,
  };
  const fingerprint = automationAuthorizationFingerprint(draft);
  const authorizationRemainsValid =
    current?.authorizationState === "authorized" &&
    current.authorizationFingerprint === fingerprint;
  const requiresAuthorization = mode === "execute";
  const enabled =
    input.enabled && (!requiresAuthorization || authorizationRemainsValid);
  const nextRunAt = scheduledNextRun({ schedule, enabled }, now);
  const value = automationSchema.parse({
    id: current?.id ?? randomUUID(),
    projectId: input.projectId,
    name: input.name.trim(),
    prompt: draft.prompt,
    mode,
    target,
    schedule,
    enabled,
    authorizationState: requiresAuthorization
      ? authorizationRemainsValid
        ? "authorized"
        : "required"
      : "not-required",
    ...(authorizationRemainsValid
      ? {
          authorizationFingerprint: current?.authorizationFingerprint,
          authorizedAt: current?.authorizedAt,
        }
      : {}),
    ...(nextRunAt ? { nextRunAt } : {}),
    ...(current?.lastRunAt ? { lastRunAt: current.lastRunAt } : {}),
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
  });
  const saved = current
    ? store.updateAutomation(value)
    : store.createAutomation(value);
  automationUpserted(saved);
  await automationScheduler?.refresh();
  return saved;
}

async function setAutomationEnabled(
  id: string,
  enabled: boolean,
): Promise<Automation> {
  if (!store) throw new Error("Application store is not ready.");
  const current = store.getAutomation(id);
  if (!current || current.deletedAt) {
    throw new Error("Automation was not found.");
  }
  if (
    enabled &&
    current.mode === "execute" &&
    (current.authorizationState !== "authorized" ||
      current.authorizationFingerprint !==
        automationAuthorizationFingerprint(current))
  ) {
    throw new Error("Authorize this Execute automation before enabling it.");
  }
  const now = new Date().toISOString();
  const nextRunAt = scheduledNextRun(
    { schedule: current.schedule, enabled },
    now,
  );
  const updated = store.updateAutomation(
    automationSchema.parse({
      ...current,
      enabled,
      ...(nextRunAt ? { nextRunAt } : { nextRunAt: undefined }),
      updatedAt: now,
    }),
  );
  automationUpserted(updated);
  await automationScheduler?.refresh();
  return updated;
}

async function authorizeAutomation(
  id: string,
): Promise<Automation | undefined> {
  if (!store || !mainWindow) {
    throw new Error("Application window is not ready.");
  }
  const current = store.getAutomation(id);
  if (!current || current.deletedAt) {
    throw new Error("Automation was not found.");
  }
  if (current.mode !== "execute") {
    return setAutomationEnabled(id, true);
  }
  const result = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    title: mainText(currentLocale(), "authorizeAutomation"),
    message: mainText(currentLocale(), "automationWillRun", {
      name: current.name,
    }),
    detail: mainText(currentLocale(), "automationAuthorizationDetail"),
    buttons: [
      I18N_RESOURCES[currentLocale()].common.cancel,
      mainText(currentLocale(), "authorizeAndEnable"),
    ],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  if (result.response !== 1) return undefined;

  const now = new Date().toISOString();
  const updated = store.updateAutomation(
    automationSchema.parse({
      ...current,
      enabled: true,
      authorizationState: "authorized",
      authorizationFingerprint: automationAuthorizationFingerprint(current),
      authorizedAt: now,
      nextRunAt: scheduledNextRun(
        { schedule: current.schedule, enabled: true },
        now,
      ),
      updatedAt: now,
    }),
  );
  automationUpserted(updated);
  await automationScheduler?.refresh();
  return updated;
}

function automationRunNotification(
  automation: Automation,
  run: AutomationRun,
): void {
  if (!Notification.isSupported()) return;
  const title =
    run.state === "completed"
      ? mainText(currentLocale(), "automationCompleted")
      : mainText(currentLocale(), "automationNeedsAttention");
  const notification = new Notification({
    title,
    body: `${automation.name}: ${run.reason ?? run.state}`,
  });
  notification.on("click", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    if (run.threadId) {
      mainWindow.webContents.send(IPC.automationThreadOpen, run.threadId);
    }
  });
  notification.show();
}

async function cancelTaskTurn(threadId: string): Promise<void> {
  if (!agentProcess || !store) {
    throw new Error("Application is not ready.");
  }
  const command = parseThreadCommand({ type: "turn.cancel", threadId });
  const thread = store.getThread(command.threadId);
  const turnId = activeTurns.get(command.threadId);
  if (
    !thread ||
    (thread.status !== "running" && thread.status !== "waiting-approval") ||
    !turnId
  ) {
    throw new Error("Task has no active turn.");
  }
  const cancelledApprovals = pendingApprovals.cancelWhere(
    (pending) => pending.request.threadId === thread.id,
  );
  cancellingTurns.add(thread.id);
  for (const cancelled of cancelledApprovals) {
    emitPayload(
      cancelled.value.request.threadId,
      cancelled.value.request.turnId,
      {
        type: "approval.resolved",
        approvalId: cancelled.approvalId,
        nonce: cancelled.nonce,
        approved: false,
        scope: "once",
      },
    );
    agentProcess.post({
      type: "broker.resolve",
      requestId: cancelled.value.workerRequestId,
      resolution: {
        approvalId: cancelled.approvalId,
        nonce: cancelled.nonce,
        approved: false,
        scope: "once",
      },
      error: "The turn was cancelled.",
    });
  }
  const cancelledUserInputs = pendingUserInputs.cancelWhere(
    (pending) => pending.request.threadId === thread.id,
  );
  for (const cancelled of cancelledUserInputs) {
    if (cancelled.value.timeout !== undefined) {
      clearTimeout(cancelled.value.timeout);
    }
    emitPayload(
      cancelled.value.request.threadId,
      cancelled.value.request.turnId,
      {
        type: "user-input.resolved",
        requestId: cancelled.requestId,
        nonce: cancelled.nonce,
        answer: "",
        source: "cancelled",
      },
    );
    agentProcess.post({
      type: "broker.resolve",
      requestId: cancelled.value.workerRequestId,
      resolution: {
        approvalId: cancelled.requestId,
        nonce: cancelled.nonce,
        approved: false,
        scope: "once",
        source: "user",
      },
      error: "The turn was cancelled.",
    });
  }
  const cancelledMultiUserInputs = pendingMultiUserInputs.cancelWhere(
    (pending) => pending.request.threadId === thread.id,
  );
  for (const cancelled of cancelledMultiUserInputs) {
    for (const timeout of cancelled.value.timeouts.values()) {
      clearTimeout(timeout);
    }
    // Kind-less cancelled resolution: the reducer's translation layer closes
    // every still-pending question; the agent-host must not hang waiting.
    emitPayload(
      cancelled.value.request.threadId,
      cancelled.value.request.turnId,
      {
        type: "user-input.resolved",
        requestId: cancelled.requestId,
        nonce: cancelled.nonce,
        answer: "",
        source: "cancelled",
      },
    );
    agentProcess.post({
      type: "broker.resolve",
      requestId: cancelled.value.workerRequestId,
      resolution: {
        approvalId: cancelled.requestId,
        nonce: cancelled.nonce,
        approved: false,
        scope: "once",
        source: "user",
      },
      error: "The turn was cancelled.",
    });
  }
  try {
    await agentProcess.request({
      type: "turn.cancel",
      requestId: randomUUID(),
      threadId: command.threadId,
    });
  } finally {
    cancellingTurns.delete(command.threadId);
  }
  activeTurns.delete(command.threadId);
  emitPayload(command.threadId, turnId, {
    type: "turn.completed",
    reason: "cancelled",
  });
}

async function cancelRunningGoalContinuation(threadId: string): Promise<void> {
  const turnId = activeTurns.get(threadId);
  const context = turnId ? goalTurnContexts.get(turnId) : undefined;
  if (context?.source === "goal-continuation") {
    await cancelTaskTurn(threadId);
  }
}

function registerIpc(): void {
  ipcMain.handle(IPC.snapshot, () => {
    if (!store) {
      throw new Error("Application store is not ready.");
    }
    const contract = getPlatformContract();
    const snapshot = store.snapshot(
      currentLocale(),
      currentPlatform(),
      {
        available: contract.sandbox.available,
        implementation: contract.sandbox.implementation,
      },
      {
        includeEvents: false,
      },
    );
    return {
      ...snapshot,
      userName: smokeMode ? "Artemis" : userInfo().username,
    };
  });
  ipcMain.handle(IPC.threadEvents, (_event, threadId: string) => {
    if (!store) {
      throw new Error("Application store is not ready.");
    }
    const thread = store.getThread(String(threadId ?? ""));
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`);
    }
    return store.getThreadEvents(thread.id);
  });
  ipcMain.handle(IPC.tokenUsageEvents, () => {
    if (!store) {
      throw new Error("Application store is not ready.");
    }
    return store.getTokenUsageEvents();
  });
  ipcMain.handle(IPC.promptHistory, () => {
    if (!store) {
      throw new Error("Application store is not ready.");
    }
    return store.listPromptHistory();
  });

  ipcMain.handle(IPC.settingsGet, () => getSettingsSnapshot());
  ipcMain.handle(
    IPC.settingsProfileAvatarSet,
    async (_event, avatar: string | undefined): Promise<SettingsSnapshot> => {
      if (!settingsStore) {
        throw new Error("Agent settings are not ready.");
      }
      await settingsStore.setProfileAvatar(avatar);
      return getSettingsSnapshot();
    },
  );
  ipcMain.handle(
    IPC.settingsProjectOrderSet,
    async (_event, order: string[]): Promise<string[]> => {
      if (!settingsStore) {
        throw new Error("Agent settings are not ready.");
      }
      return settingsStore.setProjectOrder(order);
    },
  );
  ipcMain.handle(
    IPC.settingsProjectThreadOrderSet,
    async (_event, projectId: string, order: string[]): Promise<string[]> => {
      if (!settingsStore) {
        throw new Error("Agent settings are not ready.");
      }
      return settingsStore.setProjectThreadOrder(projectId, order);
    },
  );
  ipcMain.handle(
    IPC.settingsProjectSidebarWidthSet,
    async (_event, width: number): Promise<number> => {
      if (!settingsStore) {
        throw new Error("Agent settings are not ready.");
      }
      return settingsStore.setProjectSidebarWidth(width);
    },
  );
  ipcMain.handle(
    IPC.settingsTemporaryConversationsOpenSet,
    async (_event, open: boolean): Promise<boolean> => {
      if (!settingsStore) {
        throw new Error("Agent settings are not ready.");
      }
      return settingsStore.setTemporaryConversationsOpen(open);
    },
  );
  ipcMain.handle(
    IPC.settingsWorkspaceDockWidthSet,
    async (_event, width: number): Promise<number> => {
      if (!settingsStore) {
        throw new Error("Agent settings are not ready.");
      }
      return settingsStore.setWorkspaceDockWidth(width);
    },
  );
  ipcMain.handle(
    IPC.settingsLanguageSet,
    async (_event, value: AppLanguage): Promise<SettingsSnapshot> => {
      if (!settingsStore) {
        throw new Error("Agent settings are not ready.");
      }
      const language = appLanguageSchema.parse(value);
      await settingsStore.setLanguagePreference(language);
      languagePreference = language;
      resolvedLocalePreference = resolveAppLocale(
        languagePreference,
        app.getPreferredSystemLanguages(),
      );
      return getSettingsSnapshot();
    },
  );
  ipcMain.handle(
    IPC.settingsThemeSet,
    async (_event, value: AppTheme): Promise<SettingsSnapshot> => {
      if (!settingsStore) {
        throw new Error("Agent settings are not ready.");
      }
      const theme = appThemeSchema.parse(value);
      await settingsStore.setThemePreference(theme);
      applyNativeTheme(theme);
      return getSettingsSnapshot();
    },
  );
  ipcMain.handle(
    IPC.settingsApprovalPolicySet,
    async (_event, value: ApprovalPolicy): Promise<SettingsSnapshot> => {
      if (!settingsStore) {
        throw new Error("Agent settings are not ready.");
      }
      if (activeTurns.size > 0) {
        throw new Error(
          "Stop active turns before changing the approval policy.",
        );
      }
      const policy = approvalPolicySchema.parse(value);
      if (
        policy === "full-access" &&
        !getPlatformContract().sandbox.available
      ) {
        throw new Error(
          "Full access requires the platform-native sandbox to be available.",
        );
      }
      await settingsStore.setApprovalPolicy(policy);
      return getSettingsSnapshot();
    },
  );
  ipcMain.handle(
    IPC.settingsLocalFullAccessSet,
    async (_event, enabled: boolean): Promise<SettingsSnapshot> => {
      if (!settingsStore || !trustedExtensionManager) {
        throw new Error("Agent settings are not ready.");
      }
      await resetAgentThreadsForToolChange();
      await settingsStore.setLocalFullAccess(Boolean(enabled));
      await refreshTrustedExtensions();
      await applyAgentRuntime();
      return getSettingsSnapshot();
    },
  );
  ipcMain.handle(
    IPC.settingsShellRuntimeSet,
    async (
      _event,
      value: ShellRuntimeConfiguration,
    ): Promise<SettingsSnapshot> => {
      if (!settingsStore) {
        throw new Error("Agent settings are not ready.");
      }
      if (activeTurns.size > 0) {
        throw new Error("Stop active turns before changing shell settings.");
      }
      const configuration = shellRuntimeConfigurationSchema.parse(value);
      resolveShellRuntime({
        platform: process.platform,
        env: process.env,
        windowsPreference: configuration.windowsPreference,
      });
      await resetAgentThreadsForToolChange();
      await settingsStore.setShellRuntimeConfiguration(configuration);
      await applyAgentRuntime();
      return getSettingsSnapshot();
    },
  );
  ipcMain.handle(
    IPC.settingsAgentConcurrencySet,
    async (
      _event,
      preference: AgentConcurrencyPreference,
    ): Promise<SettingsSnapshot> => {
      if (!settingsStore || !agentCapacityController) {
        throw new Error("Agent capacity settings are not ready.");
      }
      await agentCapacityApplyTail;
      await settingsStore.setAgentConcurrencyPreference(preference);
      const change = agentCapacityController.setPreference(preference);
      await applyAgentCapacityChange(change);
      return getSettingsSnapshot();
    },
  );
  ipcMain.handle(IPC.updateCheck, async () => {
    if (!releaseUpdateManager) {
      throw new Error("Update service is not ready.");
    }
    await releaseUpdateReady;
    return releaseUpdateManager.check();
  });
  ipcMain.handle(IPC.updateInstall, async () => {
    if (!releaseUpdateManager) {
      throw new Error("Update service is not ready.");
    }
    await releaseUpdateReady;
    await releaseUpdateManager.install();
  });
  ipcMain.handle(
    IPC.diagnosticsExport,
    async (): Promise<string | undefined> => {
      if (!diagnosticBundleService || !store || !mainWindow) {
        throw new Error("Diagnostic service is not ready.");
      }
      const result = await dialog.showSaveDialog(mainWindow, {
        title: mainText(currentLocale(), "exportDiagnostics"),
        defaultPath: `Artemis-diagnostics-${new Date()
          .toISOString()
          .replaceAll(":", "-")}.json.gz`,
        filters: [{ name: "Gzip JSON", extensions: ["gz"] }],
      });
      if (result.canceled || !result.filePath) return undefined;
      const contract = getPlatformContract();
      const snapshot = store.snapshot(currentLocale(), currentPlatform(), {
        available: contract.sandbox.available,
        implementation: contract.sandbox.implementation,
      });
      await diagnosticBundleService.exportBundle(result.filePath, {
        appVersion: app.getVersion(),
        platform: process.platform,
        architecture: process.arch,
        locale: currentLocale(),
        projectCount: snapshot.projects.length,
        threadCount: snapshot.threads.length,
        activeTurnCount: activeTurns.size,
        agentConcurrency: await agentConcurrencyStatus(),
      });
      return result.filePath;
    },
  );
  ipcMain.on(
    IPC.diagnosticsRendererError,
    (event, input: RendererDiagnostic) => {
      if (
        event.sender.id !== mainWindow?.webContents.id ||
        !input ||
        !["error", "unhandled-rejection"].includes(input.kind) ||
        typeof input.message !== "string" ||
        Buffer.byteLength(input.message, "utf8") > 32 * 1024 ||
        (input.stack !== undefined &&
          (typeof input.stack !== "string" ||
            Buffer.byteLength(input.stack, "utf8") > 64 * 1024))
      ) {
        return;
      }
      diagnosticBundleService?.record({
        source: "renderer",
        severity: "error",
        message: input.message,
        ...(input.stack ? { stack: input.stack } : {}),
      });
    },
  );
  ipcMain.handle(
    IPC.settingsModelAdd,
    async (
      _event,
      modelInput: AddedModelConfiguration,
      apiKeyInput?: string,
    ): Promise<SettingsSnapshot> => {
      if (!settingsStore) {
        throw new Error("Agent settings are not ready.");
      }
      if (
        !modelInput ||
        typeof modelInput.providerId !== "string" ||
        typeof modelInput.modelId !== "string"
      ) {
        throw new Error("Model configuration is invalid.");
      }
      const snapshot = await getSettingsSnapshot();
      const selectedModel = snapshot.models.find(
        (model) =>
          model.providerId === modelInput.providerId &&
          model.modelId === modelInput.modelId,
      );
      if (!selectedModel) {
        throw new Error("Selected model is not in the Pi model catalog.");
      }
      const contextWindow = contextWindowSchema.parse(modelInput.contextWindow);
      if (contextWindow > selectedModel.contextWindow) {
        throw new Error(
          `Context window cannot exceed the model limit of ${selectedModel.contextWindow}.`,
        );
      }
      const apiKey = apiKeyInput?.trim() || undefined;
      if (apiKey && Buffer.byteLength(apiKey, "utf8") > 16 * 1024) {
        throw new Error("API key cannot exceed 16 KiB.");
      }
      if (apiKey && !settingsStore.encryptionAvailable) {
        throw new Error("OS credential encryption is unavailable");
      }
      const isCustomProvider = snapshot.providers.some(
        (provider) => provider.id === selectedModel.providerId,
      );
      const hasStoredCredential = snapshot.credentials.some(
        (credential) => credential.providerId === selectedModel.providerId,
      );
      if (
        !apiKey &&
        !isCustomProvider &&
        !hasStoredCredential &&
        !selectedModel.configured
      ) {
        throw new Error("Add an API key before adding this model.");
      }
      if (apiKey) {
        const configuration = await settingsStore.runtimeConfiguration();
        configuration.credentials[selectedModel.providerId] = {
          type: "api_key",
          key: apiKey,
        };
        await applyAgentRuntime(configuration);
      }
      await settingsStore.addModel(
        {
          providerId: selectedModel.providerId,
          modelId: selectedModel.modelId,
          contextWindow,
        },
        apiKey,
      );
      return getSettingsSnapshot();
    },
  );
  ipcMain.handle(
    IPC.settingsModelDelete,
    async (
      _event,
      modelInput: Pick<AddedModelConfiguration, "providerId" | "modelId">,
    ): Promise<SettingsSnapshot> => {
      if (!settingsStore) {
        throw new Error("Agent settings are not ready.");
      }
      if (
        !modelInput ||
        typeof modelInput.providerId !== "string" ||
        typeof modelInput.modelId !== "string"
      ) {
        throw new Error("Model configuration is invalid.");
      }
      const snapshot = await getSettingsSnapshot();
      const target = snapshot.addedModels.find(
        (model) =>
          model.providerId === modelInput.providerId &&
          model.modelId === modelInput.modelId,
      );
      if (!target) return snapshot;

      const deletesActiveModel =
        snapshot.selection?.providerId === target.providerId &&
        snapshot.selection.modelId === target.modelId;
      const remainingAddedModels = snapshot.addedModels.filter(
        (model) =>
          model.providerId !== target.providerId ||
          model.modelId !== target.modelId,
      );
      const customProviderExists = snapshot.providers.some(
        (provider) => provider.id === target.providerId,
      );
      const referencingThreads = customProviderExists
        ? []
        : (store?.listThreads() ?? []).filter(
            (thread) =>
              thread.modelSelection?.providerId === target.providerId &&
              thread.modelSelection.modelId === target.modelId,
          );
      const removesActiveSelection =
        deletesActiveModel && !customProviderExists;
      if (
        (removesActiveSelection || referencingThreads.length > 0) &&
        activeTurns.size > 0
      ) {
        throw new Error("Stop the active turn before deleting its model.");
      }
      const deleteCredential =
        !customProviderExists &&
        !remainingAddedModels.some(
          (model) => model.providerId === target.providerId,
        );
      const configuration = await settingsStore.runtimeConfiguration();
      let replacement:
        { selection: ModelSelection; contextWindow: number } | undefined;

      if (removesActiveSelection || referencingThreads.length > 0) {
        const fallbackProvider = snapshot.providers.find(
          (provider) => provider.models.length > 0,
        );
        const fallbackProviderModel = fallbackProvider?.models[0];
        if (fallbackProvider && fallbackProviderModel) {
          replacement = {
            selection: {
              providerId: fallbackProvider.id,
              modelId: fallbackProviderModel.id,
              thinkingLevel: fallbackProviderModel.reasoning ? "medium" : "off",
            },
            contextWindow: fallbackProviderModel.contextWindow,
          };
        } else {
          const fallbackAddedModel = remainingAddedModels.find((candidate) =>
            snapshot.models.some(
              (model) =>
                model.providerId === candidate.providerId &&
                model.modelId === candidate.modelId &&
                (model.configured ||
                  Boolean(configuration.credentials[model.providerId])),
            ),
          );
          const fallbackCatalogModel = fallbackAddedModel
            ? snapshot.models.find(
                (model) =>
                  model.providerId === fallbackAddedModel.providerId &&
                  model.modelId === fallbackAddedModel.modelId,
              )
            : undefined;
          if (fallbackAddedModel && fallbackCatalogModel) {
            replacement = {
              selection: {
                providerId: fallbackAddedModel.providerId,
                modelId: fallbackAddedModel.modelId,
                thinkingLevel: fallbackCatalogModel.reasoning
                  ? "medium"
                  : "off",
              },
              contextWindow: Math.min(
                fallbackAddedModel.contextWindow,
                fallbackCatalogModel.contextWindow,
              ),
            };
          }
        }
      }

      if (removesActiveSelection) {
        if (replacement) {
          configuration.selection = replacement.selection;
          configuration.contextWindow = replacement.contextWindow;
        } else {
          delete configuration.selection;
          delete configuration.contextWindow;
        }
      }
      if (
        referencingThreads.length > 0 ||
        (removesActiveSelection && !replacement)
      ) {
        await resetAgentThreadsForToolChange();
      }
      if (deleteCredential) {
        delete configuration.credentials[target.providerId];
      }
      if (removesActiveSelection || deleteCredential) {
        await applyAgentRuntime(configuration);
      }
      await settingsStore.removeModel(target, {
        deleteCredential,
        ...(replacement ? { replacement } : {}),
      });
      for (const thread of referencingThreads) {
        store?.updateThread(thread.id, {
          modelSelection: replacement?.selection ?? null,
          contextWindow: replacement?.contextWindow ?? null,
        });
      }
      return getSettingsSnapshot();
    },
  );
  ipcMain.handle(
    IPC.settingsModelSet,
    async (_event, selection: ModelSelection): Promise<SettingsSnapshot> => {
      if (!settingsStore) {
        throw new Error("Agent settings are not ready.");
      }
      const resolved = await resolveModelSelection(selection);
      const configuration = await settingsStore.runtimeConfiguration();
      configuration.selection = resolved.selection;
      configuration.contextWindow = resolved.contextWindow;
      await applyAgentRuntime(configuration);
      await settingsStore.setModel(resolved.selection, resolved.contextWindow);
      return getSettingsSnapshot();
    },
  );
  ipcMain.handle(
    IPC.settingsApiKeySave,
    async (
      _event,
      providerId: string,
      apiKey: string,
    ): Promise<SettingsSnapshot> => {
      if (!settingsStore) {
        throw new Error("Agent settings are not ready.");
      }
      if (!apiKey.trim() || Buffer.byteLength(apiKey, "utf8") > 16 * 1024) {
        throw new Error("API key must contain between 1 byte and 16 KiB.");
      }
      await settingsStore.saveCredential(providerId, {
        type: "api_key",
        key: apiKey.trim(),
      });
      await applyAgentRuntime();
      return getSettingsSnapshot();
    },
  );
  ipcMain.handle(
    IPC.settingsProviderSave,
    async (
      _event,
      providerInput: ProviderConnection,
      apiKeyInput?: string,
    ): Promise<SettingsSnapshot> => {
      if (!settingsStore) {
        throw new Error("Agent settings are not ready.");
      }
      const provider = providerConnectionSchema.parse(providerInput);
      const providerModelIds = new Set(
        provider.models.map((model) => model.id),
      );
      if (
        store
          ?.listThreads()
          .some(
            (thread) =>
              thread.modelSelection?.providerId === provider.id &&
              !providerModelIds.has(thread.modelSelection.modelId),
          )
      ) {
        throw new Error(
          "Keep every model used by a conversation in this provider.",
        );
      }
      const apiKey = apiKeyInput?.trim() || undefined;
      if (apiKey && Buffer.byteLength(apiKey, "utf8") > 16 * 1024) {
        throw new Error("API key cannot exceed 16 KiB.");
      }
      if (apiKey && !settingsStore.encryptionAvailable) {
        throw new Error("OS credential encryption is unavailable");
      }
      const configuration = await settingsStore.runtimeConfiguration();
      configuration.providers = [
        ...(configuration.providers ?? []).filter(
          (candidate) => candidate.id !== provider.id,
        ),
        provider,
      ];
      const activatesProvider = !configuration.selection;
      const updatesActiveProvider =
        configuration.selection?.providerId === provider.id;
      const providerModel = provider.models[0];
      if (!providerModel) {
        throw new Error("A provider connection must include a model.");
      }
      const selectedProviderModel = updatesActiveProvider
        ? provider.models.find(
            (model) => model.id === configuration.selection?.modelId,
          )
        : undefined;
      const effectiveProviderModel = selectedProviderModel ?? providerModel;
      const preserveUltraMode =
        effectiveProviderModel.reasoning &&
        Boolean(selectedProviderModel && configuration.selection?.ultraMode);
      const providerSelection: ModelSelection = {
        providerId: provider.id,
        modelId: effectiveProviderModel.id,
        thinkingLevel: effectiveProviderModel.reasoning
          ? preserveUltraMode
            ? "high"
            : (selectedProviderModel &&
                configuration.selection?.thinkingLevel) ||
              "medium"
          : "off",
        ...(preserveUltraMode ? { ultraMode: true } : {}),
      };
      const providerContextWindow =
        updatesActiveProvider && selectedProviderModel
          ? Math.min(
              configuration.contextWindow ??
                effectiveProviderModel.contextWindow,
              effectiveProviderModel.contextWindow,
            )
          : effectiveProviderModel.contextWindow;
      if (activatesProvider || updatesActiveProvider) {
        configuration.selection = providerSelection;
        configuration.contextWindow = providerContextWindow;
      }
      if (apiKey) {
        configuration.credentials[provider.id] = {
          type: "api_key",
          key: apiKey,
        };
      }
      await applyAgentRuntime(configuration);
      await settingsStore.saveProviderConnection(provider, apiKey);
      if (activatesProvider || updatesActiveProvider) {
        await settingsStore.setModel(providerSelection, providerContextWindow);
      }
      return getSettingsSnapshot();
    },
  );
  ipcMain.handle(
    IPC.settingsProviderDelete,
    async (_event, providerIdInput: string): Promise<SettingsSnapshot> => {
      if (!settingsStore) {
        throw new Error("Agent settings are not ready.");
      }
      const providerId =
        typeof providerIdInput === "string" ? providerIdInput.trim() : "";
      const provider = (await settingsStore.providerConnections()).find(
        (candidate) => candidate.id === providerId,
      );
      if (!provider) {
        throw new Error("Provider connection was not found.");
      }
      const referencingThreads = (store?.listThreads() ?? []).filter(
        (thread) => thread.modelSelection?.providerId === provider.id,
      );

      const configuration = await settingsStore.runtimeConfiguration();
      configuration.providers = (configuration.providers ?? []).filter(
        (candidate) => candidate.id !== provider.id,
      );
      delete configuration.credentials[provider.id];

      const deletesActiveProvider =
        configuration.selection?.providerId === provider.id;
      if (
        (deletesActiveProvider || referencingThreads.length > 0) &&
        activeTurns.size > 0
      ) {
        throw new Error("Stop the active turn before deleting its provider.");
      }
      let replacement:
        { selection: ModelSelection; contextWindow: number } | undefined;
      if (deletesActiveProvider || referencingThreads.length > 0) {
        const fallbackProvider = configuration.providers.find(
          (candidate) => candidate.models.length > 0,
        );
        const fallbackProviderModel = fallbackProvider?.models[0];
        if (fallbackProvider && fallbackProviderModel) {
          replacement = {
            selection: {
              providerId: fallbackProvider.id,
              modelId: fallbackProviderModel.id,
              thinkingLevel: fallbackProviderModel.reasoning ? "medium" : "off",
            },
            contextWindow: fallbackProviderModel.contextWindow,
          };
        } else {
          const snapshot = await getSettingsSnapshot();
          const fallbackAddedModel = snapshot.addedModels.find(
            (candidate) =>
              candidate.providerId !== provider.id &&
              snapshot.models.some(
                (model) =>
                  model.providerId === candidate.providerId &&
                  model.modelId === candidate.modelId &&
                  (model.configured ||
                    Boolean(configuration.credentials[model.providerId])),
              ),
          );
          const fallbackCatalogModel = fallbackAddedModel
            ? snapshot.models.find(
                (model) =>
                  model.providerId === fallbackAddedModel.providerId &&
                  model.modelId === fallbackAddedModel.modelId,
              )
            : undefined;
          if (fallbackAddedModel && fallbackCatalogModel) {
            replacement = {
              selection: {
                providerId: fallbackAddedModel.providerId,
                modelId: fallbackAddedModel.modelId,
                thinkingLevel: fallbackCatalogModel.reasoning
                  ? "medium"
                  : "off",
              },
              contextWindow: Math.min(
                fallbackAddedModel.contextWindow,
                fallbackCatalogModel.contextWindow,
              ),
            };
          }
        }
      }

      if (deletesActiveProvider) {
        if (replacement) {
          configuration.selection = replacement.selection;
          configuration.contextWindow = replacement.contextWindow;
        } else {
          delete configuration.selection;
          delete configuration.contextWindow;
        }
      }
      if (
        referencingThreads.length > 0 ||
        (deletesActiveProvider && !replacement)
      ) {
        await resetAgentThreadsForToolChange();
      }

      await applyAgentRuntime(configuration);
      await settingsStore.deleteProviderConnection(provider.id, replacement);
      for (const thread of referencingThreads) {
        store?.updateThread(thread.id, {
          modelSelection: replacement?.selection ?? null,
          contextWindow: replacement?.contextWindow ?? null,
        });
      }
      return getSettingsSnapshot();
    },
  );
  ipcMain.handle(
    IPC.settingsCredentialDelete,
    async (_event, providerId: string): Promise<SettingsSnapshot> => {
      if (!settingsStore) {
        throw new Error("Agent settings are not ready.");
      }
      if (
        store
          ?.listThreads()
          .some((thread) => thread.modelSelection?.providerId === providerId)
      ) {
        throw new Error(
          "Switch conversations using this provider before deleting its credential.",
        );
      }
      await settingsStore.deleteCredential(providerId);
      await applyAgentRuntime();
      return getSettingsSnapshot();
    },
  );
  ipcMain.handle(
    IPC.settingsPiImport,
    async (): Promise<
      { imported: number; settings: SettingsSnapshot } | undefined
    > => {
      if (!settingsStore || !mainWindow) {
        throw new Error("Agent settings are not ready.");
      }
      const selection = await dialog.showOpenDialog(mainWindow, {
        properties: ["openFile"],
        title: mainText(currentLocale(), "importPiAuth"),
        defaultPath: join(app.getPath("home"), ".pi", "agent", "auth.json"),
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      const selectedPath = selection.filePaths[0];
      if (selection.canceled || !selectedPath) {
        return undefined;
      }
      const fileInfo = await stat(selectedPath);
      if (!fileInfo.isFile() || fileInfo.size > 2 * 1024 * 1024) {
        throw new Error("Pi auth.json must be a JSON file smaller than 2 MiB.");
      }
      const imported = await settingsStore.importPiAuth(
        JSON.parse(await readFile(selectedPath, "utf8")),
      );
      await applyAgentRuntime();
      return { imported, settings: await getSettingsSnapshot() };
    },
  );
  ipcMain.handle(
    IPC.settingsGlobalAgentsSave,
    async (_event, content: string): Promise<SettingsSnapshot> => {
      if (!globalInstructionsStore) {
        throw new Error("Global instructions are not ready.");
      }
      await resetAgentThreadsForToolChange();
      await globalInstructionsStore.save(content);
      await applyAgentRuntime();
      return getSettingsSnapshot();
    },
  );
  ipcMain.handle(
    IPC.settingsImportScan,
    async (): Promise<ConfigurationImportPreview> => {
      if (!configurationImportService) {
        throw new Error("Configuration import is not ready.");
      }
      return configurationImportService.scan();
    },
  );
  ipcMain.handle(
    IPC.settingsImportApply,
    async (
      _event,
      input: ConfigurationImportRequest,
    ): Promise<ConfigurationImportResult> => {
      if (
        !configurationImportService ||
        !settingsStore ||
        !mcpConfigStore ||
        !mcpClientManager
      ) {
        throw new Error("Configuration import is not ready.");
      }
      const activeMcpConfigStore = mcpConfigStore;
      const activeMcpClientManager = mcpClientManager;
      const request = validateConfigurationImportRequest(input);
      await resetAgentThreadsForToolChange();
      const imported = await configurationImportService.import(request);

      await importMcpServers(imported.mcpServers, imported.summary, {
        list: () => activeMcpConfigStore.list(),
        upsert: (server) => activeMcpConfigStore.upsert(server),
        connect: async (server) =>
          activeMcpClientManager.connect(
            server,
            await mcpAuthentication(server),
          ),
      });

      await applyAgentRuntime();
      return {
        settings: await getSettingsSnapshot(),
        summary: imported.summary,
      };
    },
  );
  ipcMain.handle(
    IPC.mcpServerSave,
    async (
      _event,
      input: McpServerConfig,
      bearerToken?: string,
    ): Promise<SettingsSnapshot> => {
      if (
        smokeMode &&
        process.env.ARTEMIS_SMOKE_VIEW?.startsWith("mcp-editor")
      ) {
        if (!mcpConfigStore) {
          throw new Error("MCP service is not ready.");
        }
        if (
          process.env.ARTEMIS_SMOKE_VIEW === "mcp-editor-save-error" &&
          !smokeMcpEditorSaveFailureInjected
        ) {
          smokeMcpEditorSaveFailureInjected = true;
          throw new Error("Simulated MCP server save failure.");
        }
        // Keep the durable half of the production chain: the config still
        // round-trips the real McpConfigStore persistence. Only the connect
        // step is simulated away (the synthetic identity must never spawn a
        // process or dial an endpoint) and the bearer token is dropped.
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
        await mcpConfigStore.upsert(input);
        return getSettingsSnapshot();
      }
      return saveMcpConfiguration(input, bearerToken);
    },
  );
  ipcMain.handle(
    IPC.mcpServerEnable,
    async (
      _event,
      serverId: string,
      enabled: boolean,
    ): Promise<SettingsSnapshot> => {
      if (!mcpConfigStore) {
        throw new Error("MCP service is not ready.");
      }
      const config = (await mcpConfigStore.list()).find(
        (server) => server.id === serverId,
      );
      if (!config) throw new Error("MCP server not found.");
      if (enabled) await ensureGoogleMcpReady(config);
      return saveMcpConfiguration({ ...config, enabled: Boolean(enabled) });
    },
  );
  ipcMain.handle(
    IPC.mcpServerReconnect,
    async (_event, serverId: string): Promise<SettingsSnapshot> => {
      if (smokeMode) {
        smokeMcpEditorReconnectIpcCalls += 1;
      }
      if (
        smokeMode &&
        process.env.ARTEMIS_SMOKE_VIEW?.startsWith("mcp-editor")
      ) {
        if (!mcpConfigStore) {
          throw new Error("MCP service is not ready.");
        }
        if (process.env.ARTEMIS_SMOKE_VIEW === "mcp-editor-test-busy") {
          await new Promise((resolvePromise) =>
            setTimeout(resolvePromise, 10_000),
          );
        }
        const snapshot = await getSettingsSnapshot();
        if (process.env.ARTEMIS_SMOKE_VIEW === "mcp-editor-test-failure") {
          return {
            ...snapshot,
            mcpServers: snapshot.mcpServers.map((server) =>
              server.config.id === serverId
                ? {
                    ...server,
                    state: "failed" as const,
                    error: "Simulated MCP connection test rejection.",
                  }
                : server,
            ),
          };
        }
        return {
          ...snapshot,
          mcpServers: snapshot.mcpServers.map((server) =>
            server.config.id === serverId
              ? { ...server, state: "connected" as const }
              : server,
          ),
        };
      }
      if (!mcpConfigStore || !mcpClientManager) {
        throw new Error("MCP service is not ready.");
      }
      await resetAgentThreadsForToolChange();
      const config = (await mcpConfigStore.list()).find(
        (server) => server.id === serverId,
      );
      if (!config) throw new Error("MCP server not found.");
      await mcpClientManager.connect(config, await mcpAuthentication(config));
      await applyAgentRuntime();
      return getSettingsSnapshot();
    },
  );
  ipcMain.handle(
    IPC.mcpServerAuthorize,
    async (_event, serverId: string): Promise<SettingsSnapshot> => {
      if (!mcpConfigStore || !mcpClientManager) {
        throw new Error("MCP service is not ready.");
      }
      await resetAgentThreadsForToolChange();
      const config = (await mcpConfigStore.list()).find(
        (server) => server.id === serverId,
      );
      if (!config) throw new Error("MCP server not found.");
      await authorizeMcpServer(config);
      await applyAgentRuntime();
      return getSettingsSnapshot();
    },
  );
  ipcMain.handle(
    IPC.mcpServerRemove,
    async (_event, serverId: string): Promise<SettingsSnapshot> => {
      if (
        smokeMode &&
        process.env.ARTEMIS_SMOKE_VIEW?.startsWith("mcp-editor")
      ) {
        if (!mcpConfigStore) {
          throw new Error("MCP service is not ready.");
        }
        if (
          process.env.ARTEMIS_SMOKE_VIEW === "mcp-editor-remove-error" &&
          !smokeMcpEditorRemoveFailureInjected
        ) {
          smokeMcpEditorRemoveFailureInjected = true;
          throw new Error("Simulated MCP server removal failure.");
        }
        // Keep the durable half of the production chain (the real
        // McpConfigStore.remove); the plugin scan, agent-thread reset, and
        // runtime re-apply are skipped because the isolated profile has no
        // plugins or open threads and the synthetic server never connected.
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
        await mcpConfigStore.remove(serverId);
        return getSettingsSnapshot();
      }
      if (!mcpConfigStore || !mcpClientManager || !settingsStore) {
        throw new Error("MCP service is not ready.");
      }
      const config = (await mcpConfigStore.list()).find(
        (server) => server.id === serverId,
      );
      const owningPlugin = (await codexPluginService?.listInstalled())?.find(
        (plugin) => plugin.mcpServerIds.includes(serverId),
      );
      if (owningPlugin) {
        throw new Error(
          `MCP server is managed by plugin "${owningPlugin.displayName}". Remove the plugin from Resource Center instead.`,
        );
      }
      await resetAgentThreadsForToolChange();
      await mcpClientManager.disconnect(serverId);
      await mcpConfigStore.remove(serverId);
      if (config) await removeMcpAuthentication(config);
      await applyAgentRuntime();
      return getSettingsSnapshot();
    },
  );
  ipcMain.handle(
    IPC.resourceConfirm,
    async (event, messageInput: string): Promise<boolean> => {
      const message = String(messageInput ?? "").trim();
      if (!message || message.length > 1_024) {
        throw new Error("Resource confirmation message is invalid.");
      }
      const owner = BrowserWindow.fromWebContents(event.sender);
      if (!owner || owner.isDestroyed()) return false;
      try {
        const result = await dialog.showMessageBox(owner, {
          type: "question",
          buttons: [
            mainText(currentLocale(), "confirm"),
            I18N_RESOURCES[currentLocale()].common.cancel,
          ],
          cancelId: 1,
          defaultId: 0,
          message,
          noLink: true,
        });
        return result.response === 0;
      } finally {
        restoreResourceDialogFocus(event.sender);
      }
    },
  );
  ipcMain.handle(
    IPC.resourceMcpList,
    async (): Promise<SettingsSnapshot["mcpServers"]> => getMcpServerStatuses(),
  );
  ipcMain.handle(
    IPC.resourceMcpSearch,
    async (_event, query: string): Promise<McpCatalogItem[]> => {
      if (!resourceCatalogService || !mcpConfigStore) {
        throw new Error("Resource catalog is not ready.");
      }
      if (smokeMode && process.env.ARTEMIS_SMOKE_VIEW === "mcp-search-empty") {
        return [];
      }
      if (
        smokeMode &&
        process.env.ARTEMIS_SMOKE_VIEW === "mcp-search-loading"
      ) {
        await new Promise((resolvePromise) =>
          setTimeout(resolvePromise, 10_000),
        );
        return [];
      }
      const normalized = String(query ?? "")
        .trim()
        .slice(0, 200);
      const installed = new Set(
        (await mcpConfigStore.list()).map((server) => server.id),
      );
      return resourceCatalogService.searchMcp(normalized, installed);
    },
  );
  ipcMain.handle(
    IPC.resourceMcpInstall,
    async (
      event,
      input: McpCatalogInstallRequest,
    ): Promise<SettingsSnapshot> => {
      if (
        !resourceCatalogService ||
        !mcpConfigStore ||
        !mcpClientManager ||
        !mcpSecretStore
      ) {
        throw new Error("Resource catalog is not ready.");
      }
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new Error("MCP installation request is invalid.");
      }
      const operationId = resourceInstallOperationId(input.operationId);
      const resourceId = String(input.registryName ?? "").trim();
      const version = String(input.version ?? "").trim();
      const optionId = String(input.optionId ?? "").trim();
      if (
        !resourceId ||
        resourceId.length > 300 ||
        !version ||
        version.length > 128 ||
        !/^(?:remote|npm)-\d{1,3}$/u.test(optionId) ||
        !input.inputValues ||
        typeof input.inputValues !== "object" ||
        Array.isArray(input.inputValues) ||
        Object.keys(input.inputValues).length > 100
      ) {
        throw new Error("MCP installation request is invalid.");
      }
      const publish = (percent: number) =>
        publishResourceInstallProgress(event.sender, {
          operationId,
          kind: "mcp",
          resourceId,
          percent,
        });
      publish(5);
      const resolved = await resourceCatalogService.resolveMcpInstall(
        resourceId,
        version,
        optionId,
        input.inputValues,
      );
      if (
        (await mcpConfigStore.list()).some(
          (server) => server.id === resolved.config.id,
        )
      ) {
        throw new Error("This MCP server is already installed.");
      }
      const hasSecrets =
        Object.keys(resolved.secrets.env).length > 0 ||
        Object.keys(resolved.secrets.headers).length > 0;
      publish(35);
      if (hasSecrets) {
        await mcpSecretStore.set(resolved.config.id, resolved.secrets);
      }
      publish(50);
      try {
        const settings = await saveMcpConfiguration(
          resolved.config,
          undefined,
          resolved.config.transport === "stdio" &&
            resolved.config.command === "npx"
            ? { startupTimeoutMs: MCP_REGISTRY_NPM_STARTUP_TIMEOUT_MS }
            : undefined,
          true,
        );
        publish(100);
        return settings;
      } catch (error) {
        await mcpClientManager.disconnect(resolved.config.id).catch(() => {});
        await mcpConfigStore.remove(resolved.config.id).catch(() => {});
        if (hasSecrets) {
          await mcpSecretStore.delete(resolved.config.id).catch(() => {});
        }
        await applyAgentRuntime().catch(() => {});
        throw error;
      }
    },
  );
  ipcMain.handle(
    IPC.resourceSkillSearch,
    async (_event, query: string): Promise<SkillCatalogItem[]> => {
      if (!resourceCatalogService) {
        throw new Error("Resource catalog is not ready.");
      }
      if (
        smokeMode &&
        process.env.ARTEMIS_SMOKE_VIEW === "skill-search-empty"
      ) {
        return [];
      }
      if (
        smokeMode &&
        process.env.ARTEMIS_SMOKE_VIEW === "skill-search-loading"
      ) {
        await new Promise((resolvePromise) =>
          setTimeout(resolvePromise, 10_000),
        );
        return [];
      }
      return resourceCatalogService.searchSkills(
        String(query ?? "")
          .trim()
          .slice(0, 200),
      );
    },
  );
  ipcMain.handle(IPC.resourceSkillList, async (): Promise<InstalledSkill[]> => {
    return installedSkillsWithState();
  });
  ipcMain.handle(
    IPC.resourceSkillInstall,
    async (
      event,
      skillId: string,
      operationIdInput: string,
    ): Promise<InstalledSkill> => {
      if (!resourceCatalogService) {
        throw new Error("Resource catalog is not ready.");
      }
      const operationId = resourceInstallOperationId(operationIdInput);
      const resourceId = String(skillId ?? "").trim();
      const publish = (percent: number) =>
        publishResourceInstallProgress(event.sender, {
          operationId,
          kind: "skill",
          resourceId,
          percent,
        });
      publish(5);
      await resetAgentThreadsForToolChange();
      const installed = await resourceCatalogService.installSkill(
        resourceId,
        (percent) => publish(10 + percent * 0.7),
      );
      publish(85);
      await settingsStore?.setSkillEnabled(
        join(installed.path, "SKILL.md"),
        true,
      );
      await applyAgentRuntime();
      publish(100);
      return { ...installed, enabled: true };
    },
  );
  ipcMain.handle(
    IPC.resourceSkillInstallLocal,
    async (
      event,
      operationIdInput: string,
    ): Promise<InstalledSkill | undefined> => {
      if (!resourceCatalogService || !mainWindow) {
        throw new Error("Resource catalog is not ready.");
      }
      const operationId = resourceInstallOperationId(operationIdInput);
      const selection = await dialog.showOpenDialog(mainWindow, {
        properties: ["openDirectory"],
        title: mainText(currentLocale(), "selectLocalSkill"),
      });
      restoreResourceDialogFocus(event.sender);
      if (selection.canceled || selection.filePaths.length !== 1)
        return undefined;
      if (!selection.filePaths[0]) return undefined;
      const resourceId = selection.filePaths[0];
      const publish = (percent: number) =>
        publishResourceInstallProgress(event.sender, {
          operationId,
          kind: "skill",
          resourceId,
          percent,
        });
      publish(5);
      await resetAgentThreadsForToolChange();
      const installed = await resourceCatalogService.installLocalSkill(
        selection.filePaths[0],
        (percent) => publish(10 + percent * 0.7),
      );
      publish(85);
      await settingsStore?.setSkillEnabled(
        join(installed.path, "SKILL.md"),
        true,
      );
      await applyAgentRuntime();
      publish(100);
      return { ...installed, enabled: true };
    },
  );
  ipcMain.handle(
    IPC.resourceSkillEnable,
    async (
      _event,
      skillId: string,
      enabled: boolean,
    ): Promise<InstalledSkill[]> => {
      if (!settingsStore) {
        throw new Error("Agent settings are not ready.");
      }
      const installed = await installedSkillsWithState();
      const skill = installed.find((candidate) => candidate.id === skillId);
      if (!skill) throw new Error("Installed Skill was not found.");
      await resetAgentThreadsForToolChange();
      await settingsStore.setSkillEnabled(
        join(skill.path, "SKILL.md"),
        Boolean(enabled),
      );
      await applyAgentRuntime();
      return installedSkillsWithState();
    },
  );
  ipcMain.handle(
    IPC.resourceSkillRemove,
    async (_event, skillId: string): Promise<InstalledSkill[]> => {
      if (!resourceCatalogService || !settingsStore) {
        throw new Error("Resource catalog is not ready.");
      }
      const installed = await installedSkillsWithState();
      const skill = installed.find((candidate) => candidate.id === skillId);
      if (!skill) throw new Error("Installed Skill was not found.");
      const owningPlugin = (await codexPluginService?.listInstalled())?.find(
        (plugin) => plugin.skillNames.includes(skill.name),
      );
      if (owningPlugin) {
        throw new Error(
          `Skill is managed by plugin "${owningPlugin.displayName}". Remove the plugin from Resource Center instead.`,
        );
      }
      await resetAgentThreadsForToolChange();
      await resourceCatalogService.removeSkill(skill.id);
      await settingsStore.setSkillEnabled(join(skill.path, "SKILL.md"), true);
      await applyAgentRuntime();
      return installedSkillsWithState();
    },
  );
  ipcMain.handle(
    IPC.resourcePluginList,
    async (): Promise<InstalledCodexPlugin[]> => {
      if (!codexPluginService) {
        throw new Error("Plugin service is not ready.");
      }
      return codexPluginService.listInstalled();
    },
  );
  ipcMain.handle(
    IPC.resourcePluginInspectLocal,
    async (event): Promise<CodexPluginPreview | undefined> => {
      if (!codexPluginService || !mainWindow) {
        throw new Error("Plugin service is not ready.");
      }
      const selection = await dialog.showOpenDialog(mainWindow, {
        properties: ["openDirectory"],
        title: mainText(currentLocale(), "selectLocalPlugin"),
      });
      restoreResourceDialogFocus(event.sender);
      const selectedPath = selection.filePaths[0];
      if (selection.canceled || !selectedPath) return undefined;
      return codexPluginService.inspectLocal(selectedPath);
    },
  );
  ipcMain.handle(
    IPC.resourcePluginMarketplaceLoad,
    async (
      event,
      urlInput: string,
      operationIdInput: string,
      refreshInput?: boolean,
    ): Promise<CodexPluginMarketplace> => {
      if (!codexPluginService) {
        throw new Error("Plugin service is not ready.");
      }
      const operationId = resourceInstallOperationId(operationIdInput);
      const resourceId = String(urlInput ?? "").trim();
      const publish = (percent: number) =>
        publishResourceInstallProgress(event.sender, {
          operationId,
          kind: "plugin",
          resourceId,
          percent,
        });
      publish(5);
      return codexPluginService.loadGitMarketplace(
        resourceId,
        (percent) => publish(10 + percent * 0.9),
        refreshInput === true,
      );
    },
  );
  ipcMain.handle(
    IPC.resourcePluginMarketplaceList,
    async (
      _event,
      sourceIdInput?: string,
    ): Promise<CodexPluginMarketplaceState> => {
      if (!codexPluginService) {
        throw new Error("Plugin service is not ready.");
      }
      return codexPluginService.listMarketplaces(
        typeof sourceIdInput === "string" && sourceIdInput.trim()
          ? sourceIdInput.trim()
          : undefined,
      );
    },
  );
  ipcMain.handle(
    IPC.resourcePluginMarketplaceTrust,
    async (_event, urlInput: string) => {
      if (!codexPluginService) throw new Error("Plugin service is not ready.");
      return codexPluginService.inspectMarketplaceTrust(
        String(urlInput ?? "").trim(),
      );
    },
  );
  ipcMain.handle(IPC.resourcePluginMarketplaceInspectOffline, async (event) => {
    if (!codexPluginService || !mainWindow) {
      throw new Error("Plugin service is not ready.");
    }
    const selection = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile", "openDirectory"],
      filters: [
        { name: "Artemis offline marketplace", extensions: ["gz", "tgz"] },
      ],
      title: "Select an Artemis offline marketplace package or directory",
    });
    restoreResourceDialogFocus(event.sender);
    const path = selection.filePaths[0];
    if (selection.canceled || !path) return undefined;
    return {
      path,
      trust: await codexPluginService.inspectOfflineMarketplace(path),
    };
  });
  ipcMain.handle(
    IPC.resourcePluginMarketplaceAddOffline,
    async (
      event,
      pathInput: string,
      operationIdInput: string,
      signingKeyFingerprintInput: string,
    ): Promise<CodexPluginMarketplaceState> => {
      if (!codexPluginService) {
        throw new Error("Plugin service is not ready.");
      }
      const path = String(pathInput ?? "").trim();
      const fingerprint = String(signingKeyFingerprintInput ?? "").trim();
      const operationId = resourceInstallOperationId(operationIdInput);
      const resourceId = basename(path) || "offline marketplace";
      const publish = (percent: number) =>
        publishResourceInstallProgress(event.sender, {
          operationId,
          kind: "plugin",
          resourceId,
          percent,
        });
      return codexPluginService.addOfflineMarketplace(
        path,
        fingerprint,
        publish,
      );
    },
  );
  ipcMain.handle(
    IPC.resourcePluginMarketplaceAdd,
    async (
      event,
      urlInput: string,
      operationIdInput: string,
      signingKeyFingerprintInput?: string,
    ): Promise<CodexPluginMarketplaceState> => {
      if (!codexPluginService) {
        throw new Error("Plugin service is not ready.");
      }
      const operationId = resourceInstallOperationId(operationIdInput);
      const resourceId = String(urlInput ?? "").trim();
      const publish = (percent: number) =>
        publishResourceInstallProgress(event.sender, {
          operationId,
          kind: "plugin",
          resourceId,
          percent,
        });
      publish(5);
      const signingKeyFingerprint = String(
        signingKeyFingerprintInput ?? "",
      ).trim();
      return codexPluginService.addMarketplace(
        resourceId,
        (percent) => publish(10 + percent * 0.9),
        signingKeyFingerprint || undefined,
      );
    },
  );
  ipcMain.handle(IPC.googleAccountStatus, async () => {
    if (smokeMode && process.env.ARTEMIS_SMOKE_GOOGLE_AUTHORIZED === "1") {
      return {
        encryptionAvailable: true,
        clientConfigured: true,
        connected: true,
        grants: {
          "google-workspace": { authorized: true, scopes: [] },
          gmail: { authorized: true, scopes: [] },
        },
      };
    }
    if (!googleAccountService)
      throw new Error("Google account service is not ready.");
    return googleAccountService.status();
  });
  ipcMain.handle(
    IPC.googleAccountAuthorizeGrant,
    async (_event, grant: GoogleGrantId) => {
      if (
        !googleAccountService ||
        !codexPluginService ||
        !mcpConfigStore ||
        !mcpClientManager
      )
        throw new Error("Google account service is not ready.");
      const installedServerIds = (
        await codexPluginService.listInstalled()
      ).flatMap((plugin) => plugin.mcpServerIds);
      const grantServerIds = installedGoogleMcpServerIdsForGrant(
        await mcpConfigStore.list(),
        installedServerIds,
        grant,
      );
      if (grantServerIds.length > 0) {
        await resetAgentThreadsForToolChange();
      }
      const status = await googleAccountService.authorize(
        grant,
        currentLocale().startsWith("zh") ? "zh" : "en",
      );
      if (grantServerIds.length > 0) {
        await enableReadyInstalledGoogleMcpServers(grantServerIds);
        await applyAgentRuntime();
      }
      return status;
    },
  );
  ipcMain.handle(
    IPC.googleAccountDisconnectGrant,
    async (_event, grant: GoogleGrantId) => {
      if (!googleAccountService)
        throw new Error("Google account service is not ready.");
      await disableGoogleGrantConfigs(grant);
      return googleAccountService.disconnectGrant(grant);
    },
  );
  ipcMain.handle(IPC.googleAccountDisconnect, async () => {
    if (!googleAccountService)
      throw new Error("Google account service is not ready.");
    await disableGoogleGrantConfigs();
    return googleAccountService.disconnectAccount();
  });
  ipcMain.handle(
    IPC.resourcePluginMarketplaceSelect,
    async (
      _event,
      sourceIdInput: string,
    ): Promise<CodexPluginMarketplaceState> => {
      if (!codexPluginService) {
        throw new Error("Plugin service is not ready.");
      }
      return codexPluginService.selectMarketplace(
        String(sourceIdInput ?? "").trim(),
      );
    },
  );
  ipcMain.handle(
    IPC.resourcePluginMarketplaceRefresh,
    async (
      event,
      sourceIdInput: string,
      operationIdInput: string,
    ): Promise<CodexPluginMarketplaceState> => {
      if (!codexPluginService) {
        throw new Error("Plugin service is not ready.");
      }
      const sourceId = String(sourceIdInput ?? "").trim();
      const operationId = resourceInstallOperationId(operationIdInput);
      const publish = (percent: number) =>
        publishResourceInstallProgress(event.sender, {
          operationId,
          kind: "plugin",
          resourceId: sourceId,
          percent,
        });
      publish(5);
      return codexPluginService.refreshMarketplaceSource(sourceId, (percent) =>
        publish(10 + percent * 0.9),
      );
    },
  );
  ipcMain.handle(
    IPC.resourcePluginMarketplaceRemove,
    async (
      _event,
      sourceIdInput: string,
    ): Promise<CodexPluginMarketplaceState> => {
      if (!codexPluginService) {
        throw new Error("Plugin service is not ready.");
      }
      return codexPluginService.removeMarketplace(
        String(sourceIdInput ?? "").trim(),
      );
    },
  );
  ipcMain.handle(
    IPC.resourcePluginMarketplaceReorder,
    async (
      _event,
      sourceIdsInput: unknown,
    ): Promise<CodexPluginMarketplaceState> => {
      if (!codexPluginService || !Array.isArray(sourceIdsInput)) {
        throw new Error("Plugin marketplace order is invalid.");
      }
      return codexPluginService.reorderMarketplaces(
        sourceIdsInput.map((sourceId) => String(sourceId ?? "").trim()),
      );
    },
  );
  ipcMain.handle(
    IPC.resourcePluginRuntimeMarketplace,
    async (): Promise<CodexPluginMarketplace | undefined> => {
      if (!codexPluginService) {
        throw new Error("Plugin service is not ready.");
      }
      return codexPluginService.loadBundledArtifactMarketplace();
    },
  );
  ipcMain.handle(
    IPC.resourcePluginRuntimeInstall,
    async (
      event,
      operationIdInput: string,
    ): Promise<CodexPluginMutationResult> => {
      if (!codexPluginService) {
        throw new Error("Plugin service is not ready.");
      }
      const operationId = resourceInstallOperationId(operationIdInput);
      const marketplace =
        await codexPluginService.loadBundledArtifactMarketplace();
      if (!marketplace) {
        throw new Error("Bundled Lite artifact plugins are unavailable.");
      }
      const pending = marketplace.plugins.filter((plugin) => !plugin.installed);
      const publish = (percent: number) =>
        publishResourceInstallProgress(event.sender, {
          operationId,
          kind: "plugin",
          resourceId: marketplace.name,
          percent,
        });
      if (!pending.length) {
        publish(100);
        return codexPluginMutationResult([]);
      }

      const warnings: string[] = [];
      const installedSkillNames: string[] = [];
      const installedPluginIds: string[] = [];
      publish(5);
      await resetAgentThreadsForToolChange();
      try {
        for (const [index, plugin] of pending.entries()) {
          const installed = await codexPluginService.install(
            plugin.source,
            (percent) =>
              publish(
                10 +
                  Math.round(((index + percent / 100) / pending.length) * 80),
              ),
          );
          installedPluginIds.push(installed.plugin.id);
          installedSkillNames.push(...installed.plugin.skillNames);
          warnings.push(...installed.warnings);
        }
      } catch (error) {
        const rollbackWarnings: string[] = [];
        for (const pluginId of installedPluginIds.reverse()) {
          try {
            const rolledBack = await codexPluginService.remove(pluginId);
            rollbackWarnings.push(...rolledBack.warnings);
          } catch (rollbackError) {
            rollbackWarnings.push(
              rollbackError instanceof Error
                ? rollbackError.message
                : String(rollbackError),
            );
          }
        }
        await applyAgentRuntime();
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(
          [
            `The four required document plugins could not be installed together: ${reason}`,
            ...rollbackWarnings,
          ].join("\n"),
        );
      }
      await enableManagedPluginSkills(installedSkillNames);
      await applyAgentRuntime();
      publish(100);
      return codexPluginMutationResult(warnings);
    },
  );
  ipcMain.handle(
    IPC.resourcePluginInstall,
    async (
      event,
      source: CodexPluginSource,
      operationIdInput: string,
    ): Promise<CodexPluginMutationResult> => {
      if (!codexPluginService) {
        throw new Error("Plugin service is not ready.");
      }
      const operationId = resourceInstallOperationId(operationIdInput);
      const resourceId =
        source?.kind === "git" ||
        source?.kind === "bundled" ||
        source?.kind === "runtime"
          ? source.pluginName
          : source?.path;
      const publish = (percent: number) =>
        publishResourceInstallProgress(event.sender, {
          operationId,
          kind: "plugin",
          resourceId: String(resourceId ?? "Plugin"),
          percent,
        });
      publish(5);
      await resetAgentThreadsForToolChange();
      const installed = await codexPluginService.install(source, (percent) =>
        publish(10 + percent * 0.8),
      );
      await enableManagedPluginSkills(installed.plugin.skillNames);
      await enableReadyInstalledGoogleMcpServers(installed.plugin.mcpServerIds);
      await applyAgentRuntime();
      publish(100);
      return codexPluginMutationResult(installed.warnings);
    },
  );
  ipcMain.handle(
    IPC.resourcePluginUpdate,
    async (
      event,
      pluginIdInput: string,
      operationIdInput: string,
    ): Promise<CodexPluginMutationResult> => {
      if (!codexPluginService || !mcpConfigStore) {
        throw new Error("Plugin service is not ready.");
      }
      const pluginId = String(pluginIdInput ?? "").trim();
      const existing = await codexPluginService.installedById(pluginId);
      if (!existing) throw new Error("Installed plugin was not found.");
      const operationId = resourceInstallOperationId(operationIdInput);
      const publish = (percent: number) =>
        publishResourceInstallProgress(event.sender, {
          operationId,
          kind: "plugin",
          resourceId: existing.displayName,
          percent,
        });
      const before = await mcpConfigStore.list();
      const scopedIds = new Set(existing.mcpServerIds);
      const existingSkillNames = new Set(existing.skillNames);
      const previousSkillState = new Map(
        (await installedSkillsWithState())
          .filter((skill) => existingSkillNames.has(skill.name))
          .map((skill) => [skill.name, skill.enabled]),
      );
      publish(5);
      await resetAgentThreadsForToolChange();
      await disconnectMcpServers(existing.mcpServerIds);
      try {
        const updated = await codexPluginService.update(pluginId, (percent) =>
          publish(10 + percent * 0.8),
        );
        const after = await mcpConfigStore.list();
        await cleanupRemovedMcpAuthentication(before, after, scopedIds);
        await reconcileManagedPluginSkills(
          existing.skillNames,
          updated.plugin.skillNames,
          previousSkillState,
        );
        await reconnectEnabledMcpServers(
          after.filter((config) =>
            updated.plugin.mcpServerIds.includes(config.id),
          ),
        );
        await applyAgentRuntime();
        publish(100);
        return codexPluginMutationResult(updated.warnings);
      } catch (error) {
        await reconnectEnabledMcpServers(
          before.filter((config) => scopedIds.has(config.id)),
        );
        await applyAgentRuntime();
        throw error;
      }
    },
  );
  ipcMain.handle(
    IPC.resourcePluginEnable,
    async (
      _event,
      pluginIdInput: string,
      enabledInput: boolean,
    ): Promise<CodexPluginMutationResult> => {
      if (
        !codexPluginService ||
        !mcpConfigStore ||
        !settingsStore ||
        typeof enabledInput !== "boolean"
      ) {
        throw new Error("Plugin service is not ready.");
      }
      const pluginId = String(pluginIdInput ?? "").trim();
      const existing = await codexPluginService.installedById(pluginId);
      if (!existing) throw new Error("Installed plugin was not found.");
      const installedSkills = await installedSkillsWithState();
      const skillNames = new Set(existing.skillNames);
      const ownedSkills = installedSkills.filter((skill) =>
        skillNames.has(skill.name),
      );
      if (ownedSkills.length !== existing.skillNames.length) {
        throw new Error("A plugin-managed Skill is missing.");
      }
      const previousSkillState = new Map(
        ownedSkills.map((skill) => [skill.id, skill.enabled]),
      );
      const previousMcp = await mcpConfigStore.list();
      const mcpIds = new Set(existing.mcpServerIds);
      if (
        previousMcp.filter((config) => mcpIds.has(config.id)).length !==
        existing.mcpServerIds.length
      ) {
        throw new Error("A plugin-managed MCP server is missing.");
      }
      const nextMcp = previousMcp.map((config) =>
        mcpIds.has(config.id) ? { ...config, enabled: enabledInput } : config,
      );
      if (enabledInput) {
        for (const config of nextMcp.filter((candidate) =>
          mcpIds.has(candidate.id),
        )) {
          await ensureGoogleMcpReady(config);
        }
      }
      await resetAgentThreadsForToolChange();
      await disconnectMcpServers(existing.mcpServerIds);
      try {
        for (const skill of ownedSkills) {
          await settingsStore.setSkillEnabled(
            join(skill.path, "SKILL.md"),
            enabledInput,
          );
        }
        await mcpConfigStore.replaceAll(nextMcp);
        if (enabledInput) {
          await reconnectEnabledMcpServers(
            nextMcp.filter((config) => mcpIds.has(config.id)),
            true,
          );
        }
        await applyAgentRuntime();
        return codexPluginMutationResult([]);
      } catch (error) {
        for (const skill of ownedSkills) {
          await settingsStore
            .setSkillEnabled(
              join(skill.path, "SKILL.md"),
              previousSkillState.get(skill.id) ?? true,
            )
            .catch(() => undefined);
        }
        await mcpConfigStore.replaceAll(previousMcp).catch(() => undefined);
        await reconnectEnabledMcpServers(
          previousMcp.filter(
            (config) => mcpIds.has(config.id) && config.enabled,
          ),
        );
        await applyAgentRuntime();
        throw error;
      }
    },
  );
  ipcMain.handle(
    IPC.resourcePluginRemove,
    async (
      _event,
      pluginIdInput: string,
    ): Promise<CodexPluginMutationResult> => {
      if (!codexPluginService || !mcpConfigStore) {
        throw new Error("Plugin service is not ready.");
      }
      const pluginId = String(pluginIdInput ?? "").trim();
      const existing = await codexPluginService.installedById(pluginId);
      if (!existing) throw new Error("Installed plugin was not found.");
      const before = await mcpConfigStore.list();
      const scopedIds = new Set(existing.mcpServerIds);
      await resetAgentThreadsForToolChange();
      await disconnectMcpServers(existing.mcpServerIds);
      try {
        const removed = await codexPluginService.remove(pluginId);
        const after = await mcpConfigStore.list();
        await cleanupRemovedMcpAuthentication(before, after, scopedIds);
        await enableManagedPluginSkills(existing.skillNames);
        const ownedGrant = before.find(
          (config) => scopedIds.has(config.id) && config.hostAuth,
        )?.hostAuth?.grant;
        if (ownedGrant) {
          await googleAccountService?.disconnectGrant(ownedGrant, false);
        }
        await applyAgentRuntime();
        return codexPluginMutationResult(removed.warnings);
      } catch (error) {
        await reconnectEnabledMcpServers(
          before.filter((config) => scopedIds.has(config.id)),
        );
        await applyAgentRuntime();
        throw error;
      }
    },
  );
  ipcMain.handle(
    IPC.extensionTrust,
    async (): Promise<SettingsSnapshot | undefined> => {
      if (!trustedExtensionStore || !mainWindow) {
        throw new Error("Trusted extension service is not ready.");
      }
      const selection = await dialog.showOpenDialog(mainWindow, {
        properties: ["openFile"],
        title: mainText(currentLocale(), "selectPiExtension"),
        filters: [
          {
            name: "Pi extension",
            extensions: ["js", "mjs", "cjs", "ts", "mts", "cts"],
          },
        ],
      });
      const selectedPath = selection.filePaths[0];
      if (selection.canceled || !selectedPath) return undefined;
      await resetAgentThreadsForToolChange();
      await trustedExtensionStore.trust(selectedPath);
      await refreshTrustedExtensions();
      await applyAgentRuntime();
      return getSettingsSnapshot();
    },
  );
  ipcMain.handle(
    IPC.extensionRetrust,
    async (_event, extensionId: string): Promise<SettingsSnapshot> => {
      if (!trustedExtensionStore) {
        throw new Error("Trusted extension service is not ready.");
      }
      await resetAgentThreadsForToolChange();
      const config = (await trustedExtensionStore.list()).find(
        (candidate) => candidate.id === extensionId,
      );
      if (!config) throw new Error("Trusted extension was not found.");
      await trustedExtensionStore.trust(config.path, {
        name: config.name,
        allowNetwork: config.allowNetwork,
      });
      await refreshTrustedExtensions();
      await applyAgentRuntime();
      return getSettingsSnapshot();
    },
  );
  ipcMain.handle(
    IPC.extensionEnable,
    async (
      _event,
      extensionId: string,
      enabled: boolean,
    ): Promise<SettingsSnapshot> => {
      if (!trustedExtensionStore) {
        throw new Error("Trusted extension service is not ready.");
      }
      await resetAgentThreadsForToolChange();
      await trustedExtensionStore.setEnabled(extensionId, Boolean(enabled));
      await refreshTrustedExtensions();
      await applyAgentRuntime();
      return getSettingsSnapshot();
    },
  );
  ipcMain.handle(
    IPC.extensionNetwork,
    async (
      _event,
      extensionId: string,
      allowNetwork: boolean,
    ): Promise<SettingsSnapshot> => {
      if (!trustedExtensionStore) {
        throw new Error("Trusted extension service is not ready.");
      }
      await resetAgentThreadsForToolChange();
      await trustedExtensionStore.setAllowNetwork(
        extensionId,
        Boolean(allowNetwork),
      );
      await refreshTrustedExtensions();
      await applyAgentRuntime();
      return getSettingsSnapshot();
    },
  );
  ipcMain.handle(
    IPC.extensionRemove,
    async (_event, extensionId: string): Promise<SettingsSnapshot> => {
      if (!trustedExtensionStore) {
        throw new Error("Trusted extension service is not ready.");
      }
      await resetAgentThreadsForToolChange();
      await trustedExtensionStore.remove(extensionId);
      await refreshTrustedExtensions();
      await applyAgentRuntime();
      return getSettingsSnapshot();
    },
  );

  ipcMain.handle(IPC.terminalOpen, async (_event, input: TerminalOpenInput) => {
    if (!store || !terminalService || !settingsStore) {
      throw new Error("Terminal service is not ready.");
    }
    const thread = store.getThread(input.threadId);
    if (!thread || thread.archived) {
      throw new Error("Active task not found.");
    }
    const [context, shellConfiguration] = await Promise.all([
      resolveThreadWorkspace(thread),
      settingsStore.shellRuntimeConfiguration(),
      ensureNodePtyRuntime(),
    ]);
    const contract = getPlatformContract();
    return terminalService.open({
      threadId: thread.id,
      workspacePath: context.workspacePath,
      shell: contract.shell,
      windowsPreference: shellConfiguration.windowsPreference,
      cols: input.cols,
      rows: input.rows,
    });
  });
  ipcMain.handle(
    IPC.terminalWrite,
    (_event, terminalId: string, data: string) => {
      terminalService?.write(terminalId, data);
    },
  );
  ipcMain.handle(
    IPC.terminalResize,
    (_event, terminalId: string, cols: number, rows: number) => {
      terminalService?.resize(terminalId, cols, rows);
    },
  );
  ipcMain.handle(IPC.terminalClose, (_event, terminalId: string) => {
    terminalService?.close(terminalId);
  });

  ipcMain.handle(
    IPC.workspaceTextFileRead,
    async (
      _event,
      threadId: string,
      path: string,
    ): Promise<WorkspaceTextFile> => {
      if (!store) {
        throw new Error("Application store is not ready.");
      }
      const thread = store.getThread(String(threadId ?? ""));
      if (!thread || thread.archived) {
        throw new Error("Active task not found.");
      }
      const context = await resolveThreadWorkspace(thread);
      return readWorkspaceTextFile(context.workspacePath, String(path ?? ""));
    },
  );
  ipcMain.handle(
    IPC.workspaceImageRead,
    async (
      _event,
      threadId: string,
      markdownPath: string,
      href: string,
    ): Promise<WorkspaceImageFile> => {
      if (!store) {
        throw new Error("Application store is not ready.");
      }
      const thread = store.getThread(String(threadId ?? ""));
      if (!thread || thread.archived) {
        throw new Error("Active task not found.");
      }
      const context = await resolveThreadWorkspace(thread);
      return readWorkspaceImage(
        context.workspacePath,
        String(markdownPath ?? ""),
        String(href ?? ""),
      );
    },
  );
  ipcMain.handle(
    IPC.workspaceDirectoryList,
    async (
      _event,
      threadId: string,
      path: string,
    ): Promise<WorkspaceDirectoryEntry[]> => {
      if (!store) {
        throw new Error("Application store is not ready.");
      }
      const thread = store.getThread(String(threadId ?? ""));
      if (!thread || thread.archived) {
        throw new Error("Active task not found.");
      }
      const context = await resolveThreadWorkspace(thread);
      return listWorkspaceDirectory(context.workspacePath, String(path ?? ""));
    },
  );
  ipcMain.handle(
    IPC.workspaceFileRead,
    async (
      _event,
      threadId: string,
      path: string,
    ): Promise<WorkspaceFileContent> => {
      if (!store) {
        throw new Error("Application store is not ready.");
      }
      const thread = store.getThread(String(threadId ?? ""));
      if (!thread || thread.archived) {
        throw new Error("Active task not found.");
      }
      const context = await resolveThreadWorkspace(thread);
      return readWorkspaceFile(context.workspacePath, String(path ?? ""));
    },
  );
  ipcMain.handle(
    IPC.workspaceFileWrite,
    async (
      _event,
      threadId: string,
      path: string,
      content: string,
    ): Promise<WorkspaceFileContent> => {
      if (!store) {
        throw new Error("Application store is not ready.");
      }
      if (
        smokeMode &&
        process.env.ARTEMIS_SMOKE_VIEW === "markdown-editor-save-error"
      ) {
        throw new Error("Simulated workspace file save failure.");
      }
      const thread = store.getThread(String(threadId ?? ""));
      if (!thread || thread.archived) {
        throw new Error("Active task not found.");
      }
      const context = await resolveThreadWorkspace(thread);
      return writeWorkspaceFile(
        context.workspacePath,
        String(path ?? ""),
        String(content ?? ""),
      );
    },
  );
  ipcMain.handle(
    IPC.workspaceFileLinkInspect,
    async (
      _event,
      threadId: string,
      href: string,
    ): Promise<WorkspaceFileLink> => {
      const { absolutePath: _absolutePath, ...file } =
        await linkedWorkspaceFile(threadId, href);
      return file;
    },
  );
  ipcMain.handle(
    IPC.workspaceFileReveal,
    async (_event, threadId: string, path: string): Promise<void> => {
      const file = await linkedWorkspaceFile(threadId, path);
      shell.showItemInFolder(file.absolutePath);
    },
  );
  ipcMain.handle(
    IPC.workspaceFileRun,
    async (_event, threadId: string, path: string): Promise<void> => {
      await launchWorkspaceFile(await linkedWorkspaceFile(threadId, path));
    },
  );

  ipcMain.handle(IPC.projectOpen, async (): Promise<Project | undefined> => {
    if (!store || !mainWindow) {
      throw new Error("Application is not ready.");
    }
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
      title: "Open a project",
    });
    const path = result.filePaths[0];
    if (result.canceled || !path) {
      return undefined;
    }
    const now = new Date().toISOString();
    return store.upsertProject({
      id: randomUUID(),
      name: path.split(/[\\/]/).filter(Boolean).at(-1) ?? path,
      path,
      createdAt: now,
      updatedAt: now,
    });
  });

  ipcMain.handle(IPC.projectRemove, (_event, projectId: string): void => {
    if (!store) {
      throw new Error("Application store is not ready.");
    }
    store.removeProject(projectId);
  });

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

  const assertProjectGitMutationAllowed = (projectId: string): void => {
    const hasLiveLocalTurn = [...activeTurns.keys()].some((threadId) => {
      const thread = store?.getThread(threadId);
      return thread?.projectId === projectId && thread.target === "local";
    });
    if (store?.hasActiveLocalThread(projectId) || hasLiveLocalTurn) {
      throw new Error(
        "Stop active local tasks before changing the project repository.",
      );
    }
  };

  ipcMain.handle(
    IPC.projectGitInfo,
    async (
      event,
      projectId: string,
      threadId?: string,
    ): Promise<ProjectGitInfo> => {
      const context = await workspaceForGitRequest(projectId, threadId);
      const info = await inspectGitBranches(context.workspacePath);
      await ensureProjectGitWatcher(
        event.sender,
        context.project.id,
        context.threadId,
        context.workspacePath,
        info,
      );
      return info;
    },
  );

  ipcMain.handle(
    IPC.projectPullRequest,
    async (
      _event,
      projectId: string,
      threadId?: string,
    ): Promise<ProjectPullRequestLookup> => {
      const context = await workspaceForGitRequest(projectId, threadId);
      if (
        smokeMode &&
        process.env.ARTEMIS_SMOKE_VIEW?.startsWith("environment-pr-checks")
      ) {
        const gitInfo = await inspectGitBranches(context.workspacePath);
        const checks: ProjectPullRequestCheck[] =
          process.env.ARTEMIS_SMOKE_VIEW === "environment-pr-checks-empty"
            ? []
            : [
                {
                  name: "Test, typecheck, build and format",
                  status: "passed",
                  workflowName: "CI",
                  detailsUrl: "https://github.com/EurekaRaider/Artemis/actions",
                },
                {
                  name: "Desktop skin and package boundary",
                  status: "pending",
                  workflowName: "CI",
                },
                {
                  name: "Windows native sandbox integration",
                  status: "failed",
                  workflowName: "CI",
                  detailsUrl: "https://github.com/EurekaRaider/Artemis/actions",
                },
                {
                  name: "Gallery macOS",
                  status: "skipped",
                  workflowName: "CI",
                },
                {
                  name: "Gallery Windows",
                  status: "cancelled",
                  workflowName: "CI",
                },
              ];
        return {
          status: "found",
          pullRequest: {
            number: 80,
            title: "Stop stalled model streams",
            url: "https://github.com/EurekaRaider/Artemis/pull/80",
            state: "OPEN",
            isDraft: false,
            headRefName: gitInfo.currentBranch ?? "main",
            headRefOid: gitInfo.headOid ?? "0".repeat(40),
            checks,
          },
        };
      }
      const smokeView = process.env.ARTEMIS_SMOKE_VIEW;
      if (
        smokeView?.startsWith("environment") ||
        smokeView?.startsWith("icon-sizing-environment")
      ) {
        return { status: "not-found" };
      }
      return inspectProjectPullRequest(context.workspacePath);
    },
  );

  ipcMain.handle(
    IPC.projectGitBranchSwitch,
    async (
      _event,
      projectId: string,
      branchName: string,
      threadId?: string,
    ): Promise<ProjectGitInfo> => {
      const context = await workspaceForGitRequest(projectId, threadId);
      assertProjectGitMutationAllowed(context.project.id);
      return switchGitBranch(context.workspacePath, String(branchName ?? ""));
    },
  );

  ipcMain.handle(
    IPC.projectGitBranchCreate,
    async (
      _event,
      projectId: string,
      branchName: string,
      threadId?: string,
    ): Promise<ProjectGitInfo> => {
      const context = await workspaceForGitRequest(projectId, threadId);
      assertProjectGitMutationAllowed(context.project.id);
      return createGitBranch(context.workspacePath, String(branchName ?? ""));
    },
  );

  ipcMain.handle(
    IPC.projectGitCommit,
    async (
      _event,
      projectId: string,
      message: string,
      includeUnstaged: boolean,
      threadId?: string,
    ): Promise<ProjectGitCommitResult> => {
      const context = await workspaceForGitRequest(projectId, threadId);
      assertProjectGitMutationAllowed(context.project.id);
      if (typeof includeUnstaged !== "boolean") {
        throw new Error("Include-unstaged selection is invalid.");
      }
      return commitProjectChanges(
        context.workspacePath,
        message,
        includeUnstaged,
      );
    },
  );

  ipcMain.handle(
    IPC.projectGitPush,
    async (
      _event,
      projectId: string,
      threadId?: string,
    ): Promise<ProjectGitPushResult> => {
      const context = await workspaceForGitRequest(projectId, threadId);
      assertProjectGitMutationAllowed(context.project.id);
      return pushProjectBranch(context.workspacePath);
    },
  );

  ipcMain.handle(
    IPC.promptAttachmentsSelect,
    async (): Promise<PromptAttachment[] | undefined> => {
      if (!mainWindow) {
        throw new Error("Application window is not ready.");
      }
      const result = await dialog.showOpenDialog(mainWindow, {
        title: "Attach files or images",
        properties: ["openFile", "multiSelections"],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return undefined;
      }
      return loadPromptAttachments(result.filePaths);
    },
  );
  ipcMain.handle(
    IPC.promptAttachmentsRead,
    async (_event, paths: unknown): Promise<PromptAttachment[]> => {
      if (
        !Array.isArray(paths) ||
        !paths.every((path) => typeof path === "string")
      ) {
        throw new Error("Dropped attachment paths are invalid.");
      }
      return loadPromptAttachments(paths);
    },
  );
  ipcMain.handle(
    IPC.taskSourceImageRead,
    async (
      _event,
      threadId: string,
      sourceId: string,
    ): Promise<PromptImage> => {
      if (!store) throw new Error("Application store is not ready.");
      const thread = store.getThread(String(threadId ?? ""));
      if (!thread) throw new Error("Task source was not found.");
      const source = store
        .getThreadEvents(thread.id)
        .map((event) => event.payload)
        .find(
          (payload) =>
            payload.type === "task.source.added" &&
            payload.kind === "image" &&
            payload.sourceId === sourceId,
        );
      if (
        !source ||
        source.type !== "task.source.added" ||
        source.kind !== "image"
      ) {
        throw new Error("Task source image was not found.");
      }
      let data: string;
      try {
        data = await taskSourceImages().read(thread.id, source.sourceId);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          throw new Error(
            "This image preview is unavailable because the source predates local preview storage.",
          );
        }
        throw error;
      }
      return promptImageSchema.parse({
        name: source.name,
        mimeType: source.mimeType,
        data,
      });
    },
  );

  ipcMain.handle(
    IPC.threadCreate,
    (_event, input: CreateThreadInput): Promise<Thread | undefined> =>
      createTaskThread(input),
  );

  ipcMain.handle(
    IPC.threadModelSet,
    async (
      _event,
      threadId: string,
      selection: ModelSelection,
    ): Promise<Thread> => {
      if (!store || !agentProcess) {
        throw new Error("Application is not ready.");
      }
      const thread = store.getThread(String(threadId ?? ""));
      if (!thread) throw new Error(`Thread not found: ${threadId}`);
      if (
        thread.status === "running" ||
        thread.status === "waiting-approval" ||
        activeTurns.has(thread.id) ||
        compactingThreads.has(thread.id)
      ) {
        throw new Error("Stop the active task before changing its model.");
      }
      const resolved = await resolveModelSelection(
        selection,
        thread.modelSelection,
      );
      const command = parseThreadCommand({
        type: "thread.model.set",
        threadId: thread.id,
        selection: resolved.selection,
        contextWindow: resolved.contextWindow,
      });
      if (openedThreads.has(thread.id)) {
        await agentProcess.request({
          type: "thread.model.set",
          requestId: randomUUID(),
          threadId: thread.id,
          selection: command.selection,
          contextWindow: command.contextWindow,
        });
      }
      return store.updateThread(thread.id, {
        modelSelection: command.selection,
        contextWindow: command.contextWindow,
      });
    },
  );

  ipcMain.handle(IPC.threadPrepare, async (_event, threadId: string) => {
    if (!store) throw new Error("Application store is not ready.");
    const thread = store.getThread(String(threadId ?? ""));
    if (!thread || thread.archived) return;
    const context = await resolveThreadWorkspace(thread);
    await openAgentThread(thread, context.workspacePath);
  });

  ipcMain.handle(
    IPC.threadRename,
    (_event, threadId: string, title: string): Thread => {
      if (!store) {
        throw new Error("Application store is not ready.");
      }
      const command = parseThreadCommand({
        type: "thread.rename",
        threadId,
        title,
      });
      if (!store.getThread(command.threadId)) {
        throw new Error(`Thread not found: ${command.threadId}`);
      }
      return store.updateThread(command.threadId, { title: command.title });
    },
  );

  ipcMain.handle(
    IPC.threadGoalSet,
    async (
      _event,
      threadId: string,
      objective: string,
      tokenBudget?: number,
    ): Promise<Thread> => {
      if (!store) throw new Error("Application store is not ready.");
      const command = parseThreadCommand({
        type: "thread.goal.set",
        threadId,
        objective,
        ...(tokenBudget === undefined ? {} : { tokenBudget }),
      });
      if (command.objective === undefined) {
        throw new Error("A new Goal requires an objective.");
      }
      if (store.getThreadGoal(command.threadId)) {
        throw new Error("Clear the current Goal before creating a new one.");
      }
      const persistedObjective = await materializeGoalObjective(
        command.objective,
      );
      let goal: ThreadGoal;
      try {
        goal = store.setThreadGoal(
          command.threadId,
          persistedObjective,
          command.tokenBudget ?? undefined,
        );
      } catch (error) {
        await cleanupGoalObjective(persistedObjective);
        throw error;
      }
      emitGoalUpdated(goal, activeTurns.get(command.threadId));
      return store.getThread(command.threadId)!;
    },
  );

  ipcMain.handle(
    IPC.threadGoalObjectiveGet,
    async (_event, threadId: string) => {
      if (!store) throw new Error("Application store is not ready.");
      if (
        smokeMode &&
        process.env.ARTEMIS_SMOKE_VIEW === "goal-editor-load-error"
      ) {
        throw new Error("Simulated Goal load failure.");
      }
      const goal = store.getThreadGoal(String(threadId ?? ""));
      if (!goal) throw new Error("This task has no Goal.");
      return {
        goalId: goal.goalId,
        objective: await readGoalObjective(goal.objective),
        revision: goal.revision,
        updatedAt: goal.updatedAt,
      };
    },
  );

  ipcMain.handle(
    IPC.threadGoalObjectiveUpdate,
    async (
      _event,
      threadId: string,
      objective: string,
      expectedGoalId: string,
      expectedRevision: number,
    ): Promise<Thread> => {
      if (!store) throw new Error("Application store is not ready.");
      const smokeView = smokeMode ? process.env.ARTEMIS_SMOKE_VIEW : undefined;
      if (smokeView === "goal-editor-save-error") {
        throw new Error("Simulated Goal save failure.");
      }
      if (smokeView === "goal-editor-saving") {
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
      const command = parseThreadCommand({
        type: "thread.goal.set",
        threadId,
        objective,
        expectedGoalId,
        expectedRevision,
      });
      if (command.objective === undefined) {
        throw new Error("A Goal edit requires an objective.");
      }
      const previous = store.getThreadGoal(command.threadId);
      if (!previous) throw new Error("This task has no Goal.");
      const persistedObjective = await materializeGoalObjective(
        command.objective,
      );
      let goal: ThreadGoal;
      try {
        goal = store.updateThreadGoalObjective(
          command.threadId,
          persistedObjective,
          command.expectedGoalId!,
          command.expectedRevision!,
        );
      } catch (error) {
        await cleanupGoalObjective(persistedObjective);
        throw error;
      }
      if (previous.objective !== persistedObjective) {
        await cleanupGoalObjective(previous.objective);
      }
      emitGoalUpdated(goal, activeTurns.get(command.threadId));
      try {
        await steerGoalObjectiveUpdate(goal);
      } catch (error) {
        diagnosticBundleService?.record({
          source: "main",
          severity: "warning",
          message: `Saved Goal objective could not steer the active turn: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      return store.getThread(command.threadId)!;
    },
  );

  ipcMain.handle(
    IPC.threadGoalPause,
    async (_event, threadId: string): Promise<Thread> => {
      if (!store) throw new Error("Application store is not ready.");
      const command = parseThreadCommand({
        type: "thread.goal.pause",
        threadId,
      });
      const goal = store.pauseThreadGoal(command.threadId);
      emitGoalUpdated(goal, activeTurns.get(command.threadId));
      await cancelRunningGoalContinuation(command.threadId);
      return store.getThread(command.threadId)!;
    },
  );

  ipcMain.handle(IPC.threadGoalResume, (_event, threadId: string): Thread => {
    if (!store) throw new Error("Application store is not ready.");
    const command = parseThreadCommand({
      type: "thread.goal.resume",
      threadId,
    });
    const goal = store.resumeThreadGoal(command.threadId);
    emitGoalUpdated(goal, activeTurns.get(command.threadId));
    scheduleGoalContinuation(command.threadId, goal.goalId);
    return store.getThread(command.threadId)!;
  });

  ipcMain.handle(
    IPC.threadGoalClear,
    async (_event, threadId: string): Promise<Thread> => {
      if (!store) throw new Error("Application store is not ready.");
      const command = parseThreadCommand({
        type: "thread.goal.clear",
        threadId,
      });
      const previousObjective = store.getThreadGoal(
        command.threadId,
      )?.objective;
      const cleared = store.clearThreadGoal(command.threadId);
      if (cleared) {
        emitGoalCleared(
          command.threadId,
          cleared,
          activeTurns.get(command.threadId),
        );
        await cancelRunningGoalContinuation(command.threadId);
        await cleanupGoalObjective(previousObjective);
      }
      return store.getThread(command.threadId)!;
    },
  );

  ipcMain.handle(
    IPC.threadArchive,
    async (_event, threadId: string, archived: boolean): Promise<Thread> => {
      if (!store || !agentProcess) {
        throw new Error("Application is not ready.");
      }
      const command = parseThreadCommand({
        type: "thread.archive",
        threadId,
        archived,
      });
      const thread = store.getThread(command.threadId);
      if (!thread) {
        throw new Error(`Thread not found: ${command.threadId}`);
      }
      if (
        command.archived &&
        (thread.status === "running" || thread.status === "waiting-approval")
      ) {
        throw new Error("Stop the active turn before archiving this task.");
      }
      if (command.archived && compactingThreads.has(thread.id)) {
        throw new Error(
          "Wait for context compaction before archiving this task.",
        );
      }
      if (command.archived && openedThreads.has(thread.id)) {
        await agentProcess.request({
          type: "thread.close",
          requestId: randomUUID(),
          threadId: thread.id,
        });
        openedThreads.delete(thread.id);
      }
      return store.updateThread(thread.id, { archived: command.archived });
    },
  );

  ipcMain.handle(
    IPC.threadDelete,
    async (_event, threadId: string): Promise<void> => {
      if (!store) {
        throw new Error("Application is not ready.");
      }
      const command = parseThreadCommand({
        type: "thread.delete",
        threadId,
      });
      threadId = command.threadId;
      const thread = store.getThread(threadId);
      if (!thread) {
        throw new Error(`Thread not found: ${threadId}`);
      }
      if (activeTurns.has(threadId)) {
        throw new Error("Stop the active turn before deleting this task.");
      }
      if (compactingThreads.has(threadId)) {
        throw new Error(
          "Wait for context compaction before deleting this task.",
        );
      }
      if (!thread.projectId) {
        if (openedThreads.has(threadId)) {
          if (!agentProcess?.available) {
            throw new Error(
              "Agent Host is unavailable. Restart Artemis before deleting this temporary conversation.",
            );
          }
          try {
            await agentProcess.request({
              type: "thread.close",
              requestId: randomUUID(),
              threadId,
            });
            openedThreads.delete(threadId);
          } catch (error) {
            diagnosticBundleService?.record({
              source: "agent-host",
              severity: "error",
              message: `Agent Host cleanup blocked temporary thread deletion ${threadId}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            });
            throw new Error(
              "Temporary conversation processes could not be stopped. Try deleting the conversation again.",
              { cause: error },
            );
          }
        }
        terminalService?.closeThread(threadId);
        try {
          await removeTemporaryConversationWorkspace(
            app.getPath("userData"),
            thread.id,
          );
        } catch (error) {
          diagnosticBundleService?.record({
            source: "main",
            severity: "error",
            message: `Temporary workspace cleanup blocked thread deletion ${threadId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          });
          throw new Error(
            "Temporary conversation workspace could not be removed. Try deleting the conversation again.",
            { cause: error },
          );
        }
      }
      let transcriptDeleted = false;
      if (agentProcess?.available) {
        try {
          await agentProcess.request({
            type: "thread.delete",
            requestId: randomUUID(),
            threadId,
            ...(thread.sessionFile ? { sessionFile: thread.sessionFile } : {}),
          });
          transcriptDeleted = true;
        } catch (error) {
          diagnosticBundleService?.record({
            source: "agent-host",
            severity: "warning",
            message: `Agent host could not close deleted thread ${threadId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          });
        }
      }
      if (!transcriptDeleted && thread.sessionFile) {
        try {
          await deletePiSessionTranscript(
            thread.sessionFile,
            piSessionsRoot(process.env, app.getPath("home")),
          );
        } catch (error) {
          diagnosticBundleService?.record({
            source: "main",
            severity: "warning",
            message: `Pi transcript cleanup failed for deleted thread ${threadId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          });
        }
      }
      const goalObjective = store.getThreadGoal(threadId)?.objective;
      openedThreads.delete(threadId);
      await turnChangeSetCompletionTails.get(threadId);
      await turnChangeSetService?.deleteThread(threadId);
      await taskSourceImages().deleteThread(threadId);
      store.deleteThread(threadId);
      await cleanupGoalObjective(goalObjective);
    },
  );

  ipcMain.handle(
    IPC.threadFork,
    async (
      _event,
      threadId: string,
      entryId?: string,
    ): Promise<ForkThreadResult> => {
      if (!store || !agentProcess) {
        throw new Error("Application is not ready.");
      }
      const appStore = store;
      const command = parseThreadCommand({
        type: "thread.fork",
        threadId,
        ...(entryId ? { entryId } : {}),
      });
      const source = appStore.getThread(command.threadId);
      if (!source) {
        throw new Error(`Thread not found: ${command.threadId}`);
      }
      if (source.status === "running" || source.status === "waiting-approval") {
        throw new Error("Stop the active turn before forking this task.");
      }
      if (compactingThreads.has(source.id)) {
        throw new Error(
          "Wait for context compaction before forking this task.",
        );
      }
      const sourceContext = await resolveThreadWorkspace(source);
      await openAgentThread(source);
      const fork = await agentProcess.request<{ sessionFile: string }>({
        type: "thread.fork",
        requestId: randomUUID(),
        threadId: source.id,
        ...(command.entryId ? { entryId: command.entryId } : {}),
      });
      const now = new Date().toISOString();
      const forkedThread: Thread = {
        id: randomUUID(),
        ...(source.projectId ? { projectId: source.projectId } : {}),
        title: `${source.title}${mainText(currentLocale(), "forkSuffix")}`,
        mode: source.mode,
        target: source.target === "local" ? "local" : "managed-worktree",
        status: "idle",
        sessionFile: fork.sessionFile,
        ...(source.modelSelection
          ? { modelSelection: structuredClone(source.modelSelection) }
          : {}),
        ...(source.contextWindow
          ? { contextWindow: source.contextWindow }
          : {}),
        pinned: false,
        archived: false,
        createdAt: now,
        updatedAt: now,
      };
      const persistFork = async (
        create: () => ForkThreadResult,
      ): Promise<ForkThreadResult> => {
        await taskSourceImages().copyThread(source.id, forkedThread.id);
        try {
          return create();
        } catch (error) {
          try {
            await taskSourceImages().deleteThread(forkedThread.id);
          } catch (cleanupError) {
            throw new AggregateError(
              [error, cleanupError],
              "Task fork failed and its copied source images could not be removed.",
            );
          }
          throw error;
        }
      };
      if (forkedThread.target === "local") {
        if (!source.projectId) {
          let workspaceCopied = false;
          try {
            await copyTemporaryConversationWorkspace(
              app.getPath("userData"),
              source.id,
              forkedThread.id,
            );
            workspaceCopied = true;
            return await persistFork(() =>
              appStore.createForkedThread(forkedThread, source.id),
            );
          } catch (error) {
            const cleanupErrors: unknown[] = [error];
            if (workspaceCopied) {
              try {
                await removeTemporaryConversationWorkspace(
                  app.getPath("userData"),
                  forkedThread.id,
                );
              } catch (cleanupError) {
                cleanupErrors.push(cleanupError);
              }
            }
            try {
              await deletePiSessionTranscript(
                fork.sessionFile,
                piSessionsRoot(process.env, app.getPath("home")),
              );
            } catch (cleanupError) {
              cleanupErrors.push(cleanupError);
            }
            if (cleanupErrors.length > 1) {
              throw new AggregateError(
                cleanupErrors,
                "Temporary conversation fork failed and one or more artifacts could not be removed.",
              );
            }
            throw error;
          }
        }
        return await persistFork(() =>
          appStore.createForkedThread(forkedThread, source.id),
        );
      }

      const sourceRegistration = (
        await listGitWorktrees(sourceContext.project.path)
      ).find((item) => pathsEqual(item.path, sourceContext.workspacePath));
      if (!sourceRegistration) {
        throw new Error("Source task worktree is not registered with Git.");
      }
      const worktree = await createManagedTaskWorktree(
        sourceContext.project,
        forkedThread.id,
        sourceRegistration.head,
      );
      try {
        return await persistFork(() =>
          appStore.createForkedThreadWithWorktree(
            forkedThread,
            worktree,
            source.id,
          ),
        );
      } catch (error) {
        try {
          await removeManagedWorktree({
            repositoryPath: sourceContext.project.path,
            managedRoot: managedWorktreeRoot(sourceContext.project.id),
            worktreePath: worktree.path,
            recoveryRoot: worktreeRecoveryRoot(sourceContext.project.id),
            force: false,
          });
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            "Task fork failed and its clean worktree could not be removed.",
          );
        }
        throw error;
      }
    },
  );

  ipcMain.handle(
    IPC.threadCompact,
    async (_event, threadId: string, instructions?: string): Promise<void> => {
      if (!store || !agentProcess) {
        throw new Error("Application is not ready.");
      }
      const command = parseThreadCommand({
        type: "thread.compact",
        threadId,
        ...(instructions ? { instructions } : {}),
      });
      const thread = store.getThread(command.threadId);
      if (!thread) {
        throw new Error(`Thread not found: ${command.threadId}`);
      }
      if (thread.archived) {
        throw new Error("Archived tasks cannot compact context.");
      }
      if (
        thread.status === "running" ||
        thread.status === "waiting-approval" ||
        activeTurns.has(thread.id)
      ) {
        throw new Error("Stop the active turn before compacting context.");
      }
      if (compactingThreads.has(thread.id)) {
        throw new Error("Context compaction is already running.");
      }

      compactingThreads.add(thread.id);
      try {
        await openAgentThread(thread);
        await agentProcess.request({
          type: "thread.compact",
          requestId: randomUUID(),
          threadId: thread.id,
          ...(command.instructions
            ? { instructions: command.instructions }
            : {}),
        });
      } finally {
        compactingThreads.delete(thread.id);
      }
    },
  );

  ipcMain.handle(
    IPC.worktreeBranchize,
    async (
      _event,
      threadId: string,
      branchName: string,
    ): Promise<TaskWorktree> => {
      if (!store) {
        throw new Error("Application store is not ready.");
      }
      const command = worktreeCommandSchema.parse({
        type: "worktree.branchize",
        threadId,
        branchName,
      });
      if (command.type !== "worktree.branchize") {
        throw new Error("Invalid worktree command.");
      }
      const thread = store.getThread(command.threadId);
      if (!thread) {
        throw new Error(`Thread not found: ${command.threadId}`);
      }
      if (!conversationSupportsProjectFeatures(thread)) {
        throw new Error(
          "Temporary conversations do not support worktree branches.",
        );
      }
      if (
        thread.status === "running" ||
        thread.status === "waiting-approval" ||
        activeTurns.has(thread.id)
      ) {
        throw new Error("Stop the active turn before creating a branch.");
      }
      const context = await resolveThreadWorkspace(thread);
      if (!context.worktree || context.worktree.target !== "managed-worktree") {
        throw new Error("Task does not use a managed worktree.");
      }
      const branched = await branchizeManagedWorktree({
        repositoryPath: context.project.path,
        managedRoot: managedWorktreeRoot(context.project.id),
        worktreePath: context.worktree.path,
        branchName: command.branchName,
      });
      return store.updateWorktree(context.worktree.id, {
        head: branched.head,
        ...(branched.branch ? { branch: branched.branch } : {}),
      });
    },
  );

  ipcMain.handle(
    IPC.worktreeCleanup,
    async (
      _event,
      threadId: string,
      force: boolean,
    ): Promise<CleanupWorktreeResult> => {
      if (!store || !agentProcess) {
        throw new Error("Application is not ready.");
      }
      const command = worktreeCommandSchema.parse({
        type: "worktree.cleanup",
        threadId,
        force,
      });
      if (command.type !== "worktree.cleanup") {
        throw new Error("Invalid worktree command.");
      }
      const thread = store.getThread(command.threadId);
      if (!thread) {
        throw new Error(`Thread not found: ${command.threadId}`);
      }
      if (
        thread.status === "running" ||
        thread.status === "waiting-approval" ||
        activeTurns.has(thread.id)
      ) {
        throw new Error("Stop the active turn before cleaning its worktree.");
      }
      const context = await resolveThreadWorkspace(thread);
      if (!context.worktree || context.worktree.target !== "managed-worktree") {
        throw new Error("Task does not use a managed worktree.");
      }
      if (openedThreads.has(thread.id)) {
        await agentProcess.request({
          type: "thread.close",
          requestId: randomUUID(),
          threadId: thread.id,
        });
        openedThreads.delete(thread.id);
      }
      const removed = await removeManagedWorktree({
        repositoryPath: context.project.path,
        managedRoot: managedWorktreeRoot(context.project.id),
        worktreePath: context.worktree.path,
        recoveryRoot: worktreeRecoveryRoot(context.project.id),
        force: command.force,
      });
      return store.completeWorktreeCleanup(
        thread.id,
        context.worktree.id,
        removed.recoveryPath,
      );
    },
  );

  ipcMain.handle(
    IPC.worktreeRestoreSnapshot,
    async (
      _event,
      worktreeId: string,
    ): Promise<RestoreWorktreeSnapshotResult> => {
      if (!store) {
        throw new Error("Application is not ready.");
      }
      if (
        typeof worktreeId !== "string" ||
        !worktreeId.trim() ||
        worktreeId.length > 100
      ) {
        throw new Error("Worktree recovery ID is invalid.");
      }
      const worktree = store.getWorktree(worktreeId);
      if (
        !worktree ||
        worktree.status !== "removed" ||
        !worktree.recoveryPath
      ) {
        throw new Error("Recoverable Worktree snapshot was not found.");
      }
      const thread = store.getThread(worktree.threadId);
      const project = store.getProject(worktree.projectId);
      if (!thread || !project) {
        throw new Error("Snapshot task or project was not found.");
      }
      if (
        thread.status === "running" ||
        thread.status === "waiting-approval" ||
        activeTurns.has(thread.id)
      ) {
        throw new Error("Stop the active turn before restoring its snapshot.");
      }
      const restored = await restoreWorktreeSnapshot({
        recoveryRoot: worktreeRecoveryRoot(project.id),
        recoveryPath: worktree.recoveryPath,
        targetWorkspace: project.path,
      });
      return {
        worktree: store.clearWorktreeRecovery(worktree.id),
        restoredFiles: restored.restoredFiles,
      };
    },
  );

  ipcMain.handle(
    IPC.worktreeHandoff,
    async (
      _event,
      threadId: string,
      destination: "local" | "managed-worktree",
    ): Promise<HandoffWorkspaceResult> => {
      if (!store || !agentProcess) {
        throw new Error("Application is not ready.");
      }
      const command = worktreeCommandSchema.parse({
        type: "worktree.handoff",
        threadId,
        destination,
      });
      if (command.type !== "worktree.handoff") {
        throw new Error("Invalid worktree command.");
      }
      const thread = store.getThread(command.threadId);
      if (!thread) {
        throw new Error(`Thread not found: ${command.threadId}`);
      }
      if (!conversationSupportsProjectFeatures(thread)) {
        throw new Error(
          "Temporary conversations do not support workspace handoff.",
        );
      }
      if (
        thread.status === "running" ||
        thread.status === "waiting-approval" ||
        activeTurns.has(thread.id)
      ) {
        throw new Error(
          "Stop the active turn before handing off its workspace.",
        );
      }
      const currentDestination =
        thread.target === "local" ? "local" : "managed-worktree";
      if (currentDestination === command.destination) {
        throw new Error("Task already uses the requested workspace.");
      }
      const context = await resolveThreadWorkspace(thread);
      if (openedThreads.has(thread.id)) {
        await agentProcess.request({
          type: "thread.close",
          requestId: randomUUID(),
          threadId: thread.id,
        });
        openedThreads.delete(thread.id);
      }

      if (command.destination === "managed-worktree") {
        const worktree = await createManagedTaskWorktree(
          context.project,
          thread.id,
        );
        let bundlePath: string | undefined;
        try {
          const bundle = await createWorkspaceChangeBundle({
            sourceWorkspace: context.project.path,
            bundleRoot: handoffBundleRoot(context.project.id, thread.id),
            paths: store.getThreadChangedFiles(thread.id),
          });
          bundlePath = bundle.path;
          await applyWorkspaceChangeBundle({
            bundlePath: bundle.path,
            targetWorkspace: worktree.path,
          });
          const attached = store.attachWorktreeToThread(thread.id, {
            ...worktree,
            recoveryPath: bundle.path,
          });
          return {
            thread: attached.thread,
            worktree: attached.worktree,
            bundlePath: bundle.path,
          };
        } catch (error) {
          try {
            await removeManagedWorktree({
              repositoryPath: context.project.path,
              managedRoot: managedWorktreeRoot(context.project.id),
              worktreePath: worktree.path,
              recoveryRoot: worktreeRecoveryRoot(context.project.id),
              force: true,
            });
          } catch (cleanupError) {
            throw new AggregateError(
              [error, cleanupError],
              "Handoff failed and its temporary worktree could not be removed.",
            );
          }
          throw new Error(
            `${error instanceof Error ? error.message : String(error)}${
              bundlePath ? ` Recovery bundle: ${bundlePath}` : ""
            }`,
          );
        }
      }

      if (!context.worktree || context.worktree.target !== "managed-worktree") {
        throw new Error("Task does not use a managed worktree.");
      }
      const bundle = await createWorkspaceChangeBundle({
        sourceWorkspace: context.worktree.path,
        bundleRoot: handoffBundleRoot(context.project.id, thread.id),
      });
      await applyWorkspaceChangeBundle({
        bundlePath: bundle.path,
        targetWorkspace: context.project.path,
      });
      let removed: Awaited<ReturnType<typeof removeManagedWorktree>>;
      try {
        removed = await removeManagedWorktree({
          repositoryPath: context.project.path,
          managedRoot: managedWorktreeRoot(context.project.id),
          worktreePath: context.worktree.path,
          recoveryRoot: worktreeRecoveryRoot(context.project.id),
          force: true,
        });
      } catch (error) {
        throw new Error(
          `Changes were copied to Local, but the managed worktree could not be removed. The task still points to the worktree. ${
            error instanceof Error ? error.message : String(error)
          } Recovery bundle: ${bundle.path}`,
        );
      }
      const completed = store.completeWorktreeCleanup(
        thread.id,
        context.worktree.id,
        removed.recoveryPath ?? bundle.path,
      );
      return {
        thread: completed.thread,
        worktree: completed.worktree,
        bundlePath: bundle.path,
      };
    },
  );

  ipcMain.handle(
    IPC.turnStart,
    (_event, input: StartTurnInput): Promise<StartTurnResult> =>
      startTaskTurn(input),
  );

  ipcMain.on(IPC.turnRendered, (_event, turnId: string, renderedAt: number) => {
    const trace = turnLatencyTraces.get(String(turnId ?? ""));
    if (
      !trace ||
      trace.rendererPaintAt !== undefined ||
      typeof renderedAt !== "number" ||
      !Number.isFinite(renderedAt) ||
      Math.abs(Date.now() - renderedAt) >= 5 * 60_000
    ) {
      return;
    }
    trace.rendererPaintAt = renderedAt;
  });

  ipcMain.handle(IPC.turnSteer, (_event, input: QueueTurnInput) =>
    queueTurn("turn.steer", input),
  );

  ipcMain.handle(IPC.turnFollowUp, (_event, input: QueueTurnInput) =>
    queueTurn("turn.follow-up", input),
  );

  ipcMain.handle(IPC.turnQueueClear, (_event, threadId: string) =>
    controlTurnQueue("turn.queue.clear", threadId),
  );

  ipcMain.handle(IPC.turnQueueSteer, (_event, threadId: string) =>
    controlTurnQueue("turn.queue.steer", threadId),
  );

  ipcMain.handle(
    IPC.turnQueueSteerItem,
    (_event, input: SteerQueuedTurnInput) => steerQueuedTurn(input),
  );

  ipcMain.handle(
    IPC.turnQueueReplace,
    async (_event, input: ReplaceQueuedTurnInput) => {
      if (
        smokeMode &&
        process.env.ARTEMIS_SMOKE_VIEW?.startsWith("queued-steer")
      ) {
        if (process.env.ARTEMIS_SMOKE_VIEW === "queued-steer-save-error") {
          throw new Error("Simulated queued message save failure.");
        }
        emitPayload(input.threadId, undefined, {
          type: "queue.updated",
          steering: [],
          followUp: input.expectedFollowUp.map(
            (text, index) =>
              input.followUp.find((item) => item.sourceIndex === index)?.text ??
              text,
          ),
        });
        // The runtime applies the queue change, emits queue.updated, and only
        // then acknowledges the request. Mirror that order and give the
        // renderer's rAF-batched event flush time to commit the new queue
        // before the acknowledgment closes the editor, so the focus-return
        // target is the final row rather than one that remounts.
        await new Promise((resolve) => setTimeout(resolve, 150));
        return;
      }
      return replaceTurnQueue(input);
    },
  );

  ipcMain.handle(IPC.turnCancel, (_event, threadId: string) =>
    cancelTaskTurn(threadId),
  );

  ipcMain.handle(
    IPC.turnChangesUndo,
    async (
      _event,
      threadId: string,
      turnId: string,
    ): Promise<UndoTurnChangesResult> => {
      if (!store || !turnChangeSetService) {
        throw new Error("Application is not ready.");
      }
      const thread = store.getThread(threadId);
      if (!thread) throw new Error("Task was not found.");
      if (
        thread.status === "running" ||
        thread.status === "waiting-approval" ||
        activeTurns.has(threadId) ||
        turnChangeSetCompletionTails.has(threadId)
      ) {
        throw new Error(
          "Wait for the active turn to finish before undoing files.",
        );
      }
      const { result, payload } = await turnChangeSetService.undo(
        threadId,
        turnId,
      );
      emitPayload(threadId, turnId, payload);
      return result;
    },
  );

  ipcMain.handle(
    IPC.childAgentControl,
    async (
      _event,
      input: ChildAgentControlInput,
    ): Promise<ChildAgentControlResult> => {
      if (!agentProcess || !store) {
        throw new Error("Application is not ready.");
      }
      if (
        !input ||
        typeof input !== "object" ||
        typeof input.threadId !== "string" ||
        !input.threadId.trim() ||
        typeof input.agentId !== "string" ||
        !input.agentId.trim() ||
        !["status", "steer", "cancel", "retry"].includes(input.action)
      ) {
        throw new Error("Sub-agent control request is invalid.");
      }
      const thread = store.getThread(input.threadId);
      if (!thread) throw new Error("Task was not found.");
      if (
        input.action === "steer" &&
        (typeof input.message !== "string" || !input.message.trim())
      ) {
        throw new Error("Sub-agent steering message is required.");
      }
      const requestId = randomUUID();
      const command =
        input.action === "steer"
          ? {
              type: "child.steer" as const,
              requestId,
              threadId: input.threadId,
              agentId: input.agentId,
              text: input.message!.trim(),
            }
          : {
              type: `child.${input.action}` as
                "child.status" | "child.cancel" | "child.retry",
              requestId,
              threadId: input.threadId,
              agentId: input.agentId,
            };
      return agentProcess.request<ChildAgentControlResult>(command, 10_000);
    },
  );

  ipcMain.handle(
    IPC.agentTeamControl,
    async (
      _event,
      input: AgentTeamControlInput,
    ): Promise<AgentTeamControlResult> => {
      if (!agentProcess || !store) {
        throw new Error("Application is not ready.");
      }
      if (
        !input ||
        typeof input !== "object" ||
        typeof input.threadId !== "string" ||
        !input.threadId.trim() ||
        typeof input.teamId !== "string" ||
        !input.teamId.trim() ||
        input.action !== "cancel"
      ) {
        throw new Error("Agent-team control request is invalid.");
      }
      if (!store.getThread(input.threadId)) {
        throw new Error("Task was not found.");
      }
      return agentProcess.request<AgentTeamControlResult>(
        {
          type: "team.cancel",
          requestId: randomUUID(),
          threadId: input.threadId,
          teamId: input.teamId,
        },
        10_000,
      );
    },
  );

  ipcMain.handle(
    IPC.approvalResolve,
    (_event, resolution: ApprovalResolution) =>
      resolveApproval(approvalResolutionSchema.parse(resolution)),
  );

  ipcMain.handle(
    IPC.userInputResolve,
    (_event, resolution: UserInputResolution) => {
      const parsed = userInputResolutionSchema.parse(resolution);
      // Fail-closed semantics are unchanged: a malformed resolution of
      // either form throws in parse and the invoke rejects, and
      // completeMultiUserInputQuestion re-throws for unknown or
      // already-answered questions, so duplicate submits stay rejected.
      if (isMultiQuestionUserInputResolution(parsed)) {
        completeMultiUserInputQuestion(
          parsed.requestId,
          parsed.nonce,
          parsed.questionId,
          "user",
          parsed.customAnswer !== undefined
            ? { customAnswer: parsed.customAnswer }
            : parsed.selectedOptionLabel !== undefined
              ? { selectedOptionLabel: parsed.selectedOptionLabel }
              : {},
        );
        return;
      }
      completeUserInput(parsed, "user");
    },
  );

  ipcMain.handle(
    IPC.automationList,
    (_event, projectId?: string): Automation[] => {
      if (!store) throw new Error("Application store is not ready.");
      if (
        projectId !== undefined &&
        (typeof projectId !== "string" || !projectId.trim())
      ) {
        throw new Error("Automation project ID is invalid.");
      }
      return store.listAutomations(projectId);
    },
  );
  ipcMain.handle(
    IPC.automationRunList,
    (_event, automationId: string, limit?: number): AutomationRun[] => {
      if (!store) throw new Error("Application store is not ready.");
      if (typeof automationId !== "string" || !automationId.trim()) {
        throw new Error("Automation ID is invalid.");
      }
      return store.listAutomationRuns(automationId, limit);
    },
  );
  ipcMain.handle(
    IPC.automationSave,
    (_event, input: SaveAutomationInput): Promise<Automation> =>
      saveAutomation(input),
  );
  ipcMain.handle(
    IPC.automationEnable,
    (_event, id: string, enabled: boolean): Promise<Automation> => {
      if (typeof id !== "string" || typeof enabled !== "boolean") {
        throw new Error("Automation enable request is invalid.");
      }
      return setAutomationEnabled(id, enabled);
    },
  );
  ipcMain.handle(
    IPC.automationAuthorize,
    (_event, id: string): Promise<Automation | undefined> => {
      if (typeof id !== "string" || !id.trim()) {
        throw new Error("Automation ID is invalid.");
      }
      return authorizeAutomation(id);
    },
  );
  ipcMain.handle(IPC.automationDelete, async (_event, id: string) => {
    if (!store) throw new Error("Application store is not ready.");
    if (typeof id !== "string" || !id.trim()) {
      throw new Error("Automation ID is invalid.");
    }
    if (store.hasActiveAutomationRun(id)) {
      throw new Error("Stop the active scheduled task before deleting it.");
    }
    store.softDeleteAutomation(id);
    automationDeleted(id);
    await automationScheduler?.refresh();
  });
  ipcMain.handle(
    IPC.automationRunNow,
    (_event, id: string): Promise<AutomationRun> => {
      if (!automationScheduler) {
        throw new Error("Automation scheduler is not ready.");
      }
      if (typeof id !== "string" || !id.trim()) {
        throw new Error("Automation ID is invalid.");
      }
      return automationScheduler.runNow(id);
    },
  );

  ipcMain.handle(
    IPC.reviewDiff,
    async (_event, untrustedQuery: ReviewQuery): Promise<ReviewDiff> => {
      if (!store) {
        throw new Error("Application store is not ready.");
      }
      const query = reviewQuerySchema.parse(untrustedQuery);
      const thread = store.getThread(query.threadId);
      if (!thread) {
        return {
          available: false,
          scope: query.scope,
          text: "",
          files: [],
          message: "Project not found.",
        };
      }
      if (!conversationSupportsProjectFeatures(thread)) {
        return {
          available: false,
          scope: query.scope,
          text: "",
          files: [],
          message: "Temporary conversations do not have a project review.",
        };
      }
      if (query.scope === "turn") {
        return (
          turnChangeSetService?.review(thread.id, query.turnId!) ?? {
            available: false,
            scope: "turn",
            text: "",
            files: [],
            message: "Turn review is unavailable.",
          }
        );
      }
      try {
        const context = await resolveThreadWorkspace(thread);
        return await getReviewDiff({
          workspace: context.workspacePath,
          scope: query.scope,
          ...(query.baseRef ? { baseRef: query.baseRef } : {}),
          ...(query.scope === "last-turn"
            ? { paths: store.getLastTurnChangedFiles(thread.id) }
            : {}),
        });
      } catch (error) {
        return {
          available: false,
          scope: query.scope,
          text: "",
          files: [],
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );

  ipcMain.handle(
    IPC.reviewMutate,
    async (
      _event,
      untrustedInput: ReviewMutationInput,
    ): Promise<ReviewMutationResult> => {
      if (!store) {
        throw new Error("Application store is not ready.");
      }
      const input = reviewMutationInputSchema.parse(untrustedInput);
      const thread = store.getThread(input.threadId);
      if (!thread) {
        throw new Error("Project not found.");
      }
      if (!conversationSupportsProjectFeatures(thread)) {
        throw new Error(
          "Temporary conversations do not have a project review.",
        );
      }
      if (input.scope === "turn") {
        throw new Error("Turn review is immutable and read-only.");
      }
      if (
        thread.status === "running" ||
        thread.status === "waiting-approval" ||
        activeTurns.has(thread.id)
      ) {
        throw new Error("Review actions are disabled while a turn is active.");
      }
      const context = await resolveThreadWorkspace(thread);
      return mutateReviewDiff({
        workspace: context.workspacePath,
        scope: input.scope,
        action: input.action,
        target: input.target,
        recoveryRoot: join(app.getPath("userData"), "review-recovery"),
        ...(input.baseRef ? { baseRef: input.baseRef } : {}),
        ...(input.scope === "last-turn"
          ? { paths: store.getLastTurnChangedFiles(thread.id) }
          : {}),
      });
    },
  );

  ipcMain.handle(
    IPC.reviewCommentList,
    (_event, threadId: string): ReviewComment[] => {
      if (!store) {
        throw new Error("Application store is not ready.");
      }
      if (
        typeof threadId !== "string" ||
        !threadId ||
        threadId.length > 100 ||
        !store.getThread(threadId)
      ) {
        throw new Error("Review task was not found.");
      }
      return store.listReviewComments(threadId);
    },
  );

  ipcMain.handle(
    IPC.reviewCommentAdd,
    async (
      _event,
      untrustedInput: AddReviewCommentInput,
    ): Promise<ReviewComment> => {
      if (!store) {
        throw new Error("Application store is not ready.");
      }
      const query = reviewQuerySchema.parse(untrustedInput);
      const lineId =
        typeof untrustedInput?.lineId === "string"
          ? untrustedInput.lineId.trim()
          : "";
      const body =
        typeof untrustedInput?.body === "string"
          ? untrustedInput.body.trim()
          : "";
      if (!lineId || lineId.length > 128) {
        throw new Error("Review line anchor is invalid.");
      }
      if (!body || Buffer.byteLength(body, "utf8") > 16 * 1024) {
        throw new Error(
          "Review comment must contain between 1 byte and 16 KiB.",
        );
      }
      const thread = store.getThread(query.threadId);
      if (!thread) {
        throw new Error("Review task was not found.");
      }
      const context = await resolveThreadWorkspace(thread);
      const diff = await getReviewDiff({
        workspace: context.workspacePath,
        scope: query.scope,
        ...(query.baseRef ? { baseRef: query.baseRef } : {}),
        ...(query.scope === "last-turn"
          ? { paths: store.getLastTurnChangedFiles(thread.id) }
          : {}),
      });
      for (const file of diff.files) {
        for (const hunk of file.hunks) {
          const line = hunk.lines.find((candidate) => candidate.id === lineId);
          if (line) {
            return store.addReviewComment(
              thread.id,
              {
                scope: query.scope,
                lineId,
                path: file.path,
                kind: line.kind,
                text: line.text,
                ...(line.oldLine === undefined
                  ? {}
                  : { oldLine: line.oldLine }),
                ...(line.newLine === undefined
                  ? {}
                  : { newLine: line.newLine }),
              },
              body,
            );
          }
        }
      }
      throw new Error(
        "Review line changed before the comment was saved. Refresh and retry.",
      );
    },
  );

  ipcMain.handle(
    IPC.reviewCommentDelete,
    (_event, threadId: string, commentId: string): void => {
      if (!store) {
        throw new Error("Application store is not ready.");
      }
      if (
        typeof threadId !== "string" ||
        typeof commentId !== "string" ||
        !threadId ||
        !commentId ||
        threadId.length > 100 ||
        commentId.length > 100
      ) {
        throw new Error("Review comment identity is invalid.");
      }
      store.deleteReviewComment(threadId, commentId);
    },
  );
}

function isEmbeddedBrowserNavigationAllowed(url: string): boolean {
  if (url === "about:blank" || url === "about:srcdoc") return true;
  try {
    const protocol = new URL(url).protocol;
    return (
      protocol === "http:" ||
      protocol === "https:" ||
      protocol === "data:" ||
      protocol === "blob:"
    );
  } catch {
    return false;
  }
}

function seedSmokeUserInputFixture(): void {
  if (!store || !process.env.ARTEMIS_SMOKE_USER_INPUT) return;
  const now = new Date().toISOString();
  const localized = process.env.ARTEMIS_SMOKE_LOCALE === "zh-CN";
  const projectId = "artemis-smoke-project";
  const threadId = "artemis-smoke-user-input";
  store.upsertProject({
    id: projectId,
    name: "Artemis",
    path: process.cwd(),
    createdAt: now,
    updatedAt: now,
  });
  store.createThread({
    id: threadId,
    projectId,
    title: localized ? "确认实施计划" : "Confirm the plan",
    mode: "execute",
    target: "local",
    status: "running",
    pinned: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
  });
  store.appendEvent("artemis-smoke-user-input-event", threadId, "smoke-turn", {
    type: "user-input.requested",
    requestId: "artemis-smoke-request",
    nonce: "artemis-smoke-nonce-0001",
    header: localized ? "计划确认" : "Confirmation",
    question: localized ? "实施此计划？" : "Implement this plan?",
    options: localized
      ? [
          {
            label: "是，实施此计划",
            description: "按当前方案继续实施。",
            recommended: true,
          },
          {
            label: "先调整计划",
            description: "说明需要修改的内容后再继续。",
            recommended: false,
          },
        ]
      : [
          {
            label: "Yes, implement this plan",
            description: "Continue with the plan as written.",
            recommended: true,
          },
          {
            label: "Revise the plan first",
            description: "Describe what should change before continuing.",
            recommended: false,
          },
        ],
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
  });
}

async function seedSmokeUserInputTransportFixture(): Promise<void> {
  // The smokeMode guard matches seedSmokeInputFieldsFixture: seeding stays
  // a smoke-harness-only behavior so a merely VIEW-tagged process can never
  // write smoke fixtures into a real profile.
  const view = process.env.ARTEMIS_SMOKE_VIEW;
  if (!store || !smokeMode || view !== "user-input-transport") {
    return;
  }
  const fixtureDirectory = join(
    app.getPath("userData"),
    "fixtures",
    "user-input-transport",
  );
  await mkdir(fixtureDirectory, { recursive: true });
  const now = new Date().toISOString();
  const projectId = "artemis-smoke-project";
  const threadId = "artemis-smoke-user-input-transport";
  store.upsertProject({
    id: projectId,
    name: "Artemis",
    path: fixtureDirectory,
    createdAt: now,
    updatedAt: now,
  });
  store.createThread({
    id: threadId,
    projectId,
    title: "Transport smoke",
    mode: "execute",
    target: "local",
    status: "running",
    pinned: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
  });
}

// D#76 PR10C multi-question UI smoke seeding (A8). Unlike the #124
// transport driver, this fixture only SEEDS state; the interactive evidence
// (real CDP Input-level clicks and keys, Q1 -> Q2 -> Q3) is driven by
// scripts/verify-user-input-multi-ui.mjs against the real renderer. The
// multi card rides the exact #124 smoke channel (a real registry
// registration plus a real user-input.requested payload through
// emitPayload), the legacy regression card rides the real single-question
// broker handler, and the cancel arm is driven through the renderer's own
// cancelTurn IPC. The seed runs at the registerIpc point (after
// agentProcess exists so the real broker handlers are live) and before the
// window loads so the renderer replays the seeded cards from the store.
type SmokeMultiQuestionUiQuestion = {
  questionId: string;
  question: string;
  options: Array<{
    label: string;
    description: string;
    recommended: boolean;
  }>;
  expiresAt: string;
};

function registerSmokeMultiQuestionUiPendingInput(input: {
  requestId: string;
  nonce: string;
  workerRequestId: string;
  threadId: string;
  turnId: string;
  workspacePath: string;
  header: string;
  questions: SmokeMultiQuestionUiQuestion[];
}): void {
  pendingMultiUserInputs.register({
    requestId: input.requestId,
    nonce: input.nonce,
    questions: input.questions.map((question) => ({
      questionId: question.questionId,
      options: question.options,
      expiresAt: question.expiresAt,
    })),
    value: {
      workerRequestId: input.workerRequestId,
      request: {
        kind: "user.input",
        approvalId: input.requestId,
        threadId: input.threadId,
        turnId: input.turnId,
        workspacePath: input.workspacePath,
        header: input.header,
        questions: input.questions.map(({ questionId, question, options }) => ({
          questionId,
          question,
          options,
        })),
        mode: "execute",
      },
      timeouts: new Map(),
    },
  });
  emitPayload(input.threadId, input.turnId, {
    type: "user-input.requested",
    kind: "multi-question",
    requestId: input.requestId,
    nonce: input.nonce,
    header: input.header,
    questions: input.questions.map(
      ({ questionId, question, options, expiresAt }) => ({
        questionId,
        question,
        options,
        expiresAt,
      }),
    ),
  });
}

async function seedSmokeMultiQuestionUiFixture(): Promise<void> {
  const view = process.env.ARTEMIS_SMOKE_VIEW;
  // PR10C review (severe 1): dedicated sentinel gate mirroring the
  // ARTEMIS_SMOKE_USER_INPUT fixture contract — a bare
  // ARTEMIS_SMOKE_VIEW=multi-question-ui* must never seed the store.
  if (
    !store ||
    process.env.ARTEMIS_SMOKE_MULTI_UI !== "1" ||
    !view?.startsWith("multi-question-ui")
  ) {
    return;
  }
  const fixtureDirectory = join(
    app.getPath("userData"),
    "fixtures",
    "multi-question-ui",
  );
  await mkdir(fixtureDirectory, { recursive: true });
  const now = new Date().toISOString();
  const projectId = "artemis-smoke-project";
  const threadId = "artemis-smoke-multi-ui-thread";
  const turnId = "artemis-smoke-multi-ui-turn";
  store.upsertProject({
    id: projectId,
    name: "Artemis",
    path: fixtureDirectory,
    createdAt: now,
    updatedAt: now,
  });
  store.createThread({
    id: threadId,
    projectId,
    title: "Multi-question UI smoke",
    mode: "execute",
    target: "local",
    status: "running",
    pinned: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
  });
  // The real broker and cancel paths validate turn ownership, so the seeded
  // turn stays "active" exactly like a live broker request (#124 channel).
  activeTurns.set(threadId, turnId);
  // Long, staggered per-question deadlines: the UI drive asserts each
  // question's countdown reads its own expiresAt, and no real timer ever
  // fires mid-drive (these registry entries carry no armed timers).
  const liveDeadline = (offsetSeconds: number) =>
    new Date(Date.now() + 10 * 60_000 + offsetSeconds * 1_000).toISOString();
  if (view === "multi-question-ui") {
    // Legacy single-question regression card through the REAL broker
    // handler (validator, registry, five-minute timer, requested payload)
    // alongside the multi card, mirroring the #124 smoke layout.
    handleUserInputBrokerRequest("artemis-smoke-multi-ui-single-worker", {
      kind: "user.input",
      approvalId: "artemis-smoke-multi-ui-single",
      threadId,
      turnId,
      workspacePath: fixtureDirectory,
      header: "Confirmation",
      question: "Run the legacy release checklist?",
      options: [
        {
          label: "Yes, run the checklist",
          description: "Execute every legacy step.",
          recommended: true,
        },
        {
          label: "Skip the checklist",
          description: "Continue without the legacy steps.",
          recommended: false,
        },
      ],
      mode: "execute",
    });
    registerSmokeMultiQuestionUiPendingInput({
      requestId: "artemis-smoke-multi-ui",
      nonce: "artemis-smoke-multi-ui-nonce",
      workerRequestId: "artemis-smoke-multi-ui-worker",
      threadId,
      turnId,
      workspacePath: fixtureDirectory,
      header: "Plan check",
      questions: [
        {
          questionId: "q1",
          question: "Ship the release on Friday?",
          options: [
            {
              label: "Ship it",
              description: "Release the build on Friday.",
              recommended: true,
            },
            {
              label: "Hold the release",
              description: "Wait one more day.",
              recommended: false,
            },
          ],
          expiresAt: liveDeadline(0),
        },
        {
          questionId: "q2",
          question: "Who is notified first?",
          options: [
            {
              label: "Email digest",
              description: "Send a summary by email.",
              recommended: true,
            },
            {
              label: "In-app banner",
              description: "Show a banner in the app.",
              recommended: false,
            },
            {
              label: "Slack channel",
              description: "Post to the release channel.",
              recommended: false,
            },
          ],
          expiresAt: liveDeadline(30),
        },
        {
          questionId: "q3",
          question: "Add anything to the notes?",
          options: [
            {
              label: "No, keep it short",
              description: "Ship the notes as-is.",
              recommended: true,
            },
            {
              label: "Yes, expand the notes",
              description: "Add the migration details.",
              recommended: false,
            },
          ],
          expiresAt: liveDeadline(60),
        },
      ],
    });
    return;
  }
  if (view === "multi-question-ui-expired") {
    // Timeout arm (same disclosure as the #124 checklist §6-2 fallback):
    // the five-minute timers cannot be shortened, so the first question is
    // seeded with an already-past deadline and closed through the timer's
    // own resolution function (completeMultiUserInputQuestion, source
    // "timeout") — the exact assembly of the timer body firing — while the
    // second question keeps a live deadline the UI drive answers by hand.
    registerSmokeMultiQuestionUiPendingInput({
      requestId: "artemis-smoke-multi-ui-expired",
      nonce: "artemis-smoke-multi-ui-expired-nonce",
      workerRequestId: "artemis-smoke-multi-ui-expired-worker",
      threadId,
      turnId,
      workspacePath: fixtureDirectory,
      header: "Expiry",
      questions: [
        {
          questionId: "e1",
          question: "Archive the old logs?",
          options: [
            {
              label: "Archive it",
              description: "Move logs to cold storage.",
              recommended: true,
            },
            {
              label: "Keep them",
              description: "Leave the logs in place.",
              recommended: false,
            },
          ],
          expiresAt: new Date(Date.now() - 60_000).toISOString(),
        },
        {
          questionId: "e2",
          question: "File the report where?",
          options: [
            {
              label: "Internal wiki",
              description: "Publish internally.",
              recommended: true,
            },
            {
              label: "Email digest",
              description: "Send by email.",
              recommended: false,
            },
          ],
          expiresAt: liveDeadline(30),
        },
      ],
    });
    completeMultiUserInputQuestion(
      "artemis-smoke-multi-ui-expired",
      "artemis-smoke-multi-ui-expired-nonce",
      "e1",
      "timeout",
    );
    return;
  }
  if (view === "multi-question-ui-cancel") {
    registerSmokeMultiQuestionUiPendingInput({
      requestId: "artemis-smoke-multi-ui-cancel",
      nonce: "artemis-smoke-multi-ui-cancel-nonce",
      workerRequestId: "artemis-smoke-multi-ui-cancel-worker",
      threadId,
      turnId,
      workspacePath: fixtureDirectory,
      header: "Release",
      questions: [
        {
          questionId: "c1",
          question: "Roll out to everyone?",
          options: [
            {
              label: "Staged rollout",
              description: "Ten percent first.",
              recommended: true,
            },
            {
              label: "Full rollout",
              description: "Everyone now.",
              recommended: false,
            },
          ],
          expiresAt: liveDeadline(0),
        },
        {
          questionId: "c2",
          question: "Announce the release?",
          options: [
            {
              label: "Changelog only",
              description: "Quiet update.",
              recommended: true,
            },
            {
              label: "Blog post",
              description: "Public announcement.",
              recommended: false,
            },
          ],
          expiresAt: liveDeadline(30),
        },
      ],
    });
  }
}

function seedSmokeTokenUsageFixture(): void {
  const view = process.env.ARTEMIS_SMOKE_VIEW;
  if (!store || (view !== "token-usage" && view !== "navigation-token-usage")) {
    return;
  }
  const now = new Date();
  const timestamp = now.toISOString();
  const projectId = "artemis-smoke-token-usage-project";
  const threadId = "artemis-smoke-token-usage-thread";
  store.upsertProject({
    id: projectId,
    name: "Artemis",
    path: process.cwd(),
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  store.createThread({
    id: threadId,
    projectId,
    title: "Prompt cache metrics",
    mode: "execute",
    target: "local",
    status: "idle",
    pinned: false,
    archived: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const usage = [
    {
      providerId: "openai",
      modelId: "gpt-5.4",
      inputTokens: 3_000,
      outputTokens: 400,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 3_400,
    },
    {
      providerId: "openai",
      modelId: "gpt-5.4",
      inputTokens: 900,
      outputTokens: 350,
      cacheReadTokens: 2_100,
      cacheWriteTokens: 300,
      totalTokens: 3_650,
      cacheReadReported: true,
      cacheWriteReported: true,
      cachePolicy: "explicit-30m" as const,
    },
    {
      inputTokens: 800,
      outputTokens: 320,
      cacheReadTokens: 2_200,
      cacheWriteTokens: 0,
      totalTokens: 3_320,
      cacheReadReported: true,
      cachePolicy: "long" as const,
    },
  ];
  for (const [index, entry] of usage.entries()) {
    store.appendEvent(
      `artemis-smoke-token-usage-${index}`,
      threadId,
      `artemis-smoke-token-turn-${index}`,
      { type: "assistant.usage", ...entry },
    );
  }
}

function seedSmokeGoalFixture(): void {
  const view = process.env.ARTEMIS_SMOKE_VIEW;
  if (!store || !view?.startsWith("goal-")) return;
  const now = new Date().toISOString();
  const projectId = "artemis-smoke-goal-project";
  const threadId = "artemis-smoke-goal-thread";
  store.upsertProject({
    id: projectId,
    name: "Artemis",
    path: process.cwd(),
    createdAt: now,
    updatedAt: now,
  });
  store.createThread({
    id: threadId,
    projectId,
    title: "Codex Goal parity",
    mode: "execute",
    target: "local",
    status: "idle",
    pinned: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
  });
  const hasBudget = view === "goal-budget-limited";
  let goal = store.setThreadGoal(
    threadId,
    "完成 Artemis /goal 控制条与编辑器的 Codex 像素级和生命周期对齐",
    hasBudget ? 50_000 : undefined,
  );
  goal =
    store.updateThreadGoalAccounting(
      threadId,
      goal.goalId,
      hasBudget ? 50_000 : 12_400,
      31_476,
    ) ?? goal;
  if (view === "goal-paused" || view.startsWith("goal-editor")) {
    store.pauseThreadGoal(threadId);
  }
  if (view === "goal-blocked") {
    store.recordThreadGoalBlocker(threadId, goal.goalId, "smoke blocker");
    store.recordThreadGoalBlocker(threadId, goal.goalId, "smoke blocker");
    store.recordThreadGoalBlocker(threadId, goal.goalId, "smoke blocker");
  }
  if (view === "goal-usage-limited") {
    store.markThreadGoalUsageLimited(threadId, goal.goalId);
  }
  if (view === "goal-complete") store.completeThreadGoal(threadId, goal.goalId);
}

function seedSmokeTurnChangesFixture(): void {
  const view = process.env.ARTEMIS_SMOKE_VIEW;
  if (
    !store ||
    (!view?.startsWith("turn-changes") && view !== "form-controls-composer")
  ) {
    return;
  }
  const now = new Date().toISOString();
  const localized = process.env.ARTEMIS_SMOKE_LOCALE === "zh-CN";
  const projectId = "artemis-smoke-turn-changes-project";
  const threadId = "artemis-smoke-turn-changes-thread";
  const turnId = "artemis-smoke-turn-changes-turn";
  store.upsertProject({
    id: projectId,
    name: "Artemis",
    path: process.cwd(),
    createdAt: now,
    updatedAt: now,
  });
  store.createThread({
    id: threadId,
    projectId,
    title: localized
      ? "完成时间线与文件卡"
      : "Completed timeline and file card",
    mode: "execute",
    target: "local",
    status: "idle",
    pinned: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
  });
  const binary = view === "turn-changes-binary";
  const single = view === "turn-changes-single" || binary;
  const files = single
    ? [
        {
          path: binary
            ? "apps/desktop/src/renderer/reference.png"
            : "apps/desktop/src/renderer/App.tsx",
          status: "modified" as const,
          additions: binary ? 0 : 218,
          deletions: 0,
          binary,
        },
      ]
    : [
        {
          path: "apps/desktop/src/renderer/approval-groups.ts",
          status: "modified" as const,
          additions: 26,
          deletions: 0,
          binary: false,
        },
        {
          path: "apps/desktop/src/renderer/composer-drafts.ts",
          status: "modified" as const,
          additions: 50,
          deletions: 2,
          binary: false,
        },
        {
          path: "apps/desktop/src/renderer/timeline-scroll.ts",
          status: "modified" as const,
          additions: 17,
          deletions: 0,
          binary: false,
        },
        ...Array.from({ length: 18 }, (_, index) => ({
          path: `apps/desktop/src/renderer/fixture-${index + 1}.ts`,
          status: "modified" as const,
          additions: index + 3,
          deletions: index % 3,
          binary: false,
        })),
      ];
  const payloads: AgentPayload[] = [
    {
      type: "user.message",
      messageId: "turn-changes-user",
      text: localized
        ? "实现 Codex 式完成时间线与文件变更卡，并完成验证。"
        : "Implement the Codex-style completed timeline and file change card.",
    },
    { type: "turn.started", mode: "execute" },
    {
      type: "message.part.delta",
      partId: "turn-changes-progress:text",
      partType: "text",
      delta: localized
        ? "正在审阅协议与渲染链路。"
        : "Reviewing the protocol and renderer.",
    },
    {
      type: "tool.started",
      toolCallId: "turn-changes-tool",
      toolName: "read",
      input: { path: "apps/desktop/src/renderer/App.tsx" },
    },
    {
      type: "tool.completed",
      toolCallId: "turn-changes-tool",
      output: "done",
      isError: false,
    },
    {
      type: "message.part.delta",
      partId: "turn-changes-final:text",
      partType: "text",
      delta: localized
        ? "已完成时间线分组、不可变本轮审核与安全文件撤销。"
        : "Completed timeline grouping, immutable turn review, and safe file undo.",
    },
    {
      type: "turn.completed",
      reason: "completed",
      finalPartId: "turn-changes-final:text",
      durationMs: 808_000,
    },
    {
      type: "turn.change-set.updated",
      status: "ready",
      files,
      additions: files.reduce((sum, file) => sum + file.additions, 0),
      deletions: files.reduce((sum, file) => sum + file.deletions, 0),
      undoAvailable: true,
    },
  ];
  store.appendEvents(
    threadId,
    payloads.map((payload, index) => ({
      eventId: `artemis-smoke-turn-changes-${index}`,
      turnId,
      payload,
    })),
  );
  store.upsertTurnChangeSet({
    threadId,
    turnId,
    status: "ready",
    files,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    undoAvailable: false,
    message: "Synthetic immutable review fixture.",
    diffText: [
      "diff --git a/apps/desktop/src/renderer/approval-groups.ts b/apps/desktop/src/renderer/approval-groups.ts",
      "index 1111111..2222222 100644",
      "--- a/apps/desktop/src/renderer/approval-groups.ts",
      "+++ b/apps/desktop/src/renderer/approval-groups.ts",
      "@@ -1,2 +1,3 @@",
      " export const groupApprovals = true;",
      "-export const reviewed = false;",
      "+export const reviewed = true;",
      '+export const reviewer = "independent";',
      "",
    ].join("\n"),
    workspacePath: process.cwd(),
    startHead: "1".repeat(40),
    startIndex: "2".repeat(64),
    endHead: "1".repeat(40),
    endIndex: "2".repeat(64),
    createdAt: now,
    updatedAt: now,
  });
}

async function seedSmokeConversationTimelineFixture(): Promise<void> {
  const view = process.env.ARTEMIS_SMOKE_VIEW;
  if (!store || !smokeMode || !view?.startsWith("conversation-timeline-")) {
    return;
  }
  const now = new Date().toISOString();
  const projectId = "artemis-smoke-conversation-project";
  const threadId = "artemis-smoke-conversation-thread";
  const fixturePath = join(
    app.getPath("userData"),
    "fixtures",
    "conversation-timeline",
  );
  await mkdir(fixturePath, { recursive: true });
  store.upsertProject({
    id: projectId,
    name: "Artemis",
    path: fixturePath,
    createdAt: now,
    updatedAt: now,
  });
  store.createThread({
    id: threadId,
    projectId,
    title:
      view === "conversation-timeline-empty"
        ? "Empty conversation"
        : view === "conversation-timeline-failed"
          ? "Interrupted conversation"
          : "Conversation timeline migration",
    mode: "execute",
    target: "local",
    status:
      view === "conversation-timeline-failed"
        ? "failed"
        : view === "conversation-timeline-empty"
          ? "idle"
          : "running",
    pinned: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
  });
  if (view === "conversation-timeline-empty") return;

  if (view === "conversation-timeline-failed") {
    const failedTurnId = "artemis-smoke-conversation-failed-turn";
    const failedPayloads: AgentPayload[] = [
      {
        type: "user.message",
        messageId: "artemis-smoke-conversation-failed-user",
        text: "Resume safely after the interrupted provider stream.",
      },
      { type: "turn.started", mode: "execute" },
      {
        type: "turn.activity",
        phase: "interrupted",
        kind: "connection",
      },
      {
        type: "message.part.delta",
        partId: "artemis-smoke-conversation-failed-thinking",
        partType: "thinking",
        delta: "ARTEMIS_PRIVATE_THINKING_MUST_STAY_HIDDEN",
      },
      {
        type: "message.part.delta",
        partId: "artemis-smoke-conversation-failed-visible",
        partType: "text",
        delta: "The visible response stopped before completion.",
      },
      {
        type: "turn.failed",
        code: "AGENT_HOST_INTERRUPTED",
        message: "The Agent Host restarted without replaying completed writes.",
        durationMs: 41_000,
      },
    ];
    store.appendEvents(
      threadId,
      failedPayloads.map((payload, index) => ({
        eventId: `artemis-smoke-conversation-failed-${index}`,
        turnId: failedTurnId,
        payload,
      })),
    );
    return;
  }

  const completedTurnId = "artemis-smoke-conversation-completed-turn";
  const cancelledTurnId = "artemis-smoke-conversation-cancelled-turn";
  const activeTurnId = "artemis-smoke-conversation-active-turn";
  const longToken = "migration_contract_".repeat(42);
  const completedPayloads: AgentPayload[] = [
    {
      type: "user.message",
      messageId: "artemis-smoke-conversation-completed-user",
      text: "Inspect the timeline contract and verify the public components.",
    },
    { type: "turn.started", mode: "execute" },
    {
      type: "message.part.delta",
      partId: "artemis-smoke-conversation-completed-thinking",
      partType: "thinking",
      delta: "ARTEMIS_PRIVATE_THINKING_MUST_STAY_HIDDEN",
    },
    {
      type: "message.part.delta",
      partId: "artemis-smoke-conversation-progress",
      partType: "text",
      delta: "Reviewing the renderer and shared component boundaries.",
    },
    {
      type: "tool.started",
      toolCallId: "artemis-smoke-conversation-read",
      toolName: "read",
      input: { path: "packages/ui/src/conversation.tsx" },
    },
    {
      type: "tool.completed",
      toolCallId: "artemis-smoke-conversation-read",
      output: "Conversation contract inspected.",
      isError: false,
    },
    {
      type: "tool.started",
      toolCallId: "artemis-smoke-conversation-failed-tool",
      toolName: "bash",
      input: { command: "npm test --workspace @artemis/ui" },
    },
    {
      type: "tool.completed",
      toolCallId: "artemis-smoke-conversation-failed-tool",
      output: "Synthetic failure detail retained for disclosure testing.",
      isError: true,
    },
    {
      type: "child-agent.status",
      agentId: "artemis-smoke-completed-agent",
      label: "Completed timeline audit",
      status: "completed",
      updatedAt: now,
    },
    {
      type: "message.part.delta",
      partId: "artemis-smoke-conversation-final",
      partType: "text",
      delta: [
        "## Timeline migration verified",
        "",
        "- Public user and assistant message anatomy is active.",
        "- [Conversation source](packages/ui/src/conversation.tsx) remains keyboard reachable.",
        "",
        `\`${longToken}\``,
      ].join("\n"),
    },
    {
      type: "turn.completed",
      reason: "completed",
      finalPartId: "artemis-smoke-conversation-final",
      durationMs: 808_000,
    },
    {
      type: "turn.change-set.updated",
      status: "ready",
      files: [
        {
          path: "packages/ui/src/conversation.tsx",
          status: "added",
          additions: 312,
          deletions: 0,
          binary: false,
        },
        {
          path: "apps/desktop/src/renderer/App.tsx",
          status: "modified",
          additions: 84,
          deletions: 61,
          binary: false,
        },
      ],
      additions: 396,
      deletions: 61,
      undoAvailable: true,
    },
  ];
  const cancelledPayloads: AgentPayload[] = [
    { type: "turn.started", mode: "execute" },
    {
      type: "user.message",
      messageId: "artemis-smoke-conversation-cancelled-user",
      text: "Cancel this draft and let me edit the original request.",
    },
    {
      type: "message.part.delta",
      partId: "artemis-smoke-conversation-cancelled-visible",
      partType: "text",
      delta: "Stopping before any additional changes are made.",
    },
    {
      type: "turn.completed",
      reason: "cancelled",
      durationMs: 12_000,
    },
  ];
  const activePayloads: AgentPayload[] = [
    { type: "turn.started", mode: "execute" },
    {
      type: "user.message",
      messageId: "artemis-smoke-conversation-active-user",
      text: `Finish the remaining migration checks. ${longToken}`,
    },
    {
      type: "tool.started",
      toolCallId: "artemis-smoke-conversation-plan",
      toolName: "update_plan",
      input: {
        steps: [
          { step: "Inspect shared anatomy", status: "completed" },
          { step: "Verify native interactions", status: "in_progress" },
          { step: "Record Electron evidence", status: "pending" },
        ],
      },
    },
    {
      type: "tool.completed",
      toolCallId: "artemis-smoke-conversation-plan",
      output: "Plan updated.",
      isError: false,
    },
    {
      type: "tool.started",
      toolCallId: "artemis-smoke-conversation-running-tool",
      toolName: "bash",
      input: { command: "npm run verify:conversation-timeline" },
    },
    {
      type: "child-agent.status",
      agentId: "artemis-smoke-blocked-agent",
      label: "Independent review",
      status: "blocked",
      health: "healthy",
      updatedAt: now,
    },
    {
      type: "user-input.requested",
      requestId: "artemis-smoke-conversation-input",
      nonce: "artemis-smoke-conversation-input-nonce",
      header: "Evidence",
      question: "Which acceptance evidence should be recorded?",
      options: [
        {
          label: "Electron geometry",
          description: "Record native renderer dimensions.",
          recommended: true,
        },
        {
          label: "Keyboard interaction",
          description: "Record focus and disclosure behavior.",
          recommended: false,
        },
      ],
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    },
    {
      type: "queue.updated",
      steering: ["Keep the validation scoped to MIG2."],
      followUp: [
        "Run the RTL and 200 percent geometry checks.",
        "Record the long-content overflow result.",
      ],
    },
  ];
  store.appendEvents(threadId, [
    ...completedPayloads.map((payload, index) => ({
      eventId: `artemis-smoke-conversation-completed-${index}`,
      turnId: completedTurnId,
      payload,
    })),
    ...cancelledPayloads.map((payload, index) => ({
      eventId: `artemis-smoke-conversation-cancelled-${index}`,
      turnId: cancelledTurnId,
      payload,
    })),
    ...activePayloads.map((payload, index) => ({
      eventId: `artemis-smoke-conversation-active-${index}`,
      turnId: activeTurnId,
      payload,
    })),
  ]);
}

function seedSmokeMessageActionsFixture(): void {
  if (!store || process.env.ARTEMIS_SMOKE_VIEW !== "message-actions-edit") {
    return;
  }
  const now = new Date().toISOString();
  const projectId = "artemis-smoke-message-actions-project";
  const threadId = "artemis-smoke-message-actions-thread";
  const turnId = "artemis-smoke-message-actions-turn";
  store.upsertProject({
    id: projectId,
    name: "Artemis",
    path: process.cwd(),
    createdAt: now,
    updatedAt: now,
  });
  store.createThread({
    id: threadId,
    projectId,
    title: "中断消息操作",
    mode: "execute",
    target: "local",
    status: "idle",
    pinned: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
  });
  store.appendEvents(threadId, [
    {
      eventId: "artemis-smoke-message-actions-started",
      turnId,
      payload: { type: "turn.started", mode: "execute" },
    },
    {
      eventId: "artemis-smoke-message-actions-user",
      turnId,
      payload: {
        type: "user.message",
        messageId: "artemis-smoke-message-actions-user",
        text: "把这条被中断的指令恢复到输入框。",
      },
    },
    {
      eventId: "artemis-smoke-message-actions-assistant",
      turnId,
      payload: {
        type: "message.part.delta",
        partId: "artemis-smoke-message-actions-assistant:text",
        partType: "text",
        delta: "这是一段在中断前已经可见的回复。",
      },
    },
    {
      eventId: "artemis-smoke-message-actions-cancelled",
      turnId,
      payload: {
        type: "turn.completed",
        reason: "cancelled",
        durationMs: 54_000,
      },
    },
  ]);
}

function seedSmokeQueuedSteerFixture(): void {
  const view = process.env.ARTEMIS_SMOKE_VIEW;
  if (!store || !view?.startsWith("queued-steer")) return;
  const now = new Date().toISOString();
  const projectId = "artemis-smoke-queued-steer-project";
  const threadId = "artemis-smoke-queued-steer-thread";
  const turnId = "artemis-smoke-queued-steer-turn";
  store.upsertProject({
    id: projectId,
    name: "Artemis",
    path: process.cwd(),
    createdAt: now,
    updatedAt: now,
  });
  store.createThread({
    id: threadId,
    projectId,
    title: "Queued steer smoke",
    mode: "execute",
    target: "local",
    status: "running",
    pinned: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
  });
  store.appendEvents(threadId, [
    {
      eventId: "artemis-smoke-queued-steer-user",
      turnId,
      payload: {
        type: "user.message",
        messageId: "artemis-smoke-queued-steer-user",
        text: "把格式检查和类型检查排进队列，完成后再汇报。",
      },
    },
    {
      eventId: "artemis-smoke-queued-steer-started",
      turnId,
      payload: { type: "turn.started", mode: "execute" },
    },
    {
      eventId: "artemis-smoke-queued-steer-queue",
      turnId,
      payload: {
        type: "queue.updated",
        steering: [],
        followUp: [
          "排队消息一：运行格式检查并修复告警",
          "排队消息二：运行类型检查并确认通过",
        ],
      },
    },
  ]);
}

function seedSmokeMarkdownEditorFixture(): void {
  const view = process.env.ARTEMIS_SMOKE_VIEW;
  const workspacePath = process.env.ARTEMIS_SMOKE_WORKSPACE;
  if (!store || !view?.startsWith("markdown-editor") || !workspacePath) {
    return;
  }
  const now = new Date().toISOString();
  const projectId = "artemis-smoke-markdown-editor-project";
  const threadId = "artemis-smoke-markdown-editor-thread";
  // The verify harness owns the fixtures: ARTEMIS_SMOKE_WORKSPACE points at a
  // throwaway directory holding NOTES.md plus the binary cover.png, so the
  // production list/read/write/image IPC handlers exercise real files while
  // only the save-error view is intercepted above.
  store.upsertProject({
    id: projectId,
    name: "Artemis",
    path: workspacePath,
    createdAt: now,
    updatedAt: now,
  });
  store.createThread({
    id: threadId,
    projectId,
    title: "Markdown editor smoke",
    mode: "execute",
    target: "local",
    status: "idle",
    pinned: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
  });
  if (view === "markdown-editor-navigation-preview") {
    const turnId = "artemis-smoke-markdown-preview-turn";
    const payloads: AgentPayload[] = [
      {
        type: "user.message",
        messageId: "artemis-smoke-markdown-preview-user",
        text: "Inspect the synthetic NOTES.md fixture.",
      },
      { type: "turn.started", mode: "execute" },
      {
        type: "tool.started",
        toolCallId: "artemis-smoke-markdown-preview-tool",
        toolName: "read",
        input: { path: "NOTES.md" },
      },
      {
        type: "tool.completed",
        toolCallId: "artemis-smoke-markdown-preview-tool",
        output: "Synthetic Markdown fixture read.",
        isError: false,
      },
      { type: "turn.completed", reason: "completed" },
    ];
    store.appendEvents(
      threadId,
      payloads.map((payload, index) => ({
        eventId: `artemis-smoke-markdown-preview-${index}`,
        turnId,
        payload,
      })),
    );
  }
}

// One-shot failure latches for the mcp-editor smoke: the injected save and
// remove rejections fire exactly once per process so the Retry affordance can
// drive the same request through the recovering path.
let smokeMcpEditorSaveFailureInjected = false;
let smokeMcpEditorRemoveFailureInjected = false;
// PR8 review F3: every mcpServerReconnect IPC invocation during a smoke run
// is counted in the main process so the stdio draft-drift case can prove a
// programmatic click on the disabled test control reaches the handler zero
// times.
let smokeMcpEditorReconnectIpcCalls = 0;

async function seedSmokeMcpEditorFixture(): Promise<void> {
  const view = process.env.ARTEMIS_SMOKE_VIEW;
  // The smokeMode guard matches the IPC interception gates above: seeding
  // must stay a smoke-harness-only behavior so a merely VIEW-tagged process
  // can never write a synthetic server into a real mcp.json.
  if (!smokeMode || !mcpConfigStore || !view?.startsWith("mcp-editor")) {
    return;
  }
  // Synthetic identity only: the URL uses the reserved .test TLD and the
  // bearer credential stays unset, so no real endpoint, account, or secret
  // can ever enter the seeded snapshot. enabled stays false because
  // initializeOptionalCapabilities only auto-connects enabled servers — the
  // seeded fixture therefore performs zero dial-out at startup.
  await mcpConfigStore.upsert({
    id: "artemis-smoke-remote",
    name: "Artemis Smoke Remote",
    transport: "streamable-http",
    enabled: false,
    url: "https://mcp.artemis-smoke.example.test/mcp",
    auth: "bearer",
  });
  // Second synthetic seed (PR8 review F3): a stdio server so the Electron
  // drift coverage exercises command-transport arguments, not only the HTTP
  // URL. The command is a path that cannot exist and enabled stays false, so
  // the fixture performs zero spawn and zero dial-out at startup. The empty
  // workspace is synthesized by the store inside the isolated user-data
  // directory (McpConfigStore.withDefaultWorkspace).
  await mcpConfigStore.upsert({
    id: "artemis-smoke-local",
    name: "Artemis Smoke Local",
    transport: "stdio",
    enabled: false,
    command: "/artemis-smoke-mcp-editor/stdio-server",
    args: ["--smoke"],
    env: {},
    envVars: [],
    workspacePath: "",
    allowNetwork: false,
  });
}

async function seedSmokeIconSizingFixture(): Promise<void> {
  const view = process.env.ARTEMIS_SMOKE_VIEW;
  // The smokeMode guard matches seedSmokeMcpEditorFixture: seeding must stay
  // a smoke-harness-only behavior so a merely VIEW-tagged process can never
  // write a synthetic server into a real mcp.json.
  if (!smokeMode || !view?.startsWith("icon-sizing-")) {
    return;
  }
  if (!mcpConfigStore) {
    throw new Error("MCP service is not ready.");
  }
  // Synthetic identity only (mcp-editor seed precedent): a stdio command
  // path that cannot exist and enabled:false, so the seeded row performs
  // zero spawn and zero dial-out at startup. The Resource Center manage
  // view renders this row's ResourceAvatar with the semantic icon, which is
  // the .resource-avatar .resource-semantic-icon sizing surface this smoke
  // measures.
  await mcpConfigStore.upsert({
    id: "artemis-smoke-icon-sizing",
    name: "Artemis Smoke Icon Sizing",
    transport: "stdio",
    enabled: false,
    command: "/artemis-smoke-icon-sizing/stdio-server",
    args: ["--smoke"],
    env: {},
    envVars: [],
    workspacePath: "",
    allowNetwork: false,
  });
}

// PR9B card-heatmap smoke: synthetic assistant.usage sequence. The events
// ride the real renderer agent-event IPC channel (the same IPC.agentEvent
// stream live usage events use) with backdated timestamps so the 53-week
// grid renders a genuine data-level distribution. Identity stays synthetic
// (reserved ids, one fake provider/model), nothing touches the store, and
// no provider or endpoint is ever dialed, so the seed performs zero
// network activity. The daily totals below are chosen against the derived
// maximum (38,000) so the daily view covers intensity levels 1-4.
const SMOKE_CARD_HEATMAP_USAGE_DAYS: readonly {
  daysAgo: number;
  totalTokens: number;
}[] = [
  { daysAgo: 0, totalTokens: 38_000 },
  { daysAgo: 1, totalTokens: 28_000 },
  { daysAgo: 2, totalTokens: 19_000 },
  { daysAgo: 3, totalTokens: 9_000 },
  { daysAgo: 7, totalTokens: 36_000 },
  { daysAgo: 8, totalTokens: 21_000 },
  { daysAgo: 15, totalTokens: 15_000 },
  { daysAgo: 22, totalTokens: 7_000 },
  { daysAgo: 33, totalTokens: 34_000 },
  { daysAgo: 47, totalTokens: 26_000 },
  { daysAgo: 61, totalTokens: 13_000 },
  { daysAgo: 76, totalTokens: 6_000 },
  { daysAgo: 100, totalTokens: 37_000 },
  { daysAgo: 130, totalTokens: 24_000 },
  { daysAgo: 160, totalTokens: 17_000 },
  { daysAgo: 190, totalTokens: 8_000 },
  { daysAgo: 230, totalTokens: 33_000 },
  { daysAgo: 270, totalTokens: 27_000 },
  { daysAgo: 310, totalTokens: 14_000 },
  { daysAgo: 350, totalTokens: 5_000 },
];

function emitSmokeCardHeatmapUsageEvents(target: BrowserWindow): void {
  // The smokeMode guard matches seedSmokeIconSizingFixture: injection must
  // stay a smoke-harness-only behavior so a merely VIEW-tagged process can
  // never receive synthetic usage events (non-smoke paths are unchanged).
  if (!smokeMode || process.env.ARTEMIS_SMOKE_VIEW !== "card-heatmap") {
    return;
  }
  const now = new Date();
  const threadId = "artemis-smoke-card-heatmap-thread";
  for (const day of SMOKE_CARD_HEATMAP_USAGE_DAYS) {
    // Calendar-exact local noon so the renderer's timezone date key maps
    // each event to the intended heatmap column on every machine.
    const stamped = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - day.daysAgo,
      12,
    );
    const inputTokens = Math.round(day.totalTokens * 0.6);
    target.webContents.send(IPC.agentEvent, {
      protocolVersion: PROTOCOL_VERSION,
      eventId: `artemis-smoke-card-heatmap-${day.daysAgo}`,
      threadId,
      turnId: `artemis-smoke-card-heatmap-turn-${day.daysAgo}`,
      seq: 0,
      timestamp: stamped.toISOString(),
      payload: {
        type: "assistant.usage",
        providerId: "artemis-smoke",
        modelId: "card-heatmap-probe",
        inputTokens,
        outputTokens: day.totalTokens - inputTokens,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: day.totalTokens,
      },
    } satisfies AgentEvent);
  }
}

// PR9C input-fields smoke: synthetic fixtures for the two real entry points
// (checklist §0). Identity stays synthetic (reserved ids, a fixture-only
// project path inside the isolated user-data tree) and the seed performs
// zero dial-out: no provider, endpoint, or process is ever contacted. The
// once schedule this harness saves uses a far-future date, so the scheduler
// never fires the automation before the smoke app quits.
const SMOKE_INPUT_FIELDS_AVATAR_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

async function seedSmokeInputFieldsFixture(): Promise<void> {
  const view = process.env.ARTEMIS_SMOKE_VIEW;
  // The smokeMode guard matches seedSmokeIconSizingFixture: seeding must
  // stay a smoke-harness-only behavior so a merely VIEW-tagged process can
  // never write smoke fixtures into a real profile.
  if (!store || !smokeMode || !view?.startsWith("input-fields-")) {
    return;
  }
  const fixtureDirectory = join(
    app.getPath("userData"),
    "fixtures",
    "input-fields",
  );
  await mkdir(fixtureDirectory, { recursive: true });
  // Synthetic avatar source for the Enter-activation chain (checklist §6-2):
  // a fixture-generated 1x1 PNG, never a real user photo.
  await writeFile(
    join(fixtureDirectory, "avatar.png"),
    SMOKE_INPUT_FIELDS_AVATAR_PNG_BASE64,
    "base64",
  );
  if (view !== "input-fields-automations-once") {
    return;
  }
  // The automation create button stays disabled without a project, so seed
  // one synthetic project whose path points inside the isolated user-data
  // tree (no real repository, no watcher, no network).
  const projectDirectory = join(fixtureDirectory, "project");
  await mkdir(projectDirectory, { recursive: true });
  const now = new Date().toISOString();
  store.upsertProject({
    id: "artemis-smoke-input-fields-project",
    name: "Artemis Smoke Input Fields",
    path: projectDirectory,
    createdAt: now,
    updatedAt: now,
  });
}

type SmokeInputFieldsActivationEvidence = {
  interceptionArmed: boolean;
  armError?: string;
  entered: boolean;
  fileChooserOpened: boolean;
  acceptedFiles: string[];
  acceptError?: string;
};

type SmokeFocusFrameEvidence = {
  targetStillFocused: boolean;
  activeElementAtCapture: string;
  doubleRafCompleted: boolean;
  framePresented: boolean;
  frameSignal: "beginFrameSubscription" | "unavailable";
};

type SmokeInputFieldsRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type SmokeInputFieldsFocusProbe = {
  outlineColor?: string | null;
  labelOutlineColor?: string | null;
  labelMatchesSiblingFocus?: boolean;
  targetRect?: SmokeInputFieldsRect | null;
  labelRect?: SmokeInputFieldsRect | null;
  viewport?: { innerWidth?: number | null } | null;
} | null;

type SmokeFocusPixelsEvidence = {
  analysisRuntime?: "electron-nativeImage";
  error?: string;
  changedPixelCount?: number;
  ringPixelCount?: number;
  scale?: number;
  sampledBand?: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  };
  ringColor?: [number, number, number];
  sizes?: { width: number; height: number }[];
};

// PR9C review F3: the focused-capture pixel analysis moved out of the
// verify script, which spawned system python3 + Pillow - a runtime this
// repo's package.json/lock never provided, so a clean install environment
// failed with ModuleNotFoundError before any assertion could run. The
// analysis now runs inside the Electron driver with nativeImage, which
// ships with the repo-locked electron dependency: zero new dependencies
// and zero lockfile changes. Both analyses replicate the previous PIL
// semantics exactly: changedPixelCount counts pixels whose RGB channels
// differ by more than 8 between the default and focused captures, and
// ringPixelCount counts pixels within 60/channel of the focus-time ring
// color (alpha > 0) inside the 1..5 CSS px border band around the
// focus-time rect, scaled by capture width / CSS viewport width. Any
// missing input or unreadable artifact returns an error record so the
// verify script's analysis-ran gate fails loudly, never silently.
const analyzeSmokeFocusPixels = ({
  defaultPath,
  focusedPath,
  ringColorSource,
  ringRect,
  viewportWidth,
}: {
  defaultPath: string | undefined;
  focusedPath: string | undefined;
  ringColorSource: string | null | undefined;
  ringRect: SmokeInputFieldsRect | null;
  viewportWidth: number | null | undefined;
}): SmokeFocusPixelsEvidence => {
  if (!defaultPath || !focusedPath) {
    return { error: "missing capture artifact path" };
  }
  if (
    !ringRect ||
    ![ringRect.x, ringRect.y, ringRect.width, ringRect.height].every((value) =>
      Number.isFinite(value),
    )
  ) {
    return { error: "missing finite focus-time rect" };
  }
  if (typeof viewportWidth !== "number" || viewportWidth <= 0) {
    return { error: "missing positive viewport width" };
  }
  const ringColorMatch = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/u.exec(
    ringColorSource ?? "",
  );
  if (!ringColorMatch) {
    return { error: "unparsable focus-time ring color: " + ringColorSource };
  }
  const targetRed = Number(ringColorMatch[1]);
  const targetGreen = Number(ringColorMatch[2]);
  const targetBlue = Number(ringColorMatch[3]);
  const defaultImage = nativeImage.createFromPath(defaultPath);
  const focusedImage = nativeImage.createFromPath(focusedPath);
  if (defaultImage.isEmpty() || focusedImage.isEmpty()) {
    return { error: "unreadable capture artifact" };
  }
  const defaultSize = defaultImage.getSize();
  const focusedSize = focusedImage.getSize();
  if (
    defaultSize.width !== focusedSize.width ||
    defaultSize.height !== focusedSize.height
  ) {
    return { error: "size-mismatch", sizes: [defaultSize, focusedSize] };
  }
  const width = focusedSize.width;
  const height = focusedSize.height;
  const scale = width / viewportWidth;
  // toBitmap() hands back raw 4-byte BGRA pixels (alpha last; a pure red
  // probe pixel decodes to 00 00 ff ff) - the same lossless RGBA pixel
  // grid the previous PIL decode produced from the identical PNG, so the
  // byte-wise comparison preserves the old numeric criteria exactly.
  const defaultBitmap = defaultImage.toBitmap();
  const focusedBitmap = focusedImage.toBitmap();
  const expectedBytes = width * height * 4;
  if (
    defaultBitmap.length !== expectedBytes ||
    focusedBitmap.length !== expectedBytes
  ) {
    return {
      error: "unexpected bitmap stride",
      sizes: [defaultSize, focusedSize],
    };
  }
  let changedPixelCount = 0;
  for (let offset = 0; offset < expectedBytes; offset += 4) {
    if (
      Math.abs(
        defaultBitmap.readUInt8(offset) - focusedBitmap.readUInt8(offset),
      ) > 8 ||
      Math.abs(
        defaultBitmap.readUInt8(offset + 1) -
          focusedBitmap.readUInt8(offset + 1),
      ) > 8 ||
      Math.abs(
        defaultBitmap.readUInt8(offset + 2) -
          focusedBitmap.readUInt8(offset + 2),
      ) > 8
    ) {
      changedPixelCount += 1;
    }
  }
  // Python's round() rounds halves to even; replicating it keeps the
  // sampled band byte-identical to the previous PIL implementation so the
  // counts stay directly comparable across the migration.
  const roundHalfToEven = (value: number): number => {
    const floor = Math.floor(value);
    const fraction = value - floor;
    if (fraction > 0.5) {
      return floor + 1;
    }
    if (fraction < 0.5) {
      return floor;
    }
    return floor % 2 === 0 ? floor : floor + 1;
  };
  const inner = 1.0;
  const outer = 5.0;
  const left = Math.max(0, roundHalfToEven((ringRect.x - outer) * scale));
  const top = Math.max(0, roundHalfToEven((ringRect.y - outer) * scale));
  const right = Math.min(
    width,
    roundHalfToEven((ringRect.x + ringRect.width + outer) * scale),
  );
  const bottom = Math.min(
    height,
    roundHalfToEven((ringRect.y + ringRect.height + outer) * scale),
  );
  const sampledBand = { left, top, right, bottom };
  if (right <= left || bottom <= top) {
    return {
      error: "band-outside-capture",
      scale,
      sampledBand,
      ringColor: [targetRed, targetGreen, targetBlue],
    };
  }
  const innerLeft = roundHalfToEven((ringRect.x - inner) * scale) - left;
  const innerTop = roundHalfToEven((ringRect.y - inner) * scale) - top;
  const innerRight =
    roundHalfToEven((ringRect.x + ringRect.width + inner) * scale) - left;
  const innerBottom =
    roundHalfToEven((ringRect.y + ringRect.height + inner) * scale) - top;
  let ringPixelCount = 0;
  for (let y = top; y < bottom; y += 1) {
    const bandY = y - top;
    for (let x = left; x < right; x += 1) {
      const bandX = x - left;
      if (
        bandX >= innerLeft &&
        bandX < innerRight &&
        bandY >= innerTop &&
        bandY < innerBottom
      ) {
        continue;
      }
      const offset = (y * width + x) * 4;
      if (focusedBitmap.readUInt8(offset + 3) <= 0) {
        continue;
      }
      if (
        Math.abs(focusedBitmap.readUInt8(offset) - targetBlue) <= 60 &&
        Math.abs(focusedBitmap.readUInt8(offset + 1) - targetGreen) <= 60 &&
        Math.abs(focusedBitmap.readUInt8(offset + 2) - targetRed) <= 60
      ) {
        ringPixelCount += 1;
      }
    }
  }
  return {
    analysisRuntime: "electron-nativeImage",
    changedPixelCount,
    ringPixelCount,
    scale,
    sampledBand,
    ringColor: [targetRed, targetGreen, targetBlue],
    sizes: [defaultSize, focusedSize],
  };
};

async function driveSmokeFormControlsEvidence(
  window: BrowserWindow,
  view: string | undefined,
): Promise<void> {
  const targets = {
    "form-controls-archive": {
      selector:
        '[data-artemis-component="search-field"].archive-search [data-part="control"]',
    },
    "form-controls-settings": {
      selector:
        '#provider-config-builtin [data-artemis-component="text-field"] [data-part="control"]',
    },
    "form-controls-settings-custom": {
      selector:
        '#provider-config-custom [data-artemis-component="checkbox"] [data-part="control"]',
    },
    "form-controls-composer": {
      selector:
        '.composer-context-picker [data-artemis-component="select"] [data-part="trigger"]',
      rootSelector:
        '.composer-context-picker [data-artemis-component="select"]',
    },
    "mcp-editor-form-controls": {
      selector:
        '.mcp-editor [data-artemis-component="select"] [data-part="trigger"]',
      rootSelector: '.mcp-editor [data-artemis-component="select"]',
    },
    "turn-changes-form-controls": {
      selector:
        '.review-scope-select [data-artemis-component="select"] [data-part="trigger"]',
      rootSelector: '.review-scope-select [data-artemis-component="select"]',
    },
  } as const;
  const target = view ? targets[view as keyof typeof targets] : undefined;
  if (!target) return;

  const contents = window.webContents;
  const wait = (milliseconds: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  const evaluate = async <T>(script: string): Promise<T> =>
    (await contents.executeJavaScript(script)) as T;
  const pressKey = async (key: string, virtualKeyCode: number) => {
    if (!contents.debugger.isAttached()) {
      contents.debugger.attach("1.3");
    }
    const parameters = {
      key,
      code: key,
      windowsVirtualKeyCode: virtualKeyCode,
      nativeVirtualKeyCode: virtualKeyCode,
    };
    await contents.debugger.sendCommand("Input.dispatchKeyEvent", {
      ...parameters,
      type: "rawKeyDown",
    });
    await contents.debugger.sendCommand("Input.dispatchKeyEvent", {
      ...parameters,
      type: "keyUp",
    });
  };

  if (process.platform === "darwin") app.focus({ steal: true });
  window.focus();
  contents.focus();
  let targetFocused = false;
  for (let presses = 0; presses < 200; presses += 1) {
    targetFocused = await evaluate<boolean>(
      `document.activeElement === document.querySelector(${JSON.stringify(target.selector)})`,
    );
    if (targetFocused) break;
    await pressKey("Tab", 9);
    await wait(15);
  }
  targetFocused = await evaluate<boolean>(
    `document.activeElement === document.querySelector(${JSON.stringify(target.selector)})`,
  );
  const documentHasFocus = await evaluate<boolean>("document.hasFocus()");
  if (documentHasFocus && !targetFocused) {
    throw new Error(
      `Form-control Tab traversal did not reach ${target.selector}.`,
    );
  }

  if ("rootSelector" in target) {
    if (!targetFocused) {
      throw new Error(
        `Form-control keyboard evidence cannot target ${target.selector}.`,
      );
    }
    await pressKey("ArrowDown", 40);
    const interaction = await evaluate<{
      keyboardOpened: boolean;
      menuOpen: boolean;
      rootStable: boolean;
    }>(`(async () => {
      const wait = (milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds));
      const trigger = document.querySelector(${JSON.stringify(target.selector)});
      const root = trigger?.closest('[data-artemis-component="select"]');
      const deadline = Date.now() + 8_000;
      while (Date.now() < deadline && !root?.querySelector('[data-part="listbox"]')) {
        await wait(50);
      }
      return {
        keyboardOpened: Boolean(root?.querySelector('[data-part="listbox"]')),
        menuOpen: Boolean(root?.querySelector('[data-part="menu"]')),
        rootStable: root === document.querySelector(${JSON.stringify(target.rootSelector)}),
      };
    })()`);
    if (!interaction.keyboardOpened) {
      throw new Error(`Public Select did not keyboard-open for ${view}.`);
    }
    await evaluate(`window.__formControlsInteraction = ${JSON.stringify({ view })};
      Object.assign(window.__formControlsInteraction, ${JSON.stringify(interaction)});`);
  }

  await evaluate(`new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  )`);
}

async function driveSmokeNavigationControlsEvidence(
  window: BrowserWindow,
  view: string | undefined,
): Promise<void> {
  const targets = {
    "navigation-token-usage": {
      activation: "ArrowRight",
      expectedLabel: "Weekly",
      rootSelector: '.token-usage-tabs[data-artemis-component="tabs"]',
      targetSelector:
        '.token-usage-tabs[data-artemis-component="tabs"] [data-part="tab"][aria-selected="true"]',
    },
    "markdown-editor-navigation-toolbar": {
      activation: "Space",
      expectedLabel: "Source",
      rootSelector:
        '[data-artemis-component="workspace-file-layout"] [data-artemis-component="workspace-editor-toolbar"] [data-part="mode"] [data-artemis-component="segmented-control"]',
      targetSelector:
        '[data-artemis-component="workspace-file-layout"] [data-artemis-component="workspace-editor-toolbar"] [data-part="mode"] [data-artemis-component="segmented-control"] [data-part="segment"]:nth-of-type(2)',
    },
    "markdown-editor-navigation-preview": {
      activation: "Space",
      expectedLabel: "Source",
      rootSelector:
        '[data-artemis-component="workspace-tab-pane"][data-state="active"] > [data-artemis-component="workspace-editor-toolbar"] [data-part="mode"] [data-artemis-component="segmented-control"]',
      targetSelector:
        '[data-artemis-component="workspace-tab-pane"][data-state="active"] > [data-artemis-component="workspace-editor-toolbar"] [data-part="mode"] [data-artemis-component="segmented-control"] [data-part="segment"]:nth-of-type(2)',
    },
  } as const;
  const target = view ? targets[view as keyof typeof targets] : undefined;
  if (!target) return;

  const contents = window.webContents;
  const wait = (milliseconds: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  const evaluate = async <T>(script: string): Promise<T> =>
    (await contents.executeJavaScript(script)) as T;
  const pressKey = async (
    key: string,
    code: string,
    virtualKeyCode: number,
  ): Promise<void> => {
    if (!contents.debugger.isAttached()) contents.debugger.attach("1.3");
    const parameters = {
      key,
      code,
      windowsVirtualKeyCode: virtualKeyCode,
      nativeVirtualKeyCode: virtualKeyCode,
    };
    await contents.debugger.sendCommand("Input.dispatchKeyEvent", {
      ...parameters,
      type: "rawKeyDown",
    });
    await contents.debugger.sendCommand("Input.dispatchKeyEvent", {
      ...parameters,
      type: "keyUp",
    });
  };

  if (process.platform === "darwin") app.focus({ steal: true });
  window.focus();
  contents.focus();
  let focused = false;
  for (let presses = 0; presses < 300; presses += 1) {
    focused = await evaluate<boolean>(
      `document.activeElement === document.querySelector(${JSON.stringify(target.targetSelector)})`,
    );
    if (focused) break;
    await pressKey("Tab", "Tab", 9);
    await wait(15);
  }
  if (!focused) {
    throw new Error(
      `Navigation-control Tab traversal did not reach ${target.targetSelector}.`,
    );
  }

  await evaluate(`(() => {
    const root = document.querySelector(${JSON.stringify(target.rootSelector)});
    const target = document.querySelector(${JSON.stringify(target.targetSelector)});
    if (!(root instanceof HTMLElement) || !(target instanceof HTMLButtonElement)) {
      throw new Error('Navigation smoke target disappeared before activation.');
    }
    window.__navigationControlsRoot = root;
    window.__navigationControlsClickCount = 0;
    target.addEventListener('click', () => {
      window.__navigationControlsClickCount += 1;
    });
    window.__navigationControlsBefore = {
      activeText: document.activeElement?.textContent?.trim() ?? null,
      selected: [...root.querySelectorAll('button')].map((button) => ({
        label: button.textContent?.trim() ?? '',
        pressed: button.getAttribute('aria-pressed'),
        selected: button.getAttribute('aria-selected'),
        tabIndex: button.tabIndex,
      })),
    };
  })()`);

  if (target.activation === "ArrowRight") {
    await pressKey("ArrowRight", "ArrowRight", 39);
  } else {
    await pressKey(" ", "Space", 32);
  }
  await wait(300);
  const interaction = await evaluate<Record<string, unknown>>(`(() => {
    const root = document.querySelector(${JSON.stringify(target.rootSelector)});
    const buttons = [...(root?.querySelectorAll('button') ?? [])];
    const active = document.activeElement;
    const selected = buttons.find(
      (button) =>
        button.getAttribute('aria-selected') === 'true' ||
        button.getAttribute('aria-pressed') === 'true',
    );
    const panelId = selected?.getAttribute('aria-controls');
    const panel = panelId ? document.getElementById(panelId) : null;
    window.__navigationControlsInteraction = {
      view: ${JSON.stringify(view)},
      activation: ${JSON.stringify(target.activation)},
      activeText: active?.textContent?.trim() ?? null,
      before: window.__navigationControlsBefore,
      clickCount: window.__navigationControlsClickCount,
      expectedLabel: ${JSON.stringify(target.expectedLabel)},
      panelId,
      panelLabelledBy: panel?.getAttribute('aria-labelledby') ?? null,
      rootStable: root === window.__navigationControlsRoot,
      selectedText: selected?.textContent?.trim() ?? null,
      sourceSurfacePresent:
        document.querySelector(
          '[data-artemis-component="workspace-source-editor"] [data-part="source"]',
        ) !== null,
    };
    return window.__navigationControlsInteraction;
  })()`);
  if (
    interaction.rootStable !== true ||
    interaction.selectedText !== target.expectedLabel ||
    interaction.activeText !== target.expectedLabel
  ) {
    throw new Error(
      `Navigation control did not activate the expected selection for ${view}: ${JSON.stringify(interaction)}.`,
    );
  }
  if (target.activation === "Space" && interaction.clickCount !== 1) {
    throw new Error(
      `Navigation control Space activation did not emit exactly one click for ${view}: ${JSON.stringify(interaction)}.`,
    );
  }
}

async function driveSmokeWorkspaceDockEvidence(
  window: BrowserWindow,
  view: string | undefined,
): Promise<void> {
  if (view !== "environment-dock-workspace") return;

  const browserFailureUrl =
    process.env.ARTEMIS_SMOKE_BROWSER_FAILURE_URL ??
    "http://127.0.0.1:65535/artemis-mig4-error";
  if (
    !/^http:\/\/127\.0\.0\.1:\d+\/artemis-mig4-error$/u.test(browserFailureUrl)
  ) {
    throw new Error("Workspace Dock smoke failure URL must use loopback HTTP.");
  }

  const contents = window.webContents;
  const wait = (milliseconds: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  const evaluate = async <T>(script: string): Promise<T> =>
    (await contents.executeJavaScript(script)) as T;
  const pressKey = async (keyCode: string): Promise<void> => {
    const keyDetails = {
      ArrowLeft: { code: "ArrowLeft", virtualKeyCode: 37 },
      ArrowRight: { code: "ArrowRight", virtualKeyCode: 39 },
      Home: { code: "Home", virtualKeyCode: 36 },
      End: { code: "End", virtualKeyCode: 35 },
    }[keyCode];
    if (!keyDetails) throw new Error(`Unsupported Workspace key ${keyCode}.`);
    if (!contents.debugger.isAttached()) contents.debugger.attach("1.3");
    const parameters = {
      key: keyCode,
      code: keyDetails.code,
      windowsVirtualKeyCode: keyDetails.virtualKeyCode,
      nativeVirtualKeyCode: keyDetails.virtualKeyCode,
    };
    await contents.debugger.sendCommand("Input.dispatchKeyEvent", {
      ...parameters,
      type: "rawKeyDown",
    });
    await contents.debugger.sendCommand("Input.dispatchKeyEvent", {
      ...parameters,
      type: "keyUp",
    });
    await wait(420);
  };

  if (process.platform === "darwin") app.focus({ steal: true });
  window.focus();
  contents.focus();
  const resizePoint = await evaluate<{
    direction: "ltr" | "rtl";
    layout: "overlay" | "resizable";
    x: number | null;
    y: number | null;
  }>(`(async () => {
    const wait = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds));
    const dockSelector = '[data-artemis-component="workspace-dock"]';
    const resizerSelector =
      '[data-artemis-component="workspace-dock-resizer"]';
    const tabSelector = '[data-artemis-component="workspace-tab"]';
    const capture = () => {
      const dock = document.querySelector(dockSelector);
      const resizer = document.querySelector(resizerSelector);
      const conversation = document.querySelector(
        '[data-artemis-component="conversation-surface"]',
      );
      const workspaceContent = document.querySelector('.workspace-content');
      const timeline = document.querySelector('.timeline-scroll');
      const browserSurface = document.querySelector(
        '[data-artemis-component="browser-surface"]',
      );
      const browserToolbar = document.querySelector(
        '[data-artemis-component="browser-toolbar"]',
      );
      const browserNavigation = document.querySelector(
        '[data-artemis-component="browser-navigation"]',
      );
      const browserAddressForm = document.querySelector(
        '[data-artemis-component="browser-address-form"]',
      );
      const browserAddressInput = document.querySelector(
        '[data-artemis-component="browser-address-input"]',
      );
      const browserViewport = document.querySelector(
        '[data-artemis-component="browser-viewport"]',
      );
      const browserFrame = document.querySelector('.browser-frame');
      const dockBounds = dock?.getBoundingClientRect();
      const resizerBounds = resizer?.getBoundingClientRect();
      const conversationBounds = conversation?.getBoundingClientRect();
      const workspaceContentBounds = workspaceContent?.getBoundingClientRect();
      const timelineBounds = timeline?.getBoundingClientRect();
      const browserSurfaceBounds = browserSurface?.getBoundingClientRect();
      const browserToolbarBounds = browserToolbar?.getBoundingClientRect();
      const browserViewportBounds = browserViewport?.getBoundingClientRect();
      const resizerStyle = resizer ? getComputedStyle(resizer) : null;
      const tabs = [...document.querySelectorAll(tabSelector)].map((tab) => {
        const select = tab.querySelector(':scope > [data-part="select"]');
        const close = tab.querySelector(':scope > [data-part="close"]');
        return {
          label: select?.textContent?.trim() ?? '',
          active: tab.getAttribute('data-state') === 'active',
          selected: select?.getAttribute('aria-selected') ?? null,
          tabIndex: select instanceof HTMLElement ? select.tabIndex : null,
          closeLabel: close?.getAttribute('aria-label') ?? null,
          selectFocused: document.activeElement === select,
        };
      });
      return {
        direction: getComputedStyle(document.documentElement).direction,
        viewport: {
          compactMedia: matchMedia('(max-width: 820px)').matches,
          devicePixelRatio: window.devicePixelRatio,
          innerWidth: window.innerWidth,
          outerWidth: window.outerWidth,
        },
        dock: dockBounds
          ? {
              state: dock?.getAttribute('data-state') ?? null,
              ariaHidden: dock?.getAttribute('aria-hidden') ?? null,
              inert: dock?.hasAttribute('inert') ?? null,
              visible:
                getComputedStyle(dock).visibility !== 'hidden' &&
                dockBounds.width > 0,
              left: dockBounds.left,
              right: dockBounds.right,
              width: dockBounds.width,
            }
          : null,
        resizer: resizerBounds
          ? {
              state: resizer?.getAttribute('data-state') ?? null,
              role: resizer?.getAttribute('role') ?? null,
              controls: resizer?.getAttribute('aria-controls') ?? null,
              label: resizer?.getAttribute('aria-label') ?? null,
              minimum: Number(resizer?.getAttribute('aria-valuemin')),
              maximum: Number(resizer?.getAttribute('aria-valuemax')),
              value: Number(resizer?.getAttribute('aria-valuenow')),
              valueText: resizer?.getAttribute('aria-valuetext') ?? null,
              tabIndex:
                resizer instanceof HTMLElement ? resizer.tabIndex : null,
              display: resizerStyle?.display ?? null,
              visibility: resizerStyle?.visibility ?? null,
              left: resizerBounds.left,
              right: resizerBounds.right,
              width: resizerBounds.width,
            }
          : null,
        conversation: conversationBounds
          ? {
              left: conversationBounds.left,
              right: conversationBounds.right,
              width: conversationBounds.width,
            }
          : null,
        workspaceContent: workspaceContentBounds
          ? {
              left: workspaceContentBounds.left,
              right: workspaceContentBounds.right,
              width: workspaceContentBounds.width,
            }
          : null,
        timeline: timelineBounds
          ? {
              left: timelineBounds.left,
              right: timelineBounds.right,
              width: timelineBounds.width,
            }
          : null,
        launcherActions: document.querySelectorAll(
          '[data-artemis-component="workspace-launcher"] [data-part="action"]',
        ).length,
        selectionText: window.getSelection()?.toString() ?? '',
        browser: browserSurfaceBounds
          ? {
              addressDirection:
                browserAddressInput instanceof HTMLElement
                  ? getComputedStyle(browserAddressInput).direction
                  : null,
              addressValue:
                browserAddressInput instanceof HTMLInputElement
                  ? browserAddressInput.value
                  : null,
              ariaBusy: browserSurface?.getAttribute('aria-busy') ?? null,
              backDisabled:
                document.querySelector('.browser-back-button')?.hasAttribute(
                  'disabled',
                ) ?? null,
              forwardDisabled:
                document
                  .querySelector('.browser-forward-button')
                  ?.hasAttribute('disabled') ?? null,
              framePartition: browserFrame?.getAttribute('partition') ?? null,
              framePresent: browserFrame !== null,
              frameSource: browserFrame?.getAttribute('src') ?? null,
              frameUrl: (() => {
                try {
                  return browserFrame?.getURL() ?? null;
                } catch {
                  return null;
                }
              })(),
              goDisabled:
                document.querySelector('.browser-go-button')?.hasAttribute(
                  'disabled',
                ) ?? null,
              markersComplete:
                browserToolbar !== null &&
                browserNavigation !== null &&
                browserAddressForm !== null &&
                browserAddressInput !== null &&
                browserViewport !== null &&
                document.querySelectorAll(
                  '[data-artemis-component="browser-navigation-button"]',
                ).length === 3 &&
                document.querySelector(
                  '[data-artemis-component="browser-go-button"]',
                ) !== null,
              refreshDisabled:
                document
                  .querySelector('.browser-refresh-button')
                  ?.hasAttribute('disabled') ?? null,
              errorText:
                document.querySelector('.browser-error')?.textContent?.trim() ??
                null,
              state: browserSurface?.getAttribute('data-state') ?? null,
              surface: {
                width: browserSurfaceBounds.width,
                height: browserSurfaceBounds.height,
                scrollWidth:
                  browserSurface instanceof HTMLElement
                    ? browserSurface.scrollWidth
                    : null,
              },
              toolbar: browserToolbarBounds
                ? {
                    width: browserToolbarBounds.width,
                    height: browserToolbarBounds.height,
                    scrollWidth:
                      browserToolbar instanceof HTMLElement
                        ? browserToolbar.scrollWidth
                        : null,
                  }
                : null,
              viewport: browserViewportBounds
                ? {
                    width: browserViewportBounds.width,
                    height: browserViewportBounds.height,
                  }
                : null,
            }
          : null,
        tabs,
      };
    };
    const addTab = async (position) => {
      const add = document.querySelector('.workspace-tab-add');
      if (!(add instanceof HTMLButtonElement)) {
        throw new Error('Workspace add-tab button missing.');
      }
      add.click();
      await wait(120);
      const entries = [...document.querySelectorAll('.workspace-tab-menu button')];
      const entry = entries.at(position);
      if (!(entry instanceof HTMLButtonElement)) {
        throw new Error(
          'Workspace add-tab entry missing at position ' + position + '.',
        );
      }
      entry.click();
      await wait(420);
    };

    for (let index = 0; index < 8; index += 1) {
      const existingClose = document.querySelector(
        tabSelector + ' > [data-part="close"]',
      );
      if (!(existingClose instanceof HTMLButtonElement)) break;
      existingClose.click();
      await wait(240);
    }
    if (document.querySelector(tabSelector)) {
      throw new Error('Workspace tabs did not reach the empty state.');
    }
    const dockToggle = document.querySelector('.right-sidebar-toggle');
    if (!(dockToggle instanceof HTMLButtonElement)) {
      throw new Error('Workspace Dock toggle missing.');
    }
    if (dockToggle?.getAttribute('aria-expanded') !== 'true') {
      dockToggle.click();
      for (let attempt = 0; attempt < 12; attempt += 1) {
        await wait(100);
        const currentToggle = document.querySelector('.right-sidebar-toggle');
        const currentDock = document.querySelector(dockSelector);
        if (
          currentToggle?.getAttribute('aria-expanded') === 'true' &&
          currentDock?.getAttribute('data-state') === 'open'
        ) {
          break;
        }
      }
    }
    if (
      document.querySelector('.right-sidebar-toggle')?.getAttribute(
        'aria-expanded',
      ) !== 'true' ||
      document.querySelector(dockSelector)?.getAttribute('data-state') !==
        'open'
    ) {
      throw new Error('Workspace Dock did not open before capture.');
    }
    await wait(520);
    const initial = capture();
    await addTab(0);
    await addTab(2);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const browserReady =
        document.querySelector(
          '[data-artemis-component="browser-surface"][data-state="ready"]',
        ) !== null &&
        document.querySelector('.browser-refresh-button')?.hasAttribute(
          'disabled',
        ) === false &&
        document.querySelector('.browser-go-button')?.hasAttribute(
          'disabled',
        ) === false;
      if (browserReady) break;
      await wait(120);
    }
    const multiTab = capture();
    const firstTab = document.querySelector(tabSelector);
    const firstSelect = firstTab?.querySelector(':scope > [data-part="select"]');
    if (!(firstSelect instanceof HTMLButtonElement)) {
      throw new Error('First workspace tab select button missing.');
    }
    firstSelect.click();
    await wait(160);
    const firstClose = firstTab?.querySelector(':scope > [data-part="close"]');
    if (!(firstClose instanceof HTMLButtonElement)) {
      throw new Error('First workspace tab close button missing.');
    }
    firstClose.click();
    await wait(360);
    const afterClose = capture();
    const resizer = document.querySelector(resizerSelector);
    const bounds = resizer?.getBoundingClientRect();
    if (!(resizer instanceof HTMLElement) || !bounds) {
      throw new Error('Workspace Dock resizer missing before interaction.');
    }
    const compactMedia = matchMedia('(max-width: 820px)').matches;
    const resizerDisplay = getComputedStyle(resizer).display;
    if (compactMedia) {
      if (resizerDisplay !== 'none' || bounds.width !== 0) {
        throw new Error('Compact Workspace Dock did not hide its resizer.');
      }
    } else if (resizerDisplay === 'none' || bounds.width <= 0) {
      throw new Error('Resizable Workspace Dock did not expose its resizer.');
    }
    window.__workspaceDockPointerProbe = { down: 0, move: 0, up: 0 };
    if (!compactMedia) {
      resizer.addEventListener('pointerdown', () => {
        window.__workspaceDockPointerProbe.down += 1;
      });
      resizer.addEventListener('pointermove', () => {
        window.__workspaceDockPointerProbe.move += 1;
      });
      resizer.addEventListener('pointerup', () => {
        window.__workspaceDockPointerProbe.up += 1;
      });
    }
    window.__workspaceDockCapture = capture;
    window.__workspaceDockInteraction = {
      initial,
      multiTab,
      afterClose,
      layout: compactMedia ? 'overlay' : 'resizable',
    };
    return {
      direction: getComputedStyle(document.documentElement).direction,
      layout: compactMedia ? 'overlay' : 'resizable',
      x: compactMedia ? null : Math.round(bounds.left + bounds.width / 2),
      y: compactMedia ? null : Math.round(bounds.top + bounds.height / 2),
    };
  })()`);

  await evaluate(`(async () => {
    const wait = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds));
    const waitFor = async (predicate, label) => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (predicate()) return;
        await wait(100);
      }
      throw new Error('Browser interaction timed out: ' + label + '.');
    };
    const frame = document.querySelector('.browser-frame');
    const surface = document.querySelector(
      '[data-artemis-component="browser-surface"]',
    );
    const address = document.querySelector('.browser-address-input');
    const form = document.querySelector('.browser-address-form');
    const go = document.querySelector('.browser-go-button');
    const back = document.querySelector('.browser-back-button');
    const forward = document.querySelector('.browser-forward-button');
    const refresh = document.querySelector('.browser-refresh-button');
    if (
      !(frame instanceof HTMLElement) ||
      typeof frame.loadURL !== 'function' ||
      typeof frame.getURL !== 'function' ||
      typeof frame.executeJavaScript !== 'function' ||
      !(surface instanceof HTMLElement) ||
      !(address instanceof HTMLInputElement) ||
      !(form instanceof HTMLFormElement) ||
      !(go instanceof HTMLButtonElement) ||
      !(back instanceof HTMLButtonElement) ||
      !(forward instanceof HTMLButtonElement) ||
      !(refresh instanceof HTMLButtonElement)
    ) {
      throw new Error('Browser interaction controls are incomplete.');
    }
    const controls = { back: 0, forward: 0, go: 0, refresh: 0, submit: 0 };
    const events = { failures: [], navigations: [], starts: 0, stops: 0 };
    const surfaceStates = [];
    const recordSurface = () => {
      const state = surface.getAttribute('data-state');
      if (state && surfaceStates.at(-1) !== state) surfaceStates.push(state);
    };
    recordSurface();
    const observer = new MutationObserver(recordSurface);
    observer.observe(surface, {
      attributeFilter: ['aria-busy', 'data-state'],
      attributes: true,
      childList: true,
      subtree: true,
    });
    const onStart = () => {
      events.starts += 1;
    };
    const onStop = () => {
      events.stops += 1;
    };
    const onFailure = (event) => {
      if (event.errorCode !== -3) {
        events.failures.push({
          code: event.errorCode,
          description: event.errorDescription,
          url: event.validatedURL,
        });
      }
    };
    const onNavigate = (event) => {
      events.navigations.push(event.url);
    };
    frame.addEventListener('did-start-loading', onStart);
    frame.addEventListener('did-stop-loading', onStop);
    frame.addEventListener('did-fail-load', onFailure);
    frame.addEventListener('did-navigate', onNavigate);
    go.addEventListener('click', () => {
      controls.go += 1;
    });
    back.addEventListener('click', () => {
      controls.back += 1;
    });
    forward.addEventListener('click', () => {
      controls.forward += 1;
    });
    refresh.addEventListener('click', () => {
      controls.refresh += 1;
    });
    form.addEventListener('submit', () => {
      controls.submit += 1;
    });

    const failureUrl = ${JSON.stringify(browserFailureUrl)};
    const addressSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set;
    addressSetter?.call(address, failureUrl);
    address.dispatchEvent(new Event('input', { bubbles: true }));
    await waitFor(() => address.value === failureUrl, 'address input');
    const failureBaseline = events.failures.length;
    go.click();
    await waitFor(
      () =>
        controls.submit === 1 &&
        events.failures.length > failureBaseline &&
        surface.getAttribute('data-state') === 'error',
      'submitted loading/error state',
    );
    recordSurface();
    const submission = {
      address: address.value,
      errorText:
        document.querySelector('.browser-error')?.textContent?.trim() ?? null,
      failure: events.failures.at(-1) ?? null,
      state: surface.getAttribute('data-state'),
    };

    const firstUrl =
      'data:text/html;charset=utf-8,%3Ctitle%3EArtemis%20one%3C%2Ftitle%3E%3Cp%3Eartemis-browser-one%3C%2Fp%3E';
    const secondUrl =
      'data:text/html;charset=utf-8,%3Ctitle%3EArtemis%20two%3C%2Ftitle%3E%3Cp%3Eartemis-browser-two%3C%2Fp%3E';
    const load = async (url, label) => {
      const stopBaseline = events.stops;
      await frame.loadURL(url);
      await waitFor(
        () =>
          frame.getURL() === url &&
          events.stops > stopBaseline &&
          surface.getAttribute('data-state') === 'ready',
        label,
      );
    };
    await load(firstUrl, 'first synthetic document');
    await load(secondUrl, 'second synthetic document');
    await waitFor(() => !back.disabled, 'back control enabled');
    const beforeBack = frame.getURL();
    const backStopBaseline = events.stops;
    back.click();
    await waitFor(
      () =>
        frame.getURL() === firstUrl &&
        !forward.disabled &&
        events.stops > backStopBaseline &&
        surface.getAttribute('data-state') === 'ready',
      'back navigation',
    );
    const afterBack = frame.getURL();
    const forwardStopBaseline = events.stops;
    forward.click();
    await waitFor(
      () =>
        frame.getURL() === secondUrl &&
        events.stops > forwardStopBaseline &&
        surface.getAttribute('data-state') === 'ready',
      'forward navigation',
    );
    const afterForward = frame.getURL();
    const reloadStartBaseline = events.starts;
    const reloadStopBaseline = events.stops;
    refresh.click();
    await waitFor(
      () =>
        events.starts > reloadStartBaseline &&
        events.stops > reloadStopBaseline &&
        frame.getURL() === secondUrl &&
        surface.getAttribute('data-state') === 'ready',
      'reload navigation',
    );
    const documentCanvas = await frame.executeJavaScript(
      "(() => { const html = getComputedStyle(document.documentElement); const body = getComputedStyle(document.body); return { bodyBackground: body.backgroundColor, bodyColor: body.color, htmlBackground: html.backgroundColor, text: document.body.textContent?.trim() ?? '' }; })()",
    );
    recordSurface();
    observer.disconnect();
    frame.removeEventListener('did-start-loading', onStart);
    frame.removeEventListener('did-stop-loading', onStop);
    frame.removeEventListener('did-fail-load', onFailure);
    frame.removeEventListener('did-navigate', onNavigate);
    window.__workspaceDockInteraction.browserInteraction = {
      afterBack,
      afterForward,
      beforeBack,
      controls,
      documentCanvas: {
        ...documentCanvas,
        hostBackground: getComputedStyle(frame).backgroundColor,
      },
      events,
      firstUrl,
      reloadUrl: frame.getURL(),
      secondUrl,
      submission,
      surfaceStates,
    };
  })()`);

  if (
    resizePoint.layout === "resizable" &&
    resizePoint.x !== null &&
    resizePoint.y !== null
  ) {
    const inputScale = contents.getZoomFactor();
    const inputPoint = {
      x: Math.round(resizePoint.x * inputScale),
      y: Math.round(resizePoint.y * inputScale),
    };
    contents.sendInputEvent({ type: "mouseMove", ...inputPoint });
    contents.sendInputEvent({
      type: "mouseDown",
      button: "left",
      clickCount: 1,
      ...inputPoint,
    });
    await wait(80);
    contents.sendInputEvent({
      type: "mouseMove",
      x:
        inputPoint.x +
        (resizePoint.direction === "rtl" ? 1 : -1) *
          Math.round(96 * inputScale),
      y: inputPoint.y,
    });
    await wait(160);
    const releasePoint = await evaluate<{ x: number; y: number }>(`(() => {
      const resizer = document.querySelector(
        '[data-artemis-component="workspace-dock-resizer"]',
      );
      const bounds = resizer?.getBoundingClientRect();
      if (!bounds) throw new Error('Workspace Dock resizer disappeared.');
      return {
        x: Math.round(bounds.left + bounds.width / 2),
        y: Math.round(bounds.top + bounds.height / 2),
      };
    })()`);
    contents.sendInputEvent({
      type: "mouseUp",
      button: "left",
      clickCount: 1,
      x: Math.round(releasePoint.x * inputScale),
      y: Math.round(releasePoint.y * inputScale),
    });
    await wait(320);
    await evaluate(`window.__workspaceDockInteraction.mouse =
      window.__workspaceDockCapture();
      window.__workspaceDockInteraction.pointerProbe =
        window.__workspaceDockPointerProbe`);

    await evaluate(`document
      .querySelector('[data-artemis-component="workspace-dock-resizer"]')
      ?.focus()`);
    await pressKey(
      resizePoint.direction === "rtl" ? "ArrowLeft" : "ArrowRight",
    );
    await evaluate(`window.__workspaceDockInteraction.arrow =
      window.__workspaceDockCapture()`);
    await pressKey("Home");
    await evaluate(`window.__workspaceDockInteraction.home =
      window.__workspaceDockCapture()`);
    await pressKey("End");
    await evaluate(`window.__workspaceDockInteraction.end =
      window.__workspaceDockCapture()`);
  } else {
    await evaluate(`Object.assign(window.__workspaceDockInteraction, {
      arrow: null,
      end: null,
      home: null,
      mouse: null,
      pointerProbe: null,
    })`);
  }

  await evaluate(`document.querySelector('.right-sidebar-toggle')?.click()`);
  await wait(520);
  await evaluate(`window.__workspaceDockInteraction.closed =
    window.__workspaceDockCapture()`);
  await evaluate(`document.querySelector('.right-sidebar-toggle')?.click()`);
  await wait(520);
  await evaluate(`window.__workspaceDockInteraction.reopened =
    window.__workspaceDockCapture()`);
}

// PR9C input-fields evidence driver (checklist §6-2): after the
// default-state screenshot, the driver focuses the web contents (PR9B
// offscreen precedent: showInactive never gives the document OS focus, so
// element.focus() alone cannot run the real focus chain) and drives the
// keyboard chain with real DevTools-protocol key events — Tab traversal
// until the target control holds focus, the visible focus evidence, then
// the case-specific contract chain. Enter on the avatar file input
// activates the real Chromium file chooser, which is intercepted through
// the DevTools protocol so no native dialog ever opens headless; the
// intercepted chooser is then satisfied with the synthetic fixture PNG so
// the real pick -> clear -> preview -> remove chain runs.
async function driveSmokeInputFieldsEvidence(
  window: BrowserWindow,
  artifacts: {
    defaultScreenshot?: string | undefined;
    focusedScreenshot?: string | undefined;
    pickedScreenshot?: string | undefined;
  },
): Promise<void> {
  const view = process.env.ARTEMIS_SMOKE_VIEW;
  if (!smokeMode || !view?.startsWith("input-fields-")) {
    return;
  }
  const contents = window.webContents;
  const evaluate = async <T>(script: string): Promise<T> =>
    (await contents.executeJavaScript(script)) as T;
  const wait = (milliseconds: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  const activation: SmokeInputFieldsActivationEvidence = {
    interceptionArmed: false,
    entered: false,
    fileChooserOpened: false,
    acceptedFiles: [],
  };
  let debuggerAttached = false;
  const ensureDebugger = async (): Promise<void> => {
    if (debuggerAttached) return;
    if (!contents.debugger.isAttached()) {
      contents.debugger.attach("1.3");
    }
    debuggerAttached = true;
  };
  const pressKey = async (
    key: string,
    virtualKeyCode: number,
    text?: string,
  ): Promise<void> => {
    await ensureDebugger();
    const parameters = {
      key,
      code: key,
      windowsVirtualKeyCode: virtualKeyCode,
      nativeVirtualKeyCode: virtualKeyCode,
      ...(text ? { text } : {}),
    };
    // Control keys only need the raw keydown for their default action
    // (Tab focus traversal); activating a control with Enter additionally
    // needs the char event, so that dispatch carries the key text exactly
    // like a real keyboard pipeline (Playwright does the same).
    await contents.debugger.sendCommand("Input.dispatchKeyEvent", {
      ...parameters,
      type: text ? "keyDown" : "rawKeyDown",
    });
    await contents.debugger.sendCommand("Input.dispatchKeyEvent", {
      ...parameters,
      type: "keyUp",
    });
  };
  const tabUntilFocused = async (
    selector: string,
  ): Promise<{ presses: number; reached: boolean }> => {
    const maxPresses = 200;
    for (let presses = 0; presses < maxPresses; presses += 1) {
      const active = await evaluate<boolean>(
        `document.activeElement instanceof Element && document.activeElement.matches(${JSON.stringify(
          selector,
        )})`,
      );
      if (active) {
        return { presses, reached: true };
      }
      await pressKey("Tab", 9);
      await wait(15);
    }
    return { presses: maxPresses, reached: false };
  };
  // PR9C review fix: a computed outline only proves the style tree. The
  // focused screenshot must come from a frame that was produced AND
  // presented after focus landed, otherwise capturePage can hand back the
  // stale pre-focus frame (the review caught the ring rendered on the
  // previously focused control instead of the target). Double rAF
  // guarantees the renderer produced a frame containing the focused ring;
  // the compositor frame subscription — armed before the rAF wait, since
  // pending rAF callbacks force frame production — confirms such a frame
  // was presented. The active element is re-read at capture time so a
  // focus that silently moved between the probe and the capture becomes
  // recorded evidence instead of a hidden assumption.
  const waitForFocusedFrame = async (
    selector: string,
  ): Promise<SmokeFocusFrameEvidence> => {
    let frameSignal: SmokeFocusFrameEvidence["frameSignal"] =
      "beginFrameSubscription";
    const frameArrival = new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (presented: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        try {
          contents.endFrameSubscription();
        } catch {
          // Not subscribed (the subscription API was unavailable).
        }
        resolve(presented);
      };
      const timeout = setTimeout(() => finish(false), 1_500);
      try {
        contents.beginFrameSubscription(() => finish(true));
      } catch {
        frameSignal = "unavailable";
        finish(false);
      }
    });
    const doubleRafCompleted = await evaluate<boolean>(`
      new Promise((resolve) => {
        let second = 0;
        const first = requestAnimationFrame(() => {
          second = requestAnimationFrame(() => resolve(true));
        });
        setTimeout(() => {
          cancelAnimationFrame(first);
          cancelAnimationFrame(second);
          resolve(false);
        }, 1_500);
      })`);
    const framePresented = await frameArrival;
    const active = await evaluate<{
      targetStillFocused: boolean;
      activeElementAtCapture: string;
    } | null>(`(function () {
      const target = document.querySelector(${JSON.stringify(selector)});
      const activeElement = document.activeElement;
      if (!(target instanceof Element)) {
        return null;
      }
      const describe = (element) =>
        element instanceof Element
          ? element.tagName.toLowerCase() +
            (typeof element.className === "string" && element.className
              ? "." + element.className.trim().split(/\s+/).join(".")
              : "")
          : "none";
      return {
        targetStillFocused: activeElement === target,
        activeElementAtCapture: describe(activeElement),
      };
    })()`);
    return {
      targetStillFocused: active?.targetStillFocused ?? false,
      activeElementAtCapture: active?.activeElementAtCapture ?? "unavailable",
      doubleRafCompleted,
      framePresented,
      frameSignal,
    };
  };
  const focusProbeScript = (selector: string, labelSelector?: string) => `
    (() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!(input instanceof HTMLInputElement)) return null;
      const style = getComputedStyle(input);
      const label = ${
        labelSelector
          ? `document.querySelector(${JSON.stringify(labelSelector)})`
          : "null"
      };
      const labelStyle = label ? getComputedStyle(label) : null;
      const rect = input.getBoundingClientRect();
      const labelRect =
        label instanceof HTMLElement ? label.getBoundingClientRect() : null;
      const tabbables = Array.from(
        document.querySelectorAll(
          'a[href], button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
        ),
      ).filter((element) => {
        const computed = getComputedStyle(element);
        return (
          computed.display !== "none" &&
          computed.visibility !== "hidden" &&
          element.getClientRects().length > 0
        );
      });
      return {
        focused: document.activeElement === input,
        matchesFocusVisible: input.matches(":focus-visible"),
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        outlineColor: style.outlineColor,
        tabIndex: input.tabIndex,
        tabbableCount: tabbables.length,
        tabOrderIndex: tabbables.indexOf(input),
        hasFocus: document.hasFocus(),
        labelMatchesFocusWithin:
          label instanceof HTMLElement ? label.matches(":focus-within") : false,
        labelMatchesSiblingFocus:
          label instanceof HTMLElement &&
          label.previousElementSibling === input &&
          input.matches(":focus-visible"),
        labelOutlineStyle: labelStyle ? labelStyle.outlineStyle : null,
        labelOutlineWidth: labelStyle ? labelStyle.outlineWidth : null,
        labelOutlineColor: labelStyle ? labelStyle.outlineColor : null,
        targetRect: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        },
        labelRect: labelRect
          ? {
              x: labelRect.x,
              y: labelRect.y,
              width: labelRect.width,
              height: labelRect.height,
            }
          : null,
        viewport: {
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio,
        },
      };
    })()`;
  // The smoke window is shown offscreen via showInactive(), so focusing the
  // web contents first is what makes the document hold real OS focus for
  // the Tab traversal and :focus-visible evidence below.
  contents.focus();
  if (view === "input-fields-automations-once") {
    const dateSelector = '.automation-dialog input[type="date"]';
    const tab = await tabUntilFocused(dateSelector);
    const focus = (await evaluate(
      focusProbeScript(dateSelector),
    )) as SmokeInputFieldsFocusProbe;
    // Capture only after the focused frame was produced and presented, and
    // prove the target still held focus at that exact moment.
    const focusRingCapture = await waitForFocusedFrame(dateSelector);
    if (artifacts.focusedScreenshot) {
      const image = await contents.capturePage();
      await writeFile(artifacts.focusedScreenshot, image.toPNG());
    }
    // F3: pixel-bind both on-disk captures with the repo-locked Electron
    // runtime instead of the verify script's system python3 + Pillow.
    const focusPixels = analyzeSmokeFocusPixels({
      defaultPath: artifacts.defaultScreenshot,
      focusedPath: artifacts.focusedScreenshot,
      ringColorSource: focus?.outlineColor ?? null,
      ringRect: focus?.targetRect ?? null,
      viewportWidth: focus?.viewport?.innerWidth ?? null,
    });
    const busy = await evaluate(`(async () => {
      const wait = (milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds));
      const form = document.querySelector("form.automation-dialog");
      const date = document.querySelector(${JSON.stringify(dateSelector)});
      const name = document.querySelector(".automation-dialog input:not([type])");
      const prompt = document.querySelector(".automation-dialog textarea");
      if (
        !(form instanceof HTMLFormElement) ||
        !(date instanceof HTMLInputElement) ||
        !(name instanceof HTMLInputElement) ||
        !(prompt instanceof HTMLTextAreaElement)
      ) {
        return { error: "once form controls missing" };
      }
      const inputSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      const textareaSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      inputSetter?.call(name, "Artemis smoke once schedule");
      name.dispatchEvent(new Event("input", { bubbles: true }));
      inputSetter?.call(date, "2099-06-15");
      date.dispatchEvent(new Event("input", { bubbles: true }));
      textareaSetter?.call(
        prompt,
        "Synthetic smoke prompt for the once date contract; this automation never runs.",
      );
      prompt.dispatchEvent(new Event("input", { bubbles: true }));
      await wait(150);
      const preSubmit = {
        formNoValidate: form.noValidate,
        formRole: form.getAttribute("role"),
        formAriaModal: form.getAttribute("aria-modal"),
        dateRequired: date.required,
        dateType: date.type,
        dateValue: date.value,
        dateDisabled: date.disabled,
        nameRequired: name.required,
        promptRequired: prompt.required,
      };
      const disabledTransitions = [];
      const observer = new MutationObserver(() => {
        const probe = document.querySelector(${JSON.stringify(dateSelector)});
        if (probe instanceof HTMLInputElement) {
          disabledTransitions.push(probe.disabled);
        }
      });
      observer.observe(form, {
        attributes: true,
        attributeFilter: ["disabled"],
        subtree: true,
      });
      form.requestSubmit();
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        if (!document.querySelector(".automation-dialog")) break;
        await wait(25);
      }
      observer.disconnect();
      return {
        preSubmit,
        disabledTransitions,
        busyDisabledObserved: disabledTransitions.includes(true),
        dialogClosedAfterSave: !document.querySelector(".automation-dialog"),
        errorMessage: document.querySelector(".automation-message")
          ?.textContent ?? null,
      };
    })()`);
    await evaluate(`(() => {
      window.__inputFieldsProbe = {
        view: ${JSON.stringify(view)},
        documentHasFocus: document.hasFocus(),
        tab: ${JSON.stringify(tab)},
        focus: ${JSON.stringify(focus ?? null)},
        focusRingCapture: ${JSON.stringify(focusRingCapture)},
        focusPixels: ${JSON.stringify(focusPixels)},
        busy: ${JSON.stringify(busy ?? null)},
        activation: null,
        pick: null,
      };
      return true;
    })()`);
    return;
  }
  if (view === "input-fields-settings-avatar") {
    const avatarSelector = ".profile-avatar-input";
    const tab = await tabUntilFocused(avatarSelector);
    const focus = (await evaluate(
      focusProbeScript(
        avatarSelector,
        '.settings-profile-avatar-actions [data-artemis-component="button"]',
      ),
    )) as SmokeInputFieldsFocusProbe;
    // Capture only after the focused frame was produced and presented, and
    // prove the avatar input still held focus at that exact moment.
    const focusRingCapture = await waitForFocusedFrame(avatarSelector);
    if (artifacts.focusedScreenshot) {
      const image = await contents.capturePage();
      await writeFile(artifacts.focusedScreenshot, image.toPNG());
    }
    // F3: same Electron-side pixel binding, against the public trigger
    // button's sibling-focus ring rect and color.
    const focusPixels = analyzeSmokeFocusPixels({
      defaultPath: artifacts.defaultScreenshot,
      focusedPath: artifacts.focusedScreenshot,
      ringColorSource: focus?.labelOutlineColor ?? null,
      ringRect: focus?.labelRect ?? null,
      viewportWidth: focus?.viewport?.innerWidth ?? null,
    });
    await evaluate(`(() => {
      window.__inputFieldsEnterClicks = 0;
      const input = document.querySelector(${JSON.stringify(avatarSelector)});
      input?.addEventListener("click", () => {
        window.__inputFieldsEnterClicks += 1;
      });
      return true;
    })()`);
    try {
      await ensureDebugger();
      await contents.debugger.sendCommand("Page.enable");
      await contents.debugger.sendCommand(
        "Page.setInterceptFileChooserDialog",
        { enabled: true, interceptAll: true },
      );
      activation.interceptionArmed = true;
    } catch (error) {
      activation.armError = String(error).slice(0, 240);
    }
    // The avatar save is a fast settings-store write, so the busy-state
    // observer must already be watching when the pick commits; arm it
    // before the intercepted chooser is satisfied.
    await evaluate(`(() => {
      window.__inputFieldsAvatarDisabled = [];
      const actions = document.querySelector(
        ".settings-profile-avatar-actions",
      );
      const observer = new MutationObserver(() => {
        const probe = document.querySelector(".profile-avatar-input");
        if (probe instanceof HTMLInputElement) {
          window.__inputFieldsAvatarDisabled.push(probe.disabled);
        }
      });
      if (actions) {
        observer.observe(actions, {
          attributes: true,
          attributeFilter: ["disabled"],
          subtree: true,
        });
        window.__inputFieldsAvatarObserver = observer;
      }
      return true;
    })()`);
    if (activation.interceptionArmed) {
      let chooserBackendNodeId: number | undefined;
      const chooserOpened = new Promise<boolean>((resolve) => {
        const handle = (_event: unknown, method: string, params?: unknown) => {
          if (method === "Page.fileChooserOpened") {
            const backendNodeId = (params as { backendNodeId?: number })
              ?.backendNodeId;
            if (typeof backendNodeId === "number") {
              chooserBackendNodeId = backendNodeId;
            }
            contents.debugger.removeListener("message", handle);
            resolve(true);
          }
        };
        contents.debugger.on("message", handle);
        void wait(4_000).then(() => {
          contents.debugger.removeListener("message", handle);
          resolve(false);
        });
      });
      await pressKey("Enter", 13, "\r");
      activation.entered = true;
      activation.fileChooserOpened = await chooserOpened;
      if (activation.fileChooserOpened) {
        const avatarPath = join(
          app.getPath("userData"),
          "fixtures",
          "input-fields",
          "avatar.png",
        );
        try {
          // Satisfy the intercepted chooser the way Playwright does: point
          // the chooser's input node at the synthetic fixture file, which
          // makes Chromium set the input's files and fire the real change
          // event through the normal pick path.
          await contents.debugger.sendCommand("DOM.setFileInputFiles", {
            files: [avatarPath],
            ...(typeof chooserBackendNodeId === "number"
              ? { backendNodeId: chooserBackendNodeId }
              : {}),
          });
          activation.acceptedFiles = ["avatar.png"];
        } catch (error) {
          activation.acceptError = String(error).slice(0, 240);
        }
      }
    }
    const pick = await evaluate(`(async () => {
      const wait = (milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds));
      const input = document.querySelector(${JSON.stringify(avatarSelector)});
      if (!(input instanceof HTMLInputElement)) {
        return { error: "avatar input missing" };
      }
      const deadline = Date.now() + 6000;
      let settled = false;
      while (Date.now() < deadline) {
        const preview = document.querySelector(
          ".settings-profile-avatar-preview img",
        );
        const remove = document.querySelector(
          ".settings-profile-avatar-actions button",
        );
        if (preview && remove && !input.disabled) {
          settled = true;
          break;
        }
        await wait(25);
      }
      window.__inputFieldsAvatarObserver?.disconnect();
      const disabledTransitions =
        window.__inputFieldsAvatarDisabled ?? [];
      return {
        valueCleared: input.value === "",
        previewImagePresent:
          document.querySelector(".settings-profile-avatar-preview img") !==
          null,
        removePresent:
          document.querySelector(".settings-profile-avatar-actions button") !==
          null,
        disabledTransitions,
        busyDisabledObserved: disabledTransitions.includes(true),
        settled,
      };
    })()`);
    // Same presented-frame guarantee for the picked-state capture so that
    // artifact cannot regress to a pre-pick stale frame either.
    const pickedFrameCapture = await waitForFocusedFrame(avatarSelector);
    if (artifacts.pickedScreenshot) {
      const image = await contents.capturePage();
      await writeFile(artifacts.pickedScreenshot, image.toPNG());
    }
    const enterClicks = await evaluate<number>(
      "window.__inputFieldsEnterClicks ?? 0",
    );
    await evaluate(`(() => {
      window.__inputFieldsProbe = {
        view: ${JSON.stringify(view)},
        documentHasFocus: document.hasFocus(),
        tab: ${JSON.stringify(tab)},
        focus: ${JSON.stringify(focus ?? null)},
        focusRingCapture: ${JSON.stringify(focusRingCapture)},
        focusPixels: ${JSON.stringify(focusPixels)},
        busy: null,
        activation: ${JSON.stringify(activation)},
        pick: ${JSON.stringify(pick ?? null)},
        pickedFrameCapture: ${JSON.stringify(pickedFrameCapture)},
        enterClicks: ${JSON.stringify(enterClicks ?? 0)},
      };
      return true;
    })()`);
    return;
  }
  // An input-fields-* view without a driver branch must fail loudly here:
  // a silent return would exit clean with no probe written, and the verify
  // script would only report missing audit data far away from the cause.
  throw new Error(
    `Unknown input-fields smoke view: ${view}. Implemented views are input-fields-automations-once and input-fields-settings-avatar.`,
  );
}

type SmokeUserInputTransportCheck = {
  name: string;
  pass: boolean;
  actual: unknown;
  expected: unknown;
};

type SmokeUserInputTransportDomState = {
  pendingCards: number;
  cancelledCards: number;
  answeredCards: number;
  timedOutCards: number;
  cardTexts: string[];
};

type SmokeUserInputRequestedView = {
  requestId: string;
  nonce: string;
  kind?: string;
  questions?: Array<{ questionId: string; expiresAt?: string }>;
};

type SmokeUserInputResolvedView = {
  requestId: string;
  nonce?: string;
  answer?: string;
  questionId?: string;
  selectedOptionLabel?: string;
  customAnswer?: string;
  source?: string;
  kind?: string;
};

type SmokeUserInputTransportEvidence = {
  view: "user-input-transport";
  generatedAt: string;
  checks: SmokeUserInputTransportCheck[];
  brokerPosts: Array<Record<string, unknown>>;
  storeChecks: {
    legacyRequested: number;
    legacyResolved: number;
    multiRequested: number;
    multiResolved: number;
    multiExpiredRequested: number;
    multiExpiredResolved: number;
    multiCancelRequested: number;
    multiCancelResolved: number;
    multiReverseRequested: number;
    multiReverseResolved: number;
  };
  renderer: SmokeUserInputTransportDomState;
};

let smokeUserInputTransportEvidence:
  SmokeUserInputTransportEvidence | undefined;

async function driveSmokeUserInputTransportEvidence(
  window: BrowserWindow,
  artifacts: { screenshot?: string | undefined },
): Promise<void> {
  const view = process.env.ARTEMIS_SMOKE_VIEW;
  if (!smokeMode || view !== "user-input-transport") {
    return;
  }
  const agentHost = agentProcess;
  const appStore = store;
  if (!agentHost || !appStore) {
    throw new Error(
      "User-input transport smoke requires a live agent host and store.",
    );
  }
  const threadId = "artemis-smoke-user-input-transport";
  const turnId = "smoke-turn-transport";
  const workspacePath = join(
    app.getPath("userData"),
    "fixtures",
    "user-input-transport",
  );
  const checks: SmokeUserInputTransportCheck[] = [];
  const assert = (
    name: string,
    pass: boolean,
    actual: unknown,
    expected: unknown,
  ): void => {
    checks.push({ name, pass, actual, expected });
    if (!pass) {
      throw new Error(
        `User-input transport smoke check failed: ${name} (actual ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}).`,
      );
    }
  };
  const domState = async (): Promise<SmokeUserInputTransportDomState> =>
    (await window.webContents.executeJavaScript(`(() => ({
      pendingCards: document.querySelectorAll(".user-input-card.pending").length,
      cancelledCards: document.querySelectorAll(".user-input-card.cancelled").length,
      answeredCards: document.querySelectorAll(".user-input-card.answered").length,
      timedOutCards: document.querySelectorAll(".user-input-card.timed-out").length,
      cardTexts: [...document.querySelectorAll(".user-input-card")].map(
        (card) => (card.textContent ?? "").replace(/\\s+/gu, " ").trim(),
      ),
    }))()`)) as SmokeUserInputTransportDomState;
  const waitForDomState = async (
    description: string,
    predicate: (state: SmokeUserInputTransportDomState) => boolean,
  ): Promise<SmokeUserInputTransportDomState> => {
    const deadline = Date.now() + 8_000;
    for (;;) {
      const state = await domState();
      if (predicate(state)) return state;
      if (Date.now() >= deadline) {
        throw new Error(
          `User-input transport smoke timed out waiting for ${description}; last state ${JSON.stringify(state)}.`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  };
  const wait = (milliseconds: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  const requestedEvents = (requestId: string): SmokeUserInputRequestedView[] =>
    appStore
      .getThreadEvents(threadId)
      .map((event) => event.payload)
      .filter(
        (payload) =>
          payload.type === "user-input.requested" &&
          (payload as { requestId?: string }).requestId === requestId,
      ) as unknown as SmokeUserInputRequestedView[];
  const resolvedEvents = (requestId: string): SmokeUserInputResolvedView[] =>
    appStore
      .getThreadEvents(threadId)
      .map((event) => event.payload)
      .filter(
        (payload) =>
          payload.type === "user-input.resolved" &&
          (payload as { requestId?: string }).requestId === requestId,
      ) as unknown as SmokeUserInputResolvedView[];
  const multiPending = (requestId: string): boolean =>
    pendingMultiUserInputs.hasWhere(
      (pending) => pending.request.approvalId === requestId,
    );

  const legacyOptions = [
    {
      label: "Yes, implement this plan",
      description: "Continue with the plan as written.",
      recommended: true,
    },
    {
      label: "Revise the plan first",
      description: "Describe what should change before continuing.",
      recommended: false,
    },
  ];
  const multiQuestions = [
    {
      questionId: "q1",
      question: "Ship on Friday?",
      options: [
        {
          label: "Ship it",
          description: "Release the build.",
          recommended: true,
        },
        {
          label: "Hold",
          description: "Wait one more day.",
          recommended: false,
        },
      ],
    },
    {
      questionId: "q2",
      question: "Notify users first?",
      options: [
        {
          label: "Email digest",
          description: "Send a summary.",
          recommended: true,
        },
        {
          label: "In-app only",
          description: "Show a banner.",
          recommended: false,
        },
      ],
    },
    {
      questionId: "q3",
      question: "Anything to add?",
      options: [
        {
          label: "No, ship as-is",
          description: "Nothing extra.",
          recommended: true,
        },
        {
          label: "Yes, add notes",
          description: "Attach release notes.",
          recommended: false,
        },
      ],
    },
  ];
  const cancelQuestions = [
    {
      questionId: "c1",
      question: "Roll out to everyone?",
      options: [
        {
          label: "Staged rollout",
          description: "Ten percent first.",
          recommended: true,
        },
        {
          label: "Full rollout",
          description: "Everyone now.",
          recommended: false,
        },
      ],
    },
    {
      questionId: "c2",
      question: "Announce the release?",
      options: [
        {
          label: "Changelog only",
          description: "Quiet update.",
          recommended: true,
        },
        {
          label: "Blog post",
          description: "Public announcement.",
          recommended: false,
        },
      ],
    },
  ];

  // The real agent host drops broker resolutions for unknown worker request
  // ids (agent-worker.ts), so capturing the posts at this boundary observes
  // the exact commands main sends without changing production behavior.
  const brokerPosts: Array<Record<string, unknown>> = [];
  const originalPost = agentHost.post.bind(agentHost);
  agentHost.post = (command: Parameters<AgentProcess["post"]>[0]): void => {
    brokerPosts.push(command as unknown as Record<string, unknown>);
    originalPost(command);
  };
  activeTurns.set(threadId, turnId);
  try {
    // §6-6 legacy chain: the real single-question broker handler registers,
    // persists, and renders the existing card end to end.
    handleUserInputBrokerRequest("artemis-smoke-single-worker", {
      kind: "user.input",
      approvalId: "artemis-smoke-single",
      threadId,
      turnId,
      workspacePath,
      header: "Confirmation",
      question: "Implement this plan?",
      options: legacyOptions,
      mode: "execute",
    });
    const legacyRequested = requestedEvents("artemis-smoke-single");
    assert(
      "legacy-request-persisted",
      legacyRequested.length === 1,
      legacyRequested.length,
      1,
    );
    const legacyNonce = legacyRequested[0]?.nonce ?? "";
    const legacyRendered = await waitForDomState(
      "legacy card pending",
      (state) => state.pendingCards === 1,
    );
    assert(
      "legacy-card-pending-rendered",
      legacyRendered.pendingCards === 1,
      legacyRendered.pendingCards,
      1,
    );
    assert(
      "legacy-card-shows-question",
      legacyRendered.cardTexts.some((text) =>
        text.includes("Implement this plan?"),
      ),
      legacyRendered.cardTexts,
      "a card containing 'Implement this plan?'",
    );

    // §6-1 no-lost-events: the real multi-question broker handler persists
    // the frozen payload and the renderer replays it through the protocol
    // reducer (the translated card renders beside the legacy one).
    handleUserInputBrokerRequest("artemis-smoke-multi-worker", {
      kind: "user.input",
      approvalId: "artemis-smoke-multi",
      threadId,
      turnId,
      workspacePath,
      header: "Plan check",
      questions: multiQuestions,
      mode: "execute",
    });
    const multiRequested = requestedEvents("artemis-smoke-multi");
    assert(
      "multi-request-persisted",
      multiRequested.length === 1,
      multiRequested.length,
      1,
    );
    const multiRequest = multiRequested[0];
    assert(
      "multi-request-frozen-kind",
      multiRequest?.kind === "multi-question",
      multiRequest?.kind ?? null,
      "multi-question",
    );
    const multiQuestionSnapshot = multiRequest?.questions ?? [];
    assert(
      "multi-request-three-questions",
      multiQuestionSnapshot.length === 3,
      multiQuestionSnapshot.length,
      3,
    );
    assert(
      "multi-request-per-question-expiry",
      multiQuestionSnapshot.every(
        (question) =>
          typeof question.expiresAt === "string" &&
          Number.isFinite(Date.parse(question.expiresAt)),
      ),
      multiQuestionSnapshot.map((question) => question.expiresAt ?? null),
      "a finite ISO expiresAt per question",
    );
    const multiNonce = multiRequested[0]?.nonce ?? "";
    const multiRendered = await waitForDomState(
      "multi card pending beside legacy card",
      (state) => state.pendingCards === 2,
    );
    assert(
      "multi-card-translated-pending",
      multiRendered.pendingCards === 2,
      multiRendered.pendingCards,
      2,
    );
    assert(
      "multi-card-projects-first-pending-question",
      multiRendered.cardTexts.some((text) => text.includes("Ship on Friday?")),
      multiRendered.cardTexts,
      "a translated card showing 'Ship on Friday?'",
    );

    // PR10B review round 3 (nit 6): capture the scenario screenshot now,
    // while both the legacy and the translated card are pending, so the
    // PNG carries visual evidence. A presented compositor frame armed
    // before a double rAF confirms the cards reached the screen before
    // capturePage — the same frame-gating the input-fields driver uses.
    // No new named check: the audit keeps exactly 51 recorded checks.
    if (artifacts.screenshot) {
      const frameArrival = new Promise<boolean>((resolve) => {
        let settled = false;
        const finish = (presented: boolean) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          try {
            window.webContents.endFrameSubscription();
          } catch {
            // Subscription API unavailable: the double rAF below already
            // forces one frame.
          }
          resolve(presented);
        };
        const timeout = setTimeout(() => finish(false), 1_500);
        try {
          window.webContents.beginFrameSubscription(() => finish(true));
        } catch {
          finish(false);
        }
      });
      await window.webContents.executeJavaScript(
        `new Promise((resolve) => {
           let second = 0;
           const first = requestAnimationFrame(() => {
             second = requestAnimationFrame(() => resolve(true));
           });
           setTimeout(() => {
             cancelAnimationFrame(first);
             cancelAnimationFrame(second);
             resolve(false);
           }, 1_500);
         })`,
      );
      await frameArrival;
      const image = await window.webContents.capturePage();
      await writeFile(artifacts.screenshot, image.toPNG());
    }

    // §6-2 no-auto-answer: no user action and no timeout expiry yet.
    await wait(1_200);
    assert(
      "no-resolution-before-timeout-window",
      resolvedEvents("artemis-smoke-multi").length === 0,
      resolvedEvents("artemis-smoke-multi").length,
      0,
    );
    const beforeTimeoutDom = await domState();
    assert(
      "cards-still-pending-without-user-action",
      beforeTimeoutDom.pendingCards === 2,
      beforeTimeoutDom.pendingCards,
      2,
    );
    assert(
      "multi-registry-still-pending",
      multiPending("artemis-smoke-multi"),
      multiPending("artemis-smoke-multi"),
      true,
    );
    assert(
      "no-broker-resolve-before-final-answer",
      brokerPosts.length === 0,
      brokerPosts.length,
      0,
    );

    // §6-6 legacy user resolution through the IPC handler's own entry
    // function: the renderer event and the broker result must agree.
    completeUserInput(
      {
        requestId: "artemis-smoke-single",
        nonce: legacyNonce,
        selectedOption: 0,
      },
      "user",
    );
    const legacyResolved = resolvedEvents("artemis-smoke-single");
    assert(
      "legacy-resolved-once",
      legacyResolved.length === 1,
      legacyResolved.length,
      1,
    );
    assert(
      "legacy-resolved-answer-is-label",
      legacyResolved[0]?.answer === "Yes, implement this plan",
      legacyResolved[0]?.answer ?? null,
      "Yes, implement this plan",
    );
    const legacyPost = brokerPosts.find(
      (post) =>
        (post.resolution as { approvalId?: string } | undefined)?.approvalId ===
        "artemis-smoke-single",
    );
    const legacyResult = (legacyPost?.result ?? {}) as {
      answer?: string;
      selectedOption?: number;
      selectedLabel?: string;
      source?: string;
    };
    assert(
      "legacy-broker-backfill-dual-channel-consistent",
      Boolean(legacyPost) &&
        legacyResult.answer === "Yes, implement this plan" &&
        legacyResult.selectedLabel === "Yes, implement this plan" &&
        legacyResult.selectedOption === 0 &&
        legacyResult.source === "user",
      { post: legacyPost ?? null },
      "answer, selectedLabel, and selectedOption(0) agree with the event",
    );
    const afterLegacy = await waitForDomState(
      "legacy card settled",
      (state) => state.pendingCards === 1,
    );
    assert(
      "legacy-card-settled-rendered",
      afterLegacy.pendingCards === 1 && afterLegacy.answeredCards >= 1,
      afterLegacy,
      "one pending card (multi) and at least one answered card",
    );

    // All questions of the live request are answered through both user
    // channels; each answer advances the translated card to the next
    // pending question and the last one triggers the aggregated backfill.
    completeMultiUserInputQuestion(
      "artemis-smoke-multi",
      multiNonce,
      "q1",
      "user",
      { selectedOptionLabel: "Ship it" },
    );
    const afterFirstAnswerDom = await waitForDomState(
      "translated card projecting q2 after the q1 answer",
      (state) =>
        state.pendingCards === 1 &&
        state.cardTexts.some((text) => text.includes("Notify users first?")),
    );
    assert(
      "multi-card-projects-next-pending-question",
      afterFirstAnswerDom.pendingCards === 1 &&
        afterFirstAnswerDom.cardTexts.some((text) =>
          text.includes("Notify users first?"),
        ),
      afterFirstAnswerDom,
      "the translated card now shows 'Notify users first?'",
    );

    // §6-4 duplicate resolution: an already-answered question cannot be
    // answered twice and the store keeps exactly one resolved event.
    let duplicateResolutionError = "";
    try {
      completeMultiUserInputQuestion(
        "artemis-smoke-multi",
        multiNonce,
        "q1",
        "user",
        { selectedOptionLabel: "Ship it" },
      );
    } catch (error) {
      duplicateResolutionError = error instanceof Error ? error.message : "";
    }
    assert(
      "duplicate-question-resolution-rejected",
      duplicateResolutionError.includes("no longer pending"),
      duplicateResolutionError,
      "a 'no longer pending' rejection",
    );
    assert(
      "duplicate-resolution-single-side-effect",
      resolvedEvents("artemis-smoke-multi").length === 1,
      resolvedEvents("artemis-smoke-multi").length,
      1,
    );

    // §6-4 duplicate injection: the same approval id cannot register twice;
    // the duplicate is answered with one broker reject (approved:false,
    // "User input is already pending.") instead of a thrown error, and the
    // store keeps exactly one requested event.
    let duplicateInjectionError = "";
    try {
      handleUserInputBrokerRequest("artemis-smoke-multi-worker", {
        kind: "user.input",
        approvalId: "artemis-smoke-multi",
        threadId,
        turnId,
        workspacePath,
        header: "Plan check",
        questions: multiQuestions,
        mode: "execute",
      });
    } catch (error) {
      duplicateInjectionError = error instanceof Error ? error.message : "";
    }
    const duplicateInjectionPost = brokerPosts.find(
      (post) =>
        post.requestId === "artemis-smoke-multi-worker" &&
        (post.resolution as { approved?: boolean } | undefined)?.approved ===
          false &&
        post.error === "User input is already pending.",
    );
    assert(
      "duplicate-injection-rejected",
      duplicateInjectionError === "" && Boolean(duplicateInjectionPost),
      {
        thrown: duplicateInjectionError,
        post: duplicateInjectionPost ?? null,
      },
      "no throw and one approved:false broker reject saying 'User input is already pending.'",
    );
    assert(
      "duplicate-injection-single-requested-event",
      requestedEvents("artemis-smoke-multi").length === 1,
      requestedEvents("artemis-smoke-multi").length,
      1,
    );

    completeMultiUserInputQuestion(
      "artemis-smoke-multi",
      multiNonce,
      "q2",
      "user",
      { selectedOptionLabel: "Email digest" },
    );
    const betweenAnswersDom = await waitForDomState(
      "translated card projecting q3 after the q2 answer",
      (state) =>
        state.pendingCards === 1 &&
        state.cardTexts.some((text) => text.includes("Anything to add?")),
    );
    assert(
      "multi-card-projects-last-pending-question",
      betweenAnswersDom.pendingCards === 1 &&
        betweenAnswersDom.cardTexts.some((text) =>
          text.includes("Anything to add?"),
        ),
      betweenAnswersDom,
      "the translated card now shows 'Anything to add?'",
    );
    completeMultiUserInputQuestion(
      "artemis-smoke-multi",
      multiNonce,
      "q3",
      "user",
      { customAnswer: "Add a changelog entry first." },
    );
    const multiResolved = resolvedEvents("artemis-smoke-multi");
    assert(
      "multi-all-questions-resolved",
      multiResolved.length === 3,
      multiResolved.length,
      3,
    );
    const multiFinalPost = brokerPosts.find(
      (post) =>
        (post.resolution as { approvalId?: string } | undefined)?.approvalId ===
          "artemis-smoke-multi" &&
        (post.resolution as { approved?: boolean } | undefined)?.approved ===
          true,
    );
    const multiFinalResult = (multiFinalPost?.result ?? {}) as {
      answers?: Array<{
        questionId?: string;
        answer?: string;
        source?: string;
      }>;
      source?: string;
    };
    assert(
      "final-broker-resolve-approved-once",
      Boolean(multiFinalPost) &&
        (multiFinalPost?.resolution as { approved?: boolean } | undefined)
          ?.approved === true,
      multiFinalPost ?? null,
      "exactly one approved broker resolve for the multi request",
    );
    assert(
      "final-broker-resolve-aggregates-answers",
      multiFinalResult.answers?.length === 3 &&
        multiFinalResult.answers[0]?.answer === "Ship it" &&
        multiFinalResult.answers[1]?.answer === "Email digest" &&
        multiFinalResult.answers[2]?.answer ===
          "Add a changelog entry first." &&
        multiFinalResult.answers.every((answer) => answer.source === "user"),
      multiFinalResult,
      "aggregated answers for q1/q2/q3 in order, each with source user",
    );
    // Review R2 P1-3: the aggregate covers the whole card, so a top-level
    // source would misstate every question that settled differently from
    // the last one — provenance lives per question only.
    assert(
      "final-broker-resolve-no-top-level-source",
      Object.hasOwn(multiFinalResult, "source") === false,
      multiFinalResult,
      "no top-level source on the all-user aggregate",
    );
    assert(
      "multi-registry-drained-after-final",
      !multiPending("artemis-smoke-multi"),
      multiPending("artemis-smoke-multi"),
      false,
    );
    const multiAnsweredDom = await waitForDomState(
      "multi card answered",
      (state) => state.pendingCards === 0 && state.answeredCards >= 2,
    );
    assert(
      "multi-card-answered-rendered",
      multiAnsweredDom.pendingCards === 0,
      multiAnsweredDom.pendingCards,
      0,
    );

    // §6-2 timeout arm: the five-minute timers cannot be shortened, and the
    // frozen reducer honors a reverse time gate (a timeout stamped before a
    // question's expiresAt is discarded whole), so the timeout path is
    // driven through a synthetic request whose first question already
    // expired while its second question keeps a live deadline. The request
    // rides the real emitPayload channel and a real registry registration;
    // only the minted expiresAt is synthesized (checklist §6-2 fallback).
    const expiredRequestId = "artemis-smoke-multi-expired";
    const expiredNonce = "artemis-smoke-expired-nonce";
    // One set of frozen deadlines shared by the registry snapshot and the
    // emitted payload: the main-process expiry gate reads the registry copy,
    // the reducer reads the payload copy, and the two must agree exactly.
    const expiredQuestionDeadlines = [
      new Date(Date.now() - 60_000).toISOString(),
      new Date(Date.now() + 300_000).toISOString(),
    ];
    const expiredQuestions = [
      {
        questionId: "e1",
        question: "Archive the old logs?",
        options: [
          {
            label: "Archive it",
            description: "Move logs to cold storage.",
            recommended: true,
          },
          {
            label: "Keep them",
            description: "Leave the logs in place.",
            recommended: false,
          },
        ],
      },
      {
        questionId: "e2",
        question: "File the report where?",
        options: [
          {
            label: "Internal wiki",
            description: "Publish internally.",
            recommended: true,
          },
          {
            label: "Email digest",
            description: "Send by email.",
            recommended: false,
          },
        ],
      },
    ];
    pendingMultiUserInputs.register({
      requestId: expiredRequestId,
      nonce: expiredNonce,
      questions: expiredQuestions.map((question, index) => ({
        ...question,
        expiresAt: expiredQuestionDeadlines[index]!,
      })),
      value: {
        workerRequestId: "artemis-smoke-multi-expired-worker",
        request: {
          kind: "user.input",
          approvalId: expiredRequestId,
          threadId,
          turnId,
          workspacePath,
          header: "Expiry",
          questions: expiredQuestions,
          mode: "execute",
        },
        timeouts: new Map(),
      },
    });
    emitPayload(threadId, turnId, {
      type: "user-input.requested",
      kind: "multi-question",
      requestId: expiredRequestId,
      nonce: expiredNonce,
      header: "Expiry",
      questions: expiredQuestions.map((question, index) => ({
        questionId: question.questionId,
        question: question.question,
        options: question.options,
        expiresAt: expiredQuestionDeadlines[index]!,
      })),
    });
    const expiredRendered = await waitForDomState(
      "expired-deadline card pending",
      (state) => state.pendingCards === 1,
    );
    assert(
      "expired-request-card-pending",
      expiredRendered.pendingCards === 1,
      expiredRendered.pendingCards,
      1,
    );
    completeMultiUserInputQuestion(
      expiredRequestId,
      expiredNonce,
      "e1",
      "timeout",
    );
    const expiredResolved = resolvedEvents(expiredRequestId);
    assert(
      "timeout-resolves-exactly-first-expired-question",
      expiredResolved.length === 1 &&
        expiredResolved[0]?.questionId === "e1" &&
        expiredResolved[0]?.source === "timeout",
      expiredResolved,
      "one resolved event for e1 with source timeout",
    );
    assert(
      "timeout-answer-is-recommended-label",
      expiredResolved[0]?.selectedOptionLabel === "Archive it",
      expiredResolved[0]?.selectedOptionLabel ?? null,
      "Archive it",
    );
    assert(
      "timeout-no-broker-resolve-before-final",
      // legacy backfill (1) + duplicate-injection reject (2) + multi final
      // backfill (3): nothing else may reach the agent host.
      brokerPosts.length === 3,
      brokerPosts.length,
      3,
    );
    const afterExpiredTimeoutDom = await waitForDomState(
      "expired-deadline card projecting e2 after the e1 timeout",
      (state) =>
        state.pendingCards === 1 &&
        state.cardTexts.some((text) => text.includes("File the report where?")),
    );
    assert(
      "timeout-card-still-pending-after-partial-timeout",
      afterExpiredTimeoutDom.pendingCards === 1,
      afterExpiredTimeoutDom.pendingCards,
      1,
    );
    assert(
      "timeout-card-projects-next-pending-question",
      afterExpiredTimeoutDom.cardTexts.some((text) =>
        text.includes("File the report where?"),
      ),
      afterExpiredTimeoutDom.cardTexts,
      "the translated card now shows 'File the report where?'",
    );

    // The still-live second question is answered by user choice (a
    // non-recommended label), proving per-question independence inside one
    // card: e1 closed by timeout, e2 closed by choice, one aggregated
    // broker backfill.
    completeMultiUserInputQuestion(
      expiredRequestId,
      expiredNonce,
      "e2",
      "user",
      { selectedOptionLabel: "Email digest" },
    );
    const expiredFinalResolved = resolvedEvents(expiredRequestId);
    assert(
      "mixed-expiry-all-questions-resolved",
      expiredFinalResolved.length === 2,
      expiredFinalResolved.length,
      2,
    );
    const expiredFinalPost = brokerPosts.find(
      (post) =>
        (post.resolution as { approvalId?: string } | undefined)?.approvalId ===
        expiredRequestId,
    );
    const expiredFinalResult = (expiredFinalPost?.result ?? {}) as {
      answers?: Array<{
        questionId?: string;
        answer?: string;
        source?: string;
      }>;
    };
    assert(
      "mixed-expiry-final-broker-backfill",
      Boolean(expiredFinalPost) &&
        (expiredFinalPost?.resolution as { approved?: boolean } | undefined)
          ?.approved === true &&
        expiredFinalResult.answers?.length === 2 &&
        expiredFinalResult.answers[0]?.answer === "Archive it" &&
        expiredFinalResult.answers[1]?.answer === "Email digest" &&
        expiredFinalResult.answers[0]?.source === "timeout" &&
        expiredFinalResult.answers[1]?.source === "user",
      expiredFinalPost ?? null,
      "one approved backfill aggregating the timed-out and user-chosen answers with per-question source",
    );
    assert(
      "mixed-expiry-broker-backfill-no-top-level-source",
      Object.hasOwn(expiredFinalResult, "source") === false,
      expiredFinalResult,
      "no top-level source on the timeout-then-user aggregate",
    );
    const expiredSettledDom = await waitForDomState(
      "mixed-expiry card settled timed-out",
      (state) => state.pendingCards === 0 && state.timedOutCards >= 1,
    );
    assert(
      "mixed-expiry-card-settles-timed-out",
      expiredSettledDom.pendingCards === 0 &&
        expiredSettledDom.timedOutCards >= 1,
      expiredSettledDom,
      "no pending cards and a timed-out aggregate card",
    );

    // Review R2 P1-3, reverse settlement order: the user answers the live
    // first question while the second has already expired, so the card
    // settles user -> timeout — the mirror of the mixed-expiry card above.
    // The aggregated backfill must carry per-question provenance only, with
    // no top-level source relabeling the whole card as the last question's
    // origin.
    const reverseRequestId = "artemis-smoke-multi-reverse";
    const reverseNonce = "artemis-smoke-reverse-nonce";
    const reverseQuestionDeadlines = [
      new Date(Date.now() + 300_000).toISOString(),
      new Date(Date.now() - 60_000).toISOString(),
    ];
    const reverseQuestions = [
      {
        questionId: "r1",
        question: "Keep the changelog where?",
        options: [
          {
            label: "In repo",
            description: "Ship it with the code.",
            recommended: true,
          },
          {
            label: "Wiki",
            description: "Publish it separately.",
            recommended: false,
          },
        ],
      },
      {
        questionId: "r2",
        question: "Delete the stale branches?",
        options: [
          {
            label: "Yes, delete",
            description: "Remove merged branches.",
            recommended: true,
          },
          {
            label: "Keep them",
            description: "Leave the branches alone.",
            recommended: false,
          },
        ],
      },
    ];
    pendingMultiUserInputs.register({
      requestId: reverseRequestId,
      nonce: reverseNonce,
      questions: reverseQuestions.map((question, index) => ({
        ...question,
        expiresAt: reverseQuestionDeadlines[index]!,
      })),
      value: {
        workerRequestId: "artemis-smoke-multi-reverse-worker",
        request: {
          kind: "user.input",
          approvalId: reverseRequestId,
          threadId,
          turnId,
          workspacePath,
          header: "Reverse",
          questions: reverseQuestions,
          mode: "execute",
        },
        timeouts: new Map(),
      },
    });
    emitPayload(threadId, turnId, {
      type: "user-input.requested",
      kind: "multi-question",
      requestId: reverseRequestId,
      nonce: reverseNonce,
      header: "Reverse",
      questions: reverseQuestions.map((question, index) => ({
        questionId: question.questionId,
        question: question.question,
        options: question.options,
        expiresAt: reverseQuestionDeadlines[index]!,
      })),
    });
    const reverseRendered = await waitForDomState(
      "reverse-order card pending",
      (state) => state.pendingCards === 1,
    );
    assert(
      "reverse-expiry-card-pending",
      reverseRendered.pendingCards === 1,
      reverseRendered.pendingCards,
      1,
    );
    completeMultiUserInputQuestion(
      reverseRequestId,
      reverseNonce,
      "r1",
      "user",
      { selectedOptionLabel: "Wiki" },
    );
    const reverseAfterUser = resolvedEvents(reverseRequestId);
    assert(
      "reverse-expiry-user-answer-first",
      reverseAfterUser.length === 1 &&
        reverseAfterUser[0]?.questionId === "r1" &&
        reverseAfterUser[0]?.source === "user" &&
        reverseAfterUser[0]?.selectedOptionLabel === "Wiki",
      reverseAfterUser,
      "one user resolution for r1 choosing the non-recommended 'Wiki'",
    );
    const reverseAfterUserDom = await waitForDomState(
      "reverse-order card projects the expired r2 after the r1 answer",
      (state) =>
        state.pendingCards === 1 &&
        state.cardTexts.some((text) =>
          text.includes("Delete the stale branches?"),
        ),
    );
    assert(
      "reverse-expiry-card-projects-expired-question",
      reverseAfterUserDom.cardTexts.some((text) =>
        text.includes("Delete the stale branches?"),
      ),
      reverseAfterUserDom.cardTexts,
      "the translated card now shows 'Delete the stale branches?'",
    );
    completeMultiUserInputQuestion(
      reverseRequestId,
      reverseNonce,
      "r2",
      "timeout",
    );
    const reverseResolved = resolvedEvents(reverseRequestId);
    assert(
      "reverse-expiry-all-questions-resolved",
      reverseResolved.length === 2,
      reverseResolved.length,
      2,
    );
    const reverseFinalPost = brokerPosts.find(
      (post) =>
        (post.resolution as { approvalId?: string } | undefined)?.approvalId ===
        reverseRequestId,
    );
    const reverseFinalResult = (reverseFinalPost?.result ?? {}) as {
      answers?: Array<{
        questionId?: string;
        answer?: string;
        source?: string;
      }>;
    };
    assert(
      "reverse-expiry-final-broker-backfill",
      Boolean(reverseFinalPost) &&
        (reverseFinalPost?.resolution as { approved?: boolean } | undefined)
          ?.approved === true &&
        reverseFinalResult.answers?.length === 2 &&
        reverseFinalResult.answers[0]?.answer === "Wiki" &&
        reverseFinalResult.answers[1]?.answer === "Yes, delete" &&
        reverseFinalResult.answers[0]?.source === "user" &&
        reverseFinalResult.answers[1]?.source === "timeout",
      reverseFinalPost ?? null,
      "one approved backfill aggregating the user-then-timeout answers with per-question source",
    );
    assert(
      "reverse-expiry-broker-backfill-no-top-level-source",
      Object.hasOwn(reverseFinalResult, "source") === false,
      reverseFinalResult,
      "no top-level source on the user-then-timeout aggregate",
    );
    const reverseSettledDom = await waitForDomState(
      "reverse-order card settled timed-out",
      (state) => state.pendingCards === 0 && state.timedOutCards >= 2,
    );
    assert(
      "reverse-expiry-card-settles-timed-out",
      reverseSettledDom.pendingCards === 0 &&
        reverseSettledDom.timedOutCards >= 2,
      reverseSettledDom,
      "no pending cards and a second timed-out aggregate card",
    );

    // §6-3 no-infinite-wait: a fresh multi request on the same turn, then
    // the real thread-cancel path closes every pending question with one
    // kind-less cancelled event and an approved:false broker receipt.
    handleUserInputBrokerRequest("artemis-smoke-multi-cancel-worker", {
      kind: "user.input",
      approvalId: "artemis-smoke-multi-cancel",
      threadId,
      turnId,
      workspacePath,
      header: "Release",
      questions: cancelQuestions,
      mode: "execute",
    });
    const cancelTargetRendered = await waitForDomState(
      "cancel-target card pending",
      (state) => state.pendingCards === 1,
    );
    assert(
      "cancel-target-card-pending",
      cancelTargetRendered.pendingCards === 1,
      cancelTargetRendered.pendingCards,
      1,
    );
    await cancelTaskTurn(threadId);
    const cancelResolved = resolvedEvents("artemis-smoke-multi-cancel");
    assert(
      "cancel-emits-one-kind-less-cancelled",
      cancelResolved.length === 1 &&
        cancelResolved[0]?.kind === undefined &&
        cancelResolved[0]?.source === "cancelled",
      cancelResolved,
      "one kind-less resolved event with source cancelled",
    );
    const cancelPost = brokerPosts.find(
      (post) =>
        (post.resolution as { approvalId?: string } | undefined)?.approvalId ===
        "artemis-smoke-multi-cancel",
    );
    assert(
      "cancel-broker-resolve-rejected",
      Boolean(cancelPost) &&
        (cancelPost?.resolution as { approved?: boolean } | undefined)
          ?.approved === false &&
        cancelPost?.error === "The turn was cancelled.",
      cancelPost ?? null,
      "approved:false with 'The turn was cancelled.'",
    );
    assert(
      "cancel-registry-drained",
      !multiPending("artemis-smoke-multi-cancel"),
      multiPending("artemis-smoke-multi-cancel"),
      false,
    );
    const cancelledDom = await waitForDomState(
      "cancelled card rendered",
      (state) => state.pendingCards === 0 && state.cancelledCards >= 1,
    );
    assert(
      "cancel-closes-card-in-renderer",
      cancelledDom.pendingCards === 0 && cancelledDom.cancelledCards >= 1,
      cancelledDom,
      "no pending cards and a cancelled card",
    );

    smokeUserInputTransportEvidence = {
      view: "user-input-transport",
      generatedAt: new Date().toISOString(),
      checks,
      brokerPosts,
      storeChecks: {
        legacyRequested: requestedEvents("artemis-smoke-single").length,
        legacyResolved: resolvedEvents("artemis-smoke-single").length,
        multiRequested: requestedEvents("artemis-smoke-multi").length,
        multiResolved: resolvedEvents("artemis-smoke-multi").length,
        multiExpiredRequested: requestedEvents(expiredRequestId).length,
        multiExpiredResolved: resolvedEvents(expiredRequestId).length,
        multiCancelRequested: requestedEvents("artemis-smoke-multi-cancel")
          .length,
        multiCancelResolved: resolvedEvents("artemis-smoke-multi-cancel")
          .length,
        multiReverseRequested: requestedEvents(reverseRequestId).length,
        multiReverseResolved: resolvedEvents(reverseRequestId).length,
      },
      renderer: await domState(),
    };
  } finally {
    delete (agentHost as { post?: unknown }).post;
    activeTurns.delete(threadId);
  }
}

async function seedSmokeEnvironmentFixture(): Promise<void> {
  const view = process.env.ARTEMIS_SMOKE_VIEW;
  // The icon-sizing smoke harness reuses this same synthetic repository
  // fixture so the branch popover, commit dialog, and environment rows all
  // render against real git data that lives entirely inside the isolated
  // user-data directory (no network, no real project identity).
  if (
    !store ||
    (!view?.startsWith("environment") &&
      !view?.startsWith("icon-sizing-environment"))
  ) {
    return;
  }
  const now = new Date().toISOString();
  const projectId = "artemis-smoke-environment-project";
  const threadId = "artemis-smoke-environment-thread";
  const turnId = "artemis-smoke-environment-turn";
  const workspace = join(
    app.getPath("userData"),
    "fixtures",
    "environment-repository",
  );
  const remote = join(
    app.getPath("userData"),
    "fixtures",
    "environment-remote.git",
  );
  await rm(workspace, { recursive: true, force: true });
  await rm(remote, { recursive: true, force: true });
  await mkdir(workspace, { recursive: true });
  const git = (...args: string[]) =>
    execFileAsync("git", args, {
      cwd: workspace,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GCM_INTERACTIVE: "Never",
      },
      timeout: 15_000,
    });
  await git("init", "-b", "main");
  await git("config", "user.name", "Artemis Smoke");
  await git("config", "user.email", "smoke@example.invalid");
  await writeFile(
    join(workspace, "README.md"),
    "# Artemis environment fixture\n\nOriginal line\n",
    "utf8",
  );
  await git("add", "--all", "--");
  await git("commit", "-m", "Initial fixture");
  await git("init", "--bare", remote);
  await git("remote", "add", "origin", remote);
  await git("push", "-u", "origin", "main");
  await git("branch", "codex/fix-issues-81-87");
  await git("branch", "codex/fix-issue-77-model-stream-stall");
  await git("branch", "codex/native-web-search");
  await git("branch", "codex/fix-issues-70-72");
  await git("branch", "gh-pages");
  if (process.env.ARTEMIS_SMOKE_VIEW !== "environment-branch-menu") {
    await writeFile(
      join(workspace, "README.md"),
      "# Artemis environment fixture\n\nUpdated line\nSecond line\n",
      "utf8",
    );
    await writeFile(join(workspace, "设计说明.md"), "任务环境面板\n", "utf8");
  }
  if (process.env.ARTEMIS_SMOKE_VIEW === "environment-push-execute") {
    await git("add", "--all", "--");
    await git("commit", "-m", "Ahead fixture");
  }

  store.upsertProject({
    id: projectId,
    name: "Artemis",
    path: workspace,
    createdAt: now,
    updatedAt: now,
  });
  store.createThread({
    id: threadId,
    projectId,
    title: "实现右上角任务环境面板",
    mode: "execute",
    target: "local",
    status:
      view === "environment-feedback-approval" ? "waiting-approval" : "idle",
    pinned: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
  });
  type SmokeEnvironmentEvent = { id: string; payload: AgentPayload };
  const approvalEvents: SmokeEnvironmentEvent[] = [];
  if (view.startsWith("environment-feedback-approval")) {
    const approvalCount =
      view === "environment-feedback-approval-grouped" ? 2 : 1;
    for (let index = 0; index < approvalCount; index += 1) {
      const suffix = String(index + 1);
      const approvalId = `environment-smoke-approval-${suffix}`;
      const nonce = `environment-smoke-approval-nonce-${suffix}`;
      approvalEvents.push({
        id: `environment-approval-requested-${suffix}`,
        payload: {
          type: "approval.requested",
          approvalId,
          nonce,
          summary: `Apply reviewed workspace change ${suffix}`,
          command: `git apply reviewed-${suffix}.patch`,
          paths: ["README.md"],
          network: [],
          risk: "medium",
          allowedScopes: ["once", "session"],
          modelReason: "Matches this task.",
        },
      });
      if (view !== "environment-feedback-approval") {
        approvalEvents.push({
          id: `environment-approval-resolved-${suffix}`,
          payload: {
            type: "approval.resolved",
            approvalId,
            nonce,
            approved: true,
            scope: "once",
          },
        });
      }
    }
  }
  const events: SmokeEnvironmentEvent[] = [
    {
      id: "environment-turn-started",
      payload: { type: "turn.started", mode: "execute" },
    },
    {
      id: "environment-user-message",
      payload: {
        type: "user.message",
        messageId: "environment-user-message",
        text: "实现任务环境面板，并验证 Git、子代理、MCP 和来源信息。",
      },
    },
    ...(process.env.ARTEMIS_SMOKE_VIEW === "environment-empty"
      ? []
      : ([
          {
            id: "environment-team",
            payload: {
              type: "agent-team.status",
              teamId: "environment-team",
              mission: "并行验证环境面板",
              status: "completed",
              memberAgentIds: ["ui-agent", "git-agent", "test-agent"],
              requiredAgentIds: ["ui-agent", "git-agent"],
              maxMembers: 8,
              updatedAt: now,
            },
          },
          ...[
            ["ui-agent", "界面实现", "running"],
            ["git-agent", "Git 安全检查", "completed"],
            ["test-agent", "渲染验证", "queued"],
          ].map(([agentId, label, status]) => ({
            id: `environment-child-${agentId}`,
            payload: {
              type: "child-agent.status" as const,
              agentId: agentId!,
              label: label!,
              teamId: "environment-team",
              status: status as "running" | "completed" | "queued",
              updatedAt: now,
            },
          })),
          {
            id: "environment-mcp-parent",
            payload: {
              type: "mcp.tool.used",
              toolCallId: "mcp-parent-1",
              serverId: "codegraph",
              serverName: "CodeGraph",
              toolName: "codegraph_explore",
              agentId: "parent",
            },
          },
          {
            id: "environment-mcp-child",
            payload: {
              type: "mcp.tool.used",
              toolCallId: "mcp-child-1",
              serverId: "codegraph",
              serverName: "CodeGraph",
              toolName: "codegraph_status",
              agentId: "ui-agent",
            },
          },
          {
            id: "environment-source-image",
            payload: {
              type: "task.source.added",
              sourceId: "source-screen",
              name: "Codex 环境信息参考.png",
              mimeType: "image/png",
              kind: "image",
            },
          },
          {
            id: "environment-source-file",
            payload: {
              type: "task.source.added",
              sourceId: "source-plan",
              name: "任务环境面板计划.md",
              mimeType: "text/markdown",
              kind: "file",
            },
          },
          {
            id: "environment-source-web-search",
            payload: {
              type: "task.source.added",
              sourceId: "source-web-search",
              kind: "web-search",
              query: "Artemis task environment GitHub checks",
              engine: "DuckDuckGo HTML",
              resultCount: 2,
              searchUrl:
                "https://html.duckduckgo.com/html/?q=Artemis+task+environment",
              links: [
                {
                  title: "Artemis repository",
                  url: "https://github.com/EurekaRaider/Artemis",
                },
                {
                  title: "GitHub checks documentation",
                  url: "https://docs.github.com/actions",
                },
              ],
            },
          },
        ] satisfies SmokeEnvironmentEvent[])),
    {
      id: "environment-assistant-message",
      payload: {
        type: "message.part.delta",
        partId: "environment-assistant-message:text",
        partType: "text",
        delta: "环境面板、Git 状态和任务来源已经验证。",
      },
    },
    ...approvalEvents,
    ...(view === "environment-feedback-approval"
      ? []
      : ([
          {
            id: "environment-turn-completed",
            payload: {
              type: "turn.completed",
              reason: "completed",
              finalPartId: "environment-assistant-message:text",
              durationMs: 54_000,
            },
          },
        ] satisfies SmokeEnvironmentEvent[])),
  ];
  for (const event of events) {
    if (
      process.env.ARTEMIS_SMOKE_VIEW === "environment-branch-menu" &&
      (event.payload.type === "agent-team.status" ||
        event.payload.type === "child-agent.status" ||
        event.payload.type === "mcp.tool.used")
    ) {
      continue;
    }
    store.appendEvent(event.id, threadId, turnId, event.payload);
  }
  if (process.env.ARTEMIS_SMOKE_VIEW !== "environment-empty") {
    await taskSourceImages().save(threadId, "source-screen", {
      name: "Codex 环境信息参考.png",
      mimeType: "image/png",
      data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    });
  }
}

function createMainWindow(): BrowserWindow {
  const smokeScreenshot = process.env.ARTEMIS_SMOKE_SCREENSHOT;
  const smokeAccessibility = process.env.ARTEMIS_SMOKE_ACCESSIBILITY;
  const smokeFocusedScreenshot = process.env.ARTEMIS_SMOKE_SCREENSHOT_FOCUSED;
  const smokePickedScreenshot = process.env.ARTEMIS_SMOKE_SCREENSHOT_PICKED;
  const smokeArtifacts = Boolean(smokeScreenshot || smokeAccessibility);
  const requestedSmokeWidth = Number(process.env.ARTEMIS_SMOKE_WINDOW_WIDTH);
  const requestedSmokeResizeWidth = Number(
    process.env.ARTEMIS_SMOKE_RESIZE_WIDTH,
  );
  const smokeWidth =
    smokeMode && Number.isFinite(requestedSmokeWidth)
      ? Math.max(980, Math.min(2_000, Math.round(requestedSmokeWidth)))
      : 1_420;
  const requestedScale = Number(process.env.ARTEMIS_SMOKE_SCALE ?? "1");
  const smokeScale = [1, 1.25, 1.5, 2].includes(requestedScale)
    ? requestedScale
    : 1;
  let smokePreloadSecurity: {
    contextIsolated: boolean;
    sandboxed: boolean;
  } | null = null;
  let smokeBrowserWebviewSecurity: {
    allowRunningInsecureContent: boolean;
    attached: boolean;
    contextIsolation: boolean;
    guestType: string | null;
    navigationAllowed: boolean;
    nodeIntegration: boolean;
    nodeIntegrationInSubFrames: boolean;
    partition: string | null;
    preloadPresent: boolean;
    sandbox: boolean;
    webSecurity: boolean;
  } | null = null;
  const window = new BrowserWindow({
    width: smokeWidth,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: windowBackgroundColor(),
    title: "Artemis",
    show: !smokeArtifacts,
    enableLargerThanScreen: smokeArtifacts && process.platform === "darwin",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: join(import.meta.dirname, "preload.cjs"),
      backgroundThrottling: !smokeMode,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
    },
  });
  const smokeRendererConsoleEntries: Array<{
    level: "warning" | "error";
    message: string;
    lineNumber: number;
  }> = [];
  if (smokeMode) {
    window.webContents.on("console-message", (details) => {
      if (details.level === "warning" || details.level === "error") {
        smokeRendererConsoleEntries.push({
          level: details.level,
          message: details.message,
          lineNumber: details.lineNumber,
        });
      }
    });
  }
  if (smokeMode) {
    window.webContents.setZoomFactor(smokeScale);
  }
  if (smokeArtifacts) {
    window.once("ready-to-show", () => {
      if (smokeScreenshot) {
        const view = process.env.ARTEMIS_SMOKE_VIEW ?? "";
        if (
          view.startsWith("form-controls-") ||
          view === "mcp-editor-form-controls" ||
          view === "turn-changes-form-controls"
        ) {
          // Keep focus-evidence views on the active display. A macOS runner
          // cannot activate a window parked outside every screen, so moving
          // these views offscreen makes real :focus-visible evidence
          // impossible even when the renderer interaction is correct.
          window.center();
          window.show();
          if (process.platform === "darwin") app.focus({ steal: true });
          window.focus();
        } else {
          window.setPosition(-10_000, -10_000);
          window.showInactive();
        }
      } else {
        window.show();
      }
    });
  }
  window.on("unresponsive", () => {
    diagnosticBundleService?.record({
      source: "renderer",
      severity: "error",
      message: "The main Renderer window became unresponsive.",
    });
  });

  const devServer = process.env.ARTEMIS_DEV_SERVER_URL;
  const productionEntry = join(
    import.meta.dirname,
    "..",
    "dist-renderer",
    "index.html",
  );
  const rendererEntry = devServer ?? pathToFileURL(productionEntry).href;
  window.webContents.on("will-navigate", (event, url) => {
    if (!isRendererNavigationAllowed(url, rendererEntry, Boolean(devServer))) {
      event.preventDefault();
    }
  });
  window.webContents.on("context-menu", (event, params) => {
    const linkUrl = externalHttpUrl(params.linkURL);
    if (!linkUrl) return;
    event.preventDefault();
    const locale = currentLocale();
    Menu.buildFromTemplate([
      {
        label: mainText(locale, "openLink"),
        click: () => void shell.openExternal(linkUrl),
      },
      {
        label: mainText(locale, "copyLink"),
        click: () => clipboard.writeText(linkUrl),
      },
    ]).popup({ window });
  });
  window.webContents.on("will-frame-navigate", (event) => {
    if (
      !event.isMainFrame &&
      event.url !== "about:blank" &&
      event.url !== "about:srcdoc"
    ) {
      event.preventDefault();
    }
  });
  window.webContents.on(
    "will-attach-webview",
    (event, webPreferences, params) => {
      delete webPreferences.preload;
      webPreferences.nodeIntegration = false;
      webPreferences.nodeIntegrationInSubFrames = false;
      webPreferences.contextIsolation = true;
      webPreferences.sandbox = true;
      webPreferences.webSecurity = true;
      webPreferences.allowRunningInsecureContent = false;
      const navigationAllowed = isEmbeddedBrowserNavigationAllowed(
        params.src ?? "",
      );
      if (smokeMode) {
        smokeBrowserWebviewSecurity = {
          allowRunningInsecureContent: false,
          attached: false,
          contextIsolation: true,
          guestType: null,
          navigationAllowed,
          nodeIntegration: false,
          nodeIntegrationInSubFrames: false,
          partition:
            typeof webPreferences.partition === "string"
              ? webPreferences.partition
              : null,
          preloadPresent: typeof webPreferences.preload === "string",
          sandbox: true,
          webSecurity: true,
        };
      }
      if (!navigationAllowed) {
        event.preventDefault();
      }
    },
  );
  window.webContents.on("did-attach-webview", (_event, guest) => {
    if (smokeBrowserWebviewSecurity) {
      smokeBrowserWebviewSecurity = {
        ...smokeBrowserWebviewSecurity,
        attached: true,
        guestType: guest.getType(),
      };
    }
    guest.on("will-frame-navigate", (details) => {
      if (!isEmbeddedBrowserNavigationAllowed(details.url)) {
        details.preventDefault();
      }
    });
    guest.setWindowOpenHandler(({ url }) => {
      if (url.startsWith("https://") || url.startsWith("http://")) {
        void guest.loadURL(url);
      }
      return { action: "deny" };
    });
  });

  if (devServer) {
    void window.loadURL(devServer);
  } else {
    void window.loadFile(productionEntry);
  }

  ipcMain.once(IPC.rendererReady, (event, runtimeSecurity: unknown) => {
    if (event.sender.id === window.webContents.id) {
      if (
        smokeMode &&
        typeof runtimeSecurity === "object" &&
        runtimeSecurity !== null &&
        typeof (runtimeSecurity as { contextIsolated?: unknown })
          .contextIsolated === "boolean" &&
        typeof (runtimeSecurity as { sandboxed?: unknown }).sandboxed ===
          "boolean"
      ) {
        smokePreloadSecurity = {
          contextIsolated: (runtimeSecurity as { contextIsolated: boolean })
            .contextIsolated,
          sandboxed: (runtimeSecurity as { sandboxed: boolean }).sandboxed,
        };
      }
      markStartupStage("renderer-ready");
      if (!smokeMode) {
        for (const thread of store?.listThreads() ?? []) {
          if (thread.goal?.status === "active") {
            scheduleGoalContinuation(thread.id, thread.goal.goalId);
          }
        }
      }
    }
  });

  if (smokeScreenshot || smokeAccessibility) {
    const readyTimeout = setTimeout(() => {
      console.error("Smoke validation failed: renderer did not paint in time.");
      app.exit(1);
    }, 15_000);
    ipcMain.once(IPC.rendererReady, (event) => {
      clearTimeout(readyTimeout);
      if (event.sender.id !== window.webContents.id) {
        app.exit(1);
        return;
      }
      window.webContents.setZoomFactor(smokeScale);
      if (smokeMode && Number.isFinite(requestedSmokeResizeWidth)) {
        window.setSize(
          Math.max(980, Math.min(2_000, Math.round(requestedSmokeResizeWidth))),
          920,
        );
      }
      // PR10C review (severe 1): a multi-question-ui* view activates the
      // smoke channel only alongside its dedicated ARTEMIS_SMOKE_MULTI_UI
      // sentinel; without it the view is unknown here and prepares
      // nothing — the same contract as the ARTEMIS_SMOKE_USER_INPUT gate
      // below and the seedSmokeMultiQuestionUiFixture guard.
      const rawSmokeView = process.env.ARTEMIS_SMOKE_VIEW;
      const requestedSmokeView = rawSmokeView?.startsWith("multi-question-ui")
        ? process.env.ARTEMIS_SMOKE_MULTI_UI === "1"
          ? rawSmokeView
          : undefined
        : rawSmokeView;
      // The smoke window is shown offscreen via showInactive(), so the
      // renderer document never has OS focus and element.focus() would only
      // move activeElement without firing focus events. Focusing the web
      // contents first lets the card-heatmap cell focus run the real
      // onFocus -> hovered -> tooltip chain for the §6 focus evidence.
      if (smokeMode && requestedSmokeView === "card-heatmap") {
        window.webContents.focus();
      }
      const prepareSmokeView = process.env.ARTEMIS_SMOKE_USER_INPUT
        ? window.webContents.executeJavaScript(
            "document.querySelector('.thread-select')?.click()",
          )
        : requestedSmokeView
          ? window.webContents.executeJavaScript(`
              (async () => {
                const wait = (milliseconds) =>
                  new Promise((resolve) => setTimeout(resolve, milliseconds));
                const clickByText = (selector, text) => {
                  const button = [...document.querySelectorAll(selector)].find(
                    (candidate) =>
                      candidate.textContent?.trim().startsWith(text),
                  );
                  button?.click();
                };
                const view = ${JSON.stringify(requestedSmokeView)};
                const requestedDirection = ${JSON.stringify(
                  process.env.ARTEMIS_SMOKE_DIRECTION ?? "ltr",
                )};
                if (requestedDirection === 'rtl') {
                  document.documentElement.dir = 'rtl';
                }
                if (view === 'feedback-layout-settings') {
                  const activity = [...document.querySelectorAll('.activity-button')].find(
                    (candidate) =>
                      candidate.getAttribute('aria-label') === 'Settings' ||
                      candidate.getAttribute('title') === 'Settings',
                  );
                  if (!(activity instanceof HTMLButtonElement)) {
                    throw new Error('Settings activity button missing.');
                  }
                  activity.click();
                  await wait(700);
                  let dialog = document.querySelector(
                    '.settings-panel[data-artemis-component="dialog"]',
                  );
                  if (!(dialog instanceof HTMLDialogElement)) {
                    throw new Error('Public Settings Dialog missing.');
                  }
                  const firstOpenFocusInside = dialog.contains(
                    document.activeElement,
                  );
                  dialog.dispatchEvent(
                    new Event('cancel', { bubbles: false, cancelable: true }),
                  );
                  await wait(250);
                  const focusReturned = document.activeElement === activity;
                  activity.click();
                  await wait(700);
                  dialog = document.querySelector(
                    '.settings-panel[data-artemis-component="dialog"]',
                  );
                  window.__feedbackLayoutInteraction = {
                    view,
                    firstOpenFocusInside,
                    focusReturned,
                    reopened: dialog instanceof HTMLDialogElement,
                    nativeModal: dialog instanceof HTMLDialogElement && dialog.open,
                  };
                  return;
                }
                if (view === 'user-input-transport') {
                  document.querySelector('.thread-select')?.click();
                  await wait(800);
                  return;
                }
                if (view.startsWith('conversation-timeline-')) {
                  document.querySelector('.thread-select')?.click();
                  await wait(900);
                  const viewport = document.querySelector(
                    '[data-artemis-component="timeline-viewport"]',
                  );
                  const disclosure = document.querySelector(
                    '[data-artemis-component="turn-execution-disclosure"]',
                  );
                  let bottomDistanceBefore = null;
                  let bottomDistanceAfter = null;
                  if (
                    view === 'conversation-timeline-rich' &&
                    viewport instanceof HTMLElement &&
                    disclosure instanceof HTMLDetailsElement
                  ) {
                    viewport.scrollTop = viewport.scrollHeight;
                    bottomDistanceBefore =
                      viewport.scrollHeight -
                      viewport.clientHeight -
                      viewport.scrollTop;
                    disclosure.querySelector('summary')?.click();
                    await wait(180);
                    bottomDistanceAfter =
                      viewport.scrollHeight -
                      viewport.clientHeight -
                      viewport.scrollTop;
                  }
                  const assistantAction = document.querySelector(
                    '[data-artemis-component="conversation-message"]' +
                      '[data-message-kind="assistant"] [data-part="actions"] button',
                  );
                  if (assistantAction instanceof HTMLButtonElement) {
                    assistantAction.focus({ preventScroll: true });
                  }
                  await wait(200);
                  const actionOpacity = assistantAction
                    ? getComputedStyle(
                        assistantAction.closest('[data-part="actions"]'),
                      ).opacity
                    : null;
                  const agentButtons = [
                    ...document.querySelectorAll(
                      'button[data-artemis-component="agent-activity"]',
                    ),
                  ];
                  const activeAgent = agentButtons.find((candidate) =>
                    candidate.textContent?.includes('Independent review'),
                  );
                  let childPanelOpened = false;
                  if (activeAgent instanceof HTMLButtonElement) {
                    activeAgent.click();
                    await wait(180);
                    childPanelOpened =
                      document.querySelector('.child-agent-panel') !== null;
                    document
                      .querySelector(
                        '[data-artemis-component="workspace-tab"] > [data-part="close"]',
                      )
                      ?.click();
                    await wait(120);
                  }
                  const inputChoice = document.querySelector(
                    '[data-artemis-component="user-input"] ' +
                      '[role="option"], ' +
                      '[data-artemis-component="user-input"] button',
                  );
                  if (inputChoice instanceof HTMLElement) {
                    inputChoice.focus({ preventScroll: true });
                  }
                  if (viewport instanceof HTMLElement) {
                    viewport.scrollTop = viewport.scrollHeight;
                  }
                  window.__conversationTimelineInteraction = {
                    view,
                    disclosureOpened:
                      disclosure instanceof HTMLDetailsElement && disclosure.open,
                    bottomDistanceBefore,
                    bottomDistanceAfter,
                    actionOpacity,
                    childPanelOpened,
                    inputFocused:
                      inputChoice instanceof HTMLElement &&
                      document.activeElement === inputChoice,
                  };
                  return;
                }
                if (view.startsWith('icon-sizing-')) {
                  if (view.startsWith('icon-sizing-environment')) {
                    document.querySelector('.thread-select')?.click();
                    await wait(600);
                    const trigger = document.querySelector(
                      '.environment-trigger',
                    );
                    if (trigger?.getAttribute('aria-expanded') !== 'true') {
                      trigger?.click();
                      await wait(500);
                    }
                    if (view === 'icon-sizing-environment-branch-menu') {
                      document
                        .querySelector(
                          '.environment-branch-control > .environment-row',
                        )
                        ?.click();
                      await wait(500);
                    }
                    if (view === 'icon-sizing-environment-commit') {
                      document.querySelector('.commit-push-row')?.click();
                      await wait(500);
                    }
                    return;
                  }
                  document.querySelectorAll('.activity-button')[1]?.click();
                  await wait(1_000);
                  if (view === 'icon-sizing-add-plugin') {
                    document.querySelector('.resource-add-button')?.click();
                    await wait(500);
                  } else if (view === 'icon-sizing-resource-manage') {
                    document
                      .querySelector(
                        '.resource-installed-overview .resource-icon-button',
                      )
                      ?.click();
                    await wait(500);
                    clickByText('.resource-management-tabs button', 'MCP');
                    await wait(300);
                    // Open the official MCP discovery panel: its form search
                    // icon rides the same styles rule group as the manage
                    // toolbar search icon but sits in block flow, so the
                    // measurement is not skewed by toolbar flex shrink.
                    document
                      .querySelector(
                        '.resource-list-heading-actions .resource-add-button',
                      )
                      ?.click();
                    await wait(300);
                  }
                  return;
                }
                if (view.startsWith('goal-')) {
                  document.querySelector('.thread-select')?.click();
                  await wait(700);
                  document
                    .querySelector('.confirmation-actions .secondary-button')
                    ?.click();
                  await wait(300);
                  if (view.startsWith('goal-editor')) {
                    document.querySelector('.goal-bar-main')?.click();
                    await wait(700);
                    if (view === 'goal-editor-load-error') {
                      await wait(300);
                      return;
                    }
                    const input = document.querySelector('.goal-editor-input');
                    if (!(input instanceof HTMLTextAreaElement)) {
                      throw new Error('Goal editor did not open.');
                    }
                    if (view === 'goal-editor-clean') return;
                    const setter = Object.getOwnPropertyDescriptor(
                      HTMLTextAreaElement.prototype,
                      'value',
                    )?.set;
                    const editedValue = view === 'goal-editor-empty'
                      ? '   '
                      : '编辑后的 Goal 内容已通过独立编辑器保存';
                    setter?.call(input, editedValue);
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    await wait(250);
                    if (view === 'goal-editor-dirty' || view === 'goal-editor-empty') {
                      return;
                    }
                    if (view === 'goal-editor-revert') {
                      document.querySelector('.goal-editor-revert')?.click();
                      await wait(250);
                      return;
                    }
                    if (view === 'goal-editor-shortcut') {
                      input.dispatchEvent(new KeyboardEvent('keydown', {
                        bubbles: true,
                        key: 'Enter',
                        metaKey: true,
                      }));
                      await wait(800);
                      return;
                    }
                    document
                      .querySelector('.goal-editor-footer .primary-button')
                      ?.click();
                    await wait(view === 'goal-editor-saving' ? 200 : 800);
                  }
                  return;
                }
                if (view.startsWith('input-fields-')) {
                  const waitForElement = async (selector) => {
                    const deadline = Date.now() + 8000;
                    while (Date.now() < deadline) {
                      const found = document.querySelector(selector);
                      if (found) return found;
                      await wait(100);
                    }
                    return null;
                  };
                  const clickActivity = (label) => {
                    const button = [
                      ...document.querySelectorAll('.activity-button'),
                    ].find(
                      (candidate) =>
                        candidate.getAttribute('aria-label') === label ||
                        candidate.getAttribute('title') === label,
                    );
                    button?.click();
                    return Boolean(button);
                  };
                  if (view === 'input-fields-automations-once') {
                    if (!clickActivity('Automations')) {
                      throw new Error('Automations activity button missing.');
                    }
                    if (!(await waitForElement('.automation-page'))) {
                      throw new Error('Automation page did not render.');
                    }
                    const createButton = await waitForElement(
                      '.automation-create-button:not(:disabled)',
                    );
                    if (!createButton) {
                      throw new Error(
                        'Automation create button stayed disabled.',
                      );
                    }
                    createButton.click();
                    if (!(await waitForElement('.automation-dialog'))) {
                      throw new Error('Automation dialog did not open.');
                    }
                    const presetSelect = [
                      ...document.querySelectorAll('.automation-dialog select'),
                    ].find((select) =>
                      [...select.options].some(
                        (option) => option.value === 'once',
                      ),
                    );
                    if (!presetSelect) {
                      throw new Error('Schedule preset select missing.');
                    }
                    const setter = Object.getOwnPropertyDescriptor(
                      HTMLSelectElement.prototype,
                      'value',
                    )?.set;
                    setter?.call(presetSelect, 'once');
                    presetSelect.dispatchEvent(
                      new Event('change', { bubbles: true }),
                    );
                    if (
                      !(await waitForElement(
                        '.automation-dialog input[type="date"]',
                      ))
                    ) {
                      throw new Error('Once date field did not render.');
                    }
                    return;
                  }
                  if (view === 'input-fields-settings-avatar') {
                    if (!clickActivity('Settings')) {
                      throw new Error('Settings activity button missing.');
                    }
                    if (!(await waitForElement('.settings-panel'))) {
                      throw new Error('Settings panel did not render.');
                    }
                    if (
                      !(await waitForElement('.profile-avatar-input')) ||
                      !(await waitForElement(
                        '.settings-profile-avatar-actions [data-artemis-component="button"]',
                      ))
                    ) {
                      throw new Error('Avatar field did not render.');
                    }
                    return;
                  }
                  return;
                }
                if (view.startsWith('form-controls-')) {
                  const waitForElement = async (selector) => {
                    const deadline = Date.now() + 8000;
                    while (Date.now() < deadline) {
                      const found = document.querySelector(selector);
                      if (found) return found;
                      await wait(100);
                    }
                    return null;
                  };
                  const clickActivity = (label) => {
                    const button = [
                      ...document.querySelectorAll('.activity-button'),
                    ].find(
                      (candidate) =>
                        candidate.getAttribute('aria-label') === label ||
                        candidate.getAttribute('title') === label,
                    );
                    button?.click();
                    return Boolean(button);
                  };
                  if (view === 'form-controls-archive') {
                    if (!clickActivity('Archive')) {
                      throw new Error('Archive activity button missing.');
                    }
                    const searchRoot = await waitForElement(
                      '[data-artemis-component="search-field"].archive-search',
                    );
                    const search = searchRoot?.querySelector(
                      '[data-part="control"]',
                    );
                    if (!(search instanceof HTMLInputElement)) {
                      throw new Error('Public archive SearchField missing.');
                    }
                    const setter = Object.getOwnPropertyDescriptor(
                      HTMLInputElement.prototype,
                      'value',
                    )?.set;
                    setter?.call(search, 'synthetic archive query');
                    search.dispatchEvent(new Event('input', { bubbles: true }));
                    await wait(200);
                    search.focus({ preventScroll: true, focusVisible: true });
                    window.__formControlsInteraction = {
                      view,
                      searchValue: search.value,
                      rootStable:
                        searchRoot ===
                        document.querySelector(
                          '[data-artemis-component="search-field"].archive-search',
                        ),
                    };
                    return;
                  }
                  if (view.startsWith('form-controls-settings')) {
                    if (!clickActivity('Settings')) {
                      throw new Error('Settings activity button missing.');
                    }
                    if (!(await waitForElement('.settings-panel'))) {
                      throw new Error('Settings panel did not render.');
                    }
                    const providersTab = await waitForElement(
                      '#settings-tab-providers-button',
                    );
                    if (!(providersTab instanceof HTMLButtonElement)) {
                      throw new Error('Settings providers tab missing.');
                    }
                    providersTab.click();
                    if (view === 'form-controls-settings-custom') {
                      const customTab = await waitForElement(
                        '#provider-config-custom-tab',
                      );
                      if (!(customTab instanceof HTMLButtonElement)) {
                        throw new Error('Settings custom providers tab missing.');
                      }
                      customTab.click();
                      const checkboxRoot = await waitForElement(
                        '#provider-config-custom [data-artemis-component="checkbox"]',
                      );
                      const checkbox = checkboxRoot?.querySelector(
                        '[data-part="control"]',
                      );
                      if (!(checkbox instanceof HTMLInputElement)) {
                        throw new Error('Public Settings Checkbox missing.');
                      }
                      const beforeChecked = checkbox.checked;
                      checkbox.click();
                      await wait(200);
                      window.__formControlsInteraction = {
                        view,
                        beforeChecked,
                        afterChecked: checkbox.checked,
                        checkboxRootStable:
                          checkboxRoot ===
                          document.querySelector(
                            '#provider-config-custom [data-artemis-component="checkbox"]',
                          ),
                      };
                      return;
                    }
                    const field = await waitForElement(
                      '#provider-config-builtin [data-artemis-component="text-field"] [data-part="control"]',
                    );
                    const trigger = await waitForElement(
                      '#provider-config-builtin [data-artemis-component="select"] [data-part="trigger"]:not(:disabled)',
                    );
                    const selectRoot = trigger?.closest(
                      '[data-artemis-component="select"]',
                    );
                    if (
                      !(field instanceof HTMLInputElement) ||
                      !(trigger instanceof HTMLButtonElement)
                    ) {
                      throw new Error('Public Settings field/select missing.');
                    }
                    const beforeText = trigger.textContent?.trim() ?? '';
                    trigger.click();
                    const search = await waitForElement(
                      '#provider-config-builtin [data-artemis-component="select"] [data-part="search"]',
                    );
                    if (!(search instanceof HTMLInputElement)) {
                      throw new Error('Public searchable Select did not open.');
                    }
                    const openMenu = selectRoot.querySelector(
                      '[data-part="menu"]',
                    );
                    const openListbox = selectRoot.querySelector(
                      '[data-part="listbox"]',
                    );
                    const rootBounds = selectRoot.getBoundingClientRect();
                    const openMenuBounds = openMenu?.getBoundingClientRect();
                    const openMenuStyle = openMenu
                      ? getComputedStyle(openMenu)
                      : null;
                    const openListboxStyle = openListbox
                      ? getComputedStyle(openListbox)
                      : null;
                    const openedMenu =
                      openMenuBounds && openMenuStyle
                        ? {
                            backgroundColor: openMenuStyle.backgroundColor,
                            borderStyle: openMenuStyle.borderStyle,
                            borderWidth: openMenuStyle.borderWidth,
                            geometry: {
                              width: openMenuBounds.width,
                              height: openMenuBounds.height,
                            },
                            inlineStartDelta: Math.abs(
                              openMenuBounds.left - rootBounds.left,
                            ),
                            inlineEndDelta: Math.abs(
                              openMenuBounds.right - rootBounds.right,
                            ),
                            listboxOverflowY:
                              openListboxStyle?.overflowY ?? null,
                            overflowX: openMenuStyle.overflowX,
                            overflowY: openMenuStyle.overflowY,
                            withinViewport:
                              openMenuBounds.left >= 0 &&
                              openMenuBounds.right <= window.innerWidth &&
                              openMenuBounds.top >= 0 &&
                              openMenuBounds.bottom <= window.innerHeight,
                            zIndex: openMenuStyle.zIndex,
                          }
                        : null;
                    const optionCount = selectRoot.querySelectorAll(
                      '[role="option"]',
                    ).length;
                    search.dispatchEvent(
                      new KeyboardEvent('keydown', {
                        bubbles: true,
                        key: 'ArrowDown',
                      }),
                    );
                    await wait(100);
                    search.dispatchEvent(
                      new CompositionEvent('compositionstart', {
                        bubbles: true,
                        data: '中',
                      }),
                    );
                    search.dispatchEvent(
                      new KeyboardEvent('keydown', {
                        bubbles: true,
                        isComposing: true,
                        key: 'Enter',
                      }),
                    );
                    await wait(100);
                    const composedMenuOpen =
                      selectRoot?.querySelector('[data-part="listbox"]') !==
                      null;
                    const composedText = trigger.textContent?.trim() ?? '';
                    search.dispatchEvent(
                      new CompositionEvent('compositionend', {
                        bubbles: true,
                        data: '中',
                      }),
                    );
                    search.dispatchEvent(
                      new KeyboardEvent('keydown', {
                        bubbles: true,
                        key: 'Enter',
                      }),
                    );
                    await wait(250);
                    field.focus({ preventScroll: true, focusVisible: true });
                    window.__formControlsInteraction = {
                      view,
                      beforeText,
                      optionCount,
                      composedText,
                      composedMenuOpen,
                      openedMenu,
                      committedMenuClosed:
                        selectRoot?.querySelector('[data-part="listbox"]') ===
                        null,
                      committedText: trigger.textContent?.trim() ?? '',
                      selectRootStable:
                        selectRoot ===
                        document.querySelector(
                          '#provider-config-builtin [data-artemis-component="select"]',
                        ),
                    };
                    return;
                  }
                  if (view === 'form-controls-composer') {
                    document.querySelector('.thread-select')?.click();
                    const trigger = await waitForElement(
                      '.composer-context-picker [data-artemis-component="select"] [data-part="trigger"]:not(:disabled)',
                    );
                    const selectRoot = trigger?.closest(
                      '[data-artemis-component="select"]',
                    );
                    if (
                      !(trigger instanceof HTMLButtonElement) ||
                      !selectRoot
                    ) {
                      throw new Error('Public Composer Select missing.');
                    }
                    return;
                  }
                  throw new Error('Unknown form-controls smoke view: ' + view);
                }
                if (view.startsWith('queued-steer')) {
                  const waitFor = async (selector) => {
                    const deadline = Date.now() + 5000;
                    while (Date.now() < deadline) {
                      const found = document.querySelector(selector);
                      if (found) return found;
                      await wait(100);
                    }
                    return null;
                  };
                  document.querySelector('.thread-select')?.click();
                  await waitFor('.queued-message-bar');
                  if (!document.querySelector('.queued-message-bar')) {
                    throw new Error('Queued message bar did not render.');
                  }
                  const captureActionsGeometry = () => {
                    const container = document.querySelector(
                      '.queued-message-editor-actions',
                    );
                    if (!container) {
                      window.__queuedSteerActions = null;
                      return;
                    }
                    const buttons = Array.from(
                      container.querySelectorAll('button'),
                    );
                    const style = getComputedStyle(container);
                    const bounds = container.getBoundingClientRect();
                    window.__queuedSteerActions = {
                      present: true,
                      directChildOfEditorRoot:
                        container.parentElement ===
                        container.closest('.queued-message-editor'),
                      display: style.display,
                      flexDirection: style.flexDirection,
                      justifyContent: style.justifyContent,
                      gap: style.gap,
                      buttonCount: buttons.length,
                      buttonLabels: buttons.map((button) =>
                        (button.textContent ?? '').trim(),
                      ),
                      containerWidth: bounds.width,
                      buttonWidths: buttons.map(
                        (button) => button.getBoundingClientRect().width,
                      ),
                      buttonTops: buttons.map(
                        (button) => button.getBoundingClientRect().top,
                      ),
                    };
                  };
                  const openEditor = async () => {
                    document
                      .querySelector('[data-queued-index="0"] .queued-message-edit')
                      ?.click();
                    await wait(350);
                    const editor = document.querySelector(
                      '.queued-message-editor textarea',
                    );
                    if (!(editor instanceof HTMLTextAreaElement)) {
                      throw new Error('Queued message editor did not open.');
                    }
                    captureActionsGeometry();
                    return editor;
                  };
                  const setEditorValue = async (editor, value) => {
                    const setter = Object.getOwnPropertyDescriptor(
                      HTMLTextAreaElement.prototype,
                      'value',
                    )?.set;
                    setter?.call(editor, value);
                    editor.dispatchEvent(new Event('input', { bubbles: true }));
                    await wait(250);
                  };
                  if (view === 'queued-steer-edit') {
                    await openEditor();
                    return;
                  }
                  if (view === 'queued-steer-cancel') {
                    const editor = await openEditor();
                    editor.dispatchEvent(
                      new KeyboardEvent('keydown', {
                        key: 'Escape',
                        bubbles: true,
                      }),
                    );
                    await wait(350);
                    return;
                  }
                  if (
                    view === 'queued-steer-save' ||
                    view === 'queued-steer-save-error'
                  ) {
                    const editor = await openEditor();
                    await setEditorValue(
                      editor,
                      '排队消息一（已编辑）：格式检查通过，继续类型检查',
                    );
                    editor.dispatchEvent(
                      new KeyboardEvent('keydown', {
                        key: 'Enter',
                        metaKey: true,
                        bubbles: true,
                      }),
                    );
                    await wait(800);
                    return;
                  }
                  if (view === 'queued-steer-ime') {
                    const editor = await openEditor();
                    await setEditorValue(
                      editor,
                      '排队消息一（输入法组合中）：正在输入中文',
                    );
                    editor.dispatchEvent(
                      new CompositionEvent('compositionstart', {
                        bubbles: true,
                      }),
                    );
                    const composingEnter = new KeyboardEvent('keydown', {
                      key: 'Enter',
                      metaKey: true,
                      bubbles: true,
                      isComposing: true,
                    });
                    window.__queuedSteerProbe = {
                      compositionstartDispatched: true,
                      dispatchedIsComposing: composingEnter.isComposing,
                      submitBlocked: false,
                    };
                    editor.dispatchEvent(composingEnter);
                    await wait(500);
                    window.__queuedSteerProbe.submitBlocked =
                      document.querySelector(
                        '.queued-message-editor textarea',
                      ) !== null;
                    return;
                  }
                  return;
                }
                if (view.startsWith('markdown-editor')) {
                  const waitFor = async (selector) => {
                    const deadline = Date.now() + 5000;
                    while (Date.now() < deadline) {
                      const found = document.querySelector(selector);
                      if (found) return found;
                      await wait(100);
                    }
                    return null;
                  };
                  document.querySelector('.thread-select')?.click();
                  await wait(400);
                  if (view === 'markdown-editor-navigation-preview') {
                    const disclosure = await waitFor(
                      '.tool-card[data-artemis-component="tool-activity"] [data-part="disclosure"]',
                    );
                    if (!(disclosure instanceof HTMLButtonElement)) {
                      throw new Error('Synthetic Markdown tool activity missing.');
                    }
                    disclosure.click();
                    const fileLink = await waitFor('.tool-file-link');
                    if (!(fileLink instanceof HTMLButtonElement)) {
                      throw new Error('Synthetic Markdown file link missing.');
                    }
                    fileLink.click();
                    if (
                      !(await waitFor(
                        '[data-artemis-component="workspace-tab-pane"][data-state="active"] > [data-artemis-component="workspace-editor-toolbar"]',
                      ))
                    ) {
                      throw new Error('Markdown reader panel did not render.');
                    }
                    return;
                  }
                  document.querySelector('.right-sidebar-toggle')?.click();
                  await waitFor('.workspace-tab-add');
                  document.querySelector('.workspace-tab-add')?.click();
                  await waitFor('.workspace-tab-menu');
                  const filesTabButton = [
                    ...document.querySelectorAll('.workspace-tab-menu button'),
                  ].find((button) =>
                    (button.textContent ?? '').trim().startsWith('Files'),
                  );
                  if (!filesTabButton) {
                    throw new Error('Files tab entry did not render.');
                  }
                  filesTabButton.click();
                  await waitFor(
                    '[data-artemis-component="workspace-file-tree"]',
                  );
                  const treeRowFor = (fileName) =>
                    [
                      ...document.querySelectorAll(
                        '[data-artemis-component="workspace-file-tree-row"]',
                      ),
                    ].find(
                      (button) => button.getAttribute('title') === fileName,
                    );
                  if (view === 'markdown-editor-binary') {
                    const binaryRow = treeRowFor('cover.png');
                    if (!binaryRow) {
                      throw new Error('Seeded binary file did not render.');
                    }
                    binaryRow.click();
                    await waitFor(
                      '[data-artemis-component="workspace-file-layout"] [data-artemis-component="workspace-content-state"]',
                    );
                    return;
                  }
                  if (view === 'markdown-editor-large-file') {
                    const largeRow = treeRowFor('LARGE.ts');
                    if (!largeRow) {
                      throw new Error('Seeded large source file did not render.');
                    }
                    largeRow.click();
                    await waitFor(
                      '[data-artemis-component="workspace-file-layout"] [data-artemis-component="workspace-editor-toolbar"]',
                    );
                    await waitFor(
                      '[data-artemis-component="workspace-file-layout"] [data-artemis-component="workspace-source-editor"] [data-part="source"]',
                    );
                    return;
                  }
                  const markdownRow = treeRowFor('NOTES.md');
                  if (!markdownRow) {
                    throw new Error('Seeded markdown file did not render.');
                  }
                  markdownRow.click();
                  await waitFor(
                    '[data-artemis-component="workspace-file-layout"] [data-artemis-component="workspace-editor-toolbar"]',
                  );
                  await waitFor('[data-workspace-image-failed]');
                  if (view === 'markdown-editor-navigation-toolbar') {
                    return;
                  }
                  const openSourceView = async () => {
                    const sourceButton = [
                      ...document.querySelectorAll(
                        '[data-artemis-component="workspace-file-layout"] [data-artemis-component="workspace-editor-toolbar"] [data-part="mode"] [data-artemis-component="segmented-control"] button',
                      ),
                    ].find(
                      (button) =>
                        (button.textContent ?? '').trim() === 'Source',
                    );
                    sourceButton?.click();
                    await wait(300);
                    return document.querySelector(
                      '[data-artemis-component="workspace-file-layout"] [data-artemis-component="workspace-source-editor"] [data-part="source"]',
                    );
                  };
                  const setSourceValue = async (textarea, value) => {
                    const setter = Object.getOwnPropertyDescriptor(
                      HTMLTextAreaElement.prototype,
                      'value',
                    )?.set;
                    setter?.call(textarea, value);
                    textarea.dispatchEvent(
                      new Event('input', { bubbles: true }),
                    );
                    await wait(250);
                  };
                  if (view === 'markdown-editor-open') {
                    return;
                  }
                  if (view === 'markdown-editor-image-failure') {
                    document
                      .querySelector('[data-workspace-image-failed]')
                      ?.scrollIntoView({ block: 'center' });
                    await wait(300);
                    return;
                  }
                  if (view === 'markdown-editor-toggle') {
                    const toggleStates = () => {
                      const buttons = [
                        ...document.querySelectorAll(
                          '[data-artemis-component="workspace-file-layout"] [data-artemis-component="workspace-editor-toolbar"] [data-part="mode"] [data-artemis-component="segmented-control"] button',
                        ),
                      ];
                      return {
                        richPressed:
                          buttons[0]?.getAttribute('aria-pressed') ?? null,
                        sourcePressed:
                          buttons[1]?.getAttribute('aria-pressed') ?? null,
                        textareaPresent:
                          document.querySelector(
                            '[data-artemis-component="workspace-file-layout"] [data-artemis-component="workspace-source-editor"] [data-part="source"]',
                          ) !== null,
                        previewPresent:
                          document.querySelector(
                            '[data-artemis-component="workspace-file-layout"] [data-artemis-component="workspace-preview"]',
                          ) !== null,
                      };
                    };
                    const sourceButton = [
                      ...document.querySelectorAll(
                        '[data-artemis-component="workspace-file-layout"] [data-artemis-component="workspace-editor-toolbar"] [data-part="mode"] [data-artemis-component="segmented-control"] button',
                      ),
                    ].find(
                      (button) =>
                        (button.textContent ?? '').trim() === 'Source',
                    );
                    sourceButton?.click();
                    await wait(300);
                    const afterSource = toggleStates();
                    const richButton = [
                      ...document.querySelectorAll(
                        '[data-artemis-component="workspace-file-layout"] [data-artemis-component="workspace-editor-toolbar"] [data-part="mode"] [data-artemis-component="segmented-control"] button',
                      ),
                    ].find(
                      (button) =>
                        (button.textContent ?? '').trim() === 'Rich text',
                    );
                    richButton?.click();
                    await waitFor(
                      '[data-artemis-component="workspace-file-layout"] [data-artemis-component="workspace-preview"]',
                    );
                    await waitFor('[data-workspace-image-failed]');
                    const afterRich = toggleStates();
                    sourceButton?.click();
                    await wait(300);
                    window.__markdownEditorToggleProbe = {
                      afterSource,
                      afterRich,
                    };
                    return;
                  }
                  const textarea = await openSourceView();
                  if (!(textarea instanceof HTMLTextAreaElement)) {
                    throw new Error('Source editing surface did not open.');
                  }
                  await setSourceValue(
                    textarea,
                    textarea.value +
                      '\\n\\nEdited line appended by the markdown editor smoke run.',
                  );
                  if (view === 'markdown-editor-dirty') {
                    return;
                  }
                  textarea.focus();
                  const statusRegion = document.querySelector(
                    '[data-artemis-component="workspace-file-layout"] [data-artemis-component="workspace-editor-toolbar"] [data-part="status"]',
                  );
                  window.__markdownEditorStatusTrace = [];
                  if (statusRegion) {
                    new MutationObserver(() => {
                      const text = statusRegion.textContent?.trim() ?? '';
                      const trace = window.__markdownEditorStatusTrace;
                      if (trace[trace.length - 1] !== text) trace.push(text);
                    }).observe(statusRegion, {
                      childList: true,
                      characterData: true,
                      subtree: true,
                    });
                  }
                  textarea.dispatchEvent(
                    new KeyboardEvent('keydown', {
                      key: 's',
                      metaKey: true,
                      bubbles: true,
                    }),
                  );
                  await wait(1000);
                  return;
                }
                if (view.startsWith('mcp-editor')) {
                  const waitFor = async (selector) => {
                    const deadline = Date.now() + 5000;
                    while (Date.now() < deadline) {
                      const found = document.querySelector(selector);
                      if (found) return found;
                      await wait(100);
                    }
                    return null;
                  };
                  const setInputValue = (input, value) => {
                    const setter = Object.getOwnPropertyDescriptor(
                      HTMLInputElement.prototype,
                      'value',
                    )?.set;
                    setter?.call(input, value);
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                  };
                  const mcpInputByLabel = (text) => {
                    const label = [
                      ...document.querySelectorAll(
                        '.mcp-editor label[data-part="label"]',
                      ),
                    ].find(
                      (candidate) => candidate.textContent?.trim() === text,
                    );
                    return label instanceof HTMLLabelElement
                      ? label.control
                      : null;
                  };
                  const mcpInputsByLabelPrefix = (prefix) => [
                    ...document.querySelectorAll(
                      '.mcp-editor label[data-part="label"]',
                    ),
                  ].flatMap((label) =>
                    label instanceof HTMLLabelElement &&
                    label.textContent?.trim().startsWith(prefix) &&
                    label.control instanceof HTMLInputElement
                      ? [label.control]
                      : [],
                  );
                  const captureDisabledState = () => ({
                    ariaBusy:
                      document
                        .querySelector('.mcp-editor-feedback')
                        ?.getAttribute('aria-busy') ?? null,
                    busyText:
                      document.querySelector('.mcp-editor-busy')?.textContent?.trim() ??
                      null,
                    saveDisabled:
                      document.querySelector('.mcp-editor-save') instanceof
                      HTMLButtonElement
                        ? document.querySelector('.mcp-editor-save').disabled
                        : null,
                    removeDisabled:
                      document.querySelector('.mcp-editor-remove') instanceof
                      HTMLButtonElement
                        ? document.querySelector('.mcp-editor-remove').disabled
                        : null,
                    testDisabled:
                      document.querySelector('.mcp-editor-test-button') instanceof
                      HTMLButtonElement
                        ? document.querySelector('.mcp-editor-test-button').disabled
                        : null,
                    backDisabled:
                      document.querySelector('.mcp-editor-back') instanceof
                      HTMLButtonElement
                        ? document.querySelector('.mcp-editor-back').disabled
                        : null,
                    urlDisabled:
                      document.querySelector('.mcp-editor input[type="url"]') instanceof
                      HTMLInputElement
                        ? document.querySelector('.mcp-editor input[type="url"]').disabled
                        : null,
                  });
                  const installBusyTrace = () => {
                    window.__mcpEditorBusyTrace = [];
                    const feedback = document.querySelector('.mcp-editor-feedback');
                    if (!feedback) return;
                    const record = () => {
                      const trace = window.__mcpEditorBusyTrace;
                      const next = captureDisabledState();
                      const last = trace[trace.length - 1];
                      if (last && JSON.stringify(last) === JSON.stringify(next)) {
                        return;
                      }
                      trace.push(next);
                    };
                    record();
                    new MutationObserver(record).observe(feedback, {
                      attributes: true,
                      attributeFilter: ['aria-busy'],
                      childList: true,
                      subtree: true,
                    });
                  };
                  const openManageMcpTab = async () => {
                    document.querySelectorAll('.activity-button')[1]?.click();
                    await waitFor('.resource-installed-overview .resource-icon-button');
                    document
                      .querySelector('.resource-installed-overview .resource-icon-button')
                      ?.click();
                    const mcpTab = await waitFor('#resource-management-tab-mcp');
                    mcpTab?.click();
                    await waitFor('#resource-management-panel-mcp');
                    const readSeedRowByName = (serverName) => {
                      const seededRow = [
                        ...document.querySelectorAll('.resource-management-row'),
                      ].find(
                        (candidate) =>
                          candidate.querySelector('strong')?.textContent?.trim() ===
                          serverName,
                      );
                      return seededRow
                        ? {
                            stateText:
                              seededRow
                                .querySelector('[data-part="description"]')
                                ?.textContent?.trim() ?? null,
                          }
                        : null;
                    };
                    // Zero-dial evidence (PR8 review F2/F3): both seeded rows
                    // must render their offline state ("Disabled · N tools"),
                    // proving the fixtures entered mcp.json with enabled:false
                    // and were never auto-connected at startup.
                    window.__mcpEditorSeedRow = readSeedRowByName(
                      'Artemis Smoke Remote',
                    );
                    window.__mcpEditorSeedStdioRow = readSeedRowByName(
                      'Artemis Smoke Local',
                    );
                  };
                  const openNewServerEditor = async () => {
                    await openManageMcpTab();
                    const addButton = [
                      ...document.querySelectorAll('.resource-add-button'),
                    ].find((button) =>
                      (button.textContent ?? '').trim().startsWith('Add server'),
                    );
                    if (!addButton) {
                      throw new Error(
                        'Add server button did not render: ' +
                          JSON.stringify({
                            selectedTab:
                              document
                                .querySelector('#resource-management-tab-mcp')
                                ?.getAttribute('aria-selected') ?? null,
                            panel:
                              document.querySelector(
                                '#resource-management-panel-mcp',
                              ) !== null,
                            actionLabels: [
                              ...document.querySelectorAll(
                                '#resource-management-panel-mcp button',
                              ),
                            ].map((button) => button.textContent?.trim() ?? ''),
                          }),
                      );
                    }
                    addButton.click();
                    await waitFor('.mcp-editor');
                    if (!document.querySelector('.mcp-editor')) {
                      throw new Error('MCP server editor did not open.');
                    }
                  };
                  const openSeededServerEditorByName = async (serverName) => {
                    await openManageMcpTab();
                    await waitFor('.resource-management-list .resource-management-row');
                    const row = [
                      ...document.querySelectorAll('.resource-management-row'),
                    ].find(
                      (candidate) =>
                        candidate.querySelector('strong')?.textContent?.trim() ===
                        serverName,
                    );
                    if (!row) {
                      throw new Error(
                        'Seeded MCP server row did not render: ' + serverName,
                      );
                    }
                    row.querySelector('.resource-icon-button')?.click();
                    await waitFor('.mcp-editor');
                    await waitFor('.mcp-editor-test');
                    if (!document.querySelector('.mcp-editor-test')) {
                      throw new Error('Edit-mode test control did not render.');
                    }
                  };
                  const openSeededServerEditor = () =>
                    openSeededServerEditorByName('Artemis Smoke Remote');
                  if (view === 'mcp-editor-form-controls') {
                    await openSeededServerEditor();
                    const trigger = document.querySelector(
                      '.mcp-editor [data-artemis-component="select"] [data-part="trigger"]',
                    );
                    const selectRoot = trigger?.closest(
                      '[data-artemis-component="select"]',
                    );
                    if (
                      !(trigger instanceof HTMLButtonElement) ||
                      !selectRoot
                    ) {
                      throw new Error('Public MCP editor Select missing.');
                    }
                    return;
                  }
                  if (view === 'mcp-editor-new') {
                    await openNewServerEditor();
                    return;
                  }
                  if (view === 'mcp-editor-validation') {
                    await openNewServerEditor();
                    const command = mcpInputByLabel('Launch command');
                    if (!(command instanceof HTMLInputElement)) {
                      throw new Error('Launch command input did not render.');
                    }
                    setInputValue(command, '   ');
                    await wait(250);
                    document.querySelector('.mcp-editor-save')?.click();
                    await wait(300);
                    return;
                  }
                  if (view === 'mcp-editor-save' || view === 'mcp-editor-save-error') {
                    await openNewServerEditor();
                    const command = mcpInputByLabel('Launch command');
                    if (!(command instanceof HTMLInputElement)) {
                      throw new Error('Launch command input did not render.');
                    }
                    setInputValue(command, 'artemis-smoke-mcp-server');
                    await wait(300);
                    installBusyTrace();
                    document.querySelector('.mcp-editor-save')?.click();
                    await wait(1_200);
                    return;
                  }
                  if (view === 'mcp-editor-test-drift') {
                    await openSeededServerEditor();
                    const url = mcpInputByLabel('Server URL');
                    if (!(url instanceof HTMLInputElement)) {
                      throw new Error('Server URL input did not render.');
                    }
                    setInputValue(
                      url,
                      'https://mcp.artemis-smoke.example.test/mcp-drift',
                    );
                    await wait(400);
                    return;
                  }
                  if (view === 'mcp-editor-test-drift-stdio') {
                    await openSeededServerEditorByName('Artemis Smoke Local');
                    const readArgsDraft = () =>
                      mcpInputsByLabelPrefix('Arguments ').map(
                        (input) => input.value,
                      );
                    const readTestGate = () => {
                      const button = document.querySelector(
                        '.mcp-editor-test-button',
                      );
                      const hint = document.querySelector(
                        '.mcp-editor-test .mcp-editor-test-hint',
                      );
                      return {
                        testDisabled:
                          button instanceof HTMLButtonElement
                            ? button.disabled
                            : null,
                        testHintPresent: hint != null,
                        testHintText: hint?.textContent?.trim() ?? null,
                      };
                    };
                    window.__mcpEditorProbe = {
                      driftField: 'args',
                      before: {
                        argsValues: readArgsDraft(),
                        ...readTestGate(),
                      },
                    };
                    // Append a draft-only argument: Add argument -> --drift.
                    document
                      .querySelector('.mcp-editor .mcp-add-row')
                      ?.click();
                    await wait(200);
                    const added = mcpInputByLabel('Arguments 2');
                    if (!(added instanceof HTMLInputElement)) {
                      throw new Error('Added argument input did not render.');
                    }
                    setInputValue(added, '--drift');
                    await wait(400);
                    window.__mcpEditorProbe.drifted = {
                      argsValues: readArgsDraft(),
                      ...readTestGate(),
                    };
                    // A programmatic click on the drifted (disabled) control
                    // must stay a no-op: the main process counts reconnect
                    // IPC invocations and the audit asserts zero (PR8 F3).
                    document.querySelector('.mcp-editor-test-button')?.click();
                    await wait(500);
                    window.__mcpEditorProbe.afterClick = {
                      argsValues: readArgsDraft(),
                      ...readTestGate(),
                    };
                    // Revert the draft so it matches the saved config again.
                    mcpInputByLabel('Arguments 2')
                      ?.closest('.mcp-argument-row')
                      ?.querySelector('.mcp-remove-row')
                      ?.click();
                    await wait(400);
                    window.__mcpEditorProbe.reverted = {
                      argsValues: readArgsDraft(),
                      ...readTestGate(),
                    };
                    return;
                  }
                  if (view.startsWith('mcp-editor-test-')) {
                    await openSeededServerEditor();
                    document.querySelector('.mcp-editor-test-button')?.click();
                    await wait(view === 'mcp-editor-test-busy' ? 400 : 1_500);
                    return;
                  }
                  if (view === 'mcp-editor-remove-confirm') {
                    await openSeededServerEditor();
                    const readDialog = () => {
                      const dialog = document.querySelector('.confirmation-dialog');
                      return {
                        present: dialog !== null,
                        role: dialog?.getAttribute('role') ?? null,
                        tone: dialog?.getAttribute('class') ?? null,
                        message:
                          dialog
                            ?.querySelector('#confirmation-message')
                            ?.textContent?.trim() ?? null,
                        cancelLabel:
                          dialog
                            ?.querySelector('.secondary-button')
                            ?.textContent?.trim() ?? null,
                        confirmLabel:
                          dialog
                            ?.querySelector('.primary-button')
                            ?.textContent?.trim() ?? null,
                      };
                    };
                    document.querySelector('.mcp-editor-remove')?.click();
                    await waitFor('.confirmation-dialog.danger');
                    window.__mcpEditorProbe = { dialog: readDialog() };
                    document
                      .querySelector('.confirmation-actions .secondary-button')
                      ?.click();
                    await wait(400);
                    window.__mcpEditorProbe.rejection = {
                      dialogGone: document.querySelector('.confirmation-dialog') === null,
                      editorStillOpen: document.querySelector('.mcp-editor') !== null,
                    };
                    document.querySelector('.mcp-editor-remove')?.click();
                    await waitFor('.confirmation-dialog.danger');
                    return;
                  }
                  if (view === 'mcp-editor-remove' || view === 'mcp-editor-remove-error') {
                    await openSeededServerEditor();
                    installBusyTrace();
                    document.querySelector('.mcp-editor-remove')?.click();
                    await waitFor('.confirmation-dialog.danger');
                    document
                      .querySelector('.confirmation-actions .primary-button.danger')
                      ?.click();
                    if (view === 'mcp-editor-remove') {
                      await wait(1_500);
                      return;
                    }
                    await wait(1_000);
                    window.__mcpEditorProbe = {
                      injectedFailure: {
                        alertText:
                          document
                            .querySelector('.mcp-editor-action-error')
                            ?.textContent?.trim() ?? null,
                        retryDisabled:
                          document.querySelector(
                            '.mcp-editor-action-retry',
                          ) instanceof HTMLButtonElement
                            ? document.querySelector('.mcp-editor-action-retry').disabled
                            : null,
                        editorStillOpen:
                          document.querySelector('.mcp-editor') !== null,
                      },
                    };
                    document.querySelector('.mcp-editor-action-retry')?.click();
                    await wait(1_500);
                    return;
                  }
                  if (view === 'mcp-editor-credentials') {
                    await openSeededServerEditor();
                    window.__mcpEditorConsoleCapture = { entries: [] };
                    for (const method of ['log', 'info', 'warn', 'error', 'debug']) {
                      const original = console[method].bind(console);
                      console[method] = (...args) => {
                        const text = args
                          .map((argument) => String(argument))
                          .join(' ');
                        window.__mcpEditorConsoleCapture.entries.push({
                          method,
                          length: text.length,
                          mentionsCredential: text.includes('artemis-smoke-bearer'),
                        });
                        original(...args);
                      };
                    }
                    const bearer = 'artemis-smoke-bearer-SYNTHETIC-NEVER-LEAK';
                    const input = document.querySelector(
                      '.mcp-editor input[type="password"]',
                    );
                    if (!(input instanceof HTMLInputElement)) {
                      throw new Error('Bearer input did not render.');
                    }
                    setInputValue(input, bearer);
                    await wait(300);
                    const scanForBearer = () => {
                      let textHits = 0;
                      const walker = document.createTreeWalker(
                        document.body,
                        NodeFilter.SHOW_TEXT,
                      );
                      while (walker.nextNode()) {
                        if (walker.currentNode.textContent?.includes(bearer)) {
                          textHits += 1;
                        }
                      }
                      let attributeHits = 0;
                      const attributeHitDetails = [];
                      for (const element of document.querySelectorAll('*')) {
                        for (const attribute of element.attributes) {
                          if (attribute.value.includes(bearer)) {
                            attributeHits += 1;
                            attributeHitDetails.push({
                              tag: element.tagName,
                              attribute: attribute.name,
                              maskedCredentialInput: element === input,
                            });
                          }
                        }
                      }
                      // React reflects a controlled input's value into its
                      // own value attribute, so the masked credential input
                      // may legitimately carry the token; serialize a clone
                      // with every password input removed to prove no other
                      // markup node ever exposes it.
                      const sanitizedClone =
                        document.documentElement.cloneNode(true);
                      for (const masked of sanitizedClone.querySelectorAll(
                        'input[type="password"]',
                      )) {
                        masked.remove();
                      }
                      return {
                        textHits,
                        attributeHits,
                        attributeHitDetails,
                        markupHits: sanitizedClone.outerHTML.includes(bearer)
                          ? 1
                          : 0,
                      };
                    };
                    window.__mcpEditorProbe = {
                      beforeSave: {
                        masked: input.type === 'password',
                        ...scanForBearer(),
                      },
                    };
                    document.querySelector('.mcp-editor-save')?.click();
                    await wait(1_200);
                    window.__mcpEditorProbe.afterSave = scanForBearer();
                    window.__mcpEditorConsoleCapture.credentialEntries =
                      window.__mcpEditorConsoleCapture.entries.filter(
                        (entry) => entry.mentionsCredential,
                      ).length;
                    return;
                  }
                  return;
                }
                if (view.startsWith('turn-changes')) {
                  document.querySelector('.thread-select')?.click();
                  await wait(600);
                  if (view === 'turn-changes-form-controls') {
                    document
                      .querySelector('.turn-change-actions button:last-child')
                      ?.click();
                    const deadline = Date.now() + 8_000;
                    let trigger = null;
                    while (Date.now() < deadline && trigger === null) {
                      trigger = document.querySelector(
                        '.review-scope-select [data-artemis-component="select"] [data-part="trigger"]',
                      );
                      if (trigger === null) await wait(100);
                    }
                    const selectRoot = trigger?.closest(
                      '[data-artemis-component="select"]',
                    );
                    if (
                      !(trigger instanceof HTMLButtonElement) ||
                      !selectRoot
                    ) {
                      throw new Error('Public Review Select missing.');
                    }
                    return;
                  }
                  if (view === 'turn-changes-open') {
                    document.querySelector('.turn-execution-details > summary')?.click();
                    document.querySelector('.turn-change-more > summary')?.click();
                    await wait(400);
                  }
                  return;
                }
                if (view === 'message-actions-edit') {
                  document.querySelector('.thread-select')?.click();
                  await wait(600);
                  document
                    .querySelector('.user-message .message-action:nth-child(2)')
                    ?.click();
                  await wait(350);
                  return;
                }
                if (view.startsWith('environment')) {
                  document.querySelector('.thread-select')?.click();
                  await wait(600);
                  if (view === 'environment-open') {
                    const trigger = document.querySelector('.environment-trigger');
                    if (trigger?.getAttribute('aria-expanded') !== 'true') {
                      trigger?.click();
                      await wait(500);
                    }
                    return;
                  }
                  if (view === 'environment-branch-menu') {
                    document
                      .querySelector('.environment-branch-control > .environment-row')
                      ?.click();
                    await wait(500);
                    return;
                  }
                  if (view === 'environment-agents') {
                    const popover = document.querySelector('.environment-popover');
                    if (popover) popover.scrollTop = 220;
                    await wait(500);
                    return;
                  }
                  if (view.startsWith('environment-pr-checks')) {
                    const trigger = document.querySelector('.environment-trigger');
                    if (trigger?.getAttribute('aria-expanded') !== 'true') {
                      trigger?.click();
                      await wait(500);
                    }
                    const deadline = Date.now() + 8_000;
                    let summary = null;
                    while (Date.now() < deadline && summary === null) {
                      summary = document.querySelector(
                        '.environment-pr-check-summary',
                      );
                      if (summary === null) await wait(100);
                    }
                    if (!(summary instanceof HTMLButtonElement)) {
                      throw new Error('Environment PR checks summary missing.');
                    }
                    summary.click();
                    await wait(500);
                    if (
                      !document.querySelector(
                        '.environment-checks-popover[data-artemis-component="popover"]',
                      )
                    ) {
                      throw new Error('Public Environment checks Popover missing.');
                    }
                    return;
                  }
                  if (view.startsWith('environment-feedback-approval')) {
                    const trigger = document.querySelector('.environment-trigger');
                    if (trigger?.getAttribute('aria-expanded') === 'true') {
                      trigger.click();
                      await wait(300);
                    }
                    if (view !== 'environment-feedback-approval') {
                      const disclosure = document.querySelector(
                        '.approval-card[data-artemis-component="result-disclosure"]',
                      );
                      const disclosureButton = disclosure?.querySelector(
                        '[data-part="disclosure"]',
                      );
                      if (
                        !(disclosure instanceof HTMLElement) ||
                        !(disclosureButton instanceof HTMLButtonElement)
                      ) {
                        throw new Error(
                          'Public resolved approval ResultDisclosure missing.',
                        );
                      }
                      const completedTurnDetails = disclosure.closest(
                        'details.turn-execution-details',
                      );
                      if (
                        completedTurnDetails instanceof HTMLDetailsElement &&
                        !completedTurnDetails.open
                      ) {
                        const summary = completedTurnDetails.querySelector(
                          ':scope > summary',
                        );
                        if (!(summary instanceof HTMLElement)) {
                          throw new Error(
                            'Completed turn execution disclosure missing.',
                          );
                        }
                        summary.click();
                        await wait(350);
                      }
                      const timelineScroll = disclosure.closest('.timeline-scroll');
                      if (!(timelineScroll instanceof HTMLElement)) {
                        throw new Error(
                          'Resolved approval timeline scroll container missing.',
                        );
                      }
                      disclosure.scrollIntoView({
                        block: 'start',
                        inline: 'nearest',
                      });
                      await wait(350);
                      const collapsedBounds =
                        disclosureButton.getBoundingClientRect();
                      const collapsedScrollBounds =
                        timelineScroll.getBoundingClientRect();
                      const collapsedVisible =
                        collapsedBounds.top >= collapsedScrollBounds.top - 1 &&
                        collapsedBounds.bottom <=
                          collapsedScrollBounds.bottom + 1;
                      disclosureButton.click();
                      await wait(350);
                      const content = disclosure.querySelector(
                        '[data-part="content"]',
                      );
                      const expandedEndTarget =
                        disclosure.querySelector(
                          '.approval-group-list > li:last-child',
                        ) ?? content;
                      expandedEndTarget?.scrollIntoView({
                        block: 'end',
                        inline: 'nearest',
                      });
                      await wait(350);
                      const expandedScrollBounds =
                        timelineScroll.getBoundingClientRect();
                      const contentBounds =
                        expandedEndTarget?.getBoundingClientRect();
                      const groupItems = disclosure.querySelectorAll(
                        '.approval-group-list > li',
                      ).length;
                      window.__approvalDisclosureVerification = {
                        atScrollEnd:
                          Math.abs(
                            timelineScroll.scrollTop -
                              (timelineScroll.scrollHeight -
                                timelineScroll.clientHeight),
                          ) <= 1,
                        collapsedVisible,
                        collapsedGeometry: {
                          bottom: collapsedBounds.bottom,
                          top: collapsedBounds.top,
                        },
                        collapsedScrollGeometry: {
                          bottom: collapsedScrollBounds.bottom,
                          top: collapsedScrollBounds.top,
                        },
                        contentVisible:
                          content instanceof HTMLElement && !content.hidden,
                        expanded:
                          disclosure.getAttribute('data-expanded') === 'true',
                        expandedEndVisible:
                          contentBounds instanceof DOMRect &&
                          contentBounds.bottom <=
                            expandedScrollBounds.bottom + 1 &&
                          contentBounds.bottom >= expandedScrollBounds.top - 1,
                        expandedEndGeometry:
                          contentBounds instanceof DOMRect
                            ? {
                                bottom: contentBounds.bottom,
                                top: contentBounds.top,
                              }
                            : null,
                        expandedScrollGeometry: {
                          bottom: expandedScrollBounds.bottom,
                          top: expandedScrollBounds.top,
                        },
                        groupItems,
                        state: disclosure.getAttribute('data-state'),
                        timelineScrollable:
                          timelineScroll.scrollHeight >
                          timelineScroll.clientHeight,
                      };
                      return;
                    }
                    const approvalCard = document.querySelector(
                      '.approval-card[data-artemis-component="approval-card"]',
                    );
                    if (!approvalCard) {
                      throw new Error('Public pending ApprovalCard missing.');
                    }
                    const timelineScroll = approvalCard.closest('.timeline-scroll');
                    const actions = approvalCard.querySelector(
                      '[data-part="actions"]',
                    );
                    if (
                      !(timelineScroll instanceof HTMLElement) ||
                      !(actions instanceof HTMLElement)
                    ) {
                      throw new Error(
                        'Pending approval scroll contract is incomplete.',
                      );
                    }
                    const withinTimeline = (element) => {
                      const bounds = element.getBoundingClientRect();
                      const timelineBounds =
                        timelineScroll.getBoundingClientRect();
                      return (
                        bounds.left >= timelineBounds.left - 1 &&
                        bounds.right <= timelineBounds.right + 1 &&
                        bounds.top >= timelineBounds.top - 1 &&
                        bounds.bottom <= timelineBounds.bottom + 1
                      );
                    };
                    const securityParts = [
                      'title',
                      'description',
                      'status',
                      'reason',
                    ].map((part) =>
                      approvalCard.querySelector('[data-part="' + part + '"]'),
                    );
                    if (securityParts.some((part) => !(part instanceof HTMLElement))) {
                      throw new Error(
                        'Pending approval security content is incomplete.',
                      );
                    }
                    approvalCard.scrollIntoView({ block: 'start' });
                    await wait(350);
                    const securityVisibleAtStart = securityParts.every((part) =>
                      withinTimeline(part),
                    );
                    actions.scrollIntoView({ block: 'end' });
                    await wait(350);
                    const actionsVisibleAtEnd = withinTimeline(actions);
                    const securityBottom = Math.max(
                      ...securityParts.map(
                        (part) => part.getBoundingClientRect().bottom,
                      ),
                    );
                    const actionsTop = actions.getBoundingClientRect().top;
                    window.__approvalScrollVerification = {
                      actionsVisibleAtEnd,
                      dynamicCopyBidiIsolated: [
                        'title',
                        'description',
                        'reason',
                      ].every((part) =>
                        approvalCard
                          .querySelector('[data-part="' + part + '"]')
                          ?.querySelector('bdi'),
                      ),
                      securityAndActionsDoNotOverlap:
                        securityBottom <= actionsTop + 1,
                      securityVisibleAtStart,
                    };
                    approvalCard.scrollIntoView({ block: 'start' });
                    await wait(350);
                    return;
                  }
                  if (view === 'environment-sources' || view === 'environment-sources-image') {
                    const popover = document.querySelector('.environment-popover');
                    if (popover) popover.scrollTop = popover.scrollHeight;
                    await wait(350);
                    document
                      .querySelector('.sources-section .environment-view-all')
                      ?.click();
                    await wait(700);
                    if (view === 'environment-sources-image') {
                      document
                        .querySelector('button.sources-panel-entry.attachment')
                        ?.click();
                      await wait(500);
                    }
                    return;
                  }
                  if (
                    view === 'environment-commit-dialog' ||
                    view === 'environment-commit-branch-menu' ||
                    view === 'environment-commit-new-branch' ||
                    view === 'environment-commit-execute' ||
                    view === 'environment-commit-new-branch-execute' ||
                    view === 'environment-commit-and-push-execute' ||
                    view === 'environment-push-execute'
                  ) {
                    document.querySelector('.commit-push-row')?.click();
                    await wait(500);
                    if (
                      view === 'environment-commit-branch-menu' ||
                      view === 'environment-commit-new-branch' ||
                      view === 'environment-commit-new-branch-execute'
                    ) {
                      document
                        .querySelector('.environment-git-destination-trigger')
                        ?.click();
                      await wait(350);
                    }
                    if (
                      view === 'environment-commit-new-branch' ||
                      view === 'environment-commit-new-branch-execute'
                    ) {
                      document
                        .querySelector(
                          '.environment-git-destination-menu button:last-child',
                        )
                        ?.click();
                      await wait(350);
                    }
                    if (
                      view === 'environment-commit-execute' ||
                      view === 'environment-commit-new-branch-execute'
                    ) {
                      document
                        .querySelector('.environment-git-actions button.primary')
                        ?.click();
                      await wait(1_000);
                    }
                    if (view === 'environment-commit-and-push-execute') {
                      document
                        .querySelector(
                          '.environment-git-actions button:nth-child(2)',
                        )
                        ?.click();
                      await wait(350);
                      document
                        .querySelector('.confirmation-actions .primary-button')
                        ?.click();
                      await wait(1_200);
                    }
                    if (view === 'environment-push-execute') {
                      document
                        .querySelector(
                          '.environment-git-actions button:nth-child(3)',
                        )
                        ?.click();
                      await wait(350);
                      document
                        .querySelector('.confirmation-actions .primary-button')
                        ?.click();
                      await wait(1_200);
                    }
                    return;
                  }
                  if (view === 'environment-outside-click') {
                    document.querySelector('.timeline-scroll')?.dispatchEvent(
                      new PointerEvent('pointerdown', {
                        bubbles: true,
                        pointerId: 1,
                        pointerType: 'mouse',
                      }),
                    );
                    await wait(500);
                    return;
                  }
                  if (
                    view === 'environment-dock' ||
                    view === 'environment-dock-open' ||
                    view === 'environment-dock-workspace'
                  ) {
                    const bounds = (selector) => {
                      const rect = document
                        .querySelector(selector)
                        ?.getBoundingClientRect();
                      return rect
                        ? { left: rect.left, right: rect.right, width: rect.width }
                        : null;
                    };
                    const before = {
                      status: bounds('.status-pill'),
                      environment: bounds('.environment-trigger'),
                      dock: bounds(
                        '[data-artemis-component="workspace-dock"]',
                      ),
                    };
                    document.querySelector('.right-sidebar-toggle')?.click();
                    await wait(80);
                    const middle = {
                      status: bounds('.status-pill'),
                      environment: bounds('.environment-trigger'),
                      dock: bounds(
                        '[data-artemis-component="workspace-dock"]',
                      ),
                    };
                    await wait(520);
                    const after = {
                      status: bounds('.status-pill'),
                      environment: bounds('.environment-trigger'),
                      dock: bounds(
                        '[data-artemis-component="workspace-dock"]',
                      ),
                    };
                    window.__artemisSmokeDockTransition = {
                      before,
                      middle,
                      after,
                    };
                  }
                  if (view === 'environment-dock-open') {
                    document.querySelector('.environment-trigger')?.click();
                    await wait(500);
                  }
                  return;
                }
                if (view.startsWith('temporary')) {
                  if (view === 'temporary-double-toggle') {
                    const disclosure = document.querySelector(
                      '.temporary-conversations .project-group-select',
                    );
                    disclosure?.click();
                    disclosure?.click();
                    await wait(800);
                    return;
                  }
                  if (view === 'temporary-collapsed') {
                    document
                      .querySelector(
                        '.temporary-conversations .project-group-select',
                      )
                      ?.click();
                    await wait(600);
                    return;
                  }
                  document
                    .querySelector('.temporary-conversations .project-new-thread')
                    ?.click();
                  await wait(600);
                  if (view === 'temporary-dock') {
                    document.querySelector('.right-sidebar-toggle')?.click();
                    await wait(500);
                  }
                  return;
                }
                if (view.startsWith('workspace-tab-menu')) {
                  document.querySelector('.right-sidebar-toggle')?.click();
                  await wait(500);
                  const addButton = document.querySelector('.workspace-tab-add');
                  addButton?.click();
                  await wait(300);
                  if (
                    !addButton ||
                    addButton.getAttribute('aria-expanded') !== 'true' ||
                    !document.querySelector('.workspace-tab-menu')
                  ) {
                    throw new Error('Workspace tab menu did not open.');
                  }
                  if (view === 'workspace-tab-menu-outside-click') {
                    const outsideTarget = document.querySelector(
                      '.workspace-tab-content',
                    );
                    if (!outsideTarget) {
                      throw new Error('Workspace tab outside-click target missing.');
                    }
                    outsideTarget.dispatchEvent(
                      new PointerEvent('pointerdown', {
                        bubbles: true,
                        pointerId: 1,
                        pointerType: 'mouse',
                      }),
                    );
                  } else if (view === 'workspace-tab-menu-escape') {
                    window.dispatchEvent(new KeyboardEvent('keydown', {
                      key: 'Escape',
                    }));
                  }
                  await wait(500);
                  if (
                    document.querySelector('.workspace-tab-menu') ||
                    document
                      .querySelector('.workspace-tab-add')
                      ?.getAttribute('aria-expanded') !== 'false'
                  ) {
                    throw new Error(
                      'Workspace tab menu remained open after dismissal.',
                    );
                  }
                  return;
                }
                if (view === 'card-heatmap') {
                  const waitForSelector = async (selector) => {
                    const deadline = Date.now() + 5000;
                    while (Date.now() < deadline) {
                      const found = document.querySelector(selector);
                      if (found) return found;
                      await wait(100);
                    }
                    return null;
                  };
                  document.querySelectorAll('.activity-button')[2]?.click();
                  await waitForSelector('.token-usage-grid');
                  document
                    .querySelector('.token-usage-summary')
                    ?.scrollIntoView({ block: 'start' });
                  await wait(300);
                  // Focus today's cell (the last grid column) so the
                  // checklist §6 focus-tooltip evidence lands in both the
                  // screenshot and the audit: the tooltip DOM commits
                  // during this wait, before the capture chain runs.
                  const grid = document.querySelector('.token-usage-grid');
                  const lastCell = grid?.lastElementChild;
                  if (lastCell instanceof HTMLButtonElement) {
                    lastCell.focus();
                  }
                  await wait(400);
                  return;
                }
                if (view === 'token-usage' || view === 'navigation-token-usage') {
                  document.querySelectorAll('.activity-button')[2]?.click();
                  await wait(1_000);
                  const page = document.querySelector('.token-usage-page');
                  if (page) page.scrollTop = page.scrollHeight;
                  await wait(300);
                  return;
                }
                document.querySelectorAll('.activity-button')[1]?.click();
                await wait(1_000);
                if (view === 'add-plugin') {
                  document.querySelector('.resource-add-button')?.click();
                  await wait(500);
                } else if (view === 'google-account') {
                  document
                    .querySelector('.resource-marketplace-account-banner button')
                    ?.click();
                  await wait(500);
                } else if (view === 'add-mcp') {
                  document
                    .querySelector('.resource-installed-overview .resource-icon-button')
                    ?.click();
                  await wait(500);
                  clickByText('.resource-management-tabs button', 'MCP');
                  await wait(300);
                  clickByText('.resource-add-button', 'Add server');
                  await wait(500);
                } else if (view === 'mcp-context7-install') {
                  document
                    .querySelector('.resource-installed-overview .resource-icon-button')
                    ?.click();
                  await wait(500);
                  clickByText('.resource-management-tabs button', 'MCP');
                  await wait(300);
                  document
                    .querySelector('.resource-list-heading-actions .resource-add-button')
                    ?.click();
                  await wait(300);
                  const input = document.querySelector(
                    '.resource-discovery-panel input',
                  );
                  if (input instanceof HTMLInputElement) {
                    const setter = Object.getOwnPropertyDescriptor(
                      HTMLInputElement.prototype,
                      'value',
                    )?.set;
                    setter?.call(input, 'context7');
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.form?.requestSubmit();
                    await wait(2_500);
                    const row = [...document.querySelectorAll(
                      '.resource-discovery-row',
                    )].find(
                      (candidate) =>
                        candidate.querySelector('strong')?.textContent?.trim() ===
                        'Context7',
                    );
                    row?.querySelector('button')?.click();
                    await wait(500);
                  }
                } else if (
                  view.startsWith('mcp-search-') ||
                  view.startsWith('skill-search-')
                ) {
                  document
                    .querySelector('.resource-installed-overview .resource-icon-button')
                    ?.click();
                  await wait(500);
                  const tabIndex = view.startsWith('mcp-search-') ? 2 : 3;
                  document
                    .querySelectorAll('.resource-management-tabs button')
                    [tabIndex]?.click();
                  await wait(300);
                  document
                    .querySelector('.resource-list-heading-actions .resource-add-button')
                    ?.click();
                  await wait(300);
                  const input = document.querySelector(
                    '.resource-discovery-panel input',
                  );
                  if (input instanceof HTMLInputElement) {
                    const setter = Object.getOwnPropertyDescriptor(
                      HTMLInputElement.prototype,
                      'value',
                    )?.set;
                    setter?.call(input, 'artemis-no-results-smoke');
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.form?.requestSubmit();
                    await wait(500);
                    const status = document.querySelector(
                      '[data-artemis-component="loading-state"], [data-artemis-component="empty-state"]',
                    );
                    status?.scrollIntoView({ block: 'center' });
                    await wait(300);
                  }
                }
              })()
            `)
          : Promise.resolve();
      const requestedSettleDelay = Number(
        process.env.ARTEMIS_SMOKE_SETTLE_DELAY,
      );
      const settleDelay = Number.isFinite(requestedSettleDelay)
        ? Math.max(0, Math.min(5_000, requestedSettleDelay))
        : process.env.ARTEMIS_SMOKE_USER_INPUT || requestedSmokeView
          ? 1_500
          : 500;
      void prepareSmokeView
        .then(() => new Promise((resolve) => setTimeout(resolve, settleDelay)))
        .then(async () => {
          // PR9B card-heatmap smoke: view routing has settled, so the Token
          // Usage page is mounted with its live subscription active and the
          // synthetic usage sequence can ride the real agent-event channel.
          emitSmokeCardHeatmapUsageEvents(window);
          if (smokeMode && process.env.ARTEMIS_SMOKE_VIEW === "card-heatmap") {
            await new Promise((resolve) => setTimeout(resolve, 1_000));
          }
          if (smokeMode) {
            await driveSmokeFormControlsEvidence(window, requestedSmokeView);
            await driveSmokeNavigationControlsEvidence(
              window,
              requestedSmokeView,
            );
            await driveSmokeWorkspaceDockEvidence(window, requestedSmokeView);
          }
          // PR10B review round 3 (nit 6): the user-input-transport PNG is
          // captured inside its evidence driver after the broker
          // injections, so the screenshot shows the rendered input cards
          // instead of an empty thread.
          if (
            smokeScreenshot &&
            requestedSmokeView !== "user-input-transport"
          ) {
            const image = await window.webContents.capturePage();
            await writeFile(smokeScreenshot, image.toPNG());
          }
          // PR9C input-fields smoke: after the default-state screenshot the
          // keyboard-evidence driver runs (real Tab traversal, focus probes,
          // busy-driven disable, Enter -> intercepted file chooser) before
          // the accessibility audit snapshot reads window.__inputFieldsProbe.
          if (smokeMode && requestedSmokeView?.startsWith("input-fields-")) {
            await driveSmokeInputFieldsEvidence(window, {
              defaultScreenshot: smokeScreenshot,
              focusedScreenshot: smokeFocusedScreenshot,
              pickedScreenshot: smokePickedScreenshot,
            });
          }
          // PR10B user-input-transport smoke: with the producer dormant the
          // only legal driver is the direct broker-request path, so the
          // evidence driver injects synthetic legacy and multi-question
          // requests through the real main-process handlers and asserts the
          // transport contract end to end before the audit snapshot.
          if (smokeMode && requestedSmokeView === "user-input-transport") {
            await driveSmokeUserInputTransportEvidence(window, {
              screenshot: smokeScreenshot,
            });
          }
          let goalReducedMotionActiveTransform: string | null = null;
          if (
            smokeMode &&
            process.env.ARTEMIS_SMOKE_GOAL_REDUCED_MOTION === "1"
          ) {
            window.webContents.focus();
            const actionPoint = (await window.webContents.executeJavaScript(`
              (() => {
                const action = document.querySelector(
                  '.goal-bar-actions [data-artemis-component="icon-button"]',
                );
                const bounds = action?.getBoundingClientRect();
                return bounds
                  ? {
                      x: Math.round(bounds.left + bounds.width / 2),
                      y: Math.round(bounds.top + bounds.height / 2),
                    }
                  : null;
              })()
            `)) as { x: number; y: number } | null;
            if (!actionPoint) {
              throw new Error("Reduced-motion Goal action probe is missing.");
            }
            window.webContents.sendInputEvent({
              type: "mouseMove",
              ...actionPoint,
            });
            window.webContents.sendInputEvent({
              type: "mouseDown",
              button: "left",
              clickCount: 1,
              ...actionPoint,
            });
            await new Promise((resolve) => setTimeout(resolve, 50));
            goalReducedMotionActiveTransform = (await window.webContents
              .executeJavaScript(`
              getComputedStyle(document.querySelector(
                '.goal-bar-actions [data-artemis-component="icon-button"]',
              )).transform
            `)) as string;
            window.webContents.sendInputEvent({
              type: "mouseMove",
              x: 0,
              y: 0,
            });
            window.webContents.sendInputEvent({
              type: "mouseUp",
              button: "left",
              clickCount: 1,
              x: 0,
              y: 0,
            });
          }
          if (smokeMode && requestedSmokeView?.startsWith("goal-")) {
            window.webContents.focus();
            window.webContents.sendInputEvent({
              type: "keyDown",
              keyCode: "Tab",
            });
            window.webContents.sendInputEvent({
              type: "keyUp",
              keyCode: "Tab",
            });
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
          if (smokeAccessibility) {
            const result = (await window.webContents.executeJavaScript(`
              (() => {
                const issues = [];
                const iconSizingView = ${JSON.stringify(
                  requestedSmokeView ?? "",
                )};
                const cardHeatmapView = ${JSON.stringify(
                  requestedSmokeView ?? "",
                )};
                const inputFieldsView = ${JSON.stringify(
                  requestedSmokeView ?? "",
                )};
                const conversationTimelineView = ${JSON.stringify(
                  requestedSmokeView ?? "",
                )};
                const visible = (element) => {
                  const style = getComputedStyle(element);
                  return style.display !== "none" &&
                    style.visibility !== "hidden" &&
                    element.getClientRects().length > 0;
                };
                const name = (element) => {
                  const labelledBy = element.getAttribute("aria-labelledby");
                  const labelled = labelledBy
                    ? labelledBy
                        .split(/\\s+/u)
                        .map((id) => document.getElementById(id)?.textContent ?? "")
                        .join(" ")
                    : "";
                  return (
                    element.getAttribute("aria-label") ||
                    labelled ||
                    element.textContent ||
                    element.getAttribute("title") ||
                    ""
                  ).trim();
                };
                for (const element of document.querySelectorAll(
                  "button, a[href], summary, [role='button'], [role='tab']",
                )) {
                  const role = element.getAttribute("role");
                  const rovingRoot =
                    role === "option"
                      ? element.closest("[role='listbox']")
                      : role === "tab"
                        ? element.closest("[role='tablist']")
                        : null;
                  const usesRovingTabIndex = rovingRoot?.querySelector(
                    role === "option"
                      ? "[role='option'][tabindex='0']"
                      : "[role='tab'][tabindex='0']",
                  );
                  if (visible(element) && !name(element)) {
                    issues.push({
                      rule: "interactive-name",
                      element: element.outerHTML.slice(0, 240),
                    });
                  }
                  if (
                    visible(element) &&
                    !(element instanceof HTMLButtonElement && element.disabled) &&
                    element.tabIndex < 0 &&
                    !usesRovingTabIndex
                  ) {
                    issues.push({
                      rule: "keyboard-focus",
                      element: element.outerHTML.slice(0, 240),
                    });
                  }
                }
                for (const element of document.querySelectorAll(
                  "input:not([type='hidden']), select, textarea",
                )) {
                  const labelled =
                    element.getAttribute("aria-label") ||
                    element.getAttribute("aria-labelledby") ||
                    element.labels?.length;
                  if (visible(element) && !labelled) {
                    issues.push({
                      rule: "form-label",
                      element: element.outerHTML.slice(0, 240),
                    });
                  }
                }
                for (const image of document.querySelectorAll("img")) {
                  if (!image.hasAttribute("alt")) {
                    issues.push({
                      rule: "image-alt",
                      element: image.outerHTML.slice(0, 240),
                    });
                  }
                }
                const ids = new Set();
                for (const element of document.querySelectorAll("[id]")) {
                  if (ids.has(element.id)) {
                    issues.push({ rule: "duplicate-id", element: element.id });
                  }
                  ids.add(element.id);
                }
                if (!document.documentElement.lang) {
                  issues.push({ rule: "document-language", element: "html" });
                }
                const environmentPanel = document.querySelector(
                  '[data-artemis-component="environment-panel"][data-part="root"]',
                );
                const environmentBounds = environmentPanel
                  ?.getBoundingClientRect();
                const conversation = document.querySelector(".conversation");
                const conversationBounds = conversation
                  ?.getBoundingClientRect();
                const workspace = document.querySelector(".workspace");
                const workspaceBounds = workspace?.getBoundingClientRect();
                const workspaceContent = document.querySelector(
                  ".workspace-content",
                );
                const workspaceContentBounds = workspaceContent
                  ?.getBoundingClientRect();
                const timelineScroll = document.querySelector(
                  ".timeline-scroll",
                );
                const timelineScrollBounds = timelineScroll
                  ?.getBoundingClientRect();
                const timelineContent = document.querySelector(".timeline");
                const timelineContentBounds = timelineContent
                  ?.getBoundingClientRect();
                const turnStatus = document.querySelector(".turn-status");
                const turnStatusBounds = turnStatus?.getBoundingClientRect();
                const environmentTrigger = document.querySelector(
                  '[data-artemis-component="environment-control"][data-part="trigger"]',
                );
                const environmentControls =
                  environmentTrigger?.getAttribute("aria-controls") ?? null;
                if (
                  environmentTrigger?.getAttribute("aria-expanded") === "true"
                ) {
                  const controlledEnvironmentPanel = environmentControls
                    ? document.getElementById(environmentControls)
                    : null;
                  if (
                    !environmentControls ||
                    controlledEnvironmentPanel !== environmentPanel ||
                    controlledEnvironmentPanel?.getAttribute("role") !== "dialog" ||
                    !name(controlledEnvironmentPanel)
                  ) {
                    issues.push({
                      rule: "environment-trigger-dialog-relationship",
                      element: environmentTrigger.outerHTML.slice(0, 240),
                    });
                  }
                }
                const workspaceDockResizer = document.querySelector(
                  '[data-artemis-component="workspace-dock-resizer"]',
                );
                const workspaceDockResizerBounds = workspaceDockResizer
                  ?.getBoundingClientRect();
                const workspaceDock = document.querySelector(
                  '[data-artemis-component="workspace-dock"]',
                );
                const workspaceDockBounds = workspaceDock
                  ?.getBoundingClientRect();
                const sidebarHeader = document.querySelector(".sidebar-header");
                const sidebarHeaderBounds = sidebarHeader?.getBoundingClientRect();
                const projectTree = document.querySelector(".project-tree");
                const projectTreeBounds = projectTree?.getBoundingClientRect();
                const temporaryDisclosure = document.querySelector(
                  ".temporary-conversations .project-group-select",
                );
                const temporaryList = document.querySelector(
                  "#temporary-conversation-list",
                );
                const goalBar = document.querySelector(".goal-bar");
                const goalBarBounds = goalBar?.getBoundingClientRect();
                const composer = document.querySelector(".composer");
                const composerBounds = composer?.getBoundingClientRect();
                const goalEditor = document.querySelector(
                  '[data-artemis-component="goal-editor"][data-part="root"]',
                );
                const reviewSurface = document.querySelector(
                  '[data-artemis-component="review-surface"][data-part="root"]',
                );
                const reviewToolbar = reviewSurface?.querySelector(
                  '[data-part="toolbar"]',
                );
                const reviewReader = reviewSurface?.querySelector(
                  '[data-part="reader"]',
                );
                const reviewFiles = reviewSurface?.querySelector(
                  '[data-part="files"]',
                );
                const reviewDiff = reviewSurface?.querySelector(
                  '[data-artemis-component="review-diff"][data-part="root"]',
                );
                const sourcesSurface = document.querySelector(
                  '[data-artemis-component="sources-surface"][data-part="root"]',
                );
                const environmentChecks = document.querySelector(
                  '.environment-checks-popover[data-artemis-component="popover"]',
                );
                const queuedSteerBar = document.querySelector(
                  ".queued-message-bar",
                );
                const queuedSteerEditor = document.querySelector(
                  ".queued-message-editor textarea",
                );
                const queuedSteerError = document.querySelector(
                  ".queued-message-editor-error[role='alert']",
                );
                const queuedSteerFocus = document.activeElement;
                const composerInput = document.querySelector(".composer textarea");
                const sourceImageEntry = document.querySelector(
                  "button.sources-panel-entry.attachment",
                );
                const sourceImageEntryBounds = sourceImageEntry
                  ?.getBoundingClientRect();
                const sourceImageThumbnailBounds = sourceImageEntry
                  ?.querySelector("img")
                  ?.getBoundingClientRect();
                const sourceImageTitleBounds = sourceImageEntry
                  ?.querySelector("h2")
                  ?.getBoundingClientRect();
                const sourceImagePreview = document.querySelector(
                  ".source-image-preview",
                );
                return {
                  documentLanguage: document.documentElement.lang,
                  documentDirection: document.documentElement.dir,
                  title: document.title,
                  windowInnerWidth: window.innerWidth,
                  workspaceWidth: workspaceBounds?.width ?? null,
                  environmentPanelOpen:
                    environmentTrigger?.getAttribute("aria-expanded") === "true",
                  environmentControl: environmentTrigger
                    ? {
                        controls: environmentControls,
                        panelId: environmentPanel?.id ?? null,
                        panelRole: environmentPanel?.getAttribute("role") ?? null,
                        panelName: environmentPanel ? name(environmentPanel) : null,
                      }
                    : null,
                  workflowComponents: [
                    ...new Set(
                      [...document.querySelectorAll(
                        '[data-artemis-component="review-surface"], ' +
                          '[data-artemis-component="review-diff"], ' +
                          '[data-artemis-component="environment-control"], ' +
                          '[data-artemis-component="environment-panel"], ' +
                          '[data-artemis-component="goal-editor"], ' +
                          '[data-artemis-component="sources-surface"]',
                      )].map((element) =>
                        element.getAttribute("data-artemis-component"),
                      ),
                    ),
                  ],
                  reviewGeometry: reviewSurface
                    ? {
                        state: reviewSurface.getAttribute("data-state"),
                        root: reviewSurface.getBoundingClientRect().toJSON(),
                        toolbar: reviewToolbar?.getBoundingClientRect().toJSON() ?? null,
                        reader: reviewReader?.getBoundingClientRect().toJSON() ?? null,
                        files: reviewFiles?.getBoundingClientRect().toJSON() ?? null,
                        diffState: reviewDiff?.getAttribute("data-state") ?? null,
                        lineCount:
                          reviewDiff?.querySelectorAll('[data-part="line"]')
                            .length ?? 0,
                        lineMarkers: [
                          ...(reviewDiff?.querySelectorAll('[data-part="marker"]') ?? []),
                        ].map((marker) => marker.textContent ?? ""),
                      }
                    : null,
                  goalEditorGeometry: goalEditor
                    ? {
                        ...goalEditor.getBoundingClientRect().toJSON(),
                        state: goalEditor.getAttribute("data-state"),
                      }
                    : null,
                  sourcesGeometry: sourcesSurface
                    ? {
                        ...sourcesSurface.getBoundingClientRect().toJSON(),
                        state: sourcesSurface.getAttribute("data-state"),
                      }
                    : null,
                  environmentChecksGeometry: environmentChecks
                    ? environmentChecks.getBoundingClientRect().toJSON()
                    : null,
                  environmentCheckStatuses: [
                    ...document.querySelectorAll(
                      ".environment-check-indicator[data-status]",
                    ),
                  ].map((indicator) => indicator.getAttribute("data-status")),
                  environmentPanel: environmentBounds
                    ? {
                        visible: visible(environmentPanel),
                        top: environmentBounds.top,
                        right: environmentBounds.right,
                        bottom: environmentBounds.bottom,
                        left: environmentBounds.left,
                        width: environmentBounds.width,
                        height: environmentBounds.height,
                      }
                    : null,
                  environmentSectionHeadings: environmentPanel
                    ? [...environmentPanel.querySelectorAll(
                        ":scope > .environment-section > header > h2",
                      )]
                        .map((heading) => heading.textContent?.trim() ?? "")
                    : [],
                  environmentAgentStatuses: environmentPanel
                    ? [...environmentPanel.querySelectorAll(
                        ".environment-activity-row small",
                      )]
                        .map((status) => status.textContent?.trim() ?? "")
                    : [],
                  conversation: conversationBounds
                    ? {
                        left: conversationBounds.left,
                        right: conversationBounds.right,
                        width: conversationBounds.width,
                      }
                    : null,
                  workspaceContent: workspaceContentBounds
                    ? {
                        left: workspaceContentBounds.left,
                        right: workspaceContentBounds.right,
                        width: workspaceContentBounds.width,
                      }
                    : null,
                  timelineScroll: timelineScrollBounds
                    ? {
                        left: timelineScrollBounds.left,
                        right: timelineScrollBounds.right,
                        width: timelineScrollBounds.width,
                      }
                    : null,
                  timelineContent: timelineContentBounds
                    ? {
                        left: timelineContentBounds.left,
                        right: timelineContentBounds.right,
                        width: timelineContentBounds.width,
                      }
                    : null,
                  turnStatus: turnStatusBounds
                    ? {
                        left: turnStatusBounds.left,
                        right: turnStatusBounds.right,
                        width: turnStatusBounds.width,
                      }
                    : null,
                  dockTransition:
                    window.__artemisSmokeDockTransition ?? null,
                  workspaceDockInteraction:
                    window.__workspaceDockInteraction ?? null,
                  workspaceDockResizer: workspaceDockResizerBounds
                    ? {
                        left: workspaceDockResizerBounds.left,
                        right: workspaceDockResizerBounds.right,
                        width: workspaceDockResizerBounds.width,
                      }
                    : null,
                  workspaceDockVisible: workspaceDock
                    ? visible(workspaceDock)
                    : false,
                  workspaceDock: workspaceDockBounds
                    ? {
                        left: workspaceDockBounds.left,
                        right: workspaceDockBounds.right,
                        width: workspaceDockBounds.width,
                      }
                    : null,
                  sidebarHeaderBottom: sidebarHeaderBounds?.bottom ?? null,
                  projectTreeTop: projectTreeBounds?.top ?? null,
                  sidebarHeaderButtonCount:
                    sidebarHeader?.querySelectorAll("button").length ?? 0,
                  projectCreateButtonCount: document.querySelectorAll(
                    ".project-collection > .project-row > .project-new-thread",
                  ).length,
                  temporaryCreateButtonCount: document.querySelectorAll(
                    ".temporary-conversations > .project-row > .project-new-thread",
                  ).length,
                  temporaryConversationsOpen:
                    temporaryDisclosure?.getAttribute("aria-expanded") === "true",
                  temporaryConversationListVisible: temporaryList
                    ? visible(temporaryList)
                    : false,
                  goalBar: goalBarBounds
                    ? {
                        visible: visible(goalBar),
                        top: goalBarBounds.top,
                        right: goalBarBounds.right,
                        bottom: goalBarBounds.bottom,
                        left: goalBarBounds.left,
                        width: goalBarBounds.width,
                        height: goalBarBounds.height,
                      }
                    : null,
                  goalComposer: composerBounds
                    ? {
                        top: composerBounds.top,
                        right: composerBounds.right,
                        left: composerBounds.left,
                        width: composerBounds.width,
                      }
                    : null,
                  goalActionLabels: goalBar
                    ? [...goalBar.querySelectorAll(".goal-bar-actions button")]
                        .map((button) => button.getAttribute("aria-label"))
                    : [],
                  goalSharedComponents: goalBar
                    ? (() => {
                        const main = goalBar.querySelector(".goal-bar-main");
                        const badge = goalBar.querySelector(
                          '.goal-bar-status[data-artemis-component="badge"]',
                        );
                        const status = goalBar.querySelector(
                          '.goal-bar-progress[data-artemis-component="status"]',
                        );
                        const describe = (element) => {
                          if (!(element instanceof HTMLElement)) return null;
                          const style = getComputedStyle(element);
                          return {
                            component: element.getAttribute(
                              "data-artemis-component",
                            ),
                            state: element.getAttribute("data-state"),
                            size: element.getAttribute("data-size"),
                            tone: element.getAttribute("data-tone"),
                            variant: element.getAttribute("data-variant"),
                            display: style.display,
                            backgroundColor: style.backgroundColor,
                            borderColor: style.borderColor,
                            borderStyle: style.borderStyle,
                            borderWidth: style.borderWidth,
                            color: style.color,
                            fontFamily: style.fontFamily,
                            minBlockSize: style.minBlockSize,
                            inlineSize: style.inlineSize,
                            justifyContent: style.justifyContent,
                          };
                        };
                        const resolveVariant = (
                          backgroundToken,
                          colorToken,
                          borderToken,
                        ) => {
                          const probe = document.createElement("button");
                          probe.style.cssText = [
                            "position:fixed",
                            "visibility:hidden",
                            "background:var(" + backgroundToken + ")",
                            "border:var(--artemis-border-width-default) solid var(" +
                              borderToken +
                              ")",
                            "color:var(" + colorToken + ")",
                            "font-family:var(--artemis-typography-body-family)",
                            "outline:2px solid Highlight",
                          ].join(";");
                          document.body.append(probe);
                          const style = getComputedStyle(probe);
                          const resolved = {
                            backgroundColor: style.backgroundColor,
                            borderColor: style.borderColor,
                            borderStyle: style.borderStyle,
                            borderWidth: style.borderWidth,
                            color: style.color,
                            fontFamily: style.fontFamily,
                            focusOutlineColor: style.outlineColor,
                            focusOutlineStyle: style.outlineStyle,
                            focusOutlineWidth: style.outlineWidth,
                          };
                          probe.remove();
                          return resolved;
                        };
                        const contractStyles = {
                          secondary: resolveVariant(
                            "--artemis-color-surface-base",
                            "--artemis-color-text-primary",
                            "--artemis-color-border-default",
                          ),
                          quiet: resolveVariant(
                            "--artemis-color-surface-sunken",
                            "--artemis-color-text-secondary",
                            "--artemis-color-border-default",
                          ),
                          danger: resolveVariant(
                            "--artemis-color-status-danger",
                            "--artemis-color-status-on-danger",
                            "--artemis-color-status-danger",
                          ),
                          selectedBackground: resolveVariant(
                            "--artemis-color-interaction-selected",
                            "--artemis-color-text-primary",
                            "--artemis-color-border-default",
                          ).backgroundColor,
                        };
                        const actionElements = [
                          ...goalBar.querySelectorAll(
                            ".goal-bar-actions button",
                          ),
                        ];
                        const focusTarget = actionElements[0];
                        focusTarget?.focus({
                          preventScroll: true,
                          focusVisible: true,
                        });
                        const focusStyle = focusTarget
                          ? getComputedStyle(focusTarget)
                          : null;
                        const focus = focusStyle
                          ? {
                              active:
                                document.activeElement === focusTarget,
                              outlineColor: focusStyle.outlineColor,
                              outlineStyle: focusStyle.outlineStyle,
                              outlineWidth: focusStyle.outlineWidth,
                            }
                          : null;
                        const stateProbes = (() => {
                          const source = actionElements[0];
                          if (!(source instanceof HTMLButtonElement)) return [];
                          const host = document.createElement("div");
                          host.style.cssText = [
                            "position:fixed",
                            "inset-block-start:0",
                            "inset-inline-start:0",
                            "display:flex",
                            "visibility:hidden",
                          ].join(";");
                          document.body.append(host);
                          const probes = [];
                          const indicatorText = {
                            ready: "",
                            selected: "✓",
                            error: "!",
                            loading: "…",
                            disabled: "",
                          };
                          for (const size of ["compact", "comfortable"]) {
                            for (const variant of [
                              "secondary",
                              "quiet",
                              "danger",
                            ]) {
                              for (const state of [
                                "ready",
                                "selected",
                                "error",
                                "loading",
                                "disabled",
                              ]) {
                                const clone = source.cloneNode(true);
                                clone.dataset.size = size;
                                clone.dataset.variant = variant;
                                clone.dataset.state = state;
                                clone.disabled =
                                  state === "loading" || state === "disabled";
                                const indicator = clone.querySelector(
                                  '[data-part="state-indicator"]',
                                );
                                if (indicator) {
                                  indicator.textContent = indicatorText[state];
                                }
                                host.append(clone);
                                const bounds = clone.getBoundingClientRect();
                                const iconBounds = clone
                                  .querySelector(
                                    '[data-artemis-component="icon"]',
                                  )
                                  ?.getBoundingClientRect();
                                const indicatorBounds =
                                  indicator?.getBoundingClientRect();
                                const indicatorStyle = indicator
                                  ? getComputedStyle(indicator)
                                  : null;
                                const style = getComputedStyle(clone);
                                const indicatorVisible =
                                  indicatorStyle?.display !== "none";
                                probes.push({
                                  size,
                                  variant,
                                  state,
                                  width: bounds.width,
                                  height: bounds.height,
                                  iconCenterDelta: iconBounds
                                    ? iconBounds.left + iconBounds.width / 2 -
                                      (bounds.left + bounds.width / 2)
                                    : null,
                                  indicatorVisible,
                                  indicatorOverflow:
                                    indicatorVisible && indicatorBounds
                                      ? indicatorBounds.left < bounds.left ||
                                        indicatorBounds.right > bounds.right ||
                                        indicatorBounds.top < bounds.top ||
                                        indicatorBounds.bottom > bounds.bottom
                                      : false,
                                  scrollOverflow:
                                    clone.scrollWidth > clone.clientWidth ||
                                    clone.scrollHeight > clone.clientHeight,
                                  backgroundColor: style.backgroundColor,
                                  borderColor: style.borderColor,
                                  borderStyle: style.borderStyle,
                                  borderWidth: style.borderWidth,
                                  color: style.color,
                                  fontFamily: style.fontFamily,
                                });
                                clone.remove();
                              }
                            }
                          }
                          host.remove();
                          return probes;
                        })();
                        return {
                          main: describe(main),
                          badge: describe(badge),
                          status: describe(status),
                          actions: actionElements.map(describe),
                          contractStyles,
                          focus,
                          stateProbes,
                        };
                      })()
                    : null,
                  goalReducedMotion: {
                    matches: window.matchMedia(
                      "(prefers-reduced-motion: reduce)",
                    ).matches,
                    activeTransform: ${JSON.stringify(
                      goalReducedMotionActiveTransform,
                    )},
                  },
                  goalEditorVisible: goalEditor ? visible(goalEditor) : false,
                  goalEditorValue:
                    document.querySelector(".goal-editor-input")?.value ?? null,
                  goalEditorSaveDisabled:
                    document.querySelector(
                      ".goal-editor-footer .primary-button",
                    )?.disabled ?? null,
                  goalEditorRevertDisabled:
                    document.querySelector(".goal-editor-revert")?.disabled ??
                    null,
                  goalEditorBusy:
                    goalEditor?.getAttribute("aria-busy") === "true",
                  goalEditorAlert:
                    document.querySelector(".transient-notice[role='alert']")
                      ?.textContent?.trim() ?? null,
                  queuedSteer: {
                    barVisible: queuedSteerBar ? visible(queuedSteerBar) : false,
                    itemCount: document.querySelectorAll(
                      ".queued-message-item",
                    ).length,
                    editorVisible:
                      queuedSteerEditor instanceof HTMLTextAreaElement
                        ? visible(queuedSteerEditor)
                        : false,
                    editorValue:
                      queuedSteerEditor instanceof HTMLTextAreaElement
                        ? queuedSteerEditor.value
                        : null,
                    firstItemText:
                      document
                        .querySelector(
                          '[data-queued-index="0"] .queued-message-content',
                        )
                        ?.textContent?.trim() ?? null,
                    errorVisible: queuedSteerError
                      ? visible(queuedSteerError)
                      : false,
                    errorText: queuedSteerError?.textContent?.trim() ?? null,
                    retryDisabled: queuedSteerError?.querySelector("button")
                      ?.disabled ?? null,
                    focusTag: queuedSteerFocus?.tagName ?? null,
                    focusQueuedIndex:
                      queuedSteerFocus?.closest?.("[data-queued-index]")
                        ?.getAttribute("data-queued-index") ?? null,
                    focusOnFirstSteer:
                      queuedSteerFocus instanceof HTMLElement
                        ? queuedSteerFocus.matches(
                            '[data-queued-index="0"] .queued-message-steer',
                          )
                        : false,
                    genericNoticeVisible: [...document.querySelectorAll(
                      ".transient-notice",
                    )].some((notice) => visible(notice)),
                    genericNoticeCount: document.querySelectorAll(
                      ".transient-notice",
                    ).length,
                    genericNoticeText:
                      document
                        .querySelector(".transient-notice")
                        ?.textContent?.trim() ?? null,
                    actions: (() => {
                      const container = document.querySelector(
                        ".queued-message-editor-actions",
                      );
                      if (!container) {
                        return null;
                      }
                      const buttons = Array.from(
                        container.querySelectorAll("button"),
                      );
                      const style = getComputedStyle(container);
                      const bounds = container.getBoundingClientRect();
                      return {
                        present: true,
                        directChildOfEditorRoot:
                          container.parentElement ===
                          container.closest(".queued-message-editor"),
                        display: style.display,
                        flexDirection: style.flexDirection,
                        justifyContent: style.justifyContent,
                        gap: style.gap,
                        buttonCount: buttons.length,
                        buttonLabels: buttons.map((button) =>
                          (button.textContent ?? "").trim(),
                        ),
                        containerWidth: bounds.width,
                        buttonWidths: buttons.map(
                          (button) => button.getBoundingClientRect().width,
                        ),
                        buttonTops: buttons.map(
                          (button) => button.getBoundingClientRect().top,
                        ),
                      };
                    })(),
                    editTimeActions: window.__queuedSteerActions ?? null,
                    probe: window.__queuedSteerProbe ?? null,
                  },
                  markdownEditor: (() => {
                    const panel = document.querySelector(
                      '[data-artemis-component="workspace-file-layout"]',
                    );
                    const editor = panel?.querySelector(
                      '[data-artemis-component="workspace-editor-toolbar"]',
                    );
                    const toolbar = editor;
                    const status = editor?.querySelector(
                      '[data-part="status"]',
                    );
                    const save = editor?.querySelector('[data-part="save"]');
                    const alert = editor?.querySelector(
                      ':scope > [data-part="error"][role="alert"]',
                    );
                    const textarea = editor?.querySelector(
                      '[data-artemis-component="workspace-source-editor"] [data-part="source"]',
                    );
                    const sourceEditor = textarea?.closest(
                      '[data-artemis-component="workspace-source-editor"]',
                    );
                    const preview = editor?.querySelector(
                      '[data-artemis-component="workspace-preview"]',
                    );
                    const modeToggle = editor?.querySelector(
                      '[data-part="mode"] [data-artemis-component="segmented-control"]',
                    );
                    const toggleButtons = [
                      ...(modeToggle?.querySelectorAll('button') ?? []),
                    ];
                    const placeholders = [
                      ...(editor?.querySelectorAll(
                        '[data-workspace-image-failed]',
                      ) ?? []),
                    ];
                    const binaryEmpty = panel?.querySelector(
                      '[data-artemis-component="workspace-content-state"]',
                    );
                    return {
                      panelOpen: panel ? visible(panel) : false,
                      editorVisible: editor ? visible(editor) : false,
                      toolbarVisible: toolbar ? visible(toolbar) : false,
                      path:
                        panel
                          ?.querySelector(
                            '[data-artemis-component="workspace-editor-toolbar"] > [data-part="path"] > span[title], [data-artemis-component="workspace-file-header"] [data-part="path"][title]',
                          )
                          ?.getAttribute('title') ?? null,
                      statusRole: status?.getAttribute('role') ?? null,
                      statusLive: status?.getAttribute('aria-live') ?? null,
                      statusText: status?.textContent?.trim() ?? null,
                      statusDirty:
                        editor?.getAttribute('data-state') === 'dirty',
                      savePresent: save !== null,
                      saveDisabled:
                        save instanceof HTMLButtonElement
                          ? save.disabled
                          : null,
                      saveLabel: save?.textContent?.trim() ?? null,
                      alertVisible: alert ? visible(alert) : false,
                      alertText: alert?.textContent?.trim() ?? null,
                      sourceVisible:
                        textarea instanceof HTMLTextAreaElement
                          ? visible(textarea)
                          : false,
                      sourceValue:
                        textarea instanceof HTMLTextAreaElement
                          ? textarea.value
                          : null,
                      sourceValueLength:
                        textarea instanceof HTMLTextAreaElement
                          ? textarea.value.length
                          : null,
                      sourceDisabled:
                        textarea instanceof HTMLTextAreaElement
                          ? textarea.disabled
                          : null,
                      sourceLanguage:
                        sourceEditor?.getAttribute('data-language') ?? null,
                      sourceState:
                        sourceEditor?.getAttribute('data-state') ?? null,
                      sourceHighlightPresent:
                        sourceEditor?.querySelector('[data-part="highlight"]') !=
                        null,
                      previewVisible: preview ? visible(preview) : false,
                      previewHeading:
                        preview?.querySelector('h1')?.textContent?.trim() ??
                        null,
                      previewImageCount: preview
                        ? preview.querySelectorAll('img').length
                        : 0,
                      modeToggleRole:
                        modeToggle?.getAttribute('role') ?? null,
                      modeToggleLabels: toggleButtons.map((button) =>
                        (button.textContent ?? '').trim(),
                      ),
                      richPressed:
                        toggleButtons[0]?.getAttribute('aria-pressed') ?? null,
                      sourcePressed:
                        toggleButtons[1]?.getAttribute('aria-pressed') ?? null,
                      imagePlaceholders: placeholders.map((placeholder) => ({
                        role: placeholder.getAttribute('role'),
                        ariaLabel: placeholder.getAttribute('aria-label'),
                        href: placeholder.getAttribute(
                          'data-workspace-image-failed',
                        ),
                        text: placeholder.textContent?.trim() ?? null,
                        visible: visible(placeholder),
                      })),
                      readOnlyBinary: {
                        previewEmptyVisible: binaryEmpty
                          ? visible(binaryEmpty)
                          : false,
                        previewEmptyText:
                          binaryEmpty?.textContent?.trim() ?? null,
                        saveAbsent:
                          panel?.querySelector(
                            '[data-artemis-component="workspace-editor-toolbar"] [data-part="save"]',
                          ) == null,
                        statusAbsent:
                          panel?.querySelector(
                            '[data-artemis-component="workspace-editor-toolbar"] [data-part="status"]',
                          ) == null,
                        editorAbsent:
                          panel?.querySelector(
                            '[data-artemis-component="workspace-editor-toolbar"]',
                          ) == null && textarea == null,
                      },
                      focusTag: document.activeElement?.tagName ?? null,
                      statusTrace: window.__markdownEditorStatusTrace ?? null,
                      toggleProbe: window.__markdownEditorToggleProbe ?? null,
                    };
                  })(),
                  mcpEditor: (() => {
                    const editor = document.querySelector('.mcp-editor');
                    const inputByLabel = (text) => {
                      const label = [
                        ...document.querySelectorAll(
                          '.mcp-editor label[data-part="label"]',
                        ),
                      ].find(
                        (candidate) => candidate.textContent?.trim() === text,
                      );
                      return label instanceof HTMLLabelElement
                        ? label.control
                        : null;
                    };
                    const inputsByLabelPrefix = (prefix) => [
                      ...document.querySelectorAll(
                        '.mcp-editor label[data-part="label"]',
                      ),
                    ].flatMap((label) =>
                      label instanceof HTMLLabelElement &&
                      label.textContent?.trim().startsWith(prefix) &&
                      label.control instanceof HTMLInputElement
                        ? [label.control]
                        : [],
                    );
                    const validation = document.querySelector(
                      '.mcp-editor .mcp-editor-validation',
                    );
                    const actionError = document.querySelector(
                      '.mcp-editor .mcp-editor-action-error',
                    );
                    const retry = document.querySelector(
                      '.mcp-editor .mcp-editor-action-retry',
                    );
                    const busyRegion = document.querySelector(
                      '.mcp-editor .mcp-editor-busy',
                    );
                    const test = document.querySelector('.mcp-editor-test');
                    const testButton = test?.querySelector(
                      '.mcp-editor-test-button',
                    );
                    const testStatus = test?.querySelector(
                      '.mcp-editor-test-status',
                    );
                    const testFailure = test?.querySelector(
                      '.mcp-editor-test-failure',
                    );
                    const testHint = test?.querySelector(
                      '.mcp-editor-test-hint',
                    );
                    const removeButton = document.querySelector(
                      '.mcp-editor .mcp-editor-remove',
                    );
                    const saveButton = document.querySelector(
                      '.mcp-editor .mcp-editor-save',
                    );
                    const backButton = document.querySelector(
                      '.mcp-editor .mcp-editor-back',
                    );
                    const backIcon = backButton?.querySelector('svg');
                    const validationList = validation?.querySelector('ul');
                    const commandInput = inputByLabel('Launch command');
                    const urlInput = inputByLabel('Server URL');
                    const bearerInput = document.querySelector(
                      '.mcp-editor input[type="password"]',
                    );
                    const dialog = document.querySelector('.confirmation-dialog');
                    return {
                      editorVisible: editor ? visible(editor) : false,
                      direction: getComputedStyle(document.documentElement).direction,
                      backIconTransform: backIcon
                        ? getComputedStyle(backIcon).transform
                        : null,
                      validationPaddingInlineStart: validationList
                        ? getComputedStyle(validationList).paddingInlineStart
                        : null,
                      heading: editor?.querySelector('h1')?.textContent?.trim() ?? null,
                      feedbackAriaBusy:
                        document
                          .querySelector('.mcp-editor-feedback')
                          ?.getAttribute('aria-busy') ?? null,
                      busyText: busyRegion?.textContent?.trim() ?? null,
                      validationVisible: validation ? visible(validation) : false,
                      validationRole: validation?.getAttribute('role') ?? null,
                      validationText: validation?.textContent?.trim() ?? null,
                      actionErrorVisible: actionError ? visible(actionError) : false,
                      actionErrorRole: actionError?.getAttribute('role') ?? null,
                      actionErrorText: actionError?.textContent?.trim() ?? null,
                      retryPresent: retry != null,
                      retryDisabled:
                        retry instanceof HTMLButtonElement ? retry.disabled : null,
                      testPresent: test != null,
                      testAriaBusy: test?.getAttribute('aria-busy') ?? null,
                      testStatusText: testStatus?.textContent?.trim() ?? null,
                      testFailureVisible: testFailure ? visible(testFailure) : false,
                      testFailureText: testFailure?.textContent?.trim() ?? null,
                      testHintPresent: testHint != null,
                      testHintText: testHint?.textContent?.trim() ?? null,
                      testButtonDisabled:
                        testButton instanceof HTMLButtonElement
                          ? testButton.disabled
                          : null,
                      removePresent: removeButton != null,
                      removeDisabled:
                        removeButton instanceof HTMLButtonElement
                          ? removeButton.disabled
                          : null,
                      savePresent: saveButton != null,
                      saveDisabled:
                        saveButton instanceof HTMLButtonElement
                          ? saveButton.disabled
                          : null,
                      backDisabled:
                        backButton instanceof HTMLButtonElement
                          ? backButton.disabled
                          : null,
                      commandValue:
                        commandInput instanceof HTMLInputElement
                          ? commandInput.value
                          : null,
                      urlValue:
                        urlInput instanceof HTMLInputElement ? urlInput.value : null,
                      urlDisabled:
                        urlInput instanceof HTMLInputElement ? urlInput.disabled : null,
                      argsValues: inputsByLabelPrefix('Arguments ').map(
                        (input) => input.value,
                      ),
                      bearerMasked:
                        bearerInput instanceof HTMLInputElement
                          ? bearerInput.type === 'password'
                          : null,
                      confirmDialog:
                        dialog instanceof HTMLElement
                          ? {
                              visible: visible(dialog),
                              role: dialog.getAttribute('role'),
                              tone: dialog.getAttribute('class') ?? '',
                              title:
                                dialog
                                  .querySelector('#confirmation-title')
                                  ?.textContent?.trim() ?? null,
                              message:
                                dialog
                                  .querySelector('#confirmation-message')
                                  ?.textContent?.trim() ?? null,
                              cancelLabel:
                                dialog
                                  .querySelector('.secondary-button')
                                  ?.textContent?.trim() ?? null,
                              confirmLabel:
                                dialog
                                  .querySelector('.primary-button')
                                  ?.textContent?.trim() ?? null,
                              confirmDanger:
                                dialog
                                  .querySelector('.primary-button')
                                  ?.classList.contains('danger') ?? false,
                            }
                          : null,
                      manageMessageText:
                        document
                          .querySelector(
                            '.resource-management-page ' +
                              '[data-artemis-component="inline-notice"]' +
                              '[data-tone="info"] [data-part="message"]',
                          )
                          ?.textContent?.trim() ?? null,
                      manageServerNames: [
                        ...document.querySelectorAll(
                          '.resource-management-list .resource-management-row strong',
                        ),
                      ].map((name) => name.textContent?.trim() ?? ''),
                      focusTag: document.activeElement?.tagName ?? null,
                      busyTrace: window.__mcpEditorBusyTrace ?? null,
                      probe: window.__mcpEditorProbe ?? null,
                      consoleCapture: window.__mcpEditorConsoleCapture ?? null,
                      seedRow: window.__mcpEditorSeedRow ?? null,
                      seedStdioRow: window.__mcpEditorSeedStdioRow ?? null,
                    };
                  })(),
                  messageActionLabels: [...document.querySelectorAll(
                    ".message-action",
                  )].map((button) => button.getAttribute("aria-label")),
                  composerValue:
                    composerInput instanceof HTMLTextAreaElement
                      ? composerInput.value
                      : null,
                  sourceImageEntry: sourceImageEntryBounds
                    ? {
                        label: sourceImageEntry?.getAttribute("aria-label"),
                        left: sourceImageEntryBounds.left,
                        right: sourceImageEntryBounds.right,
                        thumbnail: sourceImageThumbnailBounds
                          ? {
                              left: sourceImageThumbnailBounds.left,
                              right: sourceImageThumbnailBounds.right,
                            }
                          : null,
                        title: sourceImageTitleBounds
                          ? {
                              left: sourceImageTitleBounds.left,
                              right: sourceImageTitleBounds.right,
                            }
                          : null,
                      }
                    : null,
                  sourceImagePreview: sourceImagePreview
                    ? {
                        visible: visible(sourceImagePreview),
                        label: sourceImagePreview.getAttribute("aria-label"),
                        imageAlt:
                          sourceImagePreview
                            .querySelector("img")
                            ?.getAttribute("alt") ?? null,
                      }
                    : null,
                  goalActionGeometry: goalBar
                    ? [...goalBar.querySelectorAll(".goal-bar-actions button")]
                        .map((button) => {
                          const bounds = button.getBoundingClientRect();
                          const icon = button.querySelector("svg")
                            ?.getBoundingClientRect();
                          return {
                            height: bounds.height,
                            width: bounds.width,
                            iconHeight: icon?.height ?? null,
                            iconWidth: icon?.width ?? null,
                          };
                        })
                    : [],
                  cardHeatmap: cardHeatmapView === "card-heatmap"
                    ? (() => {
                        const summarySection = document.querySelector(
                          ".token-usage-summary",
                        );
                        const summaryItems = [
                          ...document.querySelectorAll(
                            ".token-usage-summary-item",
                          ),
                        ];
                        const grid = document.querySelector(
                          ".token-usage-grid",
                        );
                        const cells = [
                          ...document.querySelectorAll(".token-usage-cell"),
                        ];
                        const dataLevelHistogram = {};
                        for (const cell of cells) {
                          const level = cell.getAttribute("data-level") ?? "missing";
                          dataLevelHistogram[level] =
                            (dataLevelHistogram[level] ?? 0) + 1;
                        }
                        const months = document.querySelector(
                          ".token-usage-months",
                        );
                        const monthLabels = [
                          ...(months?.querySelectorAll("span") ?? []),
                        ];
                        // The routing branch focused today's cell and the
                        // tooltip DOM has committed, so the probe reads the
                        // focused state synchronously (a fresh .focus()
                        // here would race React's re-render).
                        const focusedCell =
                          cells.find(
                            (cell) => cell === document.activeElement,
                          ) ?? null;
                        const focusTooltipProbe = {
                          focused: focusedCell !== null,
                          tooltipRolePresent:
                            focusedCell?.querySelector('[role="tooltip"]') !==
                            null,
                        };
                        return {
                          view: cardHeatmapView,
                          summary: {
                            present: summarySection !== null,
                            className: summarySection?.getAttribute("class"),
                            ariaLabel:
                              summarySection?.getAttribute("aria-label") ?? null,
                            itemCount: summaryItems.length,
                            items: summaryItems.map((item) => ({
                              value:
                                item.querySelector("strong")?.textContent ?? null,
                              label:
                                item.querySelector("span")?.textContent ?? null,
                              itemClassName: item.getAttribute("class"),
                            })),
                          },
                          heatmap: {
                            gridPresent: grid !== null,
                            gridClassName: grid?.getAttribute("class"),
                            gridRole: grid?.getAttribute("role") ?? null,
                            gridAriaLabel:
                              grid?.getAttribute("aria-label") ?? null,
                            cellCount: cells.length,
                            cellRole: cells[0]?.getAttribute("role") ?? null,
                            cellTagName:
                              cells[0]?.tagName.toLowerCase() ?? null,
                            dataLevelHistogram,
                            monthContainerAriaHidden:
                              months?.getAttribute("aria-hidden") ?? null,
                            monthLabelCount: monthLabels.length,
                            monthLabels: monthLabels.map((label) => label.textContent),
                            focusTooltipProbe,
                          },
                        };
                      })()
                    : null,
                  iconSizing: iconSizingView.startsWith("icon-sizing-")
                    ? (() => {
                        const measure = (selector) => {
                          const elements = [...document.querySelectorAll(selector)];
                          const first = elements[0] ?? null;
                          if (!first) {
                            return { selector, count: 0, sample: null };
                          }
                          const rect = first.getBoundingClientRect();
                          const style = getComputedStyle(first);
                          return {
                            selector,
                            count: elements.length,
                            sample: {
                              tagName: first.tagName.toLowerCase(),
                              className: first.getAttribute("class"),
                              attributeWidth: first.getAttribute("width"),
                              attributeHeight: first.getAttribute("height"),
                              viewBox: first.getAttribute("viewBox"),
                              rectWidth: Math.round(rect.width * 100) / 100,
                              rectHeight: Math.round(rect.height * 100) / 100,
                              computedWidth: style.width,
                              computedHeight: style.height,
                            },
                          };
                        };
                        // .resource-avatar svg is the non-semantic fallback
                        // rule; no current consumer renders a bare svg inside
                        // an avatar, so measure the rule's applied size with
                        // a temporary probe element instead of the UI.
                        const probeAvatarFallback = () => {
                          const host = document.createElement("span");
                          host.className = "resource-avatar";
                          const svg = document.createElementNS(
                            "http://www.w3.org/2000/svg",
                            "svg",
                          );
                          host.appendChild(svg);
                          document.body.appendChild(host);
                          try {
                            const rect = svg.getBoundingClientRect();
                            const style = getComputedStyle(svg);
                            return {
                              selector: "css-probe .resource-avatar svg",
                              count: 1,
                              sample: {
                                tagName: "svg",
                                className: null,
                                attributeWidth: null,
                                attributeHeight: null,
                                viewBox: null,
                                origin: "css-probe",
                                rectWidth: Math.round(rect.width * 100) / 100,
                                rectHeight:
                                  Math.round(rect.height * 100) / 100,
                                computedWidth: style.width,
                                computedHeight: style.height,
                              },
                            };
                          } finally {
                            host.remove();
                          }
                        };
                        return {
                          view: iconSizingView,
                          targets: {
                            "environment-row-icon": measure(
                              ".environment-row-icon svg:not(.child-agent-mark)",
                            ),
                            "environment-header-action": measure(
                              ".environment-header-action svg",
                            ),
                            "environment-chevron": measure(
                              ".environment-chevron svg",
                            ),
                            "environment-external": measure(
                              ".environment-external svg",
                            ),
                            "environment-branch-search": measure(
                              ".environment-branch-search > svg",
                            ),
                            "environment-branch-list-check": measure(
                              ".environment-branch-list button i svg",
                            ),
                            "environment-branch-actions": measure(
                              ".environment-branch-actions > button > svg",
                            ),
                            "environment-git-destination-chevron": measure(
                              ".environment-git-destination-trigger > svg:last-of-type",
                            ),
                            "resource-avatar-semantic": measure(
                              ".resource-avatar .resource-semantic-icon",
                            ),
                            "resource-search-field": measure(
                              ".resource-search-field svg",
                            ),
                            "resource-discovery-search": measure(
                              '.resource-discovery-panel [data-artemis-component="search-field"] svg',
                            ),
                            "resource-add-plugin-card": measure(
                              ".resource-add-plugin-card button svg",
                            ),
                            "resource-avatar-fallback": probeAvatarFallback(),
                          },
                        };
                      })()
                    : null,
                  inputFields: inputFieldsView.startsWith("input-fields-")
                    ? (() => {
                        const probe = window.__inputFieldsProbe ?? null;
                        const avatarInput = document.querySelector(
                          ".profile-avatar-input",
                        );
                        const avatarLabel =
                          avatarInput?.nextElementSibling?.matches(
                            '[data-artemis-component="button"]',
                          )
                            ? avatarInput.nextElementSibling
                            : null;
                        const avatarStyle = avatarInput
                          ? getComputedStyle(avatarInput)
                          : null;
                        const labelStyle = avatarLabel
                          ? getComputedStyle(avatarLabel)
                          : null;
                        const previewImage = document.querySelector(
                          ".settings-profile-avatar-preview img",
                        );
                        return {
                          view: inputFieldsView,
                          probe,
                          avatar: avatarInput
                            ? {
                                accept: avatarInput.getAttribute("accept"),
                                type: avatarInput.type,
                                disabled: avatarInput.disabled,
                                srOnly: {
                                  display: avatarStyle?.display ?? null,
                                  position: avatarStyle?.position ?? null,
                                  clipPath: avatarStyle?.clipPath ?? null,
                                  overflow: avatarStyle?.overflow ?? null,
                                  width: avatarStyle?.width ?? null,
                                  height: avatarStyle?.height ?? null,
                                  whiteSpace: avatarStyle?.whiteSpace ?? null,
                                },
                                geometry: {
                                  offsetParentPresent:
                                    avatarInput.offsetParent !== null,
                                  offsetWidth: avatarInput.offsetWidth,
                                  offsetHeight: avatarInput.offsetHeight,
                                },
                                tabIndex: avatarInput.tabIndex,
                                labelTagName:
                                  avatarLabel?.tagName.toLowerCase() ?? null,
                                labelClass:
                                  avatarLabel?.getAttribute("class") ?? null,
                                labelCurrentOutline: {
                                  style: labelStyle?.outlineStyle ?? null,
                                  width: labelStyle?.outlineWidth ?? null,
                                  color: labelStyle?.outlineColor ?? null,
                                },
                                previewImagePresent: previewImage !== null,
                                previewImageSrcPrefix: (
                                  previewImage?.getAttribute("src") ?? ""
                                ).slice(0, 22),
                                removePresent:
                                  document.querySelector(
                                    ".settings-profile-avatar-actions button",
                                  ) !== null,
                              }
                            : null,
                          automationDialogPresent:
                            document.querySelector(".automation-dialog") !==
                            null,
                        };
                      })()
                    : null,
                  navigationControls: (() => {
                    const roots = [
                      ...document.querySelectorAll(
                        '[data-artemis-component="tabs"], ' +
                          '[data-artemis-component="segmented-control"]',
                      ),
                    ];
                    const describe = (root) => {
                      const rootBounds = root.getBoundingClientRect();
                      const rootStyle = getComputedStyle(root);
                      const buttons = [...root.querySelectorAll('button')].map(
                        (button) => {
                          const bounds = button.getBoundingClientRect();
                          const style = getComputedStyle(button);
                          const controlledPanelId =
                            button.getAttribute('aria-controls');
                          const controlledPanel = controlledPanelId
                            ? document.getElementById(controlledPanelId)
                            : null;
                          return {
                            id: button.id,
                            label: button.textContent?.trim() ?? '',
                            part: button.getAttribute('data-part'),
                            state: button.getAttribute('data-state'),
                            role: button.getAttribute('role'),
                            ariaControls: button.getAttribute('aria-controls'),
                            ariaPressed: button.getAttribute('aria-pressed'),
                            ariaSelected: button.getAttribute('aria-selected'),
                            disabled: button.disabled,
                            tabIndex: button.tabIndex,
                            documentActive: document.activeElement === button,
                            controlledPanel:
                              controlledPanel === null
                                ? null
                                : {
                                    id: controlledPanel.id,
                                    role: controlledPanel.getAttribute('role'),
                                    ariaLabelledBy:
                                      controlledPanel.getAttribute(
                                        'aria-labelledby',
                                      ),
                                    hidden: controlledPanel.hidden,
                                  },
                            geometry: {
                              width: bounds.width,
                              height: bounds.height,
                            },
                            computed: {
                              backgroundColor: style.backgroundColor,
                              borderBlockEndColor: style.borderBlockEndColor,
                              borderStyle: style.borderStyle,
                              borderWidth: style.borderWidth,
                              color: style.color,
                              fontFamily: style.fontFamily,
                              fontWeight: style.fontWeight,
                              minBlockSize: style.minBlockSize,
                              opacity: style.opacity,
                              outlineColor: style.outlineColor,
                              outlineStyle: style.outlineStyle,
                              outlineWidth: style.outlineWidth,
                            },
                          };
                        },
                      );
                      return {
                        component: root.getAttribute(
                          'data-artemis-component',
                        ),
                        context: root.closest('.token-usage-page')
                          ? 'token-usage'
                          : root.closest(
                                '[data-artemis-component="workspace-file-layout"]',
                              )
                            ? 'workspace-editor'
                            : root.closest(
                                  '[data-artemis-component="workspace-tab-pane"]',
                                )
                              ? 'markdown-reader'
                              : 'other',
                        state: root.getAttribute('data-state'),
                        size: root.getAttribute('data-size'),
                        className: root.getAttribute('class'),
                        groupLabel: root.getAttribute('aria-label'),
                        role: root.getAttribute('role'),
                        geometry: {
                          width: rootBounds.width,
                          height: rootBounds.height,
                        },
                        computed: {
                          backgroundColor: rootStyle.backgroundColor,
                          borderStyle: rootStyle.borderStyle,
                          borderWidth: rootStyle.borderWidth,
                          color: rootStyle.color,
                          display: rootStyle.display,
                          fontFamily: rootStyle.fontFamily,
                        },
                        parts: [
                          'root',
                          ...buttons.map((button) => button.part),
                        ],
                        buttons,
                        portalCount:
                          root.querySelectorAll('[data-artemis-portal]').length,
                      };
                    };
                    return {
                      interaction:
                        window.__navigationControlsInteraction ?? null,
                      documentHasFocus: document.hasFocus(),
                      components: roots.map(describe),
                      rootTokens: {
                        surfaceBase: getComputedStyle(
                          document.documentElement,
                        )
                          .getPropertyValue('--artemis-color-surface-base')
                          .trim(),
                        textPrimary: getComputedStyle(
                          document.documentElement,
                        )
                          .getPropertyValue('--artemis-color-text-primary')
                          .trim(),
                      },
                    };
                  })(),
                  formControls: (() => {
                    const roots = [
                      ...document.querySelectorAll(
                        '[data-artemis-component="text-field"], ' +
                          '[data-artemis-component="search-field"], ' +
                          '[data-artemis-component="select"], ' +
                          '[data-artemis-component="checkbox"], ' +
                          '[data-artemis-component="switch"]',
                      ),
                    ];
                    const describe = (root) => {
                      const control = root.querySelector(
                        '[data-part="control"], [data-part="trigger"]',
                      );
                      const visual =
                        root.querySelector(
                          '[data-part="track"], [data-part="indicator"]',
                        ) ?? control;
                      const style = visual ? getComputedStyle(visual) : null;
                      const focusStyle = control
                        ? getComputedStyle(control)
                        : null;
                      const bounds = root.getBoundingClientRect();
                      const menu = root.querySelector('[data-part="menu"]');
                      const menuStyle = menu ? getComputedStyle(menu) : null;
                      const menuBounds = menu?.getBoundingClientRect() ?? null;
                      return {
                        component: root.getAttribute(
                          'data-artemis-component',
                        ),
                        context: root.closest('.composer-context-picker')
                          ? 'composer'
                          : root.closest('.review-scope-select')
                            ? 'review'
                            : root.closest('.mcp-editor')
                              ? 'mcp-editor'
                              : root.closest('.settings-panel')
                                ? 'settings'
                                : root.closest('.archive-page')
                                  ? 'archive'
                                  : root.closest('.resource-page')
                                    ? 'resource'
                                    : 'other',
                        state: root.getAttribute('data-state'),
                        size: root.getAttribute('data-size'),
                        className: root.getAttribute('class'),
                        parts: [
                          'root',
                          ...[
                            ...root.querySelectorAll('[data-part]'),
                          ].map((part) => part.getAttribute('data-part')),
                        ],
                        geometry: {
                          width: bounds.width,
                          height: bounds.height,
                        },
                        control: control
                          ? {
                              tagName: control.tagName.toLowerCase(),
                              type: control.getAttribute('type'),
                              role: control.getAttribute('role'),
                              ariaInvalid:
                                control.getAttribute('aria-invalid'),
                              ariaExpanded:
                                control.getAttribute('aria-expanded'),
                              disabled:
                                control instanceof HTMLInputElement ||
                                control instanceof HTMLButtonElement
                                  ? control.disabled
                                  : null,
                              checked:
                                control instanceof HTMLInputElement
                                  ? control.checked
                                  : null,
                              value:
                                control instanceof HTMLInputElement
                                  ? control.value
                                  : null,
                              tabIndex:
                                control instanceof HTMLElement
                                  ? control.tabIndex
                                  : null,
                              documentActive:
                                document.activeElement === control,
                            }
                          : null,
                        computed: style
                          ? {
                              backgroundColor: style.backgroundColor,
                              borderColor: style.borderColor,
                              borderStyle: style.borderStyle,
                              borderWidth: style.borderWidth,
                              color: style.color,
                              fontFamily: style.fontFamily,
                              minBlockSize: style.minBlockSize,
                              opacity: style.opacity,
                            }
                          : null,
                        focus: focusStyle
                          ? {
                              outlineColor: focusStyle.outlineColor,
                              outlineStyle: focusStyle.outlineStyle,
                              outlineWidth: focusStyle.outlineWidth,
                              visualOutlineStyle: style?.outlineStyle ?? null,
                              visualOutlineWidth: style?.outlineWidth ?? null,
                          }
                          : null,
                        menu:
                          menuBounds && menuStyle
                            ? {
                                geometry: {
                                  left: menuBounds.left,
                                  right: menuBounds.right,
                                  top: menuBounds.top,
                                  bottom: menuBounds.bottom,
                                  width: menuBounds.width,
                                  height: menuBounds.height,
                                },
                                inlineStartDelta: Math.abs(
                                  menuBounds.left - bounds.left,
                                ),
                                inlineEndDelta: Math.abs(
                                  menuBounds.right - bounds.right,
                                ),
                                overflowX: menuStyle.overflowX,
                                overflowY: menuStyle.overflowY,
                                listboxOverflowY:
                                  menu.querySelector('[data-part="listbox"]')
                                    ? getComputedStyle(
                                        menu.querySelector(
                                          '[data-part="listbox"]',
                                        ),
                                      ).overflowY
                                    : null,
                                backgroundColor: menuStyle.backgroundColor,
                                borderStyle: menuStyle.borderStyle,
                                borderWidth: menuStyle.borderWidth,
                                withinViewport:
                                  menuBounds.left >= 0 &&
                                  menuBounds.right <= window.innerWidth &&
                                  menuBounds.top >= 0 &&
                                  menuBounds.bottom <= window.innerHeight,
                                zIndex: menuStyle.zIndex,
                              }
                            : null,
                        portalCount:
                          root.querySelectorAll('[data-artemis-portal]').length,
                      };
                    };
                    return {
                      interaction: window.__formControlsInteraction ?? null,
                      documentHasFocus: document.hasFocus(),
                      components: roots.map(describe),
                      rootTokens: {
                        surfaceBase: getComputedStyle(
                          document.documentElement,
                        )
                          .getPropertyValue('--artemis-color-surface-base')
                          .trim(),
                        textPrimary: getComputedStyle(
                          document.documentElement,
                        )
                          .getPropertyValue('--artemis-color-text-primary')
                          .trim(),
                      },
                    };
                  })(),
                  conversationTimeline:
                    conversationTimelineView.startsWith(
                      'conversation-timeline-',
                    )
                      ? (() => {
                          const componentNames = [
                            'conversation-surface',
                            'timeline-viewport',
                            'timeline',
                            'timeline-turn',
                            'conversation-message',
                            'conversation-empty-state',
                            'turn-execution-disclosure',
                            'turn-change-summary',
                            'queued-message-group',
                            'queued-message-item',
                            'tool-activity',
                            'task-plan',
                            'user-input',
                            'agent-activity',
                            'turn-status',
                          ];
                          const roots = [
                            ...document.querySelectorAll(
                              componentNames
                                .map(
                                  (component) =>
                                    '[data-artemis-component="' +
                                    component +
                                    '"]',
                                )
                                .join(', '),
                            ),
                          ];
                          const describe = (root) => {
                            const bounds = root.getBoundingClientRect();
                            const style = getComputedStyle(root);
                            return {
                              component: root.getAttribute(
                                'data-artemis-component',
                              ),
                              tagName: root.tagName.toLowerCase(),
                              state: root.getAttribute('data-state'),
                              messageKind:
                                root.getAttribute('data-message-kind'),
                              role: root.getAttribute('role'),
                              ariaLabel: root.getAttribute('aria-label'),
                              open:
                                root instanceof HTMLDetailsElement
                                  ? root.open
                                  : null,
                              parts: [
                                'root',
                                ...root.querySelectorAll('[data-part]'),
                              ].map((part) =>
                                typeof part === 'string'
                                  ? part
                                  : part.getAttribute('data-part'),
                              ),
                              geometry: {
                                left: bounds.left,
                                right: bounds.right,
                                top: bounds.top,
                                bottom: bounds.bottom,
                                width: bounds.width,
                                height: bounds.height,
                              },
                              contentFitsInline:
                                root.scrollWidth <= root.clientWidth + 1,
                              computed: {
                                contentVisibility: style.contentVisibility,
                                direction: style.direction,
                                display: style.display,
                                overflowX: style.overflowX,
                                overflowY: style.overflowY,
                              },
                            };
                          };
                          const viewport = document.querySelector(
                            '[data-artemis-component="timeline-viewport"]',
                          );
                          const timeline = document.querySelector(
                            '[data-artemis-component="timeline"]',
                          );
                          const userMessage = document.querySelector(
                            '[data-artemis-component="conversation-message"]' +
                              '[data-message-kind="user"]',
                          );
                          const timelineBounds =
                            timeline?.getBoundingClientRect();
                          const viewportBounds =
                            viewport?.getBoundingClientRect();
                          const userBounds = userMessage?.getBoundingClientRect();
                          const direction = getComputedStyle(
                            document.documentElement,
                          ).direction;
                          const inlineEndGap =
                            timelineBounds && userBounds
                              ? direction === 'rtl'
                                ? userBounds.left - timelineBounds.left
                                : timelineBounds.right - userBounds.right
                              : null;
                          const horizontalOverflow = timeline
                            ? [...timeline.querySelectorAll('*')]
                                .filter((candidate) => {
                                  const style = getComputedStyle(candidate);
                                  return (
                                    candidate.scrollWidth >
                                      candidate.clientWidth + 1 &&
                                    style.overflowX !== 'auto' &&
                                    style.overflowX !== 'scroll' &&
                                    style.overflowX !== 'hidden' &&
                                    style.overflowX !== 'clip' &&
                                    style.textOverflow !== 'ellipsis'
                                  );
                                })
                                .map((candidate) => ({
                                  tagName: candidate.tagName.toLowerCase(),
                                  className: candidate.getAttribute('class'),
                                  component: candidate.getAttribute(
                                    'data-artemis-component',
                                  ),
                                  part: candidate.getAttribute('data-part'),
                                  clientWidth: candidate.clientWidth,
                                  scrollWidth: candidate.scrollWidth,
                                }))
                                .slice(0, 20)
                            : [];
                          return {
                            view: conversationTimelineView,
                            direction,
                            devicePixelRatio: window.devicePixelRatio,
                            interaction:
                              window.__conversationTimelineInteraction ?? null,
                            components: roots.map(describe),
                            componentCounts: Object.fromEntries(
                              componentNames.map((component) => [
                                component,
                                roots.filter(
                                  (root) =>
                                    root.getAttribute(
                                      'data-artemis-component',
                                    ) === component,
                                ).length,
                              ]),
                            ),
                            thinkingLeak: document.body.innerText.includes(
                              'ARTEMIS_PRIVATE_THINKING_MUST_STAY_HIDDEN',
                            ),
                            horizontalOverflow,
                            timelineFitsViewport:
                              !timeline ||
                              timeline.scrollWidth <= timeline.clientWidth + 1,
                            inlineEndGap,
                            visibleMessageCount: viewportBounds
                              ? roots.filter((root) => {
                                  if (
                                    root.getAttribute(
                                      'data-artemis-component',
                                    ) !== 'conversation-message'
                                  ) {
                                    return false;
                                  }
                                  const bounds = root.getBoundingClientRect();
                                  return (
                                    bounds.bottom > viewportBounds.top + 1 &&
                                    bounds.top < viewportBounds.bottom - 1
                                  );
                                }).length
                              : 0,
                            visibleMessagePixels: viewportBounds
                              ? Math.max(
                                  0,
                                  ...roots
                                    .filter(
                                      (root) =>
                                        root.getAttribute(
                                          'data-artemis-component',
                                        ) === 'conversation-message',
                                    )
                                    .map((root) => {
                                      const bounds =
                                        root.getBoundingClientRect();
                                      return (
                                        Math.min(
                                          bounds.bottom,
                                          viewportBounds.bottom,
                                        ) -
                                        Math.max(
                                          bounds.top,
                                          viewportBounds.top,
                                        )
                                      );
                                    }),
                                )
                              : 0,
                            viewport:
                              viewport instanceof HTMLElement
                                ? {
                                    clientHeight: viewport.clientHeight,
                                    clientWidth: viewport.clientWidth,
                                    scrollHeight: viewport.scrollHeight,
                                    scrollLeft: viewport.scrollLeft,
                                    scrollTop: viewport.scrollTop,
                                    scrollWidth: viewport.scrollWidth,
                                    overflowY:
                                      getComputedStyle(viewport).overflowY,
                                  }
                                : null,
                            taskPlanPresent:
                              document.querySelector(
                                '[data-artemis-component="task-plan"]',
                              ) !== null,
                            queueEditorPresent:
                              document.querySelector(
                                '.queued-message-editor textarea',
                              ) !== null,
                            messageActionCount: document.querySelectorAll(
                              '[data-artemis-component="conversation-message"] ' +
                                '[data-part="actions"] button',
                            ).length,
                          };
                        })()
                      : null,
                  feedbackLayout: (() => {
                    const selector = [
                      'tooltip',
                      'popover',
                      'dialog',
                      'confirmation',
                      'toast',
                      'inline-notice',
                      'empty-state',
                      'loading-state',
                      'error-state',
                      'toolbar',
                      'list-row',
                      'panel-header',
                      'scroll-area',
                      'split-pane',
                      'approval-card',
                      'result-disclosure',
                    ]
                      .map(
                        (component) =>
                          '[data-artemis-component="' + component + '"]',
                      )
                      .join(', ');
                    const roots = [...document.querySelectorAll(selector)];
                    const describe = (root) => {
                      const bounds = root.getBoundingClientRect();
                      const style = getComputedStyle(root);
                      const scrollContainer = root.closest('.timeline-scroll');
                      const scrollBounds = scrollContainer?.getBoundingClientRect();
                      const approvalActions =
                        root.getAttribute('data-artemis-component') ===
                        'approval-card'
                          ? root.querySelector('[data-part="actions"]')
                          : null;
                      const approvalActionBounds =
                        approvalActions?.getBoundingClientRect();
                      const approvalActionButtons = approvalActions
                        ? [...approvalActions.querySelectorAll('button')].map(
                            (button) => {
                              const buttonBounds =
                                button.getBoundingClientRect();
                              return {
                                width: buttonBounds.width,
                                height: buttonBounds.height,
                                clientWidth: button.clientWidth,
                                scrollWidth: button.scrollWidth,
                                clientHeight: button.clientHeight,
                                scrollHeight: button.scrollHeight,
                              };
                            },
                          )
                        : [];
                      const overlay = [
                        'tooltip',
                        'popover',
                        'dialog',
                        'toast',
                      ].includes(root.getAttribute('data-artemis-component'));
                      const inlineOverflow = [...root.querySelectorAll('*')]
                        .map((candidate) => {
                          const candidateBounds = candidate.getBoundingClientRect();
                          return {
                            tag: candidate.tagName.toLowerCase(),
                            className: candidate.getAttribute('class'),
                            component: candidate.getAttribute(
                              'data-artemis-component',
                            ),
                            part: candidate.getAttribute('data-part'),
                            clientWidth: candidate.clientWidth,
                            scrollWidth: candidate.scrollWidth,
                            left: candidateBounds.left,
                            right: candidateBounds.right,
                          };
                        })
                        .filter(
                          (candidate) =>
                            candidate.scrollWidth > candidate.clientWidth + 1 ||
                            candidate.left < bounds.left - 1 ||
                            candidate.right > bounds.right + 1,
                        )
                        .slice(0, 20);
                      return {
                        component: root.getAttribute(
                          'data-artemis-component',
                        ),
                        context: root.classList.contains('settings-panel')
                          ? 'settings'
                          : root.classList.contains(
                                'environment-checks-popover',
                              )
                            ? 'environment'
                            : root.classList.contains('approval-card')
                              ? 'approval'
                              : root.getAttribute(
                                  'data-artemis-component',
                                ) === 'approval-card'
                                ? 'approval'
                                : root.closest('.resource-page')
                                  ? 'resource'
                                  : root.classList.contains('transient-notice')
                                    ? 'app-notice'
                                    : 'other',
                        state: root.getAttribute('data-state'),
                        tone: root.getAttribute('data-tone'),
                        role: root.getAttribute('role'),
                        ariaLabel: root.getAttribute('aria-label'),
                        ariaLabelledBy: root.getAttribute('aria-labelledby'),
                        ariaDescribedBy: root.getAttribute('aria-describedby'),
                        ariaModal: root.getAttribute('aria-modal'),
                        geometry: {
                          left: bounds.left,
                          right: bounds.right,
                          top: bounds.top,
                          bottom: bounds.bottom,
                          width: bounds.width,
                          height: bounds.height,
                        },
                        withinViewport:
                          bounds.left >= -1 &&
                          bounds.right <= window.innerWidth + 1 &&
                          bounds.top >= -1 &&
                          bounds.bottom <= window.innerHeight + 1,
                        visibleWithinScrollContainer:
                          !scrollBounds ||
                          (bounds.left >= scrollBounds.left - 1 &&
                            bounds.right <= scrollBounds.right + 1 &&
                            bounds.top >= scrollBounds.top - 1 &&
                            bounds.bottom <= scrollBounds.bottom + 1),
                        scrollContainerGeometry: scrollBounds
                          ? {
                              left: scrollBounds.left,
                              right: scrollBounds.right,
                              top: scrollBounds.top,
                              bottom: scrollBounds.bottom,
                            }
                          : null,
                        scrollContainerMetrics:
                          scrollContainer instanceof HTMLElement
                            ? {
                                clientHeight: scrollContainer.clientHeight,
                                scrollHeight: scrollContainer.scrollHeight,
                                scrollTop: scrollContainer.scrollTop,
                              }
                            : null,
                        approvalActionsGeometry: approvalActionBounds
                          ? {
                              left: approvalActionBounds.left,
                              right: approvalActionBounds.right,
                              top: approvalActionBounds.top,
                              bottom: approvalActionBounds.bottom,
                            }
                          : null,
                        approvalActionsVisibleWithinScrollContainer:
                          !approvalActionBounds ||
                          !scrollBounds ||
                          (approvalActionBounds.left >= scrollBounds.left - 1 &&
                            approvalActionBounds.right <=
                              scrollBounds.right + 1 &&
                            approvalActionBounds.top >= scrollBounds.top - 1 &&
                            approvalActionBounds.bottom <=
                              scrollBounds.bottom + 1),
                        approvalActionButtons,
                        contentFitsInline:
                          root.scrollWidth <= root.clientWidth + 1,
                        inlineMetrics: {
                          clientWidth: root.clientWidth,
                          descendants: inlineOverflow,
                          scrollWidth: root.scrollWidth,
                        },
                        focusInside: root.contains(document.activeElement),
                        nativeDialogOpen:
                          root instanceof HTMLDialogElement ? root.open : null,
                        portalRoot: overlay
                          ? root.parentElement === document.body
                          : null,
                        parts: [
                          'root',
                          ...root.querySelectorAll('[data-part]'),
                        ].map((part) =>
                          typeof part === 'string'
                            ? part
                            : part.getAttribute('data-part'),
                        ),
                        computed: {
                          backgroundColor: style.backgroundColor,
                          borderStyle: style.borderStyle,
                          color: style.color,
                          direction: style.direction,
                          display: style.display,
                          overflowX: style.overflowX,
                          overflowY: style.overflowY,
                          position: style.position,
                          zIndex: style.zIndex,
                        },
                      };
                    };
                    const workspaceHeading = document.querySelector(
                      '.workspace-heading',
                    );
                    const workspaceLabel = workspaceHeading?.querySelector(
                      ':scope > strong',
                    );
                    const workspaceHeadingBounds =
                      workspaceHeading?.getBoundingClientRect();
                    const workspaceLabelBounds =
                      workspaceLabel?.getBoundingClientRect();
                    const workspaceLabelTextBounds = (() => {
                      if (!(workspaceLabel instanceof HTMLElement)) {
                        return null;
                      }
                      const range = document.createRange();
                      range.selectNodeContents(workspaceLabel);
                      return range.getBoundingClientRect();
                    })();
                    return {
                      components: roots.map(describe),
                      direction: document.documentElement.dir,
                      interaction:
                        window.__feedbackLayoutInteraction ?? null,
                      approvalScrollVerification:
                        window.__approvalScrollVerification ?? null,
                      approvalDisclosureVerification:
                        window.__approvalDisclosureVerification ?? null,
                      workspaceLabel:
                        workspaceHeading instanceof HTMLElement &&
                        workspaceLabel instanceof HTMLElement &&
                        workspaceHeadingBounds &&
                        workspaceLabelBounds
                          ? {
                              contentFitsInline:
                                workspaceLabel.scrollWidth <=
                                workspaceLabel.clientWidth + 1,
                              fullyVisible:
                                workspaceLabelBounds.left >=
                                  workspaceHeadingBounds.left - 1 &&
                                workspaceLabelBounds.right <=
                                  workspaceHeadingBounds.right + 1,
                              text: workspaceLabel.textContent?.trim() ?? '',
                              textFullyVisible:
                                workspaceLabelTextBounds !== null &&
                                workspaceLabelTextBounds.left >=
                                  workspaceLabelBounds.left - 1 &&
                                workspaceLabelTextBounds.right <=
                                  workspaceLabelBounds.right + 1,
                            }
                          : null,
                      reducedMotion: window.matchMedia(
                        '(prefers-reduced-motion: reduce)',
                      ).matches,
                      rootTokens: {
                        overlayScrim: getComputedStyle(
                          document.documentElement,
                        )
                          .getPropertyValue('--artemis-color-overlay-scrim')
                          .trim(),
                        shadowOverlay: getComputedStyle(
                          document.documentElement,
                        )
                          .getPropertyValue('--artemis-shadow-overlay')
                          .trim(),
                        surfaceRaised: getComputedStyle(
                          document.documentElement,
                        )
                          .getPropertyValue('--artemis-color-surface-raised')
                          .trim(),
                      },
                    };
                  })(),
                  interactiveCount: document.querySelectorAll(
                    "button, a[href], summary, input, select, textarea, [role='button'], [role='tab']",
                  ).length,
                  runtimeGlobalSecurity: {
                    processType: typeof globalThis.process,
                    requireType: typeof globalThis.require,
                  },
                  issues,
                };
              })()
            `)) as Record<string, unknown>;
            const runtimeGlobalSecurity = result.runtimeGlobalSecurity as
              { processType?: unknown; requireType?: unknown } | undefined;
            await writeFile(
              smokeAccessibility,
              `${JSON.stringify(
                {
                  ...result,
                  rendererConsoleEntries: smokeRendererConsoleEntries,
                  runtimeSecurity: {
                    contextIsolation:
                      smokePreloadSecurity?.contextIsolated ?? null,
                    nodeIntegration: !(
                      runtimeGlobalSecurity?.processType === "undefined" &&
                      runtimeGlobalSecurity?.requireType === "undefined"
                    ),
                    sandbox: smokePreloadSecurity?.sandboxed ?? null,
                  },
                  browserWebviewSecurity: smokeBrowserWebviewSecurity,
                  windowFocused: window.isFocused(),
                  userInputTransport: smokeUserInputTransportEvidence ?? null,
                  zoomFactor: smokeScale,
                  startupTimings,
                  reconnectIpcCalls: smokeMcpEditorReconnectIpcCalls,
                },
                undefined,
                2,
              )}\n`,
              "utf8",
            );
          }
        })
        .then(() => app.quit())
        .catch((error) => {
          console.error("Smoke validation failed.", error);
          app.exit(1);
        });
    });
  }
  return window;
}

app.on("web-contents-created", (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    const linkUrl = externalHttpUrl(url);
    if (linkUrl) {
      void shell.openExternal(linkUrl);
    }
    return { action: "deny" };
  });
});

app.on("render-process-gone", (_event, _contents, details) => {
  diagnosticBundleService?.record({
    source: "renderer",
    severity: details.reason === "clean-exit" ? "info" : "fatal",
    message: `Renderer process ended: ${details.reason}; exit code ${details.exitCode}.`,
  });
});

app
  .whenReady()
  .then(async () => {
    markStartupStage("app-ready");
    applyMacDockIcon();
    if (app.isPackaged && process.platform === "win32") {
      await ensureWindowsPackageAccess({
        applicationRoot: dirname(process.execPath),
        applicationVersion: app.getVersion(),
        markerPath: join(
          app.getPath("userData"),
          "windows-package-access.json",
        ),
      });
    }
    const platform = getPlatformContract();
    if (!platform.supported) {
      dialog.showErrorBox(
        "Unsupported platform",
        `Artemis slice 1 does not support ${process.platform}/${process.arch}.`,
      );
    }

    diagnosticBundleService = new DiagnosticBundleService(
      join(app.getPath("userData"), "diagnostics", "events.json"),
      [app.getPath("home"), app.getPath("userData"), app.getPath("temp")],
    );
    markStartupStage("diagnostics-ready");
    store = new AppStore(join(app.getPath("userData"), "artemis.sqlite"));
    turnChangeSetService = new TurnChangeSetService(
      join(app.getPath("userData"), "turn-changes"),
      store,
    );
    store.recoverInterruptedThreads();
    store.recoverInterruptedAutomationRuns();
    settingsStore = new EncryptedSettingsStore(
      join(app.getPath("userData"), "settings.json"),
      safeStorage,
    );
    const systemMemory = process.getSystemMemoryInfo();
    agentCapacityController = new AgentCapacityController(
      await settingsStore.agentConcurrencyPreference(),
      currentAgentCapacityHardware(systemMemory),
    );
    diagnosticBundleService.record({
      source: "main",
      severity: "info",
      message: `Agent concurrency startup limit ${agentCapacityController.limit}.`,
    });
    globalInstructionsStore = new GlobalInstructionsStore(
      join(app.getPath("userData"), "AGENTS.md"),
    );
    nativeTheme.on("updated", syncWindowBackgroundColors);
    const smokeTheme = process.env.ARTEMIS_SMOKE_THEME;
    applyNativeTheme(
      smokeMode && (smokeTheme === "light" || smokeTheme === "dark")
        ? smokeTheme
        : await settingsStore.themePreference(),
    );
    languagePreference = await settingsStore.languagePreference();
    resolvedLocalePreference = resolveAppLocale(
      languagePreference,
      app.getPreferredSystemLanguages(),
    );
    markStartupStage("core-state-ready");
    configureBrowserLocaleSession();
    await seedSmokeEnvironmentFixture();
    seedSmokeUserInputFixture();
    await seedSmokeUserInputTransportFixture();
    seedSmokeTokenUsageFixture();
    seedSmokeGoalFixture();
    seedSmokeTurnChangesFixture();
    await seedSmokeConversationTimelineFixture();
    seedSmokeMessageActionsFixture();
    seedSmokeQueuedSteerFixture();
    seedSmokeMarkdownEditorFixture();
    mcpConfigStore = new McpConfigStore(
      join(app.getPath("userData"), "mcp.json"),
    );
    await seedSmokeMcpEditorFixture();
    await seedSmokeIconSizingFixture();
    await seedSmokeInputFieldsFixture();
    mcpOAuthStore = new McpOAuthStore(
      join(app.getPath("userData"), "mcp-oauth.json"),
      safeStorage,
    );
    mcpSecretStore = new McpSecretStore(
      join(app.getPath("userData"), "mcp-secrets.json"),
      safeStorage,
    );
    googleAccountService = new GoogleAccountService(
      join(app.getPath("userData"), "google-account.json"),
      safeStorage,
      (url) => shell.openExternal(url),
      (url, init) => net.fetch(url.toString(), init),
      await loadGoogleOAuthClient(googleOAuthClientPath()),
    );
    mcpClientManager = new McpClientManager(
      process.platform,
      process.platform === "win32" ? windowsSandboxHelperPath() : undefined,
    );
    resourceCatalogService = new ResourceCatalogService(
      join(app.getPath("home"), ".pi", "agent", "skills"),
    );
    codexPluginService = new CodexPluginService({
      skillsRoot: join(app.getPath("home"), ".pi", "agent", "skills"),
      pluginsRoot: join(app.getPath("userData"), "codex-plugins"),
      marketplacesRoot: join(
        app.getPath("userData"),
        "codex-plugin-marketplaces",
      ),
      marketplaceStatePath: join(
        app.getPath("userData"),
        "codex-plugin-marketplaces.json",
      ),
      statePath: join(app.getPath("userData"), "codex-plugins.json"),
      mcpWorkspaceRoot: join(app.getPath("userData"), "mcp-workspaces"),
      mcpStore: mcpConfigStore,
      bundledArtifactRoot: bundledArtifactPluginsPath(),
      fetcher: (url, init) => net.fetch(url, init),
    });
    configurationImportService = new ConfigurationImportService({
      homePath: app.getPath("home"),
      skillsPath: join(app.getPath("home"), ".pi", "agent", "skills"),
      mcpWorkspaceRoot: join(app.getPath("userData"), "mcp-workspaces"),
      globalInstructions: globalInstructionsStore,
    });
    trustedExtensionStore = new TrustedExtensionStore(
      join(app.getPath("userData"), "trusted-extensions.json"),
    );
    trustedExtensionManager = new TrustedExtensionManager(
      process.platform,
      process.platform === "win32" ? windowsSandboxHelperPath() : undefined,
      extensionWorkerPath(),
    );
    const updateRecoveryRoot = join(app.getPath("userData"), "update-recovery");
    releaseUpdateManager = new ReleaseUpdateManager(
      autoUpdater,
      new UpdateRecoveryStore(
        join(updateRecoveryRoot, "state.json"),
        join(updateRecoveryRoot, "artifacts"),
      ),
      app.getVersion(),
      app.isPackaged,
      process.platform,
      rollbackScriptPath(),
      installedApplicationPath(),
      {
        ...(process.env.ARTEMIS_UPDATE_URL
          ? { ARTEMIS_UPDATE_URL: process.env.ARTEMIS_UPDATE_URL }
          : {}),
        ...(process.env.ARTEMIS_UPDATE_OWNER
          ? {
              ARTEMIS_UPDATE_OWNER: process.env.ARTEMIS_UPDATE_OWNER,
            }
          : {}),
        ...(process.env.ARTEMIS_UPDATE_REPO
          ? {
              ARTEMIS_UPDATE_REPO: process.env.ARTEMIS_UPDATE_REPO,
            }
          : {}),
        ...(process.env.ARTEMIS_UPDATE_CHANNEL
          ? {
              ARTEMIS_UPDATE_CHANNEL: process.env.ARTEMIS_UPDATE_CHANNEL,
            }
          : {}),
      },
      (status) => {
        mainWindow?.webContents.send(IPC.updateStatus, status);
      },
    );
    terminalService = new TerminalService(process.platform, {
      onData(terminalId, data) {
        mainWindow?.webContents.send(IPC.terminalData, { terminalId, data });
      },
      onExit(event) {
        mainWindow?.webContents.send(IPC.terminalExit, event);
      },
    });
    agentProcess = createAgentHostProcess();
    agentCapacityRuntime = {
      active: 0,
      activeParents: 0,
      waiting: 0,
      queued: 0,
      limit: agentCapacityController.limit,
    };
    startAgentCapacityMonitoring();
    agentRuntimeReady = applyAgentRuntime();
    optionalCapabilitiesReady = agentRuntimeReady.then(async () => {
      try {
        await initializeOptionalCapabilities();
      } catch (error) {
        diagnosticBundleService?.record({
          source: "main",
          severity: "error",
          message: `Optional capabilities did not finish initializing: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }
    });
    void optionalCapabilitiesReady.catch((error) => {
      diagnosticBundleService?.record({
        source: "main",
        severity: "fatal",
        message: `Agent runtime did not finish initializing: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    });
    automationScheduler = new AutomationScheduler({
      store,
      onEvent: publishAutomationEvent,
      notify: automationRunNotification,
      launch: async (automation, run, linkThread) => {
        const scheduledLabel = new Intl.DateTimeFormat(currentLocale(), {
          dateStyle: "short",
          timeStyle: "short",
          ...(automation.schedule.kind === "interval"
            ? {}
            : { timeZone: automation.schedule.timeZone }),
        }).format(new Date(run.scheduledFor));
        const thread = await createTaskThread(
          {
            projectId: automation.projectId,
            mode: automation.mode,
            target: automation.target,
          },
          `${automation.name} · ${scheduledLabel}`,
        );
        if (!thread) {
          throw new Error("Scheduled task creation was cancelled.");
        }
        linkThread(thread.id);
        await startTaskTurn({
          threadId: thread.id,
          text: automation.prompt,
          mode: automation.mode,
        });
      },
    });
    registerIpc();
    // Multi-question UI seeding runs here (not with the earlier fixture
    // block) because the real broker handlers need a live agentProcess; it
    // still precedes createMainWindow so the renderer replays the seeded
    // cards from the store on first load.
    await seedSmokeMultiQuestionUiFixture();
    mainWindow = createMainWindow();
    markStartupStage("window-created");
    releaseUpdateReady = releaseUpdateManager.initialize();
    void releaseUpdateReady.then(
      () => markStartupStage("update-ready"),
      (error) => {
        diagnosticBundleService?.record({
          source: "main",
          severity: "error",
          message: `Update recovery did not finish initializing: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      },
    );
    automationScheduler.start();
    mainWindow.webContents.once("did-finish-load", () => {
      void releaseUpdateReady
        .then(async () => {
          await releaseUpdateManager?.markHealthy();
          if (
            app.isPackaged &&
            releaseUpdateManager?.getStatus().state !== "disabled"
          ) {
            setTimeout(() => {
              void releaseUpdateManager?.check().catch((error) => {
                diagnosticBundleService?.record({
                  source: "main",
                  severity: "warning",
                  message: `Background update check failed: ${
                    error instanceof Error ? error.message : String(error)
                  }`,
                });
              });
            }, 5_000);
          }
        })
        .catch(() => undefined);
    });

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow();
      }
    });
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Artemis startup failed.", error);
    if (!smokeMode) {
      dialog.showErrorBox("Artemis failed to start", message);
    }
    app.exit(1);
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  for (const pending of pendingUserInputs.cancelWhere(() => true)) {
    if (pending.value.timeout !== undefined) {
      clearTimeout(pending.value.timeout);
    }
  }
  for (const pending of pendingMultiUserInputs.cancelWhere(() => true)) {
    for (const timeout of pending.value.timeouts.values()) {
      clearTimeout(timeout);
    }
  }
  automationScheduler?.stop();
  stopAgentCapacityMonitoring();
  terminalService?.dispose();
  if (packagedNodePtyRuntimeReady) {
    void packagedNodePtyRuntimeReady.then(
      () => packagedNodePtyRuntime?.dispose(),
      () => undefined,
    );
  }
  void mcpClientManager?.dispose();
  agentProcess?.dispose();
  store?.close();
});
