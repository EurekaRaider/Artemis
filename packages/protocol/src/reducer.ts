import type {
  AgentEvent,
  AgentTeamMessagePayload,
  AgentTeamStatusPayload,
  ApprovalRequestedPayload,
  AssistantUsagePayload,
  ChildAgentPayload,
  ContextUsagePayload,
  McpToolUsedPayload,
  RunMode,
  TaskSourceAddedPayload,
  TurnChangeSetUpdatedPayload,
  ToolStartedPayload,
  TurnActivityPayload,
  UserInputMultiQuestionRequestedPayload,
  UserInputMultiQuestionResolvedPayload,
  UserInputQuestion,
  UserInputRequestedPayload,
} from "./schema.js";
import { isLegacyInternalAgentMessage } from "./internal-messages.js";

export interface MessagePartState {
  id: string;
  type: "text" | "thinking";
  text: string;
}

export interface ToolState {
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
  requestedAt: string;
  turnId?: string;
}

export interface UserInputState extends UserInputRequestedPayload {
  status: "pending" | "answered" | "timed-out" | "cancelled";
  answer?: string;
  selectedOption?: number;
}

export interface UserInputQuestionState {
  status: "pending" | "answered" | "timed-out" | "cancelled";
  answer?: string;
  selectedOption?: string;
}

