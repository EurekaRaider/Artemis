import { describe, expect, it } from "vitest";

import { parseApprovalReply } from "../src/approval-text.js";
import { routeInboundText } from "../src/route.js";

describe("parseApprovalReply（证据 E16 词表全量）", () => {
  it.each([
    ["y", true, false],
    ["yes", true, false],
    ["好", true, false],
    ["允许", true, false],
    ["同意", true, false],
    ["a", true, true],
    ["always", true, true],
    ["总是允许", true, true],
    ["n", false, false],
    ["no", false, false],
    ["拒绝", false, false],
    ["Y", true, false], // 大小写不敏感
    ["y.", true, false], // ≤3 字符 y 前缀兜底
    ["n!", false, false],
  ])("%s → approved=%s always=%s", (input, approved, always) => {
    expect(parseApprovalReply(input)).toEqual({ approved, always });
  });

  it.each(["帮我改一下代码", "", "   ", "yesterday 发生了什么", "no way"])(
    "非审批词返回 null：%s",
    (input) => {
      expect(parseApprovalReply(input)).toBeNull();
    },
  );
});

describe("routeInboundText（证据 E18）", () => {
  it("空文本", () => {
    expect(routeInboundText("  ", false)).toEqual({ kind: "empty" });
  });

  it("/ 前缀走 slash", () => {
    expect(routeInboundText("/status", true)).toEqual({ kind: "slash", text: "/status" });
  });

  it("有待批审批时 y 解析为 approval", () => {
    expect(routeInboundText("y", true)).toEqual({ kind: "approval", approved: true, always: false });
  });

  it("无待批审批时 y 按 message 处理", () => {
    expect(routeInboundText("y", false)).toEqual({ kind: "message", text: "y" });
  });

  it("普通文本走 message", () => {
    expect(routeInboundText("列出当前目录", true)).toEqual({ kind: "message", text: "列出当前目录" });
  });
});
