import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  createAssistantMessageEventStream,
  type Context,
} from "@earendil-works/pi-ai";
import { composerPredictionMarker, type AgentPayload } from "@artemis/protocol";
import { ArtemisAgentHost } from "../../src/runtime/runtime.js";

it("piggybacks on the real Pi turn without extra requests and cleans subsequent context", async () => {
  const root = await mkdtemp(join(tmpdir(), "artemis-prediction-"));
  const payloads: AgentPayload[] = [];
  const broker = vi.fn(async () => {
    throw new Error("Prediction must not call tools");
  });
  const host = new ArtemisAgentHost(
    { request: broker },
    {
      emit(_thread, _turn, payload) {
        payloads.push(payload);
      },
    },
    { agentDir: join(root, "agent") },
  );
  const contexts: Context[] = [];
  const provider = vi
    .spyOn(ModelRuntime.prototype, "streamSimple")
    .mockImplementation((model, context) => {
      contexts.push(structuredClone(context));
      const last = context.messages.findLast((m) => m.role === "user")!;
      const token = JSON.stringify(last.content).match(
        /\[Artemis composer prediction ([a-zA-Z0-9-]+)\]/u,
      )?.[1];
      const text =
        "Work completed." +
        (token
          ? `${composerPredictionMarker(token)}{"suggestion":"Show the tests."}</artemis-prediction>`
          : "");
      const stream = createAssistantMessageEventStream();
      stream.push({
        type: "done",
        reason: "stop",
        message: {
          role: "assistant",
          content: [{ type: "text", text }],
          api: model.api,
          provider: model.provider,
          model: model.id,
          timestamp: Date.now(),
          stopReason: "stop",
          usage: {
            input: 100,
            output: 20,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 120,
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
      providerId: "prediction-test",
      modelId: "small",
      thinkingLevel: "off" as const,
    };
    await host.configure({
      credentials: {},
      providers: [
        {
          id: selection.providerId,
          name: "Test",
          baseUrl: "http://127.0.0.1:11434/v1",
          models: [
            {
              id: "small",
              name: "Test",
              reasoning: false,
              input: ["text"],
              contextWindow: 128000,
              maxTokens: 8000,
            },
          ],
        },
      ],
      selection,
    });
    await host.openThread({
      threadId: "task",
      workspacePath: root,
      target: "local",
      selection,
    });
    await host.prompt(
      "task",
      "first",
      "Do work",
      "work",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true,
    );
    expect(contexts).toHaveLength(1);
    expect(payloads.findLast((p) => p.type === "turn.completed")).toMatchObject(
      { composerPrediction: "Show the tests." },
    );
    expect(
      payloads
        .filter((p) => p.type === "message.part.delta")
        .map((p) => p.delta)
        .join(""),
    ).toBe("Work completed.");
    payloads.length = 0;
    await host.prompt("task", "second", "Explain", "work");
    expect(contexts).toHaveLength(2);
    expect(
      JSON.stringify(
        contexts[1]!.messages.filter((m) => m.role === "assistant"),
      ),
    ).not.toContain("artemis-prediction");
    expect(JSON.stringify(contexts[1]!.messages)).not.toContain(
      "Artemis composer prediction",
    );
    expect(
      payloads.findLast((p) => p.type === "turn.completed"),
    ).not.toHaveProperty("composerPrediction");
    expect(broker).not.toHaveBeenCalled();
  } finally {
    host.dispose();
    provider.mockRestore();
    await rm(root, { recursive: true, force: true });
  }
});
