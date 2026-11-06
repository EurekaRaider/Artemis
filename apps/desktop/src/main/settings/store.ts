import type { StoreDependencies } from "./persistence/store-dependencies.js";
import { createCustomAgentRepository } from "./persistence/custom-agent-repository.js";
import { createTurnChangesRepository } from "./persistence/turn-changes-repository.js";
import { createAutomationRepository } from "./persistence/automation-repository.js";
import { createReviewRepository } from "./persistence/review-repository.js";
import { createApprovalRepository } from "./persistence/approval-repository.js";
import { createGoalRepository } from "./persistence/goal-repository.js";
import { createWorkspaceRepository } from "./persistence/workspace-repository.js";
import { createThreadRepository } from "./persistence/thread-repository.js";
import { createPluginRepository } from "./persistence/plugin-repository.js";
import { createProjectRepository } from "./persistence/project-repository.js";
import { createConversationRepository } from "./persistence/conversation-repository.js";
import { initializeStoreDatabase } from "./store-migrations.js";
import { projectFromRow, agentEventFromBody } from "./store-row-codecs.js";
import {
  CUSTOM_AGENTS_DATABASE_VERSION,
  CURRENT_DATABASE_VERSION,
  DESIGN_PLUGIN_DATABASE_VERSION,
} from "./store-schema.js";
import {
  type ProjectRow,
  type TurnChangeSetRecord,
  type EventAppendInput,
  type ApprovalGrant,
  type ApprovalGrantQuery,
} from "./store-types.js";

import { DatabaseSync } from "node:sqlite";

import {
  type PlanAcceptance,
  type ProposedPlan,
  type AgentEvent,
  type AgentPayload,
  type AppSnapshot,
  type ApprovalScope,
  type Automation,
  type AutomationRun,
  type AutomationRunState,
  type ModelSelection,
  type Project,
  type TaskWorktree,
  type Thread,
  type ThreadGoal,
  type ThreadGoalStatus,
  type CustomAgentDefinition,
  type CustomAgentInvocationRecord,
  type CustomAgentInvocationStatus,
  type CustomAgentModelPolicy,
  type CustomAgentThinkingPolicy,
  type CustomAgentToolPolicy,
  type SubmissionLedgerRecord,
  type SubmissionState,
} from "@artemis/protocol";

import type { ReviewComment, ReviewCommentAnchor } from "../../shared/api.js";
import type { TurnCheckpoint } from "../conversation/turn-recovery.js";

import { TaskNotificationStore } from "../conversation/task-notification-store.js";

