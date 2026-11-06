import { record } from "./runtime-values.js";
import {
  type AgentSession,
  type QueuedFollowUpReplacement,
} from "./runtime-types.js";
export function removeFirst(value: string, section: string): string {
  if (!section) return value;
  const index = value.indexOf(section);
  return index < 0
    ? value
    : `${value.slice(0, index)}${value.slice(index + section.length)}`;
}

export function queuedUserMessageText(message: unknown): string | undefined {
  const value = record(message);
  if (value?.role !== "user") return undefined;
  if (typeof value.content === "string") return value.content;
  if (!Array.isArray(value.content)) return undefined;
  return value.content
    .flatMap((part) => {
      const content = record(part);
      return content?.type === "text" && typeof content.text === "string"
        ? [content.text]
        : [];
    })
    .join("\n");
}

export function steerPiQueuedFollowUp(
  session: AgentSession,
  followUpIndex: number,
  expectedFollowUp: readonly string[],
): void {
  const visibleFollowUp = session.getFollowUpMessages();
  if (
    visibleFollowUp.length !== expectedFollowUp.length ||
    visibleFollowUp.some((text, index) => text !== expectedFollowUp[index])
  ) {
    throw new Error(
      "Queued follow-ups changed. Refresh the queue and try again.",
    );
  }
  const selectedText = visibleFollowUp[followUpIndex];
  if (selectedText === undefined) {
    throw new Error(`Queued follow-up ${followUpIndex} does not exist.`);
  }

  // Pi 0.84.3 exposes only string snapshots publicly. Its complete queued
  // AgentMessage objects (including images and hidden custom messages) remain
  // on these runtime queues, so move the original object instead of clearing
  // and rebuilding a lossy string queue.
  const mutableSession = session as unknown as {
    _steeringMessages?: string[];
    _followUpMessages?: string[];
    _emitQueueUpdate?: () => void;
    agent?: {
      steeringQueue?: { messages?: unknown[] };
      followUpQueue?: { messages?: unknown[] };
    };
  };
  const visibleSteering = session.getSteeringMessages();
  const steeringMessages = mutableSession.agent?.steeringQueue?.messages;
  const followUpMessages = mutableSession.agent?.followUpQueue?.messages;
  if (
    mutableSession._steeringMessages !== visibleSteering ||
    mutableSession._followUpMessages !== visibleFollowUp ||
    !Array.isArray(steeringMessages) ||
    !Array.isArray(followUpMessages) ||
    typeof mutableSession._emitQueueUpdate !== "function"
  ) {
    throw new Error(
      "Installed Pi runtime does not support queued message steering.",
    );
  }

  const visibleMessageIndexes: number[] = [];
  const visibleMessageTexts: string[] = [];
  for (const [index, message] of followUpMessages.entries()) {
    const text = queuedUserMessageText(message);
    if (text !== undefined) {
      visibleMessageIndexes.push(index);
      visibleMessageTexts.push(text);
    }
  }
  if (
    visibleMessageTexts.length !== visibleFollowUp.length ||
    visibleMessageTexts.some((text, index) => text !== visibleFollowUp[index])
  ) {
    throw new Error(
      "Pi follow-up queue is out of sync; no messages were changed.",
    );
  }

  const rawIndex = visibleMessageIndexes[followUpIndex];
  if (rawIndex === undefined) {
    throw new Error(
      "Pi follow-up queue is out of sync; no messages were changed.",
    );
  }
  const selectedMessage = followUpMessages[rawIndex];
  if (selectedMessage === undefined) {
    throw new Error(
      "Pi follow-up queue is out of sync; no messages were changed.",
    );
  }
  followUpMessages.splice(rawIndex, 1);
  steeringMessages.push(selectedMessage);
  mutableSession._followUpMessages.splice(followUpIndex, 1);
  mutableSession._steeringMessages.push(selectedText);
  mutableSession._emitQueueUpdate();
}

export function replaceQueuedUserMessageText(
  message: unknown,
  text: string,
): unknown {
  const value = record(message);
  if (value?.role !== "user") {
    throw new Error("Pi follow-up queue contains an unsupported message.");
  }
  if (typeof value.content === "string") {
    return { ...value, content: text };
  }
  if (!Array.isArray(value.content)) {
    throw new Error("Pi follow-up queue contains an unsupported message.");
  }
  const textIndexes = value.content.flatMap((part, index) => {
    const content = record(part);
    return content?.type === "text" && typeof content.text === "string"
      ? [index]
      : [];
  });
  if (textIndexes.length !== 1) {
    throw new Error(
      "A queued message with multiple text blocks cannot be edited safely.",
    );
  }
  const textIndex = textIndexes[0]!;
  return {
    ...value,
    content: value.content.map((part, index) =>
      index === textIndex ? { ...record(part), text } : part,
    ),
  };
}

export function replacePiQueuedFollowUp(
  session: AgentSession,
  expectedFollowUp: readonly string[],
  followUp: readonly QueuedFollowUpReplacement[],
): void {
  const visibleFollowUp = session.getFollowUpMessages();
  if (
    visibleFollowUp.length !== expectedFollowUp.length ||
    visibleFollowUp.some((text, index) => text !== expectedFollowUp[index])
  ) {
    throw new Error(
      "Queued follow-ups changed. Refresh the queue and try again.",
    );
  }

  const mutableSession = session as unknown as {
    _followUpMessages?: string[];
    _emitQueueUpdate?: () => void;
    agent?: { followUpQueue?: { messages?: unknown[] } };
  };
  const rawMessages = mutableSession.agent?.followUpQueue?.messages;
  if (
    mutableSession._followUpMessages !== visibleFollowUp ||
    !Array.isArray(rawMessages) ||
    typeof mutableSession._emitQueueUpdate !== "function"
  ) {
    throw new Error(
      "Installed Pi runtime does not support queued message replacement.",
    );
  }

  const visibleMessages = rawMessages.flatMap((message) =>
    queuedUserMessageText(message) === undefined ? [] : [message],
  );
  const visibleMessageTexts = visibleMessages.map(queuedUserMessageText);
  if (
    visibleMessageTexts.length !== visibleFollowUp.length ||
    visibleMessageTexts.some((text, index) => text !== visibleFollowUp[index])
  ) {
    throw new Error(
      "Pi follow-up queue is out of sync; no messages were changed.",
    );
  }

  const usedSourceIndexes = new Set<number>();
  const replacements = followUp.map((replacement) => {
    if (
      replacement.sourceIndex < 0 ||
      replacement.sourceIndex >= visibleMessages.length ||
      usedSourceIndexes.has(replacement.sourceIndex)
    ) {
      throw new Error(
        "Queued follow-up replacement is invalid; no messages were changed.",
      );
    }
    usedSourceIndexes.add(replacement.sourceIndex);
    const original = visibleMessages[replacement.sourceIndex]!;
    return replacement.text === expectedFollowUp[replacement.sourceIndex]
      ? original
      : replaceQueuedUserMessageText(original, replacement.text);
  });

  let replacementIndex = 0;
  const nextRawMessages = rawMessages.flatMap((message) => {
    if (queuedUserMessageText(message) === undefined) return [message];
    const replacement = replacements[replacementIndex++];
    return replacement === undefined ? [] : [replacement];
  });
  rawMessages.splice(0, rawMessages.length, ...nextRawMessages);
  mutableSession._followUpMessages.splice(
    0,
    mutableSession._followUpMessages.length,
    ...followUp.map((replacement) => replacement.text),
  );
  mutableSession._emitQueueUpdate();
}
