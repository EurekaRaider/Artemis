import { describe, expect, it } from "vitest";

import { createTurnTranslator, translateAgentPayload } from "../src/translate.js";

describe("translateAgentPayload 三模式门控矩阵（plan §0.8/§3.2）", () => {
  const completed = { type: "turn.completed", text: "答复内容" };
  const failed = { type: "turn.failed", error: "boom" };
  const toolCall = { type: "tool.call", toolName: "shell", detail: "ls -la" };
  const toolResult = { type: "tool.result", toolName: "shell", detail: "ok", isError: false };
  const toolError = { type: "tool.result", toolName: "shell", detail: "fail", isError: true };

  it("summary：turn.completed 发全量答复", () => {
    expect(translateAgentPayload(completed, "summary")).toEqual([{ kind: "text", text: "答复内容" }]);
  });

  it("quiet：turn.completed 不发", () => {
    expect(translateAgentPayload(completed, "quiet")).toEqual([]);
  });

  it("turn.failed 全模式都发", () => {
    for (const mode of ["summary", "verbose", "quiet"] as const) {
      const events = translateAgentPayload(failed, mode);
      expect(events).toHaveLength(1);
      expect(events[0]?.kind).toBe("text");
    }
  });

  it("verbose：工具事件发 tool_detail", () => {
    expect(translateAgentPayload(toolCall, "verbose")).toEqual([
      { kind: "tool_detail", toolName: "shell", detail: "ls -la" },
    ]);
    const [e] = translateAgentPayload(toolError, "verbose");
    expect(e).toMatchObject({ kind: "tool_detail", isError: true });
  });

  it("summary/quiet：工具事件不发", () => {
    expect(translateAgentPayload(toolCall, "summary")).toEqual([]);
    expect(translateAgentPayload(toolResult, "quiet")).toEqual([]);
  });

  it("approval.requested 跳过（broker 拦截路径已发，避免双发）", () => {
    expect(translateAgentPayload({ type: "approval.requested" }, "verbose")).toEqual([]);
  });

  it("其他事件忽略", () => {
    expect(translateAgentPayload({ type: "goal.updated" }, "summary")).toEqual([]);
  });
});

describe("createTurnTranslator 工具计数聚合", () => {
  it("summary 模式 turn 边界产出 tool_summary", () => {
    const t = createTurnTranslator("summary");
    t.feed({ type: "tool.call", toolName: "a", detail: "" });
    t.feed({ type: "tool.call", toolName: "b", detail: "" });
    t.feed({ type: "tool.result", toolName: "a", detail: "", isError: true });
    const events = t.feed({ type: "turn.completed", text: "done" });
    expect(events[0]).toEqual({ kind: "tool_summary", total: 2, failures: 1 });
    expect(events[1]).toEqual({ kind: "text", text: "done" });
  });

  it("verbose 模式 turn 边界不产出 tool_summary", () => {
    const t = createTurnTranslator("verbose");
    t.feed({ type: "tool.call", toolName: "a", detail: "" });
    const events = t.feed({ type: "turn.completed", text: "done" });
    expect(events.every((e) => e.kind !== "tool_summary")).toBe(true);
  });

  it("无工具调用不产出 tool_summary", () => {
    const t = createTurnTranslator("summary");
    const events = t.feed({ type: "turn.completed", text: "done" });
    expect(events).toEqual([{ kind: "text", text: "done" }]);
  });
});
