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
  ToolStartedPayload,
  TurnActivityPayload,
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
}

export interface ThreadViewState {
  threadId: string;
  status:
    "idle" | "running" | "waiting-approval" | "waiting-user-input" | "failed";
  mode: RunMode;
  activity?: Omit<TurnActivityPayload, "type"> & { scheduledAt?: string };
  errorCode?: string;
  order: string[];
  userMessages: Record<string, { id: string; text: string }>;
  messageParts: Record<string, MessagePartState>;
  tools: Record<string, ToolState>;
  approvals: Record<string, ApprovalState>;
  userInputs: Record<string, UserInputState>;
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

function applyAgentEvent(
  state: ThreadViewState,
  event: AgentEvent,
  orderedItems: Set<string>,
): void {
  state.seenEventIds[event.eventId] = true;
  state.lastSeq = Math.max(state.lastSeq, event.seq);

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
      state.userInputs[payload.requestId] = {
        ...payload,
        status: "pending",
      };
      state.status = "waiting-user-input";
      appendOnce(state.order, orderedItems, `input:${payload.requestId}`);
      return;
    }
    case "user-input.resolved": {
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
