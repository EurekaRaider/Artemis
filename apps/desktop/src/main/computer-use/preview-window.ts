import { BrowserWindow, ipcMain, screen } from "electron";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ComputerPreviewState, AppLocale } from "@artemis/protocol";
import { IPC } from "../../shared/api.js";
import type { ComputerPreviewHost } from "./preview-host.js";

const document = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'none'"><style>
html,body{margin:0;height:100%;background:transparent;color:#e5e5e5;font:12px system-ui}
body{box-sizing:border-box;padding:8px;padding-left:16px;padding-top:16px;-webkit-app-region:drag}
body::after{content:"";position:absolute;left:16px;top:16px;width:196px;height:128px;border-radius:4px;z-index:1;pointer-events:none;backdrop-filter:blur(10px);mask-image:radial-gradient(ellipse at 30% 30%,#000 30%,transparent 72%);opacity:0;transition:opacity 120ms ease}
button{position:absolute;left:0;top:0;width:32px;height:32px;padding:4px;border:0;border-radius:6px;background:transparent;color:#b8b8b8;cursor:pointer;z-index:2;opacity:0;pointer-events:none;transition:opacity 120ms ease;-webkit-app-region:no-drag}
button:hover{color:#f4f4f4}body:hover::after,body:has(:focus-visible)::after,body:hover button,body:has(:focus-visible) button{opacity:1}body:hover button,body:has(:focus-visible) button{pointer-events:auto}button:focus-visible,canvas:focus-visible{outline:2px solid #aaa;outline-offset:-2px}
svg{width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
canvas{display:block;width:100%;height:100%;object-fit:contain;background:#151515;border-radius:4px;box-shadow:0 6px 24px #0002;cursor:grab;touch-action:none;-webkit-app-region:no-drag}canvas:active{cursor:grabbing}
#status{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
#status.visible{inset-inline:16px;top:50%;width:auto;height:auto;clip-path:none;white-space:normal;text-align:center;pointer-events:none}
#resize{position:absolute;inset-inline-end:8px;bottom:8px;width:16px;height:16px;cursor:nwse-resize;touch-action:none;-webkit-app-region:no-drag}
#resize:hover{border-inline-end:2px solid #ffffff80;border-bottom:2px solid #ffffff80;box-sizing:border-box}
</style><button id="hide"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 4 16 16M20 4 4 20"/></svg></button><canvas id="computer-preview-floating-canvas" role="button" tabindex="0"></canvas><span id="status" role="status"></span><div id="resize" aria-hidden="true"></div>`;

export class ComputerPreviewWindow {
  private window: BrowserWindow | undefined;
  private attached: BrowserWindow | undefined;
  private ready = false;
  private current: ComputerPreviewState | undefined;
  private token: string | undefined;
  private states: ComputerPreviewState[] = [];
  private enabled = true;
  private threadId: string | undefined;
  constructor(
    private readonly options: {
      main(): BrowserWindow | undefined;
      host(): ComputerPreviewHost | undefined;
      locale(): AppLocale;
    },
  ) {
    ipcMain.on(
      IPC.computerPreviewFloating,
      (
        event,
        input: {
          action?: string;
          sessionId?: string;
          width?: number;
          height?: number;
          x?: number;
          y?: number;
        },
      ) => {
        if (
          !this.window ||
          event.sender !== this.window.webContents ||
          event.senderFrame !== event.sender.mainFrame ||
          !input ||
          typeof input !== "object"
        )
          return;
        if (input.action === "ready") {
          this.ready = true;
          this.sync();
          return;
        }
        if (!this.current || input.sessionId !== this.current.sessionId) return;
        if (input.action === "move") {
          if (!Number.isSafeInteger(input.x) || !Number.isSafeInteger(input.y))
            return;
          const bounds = this.window.getBounds();
          const workArea = screen.getDisplayMatching({
            ...bounds,
            x: input.x!,
            y: input.y!,
          }).workArea;
          this.window.setPosition(
            Math.max(
              workArea.x,
              Math.min(input.x!, workArea.x + workArea.width - bounds.width),
            ),
            Math.max(
              workArea.y,
              Math.min(input.y!, workArea.y + workArea.height - bounds.height),
            ),
          );
        } else if (input.action === "resize") {
          if (
            !Number.isSafeInteger(input.width) ||
            !Number.isSafeInteger(input.height)
          )
            return;
          const workArea = screen.getDisplayMatching(
            this.window.getBounds(),
          ).workArea;
          this.window.setSize(
            Math.max(272, Math.min(input.width!, workArea.width)),
            Math.max(168, Math.min(input.height!, workArea.height)),
          );
        } else if (input.action === "hide" || input.action === "expand")
          this.options
            .host()
            ?.command(
              { action: input.action, sessionId: this.current.sessionId },
              event.sender,
            );
      },
    );
  }
  update(states: ComputerPreviewState[]) {
    this.states = states;
    this.sync();
  }
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    this.sync();
  }
  setThread(threadId: string | undefined) {
    this.threadId = threadId;
    this.sync();
  }
  private detach() {
    if (this.token && this.window && !this.window.isDestroyed())
      this.options
        .host()
        ?.command(
          { action: "unsubscribe", token: this.token },
          this.window.webContents,
        );
    this.token = undefined;
    this.current = undefined;
  }
  private sync() {
    const main = this.options.main();
    if (main && this.attached !== main) {
      this.attached = main;
      main.on("focus", () => this.sync());
      main.on("blur", () => this.sync());
      main.on("minimize", () => this.sync());
      main.on("hide", () => this.sync());
      main.once("closed", () => this.dispose());
    }
    const state = this.states.find(
      (value) =>
        value.threadId === this.threadId &&
        value.state !== "hidden" &&
        value.state !== "ended",
    );
    if (
      !this.enabled ||
      !main ||
      main.isDestroyed() ||
      main.isFocused() ||
      !state
    ) {
      this.detach();
      this.window?.hide();
      return;
    }
    if (!this.window || this.window.isDestroyed()) {
      const workArea = screen.getDisplayMatching(main.getBounds()).workArea;
      this.window = new BrowserWindow({
        show: false,
        width: 368,
        height: 244,
        minWidth: 272,
        minHeight: 168,
        x: workArea.x + workArea.width - 392,
        y: workArea.y + workArea.height - 268,
        frame: false,
        transparent: true,
        backgroundColor: "#00000000",
        hasShadow: false,
        focusable: false,
        // Transparent windows use the small custom resize corner on both platforms.
        resizable: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        webPreferences: {
          preload: join(import.meta.dirname, "computer-preview-preload.cjs"),
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webSecurity: true,
          backgroundThrottling: false,
        },
      });
      this.ready = false;
      this.window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      this.window.webContents.on("will-navigate", (event) =>
        event.preventDefault(),
      );
      const contents = this.window.webContents;
      this.window.on("close", () => this.detach());
      contents.on("render-process-gone", () =>
        this.options.host()?.removeContents(contents),
      );
      this.window.once("closed", () => {
        this.options.host()?.removeContents(contents);
        this.token = undefined;
        this.current = undefined;
        this.ready = false;
      });
      void this.window.loadURL(
        `data:text/html,${encodeURIComponent(document)}`,
      );
    }
    if (!this.ready) return;
    if (this.current?.sessionId !== state.sessionId || !this.token) {
      this.detach();
      this.current = state;
      this.token = randomUUID();
      this.window.webContents.send(IPC.computerPreviewFloating, {
        state,
        token: this.token,
        locale: this.options.locale(),
        position: this.window.getPosition(),
      });
      this.options.host()?.command(
        {
          action: "subscribe",
          sessionId: state.sessionId,
          token: this.token,
        },
        this.window.webContents,
      );
    } else
      this.window.webContents.send(IPC.computerPreviewFloating, {
        state,
        token: this.token,
        locale: this.options.locale(),
        position: this.window.getPosition(),
      });
    if (!this.window.isVisible()) this.window.showInactive();
  }
  dispose() {
    this.detach();
    this.window?.destroy();
    this.window = undefined;
  }
}
