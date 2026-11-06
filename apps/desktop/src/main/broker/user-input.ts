import type {
  MultiQuestionUserInputRequest,
  PendingUserInput,
  PendingMultiUserInput,
} from "../application/runtime-types.js";
import { randomUUID } from "node:crypto";
import type {
  BrokerExecutionRequest,
  UserInputResolution,
  UserInputMultiQuestionResolution,
} from "@artemis/protocol";
import {
  USER_INPUT_TIMEOUT_MILLISECONDS,
  isMultiQuestionUserInputRequest,
  prepareMultiQuestionUserInputRegistration,
  prepareSingleQuestionUserInputRegistration,
} from "../security/user-input-policy.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  | "agentProcess"
  | "store"
  | "pendingUserInputs"
  | "emitPayload"
  | "cancellingTurns"
  | "activeTurns"
  | "pendingMultiUserInputs"
  | "rejectBrokerRequest"
  | "diagnosticBundleService"
>;
export function createUserInputBroker(services: Dependencies) {
  const {
    pendingUserInputs,
    emitPayload,
    cancellingTurns,
    activeTurns,
    pendingMultiUserInputs,
    rejectBrokerRequest,
  } = services;
  function completeUserInput(
    resolution: UserInputResolution,
    source: "user" | "timeout",
  ): void {
    if (!services.agentProcess || !services.store)
      throw new Error("Application is not ready.");
    const resolved =
      source === "timeout"
        ? pendingUserInputs.consumeRecommended(
            resolution.requestId,
            resolution.nonce,
          )
        : pendingUserInputs.consume(resolution);
    if (resolved.value.timeout !== undefined) {
      clearTimeout(resolved.value.timeout);
    }
    const { request, workerRequestId } = resolved.value;
    emitPayload(request.threadId, request.turnId, {
      type: "user-input.resolved",
      requestId: request.approvalId,
      nonce: resolution.nonce,
      answer: resolved.answer,
      ...(resolved.skipped ? { skipped: true as const } : {}),
      ...(resolved.selectedOption === undefined
        ? {}
        : { selectedOption: resolved.selectedOption }),
      source,
    });
    services.agentProcess.post({
      type: "broker.resolve",
      requestId: workerRequestId,
      resolution: {
        approvalId: request.approvalId,
        nonce: resolution.nonce,
        approved: true,
        scope: "once",
        source: source === "timeout" ? "policy" : "user",
      },
      result: {
        answer: resolved.answer,
        ...(resolved.skipped ? { skipped: true as const } : {}),
        ...(resolved.selectedOption === undefined
          ? {}
          : {
              selectedOption: resolved.selectedOption,
              selectedLabel: request.options[resolved.selectedOption]?.label,
            }),
        source,
      },
    });
  }

  function handleUserInputBrokerRequest(
    workerRequestId: string,
    request: Extract<BrokerExecutionRequest, { kind: "user.input" }>,
  ): void {
    if (!services.agentProcess || !services.store) return;
    if (isMultiQuestionUserInputRequest(request)) {
      handleMultiQuestionUserInputBrokerRequest(workerRequestId, request);
      return;
    }
    // Every rejection branch (thread/turn/mode ownership, option shape,
    // frozen-schema parse including a carried `questions` key, duplicate
    // pending) is decided by the pure validator so it stays unit-testable
    // and every failure path answers with one broker reject (review P1-2).
    const thread = services.store.getThread(request.threadId);
    const prepared = prepareSingleQuestionUserInputRegistration(
      request,
      {
        // getThread returns undefined — never null — for a missing thread
        // (store.ts), so the ownership gate keys on Boolean(thread); a
        // `!== null` comparison is vacuously true and silently disables the
        // gate (review round 3, severity 1).
        threadExists: Boolean(thread),
        turnCancelling: cancellingTurns.has(request.threadId),
        turnActive: activeTurns.get(request.threadId) === request.turnId,
        modeMatches: thread?.mode === request.mode,
        // Duplicates are refused across both registries (review round 3,
        // item 3): the same approval id must never sit in the single and the
        // multi registry at once, or the reducer's fail-closed second request
        // would leave a ghost pending card no user can ever answer.
        duplicatePending:
          pendingUserInputs.hasWhere(
            (pending) => pending.request.approvalId === request.approvalId,
          ) ||
          pendingMultiUserInputs.hasWhere(
            (pending) => pending.request.approvalId === request.approvalId,
          ),
      },
      { nonce: randomUUID(), now: Date.now() },
    );
    if (!prepared.ok) {
      rejectBrokerRequest(workerRequestId, request, prepared.reason);
      return;
    }
    const payload = prepared.payload;
    const nonce = payload.nonce;
    const recommendedOption = payload.options.findIndex(
      (option) => option.recommended,
    );
    // Register before arming the timer (review item 2, single-path closeout):
    // a rejected registration can never leak an orphan timer. Duplicates
    // were already refused by the pure validator above with one broker
    // reject, so the registry register()'s throw plus the catch below is the
    // only single-threaded backstop this path needs (review round 3, item 4
    // removed the unreachable post-prepare duplicate check).
    const pendingValue: PendingUserInput = {
      workerRequestId,
      request,
      timeout: undefined,
    };
    try {
      pendingUserInputs.register({
        requestId: request.approvalId,
        nonce,
        options: payload.options,
        value: pendingValue,
      });
    } catch (error) {
      rejectBrokerRequest(
        workerRequestId,
        request,
        error instanceof Error && error.message.includes("already pending")
          ? "User input is already pending."
          : error instanceof Error
            ? error.message
            : "User input is invalid.",
      );
      return;
    }
    pendingValue.timeout = setTimeout(() => {
      try {
        completeUserInput(
          {
            requestId: request.approvalId,
            nonce,
            selectedOption: recommendedOption,
          },
          "timeout",
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Timed-out user input could not be resolved.";
        services.diagnosticBundleService?.record({
          source: "main",
          // The user answering just before the timer fires is a normal race,
          // not a fault: keep that noise out of the error channel (nit 8).
          severity:
            message === "User input is no longer pending."
              ? "warning"
              : "error",
          message,
        });
      }
    }, USER_INPUT_TIMEOUT_MILLISECONDS);
    emitPayload(request.threadId, request.turnId, payload);
  }

  function isMultiQuestionUserInputResolution(
    resolution: UserInputResolution,
  ): resolution is UserInputMultiQuestionResolution {
    return resolution.kind === "multi-question";
  }

  function completeMultiUserInputQuestion(
    requestId: string,
    nonce: string,
    questionId: string,
    source: "user" | "timeout",
    selection: {
      selectedOptionLabel?: string;
      customAnswer?: string;
      skipped?: true;
    } = {},
  ): void {
    if (!services.agentProcess || !services.store)
      throw new Error("Application is not ready.");
    // Main-process expiry gate mirroring the reducer's own (review item 1):
    // a user answer past expiresAt is refused before consumption so the
    // caller perceives the rejection, and the emitted timestamp is clamped
    // onto the frozen deadline so the reducer's time gates can never disagree
    // with this gate (scenario A's millisecond race between consume and
    // stamp, scenario B's clock step-back).
    const expiresAt = pendingMultiUserInputs.getQuestionExpiresAt(
      requestId,
      questionId,
    );
    const expiresAtMs =
      expiresAt === undefined ? Number.NaN : Date.parse(expiresAt);
    if (
      source === "user" &&
      Number.isFinite(expiresAtMs) &&
      Date.now() > expiresAtMs
    ) {
      throw new Error("User input has expired.");
    }
    const resolved =
      source === "timeout"
        ? pendingMultiUserInputs.consumeRecommendedQuestion(
            requestId,
            nonce,
            questionId,
          )
        : pendingMultiUserInputs.consumeQuestion({
            requestId,
            nonce,
            questionId,
            source,
            ...selection,
          });
    const { request, workerRequestId, timeouts } = resolved.value;
    const timeout = timeouts.get(questionId);
    if (timeout !== undefined) clearTimeout(timeout);
    // User answers are stamped at or before the deadline; timeouts at or
    // after it — exactly the windows the reducer accepts.
    const resolvedAtMs = Number.isFinite(expiresAtMs)
      ? source === "user"
        ? Math.min(Date.now(), expiresAtMs)
        : Math.max(Date.now(), expiresAtMs)
      : Date.now();
    emitPayload(
      request.threadId,
      request.turnId,
      {
        type: "user-input.resolved",
        kind: "multi-question",
        requestId,
        nonce,
        questionId,
        ...(resolved.selectedOptionLabel === undefined
          ? {}
          : { selectedOptionLabel: resolved.selectedOptionLabel }),
        ...(resolved.skipped ? { skipped: true as const } : {}),
        ...(resolved.customAnswer === undefined
          ? {}
          : { customAnswer: resolved.customAnswer }),
        source,
      },
      new Date(resolvedAtMs).toISOString(),
    );
    if (!resolved.final) return;
    // Dual-channel backfill: the renderer already saw one kind'd resolved
    // event per question; the agent's tool promise settles exactly once with
    // an aggregated result covering every question on the card.
    services.agentProcess.post({
      type: "broker.resolve",
      requestId: workerRequestId,
      resolution: {
        approvalId: requestId,
        nonce,
        approved: true,
        scope: "once",
        source: source === "timeout" ? "policy" : "user",
      },
      result: {
        // No top-level source (review R2 P1-3): the aggregate spans every
        // question and each answer carries its own provenance, so one
        // card-level source would misstate every question that settled
        // differently from the last one.
        answers: resolved.final.answers,
      },
    });
  }

  function handleMultiQuestionUserInputBrokerRequest(
    workerRequestId: string,
    request: MultiQuestionUserInputRequest,
  ): void {
    if (!services.agentProcess || !services.store) return;
    const thread = services.store.getThread(request.threadId);
    // Every rejection branch (thread/turn/mode ownership, question count and
    // shape, frozen-schema parse, duplicate injection) is decided by the pure
    // validator so it stays unit-testable (review item 5) and every failure
    // path answers with one broker reject instead of a thrown error.
    const prepared = prepareMultiQuestionUserInputRegistration(
      request,
      {
        // Same Boolean(thread) ownership gate as the single-question handler:
        // getThread signals a missing thread with undefined, not null (review
        // round 3, severity 1).
        threadExists: Boolean(thread),
        turnCancelling: cancellingTurns.has(request.threadId),
        turnActive: activeTurns.get(request.threadId) === request.turnId,
        modeMatches: thread?.mode === request.mode,
        // Cross-registry duplicate refusal (review round 3, item 3), sharing
        // the "User input is already pending." reject reason with the
        // single-question registry.
        duplicatePending:
          pendingMultiUserInputs.hasWhere(
            (pending) => pending.request.approvalId === request.approvalId,
          ) ||
          pendingUserInputs.hasWhere(
            (pending) => pending.request.approvalId === request.approvalId,
          ),
      },
      { nonce: randomUUID(), now: Date.now() },
    );
    if (!prepared.ok) {
      rejectBrokerRequest(workerRequestId, request, prepared.reason);
      return;
    }
    const payload = prepared.payload;
    // Register before arming the timers (review item 2): a rejected
    // registration can never leak orphan timers that before-quit cleanup
    // cannot reach, and duplicates were already answered above with one
    // broker reject instead of an unhandled throw.
    const pendingValue: PendingMultiUserInput = {
      workerRequestId,
      request,
      timeouts: new Map(),
    };
    try {
      pendingMultiUserInputs.register({
        requestId: request.approvalId,
        nonce: payload.nonce,
        questions: payload.questions.map((question) => ({
          questionId: question.questionId,
          options: question.options,
          expiresAt: question.expiresAt,
        })),
        value: pendingValue,
      });
    } catch (error) {
      rejectBrokerRequest(
        workerRequestId,
        request,
        error instanceof Error && error.message.includes("already pending")
          ? "User input is already pending."
          : error instanceof Error
            ? error.message
            : "User input is invalid.",
      );
      return;
    }
    // Per-question timers (independent five-minute clocks): each expiry
    // resolves only its own question with its own recommended label; the
    // reducer's reverse time gate (timestamp >= expiresAt) accepts exactly
    // these events.
    for (const question of payload.questions) {
      pendingValue.timeouts.set(
        question.questionId,
        setTimeout(() => {
          try {
            completeMultiUserInputQuestion(
              request.approvalId,
              payload.nonce,
              question.questionId,
              "timeout",
            );
          } catch (error) {
            const message =
              error instanceof Error
                ? error.message
                : "Timed-out user input could not be resolved.";
            services.diagnosticBundleService?.record({
              source: "main",
              // The user answering just before the timer fires is a normal
              // race, not a fault: keep that noise out of the error channel
              // (nit 8).
              severity:
                message === "User input is no longer pending."
                  ? "warning"
                  : "error",
              message,
            });
          }
        }, USER_INPUT_TIMEOUT_MILLISECONDS),
      );
    }
    emitPayload(request.threadId, request.turnId, payload);
  }
  return {
    completeUserInput,
    handleUserInputBrokerRequest,
    isMultiQuestionUserInputResolution,
    completeMultiUserInputQuestion,
    handleMultiQuestionUserInputBrokerRequest,
  };
}
