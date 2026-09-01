import { describe, expect, it } from "vitest";

import { createTurnTranslator, translateAgentPayload } from "../src/translate.js";

// 真实协议形状（packages/protocol/src/schema.ts，2026-09-01 核实）：
// - turn.completed: {type, reason:"completed"|"cancelled", finalPartId?} —— 无 text 字段
// - turn.failed:    {type, message, code?} —— 字段是 message 不是 error
// - 助手文本经 message.part.delta {partId, partType:"text"|"thinking", delta} 流式到达
// - 工具事件是 tool.started {toolCallId, toolName, input?} / tool.completed {toolCallId, output?, isError}

describe("translateAgentPayload 无状态事件（真实协议形状）", () => {
  it("turn.failed 读 message 字段，全模式都发", () => {
    for (const mode of ["summary", "verbose", "quiet"] as const) {
      const events = translateAgentPayload({ type: "turn.failed", message: "boom" }, mode);
      expect(events).toEqual([{ kind: "text", text: "执行失败：boom" }]);
    }
  });

  it("turn.failed 缺 message 时有兜底", () => {
    const events = translateAgentPayload({ type: "turn.failed" }, "summary");
    expect(events[0]?.kind).toBe("text");
    expect((events[0] as { text: string }).text).toContain("未知错误");
  });

  it("verbose：tool.started / tool.completed 发 tool_detail", () => {
    expect(
      translateAgentPayload(
        { type: "tool.started", toolCallId: "tc1", toolName: "shell", input: { command: "ls" } },
        "verbose",
      ),
    ).toEqual([
      { kind: "tool_detail", toolName: "shell", detail: expect.stringContaining("ls") },
    ]);
    const [done] = translateAgentPayload(
      { type: "tool.completed", toolCallId: "tc1", output: "ok", isError: true },
      "verbose",
    );
    expect(done).toMatchObject({ kind: "tool_detail", detail: "ok", isError: true });
  });

  it("summary/quiet：工具事件不发", () => {
    expect(
      translateAgentPayload({ type: "tool.started", toolCallId: "tc1", toolName: "shell" }, "summary"),
    ).toEqual([]);
    expect(
      translateAgentPayload({ type: "tool.completed", toolCallId: "tc1", output: "x", isError: false }, "quiet"),
    ).toEqual([]);
  });

  it("approval.requested 跳过（broker 拦截路径已发，避免双发）", () => {
    expect(translateAgentPayload({ type: "approval.requested" }, "verbose")).toEqual([]);
  });

  it("approval.resolved → approval_resolved 全模式发（双端互通）", () => {
    for (const mode of ["summary", "verbose", "quiet"] as const) {
      expect(
        translateAgentPayload({ type: "approval.resolved", approvalId: "ap-1", approved: true }, mode),
      ).toEqual([{ kind: "approval_resolved", approvalId: "ap-1", approved: true }]);
    }
  });

  it("message.part.delta / turn.completed 属有状态事件，单事件翻译忽略", () => {
    expect(
      translateAgentPayload({ type: "message.part.delta", partId: "p1", partType: "text", delta: "x" }, "summary"),
    ).toEqual([]);
    expect(translateAgentPayload({ type: "turn.completed", reason: "completed" }, "summary")).toEqual([]);
  });

  it("其他事件忽略", () => {
    expect(translateAgentPayload({ type: "thread.goal.updated" }, "summary")).toEqual([]);
  });
});

