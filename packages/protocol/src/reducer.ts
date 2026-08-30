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
  UserInputResolvedPayload,
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
  // Unified discriminant: kind-ed producers set it explicitly; kind-less
  // (legacy) states leave it undefined and stay discriminated by the
  // array-validated questions check (isMultiQuestionInput) below.
  kind?: "single-question" | "multi-question" | undefined;
  status: "pending" | "answered" | "timed-out" | "cancelled";
  answer?: string;
  // Numeric option index; single-question state only.
  selectedOption?: number;
}

export interface UserInputQuestionState {
  status: "pending" | "answered" | "timed-out" | "cancelled";
  answer?: string;
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

// Multi-question duck typing validates the value, not just the key: IPC
// structured clone preserves explicit `questions: undefined` keys, so a
// state that bypassed the schema (legacy replay, direct reducer writes) can
// carry the key with a non-array value and must stay single-question here.
function isMultiQuestionInput(
  input: UserInputState | MultiQuestionUserInputState | undefined,
): input is MultiQuestionUserInputState {
  return (
    input !== undefined &&
    "questions" in input &&
    Array.isArray(input.questions)
  );
}

function multiQuestionFingerprint(request: {
  nonce: string;
  header: string;
  questions: UserInputQuestion[];
}): string {
  // Deterministic, collision-free serialization of the full request content.
  // Joining IDs with a separator string could collide (an ID containing the
  // separator), so canonicalize each question with JSON.stringify instead;
  // sorting makes the fingerprint independent of question order. The request
  // nonce and header are part of the identity: a resend carrying identical
  // questions but a different nonce or header is a new request, not a true
  // replay, and must fail closed so the persisted state stays authoritative.
  return JSON.stringify({
    nonce: request.nonce,
    header: request.header,
    questions: request.questions
      .map((question) => ({
        questionId: question.questionId,
        question: question.question,
        options: question.options,
        expiresAt: question.expiresAt,
      }))
      .sort((left, right) =>
        left.questionId < right.questionId
          ? -1
          : left.questionId > right.questionId
            ? 1
            : 0,
      ),
  });
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

function syncMultiQuestionLegacyView(
  input: MultiQuestionUserInputState,
): boolean {
  const active =
    input.questions.find(
      (question) => input.answers[question.questionId]?.status === "pending",
    ) ?? input.questions[0];
  // The schema guarantees at least one question; an empty array can only
  // arrive through a bypassed path — fail closed instead of projecting
  // undefined into the legacy view.
  if (!active) return false;
  input.question = active.question;
  input.options = active.options;
  input.expiresAt = active.expiresAt;
  return true;
}

function createMultiQuestionUserInputState(
  payload: UserInputMultiQuestionRequestedPayload,
): MultiQuestionUserInputState | null {
  const first = payload.questions[0];
  // The schema enforces min(1); guard bypassed empty arrays and fail closed
  // (the caller leaves the request unrecorded).
  if (!first) return null;
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
  input: MultiQuestionUserInputState,
): boolean {
  const question = input.questions.find(
    (candidate) => candidate.questionId === payload.questionId,
  );
  if (!question) return false;
  const current = input.answers[payload.questionId];
  if (current && current.status !== "pending") return false;
  if (payload.source === "user" || payload.source === "timeout") {
    const resolvedAtMs = Date.parse(event.timestamp);
    const expiresAtMs = Date.parse(question.expiresAt);
    // Date.parse yields NaN for malformed timestamps and NaN comparisons are
    // always false; fail closed by treating any non-finite parse as a
    // discard so malformed data can neither answer nor time out a question.
    if (!Number.isFinite(resolvedAtMs) || !Number.isFinite(expiresAtMs)) {
      return false;
    }
    if (payload.source === "user") {
      // User answers are valid up to and including the expiry instant.
      if (resolvedAtMs > expiresAtMs) return false;
    } else {
      // Reverse gate for timeouts: a real timer fires at or after expiresAt,
      // so a timeout stamped before the deadline (clock skew or replay) is
      // discarded whole — accepting it would mark the question timed-out and
      // steal the user's remaining answer time.
      if (resolvedAtMs < expiresAtMs) return false;
    }
  }
  // Cancelled resolutions skip time gating entirely: lifecycle cancellation
  // (turn cancel, host exit, crash recovery) can legitimately happen at any
  // moment relative to the deadline.
  if (
    payload.selectedOptionLabel !== undefined &&
    !question.options.some(
      (option) => option.label === payload.selectedOptionLabel,
    )
  ) {
    return false;
  }
  const answer = payload.customAnswer ?? payload.selectedOptionLabel;
  const next: MultiQuestionUserInputState = {
    ...input,
    answers: {
      ...input.answers,
      // Cancelled questions close bare — status:cancelled carries no
      // answer, mirroring the legacy translation path, so an answer riding
      // on the resolution is dropped rather than persisted.
      [payload.questionId]:
        payload.source === "cancelled"
          ? { status: "cancelled" }
          : {
              status: payload.source === "timeout" ? "timed-out" : "answered",
              ...(answer === undefined ? {} : { answer }),
              ...(payload.selectedOptionLabel === undefined
                ? {}
                : { selectedOptionLabel: payload.selectedOptionLabel }),
            },
    },
  };
  next.status = multiQuestionAggregateStatus(next);
  if (!syncMultiQuestionLegacyView(next)) return false;
  state.userInputs[payload.requestId] = next;
  return true;
}

// Translates a legacy (kind-less) cancelled/timeout resolution into a
// whole-card close: still-pending questions are closed with the status
// mapped from the source, answered questions keep their answers, and the
// aggregate status is recomputed. Timeout translations apply the same
// reverse time gate per question: only pending questions whose expiresAt
// has been reached by the event timestamp may close, so a kind-less timeout
// firing between two deadlines closes only the expired question and leaves
// the card (and thread) waiting on the rest. Cancelled translations skip
// the gate because lifecycle cancellation can happen at any moment. Returns
// whether any question changed.
function applyLegacyMultiQuestionClose(
  state: ThreadViewState,
  event: AgentEvent,
  payload: UserInputResolvedPayload,
): boolean {
  const closeStatus = payload.source === "timeout" ? "timed-out" : "cancelled";
  const input = state.userInputs[payload.requestId];
  if (!isMultiQuestionInput(input)) return false;
  const resolvedAtMs =
    payload.source === "timeout" ? Date.parse(event.timestamp) : undefined;
  let changed = false;
  const answers: Record<string, UserInputQuestionState> = { ...input.answers };
  for (const question of input.questions) {
    const current = answers[question.questionId];
    if (current && current.status !== "pending") continue;
    if (resolvedAtMs !== undefined) {
      const expiresAtMs = Date.parse(question.expiresAt);
      // NaN parses compare false everywhere, so unparseable timestamps
      // fail closed and leave the question pending instead of closing it
      // ahead of its deadline.
      if (!Number.isFinite(resolvedAtMs) || !Number.isFinite(expiresAtMs)) {
        continue;
      }
      if (resolvedAtMs < expiresAtMs) continue;
    }
    answers[question.questionId] = { status: closeStatus };
    changed = true;
  }
  if (!changed) return false;
  const next: MultiQuestionUserInputState = { ...input, answers };
  next.status = multiQuestionAggregateStatus(next);
  if (!syncMultiQuestionLegacyView(next)) return false;
  state.userInputs[payload.requestId] = next;
  return true;
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
        if (existing) {
          if (
            isMultiQuestionInput(existing) &&
            multiQuestionFingerprint(existing) ===
              multiQuestionFingerprint(payload)
          ) {
            // True replay of identical content (same questions, request
            // nonce, and header): complete no-op so already-collected
            // answers survive instead of being reset.
            return;
          }
          // Reusing the requestId with different content (different question
          // IDs, options, expiry, nonce, or header — including sets that only
          // appear equal through separator-embedded IDs) or over an existing
          // single-question input: fail closed and keep the current state.
          return;
        }
        const created = createMultiQuestionUserInputState(payload);
        if (!created) return;
        state.userInputs[payload.requestId] = created;
        state.status = "waiting-user-input";
        appendOnce(state.order, orderedItems, `input:${payload.requestId}`);
        return;
      }
      const existingInput = state.userInputs[payload.requestId];
      if (isMultiQuestionInput(existingInput)) {
        // Symmetric fail-closed guard: a legacy (kind-less) requested reusing
        // a multi-question requestId must leave the multi-question state and
        // thread status untouched instead of clobbering it with a
        // single-question payload.
        return;
      }
      // Strip any questions key (including an explicit `questions:
      // undefined` delivered by a bypassed path) so the stored state can
      // never grow a non-array questions key that would poison the
      // multi-question duck typing above.
      const { questions: _questions, ...singlePayload } = payload;
      state.userInputs[payload.requestId] = {
        ...singlePayload,
        status: "pending",
      };
      state.status = "waiting-user-input";
      appendOnce(state.order, orderedItems, `input:${payload.requestId}`);
      return;
    }
    case "user-input.resolved": {
      if (payload.kind === "multi-question") {
        // The nonce is bound to the request here, before any question,
        // option, or status change: a resolution whose nonce does not match
        // the requested nonce is discarded whole, leaving the question state
        // and thread status untouched. The trust boundary is two layers —
        // the event-log write-side schema shape-validates the nonce when
        // events are persisted, and the reducer binds it to the request,
        // mirroring the policy layer's consume() nonce check
        // (user-input-policy.ts).
        const requested = state.userInputs[payload.requestId];
        if (!isMultiQuestionInput(requested)) return;
        if (requested.nonce !== payload.nonce) return;
        // Recalculate the thread status only when the resolution actually
        // changed question state: a discarded resolution (expired, unknown
        // question, already answered, or aimed at a single-question request)
        // must not resurrect waiting-user-input or flip an idle thread back
        // to running.
        if (applyMultiQuestionResolution(state, event, payload, requested)) {
          state.status = pendingInteractionStatus(state);
        }
        return;
      }
      const input = state.userInputs[payload.requestId];
      if (isMultiQuestionInput(input)) {
        // Legacy (kind-less) resolutions are still emitted by the
        // crash-restore (store), turn-cancellation, and host-exit paths.
        // Bind the nonce first: a resolution whose nonce does not match the
        // request is discarded whole. Then translate by source — cancelled
        // resolutions close every still-pending question (a whole-card
        // terminal state that per-question payloads cannot express), while
        // timeout resolutions close only the pending questions whose
        // deadline the event timestamp has reached, and a "user" answer
        // cannot be mapped onto individual questions and is still dropped
        // whole. The translation never touches the top-level answer, so no
        // mixed top-level-cancelled + answers-pending state can result.
        if (input.nonce !== payload.nonce) return;
        if (payload.source === "user") return;
        if (applyLegacyMultiQuestionClose(state, event, payload)) {
          state.status = pendingInteractionStatus(state);
        }
        return;
      }
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
