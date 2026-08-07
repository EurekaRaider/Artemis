import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import type { AgentPayload } from "@artemis/protocol";

import { ArtemisAgentHost } from "../src/runtime.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("failed follow-up recovery", () => {
  it("stops Pi from continuing queued work and returns the unexecuted text", async () => {
    const root = await mkdtemp(join(tmpdir(), "artemis-failed-follow-up-"));
    cleanupPaths.push(root);
    const workspacePath = join(root, "workspace");
    const agentDir = join(root, "agent");
    await mkdir(workspacePath);

    const payloads: AgentPayload[] = [];
    const host = new ArtemisAgentHost(
      {
        async request() {
          throw new Error("The recovery test must not broker tools.");
        },
      },
      {
        emit(_threadId, _turnId, payload) {
          payloads.push(payload);
        },
      },
      { agentDir },
    );
    await host.openThread({
      threadId: "thread-failure",
      workspacePath,
      target: "local",
    });
    const thread = (
      host as unknown as {
        threads: Map<
          string,
          {
            session: {
              pendingMessageCount: number;
              followUp(text: string): Promise<void>;
              prompt(text: string): Promise<void>;
              _emit(event: unknown): void;
            };
          }
        >;
      }
    ).threads.get("thread-failure")!;

    let promptCount = 0;
    thread.session.prompt = async () => {
      promptCount += 1;
      await thread.session.followUp("Talk about something unrelated.");
      const failure = {
        role: "assistant",
        content: [],
        api: "test",
        provider: "test",
        model: "deterministic",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0,
          },
        },
        stopReason: "error",
        errorMessage: "Simulated model failure.",
        timestamp: Date.now(),
      } as const;
      thread.session._emit({ type: "message_end", message: failure });
      thread.session._emit({
        type: "agent_end",
        messages: [failure],
        willRetry: false,
      });
      thread.session._emit({ type: "agent_settled" });
    };

    await host.prompt(
      "thread-failure",
      "turn-1",
      "Run the original task.",
      "execute",
    );

    expect(promptCount).toBe(1);
    expect(thread.session.pendingMessageCount).toBe(0);
    expect(payloads).toContainEqual({
      type: "queue.recovered",
      messages: ["Talk about something unrelated."],
    });
    expect(payloads.at(-1)).toEqual({
      type: "turn.failed",
      message: "Simulated model failure.",
    });
    host.dispose();
  });
});
