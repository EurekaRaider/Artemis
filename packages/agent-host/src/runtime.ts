import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import {
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  createAgentSession,
  defineTool,
  estimateTokens,
  formatSkillsForPrompt,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { Type } from "@sinclair/typebox";
import type { TSchema } from "@sinclair/typebox";
import { resolveWorkspacePath } from "@artemis/platform";
import {
  AGENT_CONCURRENCY_FALLBACK,
  AGENT_CONCURRENCY_MAXIMUM,
  AGENT_CONCURRENCY_MINIMUM,
  AGENT_TEAM_LOGICAL_MAXIMUM,
  AGENT_TEAM_MAXIMUM_DEPTH,
  AGENT_TEAM_MAXIMUM_DIRECT_CHILDREN,
  AGENT_TEAM_SPAWN_BUDGET,
  OFFICE_DOCUMENT_PROTOCOL_VERSION,
  PiAdapter,
  officeDocumentRequestSchema,
  type AgentPayload,
  type AgentTeamMessagePayload,
  type AgentTeamStatusPayload,
  type ChildAgentPayload,
  type AgentRuntimeCatalog,
  type AgentRuntimeConfiguration,
  type BrokerExecutionRequest,
  type ModelApprovalDecision,
  type McpToolCallResult,
  type McpToolResultContent,
  type PromptAttachment,
  type PromptImage,
  type RunMode,
  type OfficeDocumentResult,
  type WorkspaceTarget,
} from "@artemis/protocol";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

import { modeInstruction } from "./mode-instructions.js";
import { toPiProviderConfig } from "./provider-configuration.js";
import { forkPiSession } from "./session-fork.js";
import { deletePiSessionTranscript } from "./session-delete.js";
import { RuntimeCredentialStore } from "./runtime-credentials.js";
import {
  AgentConcurrencyLimiter,
  type AgentConcurrencyLease,
  type AgentConcurrencySnapshot,
} from "./agent-concurrency.js";
import {
  ObservedBashRegistry,
  type ObservedBashSnapshot,
} from "./observed-bash.js";
import {
  compactionSettingsForContextWindow,
  configureModelContextWindow,
} from "./context-window.js";
import { appendPromptFiles, buildTurnPrompt } from "./turn-prompt.js";
import { createResourceOverrides } from "./resource-overrides.js";
import { expandSkillInvocations } from "./skill-invocations.js";
import { resolveCodexWorkspaceDependencies } from "./codex-workspace-dependencies.js";
import { omitReasoningFromSession } from "./reasoning-persistence.js";
import {
  PromptCacheController,
  withPromptCacheController,
} from "./prompt-cache.js";
import { ArtemisShellRuntime } from "./shell-execution.js";

const MINIMUM_MCP_TEXT_BUDGET_BYTES = 1024;
const MAXIMUM_MCP_TEXT_BUDGET_BYTES = 2 * 1024 * 1024;
const FALLBACK_MCP_CONTEXT_WINDOW = 128 * 1024;

function mcpTextBudgetBytes(
  contextWindow?: number,
  currentContextTokens?: number | null,
): number {
  const window = contextWindow ?? FALLBACK_MCP_CONTEXT_WINDOW;
  const current =
    currentContextTokens ?? Math.floor(FALLBACK_MCP_CONTEXT_WINDOW * 0.5);
  const reserve = compactionSettingsForContextWindow(window).reserveTokens;
  const availableTokens = Math.max(0, window - current - reserve);
  return Math.min(
    MAXIMUM_MCP_TEXT_BUDGET_BYTES,
    Math.max(MINIMUM_MCP_TEXT_BUDGET_BYTES, availableTokens * 2),
  );
}

function truncateUtf8(value: string, maximumBytes: number): string {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength <= maximumBytes) return value;
  return bytes
    .subarray(0, maximumBytes)
    .toString("utf8")
    .replace(/\uFFFD$/u, "");
}

function truncateUtf8Tail(value: string, maximumBytes: number): string {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength <= maximumBytes) return value;
  return bytes
    .subarray(bytes.byteLength - maximumBytes)
    .toString("utf8")
    .replace(/^\uFFFD/u, "");
}

function prepareMcpToolContent(
  content: readonly McpToolResultContent[],
  contextWindow?: number,
  currentContextTokens?: number | null,
): {
  content: McpToolResultContent[];
  deliveredTextBytes: number;
  omittedTextBytes: number;
  truncated: boolean;
} {
  const maximumBytes = mcpTextBudgetBytes(contextWindow, currentContextTokens);
  const originalText = content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n");
  const originalTextBytes = Buffer.byteLength(originalText, "utf8");
  if (originalTextBytes <= maximumBytes) {
    return {
      content: content.length > 0 ? [...content] : [{ type: "text", text: "" }],
      deliveredTextBytes: originalTextBytes,
      omittedTextBytes: 0,
      truncated: false,
    };
  }

  let omittedTextBytes = originalTextBytes;
  let notice = "";
  let head = "";
  let tail = "";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    notice = `\n[MCP output truncated by Artemis: ${omittedTextBytes} UTF-8 bytes omitted to protect the remaining model context.]\n`;
    const bodyBudget = Math.max(
      0,
      maximumBytes - Buffer.byteLength(notice, "utf8"),
    );
    head = truncateUtf8(originalText, Math.ceil(bodyBudget * 0.6));
    tail = truncateUtf8Tail(originalText, Math.floor(bodyBudget * 0.4));
    const nextOmittedTextBytes = Math.max(
      0,
      originalTextBytes -
        Buffer.byteLength(head, "utf8") -
        Buffer.byteLength(tail, "utf8"),
    );
    if (nextOmittedTextBytes === omittedTextBytes) break;
    omittedTextBytes = nextOmittedTextBytes;
  }
  const text = `${head}${notice}${tail}`;
  const prepared: McpToolResultContent[] = [
    { type: "text", text },
    ...content.filter((block) => block.type === "image"),
  ];
  const deliveredTextBytes = Buffer.byteLength(text, "utf8");
  return {
    content: prepared,
    deliveredTextBytes,
    omittedTextBytes,
    truncated: true,
  };
}

type AgentSession = Awaited<ReturnType<typeof createAgentSession>>["session"];
type AgentSessionEvent = Parameters<
  Parameters<AgentSession["subscribe"]>[0]
>[0];
type SessionTool = AgentSession["agent"]["state"]["tools"][number];
type PromptOptions = NonNullable<Parameters<AgentSession["prompt"]>[1]>;
type SessionImage = NonNullable<PromptOptions["images"]>[number];

interface ContextFootprint {
  textBytes: number;
  imageBytes: number;
  imageCount: number;
  toolSchemaBytes: number;
  largestToolResultBytes: number;
}

interface ContextTokenBreakdown {
  systemPromptTokens: number;
  systemToolTokens: number;
  mcpToolTokens: number;
  customAgentTokens: number;
  memoryFileTokens: number;
  skillTokens: number;
  messageTokens: number;
  freeSpaceTokens: number;
  autocompactBufferTokens: number;
}

function estimateTextTokens(value: string): number {
  return Math.ceil(value.length / 4);
}

function contextFilesPrompt(
  files: readonly { path: string; content: string }[],
): string {
  if (files.length === 0) return "";
  return [
    "\n\n<project_context>\n\n",
    "Project-specific instructions and guidelines:\n\n",
    ...files.map(
      (file) =>
        `<project_instructions path="${file.path}">\n${file.content}\n</project_instructions>\n\n`,
    ),
    "</project_context>\n",
  ].join("");
}

function removeFirst(value: string, section: string): string {
  if (!section) return value;
  const index = value.indexOf(section);
  return index < 0
    ? value
    : `${value.slice(0, index)}${value.slice(index + section.length)}`;
}

function serializedToolSchemas(tools: readonly SessionTool[]): string {
  try {
    return JSON.stringify(
      tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      })),
    );
  } catch {
    return "";
  }
}

function estimateToolSchemaTokens(tools: readonly SessionTool[]): number {
  return tools.length === 0
    ? 0
    : estimateTextTokens(serializedToolSchemas(tools));
}

function normalizeContextTokenBreakdown(
  breakdown: ContextTokenBreakdown,
  totalTokens: number | null,
): ContextTokenBreakdown {
  if (totalTokens === null) return breakdown;
  const rawTotal =
    breakdown.systemPromptTokens +
    breakdown.systemToolTokens +
    breakdown.mcpToolTokens +
    breakdown.customAgentTokens +
    breakdown.memoryFileTokens +
    breakdown.skillTokens +
    breakdown.messageTokens;
  if (rawTotal === 0) return breakdown;

  const scale = totalTokens / rawTotal;
  const normalized: ContextTokenBreakdown = {
    systemPromptTokens: Math.floor(breakdown.systemPromptTokens * scale),
    systemToolTokens: Math.floor(breakdown.systemToolTokens * scale),
    mcpToolTokens: Math.floor(breakdown.mcpToolTokens * scale),
    customAgentTokens: Math.floor(breakdown.customAgentTokens * scale),
    memoryFileTokens: Math.floor(breakdown.memoryFileTokens * scale),
    skillTokens: Math.floor(breakdown.skillTokens * scale),
    messageTokens: Math.floor(breakdown.messageTokens * scale),
    freeSpaceTokens: breakdown.freeSpaceTokens,
    autocompactBufferTokens: breakdown.autocompactBufferTokens,
  };
  normalized.systemPromptTokens +=
    totalTokens -
    (normalized.systemPromptTokens +
      normalized.systemToolTokens +
      normalized.mcpToolTokens +
      normalized.customAgentTokens +
      normalized.memoryFileTokens +
      normalized.skillTokens +
      normalized.messageTokens);
  return normalized;
}

function usedContextTokens(breakdown: ContextTokenBreakdown): number {
  return (
    breakdown.systemPromptTokens +
    breakdown.systemToolTokens +
    breakdown.mcpToolTokens +
    breakdown.customAgentTokens +
    breakdown.memoryFileTokens +
    breakdown.skillTokens +
    breakdown.messageTokens
  );
}

function contextTokenBreakdown(
  hosted: HostedThread,
  totalTokens: number | null,
  contextWindow: number,
  estimatedMessageTokens?: number,
): ContextTokenBreakdown | undefined {
  const systemPrompt = hosted.session.systemPrompt;
  if (typeof systemPrompt !== "string") return undefined;

  const contextFiles =
    hosted.resourceLoader?.getAgentsFiles().agentsFiles ?? [];
  const skills = hosted.resourceLoader?.getSkills().skills ?? [];
  const projectInstructions = contextFilesPrompt(contextFiles);
  const skillPrompt = formatSkillsForPrompt(skills);
  const includedProjectInstructions = systemPrompt.includes(projectInstructions)
    ? projectInstructions
    : "";
  const includedSkillPrompt = systemPrompt.includes(skillPrompt)
    ? skillPrompt
    : "";
  const baseSystemPrompt = removeFirst(
    removeFirst(systemPrompt, includedProjectInstructions),
    includedSkillPrompt,
  );
  const tools = hosted.session.agent?.state?.tools ?? [];
  const mcpToolNames = hosted.mcpToolNames ?? new Set<string>();
  const systemTools = tools.filter((tool) => !mcpToolNames.has(tool.name));
  const mcpTools = tools.filter((tool) => mcpToolNames.has(tool.name));
  const messages = hosted.session.messages ?? [];
  const usedBreakdown: ContextTokenBreakdown = {
    systemPromptTokens: estimateTextTokens(baseSystemPrompt),
    systemToolTokens: estimateToolSchemaTokens(systemTools),
    mcpToolTokens: estimateToolSchemaTokens(mcpTools),
    customAgentTokens: 0,
    memoryFileTokens: estimateTextTokens(includedProjectInstructions),
    skillTokens: estimateTextTokens(includedSkillPrompt),
    messageTokens:
      estimatedMessageTokens ??
      messages.reduce((total, message) => total + estimateTokens(message), 0),
    freeSpaceTokens: 0,
    autocompactBufferTokens: 0,
  };
  const normalized = normalizeContextTokenBreakdown(
    usedBreakdown,
    // Pi's post-compaction estimate covers rebuilt messages only. Keep the
    // fixed prompt and tool estimates intact instead of scaling them into it.
    estimatedMessageTokens === undefined ? totalTokens : null,
  );
  const usedTokens = usedContextTokens(normalized);
  normalized.autocompactBufferTokens =
    compactionSettingsForContextWindow(contextWindow).reserveTokens;
  normalized.freeSpaceTokens = Math.max(
    0,
    contextWindow - usedTokens - normalized.autocompactBufferTokens,
  );
  return normalized;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function base64ByteLength(value: string): number {
  try {
    return Buffer.from(value, "base64").byteLength;
  } catch {
    return 0;
  }
}

function messageFootprint(message: unknown): {
  textBytes: number;
  imageBytes: number;
  imageCount: number;
} {
  const candidate = record(message);
  const content = candidate?.content;
  const blocks = Array.isArray(content)
    ? content
    : typeof content === "string"
      ? [{ type: "text", text: content }]
      : [];
  let textBytes = 0;
  let imageBytes = 0;
  let imageCount = 0;
  for (const value of blocks) {
    const block = record(value);
    if (!block) continue;
    if (block.type === "image" && typeof block.data === "string") {
      imageBytes += base64ByteLength(block.data);
      imageCount += 1;
    } else if (typeof block.text === "string") {
      textBytes += Buffer.byteLength(block.text, "utf8");
    } else if (typeof block.thinking === "string") {
      textBytes += Buffer.byteLength(block.thinking, "utf8");
    } else if (block.type === "toolCall") {
      textBytes += Buffer.byteLength(
        `${typeof block.name === "string" ? block.name : ""}${JSON.stringify(block.arguments ?? {})}`,
        "utf8",
      );
    }
  }
  return { textBytes, imageBytes, imageCount };
}

function contextFootprint(
  messages: readonly unknown[],
  tools: readonly SessionTool[],
): ContextFootprint {
  let textBytes = 0;
  let imageBytes = 0;
  let imageCount = 0;
  let largestToolResultBytes = 0;
  for (const message of messages) {
    const footprint = messageFootprint(message);
    textBytes += footprint.textBytes;
    imageBytes += footprint.imageBytes;
    imageCount += footprint.imageCount;
    const candidate = record(message);
    if (candidate?.role === "toolResult") {
      const metrics = record(record(candidate.details)?.metrics);
      const originalTextBytes =
        typeof metrics?.textBytes === "number" && metrics.textBytes >= 0
          ? metrics.textBytes
          : footprint.textBytes;
      const originalImageBytes =
        typeof metrics?.imageBytes === "number" && metrics.imageBytes >= 0
          ? metrics.imageBytes
          : footprint.imageBytes;
      largestToolResultBytes = Math.max(
        largestToolResultBytes,
        originalTextBytes + originalImageBytes,
      );
    }
  }
  const toolSchemaBytes = Buffer.byteLength(
    serializedToolSchemas(tools),
    "utf8",
  );
  return {
    textBytes,
    imageBytes,
    imageCount,
    toolSchemaBytes,
    largestToolResultBytes,
  };
}

function lastProviderInput(messages: readonly unknown[]):
  | {
      index: number;
      tokens: number;
    }
  | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = record(messages[index]);
    if (
      message?.role !== "assistant" ||
      message.stopReason === "aborted" ||
      message.stopReason === "error"
    ) {
      continue;
    }
    const usage = record(message.usage);
    if (typeof usage?.input === "number" && usage.input >= 0) {
      return { index, tokens: Math.round(usage.input) };
    }
  }
  return undefined;
}

const modelApprovalParameter = Type.Object(
  {
    risk: Type.Union(
      [Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")],
      {
        description:
          "Classify the exact operation: low is read-only without external side effects; medium is scoped, reversible project or temporary-state change; high is destructive, security-sensitive, broad, privileged, sensitive-data access, or an external commitment.",
      },
    ),
    explicit_user_request: Type.Boolean({
      description:
        "Use true only when the user's current request directly and unambiguously authorizes this exact action and target. General goals, inferred steps, prior unrelated approvals, and scope changes are false.",
    }),
    reason: Type.String({
      minLength: 1,
      maxLength: 500,
      description: "Concise reason for the model's approval decision.",
    }),
  },
  { additionalProperties: false },
);

function modelApproval(decision: {
  risk: ModelApprovalDecision["risk"];
  explicit_user_request: boolean;
  reason: string;
}): ModelApprovalDecision {
  const reason = decision.reason.trim();
  if (!reason) throw new Error("A model approval reason is required.");
  return {
    risk: decision.risk,
    explicitUserRequest: decision.explicit_user_request,
    reason,
  };
}

function toSessionImages(
  attachments: PromptAttachment[] | undefined,
): SessionImage[] | undefined {
  const images =
    attachments?.filter(
      (attachment): attachment is PromptImage => !("type" in attachment),
    ) ?? [];
  if (images.length === 0) {
    return undefined;
  }
  return images.map((attachment) => ({
    type: "image",
    data: attachment.data,
    mimeType: attachment.mimeType,
  }));
}

function containsMemoryCredential(value: string): boolean {
  return (
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/u.test(value) ||
    /\bAuthorization\s*:\s*Bearer\s+\S+/iu.test(value) ||
    /\b(?:api[_-]?key|password|secret|token)\s*[:=]\s*\S{8,}/iu.test(value) ||
    /\bsk-[a-z0-9_-]{16,}\b/iu.test(value)
  );
}

function isTransientMemory(title: string, content: string): boolean {
  const value = `${title}\n${content}`;
  return (
    /\b(?:current|today(?:'s)?|this run|right now)\b[\s\S]{0,48}\b\d+\b/iu.test(
      value,
    ) ||
    /\b(?:test count|passing tests|failed tests|elapsed time)\b/iu.test(value)
  );
}

function observedBashToolResult(snapshot: ObservedBashSnapshot) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(snapshot, null, 2) },
    ],
    details: snapshot,
  };
}

