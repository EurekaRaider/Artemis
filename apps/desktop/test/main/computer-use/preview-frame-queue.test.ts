import { describe, expect, it, vi } from "vitest";
import { PreviewFrameQueue } from "../../../src/main/computer-use/preview-frame-queue.js";

describe("preview backpressure", () => {
  it("retains one transfer and only the newest pending frame without waiting on control", async () => {
    const sends: number[] = [],
      completions: (() => void)[] = [];
    const queue = new PreviewFrameQueue<{ id: number; release(): void }>(
      (frame) => {
        sends.push(frame.id);
        return new Promise((resolve) => completions.push(resolve));
      },
      vi.fn(),
    );
    const frames = Array.from({ length: 100 }, (_, id) => ({
      id,
      release: vi.fn(),
    }));
    frames.forEach((frame) => queue.push(frame));
    expect(sends).toEqual([0]);
    expect(
      frames
        .slice(1, -1)
        .every((frame) => frame.release.mock.calls.length === 1),
    ).toBe(true);
    completions.shift()!();
    await Promise.resolve();
    await Promise.resolve();
    expect(sends).toEqual([0, 99]);
    queue.close();
    completions.shift()!();
    await Promise.resolve();
    await Promise.resolve();
    expect(frames.every((frame) => frame.release.mock.calls.length === 1)).toBe(
      true,
    );
    const after = { id: 100, release: vi.fn() };
    queue.push(after);
    expect(after.release).toHaveBeenCalledOnce();
  });
  it("releases both frames on teardown and reports transport errors once", async () => {
    let reject!: (error: Error) => void;
    const failed = vi.fn(),
      first = { release: vi.fn() },
      pending = { release: vi.fn() };
    const queue = new PreviewFrameQueue(
      () =>
        new Promise<void>((_, fail) => {
          reject = fail;
        }),
      failed,
    );
    queue.push(first);
    queue.push(pending);
    queue.close();
    reject(new Error("Renderer exited"));
    await Promise.resolve();
    await Promise.resolve();
    expect(first.release).toHaveBeenCalledOnce();
    expect(pending.release).toHaveBeenCalledOnce();
    expect(failed).not.toHaveBeenCalled();
  });
});
