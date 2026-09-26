import { randomUUID } from "node:crypto";
import { validateToolArguments, type ToolCall } from "@earendil-works/pi-ai";
import type {
  AgentSession,
  ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import type {
  HookEvent,
  HookInvocation,
  HookResult,
  RunMode,
} from "@artemis/protocol";
import type { AgentBroker } from "./runtime.js";

interface HookBridgeOptions {
  broker: AgentBroker;
  threadId: string;
  cwd: string;
  remote: boolean;
  enabled(): boolean;
  mode(): RunMode;
  turnId(): string | undefined;
  canContinue(): boolean;
  actorId?: string;
  resumed?: boolean;
}
/** Only this built-in bridge is loaded; user executable Pi extensions stay disabled. */
export function createHooksBridge(options: HookBridgeOptions) {
  let started = false;
  const pendingShell = new Map<
    string,
    { toolName: string; toolCallId: string; input: Record<string, unknown> }
  >();
  let startSource = options.resumed ? "resume" : "startup";
  let continuationTurn: string | undefined;
  const run = async (
    event: HookEvent,
    fields: Partial<HookInvocation> = {},
  ): Promise<HookResult> => {
    if (!options.enabled() || options.remote || options.mode() !== "execute")
      return {};
    const turnId = options.turnId();
    const invocation: HookInvocation = {
      version: 1,
      hook_event_name: event,
      session_id: options.threadId,
      ...(turnId ? { turn_id: turnId } : {}),
      cwd: options.cwd,
      permission_mode: options.mode(),
      transcript_path: null,
      ...(options.actorId
        ? { agent_id: options.actorId, agent_type: "subagent" }
        : {}),
      ...fields,
    };
    const result = await options.broker.request({
      kind: "hook.run",
      approvalId: randomUUID(),
      threadId: options.threadId,
      turnId: turnId ?? "",
      mode: options.mode(),
      workspacePath: options.cwd,
      invocation,
    });
    if (!result.approved)
      return {
        blocked: true,
        stop: true,
        reason: result.error ?? "Hook invocation denied",
      };
    return (result.data ?? {}) as HookResult;
  };
  const factory: ExtensionFactory = (pi) => {
    pi.on("before_agent_start", async () => {
      if (
        !options.enabled() ||
        options.remote ||
        options.mode() !== "execute" ||
        started
      )
        return;
      started = true;
      const result = await run(
        options.actorId ? "SubagentStart" : "SessionStart",
        { source: startSource },
      );
      return result.context
        ? {
            message: {
              customType: "artemis-hook-context",
              content: result.context,
              display: false,
            },
          }
        : undefined;
    });
    pi.on("input", async (event) => {
      // Hook continuation is queued directly in Pi and is not another user submission.
      const result = await run("UserPromptSubmit", { prompt: event.text });
      if (result.blocked) return { action: "handled" };
      if (result.context)
        pi.sendMessage(
          {
            customType: "artemis-hook-context",
            content: result.context,
            display: false,
          },
          { deliverAs: "nextTurn" },
        );
      return { action: "continue" };
    });
    pi.on("tool_call", async (event) => {
      if (["shell_wait", "shell_cancel"].includes(event.toolName)) return;
      try {
        const result = await run("PreToolUse", {
          tool_name: event.toolName,
          tool_use_id: event.toolCallId,
          tool_input: event.input,
        });
        if (result.blocked)
          return {
            block: true,
            reason: result.reason ?? "Blocked by hook",
            terminate: result.stop === true,
          };
        if (result.updatedInput) {
          const tool = pi.getAllTools().find((t) => t.name === event.toolName);
          if (!tool)
            return { block: true, reason: "Hook tool is no longer available" };
          if ("model_approval" in event.input)
            result.updatedInput.model_approval = {
              risk: "high",
              explicit_user_request: false,
              reason:
                "Hook changed the operation; assess the rewritten arguments before execution.",
            };
          validateToolArguments(tool, {
            type: "toolCall",
            id: event.toolCallId,
            name: event.toolName,
            arguments: result.updatedInput as ToolCall["arguments"],
          });
          for (const key of Object.keys(event.input))
            delete (event.input as Record<string, unknown>)[key];
          Object.assign(event.input, result.updatedInput);
        }
        if (result.context)
          pi.sendMessage(
            {
              customType: "artemis-hook-context",
              content: result.context,
              display: false,
            },
            { deliverAs: "nextTurn" },
          );
      } catch (error) {
        return { block: true, reason: String(error), terminate: true };
      }
    });
    pi.on("tool_result", async (event) => {
      let toolName = event.toolName,
        toolCallId = event.toolCallId,
        input = event.input;
      if (["shell", "shell_wait", "shell_cancel"].includes(toolName)) {
        const snapshot = event.details as
          { executionId?: string; status?: string } | undefined;
        if (
          snapshot?.executionId &&
          (snapshot.status === "running" || snapshot.status === "cancelling")
        ) {
          if (toolName === "shell")
            pendingShell.set(snapshot.executionId, {
              toolName,
              toolCallId,
              input: input as Record<string, unknown>,
            });
          return;
        }
        if (toolName !== "shell") {
          const original = snapshot?.executionId
            ? pendingShell.get(snapshot.executionId)
            : undefined;
          if (!original) return;
          ({ toolName, toolCallId, input } = original);
          pendingShell.delete(snapshot!.executionId!);
        }
      }
      const result = await run("PostToolUse", {
        tool_name: toolName,
        tool_use_id: toolCallId,
        tool_input: input,
        tool_response: { content: event.content, isError: event.isError },
      });
      if (result.feedback)
        return {
          content: [{ type: "text", text: result.feedback }],
          isError: true,
        };
      if (result.context)
        return {
          content: [...event.content, { type: "text", text: result.context }],
        };
      return;
    });
    pi.on("session_before_compact", async (event) => {
      try {
        const result = await run("PreCompact", {
          trigger: event.reason === "manual" ? "manual" : "auto",
        });
        return result.blocked || event.signal.aborted
          ? { cancel: true }
          : undefined;
      } catch {
        return { cancel: true };
      }
    });
    pi.on("session_compact", async (event, context) => {
      const result = await run("PostCompact", {
        trigger: event.reason === "manual" ? "manual" : "auto",
      });
      if (result.blocked || result.stop) void context.abort();
      started = false;
      startSource = "compact";
    });
  };
  const installFinish = (session: AgentSession) => {
    const previous = session.agent.finishTurn;
    session.agent.finishTurn = async (context, signal) => {
      const decision = (await previous?.(context, signal)) ?? undefined;
      if (
        decision?.action === "end" ||
        signal?.aborted ||
        !options.canContinue() ||
        options.mode() !== "execute" ||
        options.remote ||
        context.message.stopReason !== "stop" ||
        context.toolResults.length ||
        session.pendingMessageCount
      )
        return decision;
      const turn = options.turnId();
      const active = continuationTurn === turn && turn !== undefined;
      const text = context.message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
      const result = await run(options.actorId ? "SubagentStop" : "Stop", {
        stop_hook_active: active,
        last_assistant_message: text,
      });
      if (signal?.aborted || !options.canContinue() || result.stop)
        return { action: "end" };
      if (result.continuation && !active) {
        continuationTurn = turn;
        session.agent.followUp({
          role: "user",
          content: [{ type: "text", text: result.continuation }],
          timestamp: Date.now(),
        });
        return { action: "continue" };
      }
      return decision;
    };
  };
  return { factory, installFinish };
}
