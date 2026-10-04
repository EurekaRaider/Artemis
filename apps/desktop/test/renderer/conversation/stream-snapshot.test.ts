import { expect, it } from "vitest";
import type { AgentEvent } from "@artemis/protocol";
import { appendLiveEvents } from "../../../src/renderer/conversation/stream-snapshot.js";
const event = (id: string, seq: number) =>
  ({
    eventId: id,
    seq,
    threadId: "thread",
    payload: {
      type: "message.part.delta",
      partId: "p",
      partType: "text",
      delta: id,
    },
  }) as AgentEvent;
it("retains identity for duplicate batches and first-seen order for delayed events", () => {
  const existing = [event("a", 1), event("c", 3)];
  expect(appendLiveEvents(existing, [event("a", 1), event("c", 3)])).toBe(
    existing,
  );
  const result = appendLiveEvents(existing, [
    event("b", 2),
    event("b", 2),
    event("d", 4),
  ]);
  expect(result.map((e) => e.eventId)).toEqual(["a", "c", "b", "d"]);
  expect(existing).toHaveLength(2);
});
it("does not mutate snapshots when React replays a batch", () => {
  const existing = [event("a", 1)];
  const incoming = [event("b", 2), event("c", 3)];
  expect(appendLiveEvents(existing, incoming)).toEqual(
    appendLiveEvents(existing, incoming),
  );
  expect(existing).toHaveLength(1);
});
