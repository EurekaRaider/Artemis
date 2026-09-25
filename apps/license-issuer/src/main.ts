import { app, BrowserWindow, clipboard, dialog, ipcMain } from "electron";
import { readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { KeyObject } from "node:crypto";
import {
  issue,
  newVault,
  publicConfiguration,
  unlockVault,
} from "./signing.js";

let key: KeyObject | undefined;
let output = "";
let window: BrowserWindow;
let busy = false;
const state = (message = "请输入口令创建新私钥，或打开已有私钥。") => ({
  keyId: key ? Object.keys(publicConfiguration(key))[0] : null,
  output,
  message,
});
async function save(title: string, defaultPath: string, content: string) {
  const selection = await dialog.showSaveDialog(window, { title, defaultPath });
  if (selection.canceled || !selection.filePath) return false;
  await writeFile(selection.filePath, content, { mode: 0o600 });
  return true;
}
void app.whenReady().then(async () => {
  window = new BrowserWindow({
    width: 740,
    height: 850,
    minWidth: 580,
    minHeight: 650,
    title: "Artemis License Issuer",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      devTools: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  const actions: Record<string, (input: unknown) => unknown> = {
    status: () => state(),
    create: async (input) => {
      const password = String(input ?? "");
      const pem = newVault(password);
      if (
        await save(
          "保存加密私钥（仅你保管，切勿发给用户）",
          "artemis-signing-key.pem",
          pem,
        )
      ) {
        key = unlockVault(pem, password);
        output = "";
        return state("私钥已创建、保存并解锁。现在可以导出构建公钥配置。");
      }
      return state("已取消创建私钥，没有保存新私钥。");
    },
    unlock: async (input) => {
      const result = await dialog.showOpenDialog(window, {
        title: "选择你的加密签发私钥",
        properties: ["openFile"],
        filters: [{ name: "Encrypted private key", extensions: ["pem"] }],
      });
      if (!result.canceled && result.filePaths[0]) {
        if ((await stat(result.filePaths[0])).size > 16384)
          throw new Error("私钥文件过大。");
        key = unlockVault(
          await readFile(result.filePaths[0], "utf8"),
          String(input ?? ""),
        );
        output = "";
        return state("私钥已解锁，可以签发注册码或导出公钥。");
      }
      return state("已取消打开私钥。");
    },
    lock: () => {
      const wasUnlocked = Boolean(key);
      key = undefined;
      output = "";
      return state(
        wasUnlocked
          ? "私钥已锁定，签发前需要重新解锁。"
          : "当前已是锁定状态，尚未解锁私钥。",
      );
    },
    public: async () => {
      if (!key) throw new Error("请先解锁签发私钥。");
      const saved = await save(
        "导出给 Artemis 构建使用的公钥配置",
        "license-public-keys.json",
        JSON.stringify(publicConfiguration(key), null, 2) + "\n",
      );
      return state(saved ? "构建公钥配置已导出。" : "已取消导出构建公钥配置。");
    },
    issue: (input) => {
      if (!key) throw new Error("请先解锁签发私钥。");
      if (!input || typeof input !== "object") throw new Error("输入无效。");
      const value = input as {
        device?: unknown;
        expiresAt?: unknown;
        recovery?: unknown;
      };
      if (
        typeof value.device !== "string" ||
        typeof value.expiresAt !== "number"
      )
        throw new Error("输入无效。");
      if (value.recovery !== undefined) {
        if (typeof value.recovery !== "string" || value.recovery.length > 4096)
          throw new Error("恢复请求无效。");
        const request = JSON.parse(value.recovery) as {
          device: string;
          challenge: string;
        };
        output = issue(key, {
          device: request.device,
          expiresAt: Date.now() + 24 * 60 * 60 * 1000,
          recovery: { challenge: request.challenge },
        });
      } else
        output = issue(key, {
          device: value.device.trim(),
          expiresAt: value.expiresAt,
        });
      return state(
        value.recovery !== undefined
          ? "恢复凭证已生成，可以复制或导出。"
          : "注册码已生成，可以复制或导出。",
      );
    },
    copy: () => {
      if (!output) throw new Error("请先生成注册码。");
      clipboard.writeText(output);
      return state("已复制生成结果。");
    },
    export: async () => {
      if (!output) throw new Error("请先生成注册码。");
      const saved = await save(
        "导出许可证",
        "Artemis.artemis-license",
        output + "\n",
      );
      return state(saved ? "许可证文件已导出。" : "已取消导出许可证文件。");
    },
  };
  ipcMain.handle(
    "issuer:action",
    async (event, action: unknown, input: unknown) => {
      if (
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame ||
        typeof action !== "string" ||
        !Object.hasOwn(actions, action)
      )
        throw new Error("Unauthorized");
      if (busy) throw new Error("请等待当前操作完成。");
      busy = true;
      try {
        return await actions[action]!(input);
      } finally {
        busy = false;
      }
    },
  );
  await window.loadFile(join(__dirname, "index.html"));
});
app.on("window-all-closed", () => {
  key = undefined;
  app.quit();
});
