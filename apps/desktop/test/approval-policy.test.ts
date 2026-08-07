import { describe, expect, it } from "vitest";

import {
  PendingApprovalRegistry,
  createApprovalFingerprint,
} from "../src/main/approval-policy.js";

describe("PendingApprovalRegistry", () => {
  it("rejects nonce mismatches and consumes a valid resolution only once", () => {
    const registry = new PendingApprovalRegistry<{ requestId: string }>();
    registry.register({
      approvalId: "approval-1",
      nonce: "nonce-1",
      allowedScopes: ["once", "session"],
      value: { requestId: "worker-1" },
    });

    expect(() =>
      registry.consume({
        approvalId: "approval-1",
        nonce: "wrong",
        approved: true,
        scope: "once",
      }),
    ).toThrow(/nonce/i);
    expect(registry.size).toBe(1);

    expect(
      registry.consume({
        approvalId: "approval-1",
        nonce: "nonce-1",
        approved: true,
        scope: "session",
      }),
    ).toEqual({ requestId: "worker-1" });
    expect(registry.size).toBe(0);

    expect(() =>
      registry.consume({
        approvalId: "approval-1",
        nonce: "nonce-1",
        approved: true,
        scope: "session",
      }),
    ).toThrow(/no longer pending/i);
  });

  it("rejects an unoffered scope without consuming the approval", () => {
    const registry = new PendingApprovalRegistry<string>();
    registry.register({
      approvalId: "approval-1",
      nonce: "nonce-1",
      allowedScopes: ["once"],
      value: "pending",
    });

    expect(() =>
      registry.consume({
        approvalId: "approval-1",
        nonce: "nonce-1",
        approved: true,
        scope: "project",
      }),
    ).toThrow(/scope/i);
    expect(registry.size).toBe(1);
  });

  it("creates stable, target-specific approval fingerprints", () => {
    const first = createApprovalFingerprint(
      "workspace.write",
      "D:\\workspace\\README.md",
    );

    expect(
      createApprovalFingerprint("workspace.write", "D:\\workspace\\README.md"),
    ).toBe(first);
    expect(
      createApprovalFingerprint("workspace.write", "D:\\workspace\\OTHER.md"),
    ).not.toBe(first);
  });

  it("cancels only matching pending approvals", () => {
    const registry = new PendingApprovalRegistry<{ threadId: string }>();
    for (const [approvalId, threadId] of [
      ["approval-1", "thread-1"],
      ["approval-2", "thread-2"],
    ]) {
      registry.register({
        approvalId,
        nonce: `nonce-${approvalId}`,
        allowedScopes: ["once"],
        value: { threadId },
      });
    }

    expect(
      registry.cancelWhere((value) => value.threadId === "thread-1"),
    ).toMatchObject([
      {
        approvalId: "approval-1",
        value: { threadId: "thread-1" },
      },
    ]);
    expect(registry.size).toBe(1);
  });
});
