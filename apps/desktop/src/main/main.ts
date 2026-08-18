import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
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
  nativeTheme,
  net,
  Notification,
  safeStorage,
  session as electronSession,
  shell,
  type WebContents,
} from "electron";
import electronUpdater from "electron-updater";
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
  Project,
  ProviderConnection,
  RiskLevel,
  ShellRuntimeConfiguration,
  TaskWorktree,
  Thread,
  ThreadCommand,
  UserInputResolution,
} from "@artemis/protocol";

import {
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
  providerConnectionSchema,
  reviewMutationInputSchema,
  reviewQuerySchema,
  runModeSchema,
  shellRuntimeConfigurationSchema,
  threadCommandSchema,
  userInputRequestedPayloadSchema,
  userInputResolutionSchema,
  worktreeCommandSchema,
} from "@artemis/protocol";

import { AgentProcess } from "./agent-process.js";
import {
  AgentCapacityController,
  type AgentCapacityChange,
  currentAgentCapacityHardware,
  reclaimableMemoryPercent,
  SystemCpuSampler,
} from "./agent-capacity-controller.js";
import { partitionAgentHostEvents } from "./agent-event-routing.js";
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
  PendingUserInputRegistry,
  USER_INPUT_TIMEOUT_MILLISECONDS,
} from "./user-input-policy.js";
import {
  externalHttpUrl,
  isRendererNavigationAllowed,
} from "./navigation-policy.js";
import { OfficeDocumentService } from "./office-document-service.js";
import {
  deletePiSessionTranscript,
  piSessionsRoot,
} from "./pi-session-delete.js";
import { loadPromptAttachments } from "./prompt-attachments.js";
import {
  commitProjectChanges,
  createGitBranch,
  inspectGitBranches,
  pushProjectBranch,
  switchGitBranch,
} from "./git-branches.js";
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
  filterVisibleModels,
  loadBundledModelCatalog,
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
  type McpServerConfig,
  type ProjectGitInfo,
  type ProjectGitCommitResult,
  type ProjectGitPushResult,
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

interface PendingUserInput {
  workerRequestId: string;
  request: Extract<BrokerExecutionRequest, { kind: "user.input" }>;
  timeout: ReturnType<typeof setTimeout>;
}

let mainWindow: BrowserWindow | undefined;
let store: AppStore | undefined;
let agentProcess: AgentProcess | undefined;
let terminalService: TerminalService | undefined;
let packagedNodePtyRuntime: PreparedNodePtyRuntime | undefined;
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
let diagnosticBundleService: DiagnosticBundleService | undefined;
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
let runtimeToolCount = 0;
let runtimeMcpToolCount = 0;
let enabledMcpServerCount = 0;
const AGENT_RUNTIME_CONFIGURATION_TIMEOUT_MS = 120_000;
const MCP_REGISTRY_NPM_STARTUP_TIMEOUT_MS = 60_000;
const memoryStores = new Map<string, MemoryStore>();

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

