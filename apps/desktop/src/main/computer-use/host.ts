import {
  dialog,
  webContents,
  type BrowserWindow,
  type WebContents,
} from "electron";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ComputerTarget } from "@artemis/protocol";
import { IPC } from "../../shared/api.js";
import { ComputerBrowserDriver } from "./browser-driver.js";
import { ComputerNativeDriver } from "./native-driver.js";
import { ComputerMcpServer } from "./mcp-server.js";
import { ComputerUseService, type ComputerContext } from "./service.js";

export class ComputerUseHost {
  readonly service: ComputerUseService;
  readonly server: ComputerMcpServer;
  readonly native: ComputerNativeDriver;
  private readonly browser: ComputerBrowserDriver;
  private readonly waitingBrowsers = new Map<
    string,
    (contents: WebContents) => void
  >();
  private readonly once = new Set<string>();
  private grants: Record<string, string> = {};
  private loaded: Promise<void> | undefined;
  private saving: Promise<void> = Promise.resolve();
  constructor(
    private readonly options: {
      helperPath: string;
      permissionsPath: string;
      window(): BrowserWindow | undefined;
      chinese(): boolean;
    },
  ) {
    this.native = new ComputerNativeDriver(options.helperPath, () =>
      this.service.stopDesktop("User took control or helper exited"),
    );
    this.browser = new ComputerBrowserDriver(
      (context, signal) => this.requestBrowser(context, signal),
      (threadId) => this.service.stopThread(threadId, "User took control"),
    );
    this.service = new ComputerUseService({
      drivers: { browser: this.browser, desktop: this.native },
      authorize: (target, context, signal) =>
        this.authorize(target, context, signal),
      publish: (state) => {
        const window = this.options.window();
        if (window && !window.isDestroyed())
          window.webContents.send(IPC.computerState, state);
      },
    });
    this.server = new ComputerMcpServer(this.service);
  }
  private load() {
    return (this.loaded ??= (async () => {
      try {
        const data = JSON.parse(
          await readFile(this.options.permissionsPath, "utf8"),
        );
        if (
          data.version === 1 &&
          data.grants &&
          typeof data.grants === "object"
        )
          this.grants = Object.fromEntries(
            Object.entries(data.grants).filter(
              (entry): entry is [string, string] =>
                /^(browser|desktop:[A-Za-z0-9._-]+)$/u.test(entry[0]) &&
                typeof entry[1] === "string",
            ),
          );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    })());
  }
  private save() {
    this.saving = this.saving
      .catch(() => {})
      .then(async () => {
        const path = this.options.permissionsPath;
        await mkdir(dirname(path), { recursive: true });
        await writeFile(
          `${path}.tmp`,
          JSON.stringify({ version: 1, grants: this.grants }),
          { mode: 0o600 },
        );
        await rename(`${path}.tmp`, path);
      });
    return this.saving;
  }
  async permissions() {
    await this.load();
    return Object.entries(this.grants).map(([id, name]) => ({ id, name }));
  }
  async revoke(id: string) {
    await this.load();
    delete this.grants[id];
    this.once.clear();
    this.service.stopAll("Permission revoked");
    this.native.dispose();
    await this.save();
  }
  private async authorize(
    target: ComputerTarget,
    context: ComputerContext,
    signal: AbortSignal,
  ) {
    await this.load();
    signal.throwIfAborted();
    const key =
      target.kind === "browser" ? "browser" : `desktop:${target.bundleId}`;
    const once = `${context.threadId}:${context.turnId}:${key}`;
    if (!this.grants[key] && !this.once.has(once)) {
      const window = this.options.window();
      if (!window || window.isDestroyed()) return false;
      const zh = this.options.chinese();
      const result = await dialog.showMessageBox(window, {
        type: "question",
        title: "Computer Use",
        message: zh
          ? `允许 Artemis 操作 ${target.name}？`
          : `Allow Artemis to use ${target.name}?`,
        detail: zh
          ? "可以读取窗口内容、截图和操作控件。应用内操作仍遵循当前任务的审批规则。你可随时在控制条停止或撤销授权。"
          : "Allow window reading, screenshots and control. Actions still follow this task's approval policy. You can stop or revoke access from the control bar.",
        buttons: zh
          ? ["仅本轮允许", "始终允许", "拒绝"]
          : ["Allow this turn", "Always allow", "Deny"],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
        signal,
      });
      signal.throwIfAborted();
      if (result.response === 2) return false;
      if (result.response === 1) {
        this.grants[key] = target.name;
        await this.save();
      } else this.once.add(once);
    }
    if (target.kind === "desktop") {
      let permissions = await this.native.permissions(false, signal);
      if (!permissions.accessibility || !permissions.screenRecording)
        permissions = await this.native.permissions(true, signal);
      if (!permissions.accessibility || !permissions.screenRecording)
        throw new Error(
          "Enable Accessibility and Screen Recording for Artemis in macOS System Settings, then retry computer_open.",
        );
    }
    return true;
  }
  registerBrowser(sender: WebContents, threadId: string, contentsId: number) {
    const owner = this.options.window()?.webContents;
    const contents = webContents.fromId(contentsId);
    if (
      !owner ||
      sender.id !== owner.id ||
      !contents ||
      contents.getType() !== "webview" ||
      contents.hostWebContents?.id !== owner.id
    )
      throw new Error("Browser ownership validation failed.");
    this.browser.register(contents, threadId);
    this.waitingBrowsers.get(threadId)?.(contents);
  }
  private requestBrowser(
    context: ComputerContext,
    signal: AbortSignal,
  ): Promise<WebContents> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        this.waitingBrowsers.delete(context.threadId);
      };
      const abort = () => {
        cleanup();
        reject(new Error("Opening the browser was cancelled."));
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Open the Browser panel for this task and retry."));
      }, 10000);
      signal.addEventListener("abort", abort, { once: true });
      this.waitingBrowsers.set(context.threadId, (contents) => {
        cleanup();
        resolve(contents);
      });
      this.options
        .window()
        ?.webContents.send(IPC.computerBrowserOpen, context.threadId);
    });
  }
  endTurn(threadId: string) {
    this.service.stopThread(threadId, "Turn ended");
    for (const grant of this.once)
      if (grant.startsWith(`${threadId}:`)) this.once.delete(grant);
  }
  dispose() {
    this.server.dispose();
    this.native.dispose();
    this.once.clear();
  }
}
