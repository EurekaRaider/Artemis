import { afterEach, expect, it, vi } from "vitest";
import { DesignWatchdog } from "../src/main/design-watchdog.js";
afterEach(() => vi.useRealTimers());

it("terminates after five seconds without accumulating stalled probes", async () => {
  vi.useFakeTimers();
  const probe = vi.fn(() => new Promise<void>(() => {}));
  const stop = vi.fn();
  const watchdog = new DesignWatchdog({ probe, residentBytes: () => 0, stop });
  watchdog.start();
  await vi.advanceTimersByTimeAsync(5000);
  expect(probe).toHaveBeenCalledTimes(1);
  expect(stop).toHaveBeenCalledExactlyOnceWith("unresponsive");
  await vi.advanceTimersByTimeAsync(10000);
  expect(stop).toHaveBeenCalledTimes(1);
});

it("requires three consecutive RSS samples above the limit and keeps healthy previews alive", async () => {
  vi.useFakeTimers();
  let memory = 513 * 1024 * 1024;
  const stop = vi.fn();
  const watchdog = new DesignWatchdog({
    probe: async () => {},
    residentBytes: () => memory,
    stop,
  });
  watchdog.start();
  await vi.advanceTimersByTimeAsync(2000);
  memory = 0;
  await vi.advanceTimersByTimeAsync(10000);
  expect(stop).not.toHaveBeenCalled();
  memory = 513 * 1024 * 1024;
  await vi.advanceTimersByTimeAsync(3000);
  expect(stop).toHaveBeenCalledExactlyOnceWith("memory-limit");
});

it("disposal stops the watchdog even when a pending probe settles later", async () => {
  vi.useFakeTimers();
  let resolve!: () => void;
  const stop = vi.fn();
  const watchdog = new DesignWatchdog({
    probe: () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
    residentBytes: () => 0,
    stop,
  });
  watchdog.start();
  await vi.advanceTimersByTimeAsync(1000);
  watchdog.dispose();
  resolve();
  await vi.advanceTimersByTimeAsync(10000);
  expect(stop).not.toHaveBeenCalled();
});
