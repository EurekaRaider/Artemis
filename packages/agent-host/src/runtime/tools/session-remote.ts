import type { OpenThreadRequest } from "../runtime-types.js";

import { createRemoteTools } from "../../tools/remote-tools.js";
import type { RemoteOperation } from "@artemis/protocol";

import type { AgentRuntimeDependencies } from "../agent-runtime-dependencies.js";
export function createSessionRemoteTools(
  request: OpenThreadRequest,
  services: Pick<
    AgentRuntimeDependencies,
    "requireActiveThread" | "broker" | "parkedDelegationTurns" | "cancel"
  >,
) {
  const invokeRemoteOperation = async (
    operation: RemoteOperation,
    callId: string,
  ) => {
    const hosted = services.requireActiveThread(request.threadId);
    const result = await services.broker.request({
      kind: "remote.operation",
      approvalId: callId,
      threadId: request.threadId,
      turnId: hosted.currentTurnId!,
      mode: hosted.currentMode!,
      operation,
    });
    if (!result.approved)
      throw new Error(result.error ?? "Remote operation was denied.");
    if (
      result.data &&
      typeof result.data === "object" &&
      "parkPermission" in result.data &&
      result.data.parkPermission === true
    ) {
      services.parkedDelegationTurns.add(
        `${request.threadId}\0${hosted.currentTurnId}`,
      );
      hosted.adapter?.stopAfterTools();
    }
    if (
      operation.action === "collaborate" &&
      operation.command.action === "cancel" &&
      result.data &&
      typeof result.data === "object" &&
      "cancelDelegationTurn" in result.data &&
      result.data.cancelDelegationTurn === true
    ) {
      hosted.adapter?.stopAfterTools();
      void services.cancel(request.threadId).catch(() => undefined);
    }
    if (
      operation.action === "collaborate" &&
      (operation.command.action === "status" ||
        operation.command.action === "wait") &&
      result.data &&
      typeof result.data === "object" &&
      "parkDelegation" in result.data &&
      result.data.parkDelegation === true
    ) {
      // Stop this Pi loop without cancelling its durable IM dependency.
      services.parkedDelegationTurns.add(
        `${request.threadId}\0${hosted.currentTurnId}`,
      );
      hosted.adapter?.stopAfterTools();
    }
    return result.data;
  };
  const remoteTools = request.remoteExecution
    ? createRemoteTools(invokeRemoteOperation, request.remoteExecution)
    : request.groupCollaboration
      ? createRemoteTools(invokeRemoteOperation).filter(
          (tool) =>
            tool.name === "collaborate" || tool.name === "im_participants",
        )
      : [];
  return { invokeRemoteOperation, remoteTools };
}
