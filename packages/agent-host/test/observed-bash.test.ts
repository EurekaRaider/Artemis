import type { BashOperations } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import { ObservedBashRegistry } from "../src/observed-bash.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, reject, resolve };
}

const scope = {
  threadId: "thread-1",
  turnId: "turn-1",
  ownerId: "parent",
};

describe("ObservedBashRegistry", () => {
  it("returns control at the observation deadline without stopping the command", async () => {
    const execution = deferred<{ exitCode: number | null }>();
    let signal: AbortSignal | undefined;
    const operations: BashOperations = {
      exec: async (_command, _cwd, options) => {
        signal = options.signal;
        options.onData(Buffer.from("building..."));
        return execution.promise;
      },
    };
    const registry = new ObservedBashRegistry(operations);
    const activity: string[] = [];

    const started = await registry.start({
      ...scope,
      command: "npm run build",
      cwd: "/workspace",
      observationMilliseconds: 5,
      onActivity: (snapshot) => activity.push(snapshot.outputDelta),
    });

    expect(started).toMatchObject({
      status: "running",
      observationExpired: true,
      outputDelta: "building...",
    });
    expect(signal?.aborted).toBe(false);
    expect(activity).toEqual(["building..."]);

    execution.resolve({ exitCode: 0 });
    const completed = await registry.wait({
      ...scope,
      executionId: started.executionId,
      observationMilliseconds: 50,
    });
    expect(completed).toMatchObject({
      status: "completed",
      exitCode: 0,
      observationExpired: false,
    });
  });

  it("aborts only when cancellation is explicitly requested", async () => {
    const operations: BashOperations = {
      exec: (_command, _cwd, options) =>
        new Promise((_, reject) => {
          options.signal?.addEventListener("abort", () => {
            const error = new Error("cancelled");
            error.name = "AbortError";
            reject(error);
          });
        }),
    };
    const registry = new ObservedBashRegistry(operations);
    const started = await registry.start({
      ...scope,
      command: "tail -f app.log",
      cwd: "/workspace",
      observationMilliseconds: 5,
    });

    const cancelled = await registry.cancel({
      ...scope,
      executionId: started.executionId,
    });

    expect(cancelled.status).toBe("cancelled");
  });
});
