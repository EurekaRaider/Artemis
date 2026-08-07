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
