import { afterEach, describe, expect, it, vi } from "vitest";

import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type Model,
} from "@earendil-works/pi-ai";

import {
  isConnectionFailure,
  sanitizeModelFailure,
  withConnectionRecovery,
  type ConnectionRecoveryUpdate,
} from "../src/connection-recovery.js";
import {
  PromptCacheController,
  withPromptCacheController,
} from "../src/prompt-cache.js";

const model = {
  id: "test-model",
  name: "Test model",
  api: "openai-responses",
  provider: "test-provider",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000,
  maxTokens: 4_096,
} satisfies Model<Api>;

function message(
  stopReason: AssistantMessage["stopReason"],
  errorMessage?: string,
): AssistantMessage {
  return {
    role: "assistant",
    content: stopReason === "stop" ? [{ type: "text", text: "Recovered" }] : [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    ...(errorMessage ? { errorMessage } : {}),
    timestamp: 0,
  };
}

function eventStream(events: AssistantMessageEvent[]) {
  const stream = createAssistantMessageEventStream();
  queueMicrotask(() => {
    for (const event of events) stream.push(event);
  });
  return stream;
}

async function collect(stream: AsyncIterable<AssistantMessageEvent>) {
  const events: AssistantMessageEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe("connection recovery", () => {
  it("retries a positively identified pre-output connection failure without a finite budget", async () => {
    const failed = message(
      "error",
      "getaddrinfo ENOTFOUND api.example.invalid",
    );
    const recovered = message("stop");
    const streamSimple = vi
      .fn()
      .mockReturnValueOnce(
        eventStream([
          { type: "start", partial: { ...failed, stopReason: "pending" } },
          { type: "error", reason: "error", error: failed },
        ]),
      )
      .mockReturnValueOnce(
        eventStream([
          { type: "start", partial: { ...recovered, stopReason: "pending" } },
          {
            type: "text_delta",
            contentIndex: 0,
            delta: "Recovered",
            partial: recovered,
          },
          { type: "done", reason: "stop", message: recovered },
        ]),
      );
    const updates: ConnectionRecoveryUpdate[] = [];
    const runtime = withConnectionRecovery(
      { streamSimple } as unknown as ModelRuntime,
      (_sessionId, update) => updates.push(update),
      { wait: async () => undefined },
    );

    const events = await collect(
      runtime.streamSimple(model, { messages: [] }, { sessionId: "session-1" }),
    );

    expect(streamSimple).toHaveBeenCalledTimes(2);
    expect(streamSimple.mock.calls[0]?.[2]).toMatchObject({ maxRetries: 0 });
    expect(events.map((event) => event.type)).toEqual([
      "start",
      "text_delta",
      "done",
    ]);
    expect(updates.map((update) => update.phase)).toEqual([
      "reconnecting",
      "recovered",
    ]);
    expect(updates[0]).toMatchObject({ attempt: 1, delayMs: 5_000 });
  });

  it("keeps the real session identity when prompt caching rewrites the provider cache key", async () => {
    const failed = message(
      "error",
      "getaddrinfo ENOTFOUND api.example.invalid",
    );
    const recovered = message("stop");
    const streamSimple = vi
      .fn()
      .mockReturnValueOnce(
        eventStream([
          { type: "start", partial: { ...failed, stopReason: "pending" } },
          { type: "error", reason: "error", error: failed },
        ]),
      )
      .mockReturnValueOnce(
        eventStream([
          { type: "start", partial: { ...recovered, stopReason: "pending" } },
          { type: "done", reason: "stop", message: recovered },
        ]),
      );
    const cache = new PromptCacheController();
    cache.registerSession("real-session", {
      scope: "parent",
      priorTopLevelUserTurns: 1,
    });
    const updates: Array<{
      sessionId: string | undefined;
      update: ConnectionRecoveryUpdate;
    }> = [];
    const runtime = withConnectionRecovery(
      withPromptCacheController(
        { streamSimple } as unknown as ModelRuntime,
        cache,
      ),
      (sessionId, update) => updates.push({ sessionId, update }),
      { wait: async () => undefined },
    );

    await collect(
      runtime.streamSimple(
        model,
        { messages: [] },
        { sessionId: "real-session" },
      ),
    );

    expect(streamSimple.mock.calls[0]?.[2]?.sessionId).not.toBe("real-session");
    expect(updates.map(({ sessionId }) => sessionId)).toEqual([
      "real-session",
      "real-session",
    ]);
  });

  it("caps connection backoff at 60 seconds without a total attempt limit", async () => {
    const failed = message("error", "socket connection was closed");
    const recovered = message("stop");
    let calls = 0;
    const streamSimple = vi.fn(() => {
      calls += 1;
      return calls <= 5
        ? eventStream([
            { type: "start", partial: { ...failed, stopReason: "pending" } },
            { type: "error", reason: "error", error: failed },
          ])
        : eventStream([
            { type: "start", partial: { ...recovered, stopReason: "pending" } },
            { type: "done", reason: "stop", message: recovered },
          ]);
    });
    const delays: number[] = [];
    const runtime = withConnectionRecovery(
      { streamSimple } as unknown as ModelRuntime,
      () => undefined,
      {
        wait: async (delayMs) => {
          delays.push(delayMs);
        },
      },
    );

    await collect(
      runtime.streamSimple(model, { messages: [] }, { sessionId: "session-1" }),
    );

    expect(streamSimple).toHaveBeenCalledTimes(6);
    expect(delays).toEqual([5_000, 10_000, 20_000, 40_000, 60_000]);
  });

  it("retries only the model request and preserves completed tool results in context", async () => {
    const failed = message("error", "fetch failed: ECONNRESET");
    const recovered = message("stop");
    const context = {
      messages: [
        {
          role: "toolResult" as const,
          toolCallId: "write-1",
          toolName: "write",
          content: [{ type: "text" as const, text: "File already written" }],
          isError: false,
          timestamp: 1,
        },
      ],
    };
    const streamSimple = vi
      .fn()
      .mockReturnValueOnce(
        eventStream([
          { type: "start", partial: { ...failed, stopReason: "pending" } },
          { type: "error", reason: "error", error: failed },
        ]),
      )
      .mockReturnValueOnce(
        eventStream([
          { type: "start", partial: { ...recovered, stopReason: "pending" } },
          { type: "done", reason: "stop", message: recovered },
        ]),
      );
    const runtime = withConnectionRecovery(
      { streamSimple } as unknown as ModelRuntime,
      () => undefined,
      { wait: async () => undefined },
    );

    await collect(
      runtime.streamSimple(model, context, { sessionId: "session-1" }),
    );

    expect(streamSimple).toHaveBeenCalledTimes(2);
    expect(streamSimple.mock.calls.map((call) => call[1])).toEqual([
      context,
      context,
    ]);
    expect(context.messages).toHaveLength(1);
    expect(context.messages[0]).toMatchObject({
      role: "toolResult",
      toolCallId: "write-1",
    });
  });

  it("stops reconnecting when cancellation interrupts the backoff", async () => {
    const failed = message("error", "socket connection was closed");
    const streamSimple = vi.fn(() =>
      eventStream([
        { type: "start", partial: { ...failed, stopReason: "pending" } },
        { type: "error", reason: "error", error: failed },
      ]),
    );
    const controller = new AbortController();
    let markWaitStarted!: () => void;
    const waitStarted = new Promise<void>((resolve) => {
      markWaitStarted = resolve;
    });
    const runtime = withConnectionRecovery(
      { streamSimple } as unknown as ModelRuntime,
      () => undefined,
      {
        wait: async (_delayMs, signal) => {
          markWaitStarted();
          await new Promise<void>((_resolve, reject) =>
            signal?.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            }),
          );
        },
      },
    );

    const collecting = collect(
      runtime.streamSimple(
        model,
        { messages: [] },
        { sessionId: "session-1", signal: controller.signal },
      ),
    );
    await waitStarted;
    controller.abort();
    const events = await collecting;

    expect(streamSimple).toHaveBeenCalledTimes(1);
    expect(events.at(-1)).toMatchObject({
      type: "error",
      reason: "aborted",
      error: { errorMessage: "The reconnect wait was cancelled." },
    });
  });

  it("stops instead of replaying after visible output has begun", async () => {
    const failed = message("error", "socket connection was closed");
    const streamSimple = vi.fn().mockReturnValue(
      eventStream([
        { type: "start", partial: { ...failed, stopReason: "pending" } },
        {
          type: "text_delta",
          contentIndex: 0,
          delta: "Partial",
          partial: failed,
        },
        { type: "error", reason: "error", error: failed },
      ]),
    );
    const updates: ConnectionRecoveryUpdate[] = [];
    const runtime = withConnectionRecovery(
      { streamSimple } as unknown as ModelRuntime,
      (_sessionId, update) => updates.push(update),
      { wait: async () => undefined },
    );

    const events = await collect(
      runtime.streamSimple(model, { messages: [] }, { sessionId: "session-1" }),
    );

    expect(streamSimple).toHaveBeenCalledTimes(1);
    expect(updates).toEqual([
      expect.objectContaining({ phase: "interrupted" }),
    ]);
    expect(events.at(-1)).toMatchObject({
      type: "error",
      error: {
        errorMessage: expect.stringContaining("ARTEMIS_STREAM_INTERRUPTED"),
      },
    });
  });

  it("never classifies auth, quota, protocol, or rate limits as a connection", () => {
    expect(isConnectionFailure("401 authentication failed")).toBe(false);
    expect(isConnectionFailure("429 rate limit")).toBe(false);
    expect(isConnectionFailure("insufficient_quota billing")).toBe(false);
    expect(isConnectionFailure("invalid JSON protocol response")).toBe(false);
    expect(isConnectionFailure("fetch failed: EAI_AGAIN")).toBe(true);
  });

  it("leaves rate limits and provider failures to Pi's finite retry budget", async () => {
    for (const errorMessage of ["429 rate limit", "503 service unavailable"]) {
      const failed = message("error", errorMessage);
      const streamSimple = vi.fn(() =>
        eventStream([
          { type: "start", partial: { ...failed, stopReason: "pending" } },
          { type: "error", reason: "error", error: failed },
        ]),
      );
      const updates: ConnectionRecoveryUpdate[] = [];
      const runtime = withConnectionRecovery(
        { streamSimple } as unknown as ModelRuntime,
        (_sessionId, update) => updates.push(update),
        { wait: async () => undefined },
      );

      const events = await collect(
        runtime.streamSimple(
          model,
          { messages: [] },
          { sessionId: "session-1" },
        ),
      );

      expect(streamSimple).toHaveBeenCalledTimes(1);
      expect(updates).toEqual([]);
      expect(events.at(-1)).toMatchObject({
        type: "error",
        error: { errorMessage },
      });
    }
  });

  it("redacts provider URLs, credentials, headers, and local paths", () => {
    expect(
      sanitizeModelFailure(
        "401 https://api.example.test/v1?key=secret Authorization: Bearer abc.def /Users/alice/project Cookie: session=private",
      ),
    ).toBe("401 [URL] Authorization: [REDACTED]");
  });
});

