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
  canvases.get(token)?.cancel?.();
  canvases.delete(token);
}
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