export class AppStore {
  private readonly conversationRepository = createConversationRepository(
    this.runtimeDependencies(),
  );
  private readonly projectRepository = createProjectRepository(
    this.runtimeDependencies(),
  );
  private readonly pluginRepository = createPluginRepository(
    this.runtimeDependencies(),
  );
  private readonly threadRepository = createThreadRepository(
    this.runtimeDependencies(),
  );
  private readonly workspaceRepository = createWorkspaceRepository(
    this.runtimeDependencies(),
  );
  private readonly goalRepository = createGoalRepository(
    this.runtimeDependencies(),
  );
  private readonly approvalRepository = createApprovalRepository(
    this.runtimeDependencies(),
  );
  private readonly reviewRepository = createReviewRepository(
    this.runtimeDependencies(),
  );
  private readonly automationRepository = createAutomationRepository(
    this.runtimeDependencies(),
  );
  private readonly turnChangesRepository = createTurnChangesRepository(
    this.runtimeDependencies(),
  );
  private readonly customAgentRepository = createCustomAgentRepository(
    this.runtimeDependencies(),
  );
  private runtimeDependencies(): StoreDependencies {
    const host = this;
    return {
      get getThreadEvents() {
        return host.getThreadEvents.bind(host);
      },
      get getThread() {
        return host.getThread.bind(host);
      },
      get plans() {
        return host.plans.bind(host);
      },
      get appendEvent() {
        return host.appendEvent.bind(host);
      },
      get appendEventsCore() {
        return host.appendEventsCore.bind(host);
      },
      get database() {
        return host.database;
      },
      get updateThread() {
        return host.updateThread.bind(host);
      },
      get saveTurnCheckpoint() {
        return host.saveTurnCheckpoint.bind(host);
      },
      get clearTurnCheckpoint() {
        return host.clearTurnCheckpoint.bind(host);
      },
      get updateAutomationRunForThread() {
        return host.updateAutomationRunForThread.bind(host);
      },
      get completeAutomationRunForThreadCore() {
        return host.completeAutomationRunForThreadCore.bind(host);
      },
      get getTurnCheckpoint() {
        return host.getTurnCheckpoint.bind(host);
      },
      get getProjectByPath() {
        return host.getProjectByPath.bind(host);
      },
      get getProject() {
        return host.getProject.bind(host);
      },
      get getPromptSubmission() {
        return host.getPromptSubmission.bind(host);
      },
      get nextSubmissionSequence() {
        return host.nextSubmissionSequence.bind(host);
      },
      get getThreadGoal() {
        return host.getThreadGoal.bind(host);
      },
      get notifications() {
        return host.notifications;
      },
      get insertWorktree() {
        return host.insertWorktree.bind(host);
      },
      get getWorktree() {
        return host.getWorktree.bind(host);
      },
      get createThread() {
        return host.createThread.bind(host);
      },
      get attachWorktree() {
        return host.attachWorktree.bind(host);
      },
      get updateWorktree() {
        return host.updateWorktree.bind(host);
      },
      get copyThreadEventsCore() {
        return host.copyThreadEventsCore.bind(host);
      },
      get mutateThreadGoal() {
        return host.mutateThreadGoal.bind(host);
      },
      get setThreadGoal() {
        return host.setThreadGoal.bind(host);
      },
      get updateThreadGoalStatus() {
        return host.updateThreadGoalStatus.bind(host);
      },
      get listReviewComments() {
        return host.listReviewComments.bind(host);
      },
      get getAutomation() {
        return host.getAutomation.bind(host);
      },
      get updateAutomation() {
        return host.updateAutomation.bind(host);
      },
      get getAutomationRun() {
        return host.getAutomationRun.bind(host);
      },
      get getAutomationRunForThread() {
        return host.getAutomationRunForThread.bind(host);
      },
      get updateAutomationRun() {
        return host.updateAutomationRun.bind(host);
      },
      get softDeleteAutomation() {
        return host.softDeleteAutomation.bind(host);
      },
      get getTurnChangeSet() {
        return host.getTurnChangeSet.bind(host);
      },
      get getCustomAgent() {
        return host.getCustomAgent.bind(host);
      },
      get listCustomAgents() {
        return host.listCustomAgents.bind(host);
      },
      get listCustomAgentProjectIds() {
        return host.listCustomAgentProjectIds.bind(host);
      },
      get getCustomAgentInvocation() {
        return host.getCustomAgentInvocation.bind(host);
      },
      get upsertCustomAgentInvocation() {
        return host.upsertCustomAgentInvocation.bind(host);
      },
      get transitionCustomAgentInvocation() {
        return host.transitionCustomAgentInvocation.bind(host);
      },
    };
  }

  private readonly database: DatabaseSync;
  readonly notifications: TaskNotificationStore;

  constructor(databasePath: string) {
    this.database = new DatabaseSync(databasePath);
    initializeStoreDatabase(this.database);
    this.notifications = new TaskNotificationStore(this.database);
  }

  plans(threadId: string): import("@artemis/protocol").SavedPlan[] {
    return this.conversationRepository.plans(threadId);
  }

  proposePlan(
    threadId: string,
    turnId: string,
    content: Pick<ProposedPlan, "title" | "markdown" | "actionable">,
  ): ProposedPlan {
    return this.conversationRepository.proposePlan(threadId, turnId, content);
  }

  upsertProject(project: Project): Project {
    return this.projectRepository.upsertProject(project);
  }

  removeProject(id: string): void {
    return this.projectRepository.removeProject(id);
  }

  getProject(id: string): Project | undefined {
    return this.projectRepository.getProject(id);
  }

  getProjectByPath(path: string): Project | undefined {
    return this.projectRepository.getProjectByPath(path);
  }

  // -------------------------------------------------------------------------
  // S1 design-plugin persistence (proposal §6.1). All six tables live in the
  // main database and reuse the same transaction discipline as the rest of
  // the store. The methods below are the store layer only: policy (gates,
  // dispatch guards) stays in design-plugin-tool-gate and the runtime worker.
  // -------------------------------------------------------------------------

  /** Insert a plugin grant row; idempotent on the natural key. */
  insertPluginGrant(grant: {
    grantId: string;
    installationId: string;
    pluginId: string;
    contentHash: string;
    scope: "thread" | "project";
    scopeId: string;
    capabilities: Record<string, unknown>;
    resourceRefs: Record<string, unknown>;
    grantRevision: string;
  }): void {
    return this.pluginRepository.insertPluginGrant(grant);
  }