export interface BrokerResult {
  approved: boolean;
  data?: unknown;
  error?: string;
}

export interface AgentBroker {
  request(request: BrokerExecutionRequest): Promise<BrokerResult>;
}

export interface AgentHostSink {
  emit(
    threadId: string,
    turnId: string | undefined,
    payload: AgentPayload,
  ): void;
}

export interface OpenThreadRequest {
  threadId: string;
  workspacePath: string;
  target: WorkspaceTarget;
  sessionFile?: string;
}

interface HostedThread {
  threadId: string;
  workspacePath: string;
  target: WorkspaceTarget;
  session: AgentSession;
  resourceLoader: DefaultResourceLoader;
  currentTurnId: string | undefined;
  currentMode: RunMode | undefined;
  compacting: boolean;
  topLevelUserTurns: number;
  readTool: SessionTool;
  writeTool: SessionTool;
  mcpToolNames: Set<string>;
  delegatedTools: SessionTool[];
  executeTools: SessionTool[];
  childAgents: Map<string, ChildAgentExecution>;
  activeLeases: Map<string, AgentConcurrencyLease>;
  currentMission: string | undefined;
  team: AgentTeamExecution | undefined;
  interruptedTeamContext: string | undefined;
  recoveredQueueMessages: string[];
  deferredTurnCompletion: AgentPayload | undefined;
  launchChildAgent(input: LaunchChildAgentInput): ChildAgentExecution;
  adapter: PiAdapter | undefined;
  unsubscribe: () => void;
}

interface LaunchChildAgentInput {
  turnId: string;
  mode: RunMode;
  parentAgentId: string;
  depth: number;
  label: string;
  task: string;
  role: string;
  dependsOnAgentIds: string[];
  writePaths: string[];
  required: boolean;
  attempt: number;
  replacesAgentId?: string;
}

interface ChildAgentExecution extends LaunchChildAgentInput {
  agentId: string;
  status: ChildAgentPayload["status"];
  controller: AbortController;
  session?: AgentSession;
  createdAt: number;
  startedAt?: number;
  updatedAt: number;
  lastActivityAt: number;
  currentTool?: string;
  currentToolStartedAt?: number;
  output: string;
  error?: string;
  pendingSteers: string[];
  longestObservationMilliseconds: number;
  subtreeIntegrated: boolean;
  subtreeSummary?: string;
  done: Promise<void>;
  settle(): void;
}

interface AgentTeamExecution {
  teamId: string;
  turnId: string;
  mission: string;
  status: AgentTeamStatusPayload["status"];
  memberAgentIds: string[];
  requiredAgentIds: Set<string>;
  blockedAgentIds: Set<string>;
  messageSequence: number;
  messages: AgentTeamMessagePayload[];
  memberVersions: Map<string, number>;
  observers: Map<
    string,
    { messageSequence: number; memberVersions: Map<string, number> }
  >;
  spawnCount: number;
  updatedAt: number;
  version: number;
  waiters: Set<() => void>;
  error?: string;
}

export interface AgentTeamSnapshot {
  team: AgentTeamStatusPayload;
  members: ChildAgentSnapshot[];
  messages: AgentTeamMessagePayload[];
  observationExpired: boolean;
}

export interface ChildAgentSnapshot {
  agentId: string;
  label: string;
  parentAgentId: string;
  depth: number;
  subtreeStatus: NonNullable<ChildAgentPayload["subtreeStatus"]>;
  directChildCount: number;
  task: string;
  role: string;
  dependsOnAgentIds: string[];
  writePaths: string[];
  required: boolean;
  coordinationStatus?: NonNullable<ChildAgentPayload["coordinationStatus"]>;
  status: ChildAgentPayload["status"];
  health: "healthy" | "suspect" | "stalled";
  attempt: number;
  updatedAt: string;
  lastActivityAt: string;
  elapsedMilliseconds: number;
  observationExpired: boolean;
  startedAt?: string;
  currentTool?: string;
  currentToolStartedAt?: string;
  output?: string;
  error?: string;
}

const CHILD_MIN_SUSPECT_SILENCE_MILLISECONDS = 60_000;
const CHILD_CONTROL_OBSERVATION_MILLISECONDS = 5_000;
const ROOT_AGENT_ID = "parent";
const PROVIDER_BACKOFF_DEFAULT_MILLISECONDS = 2_000;
const PROVIDER_BACKOFF_MAX_MILLISECONDS = 5 * 60_000;

function retryAfterHeader(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as {
    headers?: { get?(name: string): string | null };
    response?: { headers?: { get?(name: string): string | null } };
    retryAfter?: string | number;
  };
  const direct = candidate.headers?.get?.("retry-after");
  const response = candidate.response?.headers?.get?.("retry-after");
  const retryAfter = direct ?? response ?? candidate.retryAfter;
  return retryAfter === undefined || retryAfter === null
    ? undefined
    : String(retryAfter);
}

export function providerRetryDelayMilliseconds(
  error: unknown,
  now = Date.now(),
): number | undefined {
  const message = error instanceof Error ? error.message : String(error);
  const header = retryAfterHeader(error);
  if (
    !header &&
    !/(?:\b429\b|rate.?limit|too many requests|retry-after)/iu.test(message)
  ) {
    return undefined;
  }
  const messageSeconds = message.match(
    /retry-after[^\d]{0,12}(\d+(?:\.\d+)?)/iu,
  )?.[1];
  const value = header ?? messageSeconds;
  let delay = PROVIDER_BACKOFF_DEFAULT_MILLISECONDS;
  if (value) {
    const seconds = Number(value);
    if (Number.isFinite(seconds)) {
      delay = seconds * 1_000;
    } else {
      const date = Date.parse(value);
      if (Number.isFinite(date)) delay = date - now;
    }
  }
  return Math.max(
    0,
    Math.min(PROVIDER_BACKOFF_MAX_MILLISECONDS, Math.ceil(delay)),
  );
}

function requestsInterruptedTeamContinuation(text: string): boolean {
  const request = text.trim();
  if (!request || request.length > 500) return false;
  if (
    /^(?:continue|resume|retry|restart|carry\s+on|pick\s+up)[.!?]*$/iu.test(
      request,
    ) ||
    /^(?:继续|接着|恢复|重试|续上|续做)[。！？.!?]*$/u.test(request)
  ) {
    return true;
  }
  const englishContinuation =
    /\b(?:continue|resume|retry|restart|carry\s+on|pick\s+up)\b/iu.test(
      request,
    ) &&
    /\b(?:previous|prior|interrupted|unfinished|team|task|work|where\s+we\s+left\s+off)\b/iu.test(
      request,
    );
  const chineseContinuation =
    /继续|接着|恢复|重试|续上|续做/u.test(request) &&
    /刚才|之前|上次|中断|未完成|团队|任务|工作|做完|完成/u.test(request);
  return englishContinuation || chineseContinuation;
}

function terminalAgentStopReason(
  event: AgentSessionEvent,
): "error" | "aborted" | undefined {
  if (event.type !== "agent_end" || event.willRetry) return undefined;
  for (let index = event.messages.length - 1; index >= 0; index -= 1) {
    const message = event.messages[index];
    if (message?.role !== "assistant") continue;
    return message.stopReason === "error" || message.stopReason === "aborted"
      ? message.stopReason
      : undefined;
  }
  return undefined;
}

function isTerminalChildStatus(status: ChildAgentPayload["status"]): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "blocked" ||
    status === "cancelled"
  );
}

function isTerminalChildExecution(child: ChildAgentExecution): boolean {
  return isTerminalChildStatus(child.status);
}

function normalizedWritePaths(
  workspacePath: string,
  paths: string[],
): string[] {
  const workspaceRoot = resolveWorkspacePath(workspacePath, ".");
  const normalized = paths.map((path) => {
    const absolute = resolveWorkspacePath(workspacePath, path);
    const candidate = relative(workspaceRoot, absolute).replaceAll("\\", "/");
    return candidate || ".";
  });
  return [...new Set(normalized)].sort();
}

function writePathsOverlap(left: string, right: string): boolean {
  return (
    left === "." ||
    right === "." ||
    left === right ||
    left.startsWith(`${right}/`) ||
    right.startsWith(`${left}/`)
  );
}

function writePathAllowed(writePaths: string[], path: string): boolean {
  return writePaths.some(
    (scope) => scope === "." || path === scope || path.startsWith(`${scope}/`),
  );
}

function piSessionDirectory(workspacePath: string, agentDir: string): string {
  const resolvedWorkspace = resolve(workspacePath);
  const encodedWorkspace = `--${resolvedWorkspace
    .replace(/^[/\\]/u, "")
    .replace(/[/\\:]/gu, "-")}--`;
  return join(agentDir, "sessions", encodedWorkspace);
}

function replayDraftSessionEntries(
  entries: SessionEntry[],
  target: SessionManager,
): void {
  const supportedTypes = new Set([
    "message",
    "thinking_level_change",
    "model_change",
    "custom",
    "custom_message",
    "session_info",
  ]);
  const unsupported = entries.find((entry) => !supportedTypes.has(entry.type));
  if (unsupported) {
    throw new Error(
      `Cannot persist a draft Pi session containing ${unsupported.type} entries.`,
    );
  }
  for (const entry of entries) {
    switch (entry.type) {
      case "message":
        target.appendMessage(entry.message as never);
        break;
      case "thinking_level_change":
        target.appendThinkingLevelChange(entry.thinkingLevel);
        break;
      case "model_change":
        target.appendModelChange(entry.provider, entry.modelId);
        break;
      case "custom":
        target.appendCustomEntry(entry.customType, entry.data);
        break;
      case "custom_message":
        target.appendCustomMessageEntry(
          entry.customType,
          entry.content,
          entry.display,
          entry.details,
        );
        break;
      case "session_info":
        target.appendSessionInfo(entry.name ?? "");
        break;
    }
  }
}

function createLazySessionManager(
  workspacePath: string,
  agentDir: string,
  onPersist: (sessionFile: string) => void,
): SessionManager {
  let active = omitReasoningFromSession(SessionManager.inMemory(workspacePath));
  const sessionId = active.getSessionId();
  const persist = (): string => {
    if (active.isPersisted()) {
      const existing = active.getSessionFile();
      if (!existing) throw new Error("Persisted Pi session has no file.");
      return existing;
    }
    const entries = active.getEntries();
    const persisted = omitReasoningFromSession(
      SessionManager.create(
        workspacePath,
        piSessionDirectory(workspacePath, agentDir),
        { id: sessionId },
      ),
    );
    replayDraftSessionEntries(entries, persisted);
    active = persisted;
    const sessionFile = active.getSessionFile();
    if (!sessionFile) throw new Error("Pi did not create a session path.");
    return sessionFile;
  };

  return new Proxy(active, {
    get(_target, property) {
      if (property === "appendMessage") {
        return (
          message: Parameters<SessionManager["appendMessage"]>[0],
        ): string => {
          const sessionFile =
            !active.isPersisted() && message.role === "assistant"
              ? persist()
              : undefined;
          const entryId = active.appendMessage(message);
          if (sessionFile) onPersist(sessionFile);
          return entryId;
        };
      }
      const value = Reflect.get(active, property, active) as unknown;
      return typeof value === "function" ? value.bind(active) : value;
    },
  });
}

export class ArtemisAgentHost {
  private readonly threads = new Map<string, HostedThread>();
  private readonly credentials = new RuntimeCredentialStore();
  private readonly concurrency: AgentConcurrencyLimiter;
  private readonly shellRuntime: ArtemisShellRuntime;
  private readonly bashExecutions: ObservedBashRegistry;
  private readonly cancelledTurns = new Set<string>();
  private readonly userInputTails = new Map<string, Promise<void>>();
  private readonly registeredProviderIds = new Set<string>();
  private readonly providerAdmissionBlockedUntil = new Map<string, number>();
  private readonly promptCache = new PromptCacheController();
  private readonly agentDir: string;
  private readonly onSessionFile:
    ((threadId: string, path: string) => void) | undefined;
  private configuration: AgentRuntimeConfiguration = { credentials: {} };
  private modelRuntimePromise:
    ReturnType<typeof ModelRuntime.create> | undefined;

  private promptCacheUsage(
    sessionId: string,
    payload: Extract<AgentPayload, { type: "assistant.usage" }>,
  ): Extract<AgentPayload, { type: "assistant.usage" }> {
    this.promptCache.observeUsage(sessionId, payload);
    const cache = this.promptCache.latestResolution(sessionId);
    return {
      ...payload,
      ...(cache
        ? {
            cacheReadReported:
              payload.cacheReadReported ?? cache.cacheReadReported,
            cacheWriteReported:
              payload.cacheWriteReported ?? cache.cacheWriteReported,
            cachePolicy: cache.policy,
            cachePolicyReason: cache.reason,
            ...(cache.cacheKeyFingerprint
              ? { cacheKeyFingerprint: cache.cacheKeyFingerprint }
              : {}),
            systemPromptFingerprint: cache.systemPromptFingerprint,
            toolSchemaFingerprint: cache.toolSchemaFingerprint,
            stablePrefixTokens: cache.stablePrefixTokens,
            cacheKeyRequestsPerMinute: cache.cacheKeyRequestsPerMinute,
            cacheKeyRateWarning: cache.cacheKeyRateWarning,
          }
        : {}),
    };
  }

  constructor(
    private readonly broker: AgentBroker,
    private readonly sink: AgentHostSink,
    options: {
      agentConcurrencyLimit?: number;
      agentDir?: string;
      onSessionFile?: (threadId: string, path: string) => void;
    } = {},
  ) {
    this.shellRuntime = new ArtemisShellRuntime();
    this.bashExecutions = new ObservedBashRegistry(this.shellRuntime);
    this.agentDir = options.agentDir ?? getAgentDir();
    this.onSessionFile = options.onSessionFile;
    const limit = options.agentConcurrencyLimit ?? AGENT_CONCURRENCY_FALLBACK;
    this.concurrency = new AgentConcurrencyLimiter(
      limit,
      Math.max(1, limit - 1),
    );
  }

  setConcurrencyLimit(limit: number): AgentConcurrencySnapshot {
    if (
      !Number.isInteger(limit) ||
      limit < AGENT_CONCURRENCY_MINIMUM ||
      limit > AGENT_CONCURRENCY_MAXIMUM
    ) {
      throw new Error(
        `Agent concurrency limit must be an integer from ${AGENT_CONCURRENCY_MINIMUM} to ${AGENT_CONCURRENCY_MAXIMUM}.`,
      );
    }
    return this.concurrency.setLimits(limit, limit - 1);
  }

  concurrencyStatus(): AgentConcurrencySnapshot {
    return this.concurrency.snapshot;
  }

  private recordProviderBackoff(providerId: string, error: unknown): void {
    const delay = providerRetryDelayMilliseconds(error);
    if (delay === undefined) return;
    this.providerAdmissionBlockedUntil.set(
      providerId,
      Math.max(
        this.providerAdmissionBlockedUntil.get(providerId) ?? 0,
        Date.now() + delay,
      ),
    );
  }

  private async waitForProviderAdmission(
    providerId: string,
    signal?: AbortSignal,
    cancelled?: () => boolean,
  ): Promise<void> {
    while (true) {
      if (signal?.aborted || cancelled?.()) {
        throw signal?.reason ?? new DOMException("Aborted", "AbortError");
      }
      const blockedUntil = this.providerAdmissionBlockedUntil.get(providerId);
      const remaining = (blockedUntil ?? 0) - Date.now();
      if (remaining <= 0) {
        if (
          this.providerAdmissionBlockedUntil.get(providerId) === blockedUntil
        ) {
          this.providerAdmissionBlockedUntil.delete(providerId);
        }
        return;
      }
      await new Promise<void>((resolve, reject) => {
        const finish = () => {
          signal?.removeEventListener("abort", abort);
          resolve();
        };
        const timer = setTimeout(finish, Math.min(250, remaining));
        const abort = () => {
          clearTimeout(timer);
          reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
        };
        signal?.addEventListener("abort", abort, { once: true });
      });
    }
  }

  private async serializeUserInput<T>(
    threadId: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const previous = this.userInputTails.get(threadId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => gate);
    this.userInputTails.set(threadId, tail);
    await previous.catch(() => undefined);
    try {
      return await action();
    } finally {
      release();
      if (this.userInputTails.get(threadId) === tail) {
        this.userInputTails.delete(threadId);
      }
    }
  }

  private getModelRuntime(): ReturnType<typeof ModelRuntime.create> {
    this.modelRuntimePromise ??= ModelRuntime.create({
      credentials: this.credentials,
      allowModelNetwork: false,
    }).then((runtime) => withPromptCacheController(runtime, this.promptCache));
    return this.modelRuntimePromise;
  }

