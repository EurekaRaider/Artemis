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
import images from "../fixtures/read-images.json";

it.each([
  { mode: "plan", source: "workspace", child: false },
  { mode: "work", source: "workspace", child: false },
  { mode: "codemode", source: "workspace", child: false },
  { mode: "codemode", source: "attachment", child: false },
  { mode: "work", source: "attachment", child: false },
  { mode: "work", source: "workspace", child: true },
  { mode: "codemode", source: "workspace", child: true },
] as const)(
  "delivers $source images to the next $mode model request (child=$child) through Pi",
  async ({ mode, source, child }) => {
    const root = await mkdtemp(join(tmpdir(), "artemis-image-loop-"));
    await writeFile(
      join(root, "picture.bin"),
      Buffer.from(images.png.data, "base64"),
    );
    const payloads: AgentPayload[] = [];
    const brokerCalls: string[] = [];
    const host = new ArtemisAgentHost(
      {
        request: async (r) => {
          brokerCalls.push(r.kind);
          if (r.kind === "attachment.read")
            return {
              approved: true,
              data: {
                id: "picture",
                ...images.png,
                originalWidth: 2,
                originalHeight: 2,
              },
            };
          throw new Error(`Unexpected broker operation ${r.kind}`);
        },
      },
      { emit: (_thread, _turn, payload) => payloads.push(payload) },
      { agentDir: join(root, "agent") },
    );
    let requests = 0;
    let receivedImage = false;
    const results: unknown[] = [];
    const stream = vi
      .spyOn(ModelRuntime.prototype, "streamSimple")
      .mockImplementation((model, context) => {
        results.push(
          ...context.messages.filter((m) => m.role === "toolResult"),
        );
        const previous = context.messages.find(
          (m) =>
            m.role === "toolResult" &&
            m.content.some((b) => b.type === "image"),
        );
        if (previous?.role === "toolResult") {
          expect(previous.isError).toBe(false);
          expect(previous.content).toContainEqual({
            type: "image",
            data: images.png.data,
            mimeType: "image/png",
          });
          receivedImage = true;
        }
        const readName = source === "workspace" ? "read" : "attachment_read";
        const readArgs =
          source === "workspace" ? { path: "picture.bin" } : { id: "picture" };
        const first = requests++ === 0;
        if (first) {
          const tools = getCurrentTools(context.messages).map((t) => t.name);
          if (mode === "codemode") {
            expect(tools).toContain("codemode");
            expect(tools).not.toContain("read");
            expect(tools).not.toContain("attachment_read");
            expect(tools).not.toContain("shell");
          }
          if (mode === "plan") {
            expect(tools).not.toContain("shell");
            expect(tools).not.toContain("write");
          }
        }
        const message: AssistantMessage = {
          role: "assistant",
          api: model.api,
          provider: model.provider,
          model: model.id,
          timestamp: Date.now(),
          stopReason: first ? "toolUse" : "stop",
          content: first
            ? [
                {
                  type: "toolCall",
                  id: "image-call",
                  name: mode === "codemode" ? "codemode" : readName,
                  arguments:
                    mode === "codemode"
                      ? {
                          code: `image(await tools.${readName}(${JSON.stringify(readArgs)}));`,
                        }
                      : readArgs,
                },
              ]
            : [{ type: "text", text: "Image received" }],
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
        modelId: "vision",
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
                id: "vision",
                name: "Vision",
                reasoning: false,
                input: ["text", "image"],
                contextWindow: 128000,
                maxTokens: 1000,
              },
            ],
          },
        ],
      });
      await host.openThread({
        threadId: "task",
        workspacePath: root,
        target: "local",
        selection,
      });
      if (child) {
        const thread = (
          host as unknown as {
            threads: Map<
              string,
              {
                currentMode: RunMode;
                currentTurnId: string;
                session: AgentSession;
                executeTools: {
                  name: string;
                  execute(
                    id: string,
                    args: unknown,
                  ): Promise<{ details?: { agentId?: string } }>;
                }[];
                childAgents: Map<string, { status: string }>;
              }
            >;
          }
        ).threads.get("task")!;
        thread.currentMode = mode;
        thread.currentTurnId = "turn";
        // Keep parent steering out of the child fixture; the child still uses a real Pi session.
        const steer = vi
          .spyOn(thread.session, "sendCustomMessage")
          .mockResolvedValue(undefined);
        try {
          const result = await thread.executeTools
            .find((t) => t.name === "spawn_agent")!
            .execute("spawn", {
              label: "Image reader",
              task: "Read picture.bin",
            });
          const agentId = result.details!.agentId!;
          await vi.waitFor(
            () =>
              expect(thread.childAgents.get(agentId)?.status).toBe("completed"),
            { timeout: 10000 },
          );
        } finally {
          steer.mockRestore();
        }
      } else await host.prompt("task", "turn", "Read the image", mode);
      expect(requests).toBe(2);
      expect(receivedImage, JSON.stringify(results)).toBe(true);
      if (!child)
        expect(
          payloads.some(
            (p) =>
              p.type === "tool.completed" &&
              !p.isError &&
              p.images?.some((i) => i.data === images.png.data),
          ),
        ).toBe(true);
      expect(
        payloads
          .filter((p) => p.type === "tool.completed")
          .every((p) => !p.output?.includes(images.png.data)),
      ).toBe(true);
      if (source === "attachment")
        expect(brokerCalls).toEqual(["attachment.read"]);
      else expect(brokerCalls).toEqual([]);
    } finally {
      stream.mockRestore();
      host.dispose();
      await rm(root, { recursive: true, force: true });
    }
  },
);
