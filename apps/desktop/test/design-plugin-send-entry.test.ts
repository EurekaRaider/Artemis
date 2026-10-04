// S3 host send-entry state machine (proposal §9.2/§9.3).
//
// Pins the one-time-credential semantics against the real AppStore ledger:
//   - accept mints a credential bound to an accepted ledger row
//   - consume transitions accepted → queued → dispatching exactly once;
//     replay is refused (consumed), malformed/unknown credentials refused
//   - outcome recording is idempotent and only moves legal states
//   - restart-safe: a fresh service instance over the same rows refuses
//     to re-offer a consumed credential (rows are the truth)

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PanelSendEntryService } from "../src/main/design-plugin-send-entry.js";
import { AppStore } from "../src/main/store.js";
import { RESTRICTED_PROFILE_ID } from "@artemis/protocol";

let directory: string;
let store: AppStore;
let threadId: string;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "s3-send-"));
  store = new AppStore(join(directory, "state.sqlite"));
  threadId = randomUUID();
  const now = new Date().toISOString();
  store.createThread({
    id: threadId,
    title: "s3",
    mode: "execute",
    target: "local",
    status: "idle",
    pinned: false,
    archived: false,
    typeBinding: {
      installationId: "com.artemis.design",
      pluginId: "com.artemis.design",
      typeId: "artemis-design",
      pluginVersion: "0.1.0",
      contentHash: "a".repeat(64),
      bindingRevision: "rev-test",
    },
    executionProfile: RESTRICTED_PROFILE_ID,
    createdAt: now,
    updatedAt: now,
  });
});

afterAll(async () => {
  store.close();
  await rm(directory, { recursive: true, force: true });
});

describe("S3 panel send entry", () => {
  it("binds only the selected candidate and validates task and revision before consuming", () => {
    const service = new PanelSendEntryService(store);
    const accept = (text: string) =>
      service.acceptCandidate({
        threadId,
        candidateText: text,
        bindingRevision: "rev-test",
      });
    const draft = accept("unsent draft");
    const selected = accept("selected candidate");
    const turnId = randomUUID();
    expect(() =>
      service.consumeForTurn(
        selected.credential,
        randomUUID(),
        "rev-test",
        turnId,
      ),
    ).toThrow(/task or binding/);
    expect(() =>
      service.consumeForTurn(
        selected.credential,
        threadId,
        "new-revision",
        turnId,
      ),
    ).toThrow(/task or binding/);
    expect(
      store.getPromptSubmission(selected.submission.submissionId)?.state,
    ).toBe("accepted");
    service.consumeForTurn(selected.credential, threadId, "rev-test", turnId);
    service.reconcileTurnOutcome(threadId, "completed", turnId);
    expect(
      store.getPromptSubmission(selected.submission.submissionId),
    ).toMatchObject({ state: "completed", turnId });
    expect(
      store.getPromptSubmission(draft.submission.submissionId),
    ).toMatchObject({ state: "accepted" });
    expect(() =>
      service.consumeForTurn(
        selected.credential,
        threadId,
        "rev-test",
        randomUUID(),
      ),
    ).toThrow();
  });

  it("does not report interrupted queued candidates as completed by a later turn", () => {
    const service = new PanelSendEntryService(store);
    const accepted = service.acceptCandidate({
      threadId,
      candidateText: "follow-up",
      bindingRevision: "rev-test",
    });
    const turnId = randomUUID();
    service.consumeForTurn(accepted.credential, threadId, "rev-test", turnId);
    service.recoverInterruptedSubmissions(threadId, turnId);
    service.reconcileTurnOutcome(threadId, "completed", turnId);
    service.reconcileTurnOutcome(threadId, "completed", randomUUID());
    expect(
      store.getPromptSubmission(accepted.submission.submissionId)?.state,
    ).toBe("unknown");
  });
  it("accepts a candidate and mints a credential bound to the ledger row", () => {
    const service = new PanelSendEntryService(store);
    const accepted = service.acceptCandidate({
      threadId,
      candidateText: "生成一个客户档案页",
      bindingRevision: "rev-test",
    });
    expect(accepted.submission.state).toBe("accepted");
    expect(accepted.submission.source).toBe("panel");
    expect(accepted.credential).toContain(accepted.submission.submissionId);
    // 空候选拒绝
    expect(() =>
      service.acceptCandidate({
        threadId,
        candidateText: "   ",
        bindingRevision: "r",
      }),
    ).toThrow(/empty/i);
  });

  it("consumes a credential once and refuses the replay", () => {
    const service = new PanelSendEntryService(store);
    const accepted = service.acceptCandidate({
      threadId,
      candidateText: "第二次验证",
      bindingRevision: "rev-test",
    });
    const consumed = service.consumeCredential(accepted.credential);
    expect(consumed.candidateText).toBe("第二次验证");
    expect(consumed.threadId).toBe(threadId);
    // 状态已推进到 dispatching
    expect(
      store.getPromptSubmission(accepted.submission.submissionId)?.state,
    ).toBe("dispatching");
    // 重放拒绝（同凭证第二次）
    expect(() => service.consumeCredential(accepted.credential)).toThrow(
      /consumed/,
    );
    // 伪造/未知凭证拒绝
    expect(() =>
      service.consumeCredential(`${randomUUID()}.${randomUUID()}`),
    ).toThrow(/unknown/);
    expect(() => service.consumeCredential("garbage")).toThrow(
      /malformed|unknown/,
    );
  });

  it("a restarted service refuses to re-consume a spent credential (rows are truth)", () => {
    const first = new PanelSendEntryService(store);
    const accepted = first.acceptCandidate({
      threadId,
      candidateText: "重启验证",
      bindingRevision: "rev-test",
    });
    first.consumeCredential(accepted.credential);
    // 重启：nonce 注册表随进程消失——凭据无法再次验证签发来源（P2-9：
    // 旧实现只验证 submissionId，任意 nonce 都能配上已 accepted 的行）。
    const restarted = new PanelSendEntryService(store);
    expect(() => restarted.consumeCredential(accepted.credential)).toThrow(
      /nonce was not issued/,
    );
  });

  it("outcome recording is idempotent and legal-state-only", () => {
    const service = new PanelSendEntryService(store);
    const accepted = service.acceptCandidate({
      threadId,
      candidateText: "结果验证",
      bindingRevision: "rev-test",
    });
    const id = accepted.submission.submissionId;
    // accepted 状态不能直接标 completed（必须先消费）
    const untouched = service.markOutcome(id, "completed");
    expect(untouched.state).toBe("accepted");
    // 消费后 running → completed；重复 completed 幂等
    service.consumeCredential(accepted.credential);
    service.markRunning(id, randomUUID());
    const done = service.markOutcome(id, "completed");
    expect(done.state).toBe("completed");
    const again = service.markOutcome(id, "completed");
    expect(again.state).toBe("completed");
  });

  it("same submissionId with a different payload is refused (ledger corruption guard)", () => {
    const service = new PanelSendEntryService(store);
    const text = "同 ID 不同载荷";
    const accepted = service.acceptCandidate({
      threadId,
      candidateText: text,
      bindingRevision: "rev-test",
    });
    // 直接对 store 打同 ID 不同文本——账本必须拒绝
    expect(() =>
      store.acceptPromptSubmission({
        submissionId: accepted.submission.submissionId,
        threadId,
        source: "panel",
        candidateText: `${text}!`,
        bindingRevision: "rev-test",
      }),
    ).toThrow(/refusing to overwrite/i);
  });
});