  async configure(configuration: AgentRuntimeConfiguration): Promise<void> {
    this.shellRuntime.configure(configuration.shell);
    this.credentials.replace(configuration.credentials);
    const resolvedConfiguration = structuredClone(configuration);
    const providers = resolvedConfiguration.providers ?? [];
    if (
      providers.length === 0 &&
      this.registeredProviderIds.size === 0 &&
      !resolvedConfiguration.selection
    ) {
      this.configuration = resolvedConfiguration;
      return;
    }
    const modelRuntime = await this.getModelRuntime();
    const nextProviderIds = new Set(providers.map((provider) => provider.id));
    for (const providerId of this.registeredProviderIds) {
      if (!nextProviderIds.has(providerId)) {
        modelRuntime.unregisterProvider(providerId);
        this.registeredProviderIds.delete(providerId);
      }
    }
    for (const provider of providers) {
      modelRuntime.registerProvider(
        provider.id,
        toPiProviderConfig(
          provider,
          Boolean(resolvedConfiguration.credentials[provider.id]),
        ),
      );
      this.registeredProviderIds.add(provider.id);
    }
    const selection = resolvedConfiguration.selection;
    if (!selection) {
      this.configuration = resolvedConfiguration;
      return;
    }
    const catalogModel = modelRuntime.getModel(
      selection.providerId,
      selection.modelId,
    );
    if (!catalogModel) {
      throw new Error(
        `Configured model is unavailable: ${selection.providerId}/${selection.modelId}`,
      );
    }
    if (selection.ultraMode) {
      selection.thinkingLevel =
        getSupportedThinkingLevels(catalogModel).at(-1) ?? "off";
    }
    this.configuration = resolvedConfiguration;
    const model = configureModelContextWindow(
      catalogModel,
      resolvedConfiguration.contextWindow,
    );
    for (const hosted of this.threads.values()) {
      await hosted.session.setModel(model);
      hosted.session.setThinkingLevel(selection.thinkingLevel);
      await hosted.resourceLoader.reload();
      hosted.session.setActiveToolsByName(hosted.session.getActiveToolNames());
      this.configureSessionCompaction(hosted.session);
      this.emitContextUsage(hosted, false);
    }
  }

  private configureSessionCompaction(session: AgentSession): void {
    const contextWindow = session.model?.contextWindow;
    if (!contextWindow) {
      return;
    }
    session.settingsManager.applyOverrides({
      compaction: compactionSettingsForContextWindow(contextWindow),
    });
  }

  private emitContextUsage(
    hosted: HostedThread,
    compacting: boolean,
    estimatedTokens?: number,
  ): void {
    const usage = hosted.session.getContextUsage();
    const contextWindow =
      usage?.contextWindow ?? hosted.session.model?.contextWindow;
    if (!contextWindow) {
      return;
    }
    const messages = hosted.session.messages ?? [];
    const providerInput = lastProviderInput(messages);
    const reportedTokens =
      estimatedTokens === undefined ? (usage?.tokens ?? null) : null;
    const estimatedMessageTokens =
      estimatedTokens === undefined
        ? undefined
        : Math.max(0, Math.round(estimatedTokens));
    const breakdown = contextTokenBreakdown(
      hosted,
      reportedTokens,
      contextWindow,
      estimatedMessageTokens,
    );
    const tokens =
      estimatedMessageTokens === undefined
        ? reportedTokens
        : breakdown
          ? usedContextTokens(breakdown)
          : estimatedMessageTokens;
    const source =
      estimatedTokens !== undefined
        ? "compaction-estimate"
        : tokens !== null && providerInput?.index === messages.length - 1
          ? "provider"
          : "local-estimate";
    this.sink.emit(hosted.threadId, hosted.currentTurnId, {
      type: "context.usage",
      tokens,
      contextWindow,
      compacting,
      source,
      ...(source === "provider" ? {} : { estimated: true }),
      ...(providerInput ? { providerInputTokens: providerInput.tokens } : {}),
      ...(breakdown ? { breakdown } : {}),
      footprint: contextFootprint(
        messages,
        hosted.session.agent?.state?.tools ?? [],
      ),
    });
  }

  private handleContextUsageEvent(
    hosted: HostedThread,
    event: AgentSessionEvent,
  ): void {
    if (event.type === "turn_end") {
      this.emitContextUsage(hosted, false);
    } else if (
      event.type === "message_end" &&
      event.message.role === "toolResult"
    ) {
      this.emitContextUsage(hosted, false);
    } else if (event.type === "compaction_start") {
      this.emitContextUsage(hosted, true);
    } else if (event.type === "compaction_end") {
      this.emitContextUsage(hosted, false, event.result?.estimatedTokensAfter);
    }
  }

  private childHealth(
    child: ChildAgentExecution,
  ): ChildAgentSnapshot["health"] {
    if (child.status === "failed" || child.status === "blocked") {
      return "stalled";
    }
    if (child.status === "cancelling") return "suspect";
    if (child.status !== "queued" && child.status !== "running") {
      return "healthy";
    }
    const suspectAfter = Math.max(
      CHILD_MIN_SUSPECT_SILENCE_MILLISECONDS,
      child.longestObservationMilliseconds * 2,
    );
    return Date.now() - child.lastActivityAt >= suspectAfter
      ? "suspect"
      : "healthy";
  }

  private requestChildCancellation(
    hosted: HostedThread,
    child: ChildAgentExecution,
  ): void {
    if (isTerminalChildStatus(child.status)) return;
    child.status = "cancelling";
    child.lastActivityAt = Date.now();
    child.controller.abort();
    this.bashExecutions.cancelScope({
      threadId: hosted.threadId,
      turnId: child.turnId,
      ownerId: child.agentId,
    });
    void child.session?.abort().catch(() => undefined);
    this.emitChild(hosted, child, {
      activityDelta: "\n[cancellation requested]\n",
    });
  }

  private descendantAgents(
    hosted: HostedThread,
    agentId: string,
  ): ChildAgentExecution[] {
    const descendants: ChildAgentExecution[] = [];
    const pending = [agentId];
    while (pending.length > 0) {
      const parentAgentId = pending.shift()!;
      for (const child of this.directChildren(hosted, parentAgentId)) {
        descendants.push(child);
        pending.push(child.agentId);
      }
    }
    return descendants;
  }

  private requestSubtreeCancellation(
    hosted: HostedThread,
    child: ChildAgentExecution,
  ): void {
    for (const descendant of this.descendantAgents(
      hosted,
      child.agentId,
    ).reverse()) {
      this.requestChildCancellation(hosted, descendant);
    }
    this.requestChildCancellation(hosted, child);
  }

  private directChildren(
    hosted: HostedThread,
    agentId: string,
  ): ChildAgentExecution[] {
    const currentMembers = new Set(hosted.team?.memberAgentIds ?? []);
    return [...hosted.childAgents.values()].filter(
      (candidate) =>
        candidate.parentAgentId === agentId &&
        currentMembers.has(candidate.agentId),
    );
  }

  private childSubtreeStatus(
    hosted: HostedThread,
    child: ChildAgentExecution,
  ): NonNullable<ChildAgentPayload["subtreeStatus"]> {
    const directChildren = this.directChildren(hosted, child.agentId);
    if (directChildren.length === 0) return "leaf";
    if (child.subtreeIntegrated) return "integrated";
    if (
      directChildren.some(
        (candidate) =>
          candidate.status === "failed" ||
          candidate.status === "blocked" ||
          candidate.status === "cancelled",
      )
    ) {
      return "blocked";
    }
    return directChildren.every(isTerminalChildExecution) ? "ready" : "running";
  }

  private childSnapshot(
    hosted: HostedThread,
    child: ChildAgentExecution,
    observationExpired = false,
  ): ChildAgentSnapshot {
    const now = Date.now();
    const coordinationStatus =
      child.status === "blocked"
        ? "blocked"
        : child.status === "completed"
          ? "ready-for-integration"
          : child.status === "running"
            ? "working"
            : child.dependsOnAgentIds.length > 0
              ? "waiting-dependency"
              : undefined;
    return {
      agentId: child.agentId,
      label: child.label,
      parentAgentId: child.parentAgentId,
      depth: child.depth,
      subtreeStatus: this.childSubtreeStatus(hosted, child),
      directChildCount: this.directChildren(hosted, child.agentId).length,
      task: child.task,
      role: child.role,
      dependsOnAgentIds: [...child.dependsOnAgentIds],
      writePaths: [...child.writePaths],
      required: child.required,
      ...(coordinationStatus ? { coordinationStatus } : {}),
      status: child.status,
      health: this.childHealth(child),
      attempt: child.attempt,
      updatedAt: new Date(child.updatedAt).toISOString(),
      lastActivityAt: new Date(child.lastActivityAt).toISOString(),
      elapsedMilliseconds: now - (child.startedAt ?? child.createdAt),
      observationExpired,
      ...(child.startedAt
        ? { startedAt: new Date(child.startedAt).toISOString() }
        : {}),
      ...(child.currentTool ? { currentTool: child.currentTool } : {}),
      ...(child.currentToolStartedAt
        ? {
            currentToolStartedAt: new Date(
              child.currentToolStartedAt,
            ).toISOString(),
          }
        : {}),
      ...(child.output ? { output: child.output } : {}),
      ...(child.error ? { error: child.error } : {}),
    };
  }

  private emitChild(
    hosted: HostedThread,
    child: ChildAgentExecution,
    extra:
      Pick<ChildAgentPayload, "activityDelta"> | Record<string, never> = {},
  ): void {
    child.updatedAt = Date.now();
    const snapshot = this.childSnapshot(hosted, child);
    this.sink.emit(hosted.threadId, child.turnId, {
      type: "child-agent.status",
      agentId: child.agentId,
      label: child.label,
      ...(hosted.team ? { teamId: hosted.team.teamId } : {}),
      parentAgentId: child.parentAgentId,
      depth: child.depth,
      subtreeStatus: snapshot.subtreeStatus,
      directChildCount: snapshot.directChildCount,
      role: child.role,
      dependsOnAgentIds: [...child.dependsOnAgentIds],
      writePaths: [...child.writePaths],
      required: child.required,
      coordinationStatus:
        child.status === "blocked"
          ? "blocked"
          : child.status === "completed"
            ? "ready-for-integration"
            : child.status === "running"
              ? "working"
              : child.dependsOnAgentIds.length > 0
                ? "waiting-dependency"
                : undefined,
      task: child.task,
      status: child.status,
      health: snapshot.health,
      attempt: child.attempt,
      updatedAt: snapshot.updatedAt,
      lastActivityAt: snapshot.lastActivityAt,
      ...(snapshot.startedAt ? { startedAt: snapshot.startedAt } : {}),
      ...(snapshot.currentTool ? { currentTool: snapshot.currentTool } : {}),
      ...(snapshot.currentToolStartedAt
        ? { currentToolStartedAt: snapshot.currentToolStartedAt }
        : {}),
      ...(snapshot.output && !("activityDelta" in extra)
        ? { output: snapshot.output }
        : {}),
      ...(snapshot.error ? { error: snapshot.error } : {}),
      ...extra,
    });
    if (hosted.team?.memberAgentIds.includes(child.agentId)) {
      hosted.team.memberVersions.set(
        child.agentId,
        (hosted.team.memberVersions.get(child.agentId) ?? 0) + 1,
      );
      this.refreshTeamStatus(hosted);
    }
  }

  private teamPayload(team: AgentTeamExecution): AgentTeamStatusPayload {
    return {
      type: "agent-team.status",
      teamId: team.teamId,
      mission: team.mission,
      status: team.status,
      memberAgentIds: [...team.memberAgentIds],
      requiredAgentIds: [...team.requiredAgentIds],
      maxMembers: AGENT_TEAM_LOGICAL_MAXIMUM,
      maxDepth: AGENT_TEAM_MAXIMUM_DEPTH,
      spawnBudgetRemaining: Math.max(
        0,
        AGENT_TEAM_SPAWN_BUDGET - team.spawnCount,
      ),
      updatedAt: new Date(team.updatedAt).toISOString(),
      ...(team.error ? { error: team.error } : {}),
    };
  }

  private notifyTeam(team: AgentTeamExecution): void {
    team.version += 1;
    for (const resolve of team.waiters) resolve();
    team.waiters.clear();
  }

  private emitTeam(hosted: HostedThread): void {
    const team = hosted.team;
    if (!team) return;
    team.updatedAt = Date.now();
    this.sink.emit(hosted.threadId, team.turnId, this.teamPayload(team));
    this.notifyTeam(team);
  }

  private refreshTeamStatus(hosted: HostedThread): void {
    const team = hosted.team;
    if (
      !team ||
      team.status === "completed" ||
      team.status === "aborted" ||
      team.status === "forming"
    ) {
      return;
    }
    const required = [...team.requiredAgentIds]
      .map((agentId) => hosted.childAgents.get(agentId))
      .filter((child): child is ChildAgentExecution => Boolean(child));
    const nextStatus =
      team.blockedAgentIds.size > 0 ||
      required.some(
        (child) =>
          child.status === "failed" ||
          child.status === "blocked" ||
          child.status === "cancelled",
      )
        ? "blocked"
        : required.length > 0 && required.every(isTerminalChildExecution)
          ? "integrating"
          : "running";
    if (team.status !== nextStatus) {
      team.status = nextStatus;
      this.emitTeam(hosted);
    } else {
      this.notifyTeam(team);
    }
  }

  private teamSnapshot(
    hosted: HostedThread,
    observationExpired = false,
    messages?: AgentTeamMessagePayload[],
    memberAgentIds?: string[],
  ): AgentTeamSnapshot {
    const team = hosted.team;
    if (!team) throw new Error("No active agent team is available.");
    return {
      team: this.teamPayload(team),
      members: (memberAgentIds ?? team.memberAgentIds)
        .map((agentId) => hosted.childAgents.get(agentId))
        .filter((child): child is ChildAgentExecution => Boolean(child))
        .map((child) => this.childSnapshot(hosted, child)),
      messages: messages ?? [...team.messages],
      observationExpired,
    };
  }

