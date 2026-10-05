import { app, BrowserWindow, dialog, protocol } from "electron";
import { dirname, join } from "node:path";
import { ensureWindowsPackageAccess } from "./updates/windows-package-access.js";
import { WORKSPACE_PDF_SCHEME } from "./workspace/workspace-pdf-preview.js";
import { WORKSPACE_VIDEO_SCHEME } from "../shared/workspace-video.js";
import { WORKSPACE_HTML_SCHEME } from "../shared/timeline-preview.js";
import { guardStdio } from "./platform/stdio-guard.js";

guardStdio(process.stdout);
guardStdio(process.stderr);

protocol.registerSchemesAsPrivileged([
  {
    scheme: "artemis-skin",
    privileges: {
      standard: true,
      secure: true,
      corsEnabled: true,
      stream: true,
    },
  },
  {
    scheme: WORKSPACE_HTML_SCHEME,
    privileges: { standard: true, secure: true, corsEnabled: true },
  },
  {
    scheme: WORKSPACE_VIDEO_SCHEME,
    privileges: { standard: true, secure: true, stream: true },
  },
  {
    scheme: WORKSPACE_PDF_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

// These development surfaces must never select executable code in a packaged app.
if (app.isPackaged) {
  for (const name of Object.keys(process.env)) {
    if (name.startsWith("ARTEMIS_SMOKE_") || name === "ARTEMIS_DEV_SERVER_URL")
      delete process.env[name];
  }
}
if (process.env.ARTEMIS_SMOKE_SCREENSHOT) app.disableHardwareAcceleration();
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    const window = BrowserWindow.getAllWindows()[0];
    window?.show();
    window?.focus();
  });
  void app
    .whenReady()
    .then(async () => {
      if (app.isPackaged && process.platform === "win32") {
        await ensureWindowsPackageAccess({
          applicationRoot: dirname(process.execPath),
          applicationVersion: app.getVersion(),
          markerPath: join(
            app.getPath("userData"),
            "windows-package-access.json",
          ),
        });
      }
      await import("./main.js");
    })
    .catch((error: unknown) => {
      console.error("Artemis startup failed", error);
      dialog.showErrorBox("Artemis failed to start", String(error));
      app.exit(1);
    });
}