export interface MultiQuestionUserInputState extends UserInputState {
  kind: "multi-question";
  questions: UserInputQuestion[];
  answers: Record<string, UserInputQuestionState>;
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
  status: "running" | "completed";
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
  userMessages: Record<string, { id: string; text: string }>;
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
  mode: RunMode = "execute",
): ThreadViewState {
  return {
    threadId,
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

function cloneThreadViewState(state: ThreadViewState): ThreadViewState {
  return {
    ...state,
    order: [...state.order],
    turnOrder: [...state.turnOrder],
    turns: Object.fromEntries(
      Object.entries(state.turns).map(([id, turn]) => [
        id,
        {
          ...turn,
          order: [...turn.order],
          ...(turn.changeSet
            ? {
                changeSet: {
                  ...turn.changeSet,
                  files: [...turn.changeSet.files],
                },
              }
            : {}),
        },
      ]),
    ),
    entryTurnIds: { ...state.entryTurnIds },
    userMessages: { ...state.userMessages },
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

function appendOnce(items: string[], seenItems: Set<string>, id: string): void {
  if (seenItems.has(id)) return;
  seenItems.add(id);
  items.push(id);
}

function clearThinkingParts(
  state: ThreadViewState,
  orderedItems: Set<string>,
): void {
  const thinkingEntries = new Set(
    Object.values(state.messageParts)
      .filter((part) => part.type === "thinking")
      .map((part) => `part:${part.id}`),
  );
  if (thinkingEntries.size === 0) return;
  for (const entry of thinkingEntries) {
    delete state.messageParts[entry.slice("part:".length)];
    orderedItems.delete(entry);
  }
  state.order = state.order.filter((entry) => !thinkingEntries.has(entry));
}

function multiQuestionIds(questions: UserInputQuestion[]): string {
  return questions
    .map((question) => question.questionId)
    .sort()
    .join("\n");
}

function multiQuestionAggregateStatus(
  input: MultiQuestionUserInputState,
): MultiQuestionUserInputState["status"] {
  const statuses = input.questions.map(
    (question) => input.answers[question.questionId]?.status ?? "pending",
  );
  if (statuses.some((status) => status === "pending")) return "pending";
  if (statuses.some((status) => status === "timed-out")) return "timed-out";
  if (statuses.some((status) => status === "cancelled")) return "cancelled";
  return "answered";
}

function syncMultiQuestionLegacyView(input: MultiQuestionUserInputState): void {
  const active =
    input.questions.find(
      (question) => input.answers[question.questionId]?.status === "pending",
    ) ?? input.questions[0]!;
  input.question = active.question;
  input.options = active.options;
  input.expiresAt = active.expiresAt;
}

function createMultiQuestionUserInputState(
  payload: UserInputMultiQuestionRequestedPayload,
): MultiQuestionUserInputState {
  const first = payload.questions[0]!;
  return {
    ...payload,
    status: "pending",
    answers: Object.fromEntries(
      payload.questions.map((question) => [
        question.questionId,
        { status: "pending" as const },
      ]),
    ),
    question: first.question,
    options: first.options,
    expiresAt: first.expiresAt,
  };
}

function applyMultiQuestionResolution(
  state: ThreadViewState,
  event: AgentEvent,
  payload: UserInputMultiQuestionResolvedPayload,
): void {
  const input = state.userInputs[payload.requestId];
  if (!input || !("questions" in input)) return;
  const question = input.questions.find(
    (candidate) => candidate.questionId === payload.questionId,
  );
  if (!question) return;
  const current = input.answers[payload.questionId];
  if (current && current.status !== "pending") return;
  if (Date.parse(event.timestamp) > Date.parse(question.expiresAt)) return;
  if (
    payload.selectedOption !== undefined &&
    !question.options.some((option) => option.label === payload.selectedOption)
  ) {
    return;
  }
  const answer = payload.customAnswer ?? payload.selectedOption;
  const next: MultiQuestionUserInputState = {
    ...input,
    answers: {
      ...input.answers,
      [payload.questionId]: {
        status:
          payload.source === "timeout"
            ? "timed-out"
            : payload.source === "cancelled"
              ? "cancelled"
              : "answered",
        ...(answer === undefined ? {} : { answer }),
        ...(payload.selectedOption === undefined
          ? {}
          : { selectedOption: payload.selectedOption }),
      },
    },
  };
  next.status = multiQuestionAggregateStatus(next);
  syncMultiQuestionLegacyView(next);
  state.userInputs[payload.requestId] = next;
}

function pendingInteractionStatus(
  state: ThreadViewState,
): "running" | "waiting-approval" | "waiting-user-input" {
  if (
    Object.values(state.userInputs).some((input) => input.status === "pending")
  ) {
    return "waiting-user-input";
  }
  if (
    Object.values(state.approvals).some(
      (approval) => approval.status === "pending",
    )
  ) {
    return "waiting-approval";
  }
  return "running";
}

function runningContextCompaction(
  state: ThreadViewState,
): ContextCompactionState | undefined {
  for (let index = state.order.length - 1; index >= 0; index -= 1) {
    const entry = state.order[index]!;
    if (!entry.startsWith("compaction:")) continue;
    const compaction =
      state.contextCompactions[entry.slice("compaction:".length)];
    if (compaction?.status === "running") return compaction;
  }
  return undefined;
}

const AFTER_TOOL_SEGMENT = "::after-tool::";

function timelinePartId(state: ThreadViewState, sourcePartId: string): string {
  const baseEntry = `part:${sourcePartId}`;
  const segmentPrefix = `${baseEntry}${AFTER_TOOL_SEGMENT}`;
  let lastPartIndex = -1;
  let lastPartId: string | undefined;
  let lastToolIndex = -1;
  let lastToolId: string | undefined;

  for (const [index, item] of state.order.entries()) {
    if (item.startsWith("tool:")) {
      lastToolIndex = index;
      lastToolId = item.slice("tool:".length);
    }
    if (item === baseEntry || item.startsWith(segmentPrefix)) {
      lastPartIndex = index;
      lastPartId = item.slice("part:".length);
    }
  }

  if (lastPartIndex < 0) return sourcePartId;
  if (lastToolIndex > lastPartIndex && lastToolId) {
    return `${sourcePartId}${AFTER_TOOL_SEGMENT}${lastToolId}`;
  }
  return lastPartId ?? sourcePartId;
}

function applyAgentPayload(
  state: ThreadViewState,
  event: AgentEvent,
  orderedItems: Set<string>,
): void {
  const payload = event.payload;
  switch (payload.type) {
    case "user.message": {
      if (isLegacyInternalAgentMessage(payload.text)) return;
      state.userMessages[payload.messageId] = {
        id: payload.messageId,
        text: payload.text,
      };
      appendOnce(state.order, orderedItems, `user:${payload.messageId}`);
      return;
    }
    case "turn.started": {
      clearThinkingParts(state, orderedItems);
      state.status = "running";
      state.mode = payload.mode;
      delete state.activity;
      delete state.error;
      delete state.errorCode;
      return;
    }
    case "turn.activity": {
      const { type: _type, ...activity } = payload;
      state.activity = {
        ...activity,
        ...(payload.phase === "reconnecting"
          ? { scheduledAt: event.timestamp }
          : {}),
      };
      return;
    }
    case "message.superseded": {
      const prefix = `${payload.messageId}:`;
      for (const partId of Object.keys(state.messageParts)) {
        if (!partId.startsWith(prefix)) continue;
        delete state.messageParts[partId];
        orderedItems.delete(`part:${partId}`);
      }
      state.order = state.order.filter(
        (entry) =>
          !entry.startsWith(`part:${prefix}`) &&
          entry !== `part:${payload.messageId}`,
      );
      return;
    }
    case "message.part.delta": {
      clearThinkingParts(state, orderedItems);
      if (payload.partType === "thinking") return;
      delete state.activity;
      const partId = timelinePartId(state, payload.partId);
      const existing = state.messageParts[partId];
      state.messageParts[partId] = {
        id: partId,
        type: payload.partType,
        text: `${existing?.text ?? ""}${payload.delta}`,
      };
      appendOnce(state.order, orderedItems, `part:${partId}`);
      return;
    }
    case "tool.started": {
      clearThinkingParts(state, orderedItems);
      delete state.activity;
      const tool = payload as ToolStartedPayload;
      state.tools[tool.toolCallId] = {
        id: tool.toolCallId,
        name: tool.toolName,
        ...(tool.input === undefined ? {} : { input: tool.input }),
        output: "",
        status: "running",
        startedAt: event.timestamp,
        lastActivityAt: event.timestamp,
      };
      appendOnce(state.order, orderedItems, `tool:${tool.toolCallId}`);
      return;
    }
    case "tool.updated": {
      const tool = state.tools[payload.toolCallId];
      if (tool) {
        state.tools[payload.toolCallId] = {
          ...tool,
          output: `${tool.output}${payload.output}`,
          lastActivityAt: event.timestamp,
        };
      }
      return;
    }
    case "tool.completed": {
      const tool = state.tools[payload.toolCallId];
      if (tool) {
        state.tools[payload.toolCallId] = {
          ...tool,
          output: payload.output ?? tool.output,
          status: payload.isError ? "failed" : "completed",
          lastActivityAt: event.timestamp,
        };
      }
      return;
    }
    case "approval.requested": {
      state.approvals[payload.approvalId] = {
        ...payload,
        status: "pending",
        requestedAt: event.timestamp,
        ...(event.turnId ? { turnId: event.turnId } : {}),
      };
      state.status = pendingInteractionStatus(state);
      appendOnce(state.order, orderedItems, `approval:${payload.approvalId}`);
      return;
    }
    case "approval.resolved": {
      const approval = state.approvals[payload.approvalId];
      if (approval) {
        state.approvals[payload.approvalId] = {
          ...approval,
          status: payload.approved ? "approved" : "denied",
        };
      }
      state.status = pendingInteractionStatus(state);
      return;
    }
    case "user-input.requested": {
      if (payload.kind === "multi-question") {
        const existing = state.userInputs[payload.requestId];
        if (
          existing &&
          (!("questions" in existing) ||
            multiQuestionIds(existing.questions) !==
              multiQuestionIds(payload.questions))
        ) {
          return;
        }
        state.userInputs[payload.requestId] =
          createMultiQuestionUserInputState(payload);
        state.status = "waiting-user-input";
        appendOnce(state.order, orderedItems, `input:${payload.requestId}`);
        return;
      }
      state.userInputs[payload.requestId] = {
        ...payload,
        status: "pending",
      };
      state.status = "waiting-user-input";
      appendOnce(state.order, orderedItems, `input:${payload.requestId}`);
      return;
    }
    case "user-input.resolved": {
      if (payload.kind === "multi-question") {
        applyMultiQuestionResolution(state, event, payload);
        state.status = pendingInteractionStatus(state);
        return;
      }
      const input = state.userInputs[payload.requestId];
      if (input) {
        state.userInputs[payload.requestId] = {
          ...input,
          status:
            payload.source === "timeout"
              ? "timed-out"
              : payload.source === "cancelled"
                ? "cancelled"
                : "answered",
          answer: payload.answer,
          ...(payload.selectedOption === undefined
            ? {}
            : { selectedOption: payload.selectedOption }),
        };
      }
      state.status = pendingInteractionStatus(state);
      return;
    }
    case "file.changed": {
      if (!state.changedFiles.includes(payload.path)) {
        state.changedFiles.push(payload.path);
      }
      return;
    }
    case "child-agent.status": {
      const previous = state.childAgents[payload.agentId];
      const activity = payload.activityDelta
        ? `${previous?.activity ?? ""}${payload.activityDelta}`.slice(
            -64 * 1024,
          )
        : (payload.activity ?? previous?.activity);
      state.childAgents[payload.agentId] = {
        ...previous,
        ...payload,
        parentAgentId:
          payload.parentAgentId ?? previous?.parentAgentId ?? "parent",
        depth: payload.depth ?? previous?.depth ?? 1,
        subtreeStatus:
          payload.subtreeStatus ?? previous?.subtreeStatus ?? "leaf",
        directChildCount:
          payload.directChildCount ?? previous?.directChildCount ?? 0,
        ...(activity ? { activity } : {}),
      };
      appendOnce(state.order, orderedItems, `child:${payload.agentId}`);
      return;
    }
    case "agent-team.status": {
      state.agentTeams[payload.teamId] = {
        ...state.agentTeams[payload.teamId],
        ...payload,
      };
      return;
    }
    case "agent-team.message": {
      if (!state.agentTeamMessages[payload.messageId]) {
        state.agentTeamMessageOrder.push(payload.messageId);
      }
      state.agentTeamMessages[payload.messageId] = {
        ...state.agentTeamMessages[payload.messageId],
        ...payload,
      };
      state.agentTeamMessageOrder.sort(
        (left, right) =>
          state.agentTeamMessages[left]!.sequence -
          state.agentTeamMessages[right]!.sequence,
      );
      return;
    }
    case "mcp.tool.used": {
      const key = `${event.turnId ?? ""}\0${payload.agentId}\0${payload.toolCallId}`;
      if (!state.mcpToolUses[key]) state.mcpToolUseOrder.push(key);
      state.mcpToolUses[key] = {
        ...payload,
        ...(event.turnId ? { turnId: event.turnId } : {}),
        timestamp: event.timestamp,
      };
      return;
    }
    case "task.source.added": {
      if (!state.taskSources[payload.sourceId]) {
        state.taskSourceOrder.push(payload.sourceId);
      }
      state.taskSources[payload.sourceId] = {
        ...payload,
        ...(event.turnId ? { turnId: event.turnId } : {}),
        timestamp: event.timestamp,
      };
      return;
    }
    case "context.usage": {
      const wasCompacting = state.contextUsage?.compacting === true;
      const preserveEstimate =
        payload.tokens === null &&
        state.contextUsage?.estimated === true &&
        state.contextUsage.tokens !== null;
      const estimated = preserveEstimate ? true : payload.estimated;
      const previous = preserveEstimate ? state.contextUsage : undefined;
      const breakdown = preserveEstimate
        ? previous?.breakdown
        : (payload.breakdown ?? previous?.breakdown);
      state.contextUsage = {
        tokens: preserveEstimate ? previous!.tokens : payload.tokens,
        contextWindow: payload.contextWindow,
        compacting: payload.compacting,
        ...(estimated === undefined ? {} : { estimated }),
        ...((payload.source ?? previous?.source) === undefined
          ? {}
          : { source: payload.source ?? previous?.source }),
        ...((payload.providerInputTokens ?? previous?.providerInputTokens) ===
        undefined
          ? {}
          : {
              providerInputTokens:
                payload.providerInputTokens ?? previous?.providerInputTokens,
            }),
        ...(breakdown === undefined ? {} : { breakdown }),
        ...((payload.footprint ?? previous?.footprint) === undefined
          ? {}
          : { footprint: payload.footprint ?? previous?.footprint }),
      };
      if (payload.compacting && !wasCompacting) {
        state.contextCompactions[event.eventId] = {
          id: event.eventId,
          status: "running",
        };
        appendOnce(state.order, orderedItems, `compaction:${event.eventId}`);
      } else if (!payload.compacting && wasCompacting) {
        const runningCompaction = runningContextCompaction(state);
        if (runningCompaction) {
          state.contextCompactions[runningCompaction.id] = {
            ...runningCompaction,
            status: "completed",
            completedAt: event.timestamp,
          };
        }
      }
      return;
    }
    case "assistant.usage": {
      const cachePolicies = { ...state.assistantUsage.cachePolicies };
      if (payload.cachePolicy) cachePolicies[payload.cachePolicy] += 1;
      state.assistantUsage = {
        inputTokens: state.assistantUsage.inputTokens + payload.inputTokens,
        outputTokens: state.assistantUsage.outputTokens + payload.outputTokens,
        cacheReadTokens:
          state.assistantUsage.cacheReadTokens + payload.cacheReadTokens,
        cacheWriteTokens:
          state.assistantUsage.cacheWriteTokens + payload.cacheWriteTokens,
        totalTokens: state.assistantUsage.totalTokens + payload.totalTokens,
        usageEvents: state.assistantUsage.usageEvents + 1,
        cacheReadReportedEvents:
          state.assistantUsage.cacheReadReportedEvents +
          (payload.cacheReadReported === true ? 1 : 0),
        cacheWriteReportedEvents:
          state.assistantUsage.cacheWriteReportedEvents +
          (payload.cacheWriteReported === true ? 1 : 0),
        cachePolicies,
      };
      return;
    }
    case "queue.updated": {
      state.queue = {
        steering: [...payload.steering],
        followUp: [...payload.followUp],
      };
      return;
    }
    case "queue.recovered":
      return;
    case "terminal.output":
      return;
    case "turn.completed": {
      clearThinkingParts(state, orderedItems);
      state.status = "idle";
      delete state.activity;
      return;
    }
    case "turn.failed": {
      clearThinkingParts(state, orderedItems);
      state.status = "failed";
      delete state.activity;
      state.error = payload.message;
      if (payload.code) state.errorCode = payload.code;
      else delete state.errorCode;
      return;
    }
    case "turn.change-set.updated":
      return;
  }
}

function ensureTurn(
  state: ThreadViewState,
  event: AgentEvent,
): TurnViewState | undefined {
  if (!event.turnId) return undefined;
  const existing = state.turns[event.turnId];
  if (existing) return existing;
  const turn: TurnViewState = {
    id: event.turnId,
    mode: state.mode,
    status: "running",
    order: [],
  };
  state.turns[event.turnId] = turn;
  state.turnOrder.push(event.turnId);
  return turn;
}

function resolvedFinalPartId(
  state: ThreadViewState,
  sourcePartId: string | undefined,
): string | undefined {
  if (!sourcePartId) return undefined;
  if (state.messageParts[sourcePartId]) return sourcePartId;
  const prefix = `${sourcePartId}${AFTER_TOOL_SEGMENT}`;
  return Object.keys(state.messageParts).findLast((id) =>
    id.startsWith(prefix),
  );
}

function resolvedTurnDuration(
  turn: TurnViewState,
  completedAt: string,
  persistedDuration: number | undefined,
): number | undefined {
  if (persistedDuration !== undefined) return persistedDuration;
  if (!turn.startedAt) return undefined;
  const duration = Date.parse(completedAt) - Date.parse(turn.startedAt);
  return Number.isFinite(duration) ? Math.max(0, duration) : undefined;
}

function applyAgentEvent(
  state: ThreadViewState,
  event: AgentEvent,
  orderedItems: Set<string>,
): void {
  state.seenEventIds[event.eventId] = true;
  state.lastSeq = Math.max(state.lastSeq, event.seq);
  const turn = ensureTurn(state, event);
  const previousEntries = new Set(state.order);

  applyAgentPayload(state, event, orderedItems);

  if (!turn) return;
  for (const entry of state.order) {
    if (!previousEntries.has(entry) && !state.entryTurnIds[entry]) {
      state.entryTurnIds[entry] = turn.id;
    }
  }
  turn.order = state.order.filter(
    (entry) => state.entryTurnIds[entry] === turn.id,
  );

  const payload = event.payload;
  if (payload.type === "turn.started") {
    turn.mode = payload.mode;
    turn.status = "running";
    turn.startedAt = event.timestamp;
    delete turn.completedAt;
    delete turn.durationMs;
    delete turn.finalPartId;
  } else if (payload.type === "turn.completed") {
    turn.status = payload.reason === "cancelled" ? "cancelled" : "completed";
    turn.completedAt = event.timestamp;
    const durationMs = resolvedTurnDuration(
      turn,
      event.timestamp,
      payload.durationMs,
    );
    if (durationMs === undefined) delete turn.durationMs;
    else turn.durationMs = durationMs;
    const finalPartId = resolvedFinalPartId(state, payload.finalPartId);
    if (finalPartId === undefined) delete turn.finalPartId;
    else turn.finalPartId = finalPartId;
  } else if (payload.type === "turn.failed") {
    turn.status = "failed";
    turn.completedAt = event.timestamp;
    const durationMs = resolvedTurnDuration(
      turn,
      event.timestamp,
      payload.durationMs,
    );
    if (durationMs === undefined) delete turn.durationMs;
    else turn.durationMs = durationMs;
  } else if (payload.type === "turn.change-set.updated") {
    const { type: _type, ...changeSet } = payload;
    turn.changeSet = changeSet;
  }
}

export function reduceAgentEvent(
  state: ThreadViewState,
  event: AgentEvent,
): ThreadViewState {
  if (event.threadId !== state.threadId || state.seenEventIds[event.eventId]) {
    return state;
  }

  const next = cloneThreadViewState(state);
  applyAgentEvent(next, event, new Set(next.order));
  return next;
}

export function reduceAgentEventBatch(
  state: ThreadViewState,
  events: AgentEvent[],
): ThreadViewState {
  let next: ThreadViewState | undefined;
  let orderedItems: Set<string> | undefined;
  for (const event of events) {
    const current = next ?? state;
    if (
      event.threadId !== current.threadId ||
      current.seenEventIds[event.eventId]
    ) {
      continue;
    }
    if (!next) {
      next = cloneThreadViewState(state);
      orderedItems = new Set(next.order);
    }
    applyAgentEvent(next, event, orderedItems!);
  }
  return next ?? state;
}

export function reduceAgentEvents(
  threadId: string,
  events: AgentEvent[],
  mode: RunMode = "execute",
): ThreadViewState {
  const state = createThreadViewState(threadId, mode);
  const orderedItems = new Set<string>();
  for (const event of events) {
    if (event.threadId !== threadId || state.seenEventIds[event.eventId]) {
      continue;
    }
    applyAgentEvent(state, event, orderedItems);
  }
  return state;
}