  private interruptedTeamSummary(hosted: HostedThread): string | undefined {
    const team = hosted.team;
    if (!team || team.status !== "aborted") return undefined;
    const members = team.memberAgentIds.flatMap((agentId) => {
      const child = hosted.childAgents.get(agentId);
      if (!child) return [];
      const priorProgress = (child.output || child.error || "")
        .trim()
        .slice(-1_500);
      return [
        [
          `- ${child.label} (${child.role}, ${child.status})`,
          `  Original task: ${child.task.slice(0, 2_000)}`,
          priorProgress ? `  Prior progress: ${priorProgress}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      ];
    });
    const messages = team.messages
      .slice(-12)
      .map(
        (message) =>
          `- ${message.fromAgentId} -> ${message.recipient} [${message.kind}]: ${message.content.slice(0, 1_000)}`,
      );
    return [
      `Mission: ${team.mission}`,
      members.length > 0 ? `Members:\n${members.join("\n")}` : "",
      messages.length > 0
        ? `Recent collaboration messages:\n${messages.join("\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, 16 * 1_024);
  }

  private requireChildAgent(
    threadId: string,
    agentId: string,
  ): { hosted: HostedThread; child: ChildAgentExecution } {
    const hosted = this.threads.get(threadId);
    const child = hosted?.childAgents.get(agentId);
    if (!hosted || !child) {
      throw new Error(`Sub-agent was not found: ${agentId}`);
    }
    return { hosted, child };
  }

  private async observeChild(
    child: ChildAgentExecution,
    observationMilliseconds: number,
  ): Promise<boolean> {
    if (isTerminalChildStatus(child.status)) return false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<"deadline">((resolve) => {
      timer = setTimeout(() => resolve("deadline"), observationMilliseconds);
    });
    const result = await Promise.race([
      child.done.then(() => "settled" as const),
      deadline,
    ]);
    if (timer) clearTimeout(timer);
    return result === "deadline" && !isTerminalChildStatus(child.status);
  }

  childAgentStatus(threadId: string, agentId: string): ChildAgentSnapshot {
    const { hosted, child } = this.requireChildAgent(threadId, agentId);
    this.emitChild(hosted, child);
    return this.childSnapshot(hosted, child);
  }

  async waitForChildAgent(
    threadId: string,
    agentId: string,
    deadlineSeconds: number,
  ): Promise<ChildAgentSnapshot> {
    if (
      !Number.isFinite(deadlineSeconds) ||
      deadlineSeconds < 1 ||
      deadlineSeconds > 300
    ) {
      throw new Error("Sub-agent observation deadline must be 1-300 seconds.");
    }
    const { hosted, child } = this.requireChildAgent(threadId, agentId);
    const observationMilliseconds = deadlineSeconds * 1_000;
    child.longestObservationMilliseconds = Math.max(
      child.longestObservationMilliseconds,
      observationMilliseconds,
    );
    const observationExpired = await this.observeChild(
      child,
      observationMilliseconds,
    );
    this.emitChild(hosted, child);
    return this.childSnapshot(hosted, child, observationExpired);
  }

  async steerChildAgent(
    threadId: string,
    agentId: string,
    text: string,
    notifyParent = false,
  ): Promise<ChildAgentSnapshot> {
    const { hosted, child } = this.requireChildAgent(threadId, agentId);
    if (isTerminalChildStatus(child.status) || child.status === "cancelling") {
      throw new Error(`Cannot steer a ${child.status} sub-agent.`);
    }
    const message = text.trim();
    if (!message)
      throw new Error("Sub-agent steering message cannot be empty.");
    child.lastActivityAt = Date.now();
    if (child.status === "queued" || !child.session) {
      child.pendingSteers.push(message);
    } else {
      await child.session.steer(message);
    }
    this.emitChild(hosted, child, {
      activityDelta: `\n[steered] ${message.slice(0, 1_000)}\n`,
    });
    if (notifyParent && hosted.currentTurnId) {
      void hosted.session
        .sendCustomMessage(
          {
            customType: "artemis-agent-control",
            content: `The user nudged sub-agent ${agentId} (${child.label}). Check its status and adjust the approach if needed.`,
            display: false,
            details: { action: "steer", agentId },
          },
          { deliverAs: "steer" },
        )
        .catch(() => undefined);
    }
    return this.childSnapshot(hosted, child);
  }

  async cancelChildAgent(
    threadId: string,
    agentId: string,
    notifyParent = false,
  ): Promise<ChildAgentSnapshot> {
    const { hosted, child } = this.requireChildAgent(threadId, agentId);
    if (!isTerminalChildStatus(child.status)) {
      this.requestSubtreeCancellation(hosted, child);
      await this.observeChild(child, CHILD_CONTROL_OBSERVATION_MILLISECONDS);
    }
    if (notifyParent && hosted.currentTurnId) {
      void hosted.session
        .sendCustomMessage(
          {
            customType: "artemis-agent-control",
            content: `Sub-agent ${agentId} (${child.label}) was stopped by the user. Do not keep waiting for it; continue with another approach.`,
            display: false,
            details: { action: "cancel", agentId },
          },
          { deliverAs: "steer" },
        )
        .catch(() => undefined);
    }
    return this.childSnapshot(hosted, child);
  }

  retryChildAgent(
    threadId: string,
    agentId: string,
    notifyParent = false,
  ): ChildAgentSnapshot {
    const { hosted, child } = this.requireChildAgent(threadId, agentId);
    if (!isTerminalChildStatus(child.status)) {
      throw new Error("Stop the sub-agent before retrying it.");
    }
    if (!hosted.currentTurnId || !hosted.currentMode) {
      throw new Error("A sub-agent can be retried only during an active task.");
    }
    const descendants = this.descendantAgents(hosted, child.agentId);
    for (const descendant of descendants) {
      this.requestChildCancellation(hosted, descendant);
    }
    const team = hosted.team;
    if (team && descendants.length > 0) {
      const discardedIds = new Set(
        descendants.map((descendant) => descendant.agentId),
      );
      team.memberAgentIds = team.memberAgentIds.filter(
        (memberAgentId) => !discardedIds.has(memberAgentId),
      );
      for (const discardedId of discardedIds) {
        team.requiredAgentIds.delete(discardedId);
        team.blockedAgentIds.delete(discardedId);
        team.memberVersions.delete(discardedId);
      }
      this.emitTeam(hosted);
    }
    const retried = hosted.launchChildAgent({
      turnId: hosted.currentTurnId,
      mode: hosted.currentMode,
      label: child.label,
      task: child.task,
      role: child.role,
      dependsOnAgentIds: [...child.dependsOnAgentIds],
      writePaths: [...child.writePaths],
      required: child.required,
      attempt: child.attempt + 1,
      parentAgentId: child.parentAgentId,
      depth: child.depth,
      replacesAgentId: child.agentId,
    });
    if (notifyParent) {
      void hosted.session
        .sendCustomMessage(
          {
            customType: "artemis-agent-control",
            content: `The user retried sub-agent ${agentId} as ${retried.agentId}. Monitor the new attempt instead of the old one.`,
            display: false,
            details: {
              action: "retry",
              agentId,
              replacementAgentId: retried.agentId,
            },
          },
          { deliverAs: "steer" },
        )
        .catch(() => undefined);
    }
    return this.childSnapshot(hosted, retried);
  }

  private ensureTeam(hosted: HostedThread): AgentTeamExecution {
    if (hosted.team) return hosted.team;
    if (!hosted.currentTurnId) {
      throw new Error("No active turn is available for an agent team.");
    }
    const now = Date.now();
    hosted.interruptedTeamContext = undefined;
    hosted.team = {
      teamId: randomUUID(),
      turnId: hosted.currentTurnId,
      mission: hosted.currentMission ?? "Complete the current task.",
      status: "forming",
      memberAgentIds: [],
      requiredAgentIds: new Set(),
      blockedAgentIds: new Set(),
      messageSequence: 0,
      messages: [],
      memberVersions: new Map(),
      observers: new Map(),
      spawnCount: 0,
      updatedAt: now,
      version: 0,
      waiters: new Set(),
    };
    this.emitTeam(hosted);
    return hosted.team;
  }

  private validateTeamWritePaths(
    hosted: HostedThread,
    agentId: string | undefined,
    paths: string[],
  ): string[] {
    const normalized = normalizedWritePaths(hosted.workspacePath, paths);
    const team = hosted.team;
    if (!team) return normalized;
    for (const otherAgentId of team.memberAgentIds) {
      if (otherAgentId === agentId) continue;
      const other = hosted.childAgents.get(otherAgentId);
      if (!other || isTerminalChildStatus(other.status)) continue;
      for (const path of normalized) {
        const overlap = other.writePaths.find((otherPath) =>
          writePathsOverlap(path, otherPath),
        );
        if (overlap) {
          throw new Error(
            `Write scope ${path} overlaps ${other.label}'s scope ${overlap}.`,
          );
        }
      }
    }
    return normalized;
  }

  private suspendAgentLease<T>(
    threadId: string,
    actorAgentId: string,
    task: () => Promise<T>,
  ): Promise<T> {
    const lease = this.threads.get(threadId)?.activeLeases.get(actorAgentId);
    return lease ? lease.suspend(task) : task();
  }

  listAgentTeam(threadId: string): AgentTeamSnapshot {
    const hosted = this.requireActiveThread(threadId);
    return this.teamSnapshot(hosted);
  }

  async waitForAgentTeam(
    threadId: string,
    observerAgentId: string,
    deadlineSeconds: number,
  ): Promise<AgentTeamSnapshot> {
    if (
      !Number.isFinite(deadlineSeconds) ||
      deadlineSeconds < 1 ||
      deadlineSeconds > 300
    ) {
      throw new Error("Agent-team observation deadline must be 1-300 seconds.");
    }
    const hosted = this.requireActiveThread(threadId);
    const team = hosted.team;
    if (!team) throw new Error("No active agent team is available.");
    const observer = team.observers.get(observerAgentId) ?? {
      messageSequence: team.messageSequence,
      memberVersions: new Map(team.memberVersions),
    };
    team.observers.set(observerAgentId, observer);
    const unseenSnapshot = (observationExpired: boolean) => {
      const memberAgentIds = team.memberAgentIds.filter(
        (agentId) =>
          (team.memberVersions.get(agentId) ?? 0) !==
          (observer.memberVersions.get(agentId) ?? 0),
      );
      const messages = team.messages.filter(
        (message) => message.sequence > observer.messageSequence,
      );
      observer.messageSequence = team.messageSequence;
      observer.memberVersions = new Map(team.memberVersions);
      return this.teamSnapshot(
        hosted,
        observationExpired,
        messages,
        memberAgentIds,
      );
    };
    if (
      team.status === "blocked" ||
      team.status === "integrating" ||
      team.status === "completed" ||
      team.status === "aborted"
    ) {
      return unseenSnapshot(false);
    }
    const startVersion = team.version;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const changed = new Promise<boolean>((resolve) => {
      const wake = () => {
        if (timer) clearTimeout(timer);
        resolve(true);
      };
      team.waiters.add(wake);
      timer = setTimeout(() => {
        team.waiters.delete(wake);
        resolve(false);
      }, deadlineSeconds * 1_000);
    });
    const observedChange = team.version !== startVersion || (await changed);
    return unseenSnapshot(!observedChange);
  }

  async sendAgentTeamMessage(
    threadId: string,
    senderAgentId: string,
    recipient: string,
    kind: AgentTeamMessagePayload["kind"],
    content: string,
  ): Promise<AgentTeamMessagePayload> {
    const hosted = this.requireActiveThread(threadId);
    const team = hosted.team;
    if (!team) throw new Error("No active agent team is available.");
    if (
      senderAgentId !== "parent" &&
      !team.memberAgentIds.includes(senderAgentId)
    ) {
      throw new Error("The message sender is not a member of this team.");
    }
    const resolvedRecipient =
      recipient === "supervisor"
        ? senderAgentId === ROOT_AGENT_ID
          ? ROOT_AGENT_ID
          : (hosted.childAgents.get(senderAgentId)?.parentAgentId ??
            ROOT_AGENT_ID)
        : recipient;
    if (
      resolvedRecipient !== ROOT_AGENT_ID &&
      resolvedRecipient !== "all" &&
      !team.memberAgentIds.includes(resolvedRecipient)
    ) {
      throw new Error(
        `Agent-team recipient was not found: ${resolvedRecipient}`,
      );
    }
    const messageText = content.trim();
    if (!messageText) throw new Error("Agent-team message cannot be empty.");
    const createdAt = new Date().toISOString();
    const message: AgentTeamMessagePayload = {
      type: "agent-team.message",
      teamId: team.teamId,
      messageId: randomUUID(),
      sequence: ++team.messageSequence,
      fromAgentId: senderAgentId,
      recipient: resolvedRecipient,
      kind,
      content: messageText.slice(0, 8 * 1024),
      createdAt,
    };
    team.messages.push(message);
    if (kind === "blocker" && senderAgentId !== "parent") {
      team.blockedAgentIds.add(senderAgentId);
      team.status = "blocked";
    } else if (
      (kind === "handoff" || kind === "finding") &&
      senderAgentId !== "parent"
    ) {
      team.blockedAgentIds.delete(senderAgentId);
    }
    this.sink.emit(hosted.threadId, team.turnId, message);
    this.emitTeam(hosted);

    const envelope = `[agent-team ${kind}] ${senderAgentId}: ${message.content}`;
    const targetAgentIds =
      resolvedRecipient === "all"
        ? team.memberAgentIds.filter((agentId) => agentId !== senderAgentId)
        : resolvedRecipient === ROOT_AGENT_ID
          ? []
          : [resolvedRecipient];
    for (const agentId of targetAgentIds) {
      const target = hosted.childAgents.get(agentId);
      if (!target || isTerminalChildStatus(target.status)) {
        if (resolvedRecipient !== "all") {
          throw new Error(
            `Cannot message a ${target?.status ?? "missing"} agent.`,
          );
        }
        continue;
      }
      if (target.status === "queued" || !target.session) {
        target.pendingSteers.push(envelope);
      } else {
        await target.session.sendCustomMessage(
          {
            customType: "artemis-agent-team",
            content: envelope,
            display: false,
            details: {
              teamId: team.teamId,
              messageId: message.messageId,
              fromAgentId: senderAgentId,
              recipient: resolvedRecipient,
              kind,
            },
          },
          { deliverAs: "steer" },
        );
      }
    }
    if (
      senderAgentId !== "parent" &&
      (resolvedRecipient === ROOT_AGENT_ID || resolvedRecipient === "all") &&
      kind !== "finding"
    ) {
      await hosted.session.sendCustomMessage(
        {
          customType: "artemis-agent-team",
          content: envelope,
          display: false,
          details: {
            teamId: team.teamId,
            messageId: message.messageId,
            fromAgentId: senderAgentId,
            recipient: resolvedRecipient,
            kind,
          },
        },
        { deliverAs: "steer" },
      );
    }
    return message;
  }

  setAgentWriteScope(
    threadId: string,
    agentId: string,
    paths: string[],
  ): ChildAgentSnapshot {
    const { hosted, child } = this.requireChildAgent(threadId, agentId);
    if (isTerminalChildStatus(child.status)) {
      throw new Error(
        `Cannot change a ${child.status} sub-agent's write scope.`,
      );
    }
    child.writePaths = this.validateTeamWritePaths(hosted, agentId, paths);
    this.emitChild(hosted, child);
    return this.childSnapshot(hosted, child);
  }

  finishAgentTeam(
    threadId: string,
    waivedAgentIds: string[],
    summary: string,
  ): AgentTeamSnapshot {
    const hosted = this.requireActiveThread(threadId);
    const team = hosted.team;
    if (!team) throw new Error("No active agent team is available.");
    const waived = new Set(waivedAgentIds);
    const unresolved = [...team.requiredAgentIds].filter((agentId) => {
      const child = hosted.childAgents.get(agentId);
      return child && !isTerminalChildStatus(child.status);
    });
    if (unresolved.length > 0) {
      throw new Error(
        `Required agents are still running: ${unresolved.join(", ")}.`,
      );
    }
    const failed = [...team.requiredAgentIds].filter((agentId) => {
      const status = hosted.childAgents.get(agentId)?.status;
      return status !== "completed" && !waived.has(agentId);
    });
    if (failed.length > 0) {
      throw new Error(
        `Required agents need retry or an explicit waiver: ${failed.join(", ")}.`,
      );
    }
    const unknownWaivers = [...waived].filter(
      (agentId) => !team.requiredAgentIds.has(agentId),
    );
    if (unknownWaivers.length > 0) {
      throw new Error(
        `Waived agents are not required members: ${unknownWaivers.join(", ")}.`,
      );
    }
    const unintegratedSubteams = team.memberAgentIds
      .map((agentId) => hosted.childAgents.get(agentId))
      .filter((child): child is ChildAgentExecution =>
        Boolean(
          child &&
          this.directChildren(hosted, child.agentId).length > 0 &&
          !child.subtreeIntegrated,
        ),
      );
    if (unintegratedSubteams.length > 0) {
      throw new Error(
        `Nested subteams are not integrated: ${unintegratedSubteams
          .map((child) => child.agentId)
          .join(", ")}.`,
      );
    }
    const integrationSummary = summary.trim();
    if (!integrationSummary) {
      throw new Error("An agent-team integration summary is required.");
    }
    team.status = "completed";
    team.blockedAgentIds.clear();
    delete team.error;
    this.emitTeam(hosted);
    void this.sendAgentTeamMessage(
      threadId,
      ROOT_AGENT_ID,
      "all",
      "handoff",
      integrationSummary,
    );
    return this.teamSnapshot(hosted);
  }

  async finishAgentSubteam(
    threadId: string,
    actorAgentId: string,
    waivedAgentIds: string[],
    summary: string,
  ): Promise<ChildAgentSnapshot> {
    const { hosted, child: actor } = this.requireChildAgent(
      threadId,
      actorAgentId,
    );
    if (isTerminalChildStatus(actor.status)) {
      throw new Error("A completed agent cannot integrate a subteam.");
    }
    const directChildren = this.directChildren(hosted, actorAgentId);
    if (directChildren.length === 0) {
      throw new Error("This agent has no direct child agents to integrate.");
    }
    const requiredChildren = directChildren.filter(
      (candidate) => candidate.required,
    );
    const unresolved = requiredChildren.filter(
      (candidate) => !isTerminalChildStatus(candidate.status),
    );
    if (unresolved.length > 0) {
      throw new Error(
        `Required child agents are still running: ${unresolved
          .map((candidate) => candidate.agentId)
          .join(", ")}.`,
      );
    }
    const waived = new Set(waivedAgentIds);
    const failed = requiredChildren.filter(
      (candidate) =>
        candidate.status !== "completed" && !waived.has(candidate.agentId),
    );
    if (failed.length > 0) {
      throw new Error(
        `Required child agents need retry or an explicit waiver: ${failed
          .map((candidate) => candidate.agentId)
          .join(", ")}.`,
      );
    }
    const requiredIds = new Set(
      requiredChildren.map((candidate) => candidate.agentId),
    );
    const unknownWaivers = [...waived].filter(
      (agentId) => !requiredIds.has(agentId),
    );
    if (unknownWaivers.length > 0) {
      throw new Error(
        `Waived agents are not required direct children: ${unknownWaivers.join(", ")}.`,
      );
    }
    const unintegrated = directChildren.filter(
      (candidate) =>
        this.directChildren(hosted, candidate.agentId).length > 0 &&
        !candidate.subtreeIntegrated,
    );
    if (unintegrated.length > 0) {
      throw new Error(
        `Child subteams are not integrated: ${unintegrated
          .map((candidate) => candidate.agentId)
          .join(", ")}.`,
      );
    }
    const integrationSummary = summary.trim();
    if (!integrationSummary) {
      throw new Error("A subteam integration summary is required.");
    }
    actor.subtreeIntegrated = true;
    actor.subtreeSummary = integrationSummary.slice(0, 4 * 1024);
    this.emitChild(hosted, actor);
    await this.sendAgentTeamMessage(
      threadId,
      actorAgentId,
      "supervisor",
      "handoff",
      actor.subtreeSummary,
    );
    return this.childSnapshot(hosted, actor);
  }

  async cancelAgentTeam(
    threadId: string,
    teamId: string,
    notifyParent = false,
  ): Promise<AgentTeamSnapshot> {
    const hosted = this.requireActiveThread(threadId);
    const team = hosted.team;
    if (!team || team.teamId !== teamId) {
      throw new Error(`Agent team was not found: ${teamId}`);
    }
    for (const agentId of team.memberAgentIds) {
      const child = hosted.childAgents.get(agentId);
      if (child) this.requestChildCancellation(hosted, child);
    }
    team.status = "aborted";
    team.error = "The agent team was stopped before integration completed.";
    this.emitTeam(hosted);
    if (notifyParent) {
      await hosted.session.sendCustomMessage(
        {
          customType: "artemis-agent-control",
          content:
            "The user stopped the agent team. Continue the current task without waiting for its members.",
          display: false,
          details: { action: "cancel-team", teamId },
        },
        { deliverAs: "steer" },
      );
    }
    return this.teamSnapshot(hosted);
  }

  async catalog(): Promise<AgentRuntimeCatalog> {
    const modelRuntime = await this.getModelRuntime();
    return {
      models: modelRuntime.getModels().map((model) => ({
        providerId: model.provider,
        modelId: model.id,
        name: model.name,
        reasoning: model.reasoning,
        highestThinkingLevel: getSupportedThinkingLevels(model).at(-1) ?? "off",
        contextWindow: model.contextWindow,
        configured: modelRuntime.hasConfiguredAuth(model.provider),
      })),
      ...(this.configuration.selection
        ? { selection: structuredClone(this.configuration.selection) }
        : {}),
    };
  }

  async openThread(request: OpenThreadRequest): Promise<{
    sessionFile?: string;
  }> {
    const current = this.threads.get(request.threadId);
    if (current) {
      return current.session.sessionFile
        ? { sessionFile: current.session.sessionFile }
        : {};
    }

    const readTool = defineTool({
      name: "read",
      label: "Read file",
      description:
        "Read a UTF-8 text file inside the active Artemis workspace.",
      parameters: Type.Object({
        path: Type.String({
          description: "Path relative to the active workspace.",
        }),
      }),
      execute: async (_toolCallId, params) => {
        const path = resolveWorkspacePath(request.workspacePath, params.path);
        const text = await readFile(path, "utf8");
        return {
          content: [{ type: "text", text }],
          details: { path: params.path },
        };
      },
    });

    const requestUserInputTool = defineTool({
      name: "request_user_input",
      label: "Ask the user",
      description:
        "Pause for one user decision. Ask exactly one question with two or three mutually exclusive options and mark exactly one option as recommended. Use this for requirement, design, or workflow decisions, never for execution approval. The desktop shows one choice card at a time and selects the recommended option after five minutes without an answer.",
      parameters: Type.Object(
        {
          header: Type.String({
            minLength: 1,
            maxLength: 12,
            description: "Short topic label for the choice card.",
          }),
          question: Type.String({ minLength: 1, maxLength: 1_000 }),
          options: Type.Array(
            Type.Object(
              {
                label: Type.String({ minLength: 1, maxLength: 80 }),
                description: Type.String({ minLength: 1, maxLength: 240 }),
                recommended: Type.Boolean(),
              },
              { additionalProperties: false },
            ),
            { minItems: 2, maxItems: 3 },
          ),
        },
        { additionalProperties: false },
      ),
      execute: async (_toolCallId, params) => {
        const hosted = this.threads.get(request.threadId);
        if (!hosted?.currentTurnId || !hosted.currentMode) {
          throw new Error("No active turn is available for user input.");
        }
        const options = params.options.map((option) => ({
          label: option.label.trim(),
          description: option.description.trim(),
          recommended: option.recommended,
        }));
        if (
          options.some((option) => !option.label || !option.description) ||
          options.filter((option) => option.recommended).length !== 1 ||
          new Set(options.map((option) => option.label)).size !== options.length
        ) {
          throw new Error(
            "User input requires unique, non-empty options and exactly one recommendation.",
          );
        }
        const turnId = hosted.currentTurnId;
        const mode = hosted.currentMode;
        const result = await this.serializeUserInput(request.threadId, () => {
          const active = this.threads.get(request.threadId);
          if (active?.currentTurnId !== turnId) {
            throw new Error("The turn ended before this question was shown.");
          }
          return this.broker.request({
            kind: "user.input",
            approvalId: randomUUID(),
            threadId: request.threadId,
            turnId,
            workspacePath: request.workspacePath,
            header: params.header.trim(),
            question: params.question.trim(),
            options,
            mode,
          });
        });
        if (!result.approved) {
          throw new Error(result.error ?? "User input was cancelled.");
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result.data ?? {}, null, 2),
            },
          ],
          details: result.data,
        };
      },
    });

    const createObservedBashTools = (
      resolveScope: () => {
        turnId: string;
        ownerId: string;
        mode: RunMode;
      },
    ) => {
      const bashTool = defineTool({
        name: "shell",
        label: "Run shell command",
        description: `Run a ${this.shellRuntime.toolDescription()} command with the current desktop user's permissions after classifying its risk and whether the user explicitly requested the exact action. Use this shell's native syntax; on Windows this is PowerShell, not Bash. Choose deadline_seconds based on the task type. The deadline is only an observation window: when it expires, the process keeps running and this tool returns an execution_id so you can decide whether to call shell_wait or shell_cancel.`,
        parameters: Type.Object(
          {
            command: Type.String({ minLength: 1 }),
            deadline_seconds: Type.Number({
              minimum: 1,
              maximum: 300,
              description:
                "Model-selected observation window in seconds. Use short windows for probes and longer windows for builds or tests; expiry never kills the process.",
            }),
            model_approval: modelApprovalParameter,
          },
          { additionalProperties: false },
        ),
        execute: async (_toolCallId, params, _signal, onUpdate) => {
          const scope = resolveScope();
          const approval = await this.broker.request({
            kind: "shell.execute",
            approvalId: randomUUID(),
            threadId: request.threadId,
            turnId: scope.turnId,
            workspacePath: request.workspacePath,
            command: params.command,
            ...(scope.ownerId === "parent"
              ? {}
              : { actorAgentId: scope.ownerId }),
            modelApproval: modelApproval(params.model_approval),
            mode: scope.mode,
          });
          if (!approval.approved) {
            throw new Error(approval.error ?? "The user denied this command.");
          }
          return observedBashToolResult(
            await this.bashExecutions.start({
              threadId: request.threadId,
              turnId: scope.turnId,
              ownerId: scope.ownerId,
              command: params.command,
              cwd: request.workspacePath,
              observationMilliseconds: params.deadline_seconds * 1_000,
              onActivity: (snapshot) =>
                onUpdate?.({
                  content: [{ type: "text", text: snapshot.outputDelta }],
                  details: snapshot,
                }),
            }),
          );
        },
      });
      const bashWaitTool = defineTool({
        name: "shell_wait",
        label: "Wait for shell command",
        description:
          "Observe a still-running shell execution for another model-selected window. If the window expires, inspect status, last activity, and health, then decide whether to wait again or cancel and use another approach.",
        parameters: Type.Object(
          {
            execution_id: Type.String({ minLength: 1 }),
            deadline_seconds: Type.Number({ minimum: 1, maximum: 300 }),
          },
          { additionalProperties: false },
        ),
        execute: async (_toolCallId, params) => {
          const scope = resolveScope();
          return observedBashToolResult(
            await this.bashExecutions.wait({
              threadId: request.threadId,
              turnId: scope.turnId,
              ownerId: scope.ownerId,
              executionId: params.execution_id,
              observationMilliseconds: params.deadline_seconds * 1_000,
            }),
          );
        },
      });
      const bashCancelTool = defineTool({
        name: "shell_cancel",
        label: "Stop shell command",
        description:
          "Stop a shell execution after deciding it is stuck, no longer useful, or should be replaced by another approach.",
        parameters: Type.Object(
          { execution_id: Type.String({ minLength: 1 }) },
          { additionalProperties: false },
        ),
        execute: async (_toolCallId, params) => {
          const scope = resolveScope();
          return observedBashToolResult(
            await this.bashExecutions.cancel({
              threadId: request.threadId,
              turnId: scope.turnId,
              ownerId: scope.ownerId,
              executionId: params.execution_id,
            }),
          );
        },
      });
      return { bashTool, bashWaitTool, bashCancelTool };
    };

    const parentBashTools = createObservedBashTools(() => {
      const hosted = this.threads.get(request.threadId);
      if (!hosted?.currentTurnId) {
        throw new Error("No active turn is available for this shell command.");
      }
      return {
        turnId: hosted.currentTurnId,
        ownerId: "parent",
        mode: hosted.currentMode ?? "plan",
      };
    });

    const createWriteTool = (
      resolveActor: () => {
        actorAgentId?: string;
        writePaths?: string[];
      },
    ) =>
      defineTool({
        name: "write",
        label: "Write file",
        description:
          "Write a complete UTF-8 file inside the active Artemis workspace after classifying its risk and whether the user explicitly requested the exact action. In agent-approval mode, low and medium risk continue automatically; high risk continues only when explicitly requested by the user.",
        parameters: Type.Object({
          path: Type.String({
            description: "Path relative to the active workspace.",
          }),
          content: Type.String({ description: "Complete new file content." }),
          model_approval: modelApprovalParameter,
        }),
        execute: async (_toolCallId, params) => {
          const hosted = this.threads.get(request.threadId);
          if (!hosted?.currentTurnId) {
            throw new Error("No active turn is available for this write.");
          }
          const actor = resolveActor();
          const normalizedPath = normalizedWritePaths(request.workspacePath, [
            params.path,
          ])[0]!;
          if (
            actor.actorAgentId &&
            !writePathAllowed(actor.writePaths ?? [], normalizedPath)
          ) {
            throw new Error(
              `Sub-agent ${actor.actorAgentId} cannot write outside its assigned scope: ${normalizedPath}.`,
            );
          }

          const approvalId = randomUUID();
          const result = await this.broker.request({
            kind: "workspace.write",
            approvalId,
            threadId: request.threadId,
            turnId: hosted.currentTurnId,
            workspacePath: request.workspacePath,
            relativePath: params.path,
            ...(actor.actorAgentId ? { actorAgentId: actor.actorAgentId } : {}),
            content: params.content,
            modelApproval: modelApproval(params.model_approval),
            mode: hosted.currentMode ?? "plan",
          });

          if (!result.approved) {
            throw new Error(result.error ?? "The user denied this write.");
          }

          return {
            content: [{ type: "text", text: `Wrote ${params.path}` }],
            details: { path: params.path },
          };
        },
      });
    const writeTool = createWriteTool(() => ({}));

    const createOfficeDocumentTool = (
      resolveActor: () => {
        actorAgentId?: string;
        writePaths?: string[];
      },
    ) =>
      defineTool({
        name: "office_document",
        label: "Office document",
        description:
          "Create, write, read, modify, or delete a normalized PDF, Excel (.xlsx), Word (.docx), or PowerPoint (.pptx) document inside the active workspace. Classify the exact operation's risk and whether the user explicitly requested it; the desktop validates paths and brokers mutations for approval.",
        parameters: Type.Object({
          operation: Type.Union([
            Type.Literal("create"),
            Type.Literal("write"),
            Type.Literal("read"),
            Type.Literal("modify"),
            Type.Literal("delete"),
          ]),
          format: Type.Union([
            Type.Literal("pdf"),
            Type.Literal("excel"),
            Type.Literal("word"),
            Type.Literal("powerpoint"),
          ]),
          path: Type.String({
            description:
              "Safe workspace-relative path with .pdf, .xlsx, .docx, or .pptx extension.",
          }),
          content: Type.Optional(
            Type.Union([
              Type.Object({
                format: Type.Literal("pdf"),
                pages: Type.Array(
                  Type.Object({
                    text: Type.String(),
                    width: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
                    height: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
                  }),
                ),
              }),
              Type.Object({
                format: Type.Literal("excel"),
                sheets: Type.Array(
                  Type.Object({
                    name: Type.String(),
                    rows: Type.Array(
                      Type.Array(
                        Type.Union([
                          Type.String(),
                          Type.Number(),
                          Type.Boolean(),
                          Type.Null(),
                        ]),
                      ),
                    ),
                  }),
                ),
              }),
              Type.Object({
                format: Type.Literal("word"),
                paragraphs: Type.Array(
                  Type.Object({
                    text: Type.String(),
                    heading: Type.Optional(
                      Type.Integer({ minimum: 1, maximum: 6 }),
                    ),
                  }),
                ),
              }),
              Type.Object({
                format: Type.Literal("powerpoint"),
                slides: Type.Array(
                  Type.Object({
                    title: Type.Optional(Type.String()),
                    body: Type.Array(Type.String()),
                  }),
                ),
              }),
            ]),
          ),
          patch: Type.Optional(
            Type.Union([
              Type.Object({
                type: Type.Literal("replace-text"),
                find: Type.String({ minLength: 1 }),
                replacement: Type.String(),
                all: Type.Boolean(),
              }),
              Type.Object({
                type: Type.Literal("set-cell"),
                sheet: Type.String({ minLength: 1 }),
                row: Type.Integer({ minimum: 1 }),
                column: Type.Integer({ minimum: 1 }),
                value: Type.Union([
                  Type.String(),
                  Type.Number(),
                  Type.Boolean(),
                  Type.Null(),
                ]),
              }),
            ]),
          ),
          model_approval: modelApprovalParameter,
        }),
        execute: async (_toolCallId, params) => {
          const hosted = this.threads.get(request.threadId);
          if (!hosted?.currentTurnId) {
            throw new Error(
              "No active turn is available for this Office document operation.",
            );
          }
          const actor = resolveActor();
          const normalizedPath = normalizedWritePaths(request.workspacePath, [
            params.path,
          ])[0]!;
          if (
            actor.actorAgentId &&
            params.operation !== "read" &&
            !writePathAllowed(actor.writePaths ?? [], normalizedPath)
          ) {
            throw new Error(
              `Sub-agent ${actor.actorAgentId} cannot modify an Office document outside its assigned scope: ${normalizedPath}.`,
            );
          }
          const document = officeDocumentRequestSchema.parse({
            protocolVersion: OFFICE_DOCUMENT_PROTOCOL_VERSION,
            requestId: randomUUID(),
            operation: params.operation,
            format: params.format,
            path: params.path,
            ...(params.content === undefined
              ? {}
              : { content: params.content }),
            ...(params.patch === undefined ? {} : { patch: params.patch }),
          });
          const brokerResult = await this.broker.request({
            kind: "office.document",
            approvalId: randomUUID(),
            threadId: request.threadId,
            turnId: hosted.currentTurnId,
            workspacePath: request.workspacePath,
            document,
            ...(actor.actorAgentId ? { actorAgentId: actor.actorAgentId } : {}),
            modelApproval: modelApproval(params.model_approval),
            mode: hosted.currentMode ?? "plan",
          });
          if (!brokerResult.approved) {
            throw new Error(
              brokerResult.error ??
                "The user denied this Office document operation.",
            );
          }
          const data = brokerResult.data as OfficeDocumentResult | undefined;
          return {
            content: [
              {
                type: "text",
                text: data
                  ? JSON.stringify(data, null, 2)
                  : `Completed ${document.operation} for ${document.path}`,
              },
            ],
            details: data ?? {
              operation: document.operation,
              path: document.path,
            },
          };
        },
      });
    const officeDocumentTool = createOfficeDocumentTool(() => ({}));

    const loadWorkspaceDependenciesTool = defineTool({
      name: "load_workspace_dependencies",
      label: "Load workspace dependencies",
      description:
        "Locate the compatible Codex primary runtime used by imported artifact plugins. Returns authoritative Node.js, Python, package, and helper-binary paths without modifying the workspace.",
      parameters: Type.Object({}),
      execute: async () => {
        const dependencies = await resolveCodexWorkspaceDependencies();
        if (!dependencies) {
          throw new Error(
            "Compatible Codex workspace dependencies are not installed for this platform and architecture.",
          );
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(dependencies, null, 2),
            },
          ],
          details: dependencies,
        };
      },
    });

    const updatePlanTool = defineTool({
      name: "update_plan",
      label: "Update task steps",
      description:
        "Publish the current progress for a task with multiple meaningful steps. Use pending, in_progress, and completed statuses, with at most one step in progress.",
      parameters: Type.Object({
        explanation: Type.Optional(
          Type.String({
            maxLength: 500,
            description: "Optional short reason for this plan update.",
          }),
        ),
        steps: Type.Array(
          Type.Object({
            step: Type.String({
              minLength: 1,
              maxLength: 200,
              description: "A concise, verifiable task step.",
            }),
            status: Type.Union([
              Type.Literal("pending"),
              Type.Literal("in_progress"),
              Type.Literal("completed"),
            ]),
          }),
          { minItems: 1, maxItems: 12 },
        ),
      }),
      execute: async (_toolCallId, params) => {
        const steps = params.steps.map((item) => ({
          step: item.step.trim(),
          status: item.status,
        }));
        if (steps.some((item) => !item.step)) {
          throw new Error("Task steps cannot be empty.");
        }
        if (steps.filter((item) => item.status === "in_progress").length > 1) {
          throw new Error("Only one task step may be in progress.");
        }
        return {
          content: [
            {
              type: "text",
              text: `Updated ${steps.length} task step${steps.length === 1 ? "" : "s"}.`,
            },
          ],
          details: {
            ...(params.explanation
              ? { explanation: params.explanation.trim() }
              : {}),
            steps,
          },
        };
      },
    });

    const saveMemoryTool = defineTool({
      name: "save_memory",
      label: "Save reusable memory",
      description:
        "After a workflow has succeeded and been verified, decide whether durable experience is likely to prevent repeated work. If so, save it and choose the scope yourself: project for repository-specific experience, or global only when the workflow applies unchanged across unrelated repositories. If uncertain, choose project. Do not save transient facts, guesses, user data, or credentials.",
      parameters: Type.Object(
        {
          scope: Type.Union([Type.Literal("project"), Type.Literal("global")], {
            description:
              "Choose project for repository-specific paths, commands, architecture, conventions, or decisions. Choose global only for workflows that apply unchanged across unrelated repositories. If uncertain, choose project.",
          }),
          title: Type.String({ minLength: 1, maxLength: 120 }),
          content: Type.String({ minLength: 40, maxLength: 8_000 }),
          keywords: Type.Array(Type.String({ minLength: 2, maxLength: 64 }), {
            minItems: 2,
            maxItems: 12,
          }),
        },
        { additionalProperties: false },
      ),
      execute: async (_toolCallId, params) => {
        const hosted = this.threads.get(request.threadId);
        if (!hosted?.currentTurnId || hosted.currentMode !== "execute") {
          throw new Error(
            "Reusable memory can be saved only during an active Execute turn.",
          );
        }
        const title = params.title.trim();
        const content = params.content.trim();
        const keywords = [
          ...new Set(params.keywords.map((item) => item.trim())),
        ];
        const candidate = `${title}\n${content}\n${keywords.join("\n")}`;
        if (containsMemoryCredential(candidate)) {
          throw new Error(
            "Memory cannot contain credentials, secrets, or access tokens.",
          );
        }
        if (isTransientMemory(title, content)) {
          throw new Error(
            "Transient facts are not a reusable workflow and cannot be saved.",
          );
        }
        const scope = params.scope;
        const result = await this.broker.request({
          kind: "memory.append",
          approvalId: randomUUID(),
          threadId: request.threadId,
          turnId: hosted.currentTurnId,
          workspacePath: request.workspacePath,
          scope,
          title,
          content,
          keywords,
          mode: hosted.currentMode,
        });
        if (!result.approved) {
          throw new Error(result.error ?? "Memory could not be saved.");
        }
        const appended =
          (result.data as { appended?: boolean } | undefined)?.appended !==
          false;
        return {
          content: [
            {
              type: "text",
              text: appended
                ? `Saved reusable ${scope} memory.`
                : "The same memory already exists.",
            },
          ],
          details: { scope, appended },
        };
      },
    });

    let launchChildAgent!: (
      input: LaunchChildAgentInput,
    ) => ChildAgentExecution;
    const childToolResult = (
      snapshot: ChildAgentSnapshot,
      guidance?: string,
    ) => ({
      content: [
        {
          type: "text" as const,
          text: `${JSON.stringify(snapshot, null, 2)}${guidance ? `\n\n${guidance}` : ""}`,
        },
      ],
      details: snapshot,
    });
    const teamToolResult = (snapshot: AgentTeamSnapshot) => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              team: snapshot.team,
              members: snapshot.members.map((member) => ({
                agentId: member.agentId,
                label: member.label,
                parentAgentId: member.parentAgentId,
                depth: member.depth,
                subtreeStatus: member.subtreeStatus,
                directChildCount: member.directChildCount,
                role: member.role,
                task: member.task.slice(0, 512),
                dependsOnAgentIds: member.dependsOnAgentIds,
                required: member.required,
                coordinationStatus: member.coordinationStatus,
                status: member.status,
                health: member.health,
                attempt: member.attempt,
                updatedAt: member.updatedAt,
                ...(member.currentTool
                  ? { currentTool: member.currentTool }
                  : {}),
                ...(member.error ? { error: member.error } : {}),
              })),
              messages: snapshot.messages,
              observationExpired: snapshot.observationExpired,
            },
            null,
            2,
          ),
        },
      ],
      details: snapshot,
    });

    const createSpawnAgentTool = (senderAgentId: string) =>
      defineTool({
        name: "spawn_agent",
        label: "Delegate to sub-agent",
        description:
          "Start one bounded child task without blocking the current agent. Prefer three to five complementary direct children only when parallel work materially helps. Artemis allows 64 current members, five levels, eight direct children per agent, and queues work above the active capacity.",
        parameters: Type.Object(
          {
            label: Type.String({
              minLength: 1,
              maxLength: 120,
              description: "Short label shown in the Artemis agent tree.",
            }),
            role: Type.Optional(
              Type.String({
                minLength: 1,
                maxLength: 120,
                description: "Specific responsibility within the team.",
              }),
            ),
            task: Type.String({
              minLength: 1,
              maxLength: 32 * 1024,
              description: "Concrete task for the child agent.",
            }),
            depends_on_agent_ids: Type.Optional(
              Type.Array(Type.String({ minLength: 1 }), {
                maxItems: AGENT_TEAM_MAXIMUM_DIRECT_CHILDREN,
              }),
            ),
            write_paths: Type.Optional(
              Type.Array(Type.String({ minLength: 1, maxLength: 1_024 }), {
                maxItems: 32,
              }),
            ),
            required: Type.Optional(Type.Boolean()),
          },
          { additionalProperties: false },
        ),
        execute: async (_toolCallId, params) => {
          const hosted = this.threads.get(request.threadId);
          if (!hosted?.currentTurnId || !hosted.currentMode) {
            throw new Error("No active turn is available for delegation.");
          }
          const supervisor =
            senderAgentId === ROOT_AGENT_ID
              ? undefined
              : hosted.childAgents.get(senderAgentId);
          if (
            senderAgentId !== ROOT_AGENT_ID &&
            (!supervisor || isTerminalChildStatus(supervisor.status))
          ) {
            throw new Error("Only an active agent may create child agents.");
          }
          const depth = (supervisor?.depth ?? 0) + 1;
          if (depth > AGENT_TEAM_MAXIMUM_DEPTH) {
            throw new Error(
              `An agent tree may be at most ${AGENT_TEAM_MAXIMUM_DEPTH} levels deep.`,
            );
          }
          const team = this.ensureTeam(hosted);
          if (team.spawnCount >= AGENT_TEAM_SPAWN_BUDGET) {
            throw new Error(
              `This turn exhausted its ${AGENT_TEAM_SPAWN_BUDGET}-spawn safety budget.`,
            );
          }
          if (team.memberAgentIds.length >= AGENT_TEAM_LOGICAL_MAXIMUM) {
            throw new Error(
              `An agent team may contain at most ${AGENT_TEAM_LOGICAL_MAXIMUM} members.`,
            );
          }
          if (
            this.directChildren(hosted, senderAgentId).length >=
            AGENT_TEAM_MAXIMUM_DIRECT_CHILDREN
          ) {
            throw new Error(
              `An agent may have at most ${AGENT_TEAM_MAXIMUM_DIRECT_CHILDREN} direct children.`,
            );
          }
          const dependsOnAgentIds = [
            ...new Set(params.depends_on_agent_ids ?? []),
          ];
          for (const dependencyId of dependsOnAgentIds) {
            const dependency = hosted.childAgents.get(dependencyId);
            if (!dependency || !team.memberAgentIds.includes(dependencyId)) {
              throw new Error(
                `A dependency must already belong to this team: ${dependencyId}.`,
              );
            }
            if (
              dependency.parentAgentId !== senderAgentId &&
              !isTerminalChildStatus(dependency.status)
            ) {
              throw new Error(
                "A running dependency must be a direct sibling of the new agent.",
              );
            }
          }
          const child = launchChildAgent({
            turnId: hosted.currentTurnId,
            mode: hosted.currentMode,
            parentAgentId: senderAgentId,
            depth,
            label: params.label.trim(),
            role: params.role?.trim() || params.label.trim(),
            task: params.task.trim(),
            dependsOnAgentIds,
            writePaths: this.validateTeamWritePaths(
              hosted,
              undefined,
              params.write_paths ?? [],
            ),
            required: params.required ?? true,
            attempt: 1,
          });
          if (supervisor) this.emitChild(hosted, supervisor);
          return childToolResult(
            this.childSnapshot(hosted, child),
            "The child is running asynchronously. Wait for it only when you need its result; collaboration waits release your active execution slot.",
          );
        },
      });
    const spawnAgentTool = createSpawnAgentTool(ROOT_AGENT_ID);

    const listAgentsTool = defineTool({
      name: "list_agents",
      label: "Inspect agent team",
      description:
        "Inspect the current team, member responsibilities, dependencies, health, write scopes, and audited messages.",
      parameters: Type.Object({}, { additionalProperties: false }),
      execute: async () => teamToolResult(this.listAgentTeam(request.threadId)),
    });

    const createWaitTeamTool = (actorAgentId: string) =>
      defineTool({
        name: "wait_team",
        label: "Wait for agent team",
        description:
          "Observe the team until a coordination message or member status changes. Waiting releases the current agent's active execution slot and never stops the team.",
        parameters: Type.Object(
          {
            deadline_seconds: Type.Number({ minimum: 1, maximum: 300 }),
          },
          { additionalProperties: false },
        ),
        execute: async (_toolCallId, params) =>
          teamToolResult(
            await this.suspendAgentLease(request.threadId, actorAgentId, () =>
              this.waitForAgentTeam(
                request.threadId,
                actorAgentId,
                params.deadline_seconds,
              ),
            ),
          ),
      });
    const waitTeamTool = createWaitTeamTool(ROOT_AGENT_ID);

    const createSendMessageTool = (senderAgentId: string) =>
      defineTool({
        name: "send_message",
        label: "Message agent team",
        description:
          "Send one audited finding, request, blocker, or handoff to the parent, all teammates, or one teammate. Use agent IDs from list_agents.",
        parameters: Type.Object(
          {
            recipient: Type.String({ minLength: 1 }),
            kind: Type.Union([
              Type.Literal("finding"),
              Type.Literal("request"),
              Type.Literal("blocker"),
              Type.Literal("handoff"),
            ]),
            message: Type.String({ minLength: 1, maxLength: 8 * 1024 }),
          },
          { additionalProperties: false },
        ),
        execute: async (_toolCallId, params) => {
          const message = await this.sendAgentTeamMessage(
            request.threadId,
            senderAgentId,
            params.recipient,
            params.kind,
            params.message,
          );
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(message, null, 2) },
            ],
            details: message,
          };
        },
      });
    const sendMessageTool = createSendMessageTool("parent");

    const setAgentWriteScopeTool = defineTool({
      name: "set_agent_write_scope",
      label: "Set agent write scope",
      description:
        "Replace one running member's cooperative workspace-relative write scope. Overlapping scopes are rejected; an empty list makes the workspace write tool read-only.",
      parameters: Type.Object(
        {
          agent_id: Type.String({ minLength: 1 }),
          write_paths: Type.Array(
            Type.String({ minLength: 1, maxLength: 1_024 }),
            { maxItems: 32 },
          ),
        },
        { additionalProperties: false },
      ),
      execute: async (_toolCallId, params) =>
        childToolResult(
          this.setAgentWriteScope(
            request.threadId,
            params.agent_id,
            params.write_paths,
          ),
        ),
    });

    const finishTeamTool = defineTool({
      name: "finish_team",
      label: "Finish agent team",
      description:
        "Close the team only after required members settle and their results have been integrated. Failed required members must be explicitly waived with a concise final summary.",
      parameters: Type.Object(
        {
          waived_agent_ids: Type.Optional(
            Type.Array(Type.String({ minLength: 1 }), {
              maxItems: AGENT_TEAM_LOGICAL_MAXIMUM,
            }),
          ),
          summary: Type.String({ minLength: 1, maxLength: 4 * 1024 }),
        },
        { additionalProperties: false },
      ),
      execute: async (_toolCallId, params) =>
        teamToolResult(
          this.finishAgentTeam(
            request.threadId,
            params.waived_agent_ids ?? [],
            params.summary,
          ),
        ),
    });

    const createFinishSubteamTool = (actorAgentId: string) =>
      defineTool({
        name: "finish_subteam",
        label: "Finish child-agent subtree",
        description:
          "Integrate this agent's direct children before returning to its supervisor. Required children must settle; failures need explicit waivers and every nested child subteam must already be integrated.",
        parameters: Type.Object(
          {
            waived_agent_ids: Type.Optional(
              Type.Array(Type.String({ minLength: 1 }), {
                maxItems: AGENT_TEAM_MAXIMUM_DIRECT_CHILDREN,
              }),
            ),
            summary: Type.String({ minLength: 1, maxLength: 4 * 1024 }),
          },
          { additionalProperties: false },
        ),
        execute: async (_toolCallId, params) =>
          childToolResult(
            await this.finishAgentSubteam(
              request.threadId,
              actorAgentId,
              params.waived_agent_ids ?? [],
              params.summary,
            ),
          ),
      });

    const createWaitAgentTool = (actorAgentId: string) =>
      defineTool({
        name: "wait_agent",
        label: "Wait for sub-agent",
        description:
          "Observe a sub-agent for a model-selected deadline. Waiting releases the current agent's active execution slot. Deadline expiry does not stop the sub-agent.",
        parameters: Type.Object(
          {
            agent_id: Type.String({ minLength: 1 }),
            deadline_seconds: Type.Number({ minimum: 1, maximum: 300 }),
          },
          { additionalProperties: false },
        ),
        execute: async (_toolCallId, params) =>
          childToolResult(
            await this.suspendAgentLease(request.threadId, actorAgentId, () =>
              this.waitForChildAgent(
                request.threadId,
                params.agent_id,
                params.deadline_seconds,
              ),
            ),
            "If status is healthy and still running, choose another wait window. If it is suspect, stalled, failed, or cancelling too long, stop it and continue another way.",
          ),
      });
    const waitAgentTool = createWaitAgentTool(ROOT_AGENT_ID);

    const getAgentStatusTool = defineTool({
      name: "get_agent_status",
      label: "Check sub-agent",
      description:
        "Immediately inspect a sub-agent's runtime, last activity, current tool, and health without waiting.",
      parameters: Type.Object(
        { agent_id: Type.String({ minLength: 1 }) },
        { additionalProperties: false },
      ),
      execute: async (_toolCallId, params) =>
        childToolResult(
          this.childAgentStatus(request.threadId, params.agent_id),
        ),
    });

    const steerAgentTool = defineTool({
      name: "steer_agent",
      label: "Nudge sub-agent",
      description:
        "Send a concise correction or status request to a queued or running sub-agent.",
      parameters: Type.Object(
        {
          agent_id: Type.String({ minLength: 1 }),
          message: Type.String({ minLength: 1, maxLength: 4 * 1024 }),
        },
        { additionalProperties: false },
      ),
      execute: async (_toolCallId, params) =>
        childToolResult(
          await this.steerChildAgent(
            request.threadId,
            params.agent_id,
            params.message,
          ),
        ),
    });

    const cancelAgentTool = defineTool({
      name: "cancel_agent",
      label: "Stop sub-agent",
      description:
        "Stop a sub-agent that is stuck, unhealthy, unnecessary, or should be replaced by another approach.",
      parameters: Type.Object(
        { agent_id: Type.String({ minLength: 1 }) },
        { additionalProperties: false },
      ),
      execute: async (_toolCallId, params) =>
        childToolResult(
          await this.cancelChildAgent(request.threadId, params.agent_id),
          "Cancellation was requested. Do not keep waiting for this sub-agent; continue with another approach.",
        ),
    });

    const retryAgentTool = defineTool({
      name: "retry_agent",
      label: "Retry sub-agent",
      description:
        "Retry the same bounded task after its prior sub-agent completed, failed, or was cancelled.",
      parameters: Type.Object(
        { agent_id: Type.String({ minLength: 1 }) },
        { additionalProperties: false },
      ),
      execute: async (_toolCallId, params) =>
        childToolResult(
          this.retryChildAgent(request.threadId, params.agent_id),
          "Monitor the new agent_id with wait_agent.",
        ),
    });

    const configuredMcpTools = this.configuration.mcpTools ?? [];
    const mcpToolByPiName = new Map(
      configuredMcpTools.map((tool) => [tool.piName, tool] as const),
    );
    const createMcpTools = (actorAgentId?: string) =>
      configuredMcpTools.map((tool) =>
        defineTool({
          name: tool.piName,
          label: `${tool.serverName}: ${tool.toolName}`,
          description: `${tool.description} Provide the MCP arguments plus a risk assessment for this exact call.`,
          parameters: Type.Object(
            {
              arguments: tool.inputSchema as TSchema,
              model_approval: modelApprovalParameter,
            },
            { additionalProperties: false },
          ),
          execute: async (_toolCallId, parameters) => {
            const hosted = this.threads.get(request.threadId);
            if (!hosted?.currentTurnId) {
              throw new Error("No active turn is available for this MCP call.");
            }
            const result = await this.broker.request({
              kind: "mcp.call",
              approvalId: randomUUID(),
              threadId: request.threadId,
              turnId: hosted.currentTurnId,
              workspacePath: request.workspacePath,
              serverId: tool.serverId,
              serverName: tool.serverName,
              transport: tool.transport,
              toolName: tool.toolName,
              arguments: parameters.arguments as Record<string, unknown>,
              ...(actorAgentId ? { actorAgentId } : {}),
              readOnly: tool.readOnly,
              destructive: tool.destructive,
              modelApproval: modelApproval(parameters.model_approval),
              mode: hosted.currentMode ?? "plan",
            });
            if (!result.approved) {
              throw new Error(result.error ?? "The user denied this MCP call.");
            }
            const data = result.data as McpToolCallResult | undefined;
            if (data?.isError) {
              const message = data.content
                .flatMap((block) => (block.type === "text" ? [block.text] : []))
                .join("\n")
                .trim();
              throw new Error(message || "MCP tool returned an error.");
            }
            const prepared = prepareMcpToolContent(
              data?.content ?? [],
              hosted.session.model?.contextWindow,
              hosted.session.getContextUsage()?.tokens,
            );
            return {
              content: prepared.content,
              details: {
                serverId: tool.serverId,
                toolName: tool.toolName,
                ...(data?.metrics
                  ? {
                      metrics: {
                        ...data.metrics,
                        deliveredTextBytes: prepared.deliveredTextBytes,
                        omittedTextBytes: prepared.omittedTextBytes,
                        truncated: prepared.truncated,
                      },
                    }
                  : {}),
              },
            };
          },
        }),
      );
    const mcpTools = createMcpTools();
    const extensionTools = (this.configuration.extensionTools ?? []).map(
      (tool) =>
        defineTool({
          name: tool.piName,
          label: `${tool.extensionName}: ${tool.label}`,
          description: `${tool.description} Provide the extension arguments plus a risk assessment for this exact call.`,
          parameters: Type.Object(
            {
              arguments: tool.inputSchema as TSchema,
              model_approval: modelApprovalParameter,
            },
            { additionalProperties: false },
          ),
          execute: async (_toolCallId, parameters) => {
            const hosted = this.threads.get(request.threadId);
            if (!hosted?.currentTurnId) {
              throw new Error(
                "No active turn is available for this extension call.",
              );
            }
            const result = await this.broker.request({
              kind: "extension.call",
              approvalId: randomUUID(),
              threadId: request.threadId,
              turnId: hosted.currentTurnId,
              workspacePath: request.workspacePath,
              extensionId: tool.extensionId,
              extensionName: tool.extensionName,
              toolName: tool.toolName,
              arguments: parameters.arguments as Record<string, unknown>,
              modelApproval: modelApproval(parameters.model_approval),
              mode: hosted.currentMode ?? "plan",
            });
            if (!result.approved) {
              throw new Error(
                result.error ?? "The user denied this extension call.",
              );
            }
            const data = result.data as
              { output?: string; isError?: boolean } | undefined;
            if (data?.isError) {
              throw new Error(
                data.output ?? "Extension tool returned an error.",
              );
            }
            return {
              content: [{ type: "text", text: data?.output ?? "" }],
              details: {
                extensionId: tool.extensionId,
                toolName: tool.toolName,
              },
            };
          },
        }),
    );

    launchChildAgent = (input) => {
      const hosted = this.threads.get(request.threadId);
      if (!hosted) {
        throw new Error(`Thread is not open: ${request.threadId}`);
      }
      const agentId = randomUUID();
      const controller = new AbortController();
      let settle!: () => void;
      const done = new Promise<void>((resolve) => {
        settle = resolve;
      });
      const now = Date.now();
      const child: ChildAgentExecution = {
        ...input,
        agentId,
        status: "queued",
        controller,
        createdAt: now,
        updatedAt: now,
        lastActivityAt: now,
        output: "",
        pendingSteers: [],
        longestObservationMilliseconds: 0,
        subtreeIntegrated: false,
        done,
        settle,
      };
      const team = this.ensureTeam(hosted);
      if (team.spawnCount >= AGENT_TEAM_SPAWN_BUDGET) {
        throw new Error(
          `This turn exhausted its ${AGENT_TEAM_SPAWN_BUDGET}-spawn safety budget.`,
        );
      }
      if (input.replacesAgentId) {
        const replacedIndex = team.memberAgentIds.indexOf(
          input.replacesAgentId,
        );
        if (replacedIndex >= 0) {
          team.memberAgentIds.splice(replacedIndex, 1, agentId);
        } else {
          team.memberAgentIds.push(agentId);
        }
        team.requiredAgentIds.delete(input.replacesAgentId);
        team.blockedAgentIds.delete(input.replacesAgentId);
        for (const member of hosted.childAgents.values()) {
          if (!member.dependsOnAgentIds.includes(input.replacesAgentId)) {
            continue;
          }
          member.dependsOnAgentIds = member.dependsOnAgentIds.map(
            (dependencyId) =>
              dependencyId === input.replacesAgentId ? agentId : dependencyId,
          );
          this.emitChild(hosted, member);
        }
      } else {
        if (team.memberAgentIds.length >= AGENT_TEAM_LOGICAL_MAXIMUM) {
          throw new Error(
            `An agent team may contain at most ${AGENT_TEAM_LOGICAL_MAXIMUM} members.`,
          );
        }
        team.memberAgentIds.push(agentId);
      }
      team.spawnCount += 1;
      if (input.required) team.requiredAgentIds.add(agentId);
      delete child.replacesAgentId;
      hosted.childAgents.set(agentId, child);
      this.emitChild(hosted, child);
      team.status = "running";
      this.emitTeam(hosted);

      const cancellationKey = `${request.threadId}\0${input.turnId}`;
      const dependencies = input.dependsOnAgentIds
        .map((dependencyId) => hosted.childAgents.get(dependencyId))
        .filter((dependency): dependency is ChildAgentExecution =>
          Boolean(dependency),
        );
      void Promise.all(dependencies.map((dependency) => dependency.done))
        .then(async () => {
          const failedDependency = dependencies.find(
            (dependency) => dependency.status !== "completed",
          );
          if (failedDependency) {
            child.status = "blocked";
            child.error = `Dependency ${failedDependency.agentId} finished with ${failedDependency.status}.`;
            child.lastActivityAt = Date.now();
            team.blockedAgentIds.add(child.agentId);
            this.emitChild(hosted, child);
            child.settle();
            return;
          }
          await this.concurrency.run(
            "child",
            async (lease) => {
              hosted.activeLeases.set(agentId, lease);
              if (
                controller.signal.aborted ||
                this.cancelledTurns.has(cancellationKey)
              ) {
                throw new DOMException("Aborted", "AbortError");
              }

              child.status = "running";
              child.startedAt = Date.now();
              child.lastActivityAt = child.startedAt;
              this.emitChild(hosted, child);

              let unsubscribe = () => {};
              let pendingActivity = "";
              let activityUpdateTimer:
                ReturnType<typeof setTimeout> | undefined;
              const childProviderId = this.configuration.selection?.providerId;
              const childAdapter = new PiAdapter(
                `${input.turnId}:child:${agentId}`,
              );
              const childToolNames = new Map<string, string>();
              const emitActivityUpdate = () => {
                const activityDelta = pendingActivity;
                pendingActivity = "";
                if (!activityDelta) return;
                this.emitChild(hosted, child, { activityDelta });
              };
              const scheduleActivityUpdate = (delta: string) => {
                child.lastActivityAt = Date.now();
                pendingActivity = `${pendingActivity}${delta}`.slice(-8 * 1024);
                if (activityUpdateTimer) return;
                activityUpdateTimer = setTimeout(() => {
                  activityUpdateTimer = undefined;
                  emitActivityUpdate();
                }, 1_000);
              };
              const flushActivityUpdate = () => {
                if (activityUpdateTimer) clearTimeout(activityUpdateTimer);
                activityUpdateTimer = undefined;
                emitActivityUpdate();
              };

              try {
                const childResourceLoader = new DefaultResourceLoader({
                  cwd: request.workspacePath,
                  agentDir: this.agentDir,
                  noExtensions: true,
                  ...createResourceOverrides(() => this.configuration, "child"),
                });
                await childResourceLoader.reload();
                const modelRuntime = await this.getModelRuntime();
                const selection = this.configuration.selection;
                const catalogModel = selection
                  ? modelRuntime.getModel(
                      selection.providerId,
                      selection.modelId,
                    )
                  : undefined;
                const selectedModel = catalogModel
                  ? configureModelContextWindow(
                      catalogModel,
                      this.configuration.contextWindow,
                    )
                  : undefined;
                const childBashTools = createObservedBashTools(() => ({
                  turnId: input.turnId,
                  ownerId: agentId,
                  mode: input.mode,
                }));
                const childWriteTool = createWriteTool(() => ({
                  actorAgentId: agentId,
                  writePaths: child.writePaths,
                }));
                const childOfficeDocumentTool = createOfficeDocumentTool(
                  () => ({
                    actorAgentId: agentId,
                    writePaths: child.writePaths,
                  }),
                );
                const childSendMessageTool = createSendMessageTool(agentId);
                const childSpawnAgentTool = createSpawnAgentTool(agentId);
                const childWaitAgentTool = createWaitAgentTool(agentId);
                const childWaitTeamTool = createWaitTeamTool(agentId);
                const childFinishSubteamTool = createFinishSubteamTool(agentId);
                const readOnlyMcpToolNames = new Set(
                  configuredMcpTools
                    .filter((tool) => tool.readOnly)
                    .map((tool) => tool.piName),
                );
                const childMcpTools = createMcpTools(agentId).filter((tool) =>
                  readOnlyMcpToolNames.has(tool.name),
                );
                const created = await createAgentSession({
                  cwd: request.workspacePath,
                  sessionManager: omitReasoningFromSession(
                    SessionManager.inMemory(request.workspacePath),
                  ),
                  modelRuntime,
                  ...(selectedModel ? { model: selectedModel } : {}),
                  ...(selection
                    ? { thinkingLevel: selection.thinkingLevel }
                    : {}),
                  resourceLoader: childResourceLoader,
                  noTools: "builtin",
                  customTools: [
                    readTool,
                    childWriteTool,
                    childOfficeDocumentTool,
                    loadWorkspaceDependenciesTool,
                    childSpawnAgentTool,
                    listAgentsTool,
                    childWaitAgentTool,
                    childWaitTeamTool,
                    childSendMessageTool,
                    childFinishSubteamTool,
                    childBashTools.bashTool,
                    childBashTools.bashWaitTool,
                    childBashTools.bashCancelTool,
                    ...childMcpTools,
                  ],
                  tools: [
                    "read",
                    "write",
                    "office_document",
                    "load_workspace_dependencies",
                    "spawn_agent",
                    "list_agents",
                    "wait_agent",
                    "wait_team",
                    "send_message",
                    "finish_subteam",
                    "shell",
                    "shell_wait",
                    "shell_cancel",
                    ...childMcpTools.map((tool) => tool.name),
                  ],
                });
                child.session = created.session;
                this.promptCache.registerSession(child.session.sessionId, {
                  scope: "child",
                  priorTopLevelUserTurns: 0,
                });
                this.configureSessionCompaction(child.session);
                child.session.agent.state.tools =
                  child.session.agent.state.tools.filter(
                    (tool) =>
                      tool.name === "read" ||
                      tool.name === "spawn_agent" ||
                      tool.name === "list_agents" ||
                      tool.name === "wait_agent" ||
                      tool.name === "wait_team" ||
                      tool.name === "send_message" ||
                      tool.name === "finish_subteam" ||
                      (input.mode === "execute" &&
                        (tool.name === "shell" ||
                          tool.name === "shell_wait" ||
                          tool.name === "shell_cancel" ||
                          tool.name === "write" ||
                          tool.name === "office_document")) ||
                      (input.mode === "execute" &&
                        tool.name === "load_workspace_dependencies") ||
                      (input.mode === "execute" &&
                        childMcpTools.some(
                          (candidate) => candidate.name === tool.name,
                        )),
                  );
                unsubscribe = child.session.subscribe((event) => {
                  for (const payload of childAdapter.adapt(event as never)) {
                    if (payload.type === "message.part.delta") {
                      if (payload.partType === "text") {
                        child.output = `${child.output}${payload.delta}`.slice(
                          -60 * 1024,
                        );
                      }
                      scheduleActivityUpdate(payload.delta);
                    } else if (payload.type === "tool.started") {
                      childToolNames.set(payload.toolCallId, payload.toolName);
                      const mcpTool = mcpToolByPiName.get(payload.toolName);
                      if (mcpTool) {
                        this.sink.emit(hosted.threadId, input.turnId, {
                          type: "mcp.tool.used",
                          toolCallId: payload.toolCallId,
                          serverId: mcpTool.serverId,
                          serverName: mcpTool.serverName,
                          toolName: mcpTool.toolName,
                          agentId,
                        });
                      }
                      child.currentTool = payload.toolName;
                      child.currentToolStartedAt = Date.now();
                      const toolInput =
                        payload.input === undefined
                          ? ""
                          : `\n${JSON.stringify(payload.input, null, 2).slice(
                              0,
                              2 * 1024,
                            )}`;
                      scheduleActivityUpdate(
                        `\n[${payload.toolName} started]${toolInput}\n`,
                      );
                    } else if (payload.type === "tool.updated") {
                      scheduleActivityUpdate(payload.output.slice(-2 * 1024));
                    } else if (payload.type === "tool.completed") {
                      const toolName =
                        childToolNames.get(payload.toolCallId) ?? "tool";
                      delete child.currentTool;
                      delete child.currentToolStartedAt;
                      scheduleActivityUpdate(
                        `\n[${toolName} ${payload.isError ? "failed" : "completed"}]\n${
                          payload.output?.slice(-4 * 1024) ?? ""
                        }\n`,
                      );
                    } else if (payload.type === "turn.failed") {
                      scheduleActivityUpdate(`\n[failed] ${payload.message}\n`);
                    } else if (payload.type === "assistant.usage") {
                      this.sink.emit(
                        hosted.threadId,
                        input.turnId,
                        this.promptCacheUsage(
                          child.session!.sessionId,
                          payload,
                        ),
                      );
                    }
                  }
                });
                const queuedGuidance = child.pendingSteers.length
                  ? `\n\nAdditional guidance received while queued:\n${child.pendingSteers.join("\n")}`
                  : "";
                if (
                  childProviderId &&
                  (this.providerAdmissionBlockedUntil.get(childProviderId) ??
                    0) > Date.now()
                ) {
                  await lease.suspend(() =>
                    this.waitForProviderAdmission(
                      childProviderId,
                      controller.signal,
                    ),
                  );
                }
                await child.session.prompt(
                  `${modeInstruction(input.mode)}\n\nYou are ${input.role}, an Artemis child agent at depth ${input.depth} of ${AGENT_TEAM_MAXIMUM_DEPTH}. Complete only this bounded task:\n${input.task}\n\nYour supervisor is ${input.parentAgentId}. You may create up to ${AGENT_TEAM_MAXIMUM_DIRECT_CHILDREN} direct children when the task has independent workstreams and the team still has capacity. Your cooperative write scope is ${input.writePaths.length > 0 ? input.writePaths.join(", ") : "empty (workspace write calls are read-only)"}.${queuedGuidance}`,
                );
                if (
                  this.directChildren(hosted, child.agentId).length > 0 &&
                  !child.subtreeIntegrated
                ) {
                  throw new Error(
                    "The agent ended before calling finish_subteam for its direct children.",
                  );
                }
                child.status = controller.signal.aborted
                  ? "cancelled"
                  : "completed";
                if (
                  child.status === "completed" &&
                  child.output.trim() &&
                  !team.messages.some(
                    (message) =>
                      message.fromAgentId === child.agentId &&
                      message.kind === "handoff",
                  )
                ) {
                  await this.sendAgentTeamMessage(
                    request.threadId,
                    child.agentId,
                    "supervisor",
                    "handoff",
                    child.output.trim().slice(-8 * 1024),
                  );
                }
              } catch (error) {
                if (childProviderId) {
                  this.recordProviderBackoff(childProviderId, error);
                }
                const cancelled =
                  controller.signal.aborted ||
                  this.cancelledTurns.has(cancellationKey);
                child.status = cancelled ? "cancelled" : "failed";
                if (!cancelled) {
                  child.error = (
                    error instanceof Error ? error.message : String(error)
                  ).slice(0, 4 * 1024);
                }
              } finally {
                if (child.status === "failed" || child.status === "cancelled") {
                  for (const descendant of this.descendantAgents(
                    hosted,
                    child.agentId,
                  )) {
                    this.requestChildCancellation(hosted, descendant);
                  }
                }
                hosted.activeLeases.delete(agentId);
                flushActivityUpdate();
                if (activityUpdateTimer) clearTimeout(activityUpdateTimer);
                unsubscribe();
                this.bashExecutions.cancelScope({
                  threadId: request.threadId,
                  turnId: input.turnId,
                  ownerId: agentId,
                });
                delete child.currentTool;
                delete child.currentToolStartedAt;
                child.lastActivityAt = Date.now();
                if (child.session) {
                  this.promptCache.unregisterSession(child.session.sessionId);
                }
                child.session?.dispose();
                delete child.session;
                this.emitChild(hosted, child);
                child.settle();
              }
            },
            controller.signal,
            request.threadId,
          );
        })
        .catch((error: unknown) => {
          if (!isTerminalChildStatus(child.status)) {
            const cancelled = controller.signal.aborted;
            child.status = cancelled ? "cancelled" : "failed";
            if (!cancelled) {
              child.error = (
                error instanceof Error ? error.message : String(error)
              ).slice(0, 4 * 1024);
            }
            child.lastActivityAt = Date.now();
            this.emitChild(hosted, child);
            child.settle();
          }
        });

      return child;
    };

    const sessionManager =
      request.sessionFile && existsSync(request.sessionFile)
        ? omitReasoningFromSession(SessionManager.open(request.sessionFile))
        : createLazySessionManager(
            request.workspacePath,
            this.agentDir,
            (sessionFile) =>
              this.onSessionFile?.(request.threadId, sessionFile),
          );
    const modelRuntime = await this.getModelRuntime();
    const selection = this.configuration.selection;
    const catalogModel = selection
      ? modelRuntime.getModel(selection.providerId, selection.modelId)
      : undefined;
    if (selection && !catalogModel) {
      throw new Error(
        `Configured model is unavailable: ${selection.providerId}/${selection.modelId}`,
      );
    }
    const selectedModel = catalogModel
      ? configureModelContextWindow(
          catalogModel,
          this.configuration.contextWindow,
        )
      : undefined;
    const resourceLoader = new DefaultResourceLoader({
      cwd: request.workspacePath,
      agentDir: this.agentDir,
      noExtensions: true,
      ...createResourceOverrides(() => this.configuration),
    });
    await resourceLoader.reload();
    const { session } = await createAgentSession({
      cwd: request.workspacePath,
      sessionManager,
      modelRuntime,
      ...(selectedModel ? { model: selectedModel } : {}),
      ...(selection ? { thinkingLevel: selection.thinkingLevel } : {}),
      resourceLoader,
      noTools: "builtin",
      customTools: [
        readTool,
        requestUserInputTool,
        writeTool,
        officeDocumentTool,
        loadWorkspaceDependenciesTool,
        updatePlanTool,
        saveMemoryTool,
        spawnAgentTool,
        listAgentsTool,
        waitTeamTool,
        sendMessageTool,
        setAgentWriteScopeTool,
        finishTeamTool,
        waitAgentTool,
        getAgentStatusTool,
        steerAgentTool,
        cancelAgentTool,
        retryAgentTool,
        parentBashTools.bashTool,
        parentBashTools.bashWaitTool,
        parentBashTools.bashCancelTool,
        ...mcpTools,
        ...extensionTools,
      ],
      tools: [
        "read",
        "request_user_input",
        "write",
        "office_document",
        "load_workspace_dependencies",
        "update_plan",
        "save_memory",
        "spawn_agent",
        "list_agents",
        "wait_team",
        "send_message",
        "set_agent_write_scope",
        "finish_team",
        "wait_agent",
        "get_agent_status",
        "steer_agent",
        "cancel_agent",
        "retry_agent",
        "shell",
        "shell_wait",
        "shell_cancel",
        ...mcpTools.map((tool) => tool.name),
        ...extensionTools.map((tool) => tool.name),
      ],
    });
    const restoredTopLevelUserTurns = session.messages.filter(
      (message) => message.role === "user",
    ).length;
    this.promptCache.registerSession(session.sessionId, {
      scope: "parent",
      priorTopLevelUserTurns: restoredTopLevelUserTurns,
    });
    this.configureSessionCompaction(session);
    const readSessionTool = session.agent.state.tools.find(
      (tool) => tool.name === "read",
    );
    const requestUserInputSessionTool = session.agent.state.tools.find(
      (tool) => tool.name === "request_user_input",
    );
    const writeSessionTool = session.agent.state.tools.find(
      (tool) => tool.name === "write",
    );
    const updatePlanSessionTool = session.agent.state.tools.find(
      (tool) => tool.name === "update_plan",
    );
    const saveMemorySessionTool = session.agent.state.tools.find(
      (tool) => tool.name === "save_memory",
    );
    const officeDocumentSessionTool = session.agent.state.tools.find(
      (tool) => tool.name === "office_document",
    );
    const loadWorkspaceDependenciesSessionTool = session.agent.state.tools.find(
      (tool) => tool.name === "load_workspace_dependencies",
    );
    const spawnAgentSessionTool = session.agent.state.tools.find(
      (tool) => tool.name === "spawn_agent",
    );
    const childControlSessionTools = session.agent.state.tools.filter((tool) =>
      [
        "wait_agent",
        "get_agent_status",
        "steer_agent",
        "cancel_agent",
        "retry_agent",
      ].includes(tool.name),
    );
    const teamSessionTools = session.agent.state.tools.filter((tool) =>
      [
        "list_agents",
        "wait_team",
        "send_message",
        "set_agent_write_scope",
        "finish_team",
      ].includes(tool.name),
    );
    const bashSessionTool = session.agent.state.tools.find(
      (tool) => tool.name === "shell",
    );
    const bashWaitSessionTool = session.agent.state.tools.find(
      (tool) => tool.name === "shell_wait",
    );
    const bashCancelSessionTool = session.agent.state.tools.find(
      (tool) => tool.name === "shell_cancel",
    );
    if (
      !readSessionTool ||
      !requestUserInputSessionTool ||
      !writeSessionTool ||
      !officeDocumentSessionTool ||
      !loadWorkspaceDependenciesSessionTool ||
      !updatePlanSessionTool ||
      !saveMemorySessionTool ||
      !spawnAgentSessionTool ||
      childControlSessionTools.length !== 5 ||
      teamSessionTools.length !== 5 ||
      !bashSessionTool ||
      !bashWaitSessionTool ||
      !bashCancelSessionTool
    ) {
      session.dispose();
      throw new Error("Pi did not register Artemis workspace tools.");
    }
    const executeTools = session.agent.state.tools.filter(
      (tool) =>
        tool.name === "read" ||
        tool.name === "request_user_input" ||
        tool.name === "shell" ||
        tool.name === "shell_wait" ||
        tool.name === "shell_cancel" ||
        tool.name === "write" ||
        tool.name === "office_document" ||
        tool.name === "load_workspace_dependencies" ||
        tool.name === "update_plan" ||
        tool.name === "save_memory" ||
        tool.name === "spawn_agent" ||
        teamSessionTools.some((candidate) => candidate.name === tool.name) ||
        childControlSessionTools.some(
          (candidate) => candidate.name === tool.name,
        ) ||
        mcpTools.some((candidate) => candidate.name === tool.name) ||
        extensionTools.some((candidate) => candidate.name === tool.name),
    );
    const hosted: HostedThread = {
      threadId: request.threadId,
      workspacePath: request.workspacePath,
      target: request.target,
      session,
      resourceLoader,
      currentTurnId: undefined,
      currentMode: undefined,
      compacting: false,
      topLevelUserTurns: restoredTopLevelUserTurns,
      readTool: readSessionTool,
      writeTool: writeSessionTool,
      mcpToolNames: new Set(mcpTools.map((tool) => tool.name)),
      delegatedTools: [
        readSessionTool,
        requestUserInputSessionTool,
        updatePlanSessionTool,
        spawnAgentSessionTool,
        ...teamSessionTools,
        ...childControlSessionTools,
      ],
      executeTools,
      childAgents: new Map(),
      activeLeases: new Map(),
      currentMission: undefined,
      team: undefined,
      interruptedTeamContext: undefined,
      recoveredQueueMessages: [],
      deferredTurnCompletion: undefined,
      launchChildAgent,
      adapter: undefined,
      unsubscribe: () => {},
    };
    hosted.unsubscribe = session.subscribe((event) => {
      if (
        hosted.currentTurnId &&
        terminalAgentStopReason(event) &&
        session.pendingMessageCount > 0
      ) {
        const queue = session.clearQueue();
        hosted.recoveredQueueMessages.push(
          ...queue.steering,
          ...queue.followUp,
        );
      }
      if (hosted.currentTurnId && hosted.adapter) {
        if (
          event.type === "agent_settled" &&
          hosted.recoveredQueueMessages.length > 0
        ) {
          this.sink.emit(hosted.threadId, hosted.currentTurnId, {
            type: "queue.recovered",
            messages: hosted.recoveredQueueMessages,
          });
          hosted.recoveredQueueMessages = [];
        }
        for (const payload of hosted.adapter.adapt(event as never)) {
          if (
            payload.type === "turn.completed" &&
            hosted.team &&
            hosted.team.status !== "completed" &&
            hosted.team.status !== "aborted"
          ) {
            hosted.deferredTurnCompletion = payload;
            continue;
          }
          if (payload.type === "tool.started") {
            const mcpTool = mcpToolByPiName.get(payload.toolName);
            if (mcpTool) {
              this.sink.emit(hosted.threadId, hosted.currentTurnId, {
                type: "mcp.tool.used",
                toolCallId: payload.toolCallId,
                serverId: mcpTool.serverId,
                serverName: mcpTool.serverName,
                toolName: mcpTool.toolName,
                agentId: "parent",
              });
            }
          }
          if (payload.type === "assistant.usage") {
            this.sink.emit(
              hosted.threadId,
              hosted.currentTurnId,
              this.promptCacheUsage(session.sessionId, payload),
            );
            continue;
          }
          this.sink.emit(hosted.threadId, hosted.currentTurnId, payload);
        }
      }
      this.handleContextUsageEvent(hosted, event);
    });

    this.threads.set(request.threadId, hosted);
    this.emitContextUsage(hosted, false);
    return session.sessionFile ? { sessionFile: session.sessionFile } : {};
  }

  async prompt(
    threadId: string,
    turnId: string,
    text: string,
    mode: RunMode,
    attachments?: PromptAttachment[],
    goal?: string,
    memoryContext?: string,
  ): Promise<void> {
    const hosted = this.threads.get(threadId);
    if (!hosted) {
      throw new Error(`Thread is not open: ${threadId}`);
    }
    if (hosted.compacting) {
      throw new Error("Cannot start a turn while context is compacting.");
    }

    hosted.currentTurnId = turnId;
    hosted.currentMode = mode;
    hosted.currentMission = (goal ?? text).trim().slice(0, 2_000);
    if (hosted.team?.status === "aborted") {
      hosted.interruptedTeamContext = this.interruptedTeamSummary(hosted);
    }
    const interruptedTeamContext = requestsInterruptedTeamContinuation(text)
      ? hosted.interruptedTeamContext
      : undefined;
    hosted.team = undefined;
    hosted.deferredTurnCompletion = undefined;
    hosted.adapter = new PiAdapter(turnId);
    this.cancelledTurns.delete(`${threadId}\0${turnId}`);
    hosted.session.agent.state.tools =
      mode === "execute" ? hosted.executeTools : hosted.delegatedTools;

    const prompt = appendPromptFiles(
      buildTurnPrompt(mode, text, goal, memoryContext, interruptedTeamContext),
      attachments,
    );
    const expandedPrompt = await expandSkillInvocations(
      prompt,
      hosted.resourceLoader.getSkills().skills,
    );
    const images = toSessionImages(attachments);
    this.promptCache.updateParentTurnCount(
      hosted.session.sessionId,
      hosted.topLevelUserTurns,
    );
    hosted.topLevelUserTurns += 1;
    try {
      const concurrency = this.concurrency.snapshot;
      if (
        concurrency &&
        (concurrency.active >= concurrency.limit ||
          concurrency.activeParents >= Math.max(1, concurrency.limit - 1))
      ) {
        this.sink.emit(hosted.threadId, turnId, {
          type: "turn.activity",
          phase: "queued",
          queueDepth: concurrency.queued + 1,
        });
      }
      await this.concurrency.run(
        "parent",
        async (lease) => {
          hosted.activeLeases.set(ROOT_AGENT_ID, lease);
          const providerId = this.configuration.selection?.providerId;
          this.sink.emit(hosted.threadId, turnId, {
            type: "turn.activity",
            phase: "requesting-model",
            queueDepth: this.concurrency.snapshot?.queued ?? 0,
            toolCount: hosted.session.getActiveToolNames().length,
          });
          try {
            if (
              providerId &&
              (this.providerAdmissionBlockedUntil.get(providerId) ?? 0) >
                Date.now()
            ) {
              await lease.suspend(() =>
                this.waitForProviderAdmission(providerId, undefined, () =>
                  this.cancelledTurns.has(`${threadId}\0${turnId}`),
                ),
              );
            }
            await (images || expandedPrompt.expanded
              ? hosted.session.prompt(expandedPrompt.text, {
                  ...(images ? { images } : {}),
                  ...(expandedPrompt.expanded
                    ? { expandPromptTemplates: false }
                    : {}),
                })
              : hosted.session.prompt(expandedPrompt.text));
          } catch (error) {
            if (providerId) this.recordProviderBackoff(providerId, error);
            throw error;
          } finally {
            hosted.activeLeases.delete(ROOT_AGENT_ID);
          }
        },
        undefined,
        threadId,
      );
    } finally {
      const cancellationKey = `${threadId}\0${turnId}`;
      const cancelledByUser = this.cancelledTurns.has(cancellationKey);
      this.bashExecutions.cancelTurn(threadId, turnId);
      const team = this.threads.get(threadId)?.team;
      const incompleteTeam =
        team && team.status !== "completed" && team.status !== "aborted";
      if (incompleteTeam && team) {
        team.status = "aborted";
        team.blockedAgentIds.clear();
        if (cancelledByUser) {
          delete team.error;
        } else {
          team.error = "The parent agent ended before calling finish_team.";
        }
        this.emitTeam(hosted);
        if (!cancelledByUser) {
          this.sink.emit(hosted.threadId, turnId, {
            type: "turn.failed",
            code: "agent-team-incomplete",
            message:
              "The agent team was not integrated before the parent agent ended.",
          });
        }
      } else if (hosted.deferredTurnCompletion) {
        this.sink.emit(hosted.threadId, turnId, hosted.deferredTurnCompletion);
      }
      for (const child of hosted.childAgents.values()) {
        if (child.turnId === turnId) {
          this.requestChildCancellation(hosted, child);
        }
      }
      hosted.currentTurnId = undefined;
      hosted.currentMode = undefined;
      hosted.currentMission = undefined;
      hosted.deferredTurnCompletion = undefined;
      hosted.adapter = undefined;
      this.cancelledTurns.delete(cancellationKey);
    }
  }

  async cancel(threadId: string): Promise<void> {
    const hosted = this.threads.get(threadId);
    if (!hosted) {
      return;
    }
    if (hosted.currentTurnId) {
      this.cancelledTurns.add(`${threadId}\0${hosted.currentTurnId}`);
      this.bashExecutions.cancelTurn(threadId, hosted.currentTurnId);
    }
    for (const child of hosted.childAgents.values()) {
      this.requestChildCancellation(hosted, child);
    }
    await hosted.session.abort();
  }

  async compact(threadId: string, customInstructions?: string): Promise<void> {
    const hosted = this.threads.get(threadId);
    if (!hosted) {
      throw new Error(`Thread is not open: ${threadId}`);
    }
    if (hosted.currentTurnId) {
      throw new Error("Cannot compact context during an active turn.");
    }
    if (hosted.compacting) {
      throw new Error("Context compaction is already running.");
    }

    hosted.compacting = true;
    try {
      await this.concurrency.run("parent", async () => {
        if (hosted.currentTurnId) {
          throw new Error("Cannot compact context during an active turn.");
        }
        await hosted.session.compact(customInstructions);
      });
    } finally {
      hosted.compacting = false;
    }
  }

  async steer(
    threadId: string,
    text: string,
    attachments?: PromptAttachment[],
  ): Promise<void> {
    const hosted = this.requireActiveThread(threadId);
    const images = toSessionImages(attachments);
    const prompt = appendPromptFiles(text, attachments);
    await (images
      ? hosted.session.steer(prompt, images)
      : hosted.session.steer(prompt));
  }

  async followUp(
    threadId: string,
    text: string,
    attachments?: PromptAttachment[],
  ): Promise<void> {
    const hosted = this.requireActiveThread(threadId);
    const images = toSessionImages(attachments);
    const prompt = appendPromptFiles(text, attachments);
    await (images
      ? hosted.session.followUp(prompt, images)
      : hosted.session.followUp(prompt));
  }

  clearQueue(threadId: string): {
    steering: string[];
    followUp: string[];
  } {
    return this.requireActiveThread(threadId).session.clearQueue();
  }

  async steerQueue(threadId: string): Promise<void> {
    const hosted = this.requireActiveThread(threadId);
    const queue = hosted.session.clearQueue();
    for (const message of [...queue.steering, ...queue.followUp]) {
      await hosted.session.steer(message);
    }
  }

  forkThread(threadId: string, entryId?: string): { sessionFile: string } {
    const hosted = this.threads.get(threadId);
    if (!hosted) {
      throw new Error(`Thread is not open: ${threadId}`);
    }
    if (hosted.currentTurnId) {
      throw new Error("Cannot fork a thread while a turn is active.");
    }
    if (hosted.compacting) {
      throw new Error("Cannot fork a thread while context is compacting.");
    }
    const sourceSessionFile = hosted.session.sessionFile;
    if (!sourceSessionFile) {
      throw new Error("Cannot fork a thread without a persisted Pi session.");
    }
    return {
      sessionFile: forkPiSession(sourceSessionFile, entryId),
    };
  }

  closeThread(threadId: string): void {
    const hosted = this.threads.get(threadId);
    if (!hosted) {
      return;
    }
    if (hosted.currentTurnId) {
      throw new Error("Cannot close a thread while a turn is active.");
    }
    if (hosted.compacting) {
      throw new Error("Cannot close a thread while context is compacting.");
    }
    hosted.unsubscribe();
    for (const child of hosted.childAgents.values()) {
      this.requestChildCancellation(hosted, child);
      if (child.session) {
        this.promptCache.unregisterSession(child.session.sessionId);
      }
      child.session?.dispose();
    }
    hosted.childAgents.clear();
    this.bashExecutions.disposeThread(threadId);
    this.promptCache.unregisterSession(hosted.session.sessionId);
    hosted.session.dispose();
    this.threads.delete(threadId);
  }

  async deleteThread(threadId: string, sessionFile?: string): Promise<void> {
    const hosted = this.threads.get(threadId);
    sessionFile ??= hosted?.session.sessionFile;
    if (hosted) {
      this.closeThread(threadId);
    }
    if (sessionFile) {
      await deletePiSessionTranscript(
        sessionFile,
        join(this.agentDir, "sessions"),
      );
    }
  }

  private requireActiveThread(threadId: string): HostedThread {
    const hosted = this.threads.get(threadId);
    if (!hosted?.currentTurnId) {
      throw new Error(`Thread has no active turn: ${threadId}`);
    }
    return hosted;
  }

  dispose(): void {
    for (const hosted of this.threads.values()) {
      hosted.unsubscribe();
      for (const child of hosted.childAgents.values()) {
        this.requestChildCancellation(hosted, child);
        if (child.session) {
          this.promptCache.unregisterSession(child.session.sessionId);
        }
        child.session?.dispose();
      }
      this.promptCache.unregisterSession(hosted.session.sessionId);
      hosted.session.dispose();
      this.bashExecutions.disposeThread(hosted.threadId);
    }
    this.threads.clear();
  }
}
