import { parentPort, workerData } from "node:worker_threads";
import { ThreadHistoryReader } from "./thread-history-reader.js";
import type { ThreadHistoryCursor } from "../shared/thread-history.js";

const reader = new ThreadHistoryReader(workerData.databasePath);
parentPort!.on(
  "message",
  ({
    id,
    threadId,
    cursor,
    deleteThreadId,
  }: {
    deleteThreadId?: string;
    id: number;
    threadId: string;
    cursor?: ThreadHistoryCursor;
  }) => {
    if (deleteThreadId) {
      reader.discard(deleteThreadId);
      return;
    }
    try {
      parentPort!.postMessage({ id, page: reader.read(threadId, cursor) });
    } catch (error) {
      parentPort!.postMessage({
        id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
);
