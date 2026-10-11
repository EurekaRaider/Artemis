import { describe, expect, it } from "vitest";
import {
  ComposerPredictionParser,
  composerPredictionMarker,
  stripComposerPrediction,
  PiAdapter,
  turnCompletedPayloadSchema,
  type AgentPayload,
} from "../src/index.js";

const token = "test-turn";
const marker = composerPredictionMarker(token);
const suffix = `${marker}{"suggestion":"请补充测试。"}</artemis-prediction>`;
const full = `Finished.\n${suffix}`;
function body(events: AgentPayload[]) {
  return events
    .flatMap((e) => (e.type === "message.part.delta" ? [e.delta] : []))
    .join("");
}
function end(adapter: PiAdapter, text: string, stopReason = "stop") {
  return adapter.adapt({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
      stopReason,
    },
  });
}

describe("composer prediction suffix", () => {
  it("handles every possible stream split without exposing metadata", () => {
    for (let split = 0; split <= full.length; split++) {
      const parser = new ComposerPredictionParser(marker);
      const visible =
        parser.push(full.slice(0, split)) +
        parser.push(full.slice(split)) +
        parser.finish();
      expect(visible).toBe("Finished.\n");
      expect(parser.suggestion).toBe("请补充测试。");
    }
  });
  it("streams ordinary text immediately and preserves partial lookalikes", () => {
    const parser = new ComposerPredictionParser(marker);
    expect(parser.push("Hello")).toBe("Hello");
    expect(parser.push("\n<artemis-prediction:other>example")).toBe(
      "\n<artemis-prediction:other>example",
    );
    expect(parser.push("\n<artemis-") + parser.finish()).toBe("\n<artemis-");
  });
  it.each([
    "broken",
    '{"suggestion":""}',
    JSON.stringify({ suggestion: "x".repeat(121) }),
    '{"suggestion":"line\\nbreak"}',
    '{"suggestion":5}',
  ])("hides invalid metadata: %s", (raw) => {
    const parser = new ComposerPredictionParser(marker);
    expect(
      parser.push(`Answer${marker}${raw}</artemis-prediction>`) +
        parser.finish(),
    ).toBe("Answer");
    expect(parser.suggestion).toBeUndefined();
  });
  it("bounds malformed tails and resumes visible text after their terminator", () => {
    const parser = new ComposerPredictionParser(marker);
    expect(parser.push(`Answer${marker}`)).toBe("Answer");
    for (let i = 0; i < 100; i++)
      expect(parser.push("x".repeat(1024))).toBe("");
    expect(parser.push("</artemis-prediction>\nMore answer.")).toBe(
      "\nMore answer.",
    );
    expect(parser.suggestion).toBeUndefined();
  });
  it("ignores incomplete suffixes and invalidates a nonterminal candidate", () => {
    expect(stripComposerPrediction(`Answer${marker}{`, token)).toBe("Answer");
    const parser = new ComposerPredictionParser(marker);
    parser.push(suffix);
    expect(parser.push("More text")).toBe("More text");
    expect(parser.suggestion).toBeUndefined();
  });
  it("counts unicode characters instead of UTF-16 units", () => {
    const parser = new ComposerPredictionParser(marker);
    parser.push(
      `${marker}${JSON.stringify({ suggestion: "😀".repeat(120) })}</artemis-prediction>`,
    );
    expect(Array.from(parser.suggestion!)).toHaveLength(120);
  });
  it("keeps old completion records compatible", () => {
    expect(
      turnCompletedPayloadSchema.parse({
        type: "turn.completed",
        reason: "completed",
      }),
    ).toEqual({ type: "turn.completed", reason: "completed" });
  });
});

describe("prediction at the Pi boundary", () => {
  it("does not treat a metadata-only response as a valid prediction", () => {
    const adapter = new PiAdapter("turn", token);
    expect(body(end(adapter, suffix))).toBe("");
    expect(adapter.adapt({ type: "agent_settled" })[0]).not.toHaveProperty(
      "composerPrediction",
    );
  });
  it("emits only on settlement and removes streamed and complete metadata", () => {
    for (const streaming of [true, false]) {
      const adapter = new PiAdapter("turn", token);
      const events: AgentPayload[] = [];
      if (streaming)
        for (const delta of full)
          events.push(
            ...adapter.adapt({
              type: "message_update",
              assistantMessageEvent: { type: "text_delta", delta },
            }),
          );
      events.push(...end(adapter, full));
      expect(body(events)).toBe("Finished.\n");
      expect(events.some((e) => "composerPrediction" in e)).toBe(false);
      expect(adapter.adapt({ type: "agent_end" })).toEqual([]);
      expect(adapter.adapt({ type: "agent_settled" })).toEqual([
        {
          type: "turn.completed",
          reason: "completed",
          finalPartId: "turn:text",
          composerPrediction: "请补充测试。",
        },
      ]);
    }
  });
  it("does not promote intermediate replies to predictions", () => {
    const adapter = new PiAdapter("turn", token);
    end(adapter, full, "toolUse");
    adapter.adapt({ type: "tool_execution_start", toolName: "read" });
    end(adapter, "Final reply without a suggestion");
    expect(adapter.adapt({ type: "agent_settled" })[0]).not.toHaveProperty(
      "composerPrediction",
    );
  });
  it.each(["aborted", "error", "length"])(
    "does not suggest after %s",
    (reason) => {
      const adapter = new PiAdapter("turn", token);
      expect(body(end(adapter, full, reason))).toBe("Finished.\n");
      expect(
        adapter
          .adapt({ type: "agent_settled" })
          .some((e) => "composerPrediction" in e),
      ).toBe(false);
    },
  );
  it.each(["submit_plan", "request_user_input"])(
    "suppresses predictions after %s",
    (toolName) => {
      const adapter = new PiAdapter("turn", token);
      adapter.adapt({ type: "tool_execution_start", toolName });
      end(adapter, full);
      expect(adapter.adapt({ type: "agent_settled" })[0]).not.toHaveProperty(
        "composerPrediction",
      );
    },
  );
  it("replaces an earlier prediction after follow-up queue/steering messages", () => {
    const adapter = new PiAdapter("turn", token);
    adapter.adapt({
      type: "message_start",
      message: { role: "user", content: "Initial" },
    });
    end(adapter, full);
    for (const content of ["Queued message", "Latest correction"])
      adapter.adapt({
        type: "message_start",
        message: { role: "user", content },
      });
    end(
      adapter,
      `Updated answer.${marker}{"suggestion":"请解释步骤。"}</artemis-prediction>`,
    );
    expect(adapter.adapt({ type: "agent_settled" })[0]).toMatchObject({
      composerPrediction: "请解释步骤。",
    });
  });
  it("does not reuse an earlier prediction when the latest reply omits it", () => {
    const adapter = new PiAdapter("turn", token);
    adapter.adapt({
      type: "message_start",
      message: { role: "user", content: "Initial" },
    });
    end(adapter, full);
    adapter.adapt({
      type: "message_start",
      message: { role: "user", content: "Latest correction" },
    });
    end(adapter, "Updated answer without a suggestion.");
    expect(adapter.adapt({ type: "agent_settled" })[0]).not.toHaveProperty(
      "composerPrediction",
    );
  });
});
