// AgentPayload → OutboundEvent 翻译（证据：plan §3.2）
// 必须是纯函数：可脱离 Electron 单测（测试面=接口面）。
// 输入故意保持结构化解构（不 import @artemis/protocol 的具体类型），
// 只依赖字段名约定，避免 packages/im 与协议包形成构建依赖环。
//
// 协议形状以 packages/protocol/src/schema.ts 为准（2026-09-01 核实）：
// - 助手文本经 message.part.delta {partId, partType:"text"|"thinking", delta} 流式到达
// - turn.completed {reason:"completed"|"cancelled", finalPartId?} —— 不携带文本
// - turn.failed {message, code?} —— 字段是 message
// - 工具事件 tool.started {toolCallId, toolName, input?} /
//   tool.completed {toolCallId, output?, isError} —— completed 不带 toolName

import type { OutboundEvent, OutputMode } from "./types.js";

/** 只声明翻译器关心的字段形状（结构子类型）。 */
export interface AgentPayloadLike {
  type: string;
  // turn.completed
  reason?: string | undefined;
  // turn.failed
  message?: string | undefined;
  // message.part.delta / message.superseded
  partId?: string | undefined;
  messageId?: string | undefined;
  partType?: string | undefined;
  delta?: string | undefined;
  // tool.started / tool.completed
  toolCallId?: string | undefined;
  toolName?: string | undefined;
  input?: unknown;
  output?: string | undefined;
  isError?: boolean | undefined;
  // approval.resolved（审批终态回写，§3.2）
  approvalId?: string | undefined;
  approved?: boolean | undefined;
}

export interface TurnToolStats {
  total: number;
  failures: number;
}

/** verbose 模式工具详情的单行摘要长度上限 */
const TOOL_DETAIL_LIMIT = 500;

function summarizeInput(input: unknown): string {
  if (input === undefined || input === null) return "";
  const raw = typeof input === "string" ? input : JSON.stringify(input);
  return raw.length > TOOL_DETAIL_LIMIT ? `${raw.slice(0, TOOL_DETAIL_LIMIT)}…` : raw;
}

function summarizeOutput(output: string | undefined): string {
  const raw = (output ?? "").trim();
  return raw.length > TOOL_DETAIL_LIMIT ? `${raw.slice(0, TOOL_DETAIL_LIMIT)}…` : raw;
}

/**
 * 无状态单事件翻译：tool.* / turn.failed / approval.* → OutboundEvent[]。
 * message.part.delta 与 turn.completed 需要 turn 级聚合状态，
 * 由 createTurnTranslator 承载，此函数对它们返回 []。
 */
export function translateAgentPayload(payload: AgentPayloadLike, mode: OutputMode): OutboundEvent[] {
  switch (payload.type) {
    case "turn.failed":
      // 全模式发（错误必须可见）。真实字段是 message（schema.ts:837）
      return [
        { kind: "text", text: `执行失败：${payload.message ?? "未知错误"}` },
      ];
    case "tool.started":
      if (mode !== "verbose") return [];
      return [
        {
          kind: "tool_detail",
          toolName: payload.toolName ?? "unknown",
          detail: summarizeInput(payload.input),
        },
      ];
    case "tool.completed":
      if (mode !== "verbose") return [];
      return [
        {
          kind: "tool_detail",
          // tool.completed 不带 toolName；turn 级翻译器会经 toolCallId 回填
          toolName: payload.toolName ?? "unknown",
          detail: summarizeOutput(payload.output),
          ...(payload.isError ? { isError: true } : {}),
        },
      ];
    // approval.requested 已由 broker 拦截路径直接发，跳过避免双发（§3.2）
    case "approval.requested":
      return [];
    case "approval.resolved":
      // 审批终态全模式发（桌面端点批准时 IM 也要更新，§3.1 双端互通）
      if (!payload.approvalId || payload.approved === undefined) return [];
      return [
        {
          kind: "approval_resolved",
          approvalId: payload.approvalId,
          approved: payload.approved,
        },
      ];
    default:
      // message.part.delta / turn.completed（有状态，见 createTurnTranslator）、
      // goal、memory、queue 等忽略
      return [];
  }
}

/**
 * 跨事件的 turn 级翻译器：
 * - 聚合 message.part.delta 的 text part（thinking 不发 IM），
 *   turn.completed 时产出全量答复（summary/verbose）
 * - 统计工具调用，turn 边界产出 tool_summary（summary 模式）
 * 用法：im-service 每个线程维护一个实例，turn.started 时重建。
 */
export function createTurnTranslator(mode: OutputMode): {
  feed(payload: AgentPayloadLike): OutboundEvent[];
  stats(): TurnToolStats;
} {
  /** text part 聚合：partId → 已拼文本（Map 保插入序=流式到达序） */
  const textParts = new Map<string, string>();
  /** toolCallId → toolName（tool.completed 不带 toolName，回溯用） */
  const toolNames = new Map<string, string>();
  let total = 0;
  let failures = 0;

  function flushTurnEvents(payload: AgentPayloadLike): OutboundEvent[] {
    const events: OutboundEvent[] = [];
    if (mode === "summary" && total > 0) {
      events.push({ kind: "tool_summary", total, failures });
    }
    if (payload.type === "turn.failed") {
      events.push(...translateAgentPayload(payload, mode));
      return events;
    }
    // turn.completed：发聚合文本（completed/cancelled 都发——有部分文本时
    // IM 侧不应沉默）；quiet 模式不发
    const text = [...textParts.values()].join("\n\n").trim();
    if (text && mode !== "quiet") {
      events.push({ kind: "text", text });
    }
    return events;
  }

  return {
    feed(payload: AgentPayloadLike): OutboundEvent[] {
      switch (payload.type) {
        case "message.superseded": {
          // 重试/重连替换消息（partId = `${messageId}:${partType}`，
          // pi-adapter.ts:356）：丢弃被替换 part 的已聚合文本，防重复
          if (payload.messageId) {
            for (const key of [...textParts.keys()]) {
              if (key.startsWith(`${payload.messageId}:`)) textParts.delete(key);
            }
          }
          return [];
        }
        case "message.part.delta": {
          if (payload.partType !== "text" || !payload.partId) return [];
          textParts.set(
            payload.partId,
            `${textParts.get(payload.partId) ?? ""}${payload.delta ?? ""}`,
          );
          return [];
        }
        case "tool.started": {
          total += 1;
          if (payload.toolCallId && payload.toolName) {
            toolNames.set(payload.toolCallId, payload.toolName);
          }
          return translateAgentPayload(payload, mode);
        }
        case "tool.completed": {
          if (payload.isError) failures += 1;
          const events = translateAgentPayload(payload, mode);
          // 回填 toolName（completed 事件不携带）
          if (payload.toolCallId && !payload.toolName) {
            const name = toolNames.get(payload.toolCallId);
            for (const event of events) {
              if (event.kind === "tool_detail" && name) event.toolName = name;
            }
          }
          return events;
        }
        case "turn.completed":
        case "turn.failed":
          return flushTurnEvents(payload);
        default:
          return translateAgentPayload(payload, mode);
      }
    },
    stats: () => ({ total, failures }),
  };
}
