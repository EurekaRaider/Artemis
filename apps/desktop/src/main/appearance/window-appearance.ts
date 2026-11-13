import { AppearanceService } from "../appearance/appearance-service.js";
import {
  applyWindowsWindowMaterial,
  windowsTitleBarOverlay,
} from "../appearance/windows-window-material.js";
import {
  shouldUseSolidMaterial,
  type WindowMaterial,
} from "../../shared/window-material.js";
import { release as osRelease } from "node:os";
import { join } from "node:path";
import { app, BrowserWindow, nativeTheme } from "electron";
import type { AppTheme } from "@artemis/protocol";
import { IPC } from "../../shared/api.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  | "appearanceSystemPauseReasons"
  | "mainWindow"
  | "appearanceService"
  | "designPanelHost"
  | "materialPreference"
  | "windowMaterial"
>;
export function createWindowAppearance(services: Dependencies) {
  const { appearanceSystemPauseReasons } = services;
  function syncAppearanceMedia(): void {
    services.appearanceService?.setMediaPaused(
      appearanceSystemPauseReasons.size > 0 ||
        !services.mainWindow ||
        !services.mainWindow.isVisible() ||
        services.mainWindow.isMinimized(),
    );
  }

  function requireAppearanceSender(
    event: Electron.IpcMainInvokeEvent,
  ): AppearanceService {
    if (
      !services.appearanceService ||
      !services.mainWindow ||
      event.sender !== services.mainWindow.webContents ||
      event.senderFrame !== event.sender.mainFrame
    )
      throw new Error(
        "Appearance API is available only to the Artemis main window.",
      );
    return services.appearanceService;
  }

  function windowBackgroundColor(): string {
    if (process.platform === "darwin") return "#00000000";
    return nativeTheme.shouldUseDarkColors ? "#0f1012" : "#f7f7f6";
  }

  function applyMacDockIcon(): void {
    if (process.platform !== "darwin" || app.isPackaged) return;
    const iconPath = join(app.getAppPath(), "build", "icon.png");
    app.dock?.setIcon(iconPath);
  }

  function syncWindowBackgroundColors(): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window === services.mainWindow) {
        syncMainWindowMaterial(window);
      } else {
        window.setBackgroundColor(windowBackgroundColor());
      }
    }
    services.designPanelHost?.broadcastTheme(
      nativeTheme.shouldUseDarkColors ? "dark" : "light",
    );
  }

  function syncMainWindowMaterial(window: BrowserWindow): void {
    const preferences = {
      material: services.materialPreference,
      dark: nativeTheme.shouldUseDarkColors,
      reducedTransparency: nativeTheme.prefersReducedTransparency,
      highContrast: nativeTheme.shouldUseHighContrastColors,
      forcedColors: nativeTheme.inForcedColorsMode,
    };
    const solid = shouldUseSolidMaterial(preferences);
    let next: WindowMaterial;
    if (process.platform === "win32") {
      window.setTitleBarOverlay(windowsTitleBarOverlay(preferences.dark));
      next = applyWindowsWindowMaterial(window, {
        ...preferences,
        release: osRelease(),
      });
    } else {
      next = solid
        ? "solid"
        : process.platform === "darwin"
          ? "vibrancy"
          : "web";
      if (process.platform === "darwin")
        window.setVibrancy(solid ? null : "sidebar");
      window.setBackgroundColor(
        next === "vibrancy"
          ? "#00000000"
          : preferences.dark
            ? "#20201e"
            : "#ffffff",
      );
    }
    if (next !== services.windowMaterial) {
      services.windowMaterial = next;
      window.webContents.send(IPC.windowMaterialChanged, next);
    }
  }

  function applyNativeTheme(theme: AppTheme): void {
    nativeTheme.themeSource = theme;
    syncWindowBackgroundColors();
  }
  return {
    syncAppearanceMedia,
    requireAppearanceSender,
    windowBackgroundColor,
    applyMacDockIcon,
    syncWindowBackgroundColors,
    syncMainWindowMaterial,
    applyNativeTheme,
  };
}
