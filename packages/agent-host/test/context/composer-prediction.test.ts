import { expect, it } from "vitest";
import type { Context } from "@earendil-works/pi-ai";
import {
  composerPredictionInstruction,
  composerPredictionMarker,
} from "@artemis/protocol";
import { withoutComposerPredictions } from "../../src/context/composer-prediction.js";

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
});
