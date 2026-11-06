import type { AgentRuntimeDependencies } from "./agent-runtime-dependencies.js";
import { createSessionLifecycle } from "./session-lifecycle.js";
import { createTurnLifecycle } from "./turn-lifecycle.js";
import { createTeamLifecycle } from "./team-lifecycle.js";
import { createTeamCoordination } from "./team-coordination.js";
import { createTeamState } from "./team-state.js";
import { createCustomAgentRouting } from "./custom-agent-routing.js";
import { createChildControl } from "./child-control.js";
import { createChildObservation } from "./child-observation.js";
import { createChildTree } from "./child-tree.js";
import { createSessionObservation } from "./session-observation.js";
import { createProviderAdmission } from "./provider-admission.js";
import { createModelRuntime } from "./model-runtime.js";

import {
  MODEL_STREAM_IDLE_TIMEOUT_MILLISECONDS,
  providerRetryDelayMilliseconds,
} from "./stream-health.js";

import { parentConcurrencyLimit } from "./context-metrics.js";

import type {
  AgentSession,
  AgentSessionEvent,
  QueuedFollowUpReplacement,
  BrokerResult,
  AgentBroker,
  AgentHostSink,
  OpenThreadRequest,
  HostedThread,
  ChildAgentExecution,
  AgentTeamExecution,
  AgentTeamSnapshot,
  ChildAgentSnapshot,
} from "./runtime-types.js";

import { CodemodeWorkerPool } from "./codemode-workers.js";

import type { CustomAgentTaskInvocation } from "@artemis/protocol";

import type { TurnRecovery } from "@artemis/protocol";

import { ModelRuntime, getAgentDir } from "@earendil-works/pi-coding-agent";

import {
  AGENT_CONCURRENCY_FALLBACK,
  type CustomAgentCatalogEntry,
  type CustomAgentDefinition,
  type CustomAgentInstanceSnapshot,
  type AgentPayload,
  type AgentTeamMessagePayload,
  type AgentTeamStatusPayload,
  type ChildAgentPayload,
  type AgentRuntimeCatalog,
  type AgentRuntimeConfiguration,
  type ModelSelection,
  type ImControlIntent,
  type PromptAttachment,
  type RunMode,
  type ThreadGoal,
} from "@artemis/protocol";

import { generateCommitMessage } from "../sessions/commit-message.js";
import { classifyImControlIntent } from "../policy/im-control-intent.js";
import { generateTaskSummary } from "../sessions/task-summary.js";

import { RuntimeCredentialStore } from "./runtime-credentials.js";
import {
  AgentConcurrencyLimiter,
  type AgentConcurrencySnapshot,
} from "./agent-concurrency.js";
import { ObservedBashRegistry } from "../tools/observed-bash.js";

import { PromptCacheController } from "../context/prompt-cache.js";
import { ArtemisShellRuntime } from "../tools/shell-execution.js";

import type { ConnectionRecoveryUpdate } from "./connection-recovery.js";

import {
  CUSTOM_AGENT_CHILD_BASELINE,
  resolveCustomAgentToolCapabilities,
} from "../policy/custom-agent-capabilities.js";

export { CUSTOM_AGENT_CHILD_BASELINE, resolveCustomAgentToolCapabilities };

