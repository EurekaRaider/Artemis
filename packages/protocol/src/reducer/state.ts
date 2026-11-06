import type { SavedPlan } from "../plans.js";
import type {
  AgentTeamMessagePayload,
  AgentTeamStatusPayload,
  ApprovalRequestedPayload,
  AssistantUsagePayload,
  ChildAgentPayload,
  ContextUsagePayload,
  McpToolUsedPayload,
  RunMode,
  TaskNotificationState,
  TaskSourceAddedPayload,
  TurnChangeSetUpdatedPayload,
  TurnActivityPayload,
  UserInputQuestion,
  UserInputRequestedPayload,
} from "../schema.js";
import { type ArtifactViewState } from "../artifact.js";

export interface MessagePartState {
  id: string;
  type: "text" | "thinking";
  text: string;
  timestamp?: string;
}

export interface ToolState {
  parentToolCallId?: string;
  structuredContent?: unknown;
  images?: Array<{ data: string; mimeType: string }>;
  id: string;
  name: string;
  input?: unknown;
  output: string;
  status: "running" | "completed" | "failed";
  startedAt?: string;
  lastActivityAt?: string;
}

export interface ApprovalState extends ApprovalRequestedPayload {
  status: "pending" | "approved" | "denied";
  skipped?: true;
  feedback?: string;
  scope?: "once" | "session" | "project";
  requestedAt: string;
  turnId?: string;
}

export interface UserInputState extends UserInputRequestedPayload {
  // Unified discriminant: kind-ed producers set it explicitly; kind-less
  // (legacy) states leave it undefined and stay discriminated by the
  // array-validated questions check (isMultiQuestionInput) below.
  kind?: "single-question" | "multi-question" | undefined;
  status: "pending" | "answered" | "timed-out" | "cancelled";
  answer?: string;
  skipped?: true;
  // Numeric option index; single-question state only.
  selectedOption?: number;
}

export interface UserInputQuestionState {
  status: "pending" | "answered" | "timed-out" | "cancelled";
  answer?: string;
  skipped?: true;
  // The chosen option *label*, named differently from the single-question
  // selectedOption numeric index above.
  selectedOptionLabel?: string;
}

export interface MultiQuestionUserInputState extends UserInputState {
  kind: "multi-question";
  questions: UserInputQuestion[];
  answers: Record<string, UserInputQuestionState>;
  // The inherited top-level question/options/expiresAt are a legacy
  // single-question projection kept in sync by syncMultiQuestionLegacyView
  // for pre-multi-question renderers; the inherited answer/selectedOption
  // are never set on multi-question cards — per-question answers live in
  // `answers` only.
}

export interface ChildAgentState extends ChildAgentPayload {}

export interface AgentTeamState extends AgentTeamStatusPayload {}

export interface AgentTeamMessageState extends AgentTeamMessagePayload {}

export interface McpToolUsageState extends McpToolUsedPayload {
  turnId?: string;
  timestamp: string;
}

export type TaskSourceState = TaskSourceAddedPayload & {
  turnId?: string;
  timestamp: string;
};

export type ContextUsageState = Omit<ContextUsagePayload, "type">;

export interface AssistantUsageState {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  usageEvents: number;
  cacheReadReportedEvents: number;
  cacheWriteReportedEvents: number;
  cachePolicies: Record<
    NonNullable<AssistantUsagePayload["cachePolicy"]>,
    number
  >;
}

export interface ContextCompactionState {
  id: string;
  status: "running" | "completed" | "failed" | "cancelled";
  error?: string;
  completedAt?: string;
}

export interface TurnViewState {
  id: string;
  mode: RunMode;
  status: "running" | "completed" | "cancelled" | "failed";
  order: string[];
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  finalPartId?: string;
  changeSet?: Omit<TurnChangeSetUpdatedPayload, "type">;
}

