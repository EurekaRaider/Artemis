import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
} from "@earendil-works/pi-ai";
import type { AgentPayload } from "@artemis/protocol";
import { ArtemisAgentHost } from "../src/runtime.js";

it.each(["status", "wait", "cancel", "read", "permission"] as const)(
  "applies delegation stopping only to the intended %s tool and allows a new turn",
  async (action) => {
    const root = await mkdtemp(join(tmpdir(), "im-park-"));
    const payloads: AgentPayload[] = [];
    const broker = vi.fn(async () => ({
      approved: true,
      data:
        action === "permission"
          ? {
              state: "permission-required",
              parkPermission: true,
              code: "scope-denied",
              message: "Authorize the directory",
            }
          : action === "cancel"
            ? { cancelDelegationTurn: true }
            : { state: "waiting", parkDelegation: true, tasks: [] },
    }));
    const host = new ArtemisAgentHost(
      { request: broker },
      {
        emit(_thread, _turn, payload) {
          payloads.push(payload);
        },
      },
      { agentDir: join(root, "agent") },
    );
    try {
      await host.configure({
        credentials: { test: { type: "api_key", key: "synthetic-test-key" } },
      });
      await host.openThread({
        threadId: "task",
        workspacePath: root,
        target: "local",
        remoteExecution: { network: false, shell: false },
      });
      const session = (
        host as unknown as { threads: Map<string, { session: AgentSession }> }
      ).threads.get("task")!.session;
      vi.spyOn(session.modelRuntime, "hasConfiguredAuth").mockReturnValue(true);
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
      let resumed = false;
      let calls = 0;
      const stream = vi.fn(() => {
        const done = resumed || ++calls > 1;
        const output = createAssistantMessageEventStream();
        const message: AssistantMessage = {
          role: "assistant",
          api: "openai-completions",
          provider: "test",
          model: "test",
          timestamp: Date.now(),
          content: done
            ? [{ type: "text", text: "Result processed" }]
            : [
                {
                  type: "toolCall",
                  id: "poll",
                  name:
                    action === "read" || action === "permission"
                      ? "remote_read"
                      : "collaborate",
                  arguments: {
                    ...(action === "read" || action === "permission"
                      ? { path: "README.md" }
                      : { action }),
                    ...(action === "wait"
                      ? { taskIds: ["delegated"], text: "Continue later" }
                      : action === "cancel"
                        ? { taskId: "delegated" }
                        : {}),
                  },
                },
              ],
          stopReason: done ? "stop" : "toolUse",
          usage: {
            input: 1,
            output: 1,
            totalTokens: 2,
            cacheRead: 0,
            cacheWrite: 0,
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0,
            },
          },
        };
        queueMicrotask(() =>
          output.push({
            type: "done",
            reason: done ? "stop" : "toolUse",
            message,
          }),
        );
        return output;
      });
      session.agent.streamFunction = stream;
      if (action === "status")
        broker.mockImplementationOnce(async () => {
          await session.followUp("A newer user request");
          return {
            approved: true,
            data: { state: "waiting", parkDelegation: true, tasks: [] },
          };
        });
      await host.prompt("task", "origin", "Ask Solar then wait", "execute");
      expect(broker, JSON.stringify(payloads)).toHaveBeenCalledTimes(1);
      expect(stream).toHaveBeenCalledTimes(action === "read" ? 2 : 1);
      expect(payloads).toContainEqual(
        expect.objectContaining({
          type: "turn.completed",
          reason: action === "cancel" ? "cancelled" : "completed",
        }),
      );
      expect(payloads.some((p) => p.type === "turn.failed")).toBe(false);
      if (action === "status")
        expect(payloads).toContainEqual(
          expect.objectContaining({ type: "queue.recovered" }),
        );
      resumed = true;
      await host.prompt(
        "task",
        "continuation",
        "Solar has returned the result",
        "execute",
      );
      expect(stream).toHaveBeenCalledTimes(action === "read" ? 3 : 2);
    } finally {
      vi.restoreAllMocks();
      host.dispose();
      await rm(root, { recursive: true, force: true });
    }
  },
);
