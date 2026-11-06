import type {
  AgentSession,
  AgentSessionEvent,
  AgentBroker,
  AgentHostSink,
  HostedThread,
  ChildAgentExecution,
  AgentTeamExecution,
  AgentTeamSnapshot,
  ChildAgentSnapshot,
} from "./runtime-types.js";
import type { CodemodeWorkerPool } from "./codemode-workers.js";
import type { CustomAgentTaskInvocation } from "@artemis/protocol";

import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type {
  CustomAgentCatalogEntry,
  CustomAgentDefinition,
  CustomAgentInstanceSnapshot,
  AgentPayload,
  AgentTeamMessagePayload,
  AgentTeamStatusPayload,
  ChildAgentPayload,
  AgentRuntimeConfiguration,
  ModelSelection,
  RunMode,
} from "@artemis/protocol";
import type { RuntimeCredentialStore } from "./runtime-credentials.js";
import type { AgentConcurrencyLimiter } from "./agent-concurrency.js";
import type { ObservedBashRegistry } from "../tools/observed-bash.js";
import type { PromptCacheController } from "../context/prompt-cache.js";
import type { ArtemisShellRuntime } from "../tools/shell-execution.js";
import type { ConnectionRecoveryUpdate } from "./connection-recovery.js";

export interface AgentRuntimeDependencies {
  modelRuntimePromise: ReturnType<typeof ModelRuntime.create> | undefined;
  readonly promptCache: PromptCacheController;
  readonly composerPredictionTokens: Map<string, string>;
  handleConnectionRecovery(
    sessionId: string | undefined,
    update: ConnectionRecoveryUpdate,
  ): void;
  readonly modelStreamIdleTimeoutMs: number;
  readonly credentials: RuntimeCredentialStore;
  configurationRevision: number;
  appliedConfigurationRevision: number;
  configuration: AgentRuntimeConfiguration;
  readonly threads: Map<string, HostedThread>;
  readonly shellRuntime: ArtemisShellRuntime;
  readonly registeredProviderIds: Set<string>;
  openRouterCatalogPersonalized: boolean;
  getModelRuntime(): ReturnType<typeof ModelRuntime.create>;
  registeredVirtualModels: Array<{
    provider: string;
    id: string;
  }>;
  readonly agentDir: string;
  reconcileCustomAgentChildren(
    definitions: CustomAgentDefinition[] | undefined,
  ): void;
  refreshThreadConfiguration(hosted: HostedThread): Promise<void>;
  configureSessionCompaction(session: AgentSession): void;
  emitContextUsage(
    hosted: HostedThread,
    compacting: boolean,
    estimatedTokens?: number,
    compactionResult?: Extract<
      AgentPayload,
      {
        type: "context.usage";
      }
    >["compactionResult"],
  ): void;
  readonly concurrency: AgentConcurrencyLimiter;
  readonly codemodeWorkers: CodemodeWorkerPool;
  readonly providerAdmissionBlockedUntil: Map<string, number>;
  readonly sink: AgentHostSink;
  readonly bashExecutions: ObservedBashRegistry;
  emitChild(
    hosted: HostedThread,
    child: ChildAgentExecution,
    extra?: Pick<ChildAgentPayload, "activityDelta"> | Record<string, never>,
    notifyObservers?: boolean,
  ): void;
  directChildren(hosted: HostedThread, agentId: string): ChildAgentExecution[];
  requestChildCancellation(
    hosted: HostedThread,
    child: ChildAgentExecution,
  ): void;
  descendantAgents(
    hosted: HostedThread,
    agentId: string,
  ): ChildAgentExecution[];
  childSubtreeStatus(
    hosted: HostedThread,
    child: ChildAgentExecution,
  ): NonNullable<ChildAgentPayload["subtreeStatus"]>;
  childHealth(child: ChildAgentExecution): ChildAgentSnapshot["health"];
  childSnapshot(
    hosted: HostedThread,
    child: ChildAgentExecution,
    observationExpired?: boolean,
  ): ChildAgentSnapshot;
  notifyChild(child: ChildAgentExecution): void;
  refreshTeamStatus(hosted: HostedThread): void;
  requireChildAgent(
    threadId: string,
    agentId: string,
  ): {
    hosted: HostedThread;
    child: ChildAgentExecution;
  };
  observeChild(
    child: ChildAgentExecution,
    observationMilliseconds: number,
  ): Promise<{
    observationExpired: boolean;
    elapsedMilliseconds: number;
  }>;
  requestSubtreeCancellation(
    hosted: HostedThread,
    child: ChildAgentExecution,
  ): void;
  cancelChildAgent(
    threadId: string,
    agentId: string,
    notifyParent?: boolean,
  ): Promise<ChildAgentSnapshot>;
  sendAgentTeamMessage(
    threadId: string,
    senderAgentId: string,
    recipient: string,
    kind: AgentTeamMessagePayload["kind"],
    content: string,
  ): Promise<AgentTeamMessagePayload>;
  emitTeam(hosted: HostedThread): void;
  turnAutoCatalog(hosted: HostedThread): {
    entries: CustomAgentCatalogEntry[];
    catalogId: string;
    overflow: boolean;
  };
  emitCustomAgentRoute(
    hosted: HostedThread,
    payload: Omit<
      Extract<
        AgentPayload,
        {
          type: "custom-agent.route";
        }
      >,
      "type" | "schemaVersion" | "projectId"
    >,
  ): void;
  resolveCustomAgentDispatch(
    hosted: HostedThread,
    senderAgentId: string,
    agentId: string | undefined,
    role: string | undefined,
    explicit?: {
      invocationId: string;
      revision: number;
    },
  ): CustomAgentInstanceSnapshot | undefined;
  acceptExplicitCustomAgentInvocation(
    hosted: HostedThread,
    invocation: {
      invocationId: string;
      definitionId: string;
      revision: number;
    },
    taskText: string,
    taskBlock?: boolean,
  ): {
    agentId: string;
    definitionName: string;
    duplicate: boolean;
  };
  ensureTeam(hosted: HostedThread): AgentTeamExecution;
  teamPayload(team: AgentTeamExecution): AgentTeamStatusPayload;
  notifyTeam(team: AgentTeamExecution): void;
  requireActiveThread(threadId: string): HostedThread;
  teamSnapshot(
    hosted: HostedThread,
    observationExpired?: boolean,
    messages?: AgentTeamMessagePayload[],
    memberAgentIds?: string[],
  ): AgentTeamSnapshot;
  validateTeamWritePaths(
    hosted: HostedThread,
    agentId: string | undefined,
    paths: string[],
  ): string[];
  readonly userInputTails: Map<string, Promise<void>>;
  interruptedTeamSummary(hosted: HostedThread): string | undefined;
  readonly cancelledTurns: Set<string>;
  acceptExplicitCustomAgentTasks(
    hosted: HostedThread,
    tasks: CustomAgentTaskInvocation[],
  ): {
    agentId: string;
    definitionName: string;
    duplicate: boolean;
  }[];
  waitForProviderAdmission(
    providerId: string,
    signal?: AbortSignal,
    cancelled?: () => boolean,
  ): Promise<void>;
  recordProviderBackoff(
    providerId: string,
    error: unknown,
    fallbackDelayMilliseconds?: number,
  ): void;
  readonly parkedDelegationTurns: Set<string>;
  closeThread(threadId: string): void;
  readonly broker: AgentBroker;
  cancel(threadId: string): Promise<void>;
  serializeUserInput<T>(threadId: string, action: () => Promise<T>): Promise<T>;
  listAgentTeam(threadId: string): AgentTeamSnapshot;
  waitForAgentTeam(
    threadId: string,
    observerAgentId: string,
    deadlineSeconds: number,
  ): Promise<AgentTeamSnapshot>;
  suspendAgentLease<T>(
    threadId: string,
    actorAgentId: string,
    task: () => Promise<T>,
  ): Promise<T>;
  setAgentWriteScope(
    threadId: string,
    agentId: string,
    paths: string[],
  ): ChildAgentSnapshot;
  finishAgentTeam(
    threadId: string,
    waivedAgentIds: string[],
    summary: string,
  ): AgentTeamSnapshot;
  finishAgentSubteam(
    threadId: string,
    actorAgentId: string,
    waivedAgentIds: string[],
    summary: string,
  ): Promise<ChildAgentSnapshot>;
  waitForChildAgent(
    threadId: string,
    agentId: string,
    deadlineSeconds: number,
  ): Promise<ChildAgentSnapshot>;
  childAgentStatus(threadId: string, agentId: string): ChildAgentSnapshot;
  steerChildAgent(
    threadId: string,
    agentId: string,
    text: string,
    notifyParent?: boolean,
  ): Promise<ChildAgentSnapshot>;
  takeOverChildAgent(
    threadId: string,
    agentId: string,
    summary: string,
  ): Promise<ChildAgentSnapshot>;
  retryChildAgent(
    threadId: string,
    agentId: string,
    notifyParent?: boolean,
  ): ChildAgentSnapshot;
  customAgentToolAllowed(
    name: string,
    snapshot: CustomAgentInstanceSnapshot,
    mode: RunMode,
  ): boolean;
  promptCacheUsage(
    sessionId: string,
    payload: Extract<
      AgentPayload,
      {
        type: "assistant.usage";
      }
    >,
    selection?: ModelSelection,
  ): Extract<
    AgentPayload,
    {
      type: "assistant.usage";
    }
  >;
  readonly onSessionFile:
    ((threadId: string, path: string) => void) | undefined;
  handleContextUsageEvent(hosted: HostedThread, event: AgentSessionEvent): void;
}
