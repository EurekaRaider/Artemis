import { convertMessages } from "@earendil-works/pi-ai/api/openai-completions";
import { describe, expect, it, vi } from "vitest";
import type { Context } from "@earendil-works/pi-ai";
import { repairToolHistory, withToolHistory } from "../src/tool-history.js";

type Message = Context["messages"][number];
const assistant = (stopReason = "toolUse", id = "shell:0"): Message =>
  ({
    role: "assistant",
    provider: "fixture",
    api: "openai-completions",
    model: "fixture",
    content: [
      {
        type: "toolCall",
        id,
        name: "shell",
        arguments: { command: "fixture" },
      },
    ],
    stopReason,
    timestamp: 0,
  }) as Message;
const result = (id = "shell:0"): Message => ({
  role: "toolResult",
  toolCallId: id,
  toolName: "shell",
  content: [{ type: "text", text: "Already executed" }],
  isError: false,
  timestamp: 1,
});

describe("request tool history", () => {
  it("keeps executed calls from aborted responses paired without mutating saved history", () => {
    const original = [assistant("aborted"), result()];
    const before = structuredClone(original);
    const repaired = repairToolHistory(original);
    expect(repaired[0]).toMatchObject({
      role: "assistant",
      stopReason: "toolUse",
    });
    expect(repaired[1]).toEqual(result());
    expect(original).toEqual(before);
  });
  it("deduplicates results per assistant turn, not across reused IDs", () => {
    const repaired = repairToolHistory([
      assistant(),
      result(),
      result(),
      assistant(),
      result(),
    ]);
    expect(repaired.filter((m) => m.role === "toolResult")).toHaveLength(2);
  });
  it("preserves orphan output as non-executable evidence", () => {
    const repaired = repairToolHistory([result()]);
    expect(repaired[0]).toMatchObject({ role: "user" });
    expect(JSON.stringify(repaired)).toContain("Already executed");
    expect(repaired.some((m) => m.role === "toolResult")).toBe(false);
  });
  it("preserves orphan images as images instead of inflating them into base64 text", () => {
    const image = {
      type: "image" as const,
      data: "fixture-base64",
      mimeType: "image/png",
    };
    const orphan = { ...result(), content: [image] } as Message;
    const repaired = repairToolHistory([orphan]);
    expect(repaired[0]?.content).toContainEqual(image);
    expect(JSON.stringify((repaired[0]?.content as any[])[0])).not.toContain(
      "fixture-base64",
    );
  });
  it("does not replay incomplete aborted calls", () => {
    expect(repairToolHistory([assistant("aborted")])).toEqual([]);
  });
  it("retains normal unanswered calls for Pi to close and is idempotent", () => {
    const source = [assistant(), result(), result()];
    const repaired = repairToolHistory(source);
    expect(repairToolHistory(repaired)).toEqual(repaired);
    expect(repairToolHistory([assistant()])).toEqual([assistant()]);
  });
  it("produces paired OpenAI-compatible wire messages after Pi conversion", () => {
    const model = {
      id: "fixture",
      provider: "fixture",
      api: "openai-completions",
      input: ["text"],
    } as any;
    for (const messages of [
      [assistant("aborted"), result()],
      [assistant(), result(), result()],
      [result()],
      [assistant(), result(), assistant(), result()],
    ]) {
      const wire = convertMessages(
        model,
        { messages: repairToolHistory(messages) },
        {} as any,
      );
      let pending = new Set<string>();
      for (const message of wire) {
        if (message.role === "assistant")
          pending = new Set(message.tool_calls?.map((call) => call.id) ?? []);
        if (message.role === "tool") {
          expect(pending.delete(message.tool_call_id)).toBe(true);
        }
      }
      expect(pending.size).toBe(0);
    }
  });
  it("repairs the actual runtime request", () => {
    const streamSimple = vi.fn();
    const runtime = withToolHistory({ streamSimple } as any);
    runtime.streamSimple({} as any, {
      messages: [assistant(), result(), result()],
    });
    expect(streamSimple.mock.calls[0][1].messages).toHaveLength(2);
  });
});
