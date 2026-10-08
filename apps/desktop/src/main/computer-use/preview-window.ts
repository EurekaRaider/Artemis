import { BrowserWindow, ipcMain, screen } from "electron";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ComputerPreviewState, AppLocale } from "@artemis/protocol";
import { IPC } from "../../shared/api.js";
import type { ComputerPreviewHost } from "./preview-host.js";

const document = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'none'"><style>
body{margin:0;background:#171b23;color:#f4f6fa;font:12px system-ui;display:flex;flex-direction:column;height:100vh}header{display:flex;align-items:center;gap:6px;padding:8px;-webkit-app-region:drag}#name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}button{-webkit-app-region:no-drag;font:inherit;border:0;border-radius:6px;background:#ffffff18;color:inherit;padding:5px;cursor:pointer}canvas{width:100%;min-height:0;flex:1;object-fit:contain;background:#10141b}footer{display:flex;align-items:center;padding:6px;gap:6px}#status{flex:1;font-size:10px}</style>
<header><span id="name"></span><button id="expand"></button><button id="hide"></button></header><canvas id="computer-preview-floating-canvas"></canvas><footer><span id="status"></span><button id="control"></button></footer>`;

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
      control(action: "stop" | "resume", threadId: string): void;
    },
  ) {
    ipcMain.on(
      IPC.computerPreviewFloating,
      (event, input: { action?: string; sessionId?: string }) => {
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
        if (input.action === "stop" || input.action === "resume")
          this.options.control(input.action, this.current.threadId);
        else if (input.action === "hide" || input.action === "expand")
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
        width: 360,
        height: 260,
        minWidth: 260,
        minHeight: 200,
        x: workArea.x + workArea.width - 384,
        y: workArea.y + workArea.height - 284,
        frame: false,
        focusable: false,
        resizable: true,
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
      });
    if (!this.window.isVisible()) this.window.showInactive();
  }
  dispose() {
    this.detach();
    this.window?.destroy();
    this.window = undefined;
  }
}
