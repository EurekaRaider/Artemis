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

it.each(["none", "steer", "followUp", "steerQueuedFollowUp"] as const)(
  "uses the latest real Pi context after %s without extra prediction requests",
  async (supplement) => {
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
    let releaseFirst: (() => void) | undefined;
    let started: () => void;
    const firstRequest = new Promise<void>((resolve) => {
      started = resolve;
    });
    const correction = "Explain the steps instead of running them.";
    const provider = vi
      .spyOn(ModelRuntime.prototype, "streamSimple")
      .mockImplementation((model, context) => {
        contexts.push(structuredClone(context));
        const last = context.messages.findLast((m) => m.role === "user")!;
        const token = JSON.stringify(last.content).match(
          /\[Artemis composer prediction ([a-zA-Z0-9-]+)\]/u,
        )?.[1];
        const updated = JSON.stringify(last.content).includes(correction);
        const suggestion = updated ? "Show the steps." : "Show the tests.";
        const text =
          (updated ? "Here are the steps." : "Work completed.") +
          (token
            ? `${composerPredictionMarker(token)}${JSON.stringify({ suggestion })}</artemis-prediction>`
            : "");
        const stream = createAssistantMessageEventStream();
        const finish = () =>
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
        if (supplement !== "none" && contexts.length === 1) {
          releaseFirst = finish;
          started();
        } else {
          finish();
        }
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
      const turn = host.prompt(
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
      if (supplement !== "none") {
        await firstRequest;
        if (supplement === "steerQueuedFollowUp") {
          await host.followUp("task", correction);
          await host.steerQueuedFollowUp("task", 0, [correction]);
        } else {
          await host[supplement]("task", correction);
        }
        releaseFirst!();
      }
      await turn;
      const turnRequests = supplement === "none" ? 1 : 2;
      expect(contexts).toHaveLength(turnRequests);
      expect(
        payloads.findLast((p) => p.type === "turn.completed"),
      ).toMatchObject({
        composerPrediction:
          supplement === "none" ? "Show the tests." : "Show the steps.",
      });
      expect(
        payloads
          .filter((p) => p.type === "message.part.delta")
          .map((p) => p.delta)
          .join(""),
      ).toBe(
        supplement === "none"
          ? "Work completed."
          : "Work completed.Here are the steps.",
      );
      const firstToken = JSON.stringify(contexts[0]!.messages).match(
        /\[Artemis composer prediction ([a-zA-Z0-9-]+)\]/u,
      )?.[1];
      expect(firstToken).toBeDefined();
      const latestContext = contexts.at(-1)!;
      const latestUser = latestContext.messages.findLastIndex(
        (m) => m.role === "user",
      );
      expect(JSON.stringify(latestContext.messages[latestUser])).toContain(
        `[Artemis composer prediction ${firstToken}]`,
      );
      expect(
        JSON.stringify(latestContext.messages.slice(0, latestUser)),
      ).not.toContain("Artemis composer prediction");
      expect(
        JSON.stringify(
          latestContext.messages.filter((m) => m.role === "assistant"),
        ),
      ).not.toContain("artemis-prediction");
      payloads.length = 0;
      await host.prompt("task", "second", "Explain", "work");
      expect(contexts).toHaveLength(turnRequests + 1);
      expect(
        JSON.stringify(
          contexts.at(-1)!.messages.filter((m) => m.role === "assistant"),
        ),
      ).not.toContain("artemis-prediction");
      expect(JSON.stringify(contexts.at(-1)!.messages)).not.toContain(
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
  },
);
