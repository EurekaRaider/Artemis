import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createAssistantMessageEventStream,
  type Api,
  type Model,
} from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  withConnectionRecovery,
  type ConnectionRecoveryUpdate,
} from "../src/connection-recovery.js";

import type { AgentPayload } from "@artemis/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ArtemisAgentHost } from "../src/runtime.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    cleanupPaths
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function createHost(modelStreamIdleTimeoutMs: number) {
  const root = await mkdtemp(join(tmpdir(), "artemis-model-stream-idle-"));
  cleanupPaths.push(root);
  const workspacePath = join(root, "workspace");
  const agentDir = join(root, "agent");
  await mkdir(workspacePath);

  const payloads: AgentPayload[] = [];
  const host = new ArtemisAgentHost(
    {
      async request() {
        throw new Error("The idle timeout test must not broker tools.");
      },
    },
    {
      emit(_threadId, _turnId, payload) {
        payloads.push(payload);
      },
    },
    { agentDir, modelStreamIdleTimeoutMs },
  );
  await host.openThread({
    threadId: "thread-idle-timeout",
    workspacePath,
    target: "local",
  });
  const thread = (
    host as unknown as {
      threads: Map<
        string,
        {
          currentTurnId: string | undefined;
          session: {
            sessionId: string;
            prompt(text: string): Promise<void>;
            abort(): Promise<void>;
            _emit(event: unknown): void;
          };
        }
      >;
    }
  ).threads.get("thread-idle-timeout")!;
  return { host, payloads, thread };
}

