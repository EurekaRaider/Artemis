import { isExecutionMode } from "@artemis/protocol";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { app } from "electron";
import type { BrokerExecutionRequest } from "@artemis/protocol";
import {
  GLOBAL_MEMORY_MAX_BYTES,
  PROJECT_MEMORY_MAX_BYTES,
} from "../memory/memory-store.js";
import {
  conversationMemoryScopeAllowed,
  conversationWorkspaceMatches,
} from "../conversation/temporary-conversation.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  | "agentProcess"
  | "store"
  | "rejectBrokerRequest"
  | "activeTurns"
  | "resolveThreadWorkspace"
  | "memoryStore"
>;
export function createMemoryBroker(services: Dependencies) {
  const {
    rejectBrokerRequest,
    activeTurns,
    resolveThreadWorkspace,
    memoryStore,
  } = services;
  async function handleMemoryAppendBrokerRequest(
    workerRequestId: string,
    request: Extract<BrokerExecutionRequest, { kind: "memory.append" }>,
  ): Promise<void> {
    if (!services.agentProcess || !services.store) return;
    if (
      !isExecutionMode(request.mode) ||
      activeTurns.get(request.threadId) !== request.turnId
    ) {
      rejectBrokerRequest(
        workerRequestId,
        request,
        "Reusable memory can be saved only by the active Work or Codemode turn.",
      );
      return;
    }
    const thread = services.store.getThread(request.threadId);
    if (!thread) {
      rejectBrokerRequest(workerRequestId, request, "Task project not found.");
      return;
    }
    if (!isExecutionMode(thread.mode) || thread.mode !== request.mode) {
      rejectBrokerRequest(
        workerRequestId,
        request,
        "The active task mode does not allow Memory writes.",
      );
      return;
    }
    let context: Awaited<ReturnType<typeof resolveThreadWorkspace>>;
    try {
      context = await resolveThreadWorkspace(thread);
    } catch (error) {
      rejectBrokerRequest(
        workerRequestId,
        request,
        error instanceof Error ? error.message : String(error),
      );
      return;
    }
    if (
      !conversationWorkspaceMatches(
        context.workspacePath,
        request.workspacePath,
      )
    ) {
      rejectBrokerRequest(
        workerRequestId,
        request,
        "Memory request workspace does not match the task project.",
      );
      return;
    }

    if (!conversationMemoryScopeAllowed(thread, request.scope)) {
      rejectBrokerRequest(
        workerRequestId,
        request,
        "Temporary conversations cannot write project memory.",
      );
      return;
    }

    const projectMemoryPath = join(
      context.project.path,
      ".artemis",
      "MEMORY.md",
    );
    const globalMemoryPath = join(
      app.getPath("home"),
      ".pi",
      "agent",
      "MEMORY.md",
    );
    const target =
      request.scope === "global"
        ? memoryStore(globalMemoryPath, GLOBAL_MEMORY_MAX_BYTES)
        : memoryStore(projectMemoryPath, PROJECT_MEMORY_MAX_BYTES);
    try {
      const result = await target.append({
        title: request.title,
        content: request.content,
        keywords: request.keywords,
      });
      services.agentProcess.post({
        type: "broker.resolve",
        requestId: workerRequestId,
        resolution: {
          approvalId: request.approvalId,
          nonce: randomUUID(),
          approved: true,
          scope: "once",
        },
        result,
      });
    } catch (error) {
      rejectBrokerRequest(
        workerRequestId,
        request,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  return { handleMemoryAppendBrokerRequest };
}
