import { randomUUID } from "node:crypto";
import type { BrokerExecutionRequest } from "@artemis/protocol";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  "rejectBrokerRequest" | "store" | "pluginDispatch" | "agentProcess"
>;
export function createPluginBroker(services: Dependencies) {
  const { rejectBrokerRequest } = services;
  async function handlePluginToolBrokerRequest(
    workerRequestId: string,
    request: Extract<BrokerExecutionRequest, { kind: "plugin.tool" }>,
  ): Promise<void> {
    if (!services.store || !services.pluginDispatch) {
      rejectBrokerRequest(
        workerRequestId,
        request,
        "Design-plugin dispatch is not available.",
      );
      return;
    }
    const outcome = await services.pluginDispatch.dispatch({
      threadId: request.threadId,
      toolName: request.toolName,
      args: request.args,
      mode: request.mode,
    });
    if (outcome.status === "refused") {
      rejectBrokerRequest(workerRequestId, request, outcome.error ?? "refused");
      return;
    }
    if (outcome.status === "failed") {
      rejectBrokerRequest(
        workerRequestId,
        request,
        outcome.error ?? "plugin tool failed",
      );
      return;
    }
    services.agentProcess?.post({
      type: "broker.resolve",
      requestId: workerRequestId,
      resolution: {
        approvalId: request.approvalId,
        nonce: randomUUID(),
        approved: true,
        scope: "once",
        source: "policy",
      },
      result: outcome.result ?? {},
    });
  }
  return { handlePluginToolBrokerRequest };
}
