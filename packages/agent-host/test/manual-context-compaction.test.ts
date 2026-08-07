import { describe, expect, it, vi } from "vitest";

import { ArtemisAgentHost } from "../src/runtime.js";

describe("manual context compaction", () => {
  it("compacts the open idle Pi session with optional summary instructions", async () => {
    const compact = vi.fn().mockResolvedValue({});
    const host = new ArtemisAgentHost(
      {
        async request() {
          throw new Error("compaction must not execute tools");
        },
      },
      { emit() {} },
    );
    const threads = (
      host as unknown as {
        threads: Map<
          string,
          {
            compacting: boolean;
            currentTurnId: string | undefined;
            session: { compact: typeof compact };
          }
        >;
      }
    ).threads;
    threads.set("thread-1", {
      compacting: false,
      currentTurnId: undefined,
      session: { compact },
    });

    await host.compact("thread-1", "Preserve the current implementation state");

    expect(compact).toHaveBeenCalledWith(
      "Preserve the current implementation state",
    );
    expect(threads.get("thread-1")?.compacting).toBe(false);
  });

  it("does not interrupt an active Pi turn to compact", async () => {
    const compact = vi.fn().mockResolvedValue({});
    const host = new ArtemisAgentHost({ async request() {} }, { emit() {} });
    (
      host as unknown as {
        threads: Map<string, unknown>;
      }
    ).threads.set("thread-1", {
      compacting: false,
      currentTurnId: "turn-1",
      session: { compact },
    });

    await expect(host.compact("thread-1")).rejects.toThrow("active turn");
    expect(compact).not.toHaveBeenCalled();
  });
});

describe("context usage updates", () => {
  it("refreshes after every Pi turn and publishes the compaction estimate", () => {
    const emit = vi.fn();
    const host = new ArtemisAgentHost({ async request() {} }, { emit });
    const getContextUsage = vi
      .fn()
      .mockReturnValueOnce({
        tokens: 96_000,
        contextWindow: 128_000,
        percent: 75,
      })
      .mockReturnValueOnce({
        tokens: null,
        contextWindow: 128_000,
        percent: null,
      });
    const hosted = {
      threadId: "thread-1",
      currentTurnId: "turn-1",
      session: {
        getContextUsage,
        model: { contextWindow: 128_000 },
      },
    };
    const handleContextUsageEvent = (
      host as unknown as {
        handleContextUsageEvent(hosted: unknown, event: unknown): void;
      }
    ).handleContextUsageEvent.bind(host);

    handleContextUsageEvent(hosted, { type: "turn_end" });
    expect(emit).toHaveBeenLastCalledWith("thread-1", "turn-1", {
      type: "context.usage",
      tokens: 96_000,
      contextWindow: 128_000,
      compacting: false,
    });

    handleContextUsageEvent(hosted, {
      type: "compaction_end",
      result: { estimatedTokensAfter: 31_500 },
    });
    expect(emit).toHaveBeenLastCalledWith("thread-1", "turn-1", {
      type: "context.usage",
      tokens: 31_500,
      contextWindow: 128_000,
      compacting: false,
      estimated: true,
    });
  });
});