export class ArtemisAgentHost {
  private readonly modelRuntime = createModelRuntime(
    this.runtimeDependencies(),
  );
  private readonly providerAdmission = createProviderAdmission(
    this.runtimeDependencies(),
  );
  private readonly sessionObservation = createSessionObservation(
    this.runtimeDependencies(),
  );
  private readonly childTree = createChildTree(this.runtimeDependencies());
  private readonly childObservation = createChildObservation(
    this.runtimeDependencies(),
  );
  private readonly childControl = createChildControl(
    this.runtimeDependencies(),
  );
  private readonly customAgentRouting = createCustomAgentRouting(
    this.runtimeDependencies(),
  );
  private readonly teamState = createTeamState(this.runtimeDependencies());
  private readonly teamCoordination = createTeamCoordination(
    this.runtimeDependencies(),
  );
  private readonly teamLifecycle = createTeamLifecycle(
    this.runtimeDependencies(),
  );
  private readonly turnLifecycle = createTurnLifecycle(
    this.runtimeDependencies(),
  );
  private readonly sessionLifecycle = createSessionLifecycle(
    this.runtimeDependencies(),
  );
  private runtimeDependencies(): AgentRuntimeDependencies {
    const host = this;
    return {
      get modelRuntimePromise() {
        return host.modelRuntimePromise;
      },
      set modelRuntimePromise(
        value: AgentRuntimeDependencies["modelRuntimePromise"],
      ) {
        host.modelRuntimePromise = value;
      },
      get promptCache() {
        return host.promptCache;
      },
      get composerPredictionTokens() {
        return host.composerPredictionTokens;
      },
      get handleConnectionRecovery() {
        return host.handleConnectionRecovery.bind(host);
      },
      get modelStreamIdleTimeoutMs() {
        return host.modelStreamIdleTimeoutMs;
      },
      get credentials() {
        return host.credentials;
      },
      get configurationRevision() {
        return host.configurationRevision;
      },
      set configurationRevision(
        value: AgentRuntimeDependencies["configurationRevision"],
      ) {
        host.configurationRevision = value;
      },
      get appliedConfigurationRevision() {
        return host.appliedConfigurationRevision;
      },
      set appliedConfigurationRevision(
        value: AgentRuntimeDependencies["appliedConfigurationRevision"],
      ) {
        host.appliedConfigurationRevision = value;
      },
      get configuration() {
        return host.configuration;
      },
      set configuration(value: AgentRuntimeDependencies["configuration"]) {
        host.configuration = value;
      },
      get threads() {
        return host.threads;
      },
      get shellRuntime() {
        return host.shellRuntime;
      },
      get registeredProviderIds() {
        return host.registeredProviderIds;
      },
      get openRouterCatalogPersonalized() {
        return host.openRouterCatalogPersonalized;
      },
      set openRouterCatalogPersonalized(
        value: AgentRuntimeDependencies["openRouterCatalogPersonalized"],
      ) {
        host.openRouterCatalogPersonalized = value;
      },
      get getModelRuntime() {
        return host.getModelRuntime.bind(host);
      },
      get registeredVirtualModels() {
        return host.registeredVirtualModels;
      },
      set registeredVirtualModels(
        value: AgentRuntimeDependencies["registeredVirtualModels"],
      ) {
        host.registeredVirtualModels = value;
      },
      get agentDir() {
        return host.agentDir;
      },
      get reconcileCustomAgentChildren() {
        return host.reconcileCustomAgentChildren.bind(host);
      },
      get refreshThreadConfiguration() {
        return host.refreshThreadConfiguration.bind(host);
      },
      get configureSessionCompaction() {
        return host.configureSessionCompaction.bind(host);
      },
      get emitContextUsage() {
        return host.emitContextUsage.bind(host);
      },
      get concurrency() {
        return host.concurrency;
      },
      get codemodeWorkers() {
        return host.codemodeWorkers;
      },
      get providerAdmissionBlockedUntil() {
        return host.providerAdmissionBlockedUntil;
      },
      get sink() {
        return host.sink;
      },
      get bashExecutions() {
        return host.bashExecutions;
      },
      get emitChild() {
        return host.emitChild.bind(host);
      },
      get directChildren() {
        return host.directChildren.bind(host);
      },
      get requestChildCancellation() {
        return host.requestChildCancellation.bind(host);
      },
      get descendantAgents() {
        return host.descendantAgents.bind(host);
      },
      get childSubtreeStatus() {
        return host.childSubtreeStatus.bind(host);
      },
      get childHealth() {
        return host.childHealth.bind(host);
      },
      get childSnapshot() {
        return host.childSnapshot.bind(host);
      },
      get notifyChild() {
        return host.notifyChild.bind(host);
      },
      get refreshTeamStatus() {
        return host.refreshTeamStatus.bind(host);
      },
      get requireChildAgent() {
        return host.requireChildAgent.bind(host);
      },
      get observeChild() {
        return host.observeChild.bind(host);
      },
      get requestSubtreeCancellation() {
        return host.requestSubtreeCancellation.bind(host);
      },
      get cancelChildAgent() {
        return host.cancelChildAgent.bind(host);
      },
      get sendAgentTeamMessage() {
        return host.sendAgentTeamMessage.bind(host);
      },
      get emitTeam() {
        return host.emitTeam.bind(host);
      },
      get turnAutoCatalog() {
        return host.turnAutoCatalog.bind(host);
      },
      get emitCustomAgentRoute() {
        return host.emitCustomAgentRoute.bind(host);
      },
      get resolveCustomAgentDispatch() {
        return host.resolveCustomAgentDispatch.bind(host);
      },
      get acceptExplicitCustomAgentInvocation() {
        return host.acceptExplicitCustomAgentInvocation.bind(host);
      },
      get ensureTeam() {
        return host.ensureTeam.bind(host);
      },
      get teamPayload() {
        return host.teamPayload.bind(host);
      },
      get notifyTeam() {
        return host.notifyTeam.bind(host);
      },
      get requireActiveThread() {
        return host.requireActiveThread.bind(host);
      },
      get teamSnapshot() {
        return host.teamSnapshot.bind(host);
      },
      get validateTeamWritePaths() {
        return host.validateTeamWritePaths.bind(host);
      },
      get userInputTails() {
        return host.userInputTails;
      },
      get interruptedTeamSummary() {
        return host.interruptedTeamSummary.bind(host);
      },
      get cancelledTurns() {
        return host.cancelledTurns;
      },
      get acceptExplicitCustomAgentTasks() {
        return host.acceptExplicitCustomAgentTasks.bind(host);
      },
      get waitForProviderAdmission() {
        return host.waitForProviderAdmission.bind(host);
      },
      get recordProviderBackoff() {
        return host.recordProviderBackoff.bind(host);
      },
      get parkedDelegationTurns() {
        return host.parkedDelegationTurns;
      },
      get closeThread() {
        return host.closeThread.bind(host);
      },
      get broker() {
        return host.broker;
      },
      get cancel() {
        return host.cancel.bind(host);
      },
      get serializeUserInput() {
        return host.serializeUserInput.bind(host);
      },
      get listAgentTeam() {
        return host.listAgentTeam.bind(host);
      },
      get waitForAgentTeam() {
        return host.waitForAgentTeam.bind(host);
      },
      get suspendAgentLease() {
        return host.suspendAgentLease.bind(host);
      },
      get setAgentWriteScope() {
        return host.setAgentWriteScope.bind(host);
      },
      get finishAgentTeam() {
        return host.finishAgentTeam.bind(host);
      },
      get finishAgentSubteam() {
        return host.finishAgentSubteam.bind(host);
      },
      get waitForChildAgent() {
        return host.waitForChildAgent.bind(host);
      },
      get childAgentStatus() {
        return host.childAgentStatus.bind(host);
      },
      get steerChildAgent() {
        return host.steerChildAgent.bind(host);
      },
      get takeOverChildAgent() {
        return host.takeOverChildAgent.bind(host);
      },
      get retryChildAgent() {
        return host.retryChildAgent.bind(host);
      },
      get customAgentToolAllowed() {
        return host.customAgentToolAllowed.bind(host);
      },
      get promptCacheUsage() {
        return host.promptCacheUsage.bind(host);
      },
      get onSessionFile() {
        return host.onSessionFile;
      },
      get handleContextUsageEvent() {
        return host.handleContextUsageEvent.bind(host);
      },
    };
  }

