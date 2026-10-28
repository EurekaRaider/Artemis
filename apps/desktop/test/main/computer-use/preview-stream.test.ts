import type { WebContents } from "electron";
import { afterEach, expect, it, vi } from "vitest";
import { PreviewStream } from "../../../src/main/computer-use/preview-stream.js";
import { IPC } from "../../../src/shared/api.js";

const gpu = vi.hoisted(() => ({
  releases: [] as (() => void)[],
  send: vi.fn(async () => {}),
  imports: vi.fn(),
}));
vi.mock("electron", () => ({
  sharedTexture: {
    importSharedTexture: (options: { allReferencesReleased(): void }) => {
      gpu.releases.push(options.allReferencesReleased);
      gpu.imports();
      return { release: vi.fn() };
    },
    sendSharedTexture: gpu.send,
  },
}));
const contents = (id: number) =>
  ({
    id,
    mainFrame: { id },
    isDestroyed: () => false,
    send: vi.fn(),
  }) as unknown as WebContents;
const frame = () => ({
  textureInfo: {
    pixelFormat: "bgra" as const,
    codedSize: { width: 1280, height: 720 },
    handle: { ioSurface: Buffer.alloc(8) },
  },
  capturedAt: Date.now(),
  release: vi.fn(),
});
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
afterEach(() => {
  vi.useRealTimers();
  gpu.releases.length = 0;
  gpu.send.mockClear();
  gpu.imports.mockClear();
});

it("waits for GPU consumption, replaces pending frames, and keeps source alive after transfer", async () => {
  const stream = new PreviewStream("session", vi.fn(), vi.fn());
  stream.subscribe("surface", contents(1));
  const first = frame(),
    dropped = frame(),
    newest = frame();
  const releaseFirst = first.release;
  stream.push(first);
  stream.push(dropped);
  stream.push(newest);
  await flush();
  expect(gpu.send).toHaveBeenCalledTimes(1);
  expect(releaseFirst).not.toHaveBeenCalled();
  expect(dropped.release).toHaveBeenCalledOnce();
  gpu.releases.shift()!();
  await flush();
  expect(releaseFirst).toHaveBeenCalledOnce();
  expect(gpu.send).toHaveBeenCalledTimes(2);
  stream.close();
  gpu.releases.shift()!();
  await flush();
});

it("rejects subscriber spoofing and removes all surfaces when an owner exits", () => {
  const changed = vi.fn(),
    stream = new PreviewStream("session", changed, vi.fn()),
    owner = contents(1);
  stream.subscribe("one", owner);
  stream.subscribe("two", owner);
  expect(() => stream.subscribe("one", contents(2))).toThrow(/ownership/);
  stream.removeContents(owner);
  expect(stream.visible()).toBe(false);
  expect(changed).toHaveBeenLastCalledWith(false);
  const unused = frame();
  stream.push(unused);
  expect(unused.release).toHaveBeenCalledOnce();
  stream.close();
});

it("stops on GPU timeout without releasing an outstanding GPU texture early", async () => {
  vi.useFakeTimers();
  const failed = vi.fn(),
    stream = new PreviewStream("session", vi.fn(), failed);
  stream.subscribe("surface", contents(1));
  const first = frame(),
    release = first.release;
  stream.push(first);
  await flush();
  await vi.advanceTimersByTimeAsync(1000);
  expect(failed).toHaveBeenCalledOnce();
  expect(stream.visible()).toBe(false);
  expect(release).not.toHaveBeenCalled();
  expect(() => stream.subscribe("again", contents(1))).toThrow(/stopped/);
  gpu.releases.shift()!();
  expect(release).toHaveBeenCalledOnce();
});

it("grants a tab stream only to its subscriber and stops it on hide or close", () => {
  const owner = contents(1),
    other = contents(2),
    source = vi.fn((receiver: WebContents) => ({
      id: `capture-${receiver.id}`,
      frameRate: 120,
    })),
    changed = vi.fn(),
    stream = new PreviewStream("browser", changed, vi.fn(), source);
  stream.subscribe("browser", owner);
  stream.subscribe("browser", owner);
  expect(source).toHaveBeenCalledExactlyOnceWith(owner);
  expect(owner.send).toHaveBeenCalledWith(IPC.computerPreviewMedia, "browser", {
    id: "capture-1",
    frameRate: 120,
  });
  expect(() => stream.subscribe("browser", other)).toThrow(/ownership/);
  expect(source).toHaveBeenCalledOnce();
  stream.subscribe("pip", other);
  stream.unsubscribe("pip");
  expect(other.send).toHaveBeenLastCalledWith(
    IPC.computerPreviewMedia,
    "pip",
    null,
  );
  expect(stream.owns("browser", owner)).toBe(true);
  stream.close();
  expect(owner.send).toHaveBeenLastCalledWith(
    IPC.computerPreviewMedia,
    "browser",
    null,
  );
  expect(changed).toHaveBeenLastCalledWith(false);
  expect(stream.visible()).toBe(false);
});

it("rolls back a tab subscription if issuing its capture ID fails", () => {
  const owner = contents(1),
    changed = vi.fn(),
    stream = new PreviewStream("browser", changed, vi.fn(), () => {
      throw new Error("Target closed");
    });
  expect(() => stream.subscribe("browser", owner)).toThrow("Target closed");
  expect(stream.owns("browser", owner)).toBe(false);
  expect(stream.visible()).toBe(false);
  expect(changed).toHaveBeenLastCalledWith(false);
  stream.close();
});
