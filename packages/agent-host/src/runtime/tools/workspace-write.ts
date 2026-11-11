import {
  normalizedWritePaths,
  writePathAllowed,
} from "../agent-team-policy.js";

import {
  defineBrokerTool,
  modelApprovalParameter,
  modelApproval,
} from "../broker-tool-parameters.js";

import { type OpenThreadRequest } from "../runtime-types.js";

import { randomUUID } from "node:crypto";

import { Type } from "@sinclair/typebox";

import type { BrokerToolContext } from "./broker-tool-context.js";
export function createWriteToolFactory(
  request: OpenThreadRequest,
  context: Pick<BrokerToolContext, "threads" | "broker">,
) {
  const createWriteTool = (
    resolveActor: () => {
      actorAgentId?: string;
      writePaths?: string[];
    },
  ) =>
    defineBrokerTool({
      name: "write",
      label: "Write file",
      description:
        "Write a complete UTF-8 file inside the active Artemis workspace after classifying its risk and whether the user explicitly requested the exact action. In agent-approval mode, low and medium risk continue automatically; high risk continues only when explicitly requested by the user.",
      parameters: Type.Object({
        path: Type.String({
          description: "Path relative to the active workspace.",
        }),
        content: Type.String({ description: "Complete new file content." }),
        model_approval: modelApprovalParameter,
      }),
      execute: async (_toolCallId, params) => {
        const hosted = context.threads.get(request.threadId);
        if (!hosted?.currentTurnId) {
          throw new Error("No active turn is available for this write.");
        }
        const actor = resolveActor();
        const normalizedPath = normalizedWritePaths(request.workspacePath, [
          params.path,
        ])[0]!;
        if (
          actor.actorAgentId &&
          !writePathAllowed(actor.writePaths ?? [], normalizedPath)
        ) {
          throw new Error(
            `Sub-agent ${actor.actorAgentId} cannot write outside its assigned scope: ${normalizedPath}.`,
          );
        }

        const approvalId = randomUUID();
        const result = await context.broker.request({
          kind: "workspace.write",
          approvalId,
          threadId: request.threadId,
          turnId: hosted.currentTurnId,
          workspacePath: request.workspacePath,
          relativePath: params.path,
          ...(actor.actorAgentId ? { actorAgentId: actor.actorAgentId } : {}),
          content: params.content,
          modelApproval: modelApproval(params.model_approval),
          mode: hosted.currentMode ?? "plan",
        });

        if (!result.approved) {
          throw new Error(result.error ?? "The user denied this write.");
        }

        return {
          content: [{ type: "text", text: `Wrote ${params.path}` }],
          details: { path: params.path },
        };
      },
    });
  return createWriteTool;
}
