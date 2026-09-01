// 配对状态机（证据 E15：[G] runtime.go:815 HandlePairingInbound + pairing.go:18 常量）
// 参数原样移植：TTL 5min / 异渠道抢占空闲 2min / 错码 5 次作废 / 拒绝 3 次拉黑。

export const PAIRING_CODE_TTL_MS = 5 * 60 * 1000;
export const PAIRING_IDLE_PREEMPT_MS = 2 * 60 * 1000;
export const PAIRING_MAX_WRONG_CODE_ATTEMPTS = 5;
export const PAIRING_MAX_REJECTS_BEFORE_BLACKLIST = 3;

export interface PairingChallenge {
  code: string; // 4 位数字码
  adapter: string;
  channelId: string;
  createdAt: number; // epoch ms
  lastActivityAt: number;
}

export interface PairingChannelState {
  rejects: number; // 操作者在桌面点"拒绝"的累计次数
  blacklisted: boolean;
}

export type PairingEvent =
  | { kind: "challenge_created"; challenge: PairingChallenge }
  | { kind: "challenge_superseded"; old: PairingChallenge; challenge: PairingChallenge };

export type PairingInboundResult =
  | { kind: "consumed"; replyText: string } // 配对流程已消费，含回复文案
  | { kind: "pairing_succeeded"; replyText: string } // 码匹配，建绑定
  | { kind: "not_pairing" }; // 与配对无关（理论上调用方只在无绑定时调用）

export interface PairingHooks {
  /** 生成 4 位码（测试可注入确定性实现） */
  generateCode?: () => string;
  /** 新挑战创建时通知（main 侧弹配对卡） */
  onChallenge?: (challenge: PairingChallenge) => void;
  /** 码匹配成功、等待操作者在桌面批准/拒绝 */
  onAwaitingApproval?: (challenge: PairingChallenge, senderName: string) => void;
}

function defaultGenerateCode(): string {
  return String(Math.floor(Math.random() * 10000)).padStart(4, "0");
}

/**
 * 配对状态机。调用约定：仅在"该渠道无活跃绑定"时由 IMManager 调用。
 * 桌面批准/拒绝通过 approveChannel/rejectChannel 驱动。
 */
export class PairingStateMachine {
  private challenge: PairingChallenge | null = null;
  /** 码匹配后、等待桌面批准的渠道 */
  private awaitingChannel: { adapter: string; channelId: string; senderName: string } | null =
    null;
  private readonly channels = new Map<string, PairingChannelState>();
  private readonly now: () => number;
  private readonly generateCode: () => string;
  private readonly hooks: PairingHooks;

  constructor(opts: { now: () => number } & PairingHooks) {
    this.now = opts.now;
    this.generateCode = opts.generateCode ?? defaultGenerateCode;
    this.hooks = {
      ...(opts.onChallenge ? { onChallenge: opts.onChallenge } : {}),
      ...(opts.onAwaitingApproval ? { onAwaitingApproval: opts.onAwaitingApproval } : {}),
    };
  }

  isBlacklisted(adapter: string, channelId: string): boolean {
    return this.channelState(adapter, channelId).blacklisted;
  }

