import { timingSafeEqual } from "node:crypto";

import {
  MAX_USER_INPUT_QUESTIONS,
  userInputMultiQuestionRequestedPayloadSchema,
  userInputRequestedPayloadSchema,
  type BrokerExecutionRequest,
  type UserInputMultiQuestionRequestedPayload,
  type UserInputOption,
  type UserInputRequestedPayload,
  type UserInputResolution,
} from "@artemis/protocol";

export const USER_INPUT_TIMEOUT_MILLISECONDS = 5 * 60 * 1_000;

interface PendingUserInput<T> {
  requestId: string;
  nonce: string;
  options: UserInputOption[];
  value: T;
}

export interface ResolvedUserInput<T> {
  value: T;
  answer: string;
  selectedOption?: number;
}

export interface CancelledUserInput<T> {
  requestId: string;
  nonce: string;
  value: T;
}

function nonceMatches(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return (
    expectedBuffer.length === actualBuffer.length &&
    timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

export class PendingUserInputRegistry<T> {
  private readonly pending = new Map<string, PendingUserInput<T>>();

  get size(): number {
    return this.pending.size;
  }

  register(input: PendingUserInput<T>): void {
    if (this.pending.has(input.requestId)) {
      throw new Error(`User input is already pending: ${input.requestId}`);
    }
    if (input.options.filter((option) => option.recommended).length !== 1) {
      throw new Error("User input requires exactly one recommended option.");
    }
    this.pending.set(input.requestId, input);
  }

  hasWhere(predicate: (value: T) => boolean): boolean {
    for (const input of this.pending.values()) {
      if (predicate(input.value)) return true;
    }
    return false;
  }

  consume(resolution: UserInputResolution): ResolvedUserInput<T> {
    const input = this.pending.get(resolution.requestId);
    if (!input) throw new Error("User input is no longer pending.");
    if (!nonceMatches(input.nonce, resolution.nonce)) {
      throw new Error("User-input nonce does not match.");
    }

    let answer: string;
    let selectedOption: number | undefined;
    if (resolution.selectedOption !== undefined) {
      const selected = input.options[resolution.selectedOption];
      if (!selected)
        throw new Error("Selected user-input option was not offered.");
      answer = selected.label;
      selectedOption = resolution.selectedOption;
    } else {
      answer = resolution.customAnswer?.trim() ?? "";
      if (!answer)
        throw new Error("A custom user-input answer cannot be empty.");
    }

    this.pending.delete(resolution.requestId);
    return {
      value: input.value,
      answer,
      ...(selectedOption === undefined ? {} : { selectedOption }),
    };
  }

  consumeRecommended(requestId: string, nonce: string): ResolvedUserInput<T> {
    const input = this.pending.get(requestId);
    if (!input) throw new Error("User input is no longer pending.");
    const selectedOption = input.options.findIndex(
      (option) => option.recommended,
    );
    return this.consume({ requestId, nonce, selectedOption });
  }

  cancelWhere(predicate: (value: T) => boolean): CancelledUserInput<T>[] {
    const cancelled: CancelledUserInput<T>[] = [];
    for (const [requestId, input] of this.pending) {
      if (!predicate(input.value)) continue;
      this.pending.delete(requestId);
      cancelled.push({
        requestId,
        nonce: input.nonce,
        value: input.value,
      });
    }
    return cancelled;
  }
}

export interface PendingMultiUserInputQuestion {
  questionId: string;
  options: UserInputOption[];
  // Frozen per-question deadline (from the persisted requested payload) so
  // the main process can apply the same expiry gates the reducer will apply
  // when the resolution event is replayed.
  expiresAt: string;
}

export interface MultiUserInputQuestionResolution {
  requestId: string;
  nonce: string;
  questionId: string;
  selectedOptionLabel?: string;
  customAnswer?: string;
  source: "user" | "timeout";
}

export interface AnsweredMultiUserInputQuestion {
  questionId: string;
  answer: string;
  selectedOptionLabel?: string;
  customAnswer?: string;
  // Per-question provenance so the aggregated broker backfill can tell a
  // user choice from a timeout's recommended fallback (review item 4).
  source: "user" | "timeout";
}

export interface ResolvedMultiUserInputQuestion<T> {
  questionId: string;
  answer: string;
  selectedOptionLabel?: string;
  customAnswer?: string;
  value: T;
  // Present only when this resolution answered the last pending question:
  // carries every per-question answer so the single broker.resolve backfill
  // can aggregate the whole card at once.
  final?: { answers: AnsweredMultiUserInputQuestion[] };
}

interface PendingMultiUserInputEntry<T> {
  nonce: string;
  questions: Array<{
    questionId: string;
    options: UserInputOption[];
    expiresAt: string;
    answered?: AnsweredMultiUserInputQuestion;
  }>;
  value: T;
}

export class PendingMultiUserInputRegistry<T> {
  private readonly pending = new Map<string, PendingMultiUserInputEntry<T>>();

  get size(): number {
    return this.pending.size;
  }

  register(input: {
    requestId: string;
    nonce: string;
    questions: PendingMultiUserInputQuestion[];
    value: T;
  }): void {
    if (this.pending.has(input.requestId)) {
      throw new Error(`User input is already pending: ${input.requestId}`);
    }
    if (input.questions.length === 0) {
      throw new Error("User input requires at least one question.");
    }
    const questionIds = new Set<string>();
    for (const question of input.questions) {
      if (questionIds.has(question.questionId)) {
        throw new Error("User-input question IDs must be unique.");
      }
      questionIds.add(question.questionId);
      if (
        question.options.filter((option) => option.recommended).length !== 1
      ) {
        throw new Error("User input requires exactly one recommended option.");
      }
    }
    this.pending.set(input.requestId, {
      nonce: input.nonce,
      questions: input.questions.map((question) => ({
        questionId: question.questionId,
        options: question.options,
        expiresAt: question.expiresAt,
      })),
      value: input.value,
    });
  }

  hasWhere(predicate: (value: T) => boolean): boolean {
    for (const entry of this.pending.values()) {
      if (predicate(entry.value)) return true;
    }
    return false;
  }

  // Peeks the frozen deadline for one pending question without consuming
  // it: the main process expiry gate must run before consumption so a late
  // user answer never mutates registry state.
  getQuestionExpiresAt(
    requestId: string,
    questionId: string,
  ): string | undefined {
    const entry = this.pending.get(requestId);
    return entry?.questions.find(
      (candidate) => candidate.questionId === questionId,
    )?.expiresAt;
  }

  consumeQuestion(
    resolution: MultiUserInputQuestionResolution,
  ): ResolvedMultiUserInputQuestion<T> {
    const entry = this.pending.get(resolution.requestId);
    if (!entry) throw new Error("User input is no longer pending.");
    if (!nonceMatches(entry.nonce, resolution.nonce)) {
      throw new Error("User-input nonce does not match.");
    }
    return this.consumeQuestionFromEntry(entry, resolution);
  }

  // Shared consumption core: both public consumers look the entry up once
  // and delegate here, so the recommended fallback does not re-walk the
  // registry the way the old double lookup did (review nit 9).
  private consumeQuestionFromEntry(
    entry: PendingMultiUserInputEntry<T>,
    resolution: MultiUserInputQuestionResolution,
  ): ResolvedMultiUserInputQuestion<T> {
    const question = entry.questions.find(
      (candidate) => candidate.questionId === resolution.questionId,
    );
    if (!question) {
      throw new Error("User-input question was not offered.");
    }
    if (question.answered) {
      throw new Error("User input is no longer pending.");
    }

    // Protocol-isomorphic pre-commit validation (review P1-3): the frozen
    // userInputMultiQuestionResolvedPayloadSchema refuses an answer that
    // fills both fields or neither. Validating after consumption would mark
    // the question answered (and delete the entry on the last one), so the
    // store's later schema rejection would strand the card with no event
    // and no broker resolve — a permanent hang. Every check in this method
    // runs before any state change, so a refused answer leaves the entry
    // pending and the question retryable.
    if (
      (resolution.selectedOptionLabel !== undefined) ===
      (resolution.customAnswer !== undefined)
    ) {
      throw new Error(
        "Resolve one user-input question with one offered option label or one custom answer.",
      );
    }

    let answered: AnsweredMultiUserInputQuestion;
    if (resolution.selectedOptionLabel !== undefined) {
      const selected = question.options.find(
        (option) => option.label === resolution.selectedOptionLabel,
      );
      if (!selected) {
        throw new Error("Selected user-input option was not offered.");
      }
      answered = {
        questionId: question.questionId,
        answer: selected.label,
        selectedOptionLabel: selected.label,
        source: resolution.source,
      };
    } else {
      const answer = resolution.customAnswer?.trim() ?? "";
      if (!answer) {
        throw new Error("A custom user-input answer cannot be empty.");
      }
      // Same mirror as the XOR gate above: the schema caps the trimmed
      // custom answer at 2,000 characters, and an oversized answer must be
      // refused before the entry is consumed (review P1-3).
      if (answer.length > 2_000) {
        throw new Error(
          "A custom user-input answer exceeds the 2,000-character limit.",
        );
      }
      answered = {
        questionId: question.questionId,
        answer,
        customAnswer: answer,
        source: resolution.source,
      };
    }
    question.answered = answered;

    const complete = entry.questions.every(
      (candidate) => candidate.answered !== undefined,
    );
    if (complete) {
      // Whole-card single consumption: the request entry is removed once the
      // last pending question is answered, mirroring the single-question
      // registry's consume-time delete.
      this.pending.delete(resolution.requestId);
    }
    return {
      questionId: answered.questionId,
      answer: answered.answer,
      ...(answered.selectedOptionLabel === undefined
        ? {}
        : { selectedOptionLabel: answered.selectedOptionLabel }),
      ...(answered.customAnswer === undefined
        ? {}
        : { customAnswer: answered.customAnswer }),
      value: entry.value,
      ...(complete
        ? {
            final: {
              answers: entry.questions.map(
                (candidate) => candidate.answered,
              ) as AnsweredMultiUserInputQuestion[],
            },
          }
        : {}),
    };
  }

  consumeRecommendedQuestion(
    requestId: string,
    nonce: string,
    questionId: string,
  ): ResolvedMultiUserInputQuestion<T> {
    const entry = this.pending.get(requestId);
    if (!entry) throw new Error("User input is no longer pending.");
    if (!nonceMatches(entry.nonce, nonce)) {
      throw new Error("User-input nonce does not match.");
    }
    const question = entry.questions.find(
      (candidate) => candidate.questionId === questionId,
    );
    if (!question) {
      throw new Error("User-input question was not offered.");
    }
    const recommended = question.options.find((option) => option.recommended);
    if (!recommended) {
      throw new Error("User input requires exactly one recommended option.");
    }
    return this.consumeQuestionFromEntry(entry, {
      requestId,
      nonce,
      questionId,
      selectedOptionLabel: recommended.label,
      source: "timeout",
    });
  }

  cancelWhere(predicate: (value: T) => boolean): CancelledUserInput<T>[] {
    const cancelled: CancelledUserInput<T>[] = [];
    for (const [requestId, entry] of this.pending) {
      if (!predicate(entry.value)) continue;
      this.pending.delete(requestId);
      cancelled.push({
        requestId,
        nonce: entry.nonce,
        value: entry.value,
      });
    }
    return cancelled;
  }
}

// Rejection reasons shared by the broker handler and its unit tests: the
// main process must answer every invalid request with one broker reject
// instead of a thrown, unhandled promise rejection (review items 2 and 5).
export interface MultiQuestionUserInputRequestValidation {
  approvalId: string;
  header: string;
  questions: Array<{
    questionId: string;
    question: string;
    options: UserInputOption[];
  }>;
}

// Turn-ownership facts shared by both broker-request validators: the
// single- and multi-question preps reject on the same gates so every
// failure path answers with one broker reject.
export interface UserInputBrokerRequestContext {
  threadExists: boolean;
  turnCancelling: boolean;
  turnActive: boolean;
  modeMatches: boolean;
  duplicatePending: boolean;
}

export type MultiQuestionUserInputRegistration =
  | { ok: true; payload: UserInputMultiQuestionRequestedPayload }
  | { ok: false; reason: string };

export function prepareMultiQuestionUserInputRegistration(
  request: MultiQuestionUserInputRequestValidation,
  context: UserInputBrokerRequestContext,
  assembly: { nonce: string; now: number },
): MultiQuestionUserInputRegistration {
  if (
    !context.threadExists ||
    context.turnCancelling ||
    !context.turnActive ||
    !context.modeMatches
  ) {
    return {
      ok: false,
      reason: "User input requires the active task turn.",
    };
  }
  const questionIds = new Set<string>();
  const invalidQuestion = request.questions.some((question) => {
    if (
      !question.questionId ||
      questionIds.has(question.questionId) ||
      question.options.length < 2 ||
      question.options.length > 3 ||
      question.options.filter((option) => option.recommended).length !== 1
    ) {
      return true;
    }
    questionIds.add(question.questionId);
    return false;
  });
  if (
    request.questions.length < 1 ||
    request.questions.length > MAX_USER_INPUT_QUESTIONS ||
    invalidQuestion
  ) {
    return {
      ok: false,
      reason:
        "User input requires one to three unique questions with two or three options and one recommendation each.",
    };
  }
  let payload: UserInputMultiQuestionRequestedPayload;
  try {
    payload = userInputMultiQuestionRequestedPayloadSchema.parse({
      type: "user-input.requested",
      kind: "multi-question",
      requestId: request.approvalId,
      nonce: assembly.nonce,
      header: request.header,
      questions: request.questions.map((question) => ({
        questionId: question.questionId,
        question: question.question,
        options: question.options,
        expiresAt: new Date(
          assembly.now + USER_INPUT_TIMEOUT_MILLISECONDS,
        ).toISOString(),
      })),
    });
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "User input is invalid.",
    };
  }
  if (context.duplicatePending) {
    return { ok: false, reason: "User input is already pending." };
  }
  return { ok: true, payload };
}

// Value-based routing for broker user.input requests (review P1-2): IPC
// structured clone preserves an explicit `questions: undefined` key, so the
// key's presence must never decide the path — only an actual array takes
// the multi-question handler; every other shape stays on the legacy
// single-question path where the frozen schema's routing-hole guard
// rejects the carried key.
export type UserInputBrokerRequest = Extract<
  BrokerExecutionRequest,
  { kind: "user.input" }
>;

export function isMultiQuestionUserInputRequest(
  request: UserInputBrokerRequest,
): request is Extract<
  UserInputBrokerRequest,
  { questions: { questionId: string }[] }
> {
  return Array.isArray((request as { questions?: unknown }).questions);
}

export interface SingleQuestionUserInputRequestValidation {
  approvalId: string;
  header: string;
  question: string;
  options: UserInputOption[];
  // Declared so an IPC-preserved explicit `questions` key reaches the
  // frozen schema's routing-hole guard instead of being dropped before
  // validation.
  questions?: unknown;
}

export type SingleQuestionUserInputRegistration =
  | { ok: true; payload: UserInputRequestedPayload }
  | { ok: false; reason: string };

export function prepareSingleQuestionUserInputRegistration(
  request: SingleQuestionUserInputRequestValidation,
  context: UserInputBrokerRequestContext,
  assembly: { nonce: string; now: number },
): SingleQuestionUserInputRegistration {
  if (
    !context.threadExists ||
    context.turnCancelling ||
    !context.turnActive ||
    !context.modeMatches
  ) {
    return {
      ok: false,
      reason: "User input requires the active task turn.",
    };
  }
  if (
    request.options.length < 2 ||
    request.options.length > 3 ||
    request.options.findIndex((option) => option.recommended) < 0 ||
    request.options.filter((option) => option.recommended).length !== 1
  ) {
    return {
      ok: false,
      reason:
        "User input requires two or three options and one recommendation.",
    };
  }
  let payload: UserInputRequestedPayload;
  try {
    payload = userInputRequestedPayloadSchema.parse({
      type: "user-input.requested",
      requestId: request.approvalId,
      nonce: assembly.nonce,
      header: request.header,
      question: request.question,
      options: request.options,
      expiresAt: new Date(
        assembly.now + USER_INPUT_TIMEOUT_MILLISECONDS,
      ).toISOString(),
      // Fail closed like the frozen schema demands (review P1-2): an
      // IPC-preserved explicit `questions` key — any value, including
      // undefined — must reach the schema's routing-hole guard so the
      // request is answered with one broker reject instead of being
      // silently accepted with the key dropped.
      ...("questions" in request ? { questions: request.questions } : {}),
    });
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "User input is invalid.",
    };
  }
  if (context.duplicatePending) {
    return { ok: false, reason: "User input is already pending." };
  }
  return { ok: true, payload };
}
