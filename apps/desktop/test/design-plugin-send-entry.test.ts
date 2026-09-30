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
      service.acceptCandidate({ threadId, candidateText: "   ", bindingRevision: "r" }),
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
    expect(store.getPromptSubmission(accepted.submission.submissionId)?.state).toBe(
      "dispatching",
    );
    // 重放拒绝（同凭证第二次）
    expect(() => service.consumeCredential(accepted.credential)).toThrow(/consumed/);
    // 伪造/未知凭证拒绝
    expect(() => service.consumeCredential(`${randomUUID()}.${randomUUID()}`)).toThrow(
      /unknown/,
    );
    expect(() => service.consumeCredential("garbage")).toThrow(/malformed|unknown/);
  });

  it("a restarted service refuses to re-consume a spent credential (rows are truth)", () => {
    const first = new PanelSendEntryService(store);
    const accepted = first.acceptCandidate({
      threadId,
      candidateText: "重启验证",
      bindingRevision: "rev-test",
    });
    first.consumeCredential(accepted.credential);
    // 重启：新实例只有库里的行——dispatching 状态不是 accepted，wrong-state 拒绝
    const restarted = new PanelSendEntryService(store);
    expect(() => restarted.consumeCredential(accepted.credential)).toThrow(
      /wrong-state|consumed/,
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
    service.markRunning(id, undefined);
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
