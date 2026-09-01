// AgentPayload → OutboundEvent 翻译（证据：plan §3.2）
// 必须是纯函数：可脱离 Electron 单测（测试面=接口面）。
// 输入故意保持结构化解构（不 import @artemis/protocol 的具体类型），
// 只依赖字段名约定，避免 packages/im 与协议包形成构建依赖环。

import type { OutboundEvent, OutputMode } from "./types.js";

/** 只声明翻译器关心的字段形状（结构子类型）。 */
export interface AgentPayloadLike {
  type: string;
  // turn.completed / turn.failed
  text?: string;
  error?: string;
  // 工具调用/结果（verbose 模式）
  toolName?: string;
  detail?: string;
  isError?: boolean;
}

export interface TurnToolStats {
  total: number;
  failures: number;
}

/**
 * 单事件翻译：turn.completed/turn.failed/工具事件 → OutboundEvent[]。
 * 工具计数聚合（tool_summary）是跨事件的，由 createTurnTranslator 承载。
 */
export function translateAgentPayload(payload: AgentPayloadLike, mode: OutputMode): OutboundEvent[] {
  switch (payload.type) {
    case "turn.completed":
      if (mode === "quiet") return [];
      return payload.text ? [{ kind: "text", text: payload.text }] : [];
    case "turn.failed":
      // 全模式发（错误必须可见）
      return [{ kind: "text", text: `执行失败：${payload.error ?? "未知错误"}` }];
    case "tool.call":
      if (mode !== "verbose") return [];
      return [
        {
          kind: "tool_detail",
          toolName: payload.toolName ?? "unknown",
          detail: payload.detail ?? "",
        },
      ];
    case "tool.result":
      if (mode !== "verbose") return [];
      return [
        {
          kind: "tool_detail",
          toolName: payload.toolName ?? "unknown",
          detail: payload.detail ?? "",
          ...(payload.isError ? { isError: true } : {}),
        },
      ];
    // approval.requested 已由 broker 拦截路径直接发，跳过避免双发（§3.2）
    case "approval.requested":
      return [];
    default:
      // goal、memory、queue 等忽略
      return [];
  }
}

/**
 * 跨事件的 turn 级翻译器：统计工具调用，turn 边界产出 tool_summary（summary 模式）。
 * 用法：im-service 每个线程维护一个实例，turn.start 时 reset。
 */
export function createTurnTranslator(mode: OutputMode): {
  feed(payload: AgentPayloadLike): OutboundEvent[];
  stats(): TurnToolStats;
} {
  let total = 0;
  let failures = 0;
  return {
    feed(payload: AgentPayloadLike): OutboundEvent[] {
      if (payload.type === "tool.call") {
        total += 1;
        return translateAgentPayload(payload, mode);
      }
      if (payload.type === "tool.result") {
        if (payload.isError) failures += 1;
        return translateAgentPayload(payload, mode);
      }
      if (payload.type === "turn.completed" || payload.type === "turn.failed") {
        const events = translateAgentPayload(payload, mode);
        if (mode === "summary" && total > 0) {
          events.unshift({
            kind: "tool_summary",
            total,
            failures,
          });
        }
        return events;
      }
      return translateAgentPayload(payload, mode);
    },
    stats: () => ({ total, failures }),
  };
}
