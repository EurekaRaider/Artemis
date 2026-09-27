import {
  dialog,
  nativeTheme,
  webContents,
  type BrowserWindow,
  type WebContents,
  type MessageBoxOptions,
  type MessageBoxReturnValue,
} from "electron";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { computerActSchema, type ComputerTarget } from "@artemis/protocol";
import { IPC, type ComputerPermission } from "../../shared/api.js";
import { ComputerBrowserDriver } from "./browser-driver.js";
import { ComputerNativeDriver } from "./native-driver.js";
import { ComputerMcpServer } from "./mcp-server.js";
import { ComputerUseService, type ComputerContext } from "./service.js";

interface SessionPermission extends ComputerPermission {
  scope: "turn" | "task";
  threadId: string;
  turnId: string;
  key: string;
}
function appKey(target: ComputerTarget) {
  return target.kind === "browser" ? "browser" : `desktop:${target.bundleId}`;
}
function choiceKey(context: ComputerContext, key: string) {
  return `${context.threadId}\0${context.turnId}\0${key}`;
}

export class ComputerUseHost {
  readonly service: ComputerUseService;
  readonly server: ComputerMcpServer;
  readonly native: ComputerNativeDriver;
  private readonly browser: ComputerBrowserDriver;
  private readonly waitingBrowsers = new Map<
    string,
    (contents: WebContents) => void
  >();
  private readonly sessionPermissions = new Map<string, SessionPermission>();
  private readonly denied = new Set<string>();
  private readonly legacyChoices = new Set<string>();
  private readonly foregroundChoices = new Map<string, boolean>();
  private readonly pending = new Map<
    string,
    {
      context: ComputerContext;
      key: string;
      controller: AbortController;
      promise: Promise<MessageBoxReturnValue>;
    }
  >();
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
    this.native = new ComputerNativeDriver(
      options.helperPath,
      (reason) => this.service.stopDesktop(reason),
      () => (options.chinese() ? "停止" : "Stop"),
      () => nativeTheme.shouldUseDarkColors,
    );
    this.browser = new ComputerBrowserDriver(
      (context, signal) => this.requestBrowser(context, signal),
      (threadId, targetId) =>
        this.service.stopTargets(
          (target) => target.id === targetId,
          threadId,
          "User took control",
        ),
    );
    this.service = new ComputerUseService({
      drivers: { browser: this.browser, desktop: this.native },
      authorize: (target, context, signal) =>
        this.authorize(target, context, signal),
      authorizeForeground: (target, context, signal) =>
        this.authorizeForeground(target, context, signal),
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
  async permissions(): Promise<ComputerPermission[]> {
    await this.load();
    return [
      ...Object.entries(this.grants).map(([id, name]) => ({
        id,
        name,
        scope: "persistent" as const,
        foreground: false,
      })),
      ...[...this.sessionPermissions.values()].map(
        ({ key: _key, turnId: _turnId, ...permission }) => permission,
      ),
    ];
  }
  async revoke(id: string) {
    await this.load();
    const permission = this.sessionPermissions.get(id);
    if (permission) {
      this.sessionPermissions.delete(id);
      this.cancelPending(
        (p) =>
          p.context.threadId === permission.threadId &&
          p.key === permission.key,
      );
      this.service.stopTargets(
        (target) => appKey(target) === permission.key,
        permission.threadId,
      );
    } else if (Object.hasOwn(this.grants, id)) {
      delete this.grants[id];
      this.cancelPending((p) => p.key === id);
      this.service.stopTargets((target) => appKey(target) === id);
      await this.save();
    }
  }
  private permission(target: ComputerTarget, context: ComputerContext) {
    return [...this.sessionPermissions.values()].find(
      (p) =>
        p.key === appKey(target) &&
        p.threadId === context.threadId &&
        (p.scope === "task" || p.turnId === context.turnId),
    );
  }
  taskApproval(
    name: string,
    args: Record<string, unknown>,
    context: ComputerContext,
  ): string | undefined {
    if (name !== "computer_act") return;
    const input = computerActSchema.safeParse(args);
    if (!input.success) return;
    const target = this.service.targetForApproval(input.data, context);
    const permission = target && this.permission(target, context);
    return permission?.scope === "task" ? permission.id : undefined;
  }
  private cancelPending(
    matches: (pending: { context: ComputerContext; key: string }) => boolean,
  ) {
    for (const pending of this.pending.values())
      if (matches(pending))
        pending.controller.abort(new Error("Permission revoked"));
  }
  private ask(
    target: ComputerTarget,
    context: ComputerContext,
    signal: AbortSignal,
    kind: string,
    options: MessageBoxOptions,
  ) {
    const key = appKey(target);
    const id = `${choiceKey(context, key)}\0${kind}`;
    const existing = this.pending.get(id);
    if (existing) return existing.promise;
    const window = this.options.window();
    if (!window || window.isDestroyed())
      throw new Error("Artemis window is unavailable.");
    const controller = new AbortController();
    const combined = AbortSignal.any([signal, controller.signal]);
    const promise = dialog
      .showMessageBox(window, { ...options, signal: combined })
      .then((result) => {
        combined.throwIfAborted();
        return result;
      })
      .finally(() => {
        if (this.pending.get(id)?.controller === controller)
          this.pending.delete(id);
      });
    this.pending.set(id, { context, key, controller, promise });
    return promise;
  }
  private async authorize(
    target: ComputerTarget,
    context: ComputerContext,
    signal: AbortSignal,
  ) {
    await this.load();
    signal.throwIfAborted();
    const key = appKey(target);
    const choice = choiceKey(context, key);
    if (this.denied.has(choice)) return false;
    const legacy = `${context.threadId}\0${key}`;
    if (
      !this.permission(target, context) &&
      !(this.grants[key] && this.legacyChoices.has(legacy))
    ) {
      const zh = this.options.chinese();
      const result = await this.ask(target, context, signal, "access", {
        type: "question",
        title: "Computer Use",
        message: zh
          ? `允许 Artemis 操作 ${target.name}？`
          : `Allow Artemis to use ${target.name}?`,
        detail: zh
          ? "可读取窗口、截图和操作控件。本任务自主操作：在当前 Artemis 运行期间跨轮有效，明确属于你请求的操作由模型判断风险后执行。仅本轮或长期应用访问继续使用现有审批规则。可随时停止或在设置中撤销。前台操作会打断你当前的输入。"
          : "Allow window reading, screenshots and control. Task autonomy lasts across turns until Artemis exits: the model checks risk before performing actions explicitly covered by your request. Turn-only or remembered app access keeps the existing approval policy. Stop anytime or revoke in Settings. Foreground control interrupts your input.",
        buttons: zh
          ? [
              this.grants[key] ? "沿用已有应用授权" : "仅本轮允许",
              "允许本任务自主操作",
              "记住应用访问许可",
              "拒绝",
            ]
          : [
              this.grants[key] ? "Use existing app access" : "Allow this turn",
              "Allow task autonomy",
              "Remember app access",
              "Deny",
            ],
        ...(target.kind === "desktop"
          ? {
              checkboxLabel: zh
                ? "同时允许前台操作（本轮或本任务有效）"
                : "Also allow foreground control (for this turn or task)",
              checkboxChecked: false,
            }
          : {}),
        defaultId: 0,
        cancelId: 3,
        noLink: true,
        signal,
      });
      signal.throwIfAborted();
      if (result.response === 3) {
        this.denied.add(choice);
        return false;
      }
      if (result.response === 2) {
        this.grants[key] = target.name;
        await this.save();
        signal.throwIfAborted();
      }
      if (this.grants[key]) this.legacyChoices.add(legacy);
      const id = randomUUID();
      this.sessionPermissions.set(id, {
        id,
        name: target.name,
        scope: result.response === 1 ? "task" : "turn",
        foreground:
          target.kind === "desktop" && result.checkboxChecked === true,
        threadId: context.threadId,
        turnId: context.turnId,
        key,
      });
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
  private async authorizeForeground(
    target: ComputerTarget,
    context: ComputerContext,
    signal: AbortSignal,
  ) {
    signal.throwIfAborted();
    const permission = this.permission(target, context);
    if (permission) return permission.foreground;
    const key = choiceKey(context, appKey(target));
    if (this.foregroundChoices.has(key))
      return this.foregroundChoices.get(key)!;
    const window = this.options.window();
    if (!window || window.isDestroyed()) return false;
    signal.throwIfAborted();
    const zh = this.options.chinese();
    const result = await this.ask(target, context, signal, "foreground", {
      type: "question",
      title: "Computer Use",
      message: zh
        ? `允许将 ${target.name} 切到前台操作？`
        : `Allow foreground control of ${target.name}?`,
      detail: zh
        ? "此操作需要前台键盘或坐标输入，会打断你当前的操作。仅本轮有效；保持后台将跳过此操作。"
        : "This action needs foreground keyboard or coordinate input and will interrupt your work. Permission lasts for this turn only. Keeping background mode skips the action.",
      buttons: zh
        ? ["保持后台", "允许本轮前台操作"]
        : ["Keep background mode", "Allow foreground this turn"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      signal,
    });
    signal.throwIfAborted();
    const allowed = result.response === 1;
    this.foregroundChoices.set(key, allowed);
    return allowed;
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
    this.clearTurn(threadId);
  }
  private clearTurn(threadId: string) {
    this.cancelPending((p) => p.context.threadId === threadId);
    for (const [id, p] of this.sessionPermissions)
      if (p.threadId === threadId && p.scope === "turn")
        this.sessionPermissions.delete(id);
    for (const key of this.denied)
      if (key.startsWith(`${threadId}\0`)) this.denied.delete(key);
    for (const key of this.foregroundChoices.keys())
      if (key.startsWith(`${threadId}\0`)) this.foregroundChoices.delete(key);
  }
  clearTask(threadId: string, reason = "Task permission revoked") {
    this.service.stopThread(threadId, reason);
    this.clearTurn(threadId);
    for (const [id, p] of this.sessionPermissions)
      if (p.threadId === threadId) this.sessionPermissions.delete(id);
    for (const key of this.legacyChoices)
      if (key.startsWith(`${threadId}\0`)) this.legacyChoices.delete(key);
  }
  disable(reason: string) {
    this.cancelPending(() => true);
    this.service.stopAll(reason);
    this.sessionPermissions.clear();
    this.denied.clear();
    this.legacyChoices.clear();
    this.foregroundChoices.clear();
    this.native.dispose();
  }
  dispose() {
    this.disable("Computer Use disabled");
    this.server.dispose();
  }
}
