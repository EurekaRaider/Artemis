import {
  defineBrokerTool,
  modelApprovalParameter,
  sandboxEscalationParameter,
  modelApproval,
} from "../broker-tool-parameters.js";

import type { OpenThreadRequest } from "../runtime-types.js";

import { randomUUID } from "node:crypto";

import { Type } from "@sinclair/typebox";
import type { TSchema } from "@sinclair/typebox";

import type { AgentRuntimeDependencies } from "../agent-runtime-dependencies.js";
export function createSessionExtensionTools(
  request: OpenThreadRequest,
  services: Pick<
    AgentRuntimeDependencies,
    "threads" | "broker" | "configuration"
  >,
) {
  const extensionTools = (services.configuration.extensionTools ?? []).map(
    (tool) =>
      defineBrokerTool({
        name: tool.piName,
        label: `${tool.extensionName}: ${tool.label}`,
        ...(tool.outputSchema
          ? { outputSchema: tool.outputSchema as TSchema }
          : {}),
        ...(tool.namespace ? { namespace: tool.namespace } : {}),
        ...(tool.annotations ? { annotations: tool.annotations } : {}),
        description: `${tool.description} Provide the extension arguments plus a risk assessment for this exact call.`,
        parameters: Type.Object(
          {
            arguments: tool.inputSchema as TSchema,
            model_approval: modelApprovalParameter,
            sandbox_escalation: sandboxEscalationParameter,
          },
          { additionalProperties: false },
        ),
        execute: async (_toolCallId, parameters) => {
          const hosted = services.threads.get(request.threadId);
          if (!hosted?.currentTurnId) {
            throw new Error(
              "No active turn is available for this extension call.",
            );
          }
          const result = await services.broker.request({
            kind: "extension.call",
            approvalId: randomUUID(),
            threadId: request.threadId,
            turnId: hosted.currentTurnId,
            workspacePath: request.workspacePath,
            extensionId: tool.extensionId,
            extensionName: tool.extensionName,
            toolName: tool.toolName,
            arguments: parameters.arguments as Record<string, unknown>,
            ...(parameters.sandbox_escalation
              ? { sandboxEscalation: parameters.sandbox_escalation }
              : {}),
            modelApproval: modelApproval(parameters.model_approval),
            mode: hosted.currentMode ?? "plan",
          });
          if (!result.approved) {
            throw new Error(
              result.error ?? "The user denied this extension call.",
            );
          }
          const data = result.data as
            | {
                output?: string;
                isError?: boolean;
                structuredContent?: import("@earendil-works/pi-ai").JsonValue;
              }
            | undefined;
          if (data?.isError) {
            throw new Error(data.output ?? "Extension tool returned an error.");
          }
          return {
            content: [{ type: "text", text: data?.output ?? "" }],
            ...(data?.structuredContent === undefined
              ? {}
              : { structuredContent: data.structuredContent }),
            details: {
              extensionId: tool.extensionId,
              toolName: tool.toolName,
            },
          };
        },
      }),
  );
  return { extensionTools };
}
