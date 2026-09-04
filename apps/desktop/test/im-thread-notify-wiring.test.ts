import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const main = readFileSync(join(root, "src/main/main.ts"), "utf8");
const preload = readFileSync(join(root, "src/preload/preload.ts"), "utf8");
const api = readFileSync(join(root, "src/shared/api.ts"), "utf8");
const app = readFileSync(join(root, "src/renderer/App.tsx"), "utf8");
const manager = readFileSync(
  join(root, "../../packages/im/src/manager.ts"),
  "utf8",
);

/** 取起始标记到结束标记之间的源码切片。 */
function region(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  expect(start, `源码缺少标记 ${startMarker}`).toBeGreaterThan(-1);
  const end = source.indexOf(endMarker, start);
  expect(end, `源码缺少结束标记 ${endMarker}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

// 回归（D20，真机缺陷）：主进程侧创建 IM 线程（配对批准/绑定线程消失重建）
// 后必须推送渲染层。渲染层 getSnapshot 仅挂载时拉取——不推送则删除会话后
// 从飞书重发消息，主进程已重建线程并跑完 turn、飞书已收到回复，
// 左侧抽屉却直到重启都不出现新会话。
describe("IM thread-created notification wiring (D20)", () => {
  it("main: imHost.createThread 成功后发送 IPC.imThreadCreated", () => {
    const block = region(
      main,
      "createThread: async (input: { title: string; workspaceKey: string })",
      "getThreadStatus:",
    );
    expect(block).toContain("IPC.imThreadCreated");
    expect(block).toContain("threadId: thread.id");
  });

  it("api + preload 暴露 onIMThreadCreated 订阅通道", () => {
    expect(api).toContain('imThreadCreated: "artemis:im-thread-created"');
    expect(api).toContain("onIMThreadCreated?(");
    expect(preload).toContain("ipcRenderer.on(IPC.imThreadCreated");
  });

  it("App: 订阅 onIMThreadCreated → 刷新 snapshot + IM 徽标健康", () => {
    const block = region(
      app,
      "onIMThreadCreated?.(() => {",
      "[refreshIMThreadHealth]",
    );
    expect(block).toContain("getSnapshot()");
    expect(block).toContain("preserveLoadedEvents");
    expect(block).toContain("refreshIMThreadHealth()");
  });
});

// 回归（D19，真机缺陷）：纯图片消息文本被剥离为空串后，manager 路由层曾按
// 空文本丢弃——图片永远进不了线程。必须仅当文本与附件都为空时才丢弃。
describe("IM empty-text-with-attachments routing (D19)", () => {
  it("manager: 空文本 + 附件改走 message 路径", () => {
    const block = region(
      manager,
      "let route = routeInboundText(msg.text, hasPending);",
      "switch (route.kind)",
    );
    expect(block).toContain("msg.attachments.length > 0");
    expect(block).toContain('kind: "message"');
  });
});
