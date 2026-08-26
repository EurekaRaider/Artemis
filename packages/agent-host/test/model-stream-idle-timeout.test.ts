import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentPayload } from "@artemis/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ArtemisAgentHost } from "../src/runtime.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
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

describe("main model stream idle timeout", () => {
  it("aborts and fails a main turn that never produces model activity", async () => {
    const { host, payloads, thread } = await createHost(20);
    thread.session.prompt = () => new Promise(() => {});
    thread.session.abort = vi.fn(async () => {});

    await host.prompt(
      "thread-idle-timeout",
      "turn-stalled",
      "Wait for a response.",
      "execute",
    );

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

  it("resets the timeout for text, thinking, and tool-call stream deltas", async () => {
    const { host, payloads, thread } = await createHost(30);
    thread.session.abort = vi.fn(async () => {});
    thread.session.prompt = async () => {
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

    await host.prompt(
      "thread-idle-timeout",
      "turn-active",
      "Produce a streamed response.",
      "execute",
    );

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
    thread.session.abort = vi.fn(async () => {});
    thread.session.prompt = async () => {
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

    await host.prompt(
      "thread-idle-timeout",
      "turn-tool",
      "Read the README.",
      "execute",
    );

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