  /**
   * S2 trust chain: revoke every non-revoked grant for one installation.
   * Dispatch checks treat a revoked grant as no grant, so plugin tool calls
   * are refused from the moment this commits.
   */
  revokePluginGrants(installationId: string): number {
    return this.pluginRepository.revokePluginGrants(installationId);
  }

  listPluginGrants(scopeId: string): Array<Record<string, unknown>> {
    return this.pluginRepository.listPluginGrants(scopeId);
  }

  /**
   * Accept a prompt submission into the converged ledger. Idempotent by
   * submissionId: the same payload returns the stored record, a different
   * payload under the same id is rejected as ledger corruption (S0 §9.3
   * invariants preserved in the main database).
   */
  acceptPromptSubmission(input: {
    submissionId: string;
    threadId: string;
    source: "panel" | "composer";
    candidateText: string;
    bindingRevision: string;
  }): SubmissionLedgerRecord {
    return this.pluginRepository.acceptPromptSubmission(input);
  }

  getPromptSubmission(
    submissionId: string,
  ): SubmissionLedgerRecord | undefined {
    return this.pluginRepository.getPromptSubmission(submissionId);
  }

  /**
   * Transition a submission through the protocol state machine. Invalid
   * transitions throw; valid ones update state, reason and timestamp in one
   * statement. Crash-window recovery reads the rows and reconciles instead of
   * blind re-dispatch. PR#245 P2-10: an optional turnId binds the submission
   * to the turn it started (immutable once set; a conflicting rebind throws).
   */
  transitionPromptSubmission(
    submissionId: string,
    nextState: SubmissionState,
    reason: string,
    turnId?: string,
  ): SubmissionLedgerRecord {
    return this.pluginRepository.transitionPromptSubmission(
      submissionId,
      nextState,
      reason,
      turnId,
    );
  }

  listPromptSubmissions(threadId: string): SubmissionLedgerRecord[] {
    return this.pluginRepository.listPromptSubmissions(threadId);
  }

  private nextSubmissionSequence(threadId: string): number {
    return this.pluginRepository.nextSubmissionSequence(threadId);
  }

  /**
   * S2 state transactions: run work inside BEGIN IMMEDIATE / COMMIT with
   * rollback on throw. The design-plugin state layer uses this to commit
   * snapshot + head + event as one atomic unit (proposal §6.1).
   */
  commitPluginStateTransaction<T>(work: () => T): T {
    return this.pluginRepository.commitPluginStateTransaction<T>(work);
  }

  /** Read one plugin state head; undefined when the plugin has no state. */
  readPluginStateHead(input: {
    threadId: string;
    pluginId: string;
    stateSchemaVersion: number;
  }):
    | {
        stateRevision: string;
        snapshotId: string;
        bindingRevision: string;
        updatedAt: string;
      }
    | undefined {
    return this.pluginRepository.readPluginStateHead(input);
  }

  /**
   * Insert-or-advance one plugin state head (UPSERT). Writers must prefer
   * commitPluginStateChange() which CAS-guards this write; this raw method
   * exists for the initial head creation and store-internal recovery paths.
   */
  upsertPluginStateHead(input: {
    threadId: string;
    pluginId: string;
    stateSchemaVersion: number;
    bindingRevision: string;
    stateRevision: string;
    snapshotId: string;
  }): void {
    return this.pluginRepository.upsertPluginStateHead(input);
  }

  /** Insert an immutable plugin snapshot row. */
  insertPluginSnapshot(snapshot: {
    snapshotId: string;
    threadId: string;
    pluginId: string;
    files: Array<{ path: string; hash: string }>;
    parentSnapshotId?: string;
    createdByOperationId?: string;
    packageRevision: string;
  }): void {
    return this.pluginRepository.insertPluginSnapshot(snapshot);
  }

  /**
   * Record a plugin operation. Repeated calls with the same operationId and
   * identical request digest are resolved by the state machine below instead
   * of silently returning (PR#245 P2-12: the old early-return made
   * running→succeeded writes no-ops, leaving terminal operations stuck in
   * `running`).
   *
   * Legal forward transitions only: prepared→running→succeeded/failed/
   * cancelled (and prepared→cancelled). A terminal state accepts only the
   * idempotent re-commit of itself; anything else — replays after terminal
   * states, backwards moves, or digest conflicts — throws so the caller can
   * stop re-executing and surface the stored outcome.
   */
  recordPluginOperation(operation: {
    operationId: string;
    threadId: string;
    pluginId: string;
    toolName: string;
    requestDigest: string;
    state: "prepared" | "running" | "succeeded" | "failed" | "cancelled";
    resultRef?: string;
    result?: unknown;
    error?: string;
  }): void {
    return this.pluginRepository.recordPluginOperation(operation);
  }

