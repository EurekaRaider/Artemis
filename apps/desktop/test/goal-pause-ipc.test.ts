import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { threadCommandSchema } from "@artemis/protocol";
import { describe, expect, it, vi } from "vitest";

const main = readFileSync(
  new URL("../src/main/main.ts", import.meta.url),
  "utf8",
);
const pauseStart = main.indexOf("  ipcMain.handle(\n    IPC.threadGoalPause,");
const pauseEnd = main.indexOf(
  "  ipcMain.handle(IPC.threadGoalResume,",
  pauseStart,
);
const cancelStart = main.indexOf("async function cancelTaskTurn(");
const cancelEnd = main.indexOf(
  "async function cancelLocalTaskTurn(",
  cancelStart,
);
const continuationStart = main.indexOf(
  "async function cancelRunningGoalContinuation(",
);
const continuationEnd = main.indexOf(
  "function registerIpc()",
  continuationStart,
);

function fixture(source?: "user" | "goal-continuation") {
  let handler: (_event: unknown, threadId: string) => Promise<unknown>;
  const goal = { status: "active" };
  const cancelLocalTaskTurn = vi.fn(async () => {
    expect(goal.status).toBe("paused");
  });
  const scope = {
    IPC: { threadGoalPause: "pause" },
    ipcMain: {
      handle: (_name: string, value: typeof handler) => {
        handler = value;
      },
    },
    parseThreadCommand: (command: unknown) =>
      threadCommandSchema.parse(command),
    store: {
      pauseThreadGoal: vi.fn(() => {
        goal.status = "paused";
        return goal;
      }),
      getThread: () => ({ id: "thread", goal }),
    },
    emitGoalUpdated: vi.fn(),
    activeTurns: new Map(source ? [["thread", "turn"]] : []),
    goalTurnContexts: new Map(source ? [["turn", { source }]] : []),
    cancelLocalTaskTurn,
    imService: {
      cancelOperations: vi.fn(),
      cancelThreadDelegations: vi.fn(async () => {}),
    },
  };
  new Function(
    ...Object.keys(scope),
    transformSync(
      main.slice(cancelStart, cancelEnd) +
        main.slice(continuationStart, continuationEnd) +
        main.slice(pauseStart, pauseEnd),
      { loader: "ts" },
    ).code,
  )(...Object.values(scope));
  return { run: () => handler(undefined, "thread"), scope, goal };
}

describe("Goal pause IPC", () => {
  it.each(["user", "goal-continuation"] as const)(
    "stops the active %s turn after persisting pause",
    async (source) => {
      const f = fixture(source);
      await f.run();
      expect(f.scope.cancelLocalTaskTurn).toHaveBeenCalledWith("thread");
      expect(f.scope.imService.cancelThreadDelegations).toHaveBeenCalledWith(
        "thread",
      );
      expect(f.goal.status).toBe("paused");
    },
  );

  it("pauses an idle task and cancels outstanding delegations without a local turn", async () => {
    const f = fixture();
    await expect(f.run()).resolves.toMatchObject({
      goal: { status: "paused" },
    });
    expect(f.scope.cancelLocalTaskTurn).not.toHaveBeenCalled();
    expect(f.scope.imService.cancelThreadDelegations).toHaveBeenCalledWith(
      "thread",
    );
  });

  it("waits for cancellation and reports a stop failure", async () => {
    const f = fixture("user");
    f.scope.cancelLocalTaskTurn.mockRejectedValueOnce(new Error("Stop failed"));
    await expect(f.run()).rejects.toThrow("Stop failed");
    expect(f.goal.status).toBe("paused");
  });
});
