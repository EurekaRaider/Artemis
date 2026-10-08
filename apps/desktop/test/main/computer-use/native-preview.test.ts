import { beforeEach, expect, it, vi } from "vitest";
import type { ComputerNativeDriver } from "../../../src/main/computer-use/native-driver.js";
import {
  NativePreviewSource,
  type NativePreviewFrame,
} from "../../../src/main/computer-use/native-preview.js";

const bridge = vi.hoisted(() => ({
  protocol: 1,
  start: vi.fn(),
  stop: vi.fn(),
  resize: vi.fn(),
}));
vi.mock("node:module", () => ({ createRequire: () => () => bridge }));
beforeEach(() => {
  bridge.start.mockReset();
  bridge.stop.mockReset();
  bridge.resize.mockReset();
  bridge.stop.mockResolvedValue(undefined);
});
const target = {
  id: "desktop:test",
  kind: "desktop" as const,
  name: "Test",
  bundleId: "test",
};
function fixture() {
  const release = vi.fn(),
    acquire = vi.fn(async () => ({
      path: "/helper",
      previewPath: "/preview.node",
      release,
    }));
  const previewIdentity = vi.fn(async () => ({
    version: 1,
    platform: process.platform,
    targetId: target.id,
    appIdentity: "test",
    pid: 10,
    windowId: 12,
    processStart: 123,
  }));
  const source = new NativePreviewSource(
    { previewIdentity } as unknown as ComputerNativeDriver,
    acquire,
  );
  return { source, acquire, previewIdentity, release };
}
it.skipIf(process.platform !== "darwin")(
  "holds the pack lease through native stop and final GPU release",
  async () => {
    const f = fixture();
    let receive!: (frame: NativePreviewFrame) => void, complete!: () => void;
    bridge.start.mockImplementation((_identity, _maximum, callback) => {
      receive = callback;
      return {};
    });
    bridge.stop.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const frames: NativePreviewFrame[] = [];
    await f.source.start(target, 1280, (frame) => frames.push(frame));
    const releaseFrame = vi.fn();
    receive({
      width: 1280,
      height: 720,
      capturedAt: Date.now(),
      ioSurface: Buffer.alloc(8),
      release: releaseFrame,
    });
    f.source.stop();
    complete();
    await Promise.resolve();
    await Promise.resolve();
    expect(f.release).not.toHaveBeenCalled();
    frames[0]!.release();
    frames[0]!.release();
    expect(f.release).toHaveBeenCalledOnce();
    expect(releaseFrame).toHaveBeenCalledOnce();
    f.source.stop();
    expect(bridge.stop).toHaveBeenCalledOnce();
  },
);
it.skipIf(process.platform !== "darwin")(
  "rejects a mismatched authorized identity before loading the native module",
  async () => {
    const f = fixture();
    f.previewIdentity.mockResolvedValue({
      version: 1,
      platform: process.platform,
      targetId: "desktop:foreign",
      appIdentity: "test",
      pid: 10,
      windowId: 12,
      processStart: 123,
    });
    await expect(f.source.start(target, 1280, () => {})).rejects.toThrow(
      "identity validation",
    );
    expect(f.acquire).not.toHaveBeenCalled();
    expect(bridge.start).not.toHaveBeenCalled();
  },
);
