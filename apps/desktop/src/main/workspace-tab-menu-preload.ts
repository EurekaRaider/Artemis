// 工作区"+"菜单子窗口 preload：页面零 Node、零业务 API，只透传两个信号——
// 尺寸上报（ready）与菜单项选择/取消（select，kind 由主进程校验路由）。
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("artemisMenu", {
  ready: (width: number, height: number) =>
    ipcRenderer.send("artemis:workspace-tab-menu-ready", width, height),
  select: (kind: string) =>
    ipcRenderer.send("artemis:workspace-tab-menu-select", kind),
});