describe("S3 send-entry closure (discard / reconcile / recover)", () => {
  it("records a cancelled turn as cancelled", () => {
    const service = new PanelSendEntryService(store);
    const accepted = service.acceptCandidate({
      threadId,
      candidateText: "cancel me",
      bindingRevision: "rev-test",
    });
    const turnId = randomUUID();
    service.consumeForTurn(accepted.credential, threadId, "rev-test", turnId);
    service.reconcileTurnOutcome(threadId, "cancelled", turnId);
    service.reconcileTurnOutcome(threadId, "cancelled", turnId);
    service.reconcileTurnOutcome(threadId, "completed", turnId);
    expect(
      store.getPromptSubmission(accepted.submission.submissionId)?.state,
    ).toBe("cancelled");
  });
  it("discard transitions accepted → cancelled and voids the credential", () => {
    const service = new PanelSendEntryService(store);
    const accepted = service.acceptCandidate({
      threadId,
      candidateText: "丢弃验证",
      bindingRevision: "rev-test",
    });
    service.discardCandidate(accepted.credential);
    expect(
      store.getPromptSubmission(accepted.submission.submissionId)?.state,
    ).toBe("cancelled");
    // 丢弃后凭证不可再消费（consumed 或 wrong-state 均为合法拒绝）
    expect(() => service.consumeCredential(accepted.credential)).toThrow(
      /wrong-state|consumed/,
    );
  });

  it("turn reconciliation advances only the submission bound to that turn", () => {
    const service = new PanelSendEntryService(store);
    const accepted = service.acceptCandidate({
      threadId,
      candidateText: "对账验证",
      bindingRevision: "rev-test",
    });
    service.consumeCredential(accepted.credential);
    // 未绑定 turn：任何结算都不得触碰（P2-10：跨 turn 扫荡是旧缺陷）。
    service.reconcileTurnOutcome(threadId, "completed", randomUUID());
    expect(
      store.getPromptSubmission(accepted.submission.submissionId)?.state,
    ).toBe("dispatching");
    // turn 启动绑定后结算：dispatching → completed（turn.completed 模拟）
    const turnId = randomUUID();
    service.markRunning(accepted.submission.submissionId, turnId);
    service.reconcileTurnOutcome(threadId, "completed", turnId);
    expect(
      store.getPromptSubmission(accepted.submission.submissionId)?.state,
    ).toBe("completed");
    // 幂等：再对账不动终态
    service.reconcileTurnOutcome(threadId, "failed", turnId);
    expect(
      store.getPromptSubmission(accepted.submission.submissionId)?.state,
    ).toBe("completed");
  });

  it("restart recovery marks stuck dispatching/running rows unknown (never re-dispatch)", () => {
    const service = new PanelSendEntryService(store);
    const a = service.acceptCandidate({
      threadId,
      candidateText: "卡在派发",
      bindingRevision: "rev-test",
    });
    service.consumeCredential(a.credential);
    const b = service.acceptCandidate({
      threadId,
      candidateText: "卡在运行",
      bindingRevision: "rev-test",
    });
    service.consumeCredential(b.credential);
    service.markRunning(b.submission.submissionId, randomUUID());
    // 重启恢复（新实例模拟）
    const restarted = new PanelSendEntryService(store);
    const recovered = restarted.recoverInterruptedSubmissions(threadId);
    expect(recovered).toBeGreaterThanOrEqual(2);
    expect(store.getPromptSubmission(a.submission.submissionId)?.state).toBe(
      "unknown",
    );
    expect(store.getPromptSubmission(b.submission.submissionId)?.state).toBe(
      "unknown",
    );
    // accepted 行不受影响
    const fresh = restarted.acceptCandidate({
      threadId,
      candidateText: "恢复后新候选",
      bindingRevision: "rev-test",
    });
    expect(fresh.submission.state).toBe("accepted");
  });
});
