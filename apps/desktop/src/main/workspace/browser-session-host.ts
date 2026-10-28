import { BrowserWindow, screen, type WebContents } from "electron";
import { randomUUID } from "node:crypto";
import type {
  BrowserSessionCommand,
  BrowserSessionSnapshot,
  BrowserHumanInput,
} from "@artemis/protocol";
import { BROWSER_SESSION_PARTITION } from "../../shared/i18n/browser-locale.js";
import { isPdfViewerStreamNavigationAllowed } from "./navigation-policy.js";
import { PreviewStream } from "../computer-use/preview-stream.js";
import { BrowserNativeWindow } from "./browser-native-window.js";

function previewFrameRate(contents: WebContents) {
  const owner = BrowserWindow.fromWebContents(contents);
  const frequency = owner
    ? screen.getDisplayMatching(owner.getBounds()).displayFrequency
    : 0;
  return Number.isFinite(frequency) && frequency >= 1
    ? Math.round(frequency)
    : 60;
}

interface BrowserTab {
  threadId: string;
  tabId: string;
  window: BrowserWindow | BrowserNativeWindow;
  stream: PreviewStream;
  documentKey?: string;
  leases: string[];
  inputTail: Promise<void>;
  inputCount: number;
  error?: string;
}
/** Trusted main-owned registry. Renderer IDs never establish WebContents ownership. */
export class BrowserSessionHost {
  private readonly tabs = new Map<string, BrowserTab>();
  constructor(
    private readonly options: {
      navigationAllowed(url: string): boolean;
      register(contents: WebContents, threadId: string): void;
      present?(
        contentsId: number,
        presentation: import("@artemis/protocol").BrowserViewport,
      ): Promise<void> | undefined;
      input(
        threadId: string,
        contentsId: number,
        input: BrowserHumanInput,
      ): Promise<void>;
      changed(snapshot: BrowserSessionSnapshot): void;
      closed?(contents: WebContents): void;
      workspaceDocument?(threadId: string, path: string): Promise<string>;
      releaseDocument?(threadId: string, url: string): void;
      takeover?(threadId: string, contentsId: number): void;
    },
  ) {}
  private key(threadId: string, tabId: string) {
    return `${threadId}\0${tabId}`;
  }
  get(threadId: string, tabId: string) {
    const tab = this.tabs.get(this.key(threadId, tabId));
    if (!tab || tab.window.isDestroyed())
      throw new Error("Browser tab is closed");
    return tab;
  }
  owned(threadId: string, contentsId: number) {
    return [...this.tabs.values()].find(
      (tab) =>
        tab.threadId === threadId &&
        !tab.window.isDestroyed() &&
        tab.window.webContents.id === contentsId,
    );
  }
  forThread(threadId: string) {
    return [...this.tabs.values()].find(
      (tab) => tab.threadId === threadId && !tab.window.isDestroyed(),
    );
  }
  snapshot(tab: BrowserTab): BrowserSessionSnapshot {
    const contents = tab.window.webContents,
      size = tab.window.getContentSize();
    return {
      threadId: tab.threadId,
      tabId: tab.tabId,
      sessionId: tab.stream.id,
      contentsId: contents.id,
      url: contents.getURL(),
      title: contents.getTitle(),
      canGoBack: contents.navigationHistory.canGoBack(),
      canGoForward: contents.navigationHistory.canGoForward(),
      loading: contents.isLoading(),
      width: size[0]!,
      height: size[1]!,
      ...(tab.window instanceof BrowserNativeWindow
        ? { nativeView: true }
        : {}),
      ...(tab.error ? { error: tab.error } : {}),
    };
  }
  async open(threadId: string, tabId: string, url = "about:blank") {
    const existing = this.tabs.get(this.key(threadId, tabId));
    if (existing && !existing.window.isDestroyed()) {
      if (!existing.stream.stopped()) return existing;
      existing.window.destroy();
    }
    if (!this.options.navigationAllowed(url))
      throw new Error("Browser navigation is not allowed");
    if (this.tabs.size >= 64)
      throw new Error("Close a browser tab before opening another");
    // macOS OSR has no display clock: Chromium's input boost selects its
    // fallback 60 Hz even after setFrameRate(120). Present the native view
    // directly; only passive PiP consumers need Chromium's GPU tab capture.
    const nativeCapture = process.platform === "darwin";
    const webPreferences = {
      partition: BROWSER_SESSION_PARTITION,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      backgroundThrottling: false,
      plugins: true,
    };
    const window = nativeCapture
      ? new BrowserNativeWindow(webPreferences)
      : new BrowserWindow({
          show: false,
          width: 1280,
          height: 720,
          webPreferences: {
            ...webPreferences,
            offscreen: { useSharedTexture: true },
          },
        });
    const contents = window.webContents;
    const stream = new PreviewStream(
      randomUUID(),
      (visible) => {
        if (contents.isDestroyed()) return;
        if (nativeCapture) contents.setBackgroundThrottling(!visible);
        else if (visible) {
          contents.startPainting();
          contents.invalidate();
        } else contents.stopPainting();
      },
      (error) => {
        tab.error = error instanceof Error ? error.message : String(error);
        if (!window.isDestroyed())
          this.options.changed({ ...this.snapshot(tab), error: tab.error });
      },
      nativeCapture
        ? (receiver) => {
            const owner = BrowserWindow.fromWebContents(receiver);
            if (owner) {
              const { x, y } = owner.getBounds();
              window.setPosition(x, y);
            }
            return {
              id: contents.getMediaSourceId(receiver),
              frameRate: previewFrameRate(receiver),
            };
          }
        : undefined,
    );
    const tab: BrowserTab = {
      threadId,
      tabId,
      window,
      stream,
      leases: [],
      inputTail: Promise.resolve(),
      inputCount: 0,
    };
    this.tabs.set(this.key(threadId, tabId), tab);
    if (!nativeCapture) {
      contents.setFrameRate(60);
      contents.on("paint", (event) => {
        if (event.texture)
          stream.push({
            textureInfo: event.texture.textureInfo,
            capturedAt: Date.now(),
            release: () => event.texture!.release(),
          });
      });
    }
    contents.on("will-frame-navigate", (details) => {
      if (
        !this.options.navigationAllowed(details.url) &&
        !isPdfViewerStreamNavigationAllowed(
          details.url,
          details.frame?.parent?.url,
          details.isMainFrame,
        )
      )
        details.preventDefault();
    });
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//u.test(url)) void contents.loadURL(url).catch(() => {});
      return { action: "deny" };
    });
    const publish = () => {
      if (!window.isDestroyed()) this.options.changed(this.snapshot(tab));
    };
    contents.on("did-start-loading", () => {
      if (!stream.stopped()) delete tab.error;
      publish();
    });
    contents.on("did-stop-loading", publish);
    contents.on("did-navigate", publish);
    contents.on("did-navigate-in-page", publish);
    contents.on(
      "did-fail-load",
      (_event, code, description, _url, mainFrame) => {
        if (mainFrame && code !== -3) {
          tab.error = `${description} (${code})`;
          publish();
        }
      },
    );
    contents.on("page-title-updated", publish);
    contents.on("render-process-gone", () =>
      stream.fail(new Error("Browser renderer stopped. Reopen the tab.")),
    );
    window.once("closed", () => {
      stream.close();
      this.tabs.delete(this.key(threadId, tabId));
      this.options.closed?.(contents);
      for (const url of tab.leases)
        this.options.releaseDocument?.(threadId, url);
    });
    this.options.register(contents, threadId);
    await contents.loadURL(url);
    if (!stream.visible()) {
      if (nativeCapture) contents.setBackgroundThrottling(true);
      else contents.stopPainting();
    }
    return tab;
  }
  async command(input: BrowserSessionCommand, sender: WebContents) {
    if (input.action === "open") {
      const tab = await this.open(input.threadId, input.tabId, input.url);
      const documentKey = `${input.path}\0${input.revision ?? ""}`;
      if (
        input.path &&
        tab.documentKey !== documentKey &&
        this.options.workspaceDocument
      ) {
        const url = await this.options.workspaceDocument(
          input.threadId,
          input.path,
        );
        if (tab.window.isDestroyed()) {
          this.options.releaseDocument?.(input.threadId, url);
          return;
        }
        if (!tab.leases.includes(url)) tab.leases.push(url);
        try {
          await tab.window.webContents.loadURL(url);
        } catch (error) {
          if (
            !tab.window.isDestroyed() &&
            tab.window.webContents.getURL() !== url
          ) {
            tab.leases = tab.leases.filter((value) => value !== url);
            this.options.releaseDocument?.(input.threadId, url);
          }
          throw error;
        }
        if (tab.window.isDestroyed()) return;
        tab.documentKey = documentKey;
      }
      return this.snapshot(tab);
    }
    const tab = this.get(input.threadId, input.tabId),
      contents = tab.window.webContents;
    if (["navigate", "back", "forward", "reload"].includes(input.action))
      this.options.takeover?.(input.threadId, contents.id);
    switch (input.action) {
      case "navigate":
        if (!this.options.navigationAllowed(input.url))
          throw new Error("Browser navigation is not allowed");
        await contents.loadURL(input.url);
        break;
      case "back":
        if (contents.navigationHistory.canGoBack())
          contents.navigationHistory.goBack();
        break;
      case "forward":
        if (contents.navigationHistory.canGoForward())
          contents.navigationHistory.goForward();
        break;
      case "reload":
        contents.reload();
        break;
      case "close":
        tab.window.destroy();
        return;
      case "subscribe": {
        const native =
          tab.window instanceof BrowserNativeWindow &&
          input.nativeBounds !== undefined
            ? tab.window
            : null;
        const owner = native ? BrowserWindow.fromWebContents(sender) : null;
        if (native && !owner)
          throw new Error("Browser requires a native owner window");
        tab.stream.subscribe(input.token, sender, !native);
        const scale = owner?.webContents.getZoomFactor() ?? 1;
        if (tab.window instanceof BrowserNativeWindow)
          tab.window.setContentSize(input.width, input.height, scale);
        else tab.window.setContentSize(input.width, input.height);
        if (native && owner)
          native.present(owner, input.token, input.nativeBounds!);
        if (tab.window instanceof BrowserNativeWindow)
          await this.options.present?.(contents.id, {
            width: input.width,
            height: input.height,
            scale,
          });
        if (process.platform !== "darwin")
          contents.setFrameRate(previewFrameRate(sender));
        break;
      }
      case "unsubscribe":
        if (tab.stream.owns(input.token, sender)) {
          if (tab.window instanceof BrowserNativeWindow)
            tab.window.release(input.token, sender.id);
          tab.stream.unsubscribe(input.token);
        }
        break;
      case "input":
        if (!tab.stream.owns(input.token, sender))
          throw new Error("Browser input requires an active owned surface");
        if ("x" in input.input) {
          const size = tab.window.getContentSize();
          if (input.input.x >= size[0]! || input.input.y >= size[1]!)
            throw new Error("Browser input is outside the viewport");
        }
        if (tab.inputCount >= 32)
          throw new Error("Browser input queue is full");
        tab.inputCount++;
        const operation = tab.inputTail
          .catch(() => {})
          .then(() => {
            if (!tab.stream.owns(input.token, sender) || contents.isDestroyed())
              throw new Error("Browser input surface is no longer active");
            return this.options.input(input.threadId, contents.id, input.input);
          })
          .finally(() => {
            tab.inputCount--;
          });
        tab.inputTail = operation;
        await operation;
        break;
    }
    return this.snapshot(tab);
  }
  removeContents(contents: WebContents) {
    for (const tab of this.tabs.values()) {
      if (tab.window instanceof BrowserNativeWindow)
        tab.window.removeContents(contents.id);
      tab.stream.removeContents(contents);
    }
  }
  previewFailed(contents: WebContents, token: string, message: string) {
    for (const tab of this.tabs.values())
      if (tab.stream.owns(token, contents)) tab.stream.fail(new Error(message));
  }
  clearThread(threadId: string) {
    for (const tab of [...this.tabs.values()])
      if (tab.threadId === threadId) tab.window.destroy();
  }
  dispose() {
    for (const tab of [...this.tabs.values()]) tab.window.destroy();
  }
}