  private readonly threads = new Map<string, HostedThread>();
  private readonly credentials: RuntimeCredentialStore;
  private readonly concurrency: AgentConcurrencyLimiter;
  private readonly codemodeWorkers: CodemodeWorkerPool;
  private readonly shellRuntime: ArtemisShellRuntime;
  private readonly bashExecutions: ObservedBashRegistry;
  private readonly cancelledTurns = new Set<string>();
  private readonly parkedDelegationTurns = new Set<string>();
  private readonly userInputTails = new Map<string, Promise<void>>();
  private registeredVirtualModels: Array<{ provider: string; id: string }> = [];
  private readonly registeredProviderIds = new Set<string>();
  private readonly providerAdmissionBlockedUntil = new Map<string, number>();
  private readonly promptCache = new PromptCacheController();
  private readonly composerPredictionTokens = new Map<string, string>();
  private readonly agentDir: string;
  private readonly onSessionFile:
    ((threadId: string, path: string) => void) | undefined;
  private configuration: AgentRuntimeConfiguration = { credentials: {} };
  private modelRuntimePromise:
    ReturnType<typeof ModelRuntime.create> | undefined;

  private handleConnectionRecovery(
    sessionId: string | undefined,
    update: ConnectionRecoveryUpdate,
  ): void {
    return this.sessionObservation.handleConnectionRecovery(sessionId, update);
  }

