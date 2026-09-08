import { describe, expect, it } from "vitest";

import {
  createThreadViewState,
  reduceAgentEvent,
  PROTOCOL_VERSION,
  type AgentPayload,
} from "@artemis/protocol";
import {
  formatWorkedDuration,
  userMessageAttachments,
} from "../src/renderer/turn-timeline.js";

describe("formatWorkedDuration", () => {
  it("formats seconds, minutes, and hours without depending on a live timer", () => {
    expect(formatWorkedDuration(28_999)).toBe("28s");
    expect(formatWorkedDuration(808_000)).toBe("13m 28s");
    expect(formatWorkedDuration(8_008_000)).toBe("2h 13m 28s");
  });
});

describe("persisted user attachments", () => {
  it("restores file and image metadata only beside the owning turn's first user message", () => {
    let state = createThreadViewState("thread");
    let seq = 0;
    const apply = (turnId: string, payload: AgentPayload) => {
      state = reduceAgentEvent(state, {
        protocolVersion: PROTOCOL_VERSION,
        eventId: `event-${++seq}`,
        threadId: "thread",
        turnId,
        seq,
        timestamp: "2026-09-08T00:00:00Z",
        payload,
      });
    };
    apply("one", { type: "user.message", messageId: "first", text: "" });
    apply("one", {
      type: "task.source.added",
      sourceId: "file",
      kind: "file",
      name: "AGENTS.md",
      mimeType: "text/markdown",
    });
    apply("one", {
      type: "task.source.added",
      sourceId: "image",
      kind: "image",
      name: "参考.png",
      mimeType: "image/png",
    });
    apply("one", { type: "user.message", messageId: "steer", text: "继续" });
    apply("two", { type: "user.message", messageId: "second", text: "下一轮" });
    expect(userMessageAttachments(state, "first").map((s) => s.name)).toEqual([
      "AGENTS.md",
      "参考.png",
    ]);
    expect(userMessageAttachments(state, "steer")).toEqual([]);
    expect(userMessageAttachments(state, "second")).toEqual([]);
    expect(userMessageAttachments(state, "missing")).toEqual([]);
  });
});
