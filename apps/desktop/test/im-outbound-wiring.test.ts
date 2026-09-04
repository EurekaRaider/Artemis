import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const main = readFileSync(join(root, "src/main/main.ts"), "utf8");
const worker = readFileSync(join(root, "src/agent/agent-worker.ts"), "utf8");

/** 取顶层 function 声明到下一个顶层 function 之间的源码切片。 */
function topLevelFunction(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  expect(start, `main.ts 缺少顶层函数 ${name}`).toBeGreaterThan(-1);
  const next = source.indexOf("\nfunction ", start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}

// 回归：agent worker 的流式 turn 事件全部经 AgentEventBatcher 走批量路径
// （onEvents → emitPayloadBatch），单发路径 emitPayload 只覆盖 main 侧事件。
// 批量路径一旦漏掉 IM 扇出，绑定频道将收不到任何模型回复
// （真机缺陷：桌面 UI 正常、飞书端静默）。
describe("IM outbound wiring (E5)", () => {
  it("agent worker streams turn events through the batch path", () => {
    expect(worker).toContain("AgentEventBatcher");
    expect(worker).toContain('send({ type: "events", events })');
  });

  it("single and batch emit paths share the persisted-payload fan-out", () => {
    const single = topLevelFunction(main, "emitPayload");
    const batch = topLevelFunction(main, "emitPayloadBatch");
    const fanOut = topLevelFunction(main, "fanOutPersistedPayload");

    expect(single).toContain("fanOutPersistedPayload(");
    expect(batch).toContain("fanOutPersistedPayload(");
    // IM 出站订阅必须位于共用扇出内，两条持久化路径不可再分叉
    expect(fanOut).toContain("imService?.onAgentEvent(");
  });
});
