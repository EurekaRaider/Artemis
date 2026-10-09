import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
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

const scenarios = [
  { mode: "plan", direct: false, scenario: "read" },
  { mode: "work", direct: false, scenario: "read" },
  { mode: "codemode", direct: false, scenario: "read" },
  { mode: "codemode", direct: true, scenario: "read" },
  { mode: "codemode", direct: false, scenario: "shell" },
  { mode: "codemode", direct: false, scenario: "image-save" },
  { mode: "work", direct: false, scenario: "loop" },
  { mode: "work", direct: false, scenario: "invalid-loop" },
] as const;
it.each(
  scenarios.flatMap((scenario) =>
    [undefined, "plugin-restricted-v1", "plugin-standard-v1", "new-design"].map(
      (profile) => ({ ...scenario, profile }),
    ),
  ),
)(
  "enforces $mode tools with direct business call=$direct ($scenario, Design=$profile) through the actual Pi loop",
  async ({ mode, direct, scenario, profile }) => {
    const dir = await mkdtemp(join(tmpdir(), "artemis-modes-"));
    const payloads: AgentPayload[] = [];
    const calls: string[] = [];
    const imageFiles: string[] = [];
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
            : scenario === "image-save"
              ? {
                  code: 'image("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII="); text(await tools.read({path:"fixture.txt"}));',
                }
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
                      ? {
                          code: 'text(await tools.read({path:"fixture.txt"}));',
                        }
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
        ...(profile
          ? {
              ...(profile !== "new-design"
                ? { executionProfile: profile }
                : {}),
              typeBinding: {
                installationId: "design",
                pluginId: "com.artemis.design",
                typeId: "artemis-design",
                pluginVersion: "0.4.6",
                contentHash: "a".repeat(64),
                bindingRevision: "rev",
              },
              pluginTools: [
                {
                  name: "create_document",
                  description: "Create a document",
                  effect: "artifact-write" as const,
                },
              ],
            }
          : {}),
      });
      await host.prompt("task", "turn", "Do the task", mode);
      expect(seen[0]?.includes("codemode")).toBe(mode === "codemode");
      expect(seen[0]?.includes("submit_plan")).toBe(mode === "plan");
      expect(seen[0]?.includes("read")).toBe(mode !== "codemode");
      expect(seen[0]?.includes("shell")).toBe(mode === "work");
      expect(seen[0]).toContain("request_user_input");
      if (mode === "plan") {
        expect(seen[0]).not.toContain("plugin_create_document");
        expect(seen[0]).not.toContain("local_file_write");
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
      if (scenario === "image-save") {
        const result = payloads.find(
          (p) =>
            p.type === "tool.completed" &&
            p.output?.includes("[Image saved to "),
        );
        expect(result?.type).toBe("tool.completed");
        if (result?.type === "tool.completed") {
          const path = result.output!.match(
            /\[Image saved to (.+) \(image\/png, [^)]+\)\]/,
          )?.[1];
          expect(path).toBeDefined();
          imageFiles.push(path!);
          expect((await readFile(path!)).subarray(0, 8).toString("hex")).toBe(
            "89504e470d0a1a0a",
          );
          if (process.platform !== "win32")
            expect((await stat(path!)).mode & 0o777).toBe(0o600);
        }
      }
      expect(payloads.some((p) => p.type === "turn.completed")).toBe(true);
    } finally {
      stream.mockRestore();
      host.dispose();
      await Promise.all(imageFiles.map((path) => rm(path, { force: true })));
      await rm(dir, { recursive: true, force: true });
    }
  },
);
