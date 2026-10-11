import { expect, it, vi } from "vitest";
import type { Context, Model, Api } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  composerPredictionInstruction,
  composerPredictionMarker,
} from "@artemis/protocol";
import {
  withoutComposerPredictions,
  withComposerPredictionContext,
} from "../../src/context/composer-prediction.js";

it("cleans only host-marked assistant text and preserves original records and signatures", () => {
  const suffix = `${composerPredictionMarker("turn-test")}{"suggestion":"Next"}</artemis-prediction>`;
  const messages: Context["messages"] = [
    {
      role: "user",
      content: "Do work" + composerPredictionInstruction("turn-test"),
      timestamp: 1,
    },
    {
      role: "assistant",
      content: [
        { type: "text", text: "Answer" + suffix },
        {
          type: "thinking",
          thinking: "reason",
          thinkingSignature: "signature",
        },
      ],
      api: "openai-completions",
      provider: "test",
      model: "test",
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: 2,
    },
    {
      role: "toolResult",
      toolCallId: "call",
      toolName: "read",
      content: [{ type: "text", text: suffix }],
      isError: false,
      timestamp: 3,
    },
  ];
  const before = structuredClone(messages);
  const cleaned = withoutComposerPredictions(messages);
  expect(cleaned[1]!.content[0]).toEqual({ type: "text", text: "Answer" });
  expect(cleaned[1]!.content[1]).toEqual(messages[1]!.content[1]);
  expect(cleaned[2]).toBe(messages[2]);
  expect(messages).toEqual(before);
  expect(withoutComposerPredictions(messages.slice(1))).toEqual(
    messages.slice(1),
  );
  expect(cleaned[0]!.content).toBe("Do work");
});

it.each([false, true])(
  "refreshes only the active session's instruction on the latest user message (structured: %s)",
  (structured) => {
    const instruction = composerPredictionInstruction("current-turn");
    const latest = "Explain the steps instead of running them.";
    const messages: Context["messages"] = [
      {
        role: "user",
        content: "Old request" + composerPredictionInstruction("old-turn"),
        timestamp: 1,
      },
      {
        role: "user",
        content: "Initial request" + instruction,
        timestamp: 2,
      },
      {
        role: "user",
        content: structured
          ? [
              { type: "text", text: latest },
              { type: "image", data: "image-data", mimeType: "image/png" },
            ]
          : latest,
        timestamp: 3,
      },
    ];
    const before = structuredClone(messages);
    const stream = vi.fn();
    const runtime = withComposerPredictionContext(
      { streamSimple: stream } as unknown as ModelRuntime,
      (sessionId) => (sessionId === "active" ? "current-turn" : undefined),
    );
    const model = {} as Model<Api>;
    const options = { sessionId: "active" };
    runtime.streamSimple(model, { messages }, options);
    const projected = stream.mock.calls[0]![1] as Context;
    expect(projected.messages[0]!.content).toBe("Old request");
    expect(projected.messages[1]!.content).toBe("Initial request");
    expect(projected.messages[2]!.content).toEqual(
      structured
        ? [...before[2]!.content, { type: "text", text: instruction }]
        : latest + instruction,
    );
    expect(stream.mock.calls[0]![2]).toBe(options);
    runtime.streamSimple(model, projected, options);
    expect(stream.mock.calls[1]![1]).toEqual(projected);
    runtime.streamSimple(model, projected, { sessionId: "other" });
    expect(JSON.stringify(stream.mock.calls[2]![1])).not.toContain(
      "Artemis composer prediction",
    );
    expect(messages).toEqual(before);
  },
);
