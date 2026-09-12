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
  CustomAgentInstanceSnapshot,
} from "@artemis/protocol";
import { ArtemisAgentHost } from "../src/runtime.js";

describe("custom agent budget through real child sessions", () => {
  it.each([
    { window: 16000, fixed: false, succeeds: false },
    { window: 128000, fixed: false, succeeds: true },
    { window: 16000, fixed: true, succeeds: true },
  ])(
    "checks the actual resolved window: $window, fixed=$fixed",
    async ({ window, fixed, succeeds }) => {
      const directory = await mkdtemp(join(tmpdir(), "artemis-child-context-"));
      const host = new ArtemisAgentHost(
        { request: async () => ({ approved: false }) },
        { emit() {} },
        { agentDir: join(directory, "agent") },
      );
      const instructions = "完整规则".repeat(8000);
      const definition: CustomAgentDefinition = {
        id: "custom",
        revision: 1,
        name: "Specialist",
        description: "Specialist",
        color: "green",
        enabled: true,
        instructions,
        scope: "all",
        modelPolicy: fixed
          ? { kind: "fixed", providerId: "budget", modelId: "large" }
          : { kind: "inherit" },
        thinkingPolicy: { kind: "inherit" },
        toolPolicy: { kind: "inherit" },
        allowAutomaticInvocation: true,
        triggers: [],
        createdAt: 0,
        updatedAt: 0,
      };
      const provider = vi
        .spyOn(ModelRuntime.prototype, "streamSimple")
        .mockImplementation((model) => {
          const stream = createAssistantMessageEventStream();
          stream.push({
            type: "done",
            reason: "stop",
            message: {
              role: "assistant",
              content: [{ type: "text", text: "Done" }],
              api: model.api,
              provider: model.provider,
              model: model.id,
              stopReason: "stop",
              timestamp: Date.now(),
              usage: {
                input: 33000,
                output: 1,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 33001,
                cost: {
                  input: 0,
                  output: 0,
                  cacheRead: 0,
                  cacheWrite: 0,
                  total: 0,
                },
              },
            },
          });
          return stream;
        });
      try {
        const selection = {
          providerId: "budget",
          modelId: "large",
          thinkingLevel: "off" as const,
        };
        await host.configure({
          credentials: {},
          selection,
          contextWindow: window,
          customAgents: [definition],
          providers: [
            {
              id: "budget",
              name: "Budget",
              baseUrl: "http://127.0.0.1:1/v1",
              models: [
                {
                  id: "large",
                  name: "Large",
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
          threadId: "task",
          workspacePath: directory,
          target: "local",
          selection,
          contextWindow: window,
        });
        const thread = (
          host as unknown as {
            threads: Map<
              string,
              {
                currentTurnId: string;
                currentMode: string;
                turnCustomAgents: CustomAgentDefinition[];
                session: AgentSession;
                executeTools: Array<{
                  name: string;
                  execute(id: string, input: unknown): Promise<unknown>;
                }>;
                childAgents: Map<
                  string,
                  {
                    done: Promise<void>;
                    status: string;
                    error?: string;
                    customAgentSnapshot: CustomAgentInstanceSnapshot;
                  }
                >;
              }
            >;
          }
        ).threads.get("task")!;
        thread.currentTurnId = "turn";
        thread.currentMode = "execute";
        thread.turnCustomAgents = [definition];
        thread.session.sendCustomMessage = async () => undefined;
        await thread.executeTools
          .find((tool) => tool.name === "spawn_agent")!
          .execute("spawn", {
            agent: "custom",
            label: "Check",
            role: "Specialist",
            task: "Return Done",
            write_paths: [],
          });
        const child = [...thread.childAgents.values()][0]!;
        expect(child).toBeDefined();
        await child.done;
        expect(child.status).toBe(succeeds ? "completed" : "failed");
        expect(child.customAgentSnapshot.instructions).toBe(instructions);
        if (succeeds) {
          expect(provider).toHaveBeenCalledOnce();
          const [model, context] = provider.mock.calls[0]!;
          expect(model.contextWindow).toBe(128000);
          expect(context.systemPrompt).toContain(instructions);
          expect(JSON.stringify(context.messages)).toContain("Return Done");
          expect(context.messages).toHaveLength(1);
        } else {
          expect(provider).not.toHaveBeenCalled();
          expect(child.error).toContain("CUSTOM_AGENT_CONTEXT_EXCEEDED");
          expect(child.error).toContain("16000-token");
        }
      } finally {
        host.dispose();
        provider.mockRestore();
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});
