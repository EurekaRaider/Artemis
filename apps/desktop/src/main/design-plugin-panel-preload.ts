// design-plugin 面板 preload：只做 port 搬运（官方 message-ports 教程的
// main-world-port 模式）。webContents.postMessage 只送达 isolated world，
// preload 等页面 load 后用 window.postMessage 把 port 转移到 main world。
// 面板页面脚本保持零 Node、零 IPC——本文件不含任何业务 API。
const { ipcRenderer } = require("electron");

const windowLoaded = new Promise((resolve) => {
  window.onload = resolve;
});

ipcRenderer.on("artemis:port", async (event: Electron.IpcRendererEvent) => {
  await windowLoaded;
  window.postMessage("artemis:port", "*", event.ports);
});
