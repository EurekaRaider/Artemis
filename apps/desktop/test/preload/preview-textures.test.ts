// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IPC } from "../../src/shared/api.js";

const native = vi.hoisted(() => ({ on: vi.fn(), send: vi.fn() }));
vi.mock("electron", () => ({
  ipcRenderer: native,
  sharedTexture: { setSharedTextureReceiver: vi.fn() },
}));
const token = "00000000-0000-0000-0000-000000000001";
let api: typeof import("../../src/preload/preview-textures.js");
let receive: (
  event: unknown,
  token: string,
  source: { id: string; frameRate: number } | null,
) => Promise<void>;
let draw: ReturnType<typeof vi.fn>;
let capture: ReturnType<typeof vi.fn>;
let nextFrame: VideoFrameRequestCallback;
let cancelFrame: ReturnType<typeof vi.fn>;
function media() {
  const track = Object.assign(new EventTarget(), { stop: vi.fn() });
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  return { track, stream };
}
beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  native.on.mockClear();
  native.send.mockClear();
  draw = vi.fn();
  cancelFrame = vi.fn();
  capture = vi.fn();
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: capture } });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: draw,
  } as never);
  vi.spyOn(HTMLVideoElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLVideoElement.prototype, "pause").mockImplementation(() => {});
  Object.defineProperties(HTMLVideoElement.prototype, {
    requestVideoFrameCallback: {
      configurable: true,
      value: vi.fn((callback) => {
        nextFrame = callback;
        return 1;
      }),
    },
    cancelVideoFrameCallback: { configurable: true, value: cancelFrame },
    videoWidth: { configurable: true, get: () => 640 },
    videoHeight: { configurable: true, get: () => 480 },
  });
  document.body.innerHTML = '<canvas id="preview"></canvas>';
  api = await import("../../src/preload/preview-textures.js");
  receive = native.on.mock.calls.find(
    ([channel]) => channel === IPC.computerPreviewMedia,
  )?.[1];
  api.bindPreviewCanvas(token, "preview");
});
afterEach(() => {
  window.dispatchEvent(new Event("unload"));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("draws real tab frames and stops capture when the main process unsubscribes", async () => {
  const { stream, track } = media();
  capture.mockResolvedValue(stream);
  expect(receive).toBeTypeOf("function");
  await receive({}, token, { id: "owned-source", frameRate: 120 });
  expect(capture).toHaveBeenCalledWith({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: "owned-source",
        minFrameRate: 0,
        maxFrameRate: 120,
        minWidth: 2,
        minHeight: 4,
        maxWidth: 2560,
        maxHeight: 2560,
      },
    },
  });
  nextFrame(100, {
    presentationTime: 99,
    presentedFrames: 1,
  } as VideoFrameCallbackMetadata);
  expect(draw).toHaveBeenCalledOnce();
  expect(document.querySelector("canvas")!.width).toBe(640);
  expect(document.querySelector("canvas")!.height).toBe(480);
  await vi.advanceTimersByTimeAsync(1000);
  expect(native.send).toHaveBeenCalledWith(
    IPC.computerPreviewReport,
    token,
    expect.objectContaining({ fps: 1, sequence: 1 }),
  );
  await receive({}, token, null);
  expect(track.stop).toHaveBeenCalledOnce();
  expect(cancelFrame).toHaveBeenCalled();
  nextFrame(200, {
    presentationTime: 199,
    presentedFrames: 2,
  } as VideoFrameCallbackMetadata);
  expect(draw).toHaveBeenCalledOnce();
});

it("does not capture for an unbound surface", async () => {
  api.unbindPreviewCanvas(token);
  expect(receive).toBeTypeOf("function");
  await receive({}, token, { id: "source", frameRate: 120 });
  expect(capture).not.toHaveBeenCalled();
});

it("releases a late stream after unmount without drawing into a replacement canvas", async () => {
  const { stream, track } = media();
  let resolve!: (value: unknown) => void;
  capture.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  expect(receive).toBeTypeOf("function");
  const starting = receive({}, token, { id: "source", frameRate: 120 });
  api.unbindPreviewCanvas(token);
  api.bindPreviewCanvas(token, "preview");
  resolve(stream);
  await starting;
  expect(track.stop).toHaveBeenCalledOnce();
  expect(draw).not.toHaveBeenCalled();
});

it("reports capture failures and releases tracks when playback fails", async () => {
  const { stream, track } = media();
  capture.mockResolvedValue(stream);
  vi.mocked(HTMLVideoElement.prototype.play).mockRejectedValue(
    new Error("Playback failed"),
  );
  expect(receive).toBeTypeOf("function");
  await receive({}, token, { id: "source", frameRate: 120 });
  expect(track.stop).toHaveBeenCalledOnce();
  expect(native.send).toHaveBeenCalledWith(
    IPC.computerPreviewMedia,
    token,
    "Playback failed",
  );
});
