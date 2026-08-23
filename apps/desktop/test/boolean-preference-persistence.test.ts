import { describe, expect, it } from "vitest";

import { createBooleanPreferencePersistenceQueue } from "../src/renderer/boolean-preference-persistence.js";

describe("boolean preference persistence", () => {
  it("serializes rapid toggles and applies only the newest response", async () => {
    let activeSaves = 0;
    let maximumActiveSaves = 0;
    const saveStarted = [deferred<void>(), deferred<void>()];
    const releaseSave = [deferred<void>(), deferred<void>()];
    const savedValues: boolean[] = [];
    const appliedValues: boolean[] = [];
    const queue = createBooleanPreferencePersistenceQueue({
      save: async (value) => {
        const saveIndex = savedValues.length;
        activeSaves += 1;
        maximumActiveSaves = Math.max(maximumActiveSaves, activeSaves);
        savedValues.push(value);
        saveStarted[saveIndex]?.resolve();
        await releaseSave[saveIndex]?.promise;
        activeSaves -= 1;
        return value;
      },
      onPersisted: (value) => appliedValues.push(value),
      onRejected: () => undefined,
    });
    queue.initialize(true);

    expect(queue.toggle()).toBe(false);
    expect(queue.toggle()).toBe(true);
    await saveStarted[0].promise;

    expect(savedValues).toEqual([false]);
    releaseSave[0].resolve();
    await saveStarted[1].promise;
    expect(savedValues).toEqual([false, true]);
    releaseSave[1].resolve();
    await queue.idle();

    expect(maximumActiveSaves).toBe(1);
    expect(appliedValues).toEqual([true]);
  });

  it("rolls the newest failed toggle back to the last persisted value", async () => {
    const appliedValues: boolean[] = [];
    const rejectedValues: boolean[] = [];
    let saves = 0;
    const queue = createBooleanPreferencePersistenceQueue({
      save: async (value) => {
        saves += 1;
        if (saves === 2) throw new Error("disk unavailable");
        return value;
      },
      onPersisted: (value) => appliedValues.push(value),
      onRejected: (value) => rejectedValues.push(value),
    });
    queue.initialize(true);

    expect(queue.toggle()).toBe(false);
    expect(queue.toggle()).toBe(true);
    await queue.idle();

    expect(appliedValues).toEqual([]);
    expect(rejectedValues).toEqual([false]);
    expect(queue.toggle()).toBe(true);
  });
});

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}
