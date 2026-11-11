import {
  defineBrokerTool,
  modelApprovalParameter,
  modelApproval,
} from "../broker-tool-parameters.js";

import { type OpenThreadRequest } from "../runtime-types.js";

import { isExecutionMode } from "@artemis/protocol";

import { randomUUID } from "node:crypto";

import { Type } from "@sinclair/typebox";

import type { BrokerToolContext } from "./broker-tool-context.js";
export function createLocalFileTools(
  request: OpenThreadRequest,
  context: Pick<BrokerToolContext, "threads" | "broker">,
) {
  const localFileReadTool = defineBrokerTool({
    name: "local_file_read",
    label: "Read local file",
    description:
      "Read a UTF-8 file at an absolute path with the current desktop user's permissions in Work or Codemode mode. Use this only for an exact path outside the active workspace, and classify whether the user explicitly requested that path.",
    parameters: Type.Object(
      {
        path: Type.String({
          description: "Absolute path to the local UTF-8 file.",
        }),
        model_approval: modelApprovalParameter,
      },
      { additionalProperties: false },
    ),
    execute: async (_toolCallId, params) => {
      const hosted = context.threads.get(request.threadId);
      if (!hosted?.currentTurnId || !isExecutionMode(hosted.currentMode)) {
        throw new Error(
          "Local file access requires an active Work or Codemode turn.",
        );
      }
      const result = await context.broker.request({
        kind: "local.file.read",
        approvalId: randomUUID(),
        threadId: request.threadId,
        turnId: hosted.currentTurnId,
        workspacePath: request.workspacePath,
        path: params.path,
        modelApproval: modelApproval(params.model_approval),
        mode: hosted.currentMode,
      });
      if (!result.approved) {
        throw new Error(result.error ?? "The user denied this local read.");
      }
      const data = result.data as { content?: unknown } | undefined;
      if (typeof data?.content !== "string") {
        throw new Error("The local file read returned no text content.");
      }
      return {
        content: [{ type: "text" as const, text: data.content }],
        details: { path: params.path },
      };
    },
  });

  const localFileWriteTool = defineBrokerTool({
    name: "local_file_write",
    label: "Write local file",
    description:
      "Write a complete UTF-8 file at an absolute path with the current desktop user's permissions in Work or Codemode mode. Use this only for an exact path outside the active workspace, and classify whether the user explicitly requested that write.",
    parameters: Type.Object(
      {
        path: Type.String({
          description: "Absolute path to the local UTF-8 file.",
        }),
        content: Type.String({ description: "Complete new file content." }),
        model_approval: modelApprovalParameter,
      },
      { additionalProperties: false },
    ),
    execute: async (_toolCallId, params) => {
      const hosted = context.threads.get(request.threadId);
      if (!hosted?.currentTurnId || !isExecutionMode(hosted.currentMode)) {
        throw new Error(
          "Local file access requires an active Work or Codemode turn.",
        );
      }
      const result = await context.broker.request({
        kind: "local.file.write",
        approvalId: randomUUID(),
        threadId: request.threadId,
        turnId: hosted.currentTurnId,
        workspacePath: request.workspacePath,
        path: params.path,
        content: params.content,
        modelApproval: modelApproval(params.model_approval),
        mode: hosted.currentMode,
      });
      if (!result.approved) {
        throw new Error(result.error ?? "The user denied this local write.");
      }
      return {
        content: [{ type: "text" as const, text: `Wrote ${params.path}` }],
        details: { path: params.path },
      };
    },
  });
  return { localFileReadTool, localFileWriteTool };
}
