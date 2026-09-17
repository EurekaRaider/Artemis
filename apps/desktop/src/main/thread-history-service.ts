import { Worker } from "node:worker_threads";
import type {
  ThreadHistoryCursor,
  ThreadHistoryPage,
} from "../shared/thread-history.js";

export class ThreadHistoryService {
  private worker: Worker | undefined;
  private nextId = 0;
  private readonly pending = new Map<
    number,
    {
      resolve: (page: ThreadHistoryPage) => void;
      reject: (error: Error) => void;
    }
  >();
  constructor(private readonly databasePath: string) {}
  private start(): Worker {
    if (!this.worker) {
      const worker = new Worker(
        new URL("./thread-history-worker.js", import.meta.url),
        { workerData: { databasePath: this.databasePath } },
      );
      this.worker = worker;
      worker.on(
        "message",
        (message: { id: number; page: ThreadHistoryPage; error?: string }) => {
          const pending = this.pending.get(message.id);
          this.pending.delete(message.id);
          if (message.error) pending?.reject(new Error(message.error));
          else pending?.resolve(message.page);
        },
      );
      worker.on("error", (error) =>
        this.fail(error instanceof Error ? error : new Error(String(error))),
      );
      worker.on("exit", () => {
        if (this.worker === worker) {
          this.worker = undefined;
          this.fail(new Error("History worker stopped."));
        }
      });
    }
    return this.worker;
  }
  discard(threadId: string): void {
    this.start().postMessage({ deleteThreadId: threadId });
  }
  read(
    threadId: string,
    cursor?: ThreadHistoryCursor,
  ): Promise<ThreadHistoryPage> {
    const worker = this.start();
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ id, threadId, cursor });
    });
  }
  private fail(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
  close(): void {
    void this.worker?.terminate();
    this.fail(new Error("History service closed."));
  }
}
