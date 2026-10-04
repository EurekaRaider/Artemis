import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import {
  ModelRuntime,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import {
  createAssistantMessageEventStream,
  getCurrentTools,
  type AssistantMessage,
} from "@earendil-works/pi-ai";
import type { AgentPayload, RunMode } from "@artemis/protocol";
import { ArtemisAgentHost } from "../../src/runtime/runtime.js";

it.each([
  { mode: "plan", direct: false },
  { mode: "work", direct: false },
  { mode: "codemode", direct: false },
  { mode: "codemode", direct: true },
] as const)(
  "enforces $mode tools with direct business call=$direct through the actual Pi loop",
  async ({ mode, direct }) => {
    const dir = await mkdtemp(join(tmpdir(), "artemis-modes-"));
    const payloads: AgentPayload[] = [];
    const calls: string[] = [];
    const host = new ArtemisAgentHost(
      {
        request: async (r) => {
          calls.push(r.kind);
          return { approved: true, data: {} };
        },
      },
      { emit: (_t, _r, p) => payloads.push(p) },
      { agentDir: join(dir, "agent") },
    );
    await writeFile(join(dir, "fixture.txt"), "SCRIPT_RESULT");
    const seen: string[][] = [];
    let request = 0;
    const stream = vi
      .spyOn(ModelRuntime.prototype, "streamSimple")
      .mockImplementation((model, context) => {
        seen.push(getCurrentTools(context.messages).map((t) => t.name));
        const name =
          mode === "plan"
            ? "submit_plan"
            : mode === "codemode" && !direct
              ? "codemode"
              : "read";
        const args =
          mode === "plan"
            ? {
                title: "Full plan",
                markdown: "Goal, steps, interfaces, acceptance, assumptions.",
              }
            : mode === "codemode" && !direct
              ? { code: 'text(await tools.read({path:"fixture.txt"}));' }
              : { path: "fixture.txt" };
        const message: AssistantMessage = {
          role: "assistant",
          api: model.api,
          provider: model.provider,
          model: model.id,
          timestamp: Date.now(),
          stopReason: request++ === 0 ? "toolUse" : "stop",
          content: [],
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
        message.content =
          message.stopReason === "toolUse"
            ? [{ type: "toolCall", id: "call", name, arguments: args }]
            : [{ type: "text", text: "Done" }];
        const events = createAssistantMessageEventStream();
        events.push({ type: "done", reason: message.stopReason, message });
        return events;
      });
    try {
      const selection = {
        providerId: "fixture",
        modelId: "model",
        thinkingLevel: "off" as const,
      };
      await host.configure({
        credentials: {},
        selection,
        providers: [
          {
            id: "fixture",
            name: "Fixture",
            baseUrl: "http://127.0.0.1:1/v1",
            models: [
              {
                id: "model",
                name: "Model",
                reasoning: false,
                input: ["text"],
                contextWindow: 128000,
                maxTokens: 1000,
              },
            ],
          },
        ],
      });
      await host.openThread({
        threadId: "task",
        workspacePath: dir,
        target: "local",
        selection,
      });
      await host.prompt("task", "turn", "Do the task", mode);
      expect(seen[0]?.includes("codemode")).toBe(mode === "codemode");
      expect(seen[0]?.includes("submit_plan")).toBe(mode === "plan");
      expect(seen[0]?.includes("read")).toBe(mode !== "codemode");
      expect(seen[0]?.includes("shell")).toBe(mode === "work");
      expect(seen[0]).toContain("request_user_input");
      if (mode === "plan") {
        expect(calls).toEqual(["plan.submit"]);
        expect(request).toBe(1);
      } else if (direct) {
        expect(
          payloads.some(
            (p) =>
              p.type === "tool.completed" &&
              p.isError &&
              p.output?.includes("CODEMODE_SCRIPT_REQUIRED"),
          ),
        ).toBe(true);
        expect(
          payloads.some(
            (p) =>
              p.type === "tool.completed" &&
              p.output?.includes("SCRIPT_RESULT"),
          ),
        ).toBe(false);
      } else {
        expect(
          payloads.some(
            (p) =>
              p.type === "tool.completed" &&
              p.output?.includes("SCRIPT_RESULT"),
          ),
        ).toBe(true);
      }
      if (mode === "codemode" && !direct)
        expect(
          payloads.some(
            (p) => p.type === "tool.started" && p.parentToolCallId === "call",
          ),
        ).toBe(true);
      expect(payloads.some((p) => p.type === "turn.completed")).toBe(true);
    } finally {
      stream.mockRestore();
      host.dispose();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
