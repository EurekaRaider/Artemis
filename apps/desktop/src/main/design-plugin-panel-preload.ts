// design-plugin 面板 preload：只做 port 搬运（官方 message-ports 教程的
// main-world-port 模式）。webContents.postMessage 只送达 isolated world，
// preload 等页面 load 后用 window.postMessage 把 port 转移到 main world。
// 面板页面脚本保持零 Node、零 IPC——本文件不含任何业务 API。
const { ipcRenderer } = require("electron");

// DOMContentLoaded 即转发：window.onload 要等全部子资源（页面里几十个
// 缩略图 iframe）加载完才触发，原型页会让它长时间甚至永久不触发，port
// 迟迟不转移、面板全哑。DOMContentLoaded 时页面顶层脚本（消息监听）已
// 解析执行，转发不丢。
const windowLoaded = new Promise<void>((resolve) => {
  if (document.readyState !== "loading") {
    resolve();
  } else {
    document.addEventListener("DOMContentLoaded", () => resolve(), {
      once: true,
    });
  }
});

ipcRenderer.on("artemis:port", async (event: Electron.IpcRendererEvent) => {
  await windowLoaded;
  window.postMessage("artemis:port", "*", event.ports);
});
