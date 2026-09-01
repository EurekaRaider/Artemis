// 入站文本路由（证据 E18：[G] inbound_route.go:29 RouteInboundText，裁剪版）
// 明确删除 ggcode 的 shell 分支（MVP 决策 6）。

import { parseApprovalReply } from "./approval-text.js";

export type InboundRoute =
  | { kind: "empty" }
  | { kind: "slash"; text: string } // "/" 前缀
  | { kind: "approval"; approved: boolean; always: boolean } // 有待批审批且命中词表
  | { kind: "message"; text: string };

/**
 * @param text 入站文本（已剥离平台 mention 等包装）
 * @param hasPendingApproval 当前是否有待批审批
 */
export function routeInboundText(text: string, hasPendingApproval: boolean): InboundRoute {
  const trimmed = text.trim();
  if (trimmed === "") return { kind: "empty" };
  if (trimmed.startsWith("/")) return { kind: "slash", text: trimmed };
  if (hasPendingApproval) {
    const reply = parseApprovalReply(trimmed);
    if (reply) return { kind: "approval", approved: reply.approved, always: reply.always };
  }
  return { kind: "message", text: trimmed };
}
