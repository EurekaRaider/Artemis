import { describe, expect, expectTypeOf, it } from "vitest";

import { DummyAdapter } from "../src/adapters/dummy.js";
import type { IMAdapter, TypingIndicator } from "../src/adapter.js";
import { isTypingIndicator } from "../src/adapter.js";
import type { ChannelBinding, OutboundEvent, Platform } from "../src/types.js";

// 类型断言测试（plan §0.2）：编译期验证接口形状，expectTypeOf 在运行期断言

describe("类型契约（plan §0.2）", () => {
  it("Platform 只含已定平台", () => {
    expectTypeOf<Platform>().toEqualTypeOf<"feishu" | "dummy">();
  });

  it("DummyAdapter 满足 IMAdapter", () => {
    expectTypeOf<DummyAdapter>().toMatchTypeOf<IMAdapter>();
  });

  it("OutboundEvent 联合类型可判别（tool_summary 已废弃——用户只关心最终结果）", () => {
    expectTypeOf<OutboundEvent["kind"]>().toEqualTypeOf<
      "text" | "status" | "approval_request" | "approval_resolved" | "tool_detail"
    >();
  });

  it("Envelope.threadId 是可选（Slack 预留，附录 A/S6）", () => {
    const binding: ChannelBinding = {
      workspaceKey: "w",
      threadId: "t",
      adapter: "a",
      platform: "feishu",
      channelId: "c",
      outputMode: "summary",
      muted: false,
      boundAt: new Date().toISOString(),
    };
    expect(binding.outputMode).toBe("summary");
  });

  it("typeof 守卫：DummyAdapter 不是 TypingIndicator", () => {
    const adapter = new DummyAdapter();
    expect(isTypingIndicator(adapter)).toBe(false);
    const withTyping = Object.assign(adapter, {
      triggerTyping: async () => {},
    });
    expect(isTypingIndicator(withTyping)).toBe(true);
    expectTypeOf(withTyping).toMatchTypeOf<TypingIndicator>();
  });
});
