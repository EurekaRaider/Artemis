import {
  type TurnChangeSetRecord,
  type EventAppendInput,
} from "../store-types.js";
import { DatabaseSync } from "node:sqlite";
import {
  type AgentEvent,
  type AgentPayload,
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
  type SubmissionLedgerRecord,
} from "@artemis/protocol";
import type { ReviewComment } from "../../../shared/api.js";
import type { TurnCheckpoint } from "../../conversation/turn-recovery.js";
import { TaskNotificationStore } from "../../conversation/task-notification-store.js";
export interface StoreDependencies {
  getThreadEvents(threadId: string): AgentEvent[];
  getThread(id: string): Thread | undefined;
  plans(threadId: string): import("@artemis/protocol").SavedPlan[];
  appendEvent(
    eventId: string,
    threadId: string,
    turnId: string | undefined,
    payload: AgentPayload,
    timestamp?: string,
  ): AgentEvent;
  appendEventsCore(
    threadId: string,
    inputs: readonly EventAppendInput[],
  ): AgentEvent[];
  readonly database: DatabaseSync;
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
  ): Thread;
  saveTurnCheckpoint(checkpoint: TurnCheckpoint): void;
  clearTurnCheckpoint(threadId: string, turnId: string | undefined): void;
  updateAutomationRunForThread(
    threadId: string,
    state: AutomationRunState,
    reason?: string,
  ): AutomationRun | undefined;
  completeAutomationRunForThreadCore(threadId: string):
    | {
        run: AutomationRun;
        deletedAutomationId?: string;
      }
    | undefined;
  getTurnCheckpoint(threadId: string): TurnCheckpoint | undefined;
  getProjectByPath(path: string): Project | undefined;
  getProject(id: string): Project | undefined;
  getPromptSubmission(submissionId: string): SubmissionLedgerRecord | undefined;
  nextSubmissionSequence(threadId: string): number;
  getThreadGoal(threadId: string): ThreadGoal | undefined;
  readonly notifications: TaskNotificationStore;
  insertWorktree(worktree: TaskWorktree): TaskWorktree;
  getWorktree(id: string): TaskWorktree | undefined;
  createThread(thread: Thread): Thread;
  attachWorktree(worktree: TaskWorktree): TaskWorktree;
  updateWorktree(
    id: string,
    changes: Partial<
      Pick<
        TaskWorktree,
        "head" | "branch" | "status" | "recoveryPath" | "target"
      >
    >,
  ): TaskWorktree;
  copyThreadEventsCore(
    sourceThreadId: string,
    targetThreadId: string,
  ): AgentEvent[];
  mutateThreadGoal(
    threadId: string,
    changes: {
      objective?: string;
      status?: ThreadGoalStatus;
      tokenBudget?: number | null;
    },
    expectedGoalId?: string,
    expectedRevision?: number,
    clearBlocker?: boolean,
  ): ThreadGoal;
  setThreadGoal(
    threadId: string,
    objective: string,
    tokenBudget: number | undefined,
    status?: ThreadGoalStatus,
  ): ThreadGoal;
  updateThreadGoalStatus(
    threadId: string,
    goalId: string,
    status: ThreadGoalStatus,
    resetBlocker?: boolean,
  ): ThreadGoal;
  listReviewComments(threadId: string): ReviewComment[];
  getAutomation(id: string): Automation | undefined;
  updateAutomation(automation: Automation): Automation;
  getAutomationRun(id: string): AutomationRun | undefined;
  getAutomationRunForThread(threadId: string): AutomationRun | undefined;
  updateAutomationRun(
    id: string,
    changes: {
      state?: AutomationRunState;
      threadId?: string;
      reason?: string | null;
    },
  ): AutomationRun;
  softDeleteAutomation(id: string): Automation;
  getTurnChangeSet(
    threadId: string,
    turnId: string,
  ): TurnChangeSetRecord | undefined;
  getCustomAgent(id: string): CustomAgentDefinition | undefined;
  listCustomAgents(): CustomAgentDefinition[];
  listCustomAgentProjectIds(agentId: string): string[];
  getCustomAgentInvocation(
    threadId: string,
    invocationId: string,
  ): CustomAgentInvocationRecord | undefined;
  upsertCustomAgentInvocation(
    record: Omit<CustomAgentInvocationRecord, "createdAt" | "updatedAt">,
  ): {
    record: CustomAgentInvocationRecord;
    inserted: boolean;
  };
  transitionCustomAgentInvocation(
    threadId: string,
    invocationId: string,
    to: CustomAgentInvocationStatus,
    patch?: {
      turnId?: string;
      instanceId?: string;
    },
  ): CustomAgentInvocationRecord;
}
