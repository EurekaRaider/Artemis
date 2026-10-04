import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
} from "@earendil-works/pi-ai";
import type { BrokerExecutionRequest } from "@artemis/protocol";
import { ArtemisAgentHost } from "../src/runtime.js";

it.each([
  { mode: "work", kind: "mcp.call" },
  { mode: "codemode", kind: "mcp.call" },
  { mode: "work", kind: "extension.call" },
  { mode: "codemode", kind: "extension.call" },
] as const)(
  "passes a model-requested $kind escalation through the actual $mode Pi loop",
  async ({ mode, kind }) => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), "artemis-escalation-loop-"),
    );
    const calls: BrokerExecutionRequest[] = [];
    const host = new ArtemisAgentHost(
      {
        request: async (request) => {
          if (request.kind !== kind)
            throw new Error(`Unexpected call: ${request.kind}`);
          calls.push(request);
          const isError = !request.sandboxEscalation;
          const text = isError
            ? "EACCES: sandbox denied the requested file"
            : "ESCALATED_READ_COMPLETE";
          return {
            approved: true,
            data:
              kind === "mcp.call"
                ? { content: [{ type: "text", text }], isError }
                : { output: text, isError },
          };
        },
      },
      { emit() {} },
      { agentDir: join(workspacePath, "agent") },
    );
    let turn = 0;
    const stream = vi
      .spyOn(ModelRuntime.prototype, "streamSimple")
      .mockImplementation((model) => {
        const attempt = turn++;
        const parameters = {
          arguments: { path: "/requested/report.txt" },
          model_approval: {
            risk: "high",
            explicit_user_request: true,
            reason: "The user requested this exact read.",
          },
          ...(attempt === 1
            ? {
                sandbox_escalation: {
                  justification:
                    "The sandbox denied this read. Retrying a read has no duplicate side effects.",
                },
              }
            : {}),
        };
        const message: AssistantMessage = {
          role: "assistant",
          api: model.api,
          provider: model.provider,
          model: model.id,
          timestamp: Date.now(),
          stopReason: attempt < 2 ? "toolUse" : "stop",
          content:
            attempt < 2
              ? [
                  {
                    type: "toolCall",
                    id: `call-${attempt}`,
                    name: mode === "codemode" ? "codemode" : "fixture_read",
                    arguments:
                      mode === "codemode"
                        ? {
                            code: `text(await tools.fixture_read(${JSON.stringify(parameters)}));`,
                          }
                        : parameters,
                  },
                ]
              : [{ type: "text", text: "Done" }],
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
        ...(kind === "mcp.call"
          ? {
              mcpTools: [
                {
                  serverId: "fixture",
                  serverName: "Fixture",
                  transport: "stdio" as const,
                  piName: "fixture_read",
                  toolName: "read",
                  description: "Read a requested file",
                  inputSchema: {
                    type: "object",
                    properties: { path: { type: "string" } },
                  },
                  readOnly: true,
                  destructive: false,
                  exposure: "direct" as const,
                },
              ],
            }
          : {
              extensionTools: [
                {
                  extensionId: "fixture",
                  extensionName: "Fixture",
                  piName: "fixture_read",
                  toolName: "read",
                  label: "Read",
                  description: "Read a requested file",
                  inputSchema: {
                    type: "object",
                    properties: { path: { type: "string" } },
                  },
                },
              ],
            }),
      });
      await host.openThread({
        threadId: "task",
        workspacePath,
        target: "local",
        selection,
      });
      await host.prompt("task", "turn", "Read /requested/report.txt", mode);
      expect(calls).toHaveLength(2);
      expect(calls[0]).not.toHaveProperty("sandboxEscalation");
      expect(calls[1]).toMatchObject({
        kind,
        mode,
        threadId: "task",
        turnId: "turn",
        sandboxEscalation: {
          justification: expect.stringContaining("sandbox denied"),
        },
        modelApproval: { risk: "high", explicitUserRequest: true },
      });
      expect(calls[1]?.arguments).toEqual(calls[0]?.arguments);
      expect(turn).toBe(3);
    } finally {
      stream.mockRestore();
      host.dispose();
      await rm(workspacePath, { recursive: true, force: true });
    }
  },
);
