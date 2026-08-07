import { SessionManager } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import {
  omitReasoningFromSession,
  withoutPersistedReasoning,
} from "../src/reasoning-persistence.js";

type PersistedMessage = Parameters<SessionManager["appendMessage"]>[0];

function assistantMessage(): Extract<PersistedMessage, { role: "assistant" }> {
  return {
    role: "assistant",
    content: [
      {
        type: "thinking",
        thinking: "private chain of thought",
        thinkingSignature: "opaque-signature",
      },
      { type: "text", text: "Visible answer" },
      {
        type: "toolCall",
        id: "tool-1",
        name: "read",
        arguments: { path: "README.md" },
      },
    ],
    api: "openai-responses",
    provider: "openai",
    model: "gpt-5",
    usage: {
      input: 1,
      output: 2,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 3,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "toolUse",
    timestamp: Date.now(),
  };
}

describe("Pi reasoning persistence", () => {
  it("removes thinking blocks without mutating the live assistant message", () => {
    const message = assistantMessage();
    const sanitized = withoutPersistedReasoning(message);

    expect(sanitized.content).toEqual([
      { type: "text", text: "Visible answer" },
      {
        type: "toolCall",
        id: "tool-1",
        name: "read",
        arguments: { path: "README.md" },
      },
    ]);
    expect(message.content[0]).toMatchObject({
      type: "thinking",
      thinking: "private chain of thought",
    });
  });

  it("writes no thinking content into the Pi session entry", () => {
    const manager = omitReasoningFromSession(
      SessionManager.inMemory("/workspace"),
    );
    manager.appendMessage(assistantMessage());

    const entry = manager.getLeafEntry();
    expect(entry?.type).toBe("message");
    if (entry?.type !== "message" || entry.message.role !== "assistant") return;
    expect(entry.message.content).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "thinking" })]),
    );
    expect(entry.message.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "text", text: "Visible answer" }),
      ]),
    );
  });
});