function deferredSignal(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("main model stream idle timeout", () => {
  it("aborts and fails a main turn that never produces model activity", async () => {
    const { host, payloads, thread } = await createHost(20);
    vi.useFakeTimers();
    const promptStarted = deferredSignal();
    thread.session.prompt = () => {
      promptStarted.resolve();
      return new Promise(() => {});
    };
    thread.session.abort = vi.fn(async () => {});

    const prompt = host.prompt(
      "thread-idle-timeout",
      "turn-stalled",
      "Wait for a response.",
      "execute",
    );
    await promptStarted.promise;
    await vi.advanceTimersByTimeAsync(20);
    await prompt;

    expect(thread.session.abort).toHaveBeenCalledOnce();
    expect(payloads).toContainEqual({
      type: "turn.failed",
      code: "MODEL_STREAM_STALLED",
      message:
        "The model produced no streaming activity for 20 ms. Artemis cancelled the stalled request; retry the turn or choose another model.",
    });
    expect(thread.currentTurnId).toBeUndefined();
    host.dispose();
  });

  it("keeps the same Pi turn alive while the request watchdog retries silently", async () => {
    const { host, payloads, thread } = await createHost(20);
    vi.useFakeTimers();
    const started = deferredSignal();
    const recovered = {
      role: "assistant",
      content: [{ type: "text", text: "Recovered" }],
      api: "openai-responses",
      provider: "test",
      model: "test",
      stopReason: "stop",
      timestamp: 0,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    } as const;
    let calls = 0;
    const streamSimple = vi.fn(() => {
      const stream = createAssistantMessageEventStream();
      if (++calls === 3)
        queueMicrotask(() =>
          stream.push({
            type: "done",
            reason: "stop",
            message: { ...recovered, content: [...recovered.content] },
          }),
        );
      return stream;
    });
    const runtime = withConnectionRecovery(
      { streamSimple } as unknown as ModelRuntime,
      (sessionId, update) => {
        (
          host as unknown as {
            handleConnectionRecovery(
              sessionId: string | undefined,
              update: ConnectionRecoveryUpdate,
            ): void;
          }
        ).handleConnectionRecovery(sessionId, update);
      },
      { idleTimeoutMs: 20, wait: async () => undefined },
    );
    thread.session.abort = vi.fn(async () => {});
    thread.session.prompt = vi.fn(async () => {
      const stream = runtime.streamSimple(
        { id: "test", api: "openai-responses", provider: "test" } as Model<Api>,
        { messages: [] },
        { sessionId: thread.session.sessionId },
      );
      started.resolve();
      for await (const event of stream) {
        if (event.type === "done") {
          thread.session._emit({ type: "message_end", message: event.message });
          thread.session._emit({ type: "agent_settled" });
        }
      }
    });
    const prompt = host.prompt(
      "thread-idle-timeout",
      "turn-retry",
      "Wait for a response.",
      "execute",
    );
    await started.promise;
    await vi.advanceTimersByTimeAsync(40);
    await prompt;
    expect(thread.session.prompt).toHaveBeenCalledOnce();
    expect(thread.session.abort).not.toHaveBeenCalled();
    expect(streamSimple).toHaveBeenCalledTimes(3);
    expect(
      payloads.filter(
        (payload) =>
          payload.type === "turn.activity" && payload.phase === "reconnecting",
      ),
    ).toMatchObject([
      { kind: "stream-stalled", attempt: 1, maxAttempts: 2 },
      { kind: "stream-stalled", attempt: 2, maxAttempts: 2 },
    ]);
    expect(payloads.some((payload) => payload.type === "turn.failed")).toBe(
      false,
    );
    host.dispose();
  });

  it("resets the timeout for text, thinking, and tool-call stream deltas", async () => {
    const { host, payloads, thread } = await createHost(30);
    vi.useFakeTimers();
    const promptStarted = deferredSignal();
    thread.session.abort = vi.fn(async () => {});
    thread.session.prompt = async () => {
      promptStarted.resolve();
      await new Promise((resolve) => setTimeout(resolve, 20));
      thread.session._emit({
        type: "message_update",
        message: { id: "assistant-1", role: "assistant" },
        assistantMessageEvent: { type: "thinking_delta", delta: "thinking" },
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      thread.session._emit({
        type: "message_update",
        message: { id: "assistant-1", role: "assistant" },
        assistantMessageEvent: { type: "toolcall_delta", delta: '{"path"' },
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      thread.session._emit({
        type: "message_update",
        message: { id: "assistant-1", role: "assistant" },
        assistantMessageEvent: { type: "text_delta", delta: "Done" },
      });
    };

    const prompt = host.prompt(
      "thread-idle-timeout",
      "turn-active",
      "Produce a streamed response.",
      "execute",
    );
    await promptStarted.promise;
    await vi.advanceTimersByTimeAsync(60);
    await prompt;

    expect(thread.session.abort).not.toHaveBeenCalled();
    expect(
      payloads.some(
        (payload) =>
          payload.type === "turn.failed" &&
          payload.code === "MODEL_STREAM_STALLED",
      ),
    ).toBe(false);
    host.dispose();
  });

  it("pauses the model watchdog while a tool is running", async () => {
    const { host, payloads, thread } = await createHost(20);
    vi.useFakeTimers();
    const promptStarted = deferredSignal();
    thread.session.abort = vi.fn(async () => {});
    thread.session.prompt = async () => {
      promptStarted.resolve();
      thread.session._emit({
        type: "tool_execution_start",
        toolCallId: "tool-1",
        toolName: "read",
        args: { path: "README.md" },
      });
      await new Promise((resolve) => setTimeout(resolve, 40));
      thread.session._emit({
        type: "tool_execution_end",
        toolCallId: "tool-1",
        toolName: "read",
        result: "done",
        isError: false,
      });
    };

    const prompt = host.prompt(
      "thread-idle-timeout",
      "turn-tool",
      "Read the README.",
      "execute",
    );
    await promptStarted.promise;
    await vi.advanceTimersByTimeAsync(40);
    await prompt;

    expect(thread.session.abort).not.toHaveBeenCalled();
    expect(
      payloads.some(
        (payload) =>
          payload.type === "turn.failed" &&
          payload.code === "MODEL_STREAM_STALLED",
      ),
    ).toBe(false);
    host.dispose();
  });

  it("keeps the watchdog paused until every parallel tool finishes", async () => {
    const { host, payloads, thread } = await createHost(20);
    vi.useFakeTimers();
    const promptStarted = deferredSignal();
    thread.session.abort = vi.fn(async () => {});
    thread.session.prompt = async () => {
      promptStarted.resolve();
      for (const toolCallId of ["tool-fast", "tool-slow"]) {
        thread.session._emit({
          type: "tool_execution_start",
          toolCallId,
          toolName: "read",
          args: { path: `${toolCallId}.md` },
        });
      }
      thread.session._emit({
        type: "tool_execution_end",
        toolCallId: "tool-fast",
        toolName: "read",
        result: "done",
        isError: false,
      });
      await new Promise((resolve) => setTimeout(resolve, 25));
      thread.session._emit({
        type: "tool_execution_update",
        toolCallId: "tool-slow",
        toolName: "read",
        args: { path: "tool-slow.md" },
        partialResult: "still reading",
      });
      await new Promise((resolve) => setTimeout(resolve, 25));
      thread.session._emit({
        type: "tool_execution_end",
        toolCallId: "tool-slow",
        toolName: "read",
        result: "done",
        isError: false,
      });
    };

    const prompt = host.prompt(
      "thread-idle-timeout",
      "turn-parallel-tools",
      "Read both files.",
      "execute",
    );
    await promptStarted.promise;
    await vi.advanceTimersByTimeAsync(50);
    await prompt;

    expect(thread.session.abort).not.toHaveBeenCalled();
    expect(
      payloads.some(
        (payload) =>
          payload.type === "turn.failed" &&
          payload.code === "MODEL_STREAM_STALLED",
      ),
    ).toBe(false);
    host.dispose();
  });
});
