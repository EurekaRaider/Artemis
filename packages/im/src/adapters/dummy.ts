// 内存适配器（测试 + seam 验证，证据：plan §2.1）
// dummy adapter 存在的目的：证明 IMAdapter 接缝不是假设性的——
// 测试（dummy）与生产（feishu）跨同一接缝调用 manager。

import type { AdapterContext, IMAdapter } from "../adapter.js";
import type { ChannelBinding, InboundMessage, OutboundEvent } from "../types.js";

export class DummyAdapter implements IMAdapter {
  readonly name: string;
  readonly platform = "dummy" as const;

  private ctx: AdapterContext | null = null;
  private onInbound: ((msg: InboundMessage) => void) | null = null;

  /** 测试观测点：所有 send 调用记录 */
  readonly sent: { binding: ChannelBinding; event: OutboundEvent }[] = [];
  started = false;

  constructor(name = "dummy") {
    this.name = name;
  }

  async start(ctx: AdapterContext, onInbound: (msg: InboundMessage) => void): Promise<void> {
    this.ctx = ctx;
    this.onInbound = onInbound;
    this.started = true;
  }

  async send(binding: ChannelBinding, event: OutboundEvent): Promise<void> {
    this.sent.push({ binding: { ...binding }, event });
  }

  async stop(): Promise<void> {
    this.started = false;
    this.ctx = null;
    this.onInbound = null;
  }

  /** 测试驱动：模拟平台侧收到一条消息。 */
  injectInbound(msg: InboundMessage): void {
    if (!this.onInbound) throw new Error("dummy adapter not started");
    this.onInbound(msg);
  }
}