  /**
   * PR#245 P2-12：读取操作账本的当前状态，供调用方在执行前做重放判定
   *（已成功的操作直接取回已存结果，不再重复执行）。
   */
  readPluginOperation(operationId: string):
    | {
        operationId: string;
        threadId: string;
        pluginId: string;
        toolName: string;
        requestDigest: string;
        state: "prepared" | "running" | "succeeded" | "failed" | "cancelled";
        resultRef?: string;
        result?: unknown;
        error?: string;
      }
    | undefined {
    return this.pluginRepository.readPluginOperation(operationId);
  }

  /**
   * Append one plugin event inside the caller's transaction discipline. The
   * stream seq is allocated per (streamId) and the UNIQUE constraint keeps
   * concurrent appends honest; on violation the insert throws and the caller
   * retries with the next seq (no partial publishes).
   */
  appendPluginEvent(event: {
    eventId: string;
    streamId: string;
    threadId: string;
    schemaVersion: number;
    payload: Record<string, unknown>;
  }): void {
    return this.pluginRepository.appendPluginEvent(event);
  }

  createThread(thread: Thread): Thread {
    return this.threadRepository.createThread(thread);
  }

  private insertWorktree(worktree: TaskWorktree): TaskWorktree {
    return this.workspaceRepository.insertWorktree(worktree);
  }

  private attachWorktree(worktree: TaskWorktree): TaskWorktree {
    return this.workspaceRepository.attachWorktree(worktree);
  }

  createThreadWithWorktree(
    thread: Thread,
    worktree: TaskWorktree,
  ): { thread: Thread; worktree: TaskWorktree } {
    return this.workspaceRepository.createThreadWithWorktree(thread, worktree);
  }

  getThread(id: string): Thread | undefined {
    return this.threadRepository.getThread(id);
  }

  getThreadGoal(threadId: string): ThreadGoal | undefined {
    return this.goalRepository.getThreadGoal(threadId);
  }

  listThreads(): Thread[] {
    return this.threadRepository.listThreads();
  }

  deleteThread(threadId: string): void {
    return this.threadRepository.deleteThread(threadId);
  }

  updateThread(
    id: string,
    changes: Partial<
      Pick<
        Thread,
        | "mode"
        | "status"
        | "sessionFile"
        | "title"
        | "pinned"
        | "archived"
        | "target"
      >
    > & {
      modelSelection?: ModelSelection | null;
      contextWindow?: number | null;
      /** Design-plugin binding: freezes the thread onto a plugin revision. */
      typeBinding?: Thread["typeBinding"];
    },
  ): Thread {
    return this.threadRepository.updateThread(id, changes);
  }

  setThreadGoal(
    threadId: string,
    objective: string,
    tokenBudget: number | undefined,
    status: ThreadGoalStatus = "active",
  ): ThreadGoal {
    return this.goalRepository.setThreadGoal(
      threadId,
      objective,
      tokenBudget,
      status,
    );
  }

  updateThreadGoalObjective(
    threadId: string,
    objective: string,
    expectedGoalId: string,
    expectedRevision: number,
  ): ThreadGoal {
    return this.goalRepository.updateThreadGoalObjective(
      threadId,
      objective,
      expectedGoalId,
      expectedRevision,
    );
  }

  mutateThreadGoal(
    threadId: string,
    changes: {
      objective?: string;
      status?: ThreadGoalStatus;
      tokenBudget?: number | null;
    },
    expectedGoalId?: string,
    expectedRevision?: number,
    clearBlocker = false,
  ): ThreadGoal {
    return this.goalRepository.mutateThreadGoal(
      threadId,
      changes,
      expectedGoalId,
      expectedRevision,
      clearBlocker,
    );
  }

  pauseThreadGoal(threadId: string): ThreadGoal {
    return this.goalRepository.pauseThreadGoal(threadId);
  }

  resumeThreadGoal(threadId: string): ThreadGoal {
    return this.goalRepository.resumeThreadGoal(threadId);
  }

  clearThreadGoal(
    threadId: string,
    expectedGoalId?: string,
  ): { goalId: string; revision: number } | undefined {
    return this.goalRepository.clearThreadGoal(threadId, expectedGoalId);
  }

