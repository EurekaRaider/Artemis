import type {
  AgentEvent,
  ApprovalResolution,
  CustomAgentTaskInvocation,
  PromptAttachment,
  RunMode,
  TaskWorktree,
  Thread,
  UserInputResolution,
  WorkspaceTarget,
} from "@artemis/protocol";
import type { ModelSelection } from "@artemis/protocol";
import type {
  WorktreeCleanupCandidate,
  CleanupWorktreeResult,
  RestoreWorktreeSnapshotResult,
  HandoffWorkspaceResult,
} from "./worktrees.js";
import type { UndoTurnChangesResult } from "./review.js";
export interface ConversationApi {
  createThread(input: CreateThreadInput): Promise<Thread | undefined>;
  setThreadModelSelection(
    threadId: string,
    selection: ModelSelection,
  ): Promise<Thread>;
  renameThread(threadId: string, title: string): Promise<Thread>;
  setThreadGoal(
    threadId: string,
    objective: string,
    tokenBudget?: number,
  ): Promise<Thread>;
  getThreadGoalObjective(threadId: string): Promise<{
    goalId: string;
    objective: string;
    revision: number;
    updatedAt: string;
  }>;
  updateThreadGoalObjective(
    threadId: string,
    objective: string,
    expectedGoalId: string,
    expectedRevision: number,
  ): Promise<Thread>;
  pauseThreadGoal(threadId: string): Promise<Thread>;
  resumeThreadGoal(threadId: string): Promise<Thread>;
  clearThreadGoal(threadId: string): Promise<Thread>;
  archiveThread(threadId: string, archived: boolean): Promise<Thread>;
  deleteThread(threadId: string): Promise<void>;
  forkThread(threadId: string, entryId?: string): Promise<ForkThreadResult>;
  compactThread(threadId: string, instructions?: string): Promise<void>;
  prepareThread(threadId: string): Promise<void>;
  branchizeWorktree(
    threadId: string,
    branchName: string,
  ): Promise<TaskWorktree>;
  listWorktreeCleanupCandidates(): Promise<WorktreeCleanupCandidate[]>;
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
  acceptPlan(
    input: import("@artemis/protocol").PlanAcceptance & { threadId: string },
  ): Promise<StartTurnResult>;
  revisePlan(input: {
    threadId: string;
    text: string;
    attachments?: PromptAttachment[];
  }): Promise<StartTurnResult>;
  reportTurnRendered(turnId: string, renderedAt: number): void;
  steerTurn(input: QueueTurnInput): Promise<void>;
  followUpTurn(input: QueueTurnInput): Promise<void>;
  clearTurnQueue(threadId: string): Promise<QueuedTurnMessages>;
  steerTurnQueue(threadId: string): Promise<void>;
  steerQueuedTurn(input: SteerQueuedTurnInput): Promise<void>;
  replaceTurnQueue(input: ReplaceQueuedTurnInput): Promise<void>;
  cancelTurn(threadId: string): Promise<void>;
  undoTurnChanges(
    threadId: string,
    turnId: string,
  ): Promise<UndoTurnChangesResult>;
  controlChildAgent(
    input: ChildAgentControlInput,
  ): Promise<ChildAgentControlResult>;
  controlAgentTeam(
    input: AgentTeamControlInput,
  ): Promise<AgentTeamControlResult>;
  resolveApproval(resolution: ApprovalResolution): Promise<void>;
  resolveUserInput(resolution: UserInputResolution): Promise<void>;
}

export interface CreateThreadInput {
  projectId?: string;
  mode: RunMode;
  target: WorkspaceTarget;
}

export interface StartTurnInput {
  /** A panel candidate is consumed only when this exact submission is dispatched. */
  designPanelCredential?: string;
  customAgentTasks?: CustomAgentTaskInvocation[];
  threadId: string;
  text: string;
  mode: RunMode;
  attachments?: PromptAttachment[];
  submittedAt?: number;
  /**
   * Structured @ reference to a custom sub-agent definition (D#152).
   * invocationId is minted by the renderer per user submission and reused
   * across IPC retries; the main process binds it to threadId + content
   * fingerprint so duplicate delivery never dispatches twice.
   */
  customAgentReference?: {
    definitionId: string;
    revision: number;
    invocationId: string;
  };
}

export interface StartTurnResult {
  turnId: string;
  thread: Thread;
}

export interface QueueTurnInput {
  designPanelCredential?: string;
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
  expectedFollowUp: string[];
  followUp: Array<{ sourceIndex: number; text: string }>;
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
