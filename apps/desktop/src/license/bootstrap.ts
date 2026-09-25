import { ensureWindowsPackageAccess } from "../main/windows-package-access.js";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  powerMonitor,
  protocol,
  safeStorage,
} from "electron";
import { dirname, join } from "node:path";
import { readFile, stat } from "node:fs/promises";
import publicKeys from "../../license-public-keys.json";
import { readDeviceCode } from "./device.js";
import { protectedLicenseStorage } from "./storage.js";
import { LicenseService } from "./service.js";
import { setLicenseService, stopLicensedRuntime } from "./runtime.js";

import { WORKSPACE_PDF_SCHEME } from "../main/workspace-pdf-preview.js";

protocol.registerSchemesAsPrivileged([
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
const lockArgument = "--artemis-license-lock";
const forceVerification = process.argv.includes(lockArgument);

if (!app.requestSingleInstanceLock()) app.quit();
else
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

      let licenseWindow: BrowserWindow | undefined;
      let running = false;
      let restarting = false;
      let timer: ReturnType<typeof setInterval> | undefined;
      let expiryTimer: ReturnType<typeof setTimeout> | undefined;
      let error = "";
      let service: LicenseService | undefined;
      try {
        service = new LicenseService(
          await readDeviceCode(),
          publicKeys,
          protectedLicenseStorage(
            join(app.getPath("userData"), "license", "state.bin"),
            safeStorage,
          ),
        );
        service.checkpoint();
        if (forceVerification) service.interrupt();
      } catch {
        error = "device_unavailable";
      }

      function restartLocked() {
        if (restarting || !running) return;
        restarting = true;
        service?.interrupt();
        for (const window of BrowserWindow.getAllWindows()) window.hide();
        app.relaunch({
          args: [
            ...process.argv.slice(1).filter((value) => value !== lockArgument),
            lockArgument,
          ],
        });
        // Let Pi abort its running tools and await managed MCP shutdown before
        // killing the host; killing only the host can leave tool children alive.
        void stopLicensedRuntime().finally(() => app.quit());
        setTimeout(() => app.exit(1), 5000).unref();
      }
      if (service) setLicenseService(service, restartLocked);

      async function enter() {
        if (running || !service) return;
        const checked = service.checkpoint();
        if (checked.state !== "valid") {
          licenseWindow?.webContents.send("license:changed", checked);
          return;
        }
        service.assertValid();
        running = true;
        // Keep a window alive until business initialization creates its window;
        // Electron otherwise quits in the gap after destroying the license UI.
        licenseWindow?.hide();
        if (licenseWindow)
          app.once("browser-window-created", () => {
            licenseWindow?.destroy();
            licenseWindow = undefined;
          });
        let ticks = 0;
        timer = setInterval(() => {
          if (++ticks % 30 === 0) service!.checkpoint();
          if (service!.status().state !== "valid") restartLocked();
        }, 1000);
        function scheduleExpiry() {
          const remaining = Math.max(
            1,
            (service!.status().expiresAt ?? 0) - Date.now(),
          );
          expiryTimer = setTimeout(
            () => {
              if (service!.status().state !== "valid") restartLocked();
              else scheduleExpiry();
            },
            Math.min(remaining, 2_147_000_000),
          );
        }
        scheduleExpiry();
        powerMonitor.on("resume", () => {
          service!.checkpoint();
          if (service!.status().state !== "valid") restartLocked();
        });
        powerMonitor.on("suspend", () => service!.checkpoint());
        await import("../main/main.js");
      }

      const status = () =>
        error
          ? { state: error, device: "" }
          : Object.keys(publicKeys).length === 0
            ? { state: "issuer_unconfigured", device: service!.device }
            : forceVerification && service!.status().state === "valid"
              ? { ...service!.status(), state: "revalidation_required" }
              : service!.status();
      const handlers: Record<string, (...args: unknown[]) => unknown> = {
        "license:status": status,
        "license:copy-device": () => {
          clipboard.writeText(service?.device ?? "");
        },
        "license:activate": async (token) => {
          const result = service?.activate(token);
          if (result?.state === "valid")
            setTimeout(
              () =>
                void enter().catch((error: unknown) => {
                  console.error("Authorized runtime startup failed", error);
                  app.exit(1);
                }),
              100,
            );
          return result ?? status();
        },
        "license:import": async () => {
          const selection = await dialog.showOpenDialog(licenseWindow!, {
            properties: ["openFile"],
            filters: [
              {
                name: "Artemis License",
                extensions: ["artemis-license", "txt"],
              },
            ],
          });
          if (selection.canceled || !selection.filePaths[0]) return status();
          if ((await stat(selection.filePaths[0])).size > 16384)
            throw new Error("invalid_license");
          return handlers["license:activate"]!(
            await readFile(selection.filePaths[0], "utf8"),
          );
        },
        "license:recovery-request": () => {
          if (!service) throw new Error("device_unavailable");
          const request = JSON.stringify({
            device: service.device,
            challenge: service.recoveryChallenge(),
          });
          clipboard.writeText(request);
          return request;
        },
        "license:recover": async (token) => {
          const result = service?.recover(token);
          if (result?.state === "valid")
            setTimeout(
              () =>
                void enter().catch((error: unknown) => {
                  console.error("Authorized runtime startup failed", error);
                  app.exit(1);
                }),
              100,
            );
          return result ?? status();
        },
        "license:quit": () => app.quit(),
      };
      for (const [channel, handler] of Object.entries(handlers))
        ipcMain.handle(channel, (event, ...args) => {
          if (
            running ||
            !licenseWindow ||
            event.sender !== licenseWindow.webContents ||
            event.senderFrame !== licenseWindow.webContents.mainFrame
          )
            throw new Error("Unauthorized sender");
          return handler(...args);
        });
      app.on("before-quit", () => {
        if (timer) clearInterval(timer);
        if (expiryTimer) clearTimeout(expiryTimer);
        if (!restarting) service?.checkpoint();
      });
      app.on("second-instance", () => {
        const window = licenseWindow ?? BrowserWindow.getAllWindows()[0];
        window?.show();
        window?.focus();
      });
      if (!forceVerification && service?.status().state === "valid")
        await enter();
      else {
        licenseWindow = new BrowserWindow({
          width: 620,
          height: 660,
          minWidth: 480,
          minHeight: 560,
          title: "Artemis · 离线激活",
          autoHideMenuBar: true,
          webPreferences: {
            preload: join(import.meta.dirname, "license-preload.cjs"),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
            devTools: !app.isPackaged,
          },
        });
        licenseWindow.webContents.setWindowOpenHandler(() => ({
          action: "deny",
        }));
        licenseWindow.webContents.on("will-navigate", (event) =>
          event.preventDefault(),
        );
        licenseWindow.on("closed", () => {
          if (!running) app.quit();
        });
        await licenseWindow.loadFile(
          join(import.meta.dirname, "license-ui", "index.html"),
        );
      }
    })
    .catch(() => {
      dialog.showErrorBox(
        "Artemis",
        "授权服务启动失败，应用未解锁。请检查系统安全存储及应用安装。",
      );
      app.exit(1);
    });
