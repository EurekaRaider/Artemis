import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  ModelRuntime,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type {
  AgentPayload,
  HookResult,
  BrokerExecutionRequest,
} from "@artemis/protocol";
import { ArtemisAgentHost } from "../src/runtime.js";
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function fixture(result: HookResult = {}, remote = false) {
  const root = await mkdtemp(join(tmpdir(), "artemis-hook-bridge-"));
  const calls: BrokerExecutionRequest[] = [];
  const payloads: AgentPayload[] = [];
  const host = new ArtemisAgentHost(
    {
      async request(request) {
        calls.push(request);
        return { approved: true, data: result };
      },
    },
    {
      emit(_threadId, _turnId, payload) {
        payloads.push(payload);
      },
    },
    { agentDir: join(root, "agent") },
  );
  await host.configure({ credentials: {}, hooksEnabled: true });
  await host.openThread({
    threadId: "test",
    workspacePath: root,
    target: "local",
    ...(remote ? { remoteExecution: { network: false, shell: false } } : {}),
  });
  const thread = (
    host as unknown as {
      threads: Map<
        string,
        {
          currentMode: "plan" | "review" | "execute";
          currentTurnId: string | undefined;
          session: AgentSession;
        }
      >;
    }
  ).threads.get("test")!;
  thread.currentTurnId = "turn";
  thread.currentMode = "execute";
  cleanups.push(async () => {
    host.dispose();
    await rm(root, { recursive: true, force: true });
  });
  return {
    calls,
    payloads,
    host,
    thread,
    runner: thread.session.extensionRunner,
  };
}
it("loads the built-in hook bridge while disabling user extension discovery", async () => {
  const f = await fixture({ blocked: true, reason: "denied" });
  expect(f.runner.hasHandlers("tool_call")).toBe(true);
  const result = await f.runner.emitToolCall({
    type: "tool_call",
    toolName: "write",
    toolCallId: "call",
    input: { path: "x", content: "text" },
  });
  expect(result).toMatchObject({ block: true, reason: "denied" });
  expect(f.calls[0]).toMatchObject({
    kind: "hook.run",
    invocation: { hook_event_name: "PreToolUse", tool_use_id: "call" },
  });
});
it.each(["plan", "review"] as const)(
  "does not dispatch hook commands in %s",
  async (mode) => {
    const f = await fixture();
    f.thread.currentMode = mode;
    await f.runner.emitToolCall({
      type: "tool_call",
      toolName: "write",
      toolCallId: "call",
      input: {},
    });
    await f.runner.emitInput("test", undefined, "interactive");
    expect(f.calls).toEqual([]);
  },
);
it("blocks schema-invalid rewritten input before tool execution", async () => {
  const f = await fixture({ updatedInput: { path: 42 } });
  expect(
    await f.runner.emitToolCall({
      type: "tool_call",
      toolName: "write",
      toolCallId: "call",
      input: { path: "x", content: "text" },
    }),
  ).toMatchObject({ block: true });
});
it("does not submit a prompt rejected by its hook", async () => {
  const f = await fixture({ blocked: true });
  expect(
    await f.runner.emitInput("sensitive prompt", undefined, "interactive"),
  ).toMatchObject({ action: "handled" });
});
it("emits PostToolUse for a long command only after the original execution finishes", async () => {
  const f = await fixture();
  await f.runner.emitToolResult({
    type: "tool_result",
    toolName: "shell",
    toolCallId: "start",
    input: { command: "long" },
    content: [],
    isError: false,
    details: { executionId: "exec", status: "running" },
  });
  await f.runner.emitToolResult({
    type: "tool_result",
    toolName: "shell_wait",
    toolCallId: "poll",
    input: { execution_id: "exec" },
    content: [],
    isError: false,
    details: { executionId: "exec", status: "running" },
  });
  expect(f.calls).toHaveLength(0);
  await f.runner.emitToolResult({
    type: "tool_result",
    toolName: "shell_wait",
    toolCallId: "finish",
    input: { execution_id: "exec" },
    content: [{ type: "text", text: "done" }],
    isError: false,
    details: { executionId: "exec", status: "completed" },
  });
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0]).toMatchObject({
    invocation: {
      hook_event_name: "PostToolUse",
      tool_name: "shell",
      tool_use_id: "start",
      tool_input: { command: "long" },
    },
  });
});
it("bounds Stop continuation to one per turn", async () => {
  const f = await fixture({ continuation: "check again" });
  const context = {
    message: {
      role: "assistant",
      stopReason: "stop",
      content: [{ type: "text", text: "done" }],
    },
    toolResults: [],
    context: {},
    newMessages: [],
  } as unknown as Parameters<
    NonNullable<AgentSession["agent"]["finishTurn"]>
  >[0];
  expect(await f.thread.session.agent.finishTurn!(context)).toEqual({
    action: "continue",
  });
  f.thread.session.agent.clearAllQueues();
  expect(await f.thread.session.agent.finishTurn!(context)).not.toEqual({
    action: "continue",
  });
  expect(f.calls.filter((c) => c.kind === "hook.run").at(-1)).toMatchObject({
    invocation: { stop_hook_active: true },
  });
});

