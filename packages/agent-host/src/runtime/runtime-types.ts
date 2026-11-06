import type { RemoteExecutionProfile } from "@artemis/protocol";
import type {
  DefaultResourceLoader,
  createAgentSession,
} from "@earendil-works/pi-coding-agent";
import type {
  CustomAgentDefinition,
  CustomAgentInstanceSnapshot,
  PiAdapter,
  AgentPayload,
  AgentTeamMessagePayload,
  AgentTeamStatusPayload,
  ChildAgentPayload,
  BrokerExecutionRequest,
  ModelSelection,
  RunMode,
  WorkspaceTarget,
} from "@artemis/protocol";
import type { AgentConcurrencyLease } from "./agent-concurrency.js";
import type { createModelStreamIdleWatchdog } from "./stream-health.js";
export type AgentSession = Awaited<
  ReturnType<typeof createAgentSession>
>["session"];

export type AgentSessionEvent = Parameters<
  Parameters<AgentSession["subscribe"]>[0]
>[0];

export type SessionTool = AgentSession["agent"]["state"]["tools"][number];

export type PromptOptions = NonNullable<Parameters<AgentSession["prompt"]>[1]>;

export type SessionImage = NonNullable<PromptOptions["images"]>[number];

export interface ContextFootprint {
  textBytes: number;
  imageBytes: number;
  imageCount: number;
  toolSchemaBytes: number;
  largestToolResultBytes: number;
}

export interface ContextTokenBreakdown {
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

export interface QueuedFollowUpReplacement {
  sourceIndex: number;
  text: string;
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
  remoteExecution?: RemoteExecutionProfile;
  groupCollaboration?: boolean;
  threadId: string;
  workspacePath: string;
  target: WorkspaceTarget;
  sessionFile?: string;
  selection?: ModelSelection;
  contextWindow?: number;
  /** @deprecated Accepted for old clients; ignored in favor of mode/tool policy. */
  executionProfile?: string;
  /**
   * S2 design-plugin binding snapshot for this thread. Threads opened with
   * a binding get the plugin's declared tools injected as broker-mediated
   * customTools (the tool body always round-trips to the main process
   * dispatcher; the agent-host never spawns plugin runtimes itself).
   */
  typeBinding?: {
    installationId: string;
    pluginId: string;
    typeId: string;
    pluginVersion: string;
    contentHash: string;
    bindingRevision: string;
  };
  /**
   * Declared plugin tools for the bound plugin (resolved by the main
   * process from the published revision manifest before open).
   */
  pluginTools?: Array<{
    name: string;
    description: string;
    effect: "artifact-write" | "state-read";
  }>;
}

export interface HostedThread {
  currentAttachmentIds?: string[];
  threadId: string;
  workspacePath: string;
  target: WorkspaceTarget;
  typeBinding?: OpenThreadRequest["typeBinding"];
  selection?: ModelSelection;
  contextWindow?: number;
  session: AgentSession;
  resourceLoader: DefaultResourceLoader;
  configurationPending?: boolean;
  refreshMcpTools(): Promise<boolean>;
  currentTurnId: string | undefined;
  currentMode: RunMode | undefined;
  compacting: boolean;
  topLevelUserTurns: number;
  readTool?: SessionTool;
  writeTool?: SessionTool;
  mcpToolNames: Set<string>;
  mcpDirectToolNames: Set<string>;
  delegatedTools: SessionTool[];
  executeTools: SessionTool[];
  childAgents: Map<string, ChildAgentExecution>;
  activeLeases: Map<string, AgentConcurrencyLease>;
  /**
   * Per-turn effective custom sub-agent definitions, frozen when the turn
   * starts (D#152). Routing resolves against this catalog; falls back to
   * the latest global configuration when unset.
   */
  turnCustomAgents?: CustomAgentDefinition[];
  customAgentProjectId?: string | null;
  /**
   * Explicit user invocation bindings (invocationId → agentId) for this
   * thread. A duplicate delivery of the same invocation reuses the
   * registered instance instead of creating a second one.
   */
  explicitCustomAgentInvocations: Map<string, string>;
  currentMission: string | undefined;
  team: AgentTeamExecution | undefined;
  interruptedTeamContext: string | undefined;
  recoveredQueueMessages: string[];
  deferredTurnCompletion: AgentPayload | undefined;
  modelStreamWatchdog?: ReturnType<typeof createModelStreamIdleWatchdog>;
  launchChildAgent(input: LaunchChildAgentInput): ChildAgentExecution;
  adapter: PiAdapter | undefined;
  unsubscribe: () => void;
}

export interface LaunchChildAgentInput {
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
  /**
   * Immutable per-instance configuration frozen at dispatch-accept time
   * (D#152): definition content, resolved model, and the capability
   * ceiling. Later edits or parent model switches never widen an accepted
   * instance.
   */
  customAgentSnapshot?: CustomAgentInstanceSnapshot;
}

export interface ChildAgentExecution extends LaunchChildAgentInput {
  agentId: string;
  status: ChildAgentPayload["status"];
  controller: AbortController;
  session?: AgentSession;
  modelStreamWatchdog?: ReturnType<typeof createModelStreamIdleWatchdog>;
  createdAt: number;
  startedAt?: number;
  updatedAt: number;
  lastActivityAt: number;
  currentTool?: string;
  currentToolStartedAt?: number;
  output: string;
  error?: string;
  pendingSteers: string[];
  recentObservationMilliseconds: number[];
  activityVersion: number;
  activityWaiters: Set<() => void>;
  subtreeIntegrated: boolean;
  subtreeSummary?: string;
  done: Promise<void>;
  settle(): void;
}

export interface AgentTeamExecution {
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
    {
      messageSequence: number;
      memberVersions: Map<string, number>;
      memberHealth: Map<string, ChildAgentSnapshot["health"]>;
    }
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
  snapshotKind: "full" | "delta";
  blockingAgentIds: string[];
  observation?: { startedAt: string; observedAt: string; resumedAt?: string };
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
  queueReason?: "dependency" | "capacity";
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
  customAgent?: NonNullable<ChildAgentPayload["customAgent"]>;
}
