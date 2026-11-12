import { afterEach, expect, it } from "vitest";
import {
  anthropicSession,
  threadRejection,
} from "../fixtures/anthropic/session.js";
const fixtures: Awaited<ReturnType<typeof anthropicSession>>[] = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.dispose();
});
async function fixture() {
  const value = await anthropicSession();
  fixtures.push(value);
  return value;
}

it("sends only new messages after a complete reply and saves upload bytes", async () => {
  const f = await fixture();
  await f.session.prompt("Preserve this context. ".repeat(2000));
  await f.session.prompt("Continue.");
  expect(f.requests).toHaveLength(2);
  expect(f.requests[0]!.thread).toEqual({ type: "create" });
  expect(f.requests[1]!.thread).toEqual({
    type: "continue",
    previous_message_id: "reply-1",
  });
  expect(f.requests[1]!.messages).toHaveLength(1);
  expect(f.requests[1]).not.toHaveProperty("system");
  expect(JSON.stringify(f.requests[1]).length).toBeLessThan(
    JSON.stringify(f.requests[0]).length / 4,
  );
});

it("starts a full new thread after real session compaction", async () => {
  const f = await fixture();
  await f.session.prompt("Earlier requirements. ".repeat(2000));
  await f.session.prompt("More details. ".repeat(500));
  await f.session.compact();
  const compactRequests = f.requests.slice(2);
  expect(compactRequests.length).toBeGreaterThan(0);
  expect(compactRequests.every((request) => request.thread === undefined)).toBe(
    true,
  );
  await f.session.prompt("Continue after compacting.");
  expect(f.requests.at(-1)!.thread).toEqual({ type: "create" });
  expect(JSON.stringify(f.requests.at(-1))).toContain("Summary:");
  await f.session.prompt("Next step.");
  expect(f.requests.at(-1)!.thread?.type).toBe("continue");
});

it.each([
  "thread_not_found",
  "thread_already_continued",
  "thread_fingerprint_mismatch",
])("retries %s with the full conversation exactly once", async (code) => {
  const f = await fixture();
  await f.session.prompt("Important original context.");
  f.controls.respond = (_request, index) =>
    index === 2 ? threadRejection(code) : undefined;
  await f.session.prompt("Continue.");
  expect(f.requests).toHaveLength(3);
  expect(f.requests[1]!.thread?.type).toBe("continue");
  expect(f.requests[2]!.thread).toEqual({ type: "create" });
  expect(JSON.stringify(f.requests[2])).toContain(
    "Important original context.",
  );
  expect(f.requests[2]!.messages).toHaveLength(3);
});

it("falls back after a transport failure without reusing consumed continuation state", async () => {
  const f = await fixture();
  await f.session.prompt("Original context.");
  f.controls.respond = (_request, index) => {
    if (index === 2) throw new TypeError("fetch failed");
    return undefined;
  };
  await f.session.prompt("Continue.");
  expect(f.requests.map((request) => request.thread?.type)).toEqual([
    "create",
    "continue",
    "create",
  ]);
  expect(JSON.stringify(f.requests[2])).toContain("Original context.");
});

it("stops using threads for a session after the endpoint rejects support", async () => {
  const f = await fixture();
  f.controls.respond = (_request, index) =>
    index === 1 ? threadRejection("thread_unsupported_request") : undefined;
  await f.session.prompt("First.");
  await f.session.prompt("Second.");
  expect(f.requests.map((request) => request.thread?.type)).toEqual([
    "create",
    undefined,
    undefined,
  ]);
  expect(f.requests[2]!.messages).toHaveLength(3);
});

it("uses the real session identity so disposal clears continuation state", async () => {
  const f = await fixture();
  await f.session.prompt("Original context.");
  const context = {
    ...f.contexts[0]!,
    messages: [
      ...f.contexts[0]!.messages,
      f.session.messages.at(-1)!,
      { role: "user" as const, content: "Continue.", timestamp: Date.now() },
    ],
  };
  f.session.dispose();
  await f.runtime
    .streamSimple(f.model, context, {
      ...f.streamOptions[0],
      sessionId: f.session.sessionId,
      signal: new AbortController().signal,
    })
    .result();
  expect(f.requests.at(-1)!.thread).toEqual({ type: "create" });
  expect(JSON.stringify(f.requests.at(-1))).toContain("Original context.");
});

it("does not keep a consumed thread after cancellation", async () => {
  const f = await fixture();
  await f.session.prompt("Original context.");
  const controller = new AbortController();
  f.controls.respond = (_request, index) => {
    if (index === 2) {
      controller.abort();
      throw new DOMException("Aborted", "AbortError");
    }
    return undefined;
  };
  const context = {
    ...f.contexts[0]!,
    messages: [
      ...f.contexts[0]!.messages,
      f.session.messages.at(-1)!,
      {
        role: "user" as const,
        content: "Cancel this request.",
        timestamp: Date.now(),
      },
    ],
  };
  const result = await f.runtime
    .streamSimple(f.model, context, {
      ...f.streamOptions[0],
      sessionId: f.session.sessionId,
      signal: controller.signal,
    })
    .result();
  expect(result.stopReason).toBe("aborted");
  await f.session.prompt("Try again after cancellation.");
  expect(f.requests.map((request) => request.thread?.type)).toEqual([
    "create",
    "continue",
    "create",
  ]);
});

it("starts a new full request when tools or the system prompt change", async () => {
  const f = await fixture();
  await f.session.prompt("Original context.");
  const context = {
    ...f.contexts[0]!,
    messages: [
      ...f.contexts[0]!.messages,
      f.session.messages.at(-1)!,
      {
        role: "system" as const,
        content: "New instructions.",
        toolsAdded: [
          {
            name: "new_tool",
            description: "New tool",
            parameters: { type: "object", properties: {} },
          },
        ],
        timestamp: Date.now(),
      },
      { role: "user" as const, content: "Continue.", timestamp: Date.now() },
    ],
  };
  await f.runtime
    .streamSimple(f.model, context, {
      ...f.streamOptions[0],
      sessionId: f.session.sessionId,
      signal: new AbortController().signal,
    })
    .result();
  expect(f.requests.at(-1)!.thread).toEqual({ type: "create" });
  expect(JSON.stringify(f.requests.at(-1))).toContain("New instructions.");
  expect(JSON.stringify(f.requests.at(-1))).toContain("new_tool");
});

it("isolates independent session identities", async () => {
  const first = await fixture();
  const second = await fixture();
  await first.session.prompt("First conversation.");
  await second.session.prompt("Second conversation.");
  await first.session.prompt("Continue first.");
  expect(second.requests[0]!.thread).toEqual({ type: "create" });
  expect(JSON.stringify(second.requests[0])).not.toContain(
    "First conversation.",
  );
  expect(first.requests[1]!.thread).toEqual({
    type: "continue",
    previous_message_id: "reply-1",
  });
});