it("runs the same hook events for IM chats", async () => {
  const f = await fixture({}, true);
  expect(
    await f.runner.emitInput("hello", undefined, "interactive"),
  ).toMatchObject({ action: "continue" });
  await f.runner.emitBeforeAgentStart("hello", undefined, {
    selectedTools: [],
  } as never);
  expect(
    f.calls.map(
      (call) => call.kind === "hook.run" && call.invocation.hook_event_name,
    ),
  ).toEqual(["UserPromptSubmit", "SessionStart"]);
});
it("ends a hook-blocked prompt with a visible failure instead of a phantom active turn", async () => {
  const f = await fixture({
    blocked: true,
    reason: "Hooks require a local Execute task",
  });
  await f.host.prompt("test", "blocked-turn", "hello", "execute");
  expect(f.payloads).toContainEqual({
    type: "turn.failed",
    code: "HOOK_PROMPT_BLOCKED",
    message: "Hooks require a local Execute task",
  });
  expect(f.thread.currentTurnId).toBeUndefined();
});

it.each(
  (["execute", "plan", "review"] as const).flatMap((mode) =>
    [false, true].map((remote) => ({ mode, remote })),
  ),
)(
  "answers follow-ups and stops the model in $mode (remote profile: $remote)",
  async ({ mode, remote }) => {
    const f = await fixture({}, remote);
    await f.host.configure({
      hooksEnabled: true,
      credentials: { openai: { type: "api_key", key: "test-only" } },
      selection: {
        providerId: "openai",
        modelId: "gpt-4.1",
        thinkingLevel: "off",
      },
    });
    // The fixture set an active turn only to exercise hooks directly above.
    f.thread.currentTurnId = undefined;
    await f.host.setThreadModel("test", {
      providerId: "openai",
      modelId: "gpt-4.1",
      thinkingLevel: "off",
    });
    let hold = false;
    let modelStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      modelStarted = resolve;
    });
    const stream = vi
      .spyOn(ModelRuntime.prototype, "streamSimple")
      .mockImplementation((model, _context, options) => {
        const output = createAssistantMessageEventStream();
        const message = {
          role: "assistant" as const,
          content: [{ type: "text" as const, text: "Hello" }],
          api: model.api,
          provider: model.provider,
          model: model.id,
          stopReason: "stop" as const,
          timestamp: Date.now(),
          usage: {
            input: 1,
            output: 1,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 2,
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0,
            },
          },
        };
        if (hold) {
          options?.signal?.addEventListener(
            "abort",
            () =>
              output.push({
                type: "error",
                reason: "aborted",
                error: { ...message, stopReason: "aborted" },
              }),
            { once: true },
          );
          modelStarted();
        } else
          queueMicrotask(() =>
            output.push({ type: "done", reason: "stop", message }),
          );
        return output;
      });
    for (const turnId of ["first", "follow-up"]) {
      await f.host.prompt("test", turnId, "hello", mode);
      expect(f.payloads.at(-1)?.type).not.toBe("turn.failed");
    }
    expect(f.payloads.filter((p) => p.type === "turn.completed")).toHaveLength(
      2,
    );
    hold = true;
    const prompt = f.host.prompt("test", "cancel-me", "hello again", mode);
    await started;
    await f.host.cancel("test");
    await prompt;
    // The desktop emits turn.completed/cancelled after this acknowledgement.
    expect(f.payloads.filter((p) => p.type === "turn.failed")).toEqual([]);
    expect(f.thread.currentTurnId).toBeUndefined();
    expect(stream).toHaveBeenCalledTimes(3);
    if (mode === "execute") expect(f.calls.length).toBeGreaterThan(0);
    else expect(f.calls).toEqual([]);
  },
);
