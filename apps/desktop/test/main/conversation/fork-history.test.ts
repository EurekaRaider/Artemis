import { describe, expect, it } from "vitest";
import {
  PROTOCOL_VERSION,
  type AgentEvent,
  type AgentPayload,
} from "@artemis/protocol";
import { historicalForkBoundary } from "../../../src/main/conversation/fork-history.js";
const event = (
  seq: number,
  payload: AgentPayload,
  turnId = "first",
): AgentEvent => ({
  protocolVersion: PROTOCOL_VERSION,
  eventId: `e${seq}`,
  threadId: "source",
  turnId,
  seq,
  timestamp: "2026-11-15T00:00:00.000Z",
  payload,
});
const history = [
  event(1, { type: "turn.started", mode: "work" }),
  event(2, {
    type: "message.part.delta",
    partId: "answer:text",
    partType: "text",
    delta: "First answer",
  }),
  event(3, {
    type: "turn.completed",
    reason: "completed",
    finalPartId: "answer:text",
    sessionEntryId: "pi-entry",
  }),
  event(
    4,
    {
      type: "message.part.delta",
      partId: "later:text",
      partType: "text",
      delta: "Later answer",
    },
    "later",
  ),
];
describe("historical fork boundary", () => {
  it("uses the completed reply's persisted position and excludes future events", () => {
    expect(
      historicalForkBoundary("source", history, { turnId: "first" }),
    ).toMatchObject({
      throughSeq: 3,
      entryId: "pi-entry",
      assistantText: "First answer",
    });
  });
  it("rejects foreign, unfinished, and mismatched boundaries before mutations", () => {
    for (const target of [
      { turnId: "later" },
      { turnId: "missing" },
      { turnId: "first", entryId: "other" },
    ])
      expect(() => historicalForkBoundary("source", history, target)).toThrow();
    expect(() =>
      historicalForkBoundary("other", history, { turnId: "first" }),
    ).toThrow();
  });
  it("retains a legacy reply as an exact-match candidate without inventing an entry ID", () => {
    const legacy = history.map((e) =>
      e.payload.type === "turn.completed"
        ? { ...e, payload: { ...e.payload, sessionEntryId: undefined } }
        : e,
    );
    expect(
      historicalForkBoundary("source", legacy, { turnId: "first" }).entryId,
    ).toBeUndefined();
  });
});
