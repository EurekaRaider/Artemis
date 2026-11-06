import { windowsTitleBarOverlay } from "../appearance/windows-window-material.js";
import { applicationHost } from "../application/application-host.js";
import { installWorkspaceHistoryShortcuts } from "../workspace/workspace-history-shortcuts.js";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  BrowserWindow,
  clipboard,
  dialog,
  Menu,
  nativeTheme,
  shell,
  type MenuItemConstructorOptions,
} from "electron";
import {
  externalHttpUrl,
  isPdfViewerStreamNavigationAllowed,
  isRendererNavigationAllowed,
} from "../workspace/navigation-policy.js";
import { mainText } from "../settings/i18n.js";
import { I18N_RESOURCES } from "../../shared/i18n/i18n-resources.js";
import { IPC } from "../../shared/api.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  | "notificationRendererReady"
  | "windowBackgroundColor"
  | "syncMainWindowMaterial"
  | "hookSessionsEnded"
  | "syncAppearanceMedia"
  | "appearanceService"
  | "workspaceVideoPreview"
  | "workspaceHtmlPreview"
  | "computerUseHost"
  | "computerPreviewHost"
  | "browserSessionHost"
  | "mainWindow"
  | "taskNotifications"
  | "computerPreviewWindow"
  | "diagnosticBundleService"
  | "currentLocale"
  | "conversationShareService"
  | "isEmbeddedBrowserNavigationAllowed"
  | "markStartupStage"
  | "pendingThreadLinkId"
  | "pendingNotificationThreadId"
  | "scheduleGoalContinuation"
  | "store"
  | "recoveringUpdate"
  | "ipcMain"
>;