  private promptCacheUsage(
    sessionId: string,
    payload: Extract<AgentPayload, { type: "assistant.usage" }>,
    selection?: ModelSelection,
  ): Extract<AgentPayload, { type: "assistant.usage" }> {
    return this.sessionObservation.promptCacheUsage(
      sessionId,
      payload,
      selection,
    );
  }

  constructor(
    private readonly broker: AgentBroker,
    private readonly sink: AgentHostSink,
    options: {
      agentConcurrencyLimit?: number;
      agentDir?: string;
      modelStreamIdleTimeoutMs?: number;
      onSessionFile?: (threadId: string, path: string) => void;
      onCredentialChanged?: ConstructorParameters<
        typeof RuntimeCredentialStore
      >[0];
    } = {},
  ) {
    this.credentials = new RuntimeCredentialStore(options.onCredentialChanged);
    this.shellRuntime = new ArtemisShellRuntime();
    this.bashExecutions = new ObservedBashRegistry(this.shellRuntime);
    this.agentDir = options.agentDir ?? getAgentDir();
    this.onSessionFile = options.onSessionFile;
    const limit = options.agentConcurrencyLimit ?? AGENT_CONCURRENCY_FALLBACK;
    this.concurrency = new AgentConcurrencyLimiter(
      limit,
      parentConcurrencyLimit(limit),
      () => this.codemodeWorkers?.refresh(),
    );
    this.codemodeWorkers = new CodemodeWorkerPool(() => {
      const { limit, waiting } = this.concurrency.snapshot;
      return limit + waiting;
    });
    this.modelStreamIdleTimeoutMs =
      options.modelStreamIdleTimeoutMs ??
      MODEL_STREAM_IDLE_TIMEOUT_MILLISECONDS;
  }

  private readonly modelStreamIdleTimeoutMs: number;

  setConcurrencyLimit(limit: number): AgentConcurrencySnapshot {
    return this.providerAdmission.setConcurrencyLimit(limit);
  }

  concurrencyStatus(): AgentConcurrencySnapshot {
    return this.providerAdmission.concurrencyStatus();
  }

  private recordProviderBackoff(
    providerId: string,
    error: unknown,
    fallbackDelayMilliseconds?: number,
  ): void {
    return this.providerAdmission.recordProviderBackoff(
      providerId,
      error,
      fallbackDelayMilliseconds,
    );
  }

  private waitForProviderAdmission(
    providerId: string,
    signal?: AbortSignal,
    cancelled?: () => boolean,
  ): Promise<void> {
    return this.providerAdmission.waitForProviderAdmission(
      providerId,
      signal,
      cancelled,
    );
  }

  private serializeUserInput<T>(
    threadId: string,
    action: () => Promise<T>,
  ): Promise<T> {
    return this.turnLifecycle.serializeUserInput<T>(threadId, action);
  }

  private getModelRuntime(): ReturnType<typeof ModelRuntime.create> {
    return this.modelRuntime.getModelRuntime();
  }

  private openRouterCatalogPersonalized = false;
  private configurationRevision = 0;
  private appliedConfigurationRevision = 0;

  configure(configuration: AgentRuntimeConfiguration): Promise<void> {
    return this.modelRuntime.configure(configuration);
  }

  private refreshThreadConfiguration(hosted: HostedThread): Promise<void> {
    return this.modelRuntime.refreshThreadConfiguration(hosted);
  }

  setThreadModel(
    threadId: string,
    selection: ModelSelection,
    contextWindow: number,
  ): Promise<void> {
    return this.modelRuntime.setThreadModel(threadId, selection, contextWindow);
  }

