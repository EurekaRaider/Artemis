import {
  defineBrokerTool,
  modelApprovalParameter,
  modelApproval,
  observedBashToolResult,
} from "../broker-tool-parameters.js";

import type { OpenThreadRequest } from "../runtime-types.js";

import { randomUUID } from "node:crypto";

import { Type } from "@sinclair/typebox";

import { type RunMode } from "@artemis/protocol";

import type { AgentRuntimeDependencies } from "../agent-runtime-dependencies.js";
export function createObservedShellTools(
  request: OpenThreadRequest,
  services: Pick<
    AgentRuntimeDependencies,
    "shellRuntime" | "broker" | "bashExecutions"
  >,
) {
  const createObservedBashTools = (
    resolveScope: () => {
      turnId: string;
      ownerId: string;
      mode: RunMode;
    },
  ) => {
    const bashTool = defineBrokerTool({
      name: "shell",
      label: "Run shell command",
      description: `Run a ${services.shellRuntime.toolDescription()} command with the current desktop user's permissions after classifying its risk and whether the user explicitly requested the exact action. Use this shell's native syntax; on Windows this is PowerShell, not Bash. Choose deadline_seconds based on the task type. The deadline is only an observation window: when it expires, the process keeps running and this tool returns an execution_id so you can decide whether to call shell_wait or shell_cancel.`,
      parameters: Type.Object(
        {
          command: Type.String({ minLength: 1 }),
          deadline_seconds: Type.Number({
            minimum: 1,
            maximum: 300,
            description:
              "Model-selected observation window in seconds. Use short windows for probes and longer windows for builds or tests; expiry never kills the process.",
          }),
          model_approval: modelApprovalParameter,
        },
        { additionalProperties: false },
      ),
      execute: async (_toolCallId, params, _signal, onUpdate) => {
        const scope = resolveScope();
        const approval = await services.broker.request({
          kind: "shell.execute",
          approvalId: randomUUID(),
          threadId: request.threadId,
          turnId: scope.turnId,
          workspacePath: request.workspacePath,
          command: params.command,
          ...(scope.ownerId === "parent"
            ? {}
            : { actorAgentId: scope.ownerId }),
          modelApproval: modelApproval(params.model_approval),
          mode: scope.mode,
        });
        if (!approval.approved) {
          throw new Error(approval.error ?? "The user denied this command.");
        }
        return observedBashToolResult(
          await services.bashExecutions.start({
            threadId: request.threadId,
            turnId: scope.turnId,
            ownerId: scope.ownerId,
            command: params.command,
            cwd: request.workspacePath,
            observationMilliseconds: params.deadline_seconds * 1_000,
            onActivity: (snapshot) =>
              onUpdate?.({
                content: [{ type: "text", text: snapshot.outputDelta }],
                details: snapshot,
              }),
          }),
        );
      },
    });
    const bashWaitTool = defineBrokerTool({
      name: "shell_wait",
      label: "Wait for shell command",
      description:
        "Observe a still-running shell execution for another model-selected window. If the window expires, inspect status, last activity, and health, then decide whether to wait again or cancel and use another approach.",
      parameters: Type.Object(
        {
          execution_id: Type.String({ minLength: 1 }),
          deadline_seconds: Type.Number({ minimum: 1, maximum: 300 }),
        },
        { additionalProperties: false },
      ),
      execute: async (_toolCallId, params) => {
        const scope = resolveScope();
        return observedBashToolResult(
          await services.bashExecutions.wait({
            threadId: request.threadId,
            turnId: scope.turnId,
            ownerId: scope.ownerId,
            executionId: params.execution_id,
            observationMilliseconds: params.deadline_seconds * 1_000,
          }),
        );
      },
    });
    const bashCancelTool = defineBrokerTool({
      name: "shell_cancel",
      label: "Stop shell command",
      description:
        "Stop a shell execution after deciding it is stuck, no longer useful, or should be replaced by another approach.",
      parameters: Type.Object(
        { execution_id: Type.String({ minLength: 1 }) },
        { additionalProperties: false },
      ),
      execute: async (_toolCallId, params) => {
        const scope = resolveScope();
        return observedBashToolResult(
          await services.bashExecutions.cancel({
            threadId: request.threadId,
            turnId: scope.turnId,
            ownerId: scope.ownerId,
            executionId: params.execution_id,
          }),
        );
      },
    });
    return { bashTool, bashWaitTool, bashCancelTool };
  };
  return { createObservedBashTools };
}
