import type { OpenThreadRequest, HostedThread } from "../runtime-types.js";

import { createAttachmentTools } from "../../tools/attachment-tools.js";
import {
  inputTokenLimit,
  estimateRequestTokens,
  attachmentImageTokens,
} from "../../context/attachment-context.js";
import type { AttachmentOperation } from "@artemis/protocol";

import { randomUUID } from "node:crypto";

import type { AgentRuntimeDependencies } from "../agent-runtime-dependencies.js";
export function createSessionAttachmentTools(
  request: OpenThreadRequest,
  services: Pick<AgentRuntimeDependencies, "requireActiveThread" | "broker">,
) {
  const invokeAttachmentOperation = async (
    operation: AttachmentOperation,
    session?: HostedThread["session"],
  ) => {
    const hosted = services.requireActiveThread(request.threadId);
    const targetSession = session ?? hosted.session;
    const model = targetSession.model;
    const remaining = model
      ? inputTokenLimit(model) -
        estimateRequestTokens(model, {
          systemPrompt: targetSession.systemPrompt,
          messages: targetSession.messages,
          tools: targetSession.agent.state.tools,
        })
      : 0;
    const result = await services.broker.request({
      kind: "attachment.read",
      approvalId: randomUUID(),
      threadId: request.threadId,
      turnId: hosted.currentTurnId!,
      mode: hosted.currentMode!,
      operation: {
        ...operation,
        ...(operation.currentMessage
          ? { ids: hosted.currentAttachmentIds ?? [] }
          : {}),
        maxTokens: Math.min(
          operation.maxTokens ?? 4000,
          4000,
          Math.max(0, remaining - 256),
        ),
      },
    });
    if (!result.approved)
      throw new Error(result.error ?? "Attachment read denied");
    const image = result.data as {
      data?: string;
      width?: number;
      height?: number;
    };
    if (typeof image?.data === "string" && model) {
      if (!model.input.includes("image"))
        throw new Error(
          "The selected model cannot view images. Select a vision model.",
        );
      if (attachmentImageTokens(model, image.width, image.height) > remaining)
        throw new Error(
          "Compact the task before viewing another attachment image.",
        );
    }
    return result.data;
  };
  const attachmentTools = createAttachmentTools(invokeAttachmentOperation);
  return { invokeAttachmentOperation, attachmentTools };
}