  private configureSessionCompaction(session: AgentSession): void {
    return this.sessionObservation.configureSessionCompaction(session);
  }

  private emitContextUsage(
    hosted: HostedThread,
    compacting: boolean,
    estimatedTokens?: number,
    compactionResult?: Extract<
      AgentPayload,
      { type: "context.usage" }
    >["compactionResult"],
  ): void {
    return this.sessionObservation.emitContextUsage(
      hosted,
      compacting,
      estimatedTokens,
      compactionResult,
    );
  }

  private handleContextUsageEvent(
    hosted: HostedThread,
    event: AgentSessionEvent,
  ): void {
    return this.sessionObservation.handleContextUsageEvent(hosted, event);
  }

  private childHealth(
    child: ChildAgentExecution,
  ): ChildAgentSnapshot["health"] {
    return this.childTree.childHealth(child);
  }

  private requestChildCancellation(
    hosted: HostedThread,
    child: ChildAgentExecution,
  ): void {
    return this.childTree.requestChildCancellation(hosted, child);
  }

  private descendantAgents(
    hosted: HostedThread,
    agentId: string,
  ): ChildAgentExecution[] {
    return this.childTree.descendantAgents(hosted, agentId);
  }

  private requestSubtreeCancellation(
    hosted: HostedThread,
    child: ChildAgentExecution,
  ): void {
    return this.childTree.requestSubtreeCancellation(hosted, child);
  }

  private directChildren(
    hosted: HostedThread,
    agentId: string,
  ): ChildAgentExecution[] {
    return this.childTree.directChildren(hosted, agentId);
  }

  private childSubtreeStatus(
    hosted: HostedThread,
    child: ChildAgentExecution,
  ): NonNullable<ChildAgentPayload["subtreeStatus"]> {
    return this.childTree.childSubtreeStatus(hosted, child);
  }

  private childSnapshot(
    hosted: HostedThread,
    child: ChildAgentExecution,
    observationExpired = false,
  ): ChildAgentSnapshot {
    return this.childObservation.childSnapshot(
      hosted,
      child,
      observationExpired,
    );
  }

  private emitChild(
    hosted: HostedThread,
    child: ChildAgentExecution,
    extra:
      Pick<ChildAgentPayload, "activityDelta"> | Record<string, never> = {},
    notifyObservers = true,
  ): void {
    return this.childObservation.emitChild(
      hosted,
      child,
      extra,
      notifyObservers,
    );
  }

  private notifyChild(child: ChildAgentExecution): void {
    return this.childObservation.notifyChild(child);
  }

  private teamPayload(team: AgentTeamExecution): AgentTeamStatusPayload {
    return this.teamState.teamPayload(team);
  }

  private notifyTeam(team: AgentTeamExecution): void {
    return this.teamState.notifyTeam(team);
  }

  private emitTeam(hosted: HostedThread): void {
    return this.teamState.emitTeam(hosted);
  }

  private refreshTeamStatus(hosted: HostedThread): void {
    return this.teamState.refreshTeamStatus(hosted);
  }

  private teamSnapshot(
    hosted: HostedThread,
    observationExpired = false,
    messages?: AgentTeamMessagePayload[],
    memberAgentIds?: string[],
  ): AgentTeamSnapshot {
    return this.teamState.teamSnapshot(
      hosted,
      observationExpired,
      messages,
      memberAgentIds,
    );
  }

  private interruptedTeamSummary(hosted: HostedThread): string | undefined {
    return this.teamState.interruptedTeamSummary(hosted);
  }

  private requireChildAgent(
    threadId: string,
    agentId: string,
  ): { hosted: HostedThread; child: ChildAgentExecution } {
    return this.childTree.requireChildAgent(threadId, agentId);
  }

  private observeChild(
    child: ChildAgentExecution,
    observationMilliseconds: number,
  ): Promise<{ observationExpired: boolean; elapsedMilliseconds: number }> {
    return this.childObservation.observeChild(child, observationMilliseconds);
  }