  updateThreadGoalAccounting(
    threadId: string,
    goalId: string,
    tokens: number,
    seconds: number,
  ): ThreadGoal | undefined {
    return this.goalRepository.updateThreadGoalAccounting(
      threadId,
      goalId,
      tokens,
      seconds,
    );
  }

  completeThreadGoal(threadId: string, goalId: string): ThreadGoal {
    return this.goalRepository.completeThreadGoal(threadId, goalId);
  }

  recordThreadGoalBlocker(
    threadId: string,
    goalId: string,
    blocker: string,
  ): { goal: ThreadGoal; attempts: number } {
    return this.goalRepository.recordThreadGoalBlocker(
      threadId,
      goalId,
      blocker,
    );
  }

  markThreadGoalUsageLimited(threadId: string, goalId: string): ThreadGoal {
    return this.goalRepository.markThreadGoalUsageLimited(threadId, goalId);
  }

  markThreadGoalBlocked(threadId: string, goalId: string): ThreadGoal {
    return this.goalRepository.markThreadGoalBlocked(threadId, goalId);
  }

  private updateThreadGoalStatus(
    threadId: string,
    goalId: string,
    status: ThreadGoalStatus,
    resetBlocker = false,
  ): ThreadGoal {
    return this.goalRepository.updateThreadGoalStatus(
      threadId,
      goalId,
      status,
      resetBlocker,
    );
  }

  getWorktreeForThread(threadId: string): TaskWorktree | undefined {
    return this.workspaceRepository.getWorktreeForThread(threadId);
  }

  getWorktree(id: string): TaskWorktree | undefined {
    return this.workspaceRepository.getWorktree(id);
  }

  listWorktrees(): TaskWorktree[] {
    return this.workspaceRepository.listWorktrees();
  }

  updateWorktree(
    id: string,
    changes: Partial<
      Pick<
        TaskWorktree,
        "head" | "branch" | "status" | "recoveryPath" | "target"
      >
    >,
  ): TaskWorktree {
    return this.workspaceRepository.updateWorktree(id, changes);
  }

  clearWorktreeRecovery(id: string): TaskWorktree {
    return this.workspaceRepository.clearWorktreeRecovery(id);
  }

  attachWorktreeToThread(
    threadId: string,
    worktree: TaskWorktree,
  ): { thread: Thread; worktree: TaskWorktree } {
    return this.workspaceRepository.attachWorktreeToThread(threadId, worktree);
  }

  completeWorktreeCleanup(
    threadId: string,
    worktreeId: string,
    recoveryPath?: string,
  ): { thread: Thread; worktree: TaskWorktree } {
    return this.workspaceRepository.completeWorktreeCleanup(
      threadId,
      worktreeId,
      recoveryPath,
    );
  }

  private copyThreadEventsCore(
    sourceThreadId: string,
    targetThreadId: string,
  ): AgentEvent[] {
    return this.workspaceRepository.copyThreadEventsCore(
      sourceThreadId,
      targetThreadId,
    );
  }

  copyThreadEvents(
    sourceThreadId: string,
    targetThreadId: string,
  ): AgentEvent[] {
    return this.workspaceRepository.copyThreadEvents(
      sourceThreadId,
      targetThreadId,
    );
  }

  createForkedThread(
    thread: Thread,
    sourceThreadId: string,
  ): { thread: Thread; events: AgentEvent[] } {
    return this.workspaceRepository.createForkedThread(thread, sourceThreadId);
  }

  createForkedThreadWithWorktree(
    thread: Thread,
    worktree: TaskWorktree,
    sourceThreadId: string,
  ): { thread: Thread; worktree: TaskWorktree; events: AgentEvent[] } {
    return this.workspaceRepository.createForkedThreadWithWorktree(
      thread,
      worktree,
      sourceThreadId,
    );
  }

  saveApprovalGrant(grant: ApprovalGrant): void {
    return this.approvalRepository.saveApprovalGrant(grant);
  }

  findApprovalGrant(
    query: ApprovalGrantQuery,
  ): Exclude<ApprovalScope, "once"> | undefined {
    return this.approvalRepository.findApprovalGrant(query);
  }

  listReviewComments(threadId: string): ReviewComment[] {
    return this.reviewRepository.listReviewComments(threadId);
  }

  addReviewComment(
    threadId: string,
    anchor: ReviewCommentAnchor,
    body: string,
  ): ReviewComment {
    return this.reviewRepository.addReviewComment(threadId, anchor, body);
  }

  deleteReviewComment(threadId: string, commentId: string): void {
    return this.reviewRepository.deleteReviewComment(threadId, commentId);
  }

  createAutomation(automation: Automation): Automation {
    return this.automationRepository.createAutomation(automation);
  }

