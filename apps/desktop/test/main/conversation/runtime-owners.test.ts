import { createGoalRuntime } from "../../../src/main/conversation/goal-runtime.js";
import { createTurnControl } from "../../../src/main/conversation/turn-control.js";
import { createSessionRuntime } from "../../../src/main/conversation/session-runtime.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isExecutionMode } from "@artemis/protocol";

afterEach(() => vi.useRealTimers());
describe("task runtime boundaries", () => {
  it("rejects a second concurrent start and releases the reservation on failure", async () => {
    const pending = Promise.withResolvers<never>();
    const release = vi.fn();
    const services = {
      preparingUpdate: false,
      shuttingDown: false,
      cleaningWorktreeThreads: new Set(),
      startingTurns: new Set(),
      imService: { reserveStart: vi.fn(() => release) },
      startTaskTurnUnchecked: vi.fn(() => pending.promise),
    };
    const start = createTurnControl(services as never).startTaskTurn;
    const first = start({ threadId: "t", mode: "work" }, { origin: "desktop" });
    const failure = expect(first).rejects.toThrow("failed");
    await expect(start({ threadId: "t", mode: "work" })).rejects.toThrow(
      "already starting",
    );
    expect(services.startTaskTurnUnchecked).toHaveBeenCalledOnce();
    expect(services.imService.reserveStart).toHaveBeenCalledWith(
      "t",
      "work",
      false,
    );
    pending.reject(new Error("failed"));
    await failure;
    expect(release).toHaveBeenCalledOnce();
    expect(services.startingTurns.size).toBe(0);
  });
  it.each(["preparingUpdate", "shuttingDown"])(
    "denies starts during %s before reserving or dispatching",
    async (flag) => {
      const reserveStart = vi.fn();
      const dispatch = vi.fn();
      const start = createTurnControl({
        preparingUpdate: false,
        shuttingDown: false,
        [flag]: true,
        imService: { reserveStart },
        startTaskTurnUnchecked: dispatch,
      } as never).startTaskTurn;
      await expect(start({ threadId: "t", mode: "work" })).rejects.toThrow(
        "preparing to exit",
      );
      expect(reserveStart).not.toHaveBeenCalled();
      expect(dispatch).not.toHaveBeenCalled();
    },
  );
  it("deduplicates session opening while optional capabilities are still initializing", async () => {
    const ready = Promise.withResolvers<void>();
    const services = {
      optionalCapabilitiesReady: ready.promise,
      openedThreads: new Set(),
      openingThreads: new Map(),
      store: { updateThread: vi.fn() },
      agentProcess: {
        request: vi.fn(async () => ({ sessionFile: "/session" })),
      },
      imService: undefined,
      randomUUID: () => "request",
    };
    const open = createSessionRuntime(services as never).openAgentThread;
    const thread = {
      id: "t",
      target: "local",
      modelSelection: { providerId: "provider", modelId: "model" },
      contextWindow: 1000,
    };
    const first = open(thread, "/workspace");
    const second = open(thread, "/workspace");
    expect(services.agentProcess.request).not.toHaveBeenCalled();
    ready.resolve();
    await Promise.all([first, second]);
    expect(services.agentProcess.request).toHaveBeenCalledOnce();
    expect(services.openedThreads.has("t")).toBe(true);
    expect(services.openingThreads.size).toBe(0);
    await open(thread, "/workspace");
    expect(services.agentProcess.request).toHaveBeenCalledOnce();
  });
  it("uses current Goal state when a deduplicated continuation timer fires", async () => {
    vi.useFakeTimers();
    const thread = {
      id: "t",
      mode: "work",
      goal: { goalId: "g", status: "active" },
    };
    const services = {
      scheduledGoalContinuations: new Set(),
      store: { getThread: () => thread, plans: () => [] },
      agentProcess: {},
      imService: undefined,
      activeTurns: new Map(),
      compactingThreads: new Set(),
      cancellingTurns: new Set(),
      pendingApprovals: { hasWhere: () => false },
      pendingUserInputs: { hasWhere: () => false },
      pendingMultiUserInputs: { hasWhere: () => false },
      startTaskTurn: vi.fn(async () => undefined),
      isExecutionMode,
    };
    const schedule = createGoalRuntime(
      services as never,
    ).scheduleGoalContinuation;
    schedule("t", "g", 50);
    schedule("t", "g", 50);
    thread.goal.status = "paused";
    await vi.advanceTimersByTimeAsync(50);
    expect(services.startTaskTurn).not.toHaveBeenCalled();
    expect(services.scheduledGoalContinuations.size).toBe(0);
    thread.goal.status = "active";
    schedule("t", "g", 50);
    schedule("t", "g", 50);
    await vi.advanceTimersByTimeAsync(50);
    expect(services.startTaskTurn).toHaveBeenCalledOnce();
    expect(services.startTaskTurn).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "t" }),
      { source: "goal-continuation", expectedGoalId: "g" },
    );
  });
});
