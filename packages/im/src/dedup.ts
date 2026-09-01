// 入站去重（证据 E14：[G] runtime.go:678 HandleInbound）
// 语义：key=`adapter:messageId`，处理前打标、失败回滚、定期清理旧条目。
// 打标与回滚分离的原因：消息处理失败后必须允许重投（[G] #540）。

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 分钟
const DEFAULT_SWEEP_EVERY = 100; // 每 100 次 mark 清理一次

export class SeenMessages {
  private readonly seen = new Map<string, number>();
  private readonly ttlMs: number;
  private readonly sweepEvery: number;
  private readonly now: () => number;
  private marksSinceSweep = 0;

  constructor(opts?: { ttlMs?: number; sweepEvery?: number; now?: () => number }) {
    this.ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;
    this.sweepEvery = opts?.sweepEvery ?? DEFAULT_SWEEP_EVERY;
    this.now = opts?.now ?? (() => Date.now());
  }

  static keyOf(adapter: string, messageId: string): string {
    return `${adapter}:${messageId}`;
  }

  /** 首次投递返回 true 并打标；重复投递返回 false。 */
  mark(key: string): boolean {
    if (this.seen.has(key)) return false;
    this.seen.set(key, this.now());
    this.marksSinceSweep += 1;
    if (this.marksSinceSweep >= this.sweepEvery) {
      this.sweep();
    }
    return true;
  }

  /** 处理失败后回滚打标，允许重投。 */
  unmark(key: string): void {
    this.seen.delete(key);
  }

  private sweep(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [k, t] of this.seen) {
      if (t < cutoff) this.seen.delete(k);
    }
    this.marksSinceSweep = 0;
  }
}
