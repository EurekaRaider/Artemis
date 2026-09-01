// 审批回复文本解析（证据 E16：[G] approval_reply.go:8 ParseApprovalReply）
// 词表原样移植（含中文），y/n 前缀 ≤3 字符兜底。

export interface ApprovalReply {
  approved: boolean;
  always: boolean;
}

const ALLOW_ALWAYS_WORDS = new Set(["a", "always", "总是允许", "总是", "始终允许"]);
const ALLOW_WORDS = new Set(["y", "yes", "好", "好的", "允许", "同意", "可以", "ok", "okay"]);
const DENY_WORDS = new Set(["n", "no", "不", "不行", "拒绝", "不同意", "deny"]);

/** 命中词表返回解析结果；不命中返回 null（按普通消息处理）。 */
export function parseApprovalReply(text: string): ApprovalReply | null {
  const t = text.trim().toLowerCase();
  if (t === "") return null;

  if (ALLOW_ALWAYS_WORDS.has(t)) return { approved: true, always: true };
  if (ALLOW_WORDS.has(t)) return { approved: true, always: false };
  if (DENY_WORDS.has(t)) return { approved: false, always: false };

  // y/n 前缀兜底（≤3 字符，如 "y." "n!"），对齐 [G] 行为
  if (t.length <= 3 && t.startsWith("y")) return { approved: true, always: false };
  if (t.length <= 3 && t.startsWith("n")) return { approved: false, always: false };

  return null;
}
