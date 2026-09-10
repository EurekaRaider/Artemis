import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { AgentPayload, TurnRecovery } from "@artemis/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArtemisAgentHost } from "../src/runtime.js";
import { reconcileInterruptedTools } from "../src/turn-recovery.js";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

const assistant: AssistantMessage = {
  role: "assistant",
  api: "openai-completions",
  provider: "test",
  model: "test",
  content: [
    {
      type: "toolCall",
      id: "done",
      name: "write",
      arguments: { path: "done.txt" },
    },
    {
      type: "toolCall",
      id: "recorded",
      name: "write",
      arguments: { path: "recorded.txt" },
    },
    {
      type: "toolCall",
      id: "unknown",
      name: "shell",
      arguments: { command: "publish" },
    },
  ],
  stopReason: "toolUse",
  timestamp: 1,
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
};
const recovery: TurnRecovery = {
  attemptId: "restart-1",
  evidence: "Recorded output and pending questions",
  toolResults: [
    { toolCallId: "recorded", output: "Already written", isError: false },
  ],
};

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "artemis-process-recovery-"));
  roots.push(root);
  const workspacePath = join(root, "workspace");
  await mkdir(workspacePath);
  const manager = SessionManager.create(workspacePath, join(root, "sessions"));
  manager.appendMessage({
    role: "user",
    content: "Finish the change",
    timestamp: 0,
  });
  manager.appendMessage(assistant);
  manager.appendMessage({
    role: "toolResult",
    toolCallId: "done",
    toolName: "write",
    content: [{ type: "text", text: "Done once" }],
    isError: false,
    timestamp: 2,
  });
  const payloads: AgentPayload[] = [];
  const broker = vi.fn(async () => {
    throw new Error("Recovery must not replay a tool");
  });
  const host = new ArtemisAgentHost(
    { request: broker },
    {
      emit(_thread, _turn, payload) {
        payloads.push(payload);
      },
    },
    { agentDir: join(root, "agent") },
  );
  await host.openThread({
    threadId: "task",
    workspacePath,
    target: "local",
    sessionFile: manager.getSessionFile()!,
  });
  const session = (
    host as unknown as { threads: Map<string, { session: AgentSession }> }
  ).threads.get("task")!.session;
  return {
    host,
    session,
    payloads,
    broker,
    sessionFile: manager.getSessionFile()!,
  };
}

describe("process restart continuation", () => {
  it("finishes through the real Pi loop after reopening a transcript, without repeating writes", async () => {
    const { host, session, broker, payloads } = await fixture();
    session.agent.state.model = {
      id: "test",
      name: "Test",
      api: "openai-completions",
      provider: "test",
      baseUrl: "http://localhost.invalid",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 8192,
    };
    const stream = vi.fn((_model, context) => {
      const results = context.messages.filter(
        (message: { role: string }) => message.role === "toolResult",
      );
      expect(results).toHaveLength(3);
      const output = createAssistantMessageEventStream();
      queueMicrotask(() =>
        output.push({
          type: "done",
          reason: "stop",
          message: {
            ...assistant,
            content: [{ type: "text", text: "Finished remaining work" }],
            stopReason: "stop",
          },
        }),
      );
      return output;
    });
    session.agent.streamFunction = stream;
    await host.prompt(
      "task",
      "original-turn",
      "Finish the change",
      "execute",
      undefined,
      undefined,
      undefined,
      undefined,
      recovery,
    );
    expect(stream).toHaveBeenCalledOnce();
    expect(broker).not.toHaveBeenCalled();
    expect(payloads.some((payload) => payload.type === "turn.failed")).toBe(
      false,
    );
    expect(payloads.some((payload) => payload.type === "turn.completed")).toBe(
      true,
    );
    expect(
      session.agent.state.messages.filter((message) => message.role === "user"),
    ).toHaveLength(1);
    host.dispose();
  });

  it("preserves completed results and durably closes dangling calls without executing them", async () => {
    const { host, session, broker, sessionFile } = await fixture();
    reconcileInterruptedTools(session, recovery);
    reconcileInterruptedTools(session, recovery);
    const results = session.agent.state.messages.filter(
      (message) => message.role === "toolResult",
    );
    expect(results).toHaveLength(3);
    expect(
      results.find((result) => result.toolCallId === "done")?.content,
    ).toEqual([{ type: "text", text: "Done once" }]);
    expect(
      results.find((result) => result.toolCallId === "recorded")?.isError,
    ).toBe(false);
    expect(
      results.find((result) => result.toolCallId === "unknown"),
    ).toMatchObject({
      isError: true,
      content: [{ type: "text", text: expect.stringContaining("UNKNOWN") }],
    });
    expect(
      SessionManager.open(sessionFile)
        .getEntries()
        .filter(
          (entry) =>
            entry.type === "message" && entry.message.role === "toolResult",
        ),
    ).toHaveLength(3);
    expect(broker).not.toHaveBeenCalled();
    host.dispose();
  });

  it.each(["execute", "plan", "review"] as const)(
    "continues the original turn through Pi in %s mode without replaying the user prompt",
    async (mode) => {
      const { host, session, broker, payloads } = await fixture();
      const prompt = vi.spyOn(session, "prompt");
      const resumed = vi
        .spyOn(session, "sendCustomMessage")
        .mockImplementation(async (message, options) => {
          expect(message.display).toBe(false);
          expect(options?.triggerTurn).toBe(true);
          expect(JSON.stringify(message.content)).toContain(
            "Continue the existing task",
          );
          if (mode !== "execute") {
            expect(
              session.agent.state.tools.map((tool) => tool.name),
            ).not.toContain("write");
            expect(
              session.agent.state.tools.map((tool) => tool.name),
            ).not.toContain("shell");
          }
          const response = {
            ...assistant,
            content: [{ type: "text", text: "Continued" }],
            stopReason: "stop",
          };
          const emitter = session as unknown as { _emit(event: unknown): void };
          emitter._emit({ type: "message_start", message: response });
          emitter._emit({ type: "message_end", message: response });
          emitter._emit({ type: "agent_settled" });
        });
      await host.prompt(
        "task",
        "original-turn",
        "Finish the change",
        mode,
        undefined,
        undefined,
        undefined,
        undefined,
        recovery,
      );
      expect(prompt).not.toHaveBeenCalled();
      expect(resumed).toHaveBeenCalledOnce();
      expect(broker).not.toHaveBeenCalled();
      expect(payloads.some((payload) => payload.type === "user.message")).toBe(
        false,
      );
      expect(
        payloads.some((payload) => payload.type === "turn.completed"),
      ).toBe(true);
      expect(
        payloads.find((payload) => payload.type === "message.part.delta"),
      ).toMatchObject({
        partId: expect.stringContaining("original-turn:recovery:restart-1"),
      });
      host.dispose();
    },
  );
});