describe("bounded idle stream recovery", () => {
  afterEach(() => vi.useRealTimers());

  it("retries only the silent request twice with the same context and 5/10 second delays", async () => {
    vi.useFakeTimers();
    const context = { messages: [] };
    const recovered = message("stop");
    const streamSimple = vi
      .fn()
      .mockImplementationOnce(() => createAssistantMessageEventStream())
      .mockImplementationOnce(() => createAssistantMessageEventStream())
      .mockImplementationOnce(() =>
        eventStream([{ type: "done", reason: "stop", message: recovered }]),
      );
    const updates: ConnectionRecoveryUpdate[] = [];
    const wait = vi.fn(async (_delayMs: number) => undefined);
    const runtime = withConnectionRecovery(
      { streamSimple } as unknown as ModelRuntime,
      (_, update) => updates.push(update),
      { idleTimeoutMs: 20, wait },
    );
    const collected = collect(runtime.streamSimple(model, context));
    await vi.advanceTimersByTimeAsync(40);
    expect((await collected).at(-1)?.type).toBe("done");
    expect(streamSimple).toHaveBeenCalledTimes(3);
    expect(streamSimple.mock.calls.every((call) => call[1] === context)).toBe(
      true,
    );
    expect(wait.mock.calls.map((call) => call[0])).toEqual([5000, 10000]);
    expect(
      updates.filter((update) => update.phase === "reconnecting"),
    ).toMatchObject([
      { kind: "stream-stalled", attempt: 1, maxAttempts: 2 },
      { kind: "stream-stalled", attempt: 2, maxAttempts: 2 },
    ]);
    expect(streamSimple.mock.calls[0]?.[2].signal.aborted).toBe(true);
  });

  it("stops after two retries and tells the user exactly where to change models", async () => {
    vi.useFakeTimers();
    const streamSimple = vi.fn(() => createAssistantMessageEventStream());
    const runtime = withConnectionRecovery(
      { streamSimple } as unknown as ModelRuntime,
      () => undefined,
      { idleTimeoutMs: 20, wait: async () => undefined },
    );
    const collected = collect(runtime.streamSimple(model, { messages: [] }));
    await vi.advanceTimersByTimeAsync(60);
    const events = await collected;
    expect(streamSimple).toHaveBeenCalledTimes(3);
    expect(events.at(-1)).toMatchObject({
      type: "error",
      error: {
        errorMessage: expect.stringContaining(
          "model selector at the bottom right of the composer",
        ),
      },
    });
  });

  it("does not retry after partial output", async () => {
    vi.useFakeTimers();
    const partial = message("stop");
    const streamSimple = vi.fn(() =>
      eventStream([
        { type: "text_delta", contentIndex: 0, delta: "Partial", partial },
      ]),
    );
    const runtime = withConnectionRecovery(
      { streamSimple } as unknown as ModelRuntime,
      () => undefined,
      { idleTimeoutMs: 20 },
    );
    const collected = collect(runtime.streamSimple(model, { messages: [] }));
    await vi.advanceTimersByTimeAsync(20);
    expect((await collected).at(-1)).toMatchObject({
      type: "error",
      error: {
        errorMessage: expect.stringContaining("ARTEMIS_STREAM_INTERRUPTED"),
      },
    });
    expect(streamSimple).toHaveBeenCalledTimes(1);
  });

  it("renews request idleness on nonempty streamed deltas", async () => {
    vi.useFakeTimers();
    const source = createAssistantMessageEventStream();
    const partial = message("stop");
    const runtime = withConnectionRecovery(
      { streamSimple: () => source } as unknown as ModelRuntime,
      () => undefined,
      { idleTimeoutMs: 20 },
    );
    const collected = collect(runtime.streamSimple(model, { messages: [] }));
    for (let index = 0; index < 3; index++) {
      await vi.advanceTimersByTimeAsync(15);
      source.push({ type: "text_delta", contentIndex: 0, delta: "x", partial });
      await vi.advanceTimersByTimeAsync(0);
    }
    source.push({ type: "done", reason: "stop", message: partial });
    expect((await collected).at(-1)?.type).toBe("done");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels a silent provider immediately even when it ignores its abort signal", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const streamSimple = vi.fn(() => createAssistantMessageEventStream());
    const runtime = withConnectionRecovery(
      { streamSimple } as unknown as ModelRuntime,
      () => undefined,
      { idleTimeoutMs: 20 },
    );
    const collected = collect(
      runtime.streamSimple(
        model,
        { messages: [] },
        { signal: controller.signal },
      ),
    );
    controller.abort();
    expect((await collected).at(-1)).toMatchObject({
      type: "error",
      reason: "aborted",
    });
    expect(streamSimple).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