  getAutomation(id: string): Automation | undefined {
    return this.automationRepository.getAutomation(id);
  }

  listAutomations(projectId?: string): Automation[] {
    return this.automationRepository.listAutomations(projectId);
  }

  listDueAutomations(now: string): Automation[] {
    return this.automationRepository.listDueAutomations(now);
  }

  updateAutomation(automation: Automation): Automation {
    return this.automationRepository.updateAutomation(automation);
  }

  softDeleteAutomation(id: string): Automation {
    return this.automationRepository.softDeleteAutomation(id);
  }

  claimAutomationRun(
    run: AutomationRun,
    options: {
      nextRunAt?: string;
      advanceSchedule: boolean;
      disableAutomation?: boolean;
    },
  ): AutomationRun | undefined {
    return this.automationRepository.claimAutomationRun(run, options);
  }

  getAutomationRun(id: string): AutomationRun | undefined {
    return this.automationRepository.getAutomationRun(id);
  }

  getAutomationRunForThread(threadId: string): AutomationRun | undefined {
    return this.automationRepository.getAutomationRunForThread(threadId);
  }

  listAutomationRuns(automationId: string, limit = 50): AutomationRun[] {
    return this.automationRepository.listAutomationRuns(automationId, limit);
  }

  updateAutomationRun(
    id: string,
    changes: {
      state?: AutomationRunState;
      threadId?: string;
      reason?: string | null;
    },
  ): AutomationRun {
    return this.automationRepository.updateAutomationRun(id, changes);
  }

  updateAutomationRunForThread(
    threadId: string,
    state: AutomationRunState,
    reason?: string,
  ): AutomationRun | undefined {
    return this.automationRepository.updateAutomationRunForThread(
      threadId,
      state,
      reason,
    );
  }

  completeAutomationRunForThread(
    threadId: string,
  ): { run: AutomationRun; deletedAutomationId?: string } | undefined {
    return this.automationRepository.completeAutomationRunForThread(threadId);
  }

  private completeAutomationRunForThreadCore(
    threadId: string,
  ): { run: AutomationRun; deletedAutomationId?: string } | undefined {
    return this.automationRepository.completeAutomationRunForThreadCore(
      threadId,
    );
  }

  hasActiveAutomationRun(automationId: string): boolean {
    return this.automationRepository.hasActiveAutomationRun(automationId);
  }

  hasActiveLocalThread(projectId: string): boolean {
    return this.automationRepository.hasActiveLocalThread(projectId);
  }

  recoverInterruptedAutomationRuns(): AutomationRun[] {
    return this.automationRepository.recoverInterruptedAutomationRuns();
  }

  appendEvent(
    eventId: string,
    threadId: string,
    turnId: string | undefined,
    payload: AgentPayload,
    timestamp?: string,
  ): AgentEvent {
    return this.conversationRepository.appendEvent(
      eventId,
      threadId,
      turnId,
      payload,
      timestamp,
    );
  }

  appendEvents(
    threadId: string,
    inputs: readonly EventAppendInput[],
  ): AgentEvent[] {
    return this.conversationRepository.appendEvents(threadId, inputs);
  }

  appendEventsAndUpdateThread(
    threadId: string,
    inputs: readonly EventAppendInput[],
    changes: Partial<
      Pick<Thread, "title" | "mode" | "target" | "status" | "sessionFile">
    >,
    checkpoint?: TurnCheckpoint,
    acceptance?: PlanAcceptance,
  ): { events: AgentEvent[]; thread: Thread } {
    return this.conversationRepository.appendEventsAndUpdateThread(
      threadId,
      inputs,
      changes,
      checkpoint,
      acceptance,
    );
  }

  private appendEventsCore(
    threadId: string,
    inputs: readonly EventAppendInput[],
  ): AgentEvent[] {
    return this.conversationRepository.appendEventsCore(threadId, inputs);
  }

  getThreadEvents(threadId: string): AgentEvent[] {
    return this.conversationRepository.getThreadEvents(threadId);
  }

  getTurnCheckpoint(threadId: string): TurnCheckpoint | undefined {
    return this.conversationRepository.getTurnCheckpoint(threadId);
  }

  saveTurnCheckpoint(checkpoint: TurnCheckpoint): void {
    return this.conversationRepository.saveTurnCheckpoint(checkpoint);
  }

  clearTurnCheckpoint(threadId: string, turnId: string | undefined): void {
    return this.conversationRepository.clearTurnCheckpoint(threadId, turnId);
  }

