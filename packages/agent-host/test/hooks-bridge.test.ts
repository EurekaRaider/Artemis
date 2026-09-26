import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { HookResult, BrokerExecutionRequest } from "@artemis/protocol";
import { ArtemisAgentHost } from "../src/runtime.js";
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function fixture(result: HookResult = {}) {
  const root = await mkdtemp(join(tmpdir(), "artemis-hook-bridge-"));
  const calls: BrokerExecutionRequest[] = [];
  const host = new ArtemisAgentHost(
    {
      async request(request) {
        calls.push(request);
        return { approved: true, data: result };
      },
    },
    { emit() {} },
    { agentDir: join(root, "agent") },
  );
  await host.configure({ credentials: {}, hooksEnabled: true });
  await host.openThread({
    threadId: "test",
    workspacePath: root,
    target: "local",
  });
  const thread = (
    host as unknown as {
      threads: Map<
        string,
        {
          currentMode: "plan" | "review" | "execute";
          currentTurnId: string;
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
  return { calls, host, thread, runner: thread.session.extensionRunner };
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
