import { describe, expect, it } from "vitest";

import { SeenMessages } from "../src/dedup.js";

describe("SeenMessages（证据 E14）", () => {
  it("重复投递只处理一次", () => {
    const seen = new SeenMessages();
    const key = SeenMessages.keyOf("feishu-main", "om_1");
    expect(seen.mark(key)).toBe(true);
    expect(seen.mark(key)).toBe(false);
  });

  it("失败回滚后可重投", () => {
    const seen = new SeenMessages();
    const key = "a:m1";
    expect(seen.mark(key)).toBe(true);
    seen.unmark(key);
    expect(seen.mark(key)).toBe(true);
  });

  it("超过 TTL 的旧条目在清理后视为新消息", () => {
    let now = 1_000_000;
    const seen = new SeenMessages({ ttlMs: 5 * 60 * 1000, sweepEvery: 1, now: () => now });
    const key = "a:m1";
    expect(seen.mark(key)).toBe(true);
    now += 6 * 60 * 1000; // 6 分钟后
    // sweepEvery=1 → 下次 mark 触发清理
    expect(seen.mark("a:m2")).toBe(true);
    expect(seen.mark(key)).toBe(true);
  });

  it("key 格式为 adapter:messageId", () => {
    expect(SeenMessages.keyOf("feishu-main", "om_abc")).toBe("feishu-main:om_abc");
  });
});
