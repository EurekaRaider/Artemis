import { describe, expect, it } from "vitest";

import {
  PAIRING_MAX_WRONG_CODE_ATTEMPTS,
  PairingStateMachine,
} from "../src/pairing.js";

function makeMachine(opts?: {
  now?: () => number;
  code?: string;
  onChallenge?: (c: { code: string }) => void;
}) {
  let now = 1_000_000;
  return {
    machine: new PairingStateMachine({
      now: opts?.now ?? (() => now),
      generateCode: () => opts?.code ?? "1234",
      ...(opts?.onChallenge ? { onChallenge: opts.onChallenge } : {}),
    }),
    advance: (ms: number) => {
      now += ms;
    },
    getNow: () => now,
  };
}

describe("PairingStateMachine（证据 E15）", () => {
  it("完整路径：开挑战 → 码匹配 → 桌面批准 → 建绑定", () => {
    const challenges: string[] = [];
    const { machine } = makeMachine({ code: "4321", onChallenge: (c) => challenges.push(c.code) });

    const r1 = machine.handleInbound("feishu-main", "oc_a", "你好", "张三");
    expect(r1.kind).toBe("consumed");
    expect(challenges).toEqual(["4321"]);

    const r2 = machine.handleInbound("feishu-main", "oc_a", "4321", "张三");
    expect(r2.kind).toBe("consumed");
    expect(machine.pendingApproval()).toMatchObject({ adapter: "feishu-main", channelId: "oc_a" });

    const approved = machine.approveChannel();
    expect(approved).toMatchObject({ adapter: "feishu-main", channelId: "oc_a", senderName: "张三" });
  });

  it("TTL 过期后同渠道消息开新挑战", () => {
    let now = 1_000_000;
    const codes = ["1111", "2222"];
    let idx = 0;
    const machine = new PairingStateMachine({
      now: () => now,
      generateCode: () => codes[idx++] ?? "9999",
    });
    machine.handleInbound("a", "c1", "hi", "u");
    now += 6 * 60 * 1000; // 超过 5min TTL
    const r = machine.handleInbound("a", "c1", "1111", "u"); // 旧码已过期
    expect(r.kind).toBe("consumed");
    if (r.kind === "consumed") expect(r.replyText).toContain("过期");
    expect(machine.activeChallenge()?.code).toBe("2222");
  });

  it("异渠道抢占：旧槽位空闲超 2min 后新渠道开挑战", () => {
    let now = 1_000_000;
    const machine = new PairingStateMachine({
      now: () => now,
      generateCode: () => "5555",
    });
    machine.handleInbound("a", "c1", "hi", "u1");
    now += 3 * 60 * 1000; // 空闲 3min > 2min
    const r = machine.handleInbound("a", "c2", "hi", "u2");
    expect(r.kind).toBe("consumed");
    expect(machine.activeChallenge()?.channelId).toBe("c2");
  });

  it("异渠道抢占拒绝：旧槽位活跃（空闲 <2min）时新渠道被拒", () => {
    let now = 1_000_000;
    const machine = new PairingStateMachine({
      now: () => now,
      generateCode: () => "6666",
    });
    machine.handleInbound("a", "c1", "hi", "u1");
    now += 60 * 1000; // 仅 1min
    const r = machine.handleInbound("a", "c2", "hi", "u2");
    expect(r.kind).toBe("consumed");
    if (r.kind === "consumed") expect(r.replyText).toContain("另一个频道");
    expect(machine.activeChallenge()?.channelId).toBe("c1");
  });

  it("错码 5 次作废槽位并计入拒绝", () => {
    const { machine } = makeMachine({ code: "7777" });
    machine.handleInbound("a", "c1", "hi", "u");
    for (let i = 1; i < PAIRING_MAX_WRONG_CODE_ATTEMPTS; i++) {
      const r = machine.handleInbound("a", "c1", "0000", "u");
      if (r.kind === "consumed") expect(r.replyText).toContain(`${i}/${PAIRING_MAX_WRONG_CODE_ATTEMPTS}`);
    }
    const last = machine.handleInbound("a", "c1", "0000", "u");
    if (last.kind === "consumed") expect(last.replyText).toContain("作废");
    expect(machine.activeChallenge()).toBeNull();
  });

  it("拒绝 3 次拉黑渠道", () => {
    const { machine } = makeMachine({ code: "8888" });
    for (let round = 0; round < 3; round++) {
      machine.handleInbound("a", "c1", "hi", "u");
      machine.handleInbound("a", "c1", "8888", "u"); // 码匹配进入待确认
      const { blacklisted } = machine.rejectChannel();
      if (round < 2) expect(blacklisted).toBe(false);
      else expect(blacklisted).toBe(true);
    }
    // 拉黑后再发消息
    const r = machine.handleInbound("a", "c1", "hi", "u");
    if (r.kind === "consumed") expect(r.replyText).toContain("黑名单");
  });

  it("无待确认渠道时 approve/reject 安全返回", () => {
    const { machine } = makeMachine();
    expect(machine.approveChannel()).toBeNull();
    expect(machine.rejectChannel()).toEqual({ blacklisted: false });
  });
});
