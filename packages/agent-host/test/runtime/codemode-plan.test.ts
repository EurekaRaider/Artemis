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
  { mode: "plan", direct: false, scenario: "read" },
  { mode: "work", direct: false, scenario: "read" },
  { mode: "codemode", direct: false, scenario: "read" },
  { mode: "codemode", direct: true, scenario: "read" },
  { mode: "codemode", direct: false, scenario: "shell" },
  { mode: "work", direct: false, scenario: "loop" },
  { mode: "work", direct: false, scenario: "invalid-loop" },
] as const)(
  "enforces $mode tools with direct business call=$direct ($scenario) through the actual Pi loop",
  async ({ mode, direct, scenario }) => {
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
        const name = scenario.endsWith("loop")
          ? "update_plan"
          : mode === "plan"
            ? "submit_plan"
            : mode === "codemode" && !direct
              ? "codemode"
              : "read";
        const args =
          scenario === "invalid-loop"
            ? { plan: [] }
            : scenario.endsWith("loop")
              ? { steps: [{ step: "Read branches", status: "in_progress" }] }
              : scenario === "shell"
                ? {
                    code: `text(await tools.shell(${JSON.stringify({ command: process.platform === "win32" ? "Write-Output 'SCRIPT_RESULT'" : "printf SCRIPT_RESULT", deadline_seconds: 10, model_approval: { risk: "low", explicit_user_request: false, reason: "Read-only test output" } })}));`,
                  }
                : mode === "plan"
                  ? {
                      title: "Full plan",
                      markdown:
                        "Goal, steps, interfaces, acceptance, assumptions.",
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
          stopReason:
            request++ < (scenario.endsWith("loop") ? 12 : 1)
              ? "toolUse"
              : "stop",
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
            ? [
                {
                  type: "toolCall",
                  id: `call-${request}`,
                  name,
                  arguments: args,
                },
              ]
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
      } else if (scenario.endsWith("loop")) {
        expect(request).toBe(8);
        expect(
          payloads.some(
            (p) => p.type === "turn.failed" && p.code === "PLAN_UPDATE_LOOP",
          ),
        ).toBe(true);
        request = 0;
        await host.prompt("task", "second-turn", "Try again", mode);
        expect(request).toBe(8);
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
            (p) => p.type === "tool.started" && p.parentToolCallId === "call-1",
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