async function agentConcurrencyStatus(): Promise<AgentConcurrencyStatus> {
  if (!agentCapacityController) {
    throw new Error("Agent capacity controller is not ready.");
  }
  if (agentProcess?.available) {
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
  const snapshot = await getSettingsSnapshot();
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
  return {
    selection: normalizeModelSelection(
      selection,
      selectedModel.reasoning,
      selectedModel.highestThinkingLevel,
    ),
    contextWindow: Math.min(
      addedModel?.contextWindow ??
        customProviderModel?.contextWindow ??
        snapshot.contextWindow,
      selectedModel.contextWindow,
    ),
  };
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

async function getSettingsSnapshot(): Promise<SettingsSnapshot> {
  try {
    await optionalCapabilitiesReady;
  } catch {
    // Settings remain useful even when the optional Agent runtime is offline.
  }
  if (
    !settingsStore ||
    !globalInstructionsStore ||
    !mcpConfigStore ||
    !mcpClientManager ||
    !trustedExtensionManager
  ) {
    throw new Error("Agent settings are not ready.");
  }
  const providers = await settingsStore.providerConnections();
  const credentials = await settingsStore.credentialSummaries();
  let catalog: AgentRuntimeCatalog = { models: [] };
  if (agentProcess) {
    try {
      if (!agentProcess.available) {
        throw new Error("Agent host is unavailable.");
      }
      catalog = await agentProcess.request<AgentRuntimeCatalog>({
        type: "runtime.catalog",
        requestId: randomUUID(),
      });
    } catch (error) {
      diagnosticBundleService?.record({
        source: "main",
        severity: "warning",
        message: `Settings opened without the Agent model catalog: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
  }
  if (catalog.models.length === 0) {
    try {
      catalog = {
        ...catalog,
        models: await loadBundledModelCatalog(),
      };
    } catch (error) {
      diagnosticBundleService?.record({
        source: "main",
        severity: "error",
        message: `Bundled model catalog could not be loaded: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
  }
  const contract = getPlatformContract();
  const addedModels = await settingsStore.addedModels();
  const configuredProviderIds = new Set(
    credentials.map((credential) => credential.providerId),
  );
  const modelsByKey = new Map<string, AgentModelInfo>();
  for (const model of catalog.models) {
    modelsByKey.set(`${model.providerId}\0${model.modelId}`, {
      ...model,
      configured:
        model.configured || configuredProviderIds.has(model.providerId),
    });
  }
  for (const provider of providers) {
    for (const model of provider.models) {
      modelsByKey.set(`${provider.id}\0${model.id}`, {
        providerId: provider.id,
        modelId: model.id,
        name: model.name,
        reasoning: model.reasoning,
        highestThinkingLevel: model.reasoning ? "high" : "off",
        contextWindow: model.contextWindow,
        configured: true,
      });
    }
  }
  const models = filterVisibleModels(
    [...modelsByKey.values()],
    providers.map((provider) => provider.id),
  );
  const persistedSelection = await settingsStore.modelSelection();
  const availableSelection = catalog.selection ?? persistedSelection;
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
    (await settingsStore.contextWindowPreference()) ??
    selectedModel?.contextWindow ??
    models[0]?.contextWindow ??
    128_000;
  const workspaceDockWidth = await settingsStore.workspaceDockWidth();
  return {
    platform: contract.platform,
    encryptionAvailable: settingsStore.encryptionAvailable,
    language: await settingsStore.languagePreference(),
    theme: await settingsStore.themePreference(),
    resolvedLocale: currentLocale(),
    approvalPolicy: await settingsStore.approvalPolicy(),
    localFullAccess: await settingsStore.localFullAccess(),
    shell: await settingsStore.shellRuntimeConfiguration(),
    fullAccessAvailable: contract.sandbox.available,
    contextWindow,
    models,
    addedModels,
    credentials,
    providers,
    mcpServers: await getMcpServerStatuses(),
    globalAgents: await globalInstructionsStore.snapshot(),
    trustedExtensions: trustedExtensionManager.status(),
    update: releaseUpdateManager?.getStatus() ?? {
      state: "disabled",
      currentVersion: app.getVersion(),
      rollbackAvailable: false,
    },
    agentConcurrency: await agentConcurrencyStatus(),
    ...(workspaceDockWidth === undefined ? {} : { workspaceDockWidth }),
    ...(selection ? { selection } : {}),
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
    await connectMcpServer(saved, true, connectionOptions);
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

function emitPayload(
  threadId: string,
  turnId: string | undefined,
  payload: AgentPayload,
): AgentEvent {
  if (!store) {
    throw new Error("Application store is not ready.");
  }
  observeTurnPayload(turnId, payload);
  const event = store.appendEvent(randomUUID(), threadId, turnId, payload);
  mainWindow?.webContents.send(IPC.agentEvent, event);
  applyPayloadSideEffects(threadId, payload);
  return event;
}

function emitPayloadBatch(events: readonly AgentHostEvent[]): AgentEvent[] {
  if (!store || events.length === 0) return [];
  const { durable: durableEvents, liveActivities } =
    partitionAgentHostEvents(events);
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
  }
  return persisted;
}

function emitInitialTurn(
  threadId: string,
  turnId: string,
  text: string,
  mode: StartTurnInput["mode"],
  attachments: PromptAttachment[],
): AgentEvent[] {
  if (!store) throw new Error("Application store is not ready.");
  const payloads: AgentPayload[] = [
    { type: "user.message", messageId: randomUUID(), text },
    ...attachments.map((attachment): AgentPayload => ({
      type: "task.source.added",
      sourceId: randomUUID(),
      name: attachment.name,
      mimeType: attachment.mimeType,
      kind: "type" in attachment ? "file" : "image",
    })),
    { type: "turn.started", mode },
  ];
  for (const payload of payloads) observeTurnPayload(turnId, payload);
  const result = store.appendEventsAndUpdateThread(
    threadId,
    payloads.map((payload) => ({
      eventId: randomUUID(),
      turnId,
      payload,
    })),
    { mode, status: "running" },
  );
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
  clearTimeout(resolved.value.timeout);
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
  const thread = store.getThread(request.threadId);
  if (
    !thread ||
    cancellingTurns.has(request.threadId) ||
    activeTurns.get(request.threadId) !== request.turnId ||
    thread.mode !== request.mode
  ) {
    rejectBrokerRequest(
      workerRequestId,
      request,
      "User input requires the active task turn.",
    );
    return;
  }
  const recommendedOption = request.options.findIndex(
    (option) => option.recommended,
  );
  if (
    request.options.length < 2 ||
    request.options.length > 3 ||
    recommendedOption < 0 ||
    request.options.filter((option) => option.recommended).length !== 1
  ) {
    rejectBrokerRequest(
      workerRequestId,
      request,
      "User input requires two or three options and one recommendation.",
    );
    return;
  }

  const nonce = randomUUID();
  const expiresAt = new Date(
    Date.now() + USER_INPUT_TIMEOUT_MILLISECONDS,
  ).toISOString();
  let payload: ReturnType<typeof userInputRequestedPayloadSchema.parse>;
  try {
    payload = userInputRequestedPayloadSchema.parse({
      type: "user-input.requested",
      requestId: request.approvalId,
      nonce,
      header: request.header,
      question: request.question,
      options: request.options,
      expiresAt,
    });
  } catch (error) {
    rejectBrokerRequest(
      workerRequestId,
      request,
      error instanceof Error ? error.message : "User input is invalid.",
    );
    return;
  }
  const timeout = setTimeout(() => {
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
      diagnosticBundleService?.record({
        source: "main",
        severity: "error",
        message:
          error instanceof Error
            ? error.message
            : "Timed-out user input could not be resolved.",
      });
    }
  }, USER_INPUT_TIMEOUT_MILLISECONDS);
  pendingUserInputs.register({
    requestId: request.approvalId,
    nonce,
    options: payload.options,
    value: { workerRequestId, request, timeout },
  });
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
    case "user.input":
      handleUserInputBrokerRequest(workerRequestId, request);
      return;
    case "shell.execute":
      await handleShellBrokerRequest(workerRequestId, request);
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
      : [];
  const automationResolution = createAutomationApproval(request, {
    summary: approvalSummary,
    network: networkTargets,
    risk: request.destructive ? "high" : "medium",
  });
  if (automationResolution && !request.destructive) {
    await executeApprovedMcp(workerRequestId, request, automationResolution);
    return;
  }
  const approvalPolicy = await settingsStore?.approvalPolicy();
  const fullAccessAvailable = getPlatformContract().sandbox.available;
  const rememberedScope =
    !request.destructive &&
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
    network: request.transport === "streamable-http",
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
    request.destructive ? ["once"] : ["once", "session", "project"],
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

async function startTaskTurn(input: StartTurnInput): Promise<StartTurnResult> {
  const mainReceivedAt = Date.now();
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
  const text = input.text.trim();
  const attachments = promptAttachmentsSchema.parse(input.attachments ?? []);
  if (!text && attachments.length === 0) {
    throw new Error("Prompt cannot be empty.");
  }
  const requestText =
    text || `Inspect the attached file${attachments.length === 1 ? "" : "s"}.`;
  if (isAutomaticTaskTitle(thread.title)) {
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
    emitInitialTurn(thread.id, turnId, requestText, input.mode, attachments);
  } catch (error) {
    trace.completedAt = Date.now();
    trace.outcome = "failed";
    finalizeTurnLatency(trace);
    throw error;
  }
  activeTurns.set(thread.id, turnId);

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

  await agentProcess.request({
    type,
    requestId: randomUUID(),
    threadId: thread.id,
    text: command.text,
    ...(command.attachments?.length
      ? { attachments: command.attachments }
      : {}),
  });
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

  return agentProcess.request({
    type,
    requestId: randomUUID(),
    threadId: thread.id,
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
    return { ...snapshot, userName: userInfo().username };
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
    return releaseUpdateManager.check();
  });
  ipcMain.handle(IPC.updateInstall, async () => {
    if (!releaseUpdateManager) {
      throw new Error("Update service is not ready.");
    }
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
      if (
        !customProviderExists &&
        store
          ?.listThreads()
          .some(
            (thread) =>
              thread.modelSelection?.providerId === target.providerId &&
              thread.modelSelection.modelId === target.modelId,
          )
      ) {
        throw new Error(
          "Switch conversations using this model before deleting it.",
        );
      }
      const removesActiveSelection =
        deletesActiveModel && !customProviderExists;
      if (removesActiveSelection && activeTurns.size > 0) {
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

      if (removesActiveSelection) {
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

        if (replacement) {
          configuration.selection = replacement.selection;
          configuration.contextWindow = replacement.contextWindow;
        } else {
          delete configuration.selection;
          delete configuration.contextWindow;
          await resetAgentThreadsForToolChange();
        }
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
      if (
        store
          ?.listThreads()
          .some((thread) => thread.modelSelection?.providerId === provider.id)
      ) {
        throw new Error(
          "Switch conversations using this provider before deleting it.",
        );
      }

      const configuration = await settingsStore.runtimeConfiguration();
      configuration.providers = (configuration.providers ?? []).filter(
        (candidate) => candidate.id !== provider.id,
      );
      delete configuration.credentials[provider.id];

      const deletesActiveProvider =
        configuration.selection?.providerId === provider.id;
      let replacement:
        { selection: ModelSelection; contextWindow: number } | undefined;
      if (deletesActiveProvider) {
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

        if (replacement) {
          configuration.selection = replacement.selection;
          configuration.contextWindow = replacement.contextWindow;
        } else {
          delete configuration.selection;
          delete configuration.contextWindow;
          await resetAgentThreadsForToolChange();
        }
      }

      await applyAgentRuntime(configuration);
      await settingsStore.deleteProviderConnection(provider.id, replacement);
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
    const context = await resolveThreadWorkspace(thread);
    const contract = getPlatformContract();
    const shellConfiguration = await settingsStore.shellRuntimeConfiguration();
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
    (_event, projectId: string): Promise<ProjectGitInfo> =>
      inspectGitBranches(projectForGitRequest(projectId).path),
  );

  ipcMain.handle(
    IPC.projectGitBranchSwitch,
    (
      _event,
      projectId: string,
      branchName: string,
    ): Promise<ProjectGitInfo> => {
      const project = projectForGitRequest(projectId);
      assertProjectGitMutationAllowed(project.id);
      return switchGitBranch(project.path, String(branchName ?? ""));
    },
  );

  ipcMain.handle(
    IPC.projectGitBranchCreate,
    (
      _event,
      projectId: string,
      branchName: string,
    ): Promise<ProjectGitInfo> => {
      const project = projectForGitRequest(projectId);
      assertProjectGitMutationAllowed(project.id);
      return createGitBranch(project.path, String(branchName ?? ""));
    },
  );

  ipcMain.handle(
    IPC.projectGitCommit,
    (
      _event,
      projectId: string,
      message: string,
      includeUnstaged: boolean,
    ): Promise<ProjectGitCommitResult> => {
      const project = projectForGitRequest(projectId);
      assertProjectGitMutationAllowed(project.id);
      if (typeof includeUnstaged !== "boolean") {
        throw new Error("Include-unstaged selection is invalid.");
      }
      return commitProjectChanges(project.path, message, includeUnstaged);
    },
  );

  ipcMain.handle(
    IPC.projectGitPush,
    (_event, projectId: string): Promise<ProjectGitPushResult> => {
      const project = projectForGitRequest(projectId);
      assertProjectGitMutationAllowed(project.id);
      return pushProjectBranch(project.path);
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
    IPC.threadGoal,
    (_event, threadId: string, goal: string | null): Thread => {
      if (!store) {
        throw new Error("Application store is not ready.");
      }
      const command = parseThreadCommand({
        type: "thread.goal",
        threadId,
        goal,
      });
      if (!store.getThread(command.threadId)) {
        throw new Error(`Thread not found: ${command.threadId}`);
      }
      return store.updateThread(command.threadId, { goal: command.goal });
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
      openedThreads.delete(threadId);
      store.deleteThread(threadId);
      if (!thread.projectId) {
        try {
          await removeTemporaryConversationWorkspace(
            app.getPath("userData"),
            thread.id,
          );
        } catch (error) {
          diagnosticBundleService?.record({
            source: "main",
            severity: "warning",
            message: `Temporary workspace cleanup failed for deleted thread ${threadId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          });
        }
      }
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
      const command = parseThreadCommand({
        type: "thread.fork",
        threadId,
        ...(entryId ? { entryId } : {}),
      });
      const source = store.getThread(command.threadId);
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
      if (forkedThread.target === "local") {
        if (!source.projectId) {
          try {
            await copyTemporaryConversationWorkspace(
              app.getPath("userData"),
              source.id,
              forkedThread.id,
            );
            return store.createForkedThread(forkedThread, source.id);
          } catch (error) {
            try {
              await removeTemporaryConversationWorkspace(
                app.getPath("userData"),
                forkedThread.id,
              );
            } catch (cleanupError) {
              throw new AggregateError(
                [error, cleanupError],
                "Temporary conversation fork failed and its copied workspace could not be removed.",
              );
            }
            throw error;
          }
        }
        return store.createForkedThread(forkedThread, source.id);
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
        return store.createForkedThreadWithWorktree(
          forkedThread,
          worktree,
          source.id,
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

  ipcMain.handle(IPC.turnCancel, async (_event, threadId: string) => {
    if (!agentProcess || !store) {
      throw new Error("Application is not ready.");
    }
    const command = parseThreadCommand({
      type: "turn.cancel",
      threadId,
    });
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
      clearTimeout(cancelled.value.timeout);
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
  });

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
    (_event, resolution: UserInputResolution) =>
      completeUserInput(userInputResolutionSchema.parse(resolution), "user"),
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

function seedSmokeTokenUsageFixture(): void {
  if (!store || process.env.ARTEMIS_SMOKE_VIEW !== "token-usage") return;
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
      inputTokens: 3_000,
      outputTokens: 400,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 3_400,
    },
    {
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

async function seedSmokeEnvironmentFixture(): Promise<void> {
  if (!store || !process.env.ARTEMIS_SMOKE_VIEW?.startsWith("environment")) {
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
  await writeFile(
    join(workspace, "README.md"),
    "# Artemis environment fixture\n\nUpdated line\nSecond line\n",
    "utf8",
  );
  await writeFile(join(workspace, "设计说明.md"), "任务环境面板\n", "utf8");
  if (process.env.ARTEMIS_SMOKE_VIEW === "environment-push-execute") {
    await git("add", "--all", "--");
    await git("commit", "-m", "Ahead fixture");
  }

  store.upsertProject({
    id: projectId,
    name: "Artemis 环境面板",
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
    status: "idle",
    pinned: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
  });
  type SmokeEnvironmentEvent = { id: string; payload: AgentPayload };
  const events: SmokeEnvironmentEvent[] = [
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
        ] satisfies SmokeEnvironmentEvent[])),
  ];
  for (const event of events) {
    store.appendEvent(event.id, threadId, turnId, event.payload);
  }
}

function createMainWindow(): BrowserWindow {
  const smokeScreenshot = process.env.ARTEMIS_SMOKE_SCREENSHOT;
  const smokeAccessibility = process.env.ARTEMIS_SMOKE_ACCESSIBILITY;
  const requestedSmokeWidth = Number(process.env.ARTEMIS_SMOKE_WINDOW_WIDTH);
  const requestedSmokeResizeWidth = Number(
    process.env.ARTEMIS_SMOKE_RESIZE_WIDTH,
  );
  const smokeWidth =
    smokeMode && Number.isFinite(requestedSmokeWidth)
      ? Math.max(980, Math.min(2_000, Math.round(requestedSmokeWidth)))
      : 1_420;
  const requestedScale = Number(process.env.ARTEMIS_SMOKE_SCALE ?? "1");
  const smokeScale = [1, 1.25, 1.5].includes(requestedScale)
    ? requestedScale
    : 1;
  const window = new BrowserWindow({
    width: smokeWidth,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: windowBackgroundColor(),
    title: "Artemis",
    show: false,
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
  if (smokeMode) {
    window.webContents.setZoomFactor(smokeScale);
  }
  window.once("ready-to-show", () => {
    if (smokeScreenshot) {
      window.setPosition(-10_000, -10_000);
      window.showInactive();
    } else {
      window.show();
    }
  });
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
      if (!isEmbeddedBrowserNavigationAllowed(params.src ?? "")) {
        event.preventDefault();
      }
    },
  );
  window.webContents.on("did-attach-webview", (_event, guest) => {
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
      const requestedSmokeView = process.env.ARTEMIS_SMOKE_VIEW;
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
                  if (view === 'environment-agents') {
                    const popover = document.querySelector('.environment-popover');
                    if (popover) popover.scrollTop = 220;
                    await wait(500);
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
                  if (view === 'environment-dock' || view === 'environment-dock-open') {
                    document.querySelector('.right-sidebar-toggle')?.click();
                    await wait(600);
                  }
                  if (view === 'environment-dock-open') {
                    document.querySelector('.environment-trigger')?.click();
                    await wait(500);
                  }
                  return;
                }
                if (view.startsWith('temporary')) {
                  document
                    .querySelector('.temporary-conversations .project-select')
                    ?.click();
                  await wait(600);
                  if (view === 'temporary-dock') {
                    document.querySelector('.right-sidebar-toggle')?.click();
                    await wait(500);
                  }
                  return;
                }
                if (view === 'token-usage') {
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
                  }
                }
              })()
            `)
          : Promise.resolve();
      const settleDelay =
        process.env.ARTEMIS_SMOKE_USER_INPUT || requestedSmokeView
          ? 1_500
          : 500;
      void prepareSmokeView
        .then(() => new Promise((resolve) => setTimeout(resolve, settleDelay)))
        .then(async () => {
          if (smokeScreenshot) {
            const image = await window.webContents.capturePage();
            await writeFile(smokeScreenshot, image.toPNG());
          }
          if (smokeAccessibility) {
            const result = (await window.webContents.executeJavaScript(`
              (() => {
                const issues = [];
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
                  "button, a[href], [role='button'], [role='tab']",
                )) {
                  const usesRovingTabIndex =
                    element.getAttribute("role") === "option" &&
                    element
                      .closest("[role='listbox']")
                      ?.querySelector("[role='option'][tabindex='0']");
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
                  ".environment-popover",
                );
                const environmentBounds = environmentPanel
                  ?.getBoundingClientRect();
                const conversation = document.querySelector(".conversation");
                const conversationBounds = conversation
                  ?.getBoundingClientRect();
                const workspaceDock = document.querySelector(
                  ".workspace-tool-dock",
                );
                const workspaceDockBounds = workspaceDock
                  ?.getBoundingClientRect();
                if (
                  environmentPanel &&
                  environmentBounds &&
                  conversation &&
                  conversationBounds &&
                  visible(environmentPanel) &&
                  visible(conversation) &&
                  conversationBounds.right > environmentBounds.left + 1
                ) {
                  issues.push({
                    rule: "environment-conversation-overlap",
                    element: ".conversation",
                  });
                }
                return {
                  documentLanguage: document.documentElement.lang,
                  documentDirection: document.documentElement.dir,
                  title: document.title,
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
                  interactiveCount: document.querySelectorAll(
                    "button, a[href], input, select, textarea, [role='button'], [role='tab']",
                  ).length,
                  issues,
                };
              })()
            `)) as Record<string, unknown>;
            await writeFile(
              smokeAccessibility,
              `${JSON.stringify({ ...result, zoomFactor: smokeScale }, undefined, 2)}\n`,
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
    store = new AppStore(join(app.getPath("userData"), "artemis.sqlite"));
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
    applyNativeTheme(await settingsStore.themePreference());
    languagePreference = await settingsStore.languagePreference();
    resolvedLocalePreference = resolveAppLocale(
      languagePreference,
      app.getPreferredSystemLanguages(),
    );
    configureBrowserLocaleSession();
    await seedSmokeEnvironmentFixture();
    seedSmokeUserInputFixture();
    seedSmokeTokenUsageFixture();
    mcpConfigStore = new McpConfigStore(
      join(app.getPath("userData"), "mcp.json"),
    );
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
    await releaseUpdateManager.initialize();
    if (process.platform === "darwin" && app.isPackaged) {
      if (process.arch !== "arm64" && process.arch !== "x64") {
        throw new Error(
          `Packaged terminals do not support macOS ${process.arch}.`,
        );
      }
      packagedNodePtyRuntime = await preparePackagedNodePtyRuntime(
        join(
          process.resourcesPath,
          "app.asar.unpacked",
          "node_modules",
          "node-pty",
        ),
        process.arch,
      );
      configureNodePtyRuntime(packagedNodePtyRuntime.moduleRoot);
    } else {
      configureNodePtyRuntime();
    }
    terminalService = new TerminalService(process.platform, {
      onData(terminalId, data) {
        mainWindow?.webContents.send(IPC.terminalData, { terminalId, data });
      },
      onExit(event) {
        mainWindow?.webContents.send(IPC.terminalExit, event);
      },
    });
    const codexRuntimeRoot = codexPrimaryRuntimePath();
    agentProcess = new AgentProcess(
      join(import.meta.dirname, "agent-worker.js"),
      {
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
        },
      },
      {
        ...(codexRuntimeRoot ? { codexRuntimeRoot } : {}),
        agentConcurrencyLimit: agentCapacityController.limit,
      },
    );
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
          timeZone: automation.schedule.timeZone,
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
    mainWindow = createMainWindow();
    automationScheduler.start();
    mainWindow.webContents.once("did-finish-load", () => {
      void releaseUpdateManager?.markHealthy();
      if (
        app.isPackaged &&
        releaseUpdateManager?.getStatus().state !== "disabled"
      ) {
        setTimeout(() => {
          void releaseUpdateManager?.check();
        }, 5_000);
      }
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
    clearTimeout(pending.value.timeout);
  }
  automationScheduler?.stop();
  stopAgentCapacityMonitoring();
  terminalService?.dispose();
  void packagedNodePtyRuntime?.dispose();
  void mcpClientManager?.dispose();
  agentProcess?.dispose();
  store?.close();
});
