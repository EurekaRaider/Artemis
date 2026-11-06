import type {
  AgentEvent,
  UserInputMultiQuestionRequestedPayload,
  UserInputMultiQuestionResolvedPayload,
  UserInputQuestion,
  UserInputResolvedPayload,
} from "../schema.js";
import {
  type UserInputState,
  type MultiQuestionUserInputState,
  type ThreadViewState,
  type UserInputQuestionState,
} from "./state.js";
import { appendOnce, type ReductionIndex } from "./timeline.js";

// Multi-question duck typing validates the value, not just the key: IPC
// structured clone preserves explicit `questions: undefined` keys, so a
// state that bypassed the schema (legacy replay, direct reducer writes) can
// carry the key with a non-array value and must stay single-question here.
export function isMultiQuestionInput(
  input: UserInputState | MultiQuestionUserInputState | undefined,
): input is MultiQuestionUserInputState {
  return (
    input !== undefined &&
    "questions" in input &&
    Array.isArray(input.questions)
  );
}

export function multiQuestionFingerprint(request: {
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

export function multiQuestionAggregateStatus(
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

export function syncMultiQuestionLegacyView(
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

export function createMultiQuestionUserInputState(
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

export function applyMultiQuestionResolution(
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
              ...(payload.skipped ? { skipped: true as const } : {}),
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
export function applyLegacyMultiQuestionClose(
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

export function pendingInteractionStatus(
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

export function applyInteractionsPayload(
  state: ThreadViewState,
  event: AgentEvent,
  orderedItems: Set<string>,
  index: ReductionIndex,
): void {
  const payload = event.payload;
  switch (payload.type) {
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
          scope: payload.scope,
          ...(payload.skipped ? { skipped: true as const } : {}),
          ...(payload.feedback ? { feedback: payload.feedback } : {}),
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
          ...(payload.skipped ? { skipped: true as const } : {}),
          ...(payload.selectedOption === undefined
            ? {}
            : { selectedOption: payload.selectedOption }),
        };
      }
      state.status = pendingInteractionStatus(state);
      return;
    }
  }
}
