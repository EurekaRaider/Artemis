import { parentPort } from "node:worker_threads";
import { renderShareHtml } from "./conversation-share-export.js";

parentPort!.on(
  "message",
  async ({ id, jsonl }: { id: string; jsonl: string }) => {
    try {
      parentPort!.postMessage({ id, html: await renderShareHtml(jsonl) });
    } catch (error) {
      parentPort!.postMessage({
        id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
);
