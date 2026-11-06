import {
  containsMemoryCredential,
  isTransientMemory,
} from "../broker-tool-parameters.js";

import { type OpenThreadRequest } from "../runtime-types.js";

import { isExecutionMode } from "@artemis/protocol";

import { randomUUID } from "node:crypto";

import { defineTool } from "@earendil-works/pi-coding-agent";

import { Type } from "@sinclair/typebox";

import type { BrokerToolContext } from "./broker-tool-context.js";
export function createSaveMemoryTool(
  request: OpenThreadRequest,
  context: Pick<BrokerToolContext, "threads" | "broker">,
) {
  const saveMemoryTool = defineTool({
    name: "save_memory",
    label: "Save reusable memory",
    description:
      "After a workflow has succeeded and been verified, decide whether durable experience is likely to prevent repeated work. If so, save it and choose the scope yourself: project for repository-specific experience, or global only when the workflow applies unchanged across unrelated repositories. If uncertain, choose project. Do not save transient facts, guesses, user data, or credentials.",
    parameters: Type.Object(
      {
        scope: Type.Union([Type.Literal("project"), Type.Literal("global")], {
          description:
            "Choose project for repository-specific paths, commands, architecture, conventions, or decisions. Choose global only for workflows that apply unchanged across unrelated repositories. If uncertain, choose project.",
        }),
        title: Type.String({ minLength: 1, maxLength: 120 }),
        content: Type.String({ minLength: 40, maxLength: 8_000 }),
        keywords: Type.Array(Type.String({ minLength: 2, maxLength: 64 }), {
          minItems: 2,
          maxItems: 12,
        }),
      },
      { additionalProperties: false },
    ),
    execute: async (_toolCallId, params) => {
      const hosted = context.threads.get(request.threadId);
      if (!hosted?.currentTurnId || !isExecutionMode(hosted.currentMode)) {
        throw new Error(
          "Reusable memory can be saved only during an active Work or Codemode turn.",
        );
      }
      const title = params.title.trim();
      const content = params.content.trim();
      const keywords = [...new Set(params.keywords.map((item) => item.trim()))];
      const candidate = `${title}\n${content}\n${keywords.join("\n")}`;
      if (containsMemoryCredential(candidate)) {
        throw new Error(
          "Memory cannot contain credentials, secrets, or access tokens.",
        );
      }
      if (isTransientMemory(title, content)) {
        throw new Error(
          "Transient facts are not a reusable workflow and cannot be saved.",
        );
      }
      const scope = params.scope;
      const result = await context.broker.request({
        kind: "memory.append",
        approvalId: randomUUID(),
        threadId: request.threadId,
        turnId: hosted.currentTurnId,
        workspacePath: request.workspacePath,
        scope,
        title,
        content,
        keywords,
        mode: hosted.currentMode,
      });
      if (!result.approved) {
        throw new Error(result.error ?? "Memory could not be saved.");
      }
      const appended =
        (result.data as { appended?: boolean } | undefined)?.appended !== false;
      return {
        content: [
          {
            type: "text",
            text: appended
              ? `Saved reusable ${scope} memory.`
              : "The same memory already exists.",
          },
        ],
        details: { scope, appended },
      };
    },
  });
  return saveMemoryTool;
}
