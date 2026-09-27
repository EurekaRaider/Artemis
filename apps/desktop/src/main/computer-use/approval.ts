import type { BrokerExecutionRequest, Thread } from "@artemis/protocol";
import type { McpServerConfig } from "../../shared/api.js";
import { modelMayAutoApprove } from "../approval-mode.js";
import type { ComputerUseHost } from "./host.js";

// The grant is created by a native host dialog, never by a tool argument.
export async function resolveComputerTaskApproval(
  request: Extract<BrokerExecutionRequest, { kind: "mcp.call" }>,
  current: {
    serverId: string | undefined;
    config: McpServerConfig | undefined;
    thread: Thread | undefined;
    activeTurnId: string | undefined;
    isTrustedServer(config: McpServerConfig): Promise<boolean>;
    host: Pick<ComputerUseHost, "taskApproval"> | undefined;
  },
): Promise<string | undefined> {
  if (
    !current.host ||
    request.toolName !== "computer_act" ||
    request.serverId !== current.serverId ||
    current.config?.id !== current.serverId ||
    !current.config?.enabled ||
    request.actorAgentId ||
    request.mode !== "execute" ||
    current.thread?.id !== request.threadId ||
    current.thread.archived ||
    current.thread.mode !== "execute" ||
    current.activeTurnId !== request.turnId ||
    !modelMayAutoApprove({
      kind: "mcp.call",
      readOnly: false,
      destructive: true,
      network: true,
      fullAccess: false,
      modelApproval: request.modelApproval,
    }) ||
    !(await current.isTrustedServer(current.config))
  )
    return;
  return current.host.taskApproval(request.toolName, request.arguments, {
    threadId: request.threadId,
    turnId: request.turnId,
    mode: request.mode,
  });
}
