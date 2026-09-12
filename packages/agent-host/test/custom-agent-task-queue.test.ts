import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  ModelRuntime,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type {
  CustomAgentDefinition,
  CustomAgentTaskInvocation,
} from "@artemis/protocol";
import { ArtemisAgentHost } from "../src/runtime.js";

describe("explicit task block queue", () => {
  it("runs twelve real child sessions within two slots, advances after failure, and cancels queued work", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-task-queue-"));
    const host = new ArtemisAgentHost(
      { request: async () => ({ approved: false }) },
      { emit() {} },
      { agentDir: join(directory, "agent"), agentConcurrencyLimit: 2 },
    );
    const definition: CustomAgentDefinition = {
      id: "task-agent",
      revision: 1,
      name: "Worker",
      description: "",
      color: "green",
      enabled: true,
      instructions: "Complete only your assigned task.",
      scope: "all",
      modelPolicy: { kind: "inherit" },
      thinkingPolicy: { kind: "inherit" },
      toolPolicy: { kind: "inherit" },
      allowAutomaticInvocation: false,
      triggers: [],
      createdAt: 0,
      updatedAt: 0,
    };
    const completions: Array<(fail?: boolean) => void> = [];
    const provider = vi
      .spyOn(ModelRuntime.prototype, "streamSimple")
      .mockImplementation((model) => {
        const stream = createAssistantMessageEventStream();
        completions.push((fail = false) => {
          const message = {
            role: "assistant" as const,
            content: [{ type: "text" as const, text: "Done" }],
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
          if (fail)
            stream.push({
              type: "error",
              reason: "error",
              error: {
                ...message,
                stopReason: "error",
                errorMessage: "Fixture failure",
              },
            });
          else stream.push({ type: "done", reason: "stop", message });
        });
        return stream;
      });
    try {
      const selection = {
        providerId: "fixture",
        modelId: "worker",
        thinkingLevel: "off" as const,
      };
      await host.configure({
        credentials: {},
        selection,
        customAgents: [definition],
        providers: [
          {
            id: "fixture",
            name: "Fixture",
            baseUrl: "http://127.0.0.1:1/v1",
            models: [
              {
                id: "worker",
                name: "Worker",
                input: ["text"],
                reasoning: false,
                contextWindow: 128000,
                maxTokens: 16000,
              },
            ],
          },
        ],
      });
      await host.openThread({
        threadId: "queue",
        workspacePath: directory,
        target: "local",
        selection,
      });
      type Child = {
        agentId: string;
        status: string;
        done: Promise<void>;
        task: string;
      };
      type Hosted = {
        currentTurnId: string;
        currentMode: string;
        turnCustomAgents: CustomAgentDefinition[];
        session: AgentSession;
        childAgents: Map<string, Child>;
      };
      const internal = host as unknown as {
        threads: Map<string, Hosted>;
        acceptExplicitCustomAgentTasks(
          thread: Hosted,
          tasks: CustomAgentTaskInvocation[],
        ): unknown;
      };
      const thread = internal.threads.get("queue")!;
      thread.currentTurnId = "turn";
      thread.currentMode = "execute";
      thread.turnCustomAgents = [definition];
      thread.session.sendCustomMessage = async () => undefined;
      internal.acceptExplicitCustomAgentTasks(
        thread,
        Array.from({ length: 12 }, (_, index) => ({
          definitionId: definition.id,
          revision: 1,
          invocationId: `task-${index}`,
          text: `Independent task ${index}`,
        })),
      );
      const children = [...thread.childAgents.values()];
      expect(children).toHaveLength(12);
      await vi.waitFor(() => expect(completions).toHaveLength(2));
      expect(host.concurrencyStatus()).toMatchObject({ active: 2, queued: 10 });
      const cancelled = children[11]!;
      await host.cancelChildAgent("queue", cancelled.agentId);
      await cancelled.done;
      expect(cancelled.status).toBe("cancelled");
      completions[0]!(true);
      await vi.waitFor(() => expect(completions).toHaveLength(3));
      expect(children[0]!.status).toBe("failed");
      expect(host.concurrencyStatus().active).toBeLessThanOrEqual(2);
      for (let index = 1; index < 11; index++) {
        await vi.waitFor(() =>
          expect(completions.length).toBeGreaterThan(index),
        );
        expect(host.concurrencyStatus().active).toBeLessThanOrEqual(2);
        completions[index]!();
      }
      await Promise.all(children.map((child) => child.done));
      expect(
        children.filter((child) => child.status === "completed"),
      ).toHaveLength(10);
      expect(provider).toHaveBeenCalledTimes(11);
      expect(host.concurrencyStatus()).toMatchObject({ active: 0, queued: 0 });
    } finally {
      completions.forEach((complete) => complete());
      host.dispose();
      provider.mockRestore();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