export interface ThreadViewState {
  plans?: SavedPlan[];
  artifacts?: Record<string, ArtifactViewState>;
  notification?: TaskNotificationState;
  threadId: string;
  status:
    "idle" | "running" | "waiting-approval" | "waiting-user-input" | "failed";
  mode: RunMode;
  activity?: Omit<TurnActivityPayload, "type"> & { scheduledAt?: string };
  errorCode?: string;
  order: string[];
  turnOrder: string[];
  turns: Record<string, TurnViewState>;
  entryTurnIds: Record<string, string>;
  userMessages: Record<
    string,
    { id: string; text: string; timestamp?: string }
  >;
  messageParts: Record<string, MessagePartState>;
  tools: Record<string, ToolState>;
  approvals: Record<string, ApprovalState>;
  userInputs: Record<string, UserInputState | MultiQuestionUserInputState>;
  childAgents: Record<string, ChildAgentState>;
  agentTeams: Record<string, AgentTeamState>;
  agentTeamMessages: Record<string, AgentTeamMessageState>;
  agentTeamMessageOrder: string[];
  mcpToolUses: Record<string, McpToolUsageState>;
  mcpToolUseOrder: string[];
  taskSources: Record<string, TaskSourceState>;
  taskSourceOrder: string[];
  contextCompactions: Record<string, ContextCompactionState>;
  contextUsage?: ContextUsageState;
  assistantUsage: AssistantUsageState;
  queue: {
    steering: string[];
    followUp: string[];
  };
  changedFiles: string[];
  seenEventIds: Record<string, true>;
  lastSeq: number;
  error?: string;
}

export function createThreadViewState(
  threadId: string,
  mode: RunMode = "work",
): ThreadViewState {
  return {
    threadId,
    plans: [],
    status: "idle",
    mode,
    order: [],
    turnOrder: [],
    turns: {},
    entryTurnIds: {},
    userMessages: {},
    messageParts: {},
    tools: {},
    approvals: {},
    userInputs: {},
    childAgents: {},
    agentTeams: {},
    agentTeamMessages: {},
    agentTeamMessageOrder: [],
    mcpToolUses: {},
    mcpToolUseOrder: [],
    taskSources: {},
    taskSourceOrder: [],
    contextCompactions: {},
    assistantUsage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      usageEvents: 0,
      cacheReadReportedEvents: 0,
      cacheWriteReportedEvents: 0,
      cachePolicies: {
        disabled: 0,
        short: 0,
        long: 0,
        "explicit-30m": 0,
      },
    },
    queue: {
      steering: [],
      followUp: [],
    },
    changedFiles: [],
    seenEventIds: {},
    lastSeq: -1,
  };
}

export function cloneThreadViewState(state: ThreadViewState): ThreadViewState {
  return {
    ...state,
    order: [...state.order],
    turnOrder: [...state.turnOrder],
    turns: { ...state.turns },
    entryTurnIds: { ...state.entryTurnIds },
    userMessages: { ...state.userMessages },
    plans: (state.plans ?? []).map((plan) => ({ ...plan })),
    messageParts: { ...state.messageParts },
    tools: { ...state.tools },
    approvals: { ...state.approvals },
    userInputs: { ...state.userInputs },
    childAgents: { ...state.childAgents },
    agentTeams: { ...state.agentTeams },
    agentTeamMessages: { ...state.agentTeamMessages },
    agentTeamMessageOrder: [...state.agentTeamMessageOrder],
    mcpToolUses: { ...state.mcpToolUses },
    mcpToolUseOrder: [...state.mcpToolUseOrder],
    taskSources: { ...state.taskSources },
    taskSourceOrder: [...state.taskSourceOrder],
    contextCompactions: { ...state.contextCompactions },
    assistantUsage: {
      ...state.assistantUsage,
      cachePolicies: { ...state.assistantUsage.cachePolicies },
    },
    queue: {
      steering: [...state.queue.steering],
      followUp: [...state.queue.followUp],
    },
    changedFiles: [...state.changedFiles],
    seenEventIds: { ...state.seenEventIds },
  };
}