  childAgentStatus(threadId: string, agentId: string): ChildAgentSnapshot {
    return this.childObservation.childAgentStatus(threadId, agentId);
  }

  waitForChildAgent(
    threadId: string,
    agentId: string,
    deadlineSeconds: number,
  ): Promise<ChildAgentSnapshot> {
    return this.childObservation.waitForChildAgent(
      threadId,
      agentId,
      deadlineSeconds,
    );
  }

  steerChildAgent(
    threadId: string,
    agentId: string,
    text: string,
    notifyParent = false,
  ): Promise<ChildAgentSnapshot> {
    return this.childControl.steerChildAgent(
      threadId,
      agentId,
      text,
      notifyParent,
    );
  }

  cancelChildAgent(
    threadId: string,
    agentId: string,
    notifyParent = false,
  ): Promise<ChildAgentSnapshot> {
    return this.childControl.cancelChildAgent(threadId, agentId, notifyParent);
  }

  takeOverChildAgent(
    threadId: string,
    agentId: string,
    summary: string,
  ): Promise<ChildAgentSnapshot> {
    return this.childControl.takeOverChildAgent(threadId, agentId, summary);
  }

  retryChildAgent(
    threadId: string,
    agentId: string,
    notifyParent = false,
  ): ChildAgentSnapshot {
    return this.childControl.retryChildAgent(threadId, agentId, notifyParent);
  }

  /**
   * Per-turn automatic routing catalog (D#152 PR5): enabled definitions
   * that opted into automatic invocation, in the frozen turn-catalog
   * order (main sorts selected-scope first). The manual candidate set
   * (@ mention) is a superset and lives on the renderer side; the model
   * only ever sees this automatic slice.
   */
  private turnAutoCatalog(hosted: HostedThread): {
    entries: CustomAgentCatalogEntry[];
    catalogId: string;
    overflow: boolean;
  } {
    return this.customAgentRouting.turnAutoCatalog(hosted);
  }

  /**
   * Durable routing audit (D#152 PR5 section 8): one event per dispatch
   * decision so automatic routing stays explainable and closable. The
   * record carries catalog identity and candidates, never instructions
   * or task text. invocationSource and selectionBasis are separate on
   * purpose — a model's semantic choice must not be miscounted as a
   * deterministic user invocation.
   */
  private emitCustomAgentRoute(
    hosted: HostedThread,
    payload: Omit<
      Extract<AgentPayload, { type: "custom-agent.route" }>,
      "type" | "schemaVersion" | "projectId"
    >,
  ): void {
    return this.customAgentRouting.emitCustomAgentRoute(hosted, payload);
  }

  /**
   * Resolve and freeze a custom-agent dispatch, or enforce the P1 lexical
   * contract for free-text roles (D#152 plan sections 4 and 7). Runs
   * BEFORE instance allocation and spawn-budget deduction so rejections
   * never consume budget or create half-registered members.
   *
   * Routing resolves against the per-turn catalog frozen at turn start,
   * but liveness is always cross-checked against the latest global
   * configuration: a definition disabled or deleted mid-turn blocks NEW
   * dispatches even when the frozen catalog still lists it.
   *
   * `explicit` marks a validated user invocation (structured @): the
   * referenced revision must match, and the snapshot records the
   * user-explicit source plus the idempotency key.
   */
  private resolveCustomAgentDispatch(
    hosted: HostedThread,
    senderAgentId: string,
    agentId: string | undefined,
    role: string | undefined,
    explicit?: { invocationId: string; revision: number },
  ): CustomAgentInstanceSnapshot | undefined {
    return this.customAgentRouting.resolveCustomAgentDispatch(
      hosted,
      senderAgentId,
      agentId,
      role,
      explicit,
    );
  }

  /**
   * Materialize a validated explicit user invocation (structured @) into
   * exactly one child instance (D#152 plan section 6). The host performs
   * the dispatch — the model cannot forge this source. Acceptance order
   * follows the plan: dedup → reference/revision validation → model and
   * capability resolution → budget re-check → the indivisible accept step
   * (allocate instance, register member, deduct budget once) → queue.
   *
   * Duplicate delivery of the same invocationId reuses the registered
   * instance; a stale binding whose instance is gone is outcome-unknown
   * and never silently re-dispatches.
   */
  private acceptExplicitCustomAgentTasks(
    hosted: HostedThread,
    tasks: CustomAgentTaskInvocation[],
  ): {
    agentId: string;
    definitionName: string;
    duplicate: boolean;
  }[] {
    return this.customAgentRouting.acceptExplicitCustomAgentTasks(
      hosted,
      tasks,
    );
  }

