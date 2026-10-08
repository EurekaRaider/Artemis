const { app, BrowserWindow, ipcMain, sharedTexture } = require("electron");
const { join } = require("node:path");
const { writeFileSync } = require("node:fs");
const output = process.env.ARTEMIS_PREVIEW_REPORT;
app.whenReady().then(async () => {
  const sink = new BrowserWindow({
    width: 1280,
    height: 720,
    webPreferences: {
      preload: join(__dirname, "computer-preview-texture-preload.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const source = new BrowserWindow({
    show: false,
    width: 1280,
    height: 720,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      offscreen: { useSharedTexture: true },
    },
  });
  let ready = false,
    busy = false,
    pending,
    received = 0,
    released = 0,
    dropped = 0;
  ipcMain.on("preview-ready", (e) => {
    if (e.sender === sink.webContents) ready = true;
  });
  const send = async (texture, capturedAt) => {
    busy = true;
    const imported = sharedTexture.importSharedTexture({
      textureInfo: texture.textureInfo,
      allReferencesReleased: () => {
        texture.release();
        released++;
      },
    });
    try {
      await sharedTexture.sendSharedTexture(
        { frame: sink.webContents.mainFrame, importedSharedTexture: imported },
        capturedAt,
      );
    } finally {
      imported.release();
      busy = false;
      if (pending) {
        const next = pending;
        pending = undefined;
        void send(...next);
      }
    }
  };
  source.webContents.on("paint", (e) => {
    if (!e.texture) return;
    received++;
    if (!ready) {
      e.texture.release();
      released++;
      return;
    }
    if (busy) {
      if (pending) {
        pending[0].release();
        released++;
        dropped++;
      }
      pending = [e.texture, Date.now()];
    } else void send(e.texture, Date.now());
  });
  source.webContents.setFrameRate(60);
  ipcMain.on("preview-report", async (e, report) => {
    if (e.sender !== sink.webContents) return;
    source.webContents.stopPainting();
    if (pending) {
      pending[0].release();
      released++;
      pending = undefined;
    }
    if (output) {
      const screenshot = await sink.webContents.capturePage();
      writeFileSync(output + ".png", screenshot.toPNG());
      writeFileSync(
        output,
        JSON.stringify(
          {
            ...report,
            received,
            released,
            dropped,
            electron: process.versions.electron,
            gpu: await app.getGPUInfo("basic"),
            metrics: app.getAppMetrics(),
          },
          null,
          2,
        ),
      );
    }
    console.log(JSON.stringify({ ...report, received, released, dropped }));
    app.quit();
  });
  await sink.loadURL(
    'data:text/html,<canvas id="preview" width="1280" height="720" style="width:100%;height:100%"></canvas>',
  );
  await source.loadURL(
    "data:text/html," +
      encodeURIComponent(
        "<style>body{margin:0;background:#10203a;color:white;font:48px sans-serif}div{width:200px;height:200px;background:#3bc5ba;animation:move 2s linear infinite alternate}@keyframes move{to{transform:translate(1000px,400px) rotate(180deg)}}</style><p>Artemis GPU preview · 1280 × 720</p><div></div>",
      ),
  );
  setTimeout(() => {
    console.error("Preview timed out");
    app.exit(1);
  }, 20000).unref();
});