  /** 处理无绑定渠道的入站消息。返回回复文案或配对成功信号。 */
  handleInbound(adapter: string, channelId: string, text: string, senderName: string): PairingInboundResult {
    const state = this.channelState(adapter, channelId);
    if (state.blacklisted) {
      return { kind: "consumed", replyText: "该频道已被加入黑名单，无法配对。" };
    }

    const now = this.now();
    const existing = this.challenge;

    if (existing && existing.adapter === adapter && existing.channelId === channelId) {
      // 同渠道：先看过期，再匹配码
      if (now - existing.createdAt > PAIRING_CODE_TTL_MS) {
        this.openChallenge(adapter, channelId);
        return { kind: "consumed", replyText: "配对码已过期，已生成新配对码，请在桌面端查看并回复。" };
      }
      const code = text.trim();
      if (code === existing.code) {
        this.challenge = null;
        this.awaitingChannel = { adapter, channelId, senderName };
        this.hooks.onAwaitingApproval?.(existing, senderName);
        return {
          kind: "consumed",
          replyText: "配对码正确，等待桌面端确认……",
        };
      }
      existing.lastActivityAt = now;
      const attempts = (existing as { wrongAttempts?: number }).wrongAttempts ?? 0;
      const next = attempts + 1;
      (existing as { wrongAttempts?: number }).wrongAttempts = next;
      if (next >= PAIRING_MAX_WRONG_CODE_ATTEMPTS) {
        this.challenge = null;
        this.recordReject(adapter, channelId);
        return {
          kind: "consumed",
          replyText: `配对码错误次数过多，本次配对已作废。如非本人操作请忽略。`,
        };
      }
      return {
        kind: "consumed",
        replyText: `配对码不正确（${next}/${PAIRING_MAX_WRONG_CODE_ATTEMPTS}），请重新输入桌面端显示的 4 位配对码。`,
      };
    }

    if (existing) {
      // 异渠道：旧槽位过期或空闲超阈值 → 抢占；否则提示忙
      const stale = now - existing.createdAt > PAIRING_CODE_TTL_MS;
      const idle = now - existing.lastActivityAt > PAIRING_IDLE_PREEMPT_MS;
      if (!stale && !idle) {
        return { kind: "consumed", replyText: "当前有另一个频道正在配对，请稍后再试。" };
      }
      this.openChallenge(adapter, channelId);
      return { kind: "consumed", replyText: "请在桌面端查看 4 位配对码并回复，完成配对。" };
    }

    this.openChallenge(adapter, channelId);
    return { kind: "consumed", replyText: "请在桌面端查看 4 位配对码并回复，完成配对。" };
  }

  /** 桌面操作者批准当前待确认渠道。返回待确认信息（无待确认返回 null）。 */
  approveChannel(): { adapter: string; channelId: string; senderName: string } | null {
    const pending = this.awaitingChannel;
    this.awaitingChannel = null;
    return pending;
  }

  /** 桌面操作者拒绝。满 3 次拉黑该渠道。返回是否被拉黑。 */
  rejectChannel(): { blacklisted: boolean } {
    const pending = this.awaitingChannel;
    this.awaitingChannel = null;
    if (!pending) return { blacklisted: false };
    const blacklisted = this.recordReject(pending.adapter, pending.channelId);
    return { blacklisted };
  }

  /** 当前是否有等待桌面确认的渠道（设置页展示用）。 */
  pendingApproval(): { adapter: string; channelId: string; senderName: string } | null {
    return this.awaitingChannel ? { ...this.awaitingChannel } : null;
  }

  /** 当前活跃挑战（设置页/通知展示配对码用）。 */
  activeChallenge(): PairingChallenge | null {
    return this.challenge ? { ...this.challenge } : null;
  }

  private openChallenge(adapter: string, channelId: string): void {
    const now = this.now();
    this.challenge = { code: this.generateCode(), adapter, channelId, createdAt: now, lastActivityAt: now };
    this.hooks.onChallenge?.({ ...this.challenge });
  }

  private recordReject(adapter: string, channelId: string): boolean {
    const state = this.channelState(adapter, channelId);
    state.rejects += 1;
    if (state.rejects >= PAIRING_MAX_REJECTS_BEFORE_BLACKLIST) {
      state.blacklisted = true;
    }
    return state.blacklisted;
  }

  private channelState(adapter: string, channelId: string): PairingChannelState {
    const key = `${adapter}:${channelId}`;
    let state = this.channels.get(key);
    if (!state) {
      state = { rejects: 0, blacklisted: false };
      this.channels.set(key, state);
    }
    return state;
  }
}