  private acceptExplicitCustomAgentInvocation(
    hosted: HostedThread,
    invocation: {
      invocationId: string;
      definitionId: string;
      revision: number;
    },
    taskText: string,
    taskBlock = false,
  ): { agentId: string; definitionName: string; duplicate: boolean } {
    return this.customAgentRouting.acceptExplicitCustomAgentInvocation(
      hosted,
      invocation,
      taskText,
      taskBlock,
    );
  }

  private customAgentToolAllowed(
    name: string,
    snapshot: CustomAgentInstanceSnapshot,
    mode: RunMode,
  ): boolean {
    return this.customAgentRouting.customAgentToolAllowed(name, snapshot, mode);
  }

  /**
   * Disable/delete revocations cancel not-yet-started custom instances and
   * free their queue slots; running instances keep their frozen snapshot
   * and remain stoppable through the existing cancellation entry points.
   */
  private reconcileCustomAgentChildren(
    definitions: CustomAgentDefinition[] | undefined,
  ): void {
    return this.customAgentRouting.reconcileCustomAgentChildren(definitions);
  }

  private ensureTeam(hosted: HostedThread): AgentTeamExecution {
    return this.teamState.ensureTeam(hosted);
  }

  private validateTeamWritePaths(
    hosted: HostedThread,
    agentId: string | undefined,
    paths: string[],
  ): string[] {
    return this.teamState.validateTeamWritePaths(hosted, agentId, paths);
  }

  private suspendAgentLease<T>(
    threadId: string,
    actorAgentId: string,
    task: () => Promise<T>,
  ): Promise<T> {
    return this.teamState.suspendAgentLease<T>(threadId, actorAgentId, task);
  }

  listAgentTeam(threadId: string): AgentTeamSnapshot {
    return this.teamState.listAgentTeam(threadId);
  }

  waitForAgentTeam(
    threadId: string,
    observerAgentId: string,
    deadlineSeconds: number,
  ): Promise<AgentTeamSnapshot> {
    return this.teamCoordination.waitForAgentTeam(
      threadId,
      observerAgentId,
      deadlineSeconds,
    );
  }

  sendAgentTeamMessage(
    threadId: string,
    senderAgentId: string,
    recipient: string,
    kind: AgentTeamMessagePayload["kind"],
    content: string,
  ): Promise<AgentTeamMessagePayload> {
    return this.teamCoordination.sendAgentTeamMessage(
      threadId,
      senderAgentId,
      recipient,
      kind,
      content,
    );
  }

  setAgentWriteScope(
    threadId: string,
    agentId: string,
    paths: string[],
  ): ChildAgentSnapshot {
    return this.teamCoordination.setAgentWriteScope(threadId, agentId, paths);
  }

  finishAgentTeam(
    threadId: string,
    waivedAgentIds: string[],
    summary: string,
  ): AgentTeamSnapshot {
    return this.teamLifecycle.finishAgentTeam(
      threadId,
      waivedAgentIds,
      summary,
    );
  }

  finishAgentSubteam(
    threadId: string,
    actorAgentId: string,
    waivedAgentIds: string[],
    summary: string,
  ): Promise<ChildAgentSnapshot> {
    return this.teamLifecycle.finishAgentSubteam(
      threadId,
      actorAgentId,
      waivedAgentIds,
      summary,
    );
  }

  cancelAgentTeam(
    threadId: string,
    teamId: string,
    notifyParent = false,
  ): Promise<AgentTeamSnapshot> {
    return this.teamLifecycle.cancelAgentTeam(threadId, teamId, notifyParent);
  }

  catalog(): Promise<AgentRuntimeCatalog> {
    return this.modelRuntime.catalog();
  }

