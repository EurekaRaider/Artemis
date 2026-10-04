import { createServer, type ServerResponse } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { expect, it } from "vitest";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { AgentPayload } from "@artemis/protocol";
import { ArtemisAgentHost } from "../../src/runtime/runtime.js";
const sse = (response: ServerResponse, value: unknown) =>
  response.write(`data: ${JSON.stringify(value)}\n\n`);
it.each(
  (["openai-completions", "openai-responses"] as const).flatMap((api) =>
    ["reset", "eof"].map((termination) => ({ api, termination })),
  ),
)(
  "recovers $api $termination without replaying tools",
  async ({ api, termination }) => {
    const dir = await mkdtemp(join(tmpdir(), "artemis-transport-"));
    await writeFile(join(dir, "fixture.txt"), "COMMITTED_RESULT");
    const payloads: AgentPayload[] = [];
    const requests: unknown[] = [];
    const server = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += String(chunk);
      requests.push(JSON.parse(body));
      const attempt = requests.length;
      response.writeHead(200, { "content-type": "text/event-stream" });
      if (api === "openai-completions") {
        const chunk = (delta: unknown, finish_reason: string | null = null) =>
          sse(response, {
            id: `r${attempt}`,
            object: "chat.completion.chunk",
            created: 1,
            model: "fixture",
            choices: [{ index: 0, delta, finish_reason }],
          });
        if (attempt === 1) {
          chunk({
            role: "assistant",
            content: "Inspecting file.",
            tool_calls: [
              {
                index: 0,
                id: "read-once",
                type: "function",
                function: { name: "read", arguments: '{"path":"fixture.txt"}' },
              },
            ],
          });
          chunk({}, "tool_calls");
          response.end("data: [DONE]\n\n");
        } else {
          chunk({
            role: "assistant",
            content: attempt === 2 ? "INCOMPLETE" : "RECOVERED",
          });
          if (attempt === 2)
            setTimeout(
              () =>
                termination === "reset" ? response.destroy() : response.end(),
              40,
            );
          else {
            chunk({}, "stop");
            response.end("data: [DONE]\n\n");
          }
        }
      } else {
        const id = `r${attempt}`;
        sse(response, {
          type: "response.created",
          response: { id, created_at: 1, model: "fixture" },
        });
        if (attempt === 1) {
          const item = {
            type: "function_call",
            id: "fc_read",
            call_id: "read-once",
            name: "read",
            arguments: '{"path":"fixture.txt"}',
            status: "completed",
          };
          sse(response, {
            type: "response.output_item.added",
            output_index: 0,
            item,
          });
          sse(response, {
            type: "response.output_item.done",
            output_index: 0,
            item,
          });
        } else {
          sse(response, {
            type: "response.output_item.added",
            output_index: 0,
            item: { type: "message", id: `msg${attempt}` },
          });
          sse(response, {
            type: "response.output_text.delta",
            item_id: `msg${attempt}`,
            output_index: 0,
            content_index: 0,
            delta: attempt === 2 ? "INCOMPLETE" : "RECOVERED",
          });
          if (attempt === 2) {
            setTimeout(
              () =>
                termination === "reset" ? response.destroy() : response.end(),
              40,
            );
            return;
          }
          sse(response, {
            type: "response.output_item.done",
            output_index: 0,
            item: { type: "message", id: `msg${attempt}` },
          });
        }
        sse(response, {
          type: "response.completed",
          response: {
            id,
            created_at: 1,
            model: "fixture",
            status: "completed",
            incomplete_details: null,
            usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
          },
        });
        response.end();
      }
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address() as { port: number };
    const host = new ArtemisAgentHost(
      {
        request: async () => {
          throw new Error("Unexpected broker call");
        },
      },
      { emit: (_t, _r, p) => payloads.push(p) },
      { agentDir: join(dir, "agent") },
    );
    try {
      const selection = {
        providerId: "fixture",
        modelId: "fixture",
        thinkingLevel: "off" as const,
      };
      await host.configure({
        credentials: {},
        selection,
        providers: [
          {
            id: "fixture",
            name: "Fixture",
            api,
            baseUrl: `http://127.0.0.1:${address.port}/v1`,
            models: [
              {
                id: "fixture",
                name: "Fixture",
                reasoning: false,
                input: ["text"],
                contextWindow: 128000,
                maxTokens: 1024,
              },
            ],
          },
        ],
      });
      await host.openThread({
        threadId: "t",
        workspacePath: dir,
        target: "local",
        selection,
      });
      const session = (
        host as unknown as { threads: Map<string, { session: AgentSession }> }
      ).threads.get("t")!.session;
      session.settingsManager.applyOverrides({
        retry: { enabled: true, maxRetries: 2, baseDelayMs: 1 },
      });
      await host.prompt("t", "turn", "Read fixture.txt, then report.", "work");
      expect(requests).toHaveLength(3);
      expect(
        payloads.filter(
          (p) => p.type === "tool.started" && p.toolName === "read",
        ),
      ).toHaveLength(1);
      expect(
        payloads.some(
          (p) =>
            p.type === "tool.completed" &&
            p.output?.includes("COMMITTED_RESULT"),
        ),
      ).toBe(true);
      expect(payloads.some((p) => p.type === "message.superseded")).toBe(true);
      expect(
        payloads.some(
          (p) =>
            p.type === "message.part.delta" && p.delta.includes("RECOVERED"),
        ),
      ).toBe(true);
      expect(payloads.some((p) => p.type === "turn.completed")).toBe(true);
      expect(JSON.stringify(requests[2])).toContain("COMMITTED_RESULT");
      expect(JSON.stringify(requests[2])).not.toContain("INCOMPLETE");
    } finally {
      host.dispose();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(dir, { recursive: true, force: true });
    }
  },
  20000,
);
