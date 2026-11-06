import { type Thread } from "@artemis/protocol";

export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export const busy = (thread: Thread) =>
  thread.status === "running" || thread.status === "waiting-approval";