  getTokenUsageEvents(): AgentEvent[] {
    return this.conversationRepository.getTokenUsageEvents();
  }

  listPromptHistory(limit = 100): string[] {
    return this.conversationRepository.listPromptHistory(limit);
  }

  getLastTurnChangedFiles(threadId: string): string[] {
    return this.turnChangesRepository.getLastTurnChangedFiles(threadId);
  }

  upsertTurnChangeSet(record: TurnChangeSetRecord): TurnChangeSetRecord {
    return this.turnChangesRepository.upsertTurnChangeSet(record);
  }

  getTurnChangeSet(
    threadId: string,
    turnId: string,
  ): TurnChangeSetRecord | undefined {
    return this.turnChangesRepository.getTurnChangeSet(threadId, turnId);
  }

  getLatestTurnChangeSet(threadId: string): TurnChangeSetRecord | undefined {
    return this.turnChangesRepository.getLatestTurnChangeSet(threadId);
  }

  releaseOlderTurnChangeSetUndo(
    threadId: string,
    currentTurnId: string,
  ): string[] {
    return this.turnChangesRepository.releaseOlderTurnChangeSetUndo(
      threadId,
      currentTurnId,
    );
  }

  listTurnChangeSetSnapshotPaths(threadId: string): string[] {
    return this.turnChangesRepository.listTurnChangeSetSnapshotPaths(threadId);
  }

  getThreadChangedFiles(threadId: string): string[] {
    return this.turnChangesRepository.getThreadChangedFiles(threadId);
  }

  recoverInterruptedThreads(): AgentEvent[] {
    return this.conversationRepository.recoverInterruptedThreads();
  }

  snapshot(
    locale: AppSnapshot["locale"],
    platform: AppSnapshot["platform"],
    sandbox: AppSnapshot["sandbox"],
    options: { includeEvents?: boolean } = {},
  ): AppSnapshot {
    const projects = (
      this.database
        .prepare(
          "SELECT * FROM projects WHERE hidden = 0 ORDER BY updated_at DESC",
        )
        .all() as unknown as ProjectRow[]
    ).map(projectFromRow);
    const visibleProjectIds = new Set(projects.map((project) => project.id));
    const threads = this.listThreads().filter(
      (thread) => !thread.projectId || visibleProjectIds.has(thread.projectId),
    );
    const worktrees = this.listWorktrees().filter((worktree) =>
      visibleProjectIds.has(worktree.projectId),
    );
    const events: Record<string, AgentEvent[]> = {};
    if (options.includeEvents !== false) {
      for (const thread of threads) {
        if (thread.archived) {
          continue;
        }
        events[thread.id] = this.getThreadEvents(thread.id);
      }
    } else {
      // Restore sidebar queue state without loading conversation histories.
      const latestActivity = this.database.prepare(`
        SELECT body FROM events WHERE thread_id = ?
          AND json_extract(body, '$.payload.type') IN
            ('turn.started', 'turn.activity', 'turn.completed', 'turn.failed')
        ORDER BY seq DESC LIMIT 1
      `);
      for (const thread of threads) {
        if (thread.archived || thread.status !== "running") continue;
        const row = latestActivity.get(thread.id) as
          { body: string } | undefined;
        if (row) events[thread.id] = [agentEventFromBody(row.body)];
      }
    }
    return { projects, threads, worktrees, events, locale, platform, sandbox };
  }

  // ---------------------------------------------------------------------
  // Custom sub-agent definitions (D#152 PR2)
  // ---------------------------------------------------------------------

  createCustomAgent(input: {
    name: string;
    description: string;
    color: string;
    enabled?: boolean;
    instructions: string;
    scope: "all" | "selected";
    projectIds?: string[];
    modelPolicy?: CustomAgentModelPolicy;
    thinkingPolicy?: CustomAgentThinkingPolicy;
    toolPolicy?: CustomAgentToolPolicy;
    allowAutomaticInvocation?: boolean;
    triggers?: string[];
  }): CustomAgentDefinition {
    return this.customAgentRepository.createCustomAgent(input);
  }

  getCustomAgent(id: string): CustomAgentDefinition | undefined {
    return this.customAgentRepository.getCustomAgent(id);
  }

  listCustomAgents(): CustomAgentDefinition[] {
    return this.customAgentRepository.listCustomAgents();
  }

  listCustomAgentProjectIds(agentId: string): string[] {
    return this.customAgentRepository.listCustomAgentProjectIds(agentId);
  }

