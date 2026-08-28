import type { PromptAttachment } from "@artemis/protocol";

export interface RecoveredQueueItem {
  text: string;
  attachments?: PromptAttachment[];
}

interface TrackedQueueItem extends RecoveredQueueItem {
  id: number;
}

interface TrackedQueue {
  steering: TrackedQueueItem[];
  followUp: TrackedQueueItem[];
  recentlyRemoved: TrackedQueueItem[];
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
  ): number {
    const queue = this.#queue(threadId);
    const id = ++this.#sequence;
    queue[kind].push({
      id,
      text,
      ...(attachments?.length
        ? { attachments: structuredClone(attachments) }
        : {}),
    });
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
    this.#deleteEmpty(threadId, queue);
  }

  reconcile(
    threadId: string,
    steering: readonly string[],
    followUp: readonly string[],
  ): void {
    const queue = this.#queue(threadId);
    const active = [...queue.steering, ...queue.followUp];
    const recent = [...queue.recentlyRemoved];
    const take = (text: string): TrackedQueueItem => {
      let index = active.findIndex((item) => item.text === text);
      if (index >= 0) return active.splice(index, 1)[0]!;
      index = recent.findIndex((item) => item.text === text);
      if (index >= 0) return recent.splice(index, 1)[0]!;
      return { id: ++this.#sequence, text };
    };
    queue.steering = steering.map(take);
    queue.followUp = followUp.map(take);
    queue.recentlyRemoved = [...recent, ...active].slice(-256);
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
          const index = candidates.findIndex((item) => item.text === text);
          return index >= 0
            ? publicItem(candidates.splice(index, 1)[0]!)
            : { text };
        })
      : active.map(publicItem);
    this.#queues.delete(threadId);
    return recovered;
  }

  replaceFollowUp(threadId: string, followUp: readonly string[]): void {
    const queue = this.#queue(threadId);
    queue.followUp = followUp.map((text) => ({
      id: ++this.#sequence,
      text,
    }));
    queue.recentlyRemoved = [];
    this.#deleteEmpty(threadId, queue);
  }

  discard(threadId: string): void {
    this.#queues.delete(threadId);
  }

  #queue(threadId: string): TrackedQueue {
    let queue = this.#queues.get(threadId);
    if (!queue) {
      queue = { steering: [], followUp: [], recentlyRemoved: [] };
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