  generateCommitMessage(
    diff: string,
    selection: ModelSelection | undefined,
    locale: string,
  ): Promise<string> {
    return this.modelRuntime.generateCommitMessage(diff, selection, locale);
  }

  classifyImControlIntent(
    taskTitle: string,
    message: string,
    selection?: ModelSelection,
  ): Promise<ImControlIntent> {
    return this.modelRuntime.classifyImControlIntent(
      taskTitle,
      message,
      selection,
    );
  }

  generateTaskSummary(
    title: string,
    selection: ModelSelection | undefined,
    locale: string,
  ): Promise<string> {
    return this.modelRuntime.generateTaskSummary(title, selection, locale);
  }

  openThread(request: OpenThreadRequest): Promise<{
    sessionFile?: string;
  }> {
    return this.sessionLifecycle.openThread(request);
  }

  prompt(
    threadId: string,
    turnId: string,
    text: string,
    mode: RunMode,
    attachments?: PromptAttachment[],
    goal?: ThreadGoal,
    memoryContext?: string,
    collaborationContext?: string,
    recovery?: TurnRecovery,
    customAgents?: CustomAgentDefinition[],
    customAgentInvocation?: {
      invocationId: string;
      definitionId: string;
      revision: number;
    },
    customAgentProjectId?: string | null,
    customAgentTasks?: CustomAgentTaskInvocation[],
    composerPredictions = false,
  ): Promise<void> {
    return this.turnLifecycle.prompt(
      threadId,
      turnId,
      text,
      mode,
      attachments,
      goal,
      memoryContext,
      collaborationContext,
      recovery,
      customAgents,
      customAgentInvocation,
      customAgentProjectId,
      customAgentTasks,
      composerPredictions,
    );
  }

  cancel(threadId: string): Promise<void> {
    return this.turnLifecycle.cancel(threadId);
  }

  compact(
    threadId: string,
    customInstructions?: string,
    mode: RunMode = "plan",
  ): Promise<void> {
    return this.turnLifecycle.compact(threadId, customInstructions, mode);
  }

  steer(
    threadId: string,
    text: string,
    attachments?: PromptAttachment[],
  ): Promise<void> {
    return this.turnLifecycle.steer(threadId, text, attachments);
  }

  followUp(
    threadId: string,
    text: string,
    attachments?: PromptAttachment[],
  ): Promise<void> {
    return this.turnLifecycle.followUp(threadId, text, attachments);
  }

  clearQueue(threadId: string): {
    steering: string[];
    followUp: string[];
  } {
    return this.turnLifecycle.clearQueue(threadId);
  }

  steerQueue(threadId: string): Promise<void> {
    return this.turnLifecycle.steerQueue(threadId);
  }

  steerQueuedFollowUp(
    threadId: string,
    followUpIndex: number,
    expectedFollowUp: readonly string[],
  ): Promise<void> {
    return this.turnLifecycle.steerQueuedFollowUp(
      threadId,
      followUpIndex,
      expectedFollowUp,
    );
  }

  replaceFollowUpQueue(
    threadId: string,
    expectedFollowUp: string[],
    followUp: QueuedFollowUpReplacement[],
  ): Promise<void> {
    return this.turnLifecycle.replaceFollowUpQueue(
      threadId,
      expectedFollowUp,
      followUp,
    );
  }

  forkThread(threadId: string, entryId?: string): { sessionFile: string } {
    return this.sessionLifecycle.forkThread(threadId, entryId);
  }

  closeThread(threadId: string): void {
    return this.sessionLifecycle.closeThread(threadId);
  }

  deleteThread(threadId: string, sessionFile?: string): Promise<void> {
    return this.sessionLifecycle.deleteThread(threadId, sessionFile);
  }

  private requireActiveThread(threadId: string): HostedThread {
    return this.sessionLifecycle.requireActiveThread(threadId);
  }

  dispose(): void {
    return this.sessionLifecycle.dispose();
  }
}

export {
  type BrokerResult,
  type AgentBroker,
  type AgentHostSink,
  type OpenThreadRequest,
  type AgentTeamSnapshot,
  type ChildAgentSnapshot,
} from "./runtime-types.js";

export { providerRetryDelayMilliseconds } from "./stream-health.js";