  /**
   * Definitions effective for a project, per the approved scope contract:
   * `all` always applies; `selected` applies only when linked — zero links
   * never widens to global. Projectless callers pass null and only receive
   * `all` definitions. Disabled definitions are excluded.
   */
  listEffectiveCustomAgents(projectId: string | null): CustomAgentDefinition[] {
    return this.customAgentRepository.listEffectiveCustomAgents(projectId);
  }

  /**
   * Revision-checked update. Definition fields and project links are saved
   * in the same transaction; a stale expectedRevision rejects the write as
   * CUSTOM_AGENT_REVISION_CONFLICT without touching stored content.
   */
  updateCustomAgent(
    id: string,
    expectedRevision: number,
    patch: {
      name?: string;
      description?: string;
      color?: string;
      enabled?: boolean;
      instructions?: string;
      scope?: "all" | "selected";
      projectIds?: string[];
      modelPolicy?: CustomAgentModelPolicy;
      thinkingPolicy?: CustomAgentThinkingPolicy;
      toolPolicy?: CustomAgentToolPolicy;
      allowAutomaticInvocation?: boolean;
      triggers?: string[];
    },
  ): CustomAgentDefinition {
    return this.customAgentRepository.updateCustomAgent(
      id,
      expectedRevision,
      patch,
    );
  }

  deleteCustomAgent(id: string): void {
    return this.customAgentRepository.deleteCustomAgent(id);
  }

  // ---------------------------------------------------------------------
  // Custom agent invocation dedup records (D#152 plan section 6)
  // ---------------------------------------------------------------------

  /**
   * Insert the invocation record, or return the existing record for the
   * same (threadId, invocationId). An existing record with a different
   * request fingerprint is an INVOCATION_CONFLICT — the same id must never
   * bind to different content.
   */
  upsertCustomAgentInvocation(
    record: Omit<CustomAgentInvocationRecord, "createdAt" | "updatedAt">,
  ): { record: CustomAgentInvocationRecord; inserted: boolean } {
    return this.customAgentRepository.upsertCustomAgentInvocation(record);
  }

  /** Commit all task blocks atomically; an IPC retry must match the whole batch. */
  commitCustomAgentInvocations(
    records: Array<
      Omit<CustomAgentInvocationRecord, "createdAt" | "updatedAt">
    >,
  ): string | undefined {
    return this.customAgentRepository.commitCustomAgentInvocations(records);
  }

  getCustomAgentInvocation(
    threadId: string,
    invocationId: string,
  ): CustomAgentInvocationRecord | undefined {
    return this.customAgentRepository.getCustomAgentInvocation(
      threadId,
      invocationId,
    );
  }

  listCustomAgentInvocationsForThread(
    threadId: string,
  ): CustomAgentInvocationRecord[] {
    return this.customAgentRepository.listCustomAgentInvocationsForThread(
      threadId,
    );
  }

  /**
   * Bind the materialized instance to a committed invocation. Only fills
   * instance_id once, only while dispatch-committed — never mutates
   * status or rewrites an existing binding.
   */
  bindCustomAgentInvocationInstance(
    threadId: string,
    invocationId: string,
    instanceId: string,
  ): void {
    return this.customAgentRepository.bindCustomAgentInvocationInstance(
      threadId,
      invocationId,
      instanceId,
    );
  }

  /**
   * Boot sweep: `pending` records only legitimately exist between send
   * validation and dispatch commit inside one process. A record still
   * pending at startup is a crash remnant — mark it outcome-unknown so it
   * is never silently re-dispatched (D#152 plan section 6).
   */
  markStalePendingCustomAgentInvocations(): number {
    return this.customAgentRepository.markStalePendingCustomAgentInvocations();
  }

  /**
   * Status transitions follow the contract state machine; an illegal
   * transition is rejected instead of silently mutating the record.
   */
  transitionCustomAgentInvocation(
    threadId: string,
    invocationId: string,
    to: CustomAgentInvocationStatus,
    patch: { turnId?: string; instanceId?: string } = {},
  ): CustomAgentInvocationRecord {
    return this.customAgentRepository.transitionCustomAgentInvocation(
      threadId,
      invocationId,
      to,
      patch,
    );
  }

  close(): void {
    this.database.close();
  }
}

export {
  type TurnChangeSetRecord,
  type EventAppendInput,
  type ApprovalGrant,
  type ApprovalGrantQuery,
} from "./store-types.js";

export {
  CUSTOM_AGENTS_DATABASE_VERSION,
  CURRENT_DATABASE_VERSION,
  DESIGN_PLUGIN_DATABASE_VERSION,
} from "./store-schema.js";
