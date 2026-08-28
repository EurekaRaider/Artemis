import type { PromptAttachment } from "@artemis/protocol";

export interface RecoveredQueueItem {
  text: string;
  attachments?: PromptAttachment[];
}

interface TrackedQueueItem extends RecoveredQueueItem {
  id: number;
  runtimeText: string;
}

interface TrackedQueue {
  revision: number;
  steering: TrackedQueueItem[];
  followUp: TrackedQueueItem[];
  recentlyRemoved: TrackedQueueItem[];
}

interface FollowUpReplacement {
  sourceIndex: number;
  text: string;
}

export interface FollowUpReplacementRollback {
  threadId: string;
  appliedRevision: number;
  previous: TrackedQueue;
  runtimeExpectedFollowUp: string[];
  runtimeFollowUp: FollowUpReplacement[];
}

function publicItem(item: TrackedQueueItem): RecoveredQueueItem {
  return {
    text: item.text,
    ...(item.attachments?.length
      ? { attachments: structuredClone(item.attachments) }
      : {}),
  };
}

export class RecoverableTurnQueues {
  readonly #queues = new Map<string, TrackedQueue>();
  #sequence = 0;

  add(
    threadId: string,
    kind: "steering" | "followUp",
    text: string,
    attachments?: PromptAttachment[],
    runtimeText = text,
  ): number {
    const queue = this.#queue(threadId);
    const id = ++this.#sequence;
    queue[kind].push({
      id,
      text,
      runtimeText,
      ...(attachments?.length
        ? { attachments: structuredClone(attachments) }
        : {}),
    });
    queue.revision += 1;
    return id;
  }

  remove(threadId: string, id: number): void {
    const queue = this.#queues.get(threadId);
    if (!queue) return;
    queue.steering = queue.steering.filter((item) => item.id !== id);
    queue.followUp = queue.followUp.filter((item) => item.id !== id);
    queue.recentlyRemoved = queue.recentlyRemoved.filter(
      (item) => item.id !== id,
    );
    queue.revision += 1;
    this.#deleteEmpty(threadId, queue);
  }

  reconcile(
    threadId: string,
    steering: readonly string[],
    followUp: readonly string[],
  ): { steering: string[]; followUp: string[] } {
    const queue = this.#queue(threadId);
    const active = [...queue.steering, ...queue.followUp];
    const recent = [...queue.recentlyRemoved];
    const take = (runtimeText: string): TrackedQueueItem => {
      let index = active.findIndex((item) => item.runtimeText === runtimeText);
      if (index >= 0) return active.splice(index, 1)[0]!;
      index = recent.findIndex((item) => item.runtimeText === runtimeText);
      if (index >= 0) return recent.splice(index, 1)[0]!;
      return { id: ++this.#sequence, text: runtimeText, runtimeText };
    };
    queue.steering = steering.map(take);
    queue.followUp = followUp.map(take);
    queue.recentlyRemoved = [...recent, ...active].slice(-256);
    queue.revision += 1;
    return {
      steering: queue.steering.map((item) => item.text),
      followUp: queue.followUp.map((item) => item.text),
    };
  }

  recover(
    threadId: string,
    messages?: readonly string[],
  ): RecoveredQueueItem[] {
    const queue = this.#queues.get(threadId);
    if (!queue) {
      return (messages ?? []).map((text) => ({ text }));
    }
    const active = [...queue.steering, ...queue.followUp];
    const candidates = [...active, ...queue.recentlyRemoved];
    const recovered = messages
      ? messages.map((text) => {
          const index = candidates.findIndex(
            (item) => item.runtimeText === text,
          );
          return index >= 0
            ? publicItem(candidates.splice(index, 1)[0]!)
            : { text };
        })
      : active.map(publicItem);
    this.#queues.delete(threadId);
    return recovered;
  }

  runtimeFollowUpSnapshot(
    threadId: string,
    expectedFollowUp: readonly string[],
  ): string[] {
    const queue = this.#queues.get(threadId);
    if (
      !queue ||
      queue.followUp.length !== expectedFollowUp.length ||
      queue.followUp.some(
        (item, index) => item.text !== expectedFollowUp[index],
      )
    ) {
      throw new Error(
        "Queued follow-ups changed. Refresh the queue and try again.",
      );
    }
    return queue.followUp.map((item) => item.runtimeText);
  }

  replaceFollowUp(
    threadId: string,
    expectedFollowUp: readonly string[],
    followUp: readonly FollowUpReplacement[],
    runtimeTextFor: (
      text: string,
      attachments: PromptAttachment[] | undefined,
    ) => string,
  ): FollowUpReplacementRollback {
    const runtimeExpectedFollowUp = this.runtimeFollowUpSnapshot(
      threadId,
      expectedFollowUp,
    );
    const queue = this.#queues.get(threadId)!;
    const previous = structuredClone(queue);
    const usedSourceIndexes = new Set<number>();
    const selectedIds = new Set<number>();
    const replacements = followUp.map((replacement) => {
      const source = queue.followUp[replacement.sourceIndex];
      if (!source || usedSourceIndexes.has(replacement.sourceIndex)) {
        throw new Error(
          "Queued follow-up replacement is invalid; no messages were changed.",
        );
      }
      usedSourceIndexes.add(replacement.sourceIndex);
      selectedIds.add(source.id);
      return {
        ...source,
        text: replacement.text,
        runtimeText:
          replacement.text === source.text
            ? source.runtimeText
            : runtimeTextFor(replacement.text, source.attachments),
      };
    });
    const removed = queue.followUp.filter((item) => !selectedIds.has(item.id));
    queue.followUp = replacements;
    queue.recentlyRemoved = [...queue.recentlyRemoved, ...removed].slice(-256);
    queue.revision += 1;
    const appliedRevision = queue.revision;
    this.#deleteEmpty(threadId, queue);
    return {
      threadId,
      appliedRevision,
      previous,
      runtimeExpectedFollowUp,
      runtimeFollowUp: replacements.map((item, index) => ({
        sourceIndex: followUp[index]!.sourceIndex,
        text: item.runtimeText,
      })),
    };
  }

  rollbackFollowUp(replacement: FollowUpReplacementRollback): void {
    const current = this.#queues.get(replacement.threadId);
    if (!current || current.revision !== replacement.appliedRevision) return;
    this.#queues.set(replacement.threadId, replacement.previous);
  }

  discard(threadId: string): void {
    this.#queues.delete(threadId);
  }

  #queue(threadId: string): TrackedQueue {
    let queue = this.#queues.get(threadId);
    if (!queue) {
      queue = {
        revision: 0,
        steering: [],
        followUp: [],
        recentlyRemoved: [],
      };
      this.#queues.set(threadId, queue);
    }
    return queue;
  }

  #deleteEmpty(threadId: string, queue: TrackedQueue): void {
    if (
      queue.steering.length === 0 &&
      queue.followUp.length === 0 &&
      queue.recentlyRemoved.length === 0
    ) {
      this.#queues.delete(threadId);
    }
  }
}
