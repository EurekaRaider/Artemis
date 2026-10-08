const { ipcRenderer, sharedTexture } = require("electron");
let first,
  frames = 0,
  latencies = [],
  done = false;
sharedTexture.setSharedTextureReceiver(
  async ({ importedSharedTexture }, capturedAt) => {
    const frame = importedSharedTexture.getVideoFrame();
    try {
      const canvas = document.getElementById("preview");
      if (!canvas) return;
      canvas
        .getContext("2d")
        .drawImage(frame, 0, 0, canvas.width, canvas.height);
      const now = Date.now();
      first ??= now;
      if (now - first > 2000) {
        frames++;
        latencies.push(now - capturedAt);
      }
      if (!done && now - first >= 12000) {
        done = true;
        latencies.sort((a, b) => a - b);
        ipcRenderer.send("preview-report", {
          frames,
          fps: (frames * 1000) / (now - first - 2000),
          p95Ms: latencies[Math.floor(latencies.length * 0.95)],
          sandbox: process.sandboxed,
          contextIsolation: process.contextIsolated,
        });
      }
    } finally {
      frame.close();
      importedSharedTexture.release();
    }
  },
);
window.addEventListener("DOMContentLoaded", () =>
  ipcRenderer.send("preview-ready"),
);
