import { timingSafeEqual } from "node:crypto";

import type { UserInputOption, UserInputResolution } from "@artemis/protocol";

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
}

export interface MultiUserInputQuestionResolution {
  requestId: string;
  nonce: string;
  questionId: string;
  selectedOptionLabel?: string;
  customAnswer?: string;
}

export interface AnsweredMultiUserInputQuestion {
  questionId: string;
  answer: string;
  selectedOptionLabel?: string;
  customAnswer?: string;
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

  consumeQuestion(
    resolution: MultiUserInputQuestionResolution,
  ): ResolvedMultiUserInputQuestion<T> {
    const entry = this.pending.get(resolution.requestId);
    if (!entry) throw new Error("User input is no longer pending.");
    if (!nonceMatches(entry.nonce, resolution.nonce)) {
      throw new Error("User-input nonce does not match.");
    }
    const question = entry.questions.find(
      (candidate) => candidate.questionId === resolution.questionId,
    );
    if (!question) {
      throw new Error("User-input question was not offered.");
    }
    if (question.answered) {
      throw new Error("User input is no longer pending.");
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
      };
    } else {
      const answer = resolution.customAnswer?.trim() ?? "";
      if (!answer) {
        throw new Error("A custom user-input answer cannot be empty.");
      }
      answered = {
        questionId: question.questionId,
        answer,
        customAnswer: answer,
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
    return this.consumeQuestion({
      requestId,
      nonce,
      questionId,
      selectedOptionLabel: recommended.label,
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