describe("createTurnTranslator turn 级聚合（用户症状回归：答复必须发出）", () => {
  it("summary：聚合 message.part.delta 文本，turn.completed 发全量答复", () => {
    const t = createTurnTranslator("summary");
    t.feed({ type: "turn.started", mode: "execute" });
    t.feed({ type: "message.part.delta", partId: "p1", partType: "text", delta: "当前目录有 " });
    t.feed({ type: "message.part.delta", partId: "p1", partType: "text", delta: "3 个文件。" });
    const events = t.feed({ type: "turn.completed", reason: "completed" });
    expect(events).toEqual([{ kind: "text", text: "当前目录有 3 个文件。" }]);
  });

  it("多个 text part 按序拼接；thinking part 不混入", () => {
    const t = createTurnTranslator("summary");
    t.feed({ type: "message.part.delta", partId: "p1", partType: "text", delta: "先查一下。" });
    t.feed({ type: "message.part.delta", partId: "t1", partType: "thinking", delta: "内部思考" });
    t.feed({ type: "message.part.delta", partId: "p2", partType: "text", delta: "结果如下。" });
    const events = t.feed({ type: "turn.completed", reason: "completed" });
    expect(events).toEqual([{ kind: "text", text: "先查一下。\n\n结果如下。" }]);
  });

  it("quiet：turn.completed 有文本也不发", () => {
    const t = createTurnTranslator("quiet");
    t.feed({ type: "message.part.delta", partId: "p1", partType: "text", delta: "答复" });
    expect(t.feed({ type: "turn.completed", reason: "completed" })).toEqual([]);
  });

  it("无文本的 turn.completed 不发空消息", () => {
    const t = createTurnTranslator("summary");
    t.feed({ type: "tool.started", toolCallId: "tc1", toolName: "shell" });
    const events = t.feed({ type: "turn.completed", reason: "completed" });
    expect(events.every((e) => e.kind !== "text")).toBe(true);
  });

  it("cancelled 时已聚合的部分文本仍发出（IM 侧不应沉默）", () => {
    const t = createTurnTranslator("summary");
    t.feed({ type: "message.part.delta", partId: "p1", partType: "text", delta: "半截答复" });
    const events = t.feed({ type: "turn.completed", reason: "cancelled" });
    expect(events).toEqual([{ kind: "text", text: "半截答复" }]);
  });

  it("summary：工具计数在 turn 边界产出 tool_summary（tool.started/completed 真实事件名）", () => {
    const t = createTurnTranslator("summary");
    t.feed({ type: "tool.started", toolCallId: "tc1", toolName: "shell" });
    t.feed({ type: "tool.started", toolCallId: "tc2", toolName: "read" });
    t.feed({ type: "tool.completed", toolCallId: "tc1", output: "ok", isError: true });
    t.feed({ type: "message.part.delta", partId: "p1", partType: "text", delta: "done" });
    const events = t.feed({ type: "turn.completed", reason: "completed" });
    expect(events[0]).toEqual({ kind: "tool_summary", total: 2, failures: 1 });
    expect(events[1]).toEqual({ kind: "text", text: "done" });
  });

  it("tool.completed 的 tool_detail 能回溯 toolName（started 映射 toolCallId）", () => {
    const t = createTurnTranslator("verbose");
    t.feed({ type: "tool.started", toolCallId: "tc1", toolName: "shell", input: {} });
    const events = t.feed({ type: "tool.completed", toolCallId: "tc1", output: "ok", isError: false });
    expect(events[0]).toMatchObject({ kind: "tool_detail", toolName: "shell", detail: "ok" });
  });

  it("verbose 不产出 tool_summary", () => {
    const t = createTurnTranslator("verbose");
    t.feed({ type: "tool.started", toolCallId: "tc1", toolName: "shell" });
    t.feed({ type: "message.part.delta", partId: "p1", partType: "text", delta: "done" });
    const events = t.feed({ type: "turn.completed", reason: "completed" });
    expect(events.every((e) => e.kind !== "tool_summary")).toBe(true);
  });

  it("message.superseded 丢弃被替换 part 的文本（重试不重复）", () => {
    const t = createTurnTranslator("summary");
    // partId 形状 = `${messageId}:${partType}`（pi-adapter.ts:356）
    t.feed({ type: "message.part.delta", partId: "m1:text", partType: "text", delta: "被替换的半截" });
    t.feed({ type: "message.superseded", messageId: "m1", attemptId: "a2" });
    t.feed({ type: "message.part.delta", partId: "m2:text", partType: "text", delta: "最终答复" });
    const events = t.feed({ type: "turn.completed", reason: "completed" });
    expect(events).toEqual([{ kind: "text", text: "最终答复" }]);
  });

  it("无工具调用不产出 tool_summary", () => {
    const t = createTurnTranslator("summary");
    t.feed({ type: "message.part.delta", partId: "p1", partType: "text", delta: "done" });
    const events = t.feed({ type: "turn.completed", reason: "completed" });
    expect(events).toEqual([{ kind: "text", text: "done" }]);
  });
});
