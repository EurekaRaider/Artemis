import { ipcRenderer, sharedTexture } from "electron";
import { IPC } from "../shared/api.js";
const canvases = new Map<
  string,
  {
    id: string;
    frames: number;
    since: number;
    latencies: number[];
    sequence: number;
    cancel?: (() => void) | undefined;
    stopMedia?: (() => void) | undefined;
  }
>();
export function bindPreviewCanvas(token: string, canvasId: string) {
  if (
    !/^[\da-f-]{36}$/u.test(token) ||
    (!canvases.has(token) && canvases.size >= 8) ||
    canvasId.length > 200
  )
    throw new Error("Invalid preview surface");
  unbindPreviewCanvas(token);
  canvases.set(token, {
    id: canvasId,
    frames: 0,
    since: Date.now(),
    latencies: [],
    sequence: 0,
  });
}
export function unbindPreviewCanvas(token: string) {
  canvases.get(token)?.stopMedia?.();
  canvases.get(token)?.cancel?.();
  canvases.delete(token);
}

// IDs are issued by the main process for this WebContents only. Keep the
// MediaStream inside the isolated preload; the page receives only canvas pixels.
ipcRenderer.on(
  IPC.computerPreviewMedia,
  async (
    _event,
    token: string,
    source: { id: string; frameRate: number } | null,
  ) => {
    const surface = canvases.get(token);
    surface?.stopMedia?.();
    const canvas = surface && document.getElementById(surface.id);
    if (
      !source ||
      !surface ||
      !(canvas instanceof HTMLCanvasElement) ||
      !canvas.isConnected
    )
      return;
    let active = true;
    let stream: MediaStream | undefined;
    let handle: number | undefined;
    const video = document.createElement("video");
    video.muted = true;
    const stop = () => {
      if (!active) return;
      active = false;
      if (handle !== undefined) video.cancelVideoFrameCallback(handle);
      stream?.getTracks().forEach((track) => track.stop());
      video.pause();
      video.srcObject = null;
      if (surface.stopMedia === stop) surface.stopMedia = undefined;
    };
    surface.stopMedia = stop;
    const fail = (error: unknown) => {
      if (!active) return;
      stop();
      ipcRenderer.send(
        IPC.computerPreviewMedia,
        token,
        (error instanceof Error ? error.message : String(error)).slice(0, 1000),
      );
    };
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: "tab",
            chromeMediaSourceId: source.id,
            minFrameRate: 0,
            maxFrameRate: source.frameRate,
            // Tab capture defaults to a fixed output size. A variable range
            // with different endpoint ratios preserves the source's aspect
            // ratio as the browser viewport changes (Chromium ANY_WITHIN_LIMIT).
            minWidth: 2,
            minHeight: 4,
            maxWidth: 2560,
            maxHeight: 2560,
          },
        } as MediaTrackConstraints,
      });
      if (!active) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      for (const track of stream.getVideoTracks())
        track.addEventListener(
          "ended",
          () => fail(new Error("Browser capture ended. Reopen the tab.")),
          { once: true },
        );
      video.srcObject = stream;
      await video.play();
      if (!active) return;
      const draw: VideoFrameRequestCallback = (now, metadata) => {
        if (!active) return;
        if (canvases.get(token) !== surface || !canvas.isConnected) {
          stop();
          return;
        }
        try {
          if (canvas.width !== video.videoWidth)
            canvas.width = video.videoWidth;
          if (canvas.height !== video.videoHeight)
            canvas.height = video.videoHeight;
          canvas.getContext("2d", { alpha: false })?.drawImage(video, 0, 0);
          surface.frames++;
          surface.sequence++;
          // Tab capture may omit captureTime; then measure presentation delay.
          surface.latencies.push(
            Math.max(
              0,
              now - (metadata.captureTime ?? metadata.presentationTime),
            ),
          );
          handle = video.requestVideoFrameCallback(draw);
        } catch (error) {
          fail(error);
        }
      };
      handle = video.requestVideoFrameCallback(draw);
    } catch (error) {
      fail(error);
    }
  },
);
sharedTexture.setSharedTextureReceiver(
  async (
    { importedSharedTexture },
    token: string,
    metadata: { capturedAt: number; sequence: number },
  ) => {
    let frame: VideoFrame | undefined;
    try {
      const surface = canvases.get(token);
      const canvas = surface && document.getElementById(surface.id);
      if (
        !surface ||
        !(canvas instanceof HTMLCanvasElement) ||
        !canvas.isConnected
      )
        return;
      frame = importedSharedTexture.getVideoFrame();
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          cancelAnimationFrame(handle);
          surface.cancel = undefined;
          resolve();
        }, 150);
        const handle = requestAnimationFrame(() => {
          clearTimeout(timer);
          try {
            if (canvases.get(token) !== surface || !canvas.isConnected) return;
            if (canvas.width !== frame!.displayWidth)
              canvas.width = frame!.displayWidth;
            if (canvas.height !== frame!.displayHeight)
              canvas.height = frame!.displayHeight;
            canvas.getContext("2d", { alpha: false })?.drawImage(frame!, 0, 0);
            surface.frames++;
            surface.sequence = metadata.sequence;
            surface.latencies.push(
              Math.max(0, Date.now() - metadata.capturedAt),
            );
          } finally {
            surface.cancel = undefined;
            resolve();
          }
        });
        surface.cancel = () => {
          clearTimeout(timer);
          cancelAnimationFrame(handle);
          resolve();
        };
      });
    } finally {
      frame?.close();
      importedSharedTexture.release();
    }
  },
);
// Include quiet intervals so a stopped/static source never reports configured fps.
const reportTimer = setInterval(() => {
  const now = Date.now();
  for (const [token, surface] of canvases) {
    surface.latencies.sort((a, b) => a - b);
    ipcRenderer.send(IPC.computerPreviewReport, token, {
      fps: (surface.frames * 1000) / Math.max(1, now - surface.since),
      p95Ms:
        surface.latencies[Math.floor(surface.latencies.length * 0.95)] ?? 0,
      sequence: surface.sequence,
    });
    surface.frames = 0;
    surface.since = now;
    surface.latencies = [];
  }
}, 1000);
window.addEventListener("unload", () => {
  clearInterval(reportTimer);
  for (const token of canvases.keys()) unbindPreviewCanvas(token);
});