export function createApplicationWindow(services: Dependencies): BrowserWindow {
  const {
    windowBackgroundColor,
    syncMainWindowMaterial,
    syncAppearanceMedia,
    workspaceVideoPreview,
    workspaceHtmlPreview,
    currentLocale,
    isEmbeddedBrowserNavigationAllowed,
    markStartupStage,
    scheduleGoalContinuation,
    ipcMain,
  } = services;

  services.notificationRendererReady = false;
  const hostOptions = applicationHost.windowOptions?.();
  const window = new BrowserWindow({
    width: hostOptions?.width ?? 1420,
    height: hostOptions?.height ?? 920,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: windowBackgroundColor(),
    title: "Artemis",
    show: hostOptions?.show ?? true,
    enableLargerThanScreen: hostOptions?.enableLargerThanScreen ?? false,
    titleBarStyle:
      process.platform === "darwin"
        ? "hiddenInset"
        : process.platform === "win32"
          ? "hidden"
          : "default",
    ...(process.platform === "win32"
      ? {
          titleBarOverlay: windowsTitleBarOverlay(
            nativeTheme.shouldUseDarkColors,
          ),
          autoHideMenuBar: true,
        }
      : {}),
    ...(process.platform === "darwin"
      ? {
          trafficLightPosition: { x: 18, y: 17 },
          vibrancy: "sidebar" as const,
          visualEffectState: "active" as const,
        }
      : {}),
    webPreferences: {
      preload: join(import.meta.dirname, "preload.cjs"),
      backgroundThrottling: hostOptions?.backgroundThrottling ?? true,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
    },
  });

  syncMainWindowMaterial(window);
  let editorsFlushed = false;
  let flushingEditors = false;
  window.on("close", (event) => {
    if (
      editorsFlushed ||
      services.hookSessionsEnded ||
      window.webContents.isDestroyed()
    )
      return;
    event.preventDefault();
    if (flushingEditors) return;
    flushingEditors = true;
    void window.webContents
      .executeJavaScript("window.artemisFlushWorkspaceEdits?.()")
      .then(() => {
        editorsFlushed = true;
        window.close();
      })
      .catch((error: unknown) => {
        dialog.showErrorBox("Document save failed", String(error));
      })
      .finally(() => {
        flushingEditors = false;
      });
  });
  window.on("show", syncAppearanceMedia);
  window.on("hide", syncAppearanceMedia);
  window.on("minimize", syncAppearanceMedia);
  window.on("restore", syncAppearanceMedia);
  const appearanceOwner = window.webContents.id;
  window.webContents.on("destroyed", () => {
    void services.appearanceService?.releaseOwner(appearanceOwner);
  });
  window.on("closed", () => {
    if (services.mainWindow === window) {
      workspaceVideoPreview.clear();
      workspaceHtmlPreview.clear();
      services.computerUseHost?.service.stopAll("Artemis window closed");
      services.computerUseHost?.native.dispose();
      services.computerPreviewHost?.dispose();
      services.browserSessionHost?.dispose();
      services.mainWindow = undefined;
      if (services.taskNotifications)
        services.taskNotifications.viewedThreadId = undefined;
    }
  });
  window.webContents.on(
    "did-start-navigation",
    (_event, _url, _inPlace, isMainFrame) => {
      if (isMainFrame) {
        if (!_inPlace) {
          workspaceVideoPreview.clear();
          workspaceHtmlPreview.clear();
          void services.appearanceService?.releaseOwner(appearanceOwner);
        }
        services.notificationRendererReady = false;
        if (services.taskNotifications)
          services.taskNotifications.viewedThreadId = undefined;
        services.computerPreviewWindow?.setThread(undefined);
      }
    },
  );
  window.webContents.on("did-finish-load", () =>
    services.taskNotifications?.refresh(),
  );

  window.on("unresponsive", () => {
    services.diagnosticBundleService?.record({
      source: "renderer",
      severity: "error",
      message: "The main Renderer window became unresponsive.",
    });
  });

  const devServer = process.env.ARTEMIS_DEV_SERVER_URL;
  const productionEntry = join(
    import.meta.dirname,
    "..",
    "dist-renderer",
    "index.html",
  );
  const rendererEntry = devServer ?? pathToFileURL(productionEntry).href;
  installWorkspaceHistoryShortcuts(window.webContents);
  window.webContents.on("will-navigate", (event, url) => {
    if (!isRendererNavigationAllowed(url, rendererEntry, Boolean(devServer))) {
      event.preventDefault();
    }
  });
  window.webContents.on("context-menu", (event, params) => {
    const linkUrl = externalHttpUrl(params.linkURL);
    const hasSelection = params.selectionText.length > 0;
    const hasImage = params.mediaType === "image" && params.hasImageContents;
    if (!linkUrl && !hasSelection && !hasImage) return;
    event.preventDefault();
    const locale = currentLocale();
    const items: MenuItemConstructorOptions[] = [];
    if (hasSelection) {
      items.push({ role: "copy", label: I18N_RESOURCES[locale].common.copy });
    }
    if (hasImage) {
      if (items.length > 0) items.push({ type: "separator" });
      items.push({
        label: mainText(locale, "copyImage"),
        click: () => window.webContents.copyImageAt(params.x, params.y),
      });
    }
    if (linkUrl) {
      if (items.length > 0) items.push({ type: "separator" });
      items.push(
        {
          label: mainText(locale, "openLink"),
          click: () => void shell.openExternal(linkUrl),
        },
        {
          label: mainText(locale, "copyLink"),
          click: () => clipboard.writeText(linkUrl),
        },
      );
    }
    Menu.buildFromTemplate(items).popup({ window });
  });
  window.webContents.on("will-frame-navigate", (event) => {
    if (
      !event.isMainFrame &&
      event.url !== "about:blank" &&
      event.url !== "about:srcdoc" &&
      !services.conversationShareService?.allowsNavigation(event.url) &&
      !workspaceHtmlPreview.allowsNavigation(event.url)
    ) {
      event.preventDefault();
    }
  });
  window.webContents.on(
    "will-attach-webview",
    (event, webPreferences, params) => {
      delete webPreferences.preload;
      webPreferences.nodeIntegration = false;
      webPreferences.nodeIntegrationInSubFrames = false;
      webPreferences.contextIsolation = true;
      webPreferences.sandbox = true;
      webPreferences.webSecurity = true;
      webPreferences.allowRunningInsecureContent = false;
      const navigationAllowed = isEmbeddedBrowserNavigationAllowed(
        params.src ?? "",
      );

      if (!navigationAllowed) {
        event.preventDefault();
      }
    },
  );
  window.webContents.on("did-attach-webview", (_event, guest) => {
    guest.on("will-frame-navigate", (details) => {
      if (
        !isEmbeddedBrowserNavigationAllowed(details.url) &&
        !isPdfViewerStreamNavigationAllowed(
          details.url,
          details.frame?.parent?.url,
          details.isMainFrame,
        )
      ) {
        details.preventDefault();
      }
    });
    guest.setWindowOpenHandler(({ url }) => {
      if (url.startsWith("https://") || url.startsWith("http://")) {
        void guest.loadURL(url);
      }
      return { action: "deny" };
    });
  });

  ipcMain.once(IPC.rendererReady, (event, runtimeSecurity: unknown) => {
    if (event.sender.id === window.webContents.id) {
      markStartupStage("renderer-ready");
      services.notificationRendererReady = true;
      if (services.pendingThreadLinkId !== undefined) {
        window.webContents.send(
          IPC.threadLinkOpen,
          services.pendingThreadLinkId,
        );
        services.pendingThreadLinkId = undefined;
      }
      if (services.pendingNotificationThreadId) {
        const target = services.pendingNotificationThreadId;
        services.pendingNotificationThreadId = undefined;
        window.webContents.send(IPC.automationThreadOpen, target);
      }
      if (applicationHost.resumeGoals !== false && !services.recoveringUpdate) {
        for (const thread of services.store?.listThreads() ?? []) {
          if (thread.goal?.status === "active") {
            scheduleGoalContinuation(thread.id, thread.goal.goalId);
          }
        }
      }
    }
  });

  applicationHost.windowCreated?.(window);
  if (devServer) {
    void window.loadURL(devServer);
  } else {
    void window.loadFile(productionEntry);
  }
  return window;
}
