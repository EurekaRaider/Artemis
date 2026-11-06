import type { Thread } from "@artemis/protocol";

export interface TaskNotificationsApi {
  reportTaskView(input: {
    threadId?: string;
    seenSeq?: number;
    dockOpen?: boolean;
  }): void;
  onThreadTitleUpdated(
    listener: (thread: Pick<Thread, "id" | "title">) => void,
  ): () => void;
  onImTaskCreated(listener: (thread: Thread) => void): () => void;
}
