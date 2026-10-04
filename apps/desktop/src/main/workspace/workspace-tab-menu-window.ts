// 工作区"+"菜单的承载子窗口。
// 设计面板是原生 WebContentsView，永远画在主窗口全部 HTML 之上——主窗口里
// 的 HTML 菜单会被它盖住（原生 Menu.popup 又是系统观感）。不动插件沙箱架构
// 的唯一解法：把应用自绘的菜单 HTML 放进一个透明子窗口——子窗口是独立原生
// 层，浮于父窗口一切内容（含设计面板）之上，观感与主窗口 HTML 菜单一致。
// 生命周期：选择/Escape 由页面经 preload 信号回传；点外部=blur 即关；父窗
// 口移动即关（菜单位置是开窗时的屏幕坐标，不跟随）。
import { BrowserWindow, screen } from "electron";
import { join } from "node:path";

const SHADOW_PAD = 24;
const REOPEN_GUARD_MS = 220;

interface WorkspaceTabMenuHandlers {
  onSelect: (kind: string) => void;
  onDismiss: () => void;
}

let menuWindow: BrowserWindow | undefined;
let menuParent: BrowserWindow | undefined;
let lastClosedAt = 0;
let handlers: WorkspaceTabMenuHandlers | undefined;

export function setWorkspaceTabMenuHandlers(
  next: WorkspaceTabMenuHandlers,
): void {
  handlers = next;
}

/** 最近一次打开菜单的父窗口（选择/关闭回包都发给它；窗口销毁后为 undefined）。 */
export function workspaceTabMenuParent(): BrowserWindow | undefined {
  if (!menuParent || menuParent.isDestroyed()) return undefined;
  return menuParent;
}

export function closeWorkspaceTabMenu(): void {
  if (menuWindow && !menuWindow.isDestroyed()) menuWindow.destroy();
}

function finishClosed(win: BrowserWindow): void {
  if (menuWindow !== win) return;
  menuWindow = undefined;
  lastClosedAt = Date.now();
  handlers?.onDismiss();
}

export async function showWorkspaceTabMenu(
  parent: BrowserWindow,
  input: { html: string; anchorRight: number; anchorTop: number },
): Promise<void> {
  // 菜单开着时点"+"= 关闭（原生菜单语义）。blur 通常已先行关掉窗口，紧跟
  // 的重开请求必须吞掉，否则用户看到"关了又开"；被吞时同步复位按钮态。
  if (menuWindow) {
    closeWorkspaceTabMenu();
    return;
  }
  if (Date.now() - lastClosedAt < REOPEN_GUARD_MS) {
    handlers?.onDismiss();
    return;
  }
  const win = new BrowserWindow({
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    roundedCorners: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    parent,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: join(__dirname, "workspace-tab-menu-preload.cjs"),
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });
  menuWindow = win;
  menuParent = parent;
  win.on("closed", () => finishClosed(win));
  win.on("blur", () => {
    if (!win.isDestroyed()) win.close();
  });
  const onParentMove = () => {
    if (!win.isDestroyed()) win.close();
  };
  parent.on("move", onParentMove);
  win.on("closed", () => parent.removeListener("move", onParentMove));

  win.webContents.on("ipc-message", (_event, channel, ...args) => {
    if (win.isDestroyed()) return;
    if (channel === "artemis:workspace-tab-menu-ready") {
      const width =
        Math.max(1, Math.ceil(Number(args[0]) || 1)) + SHADOW_PAD * 2;
      const height =
        Math.max(1, Math.ceil(Number(args[1]) || 1)) + SHADOW_PAD * 2;
      const bounds = parent.getContentBounds();
      // 右缘对齐"+"按钮右缘、顶缘在按钮下方——复刻旧 HTML 菜单的
      // right:0/top 视觉。屏幕坐标 = 窗口内容区原点 + 窗口内 CSS 坐标。
      let x = Math.round(bounds.x + input.anchorRight - width + SHADOW_PAD);
      let y = Math.round(bounds.y + input.anchorTop - SHADOW_PAD);
      const area = screen.getDisplayMatching(bounds).workArea;
      x = Math.min(Math.max(x, area.x), area.x + area.width - width);
      y = Math.min(Math.max(y, area.y), area.y + area.height - height);
      win.setBounds({ x, y, width, height });
      win.show();
    } else if (channel === "artemis:workspace-tab-menu-select") {
      const kind = String(args[0] ?? "");
      win.destroy();
      finishClosed(win);
      if (kind && kind !== "__dismiss") handlers?.onSelect(kind);
    }
  });

  await win.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(input.html)}`,
  );
}
