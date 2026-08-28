import { describe, expect, it } from "vitest";

import type { ApprovalState } from "@artemis/protocol";
import { groupApprovedApprovals } from "../src/renderer/approval-groups.js";

function approval(
  approvalId: string,
  turnId: string,
  status: ApprovalState["status"] = "approved",
): ApprovalState {
  return {
    approvalId,
    allowedScopes: ["once"],
    network: [],
    nonce: `nonce-${approvalId}-1234567890`,
    paths: [],
    requestedAt: "2026-08-28T08:00:00.000Z",
    risk: "medium",
    status,
    summary: approvalId,
    turnId,
    type: "approval.requested",
  };
}

describe("resolved approval grouping", () => {
  it("collapses approved requests from one turn while leaving other states alone", () => {
    const approvals = {
      first: approval("first", "turn-1"),
      second: approval("second", "turn-1"),
      pending: approval("pending", "turn-1", "pending"),
      other: approval("other", "turn-2"),
    };

    const groups = groupApprovedApprovals(
      [
        "approval:first",
        "approval:pending",
        "approval:second",
        "approval:other",
      ],
      approvals,
    );

    expect(groups.get("first")?.approvalIds).toEqual(["first", "second"]);
    expect(groups.get("second")).toBe(groups.get("first"));
    expect(groups.has("pending")).toBe(false);
    expect(groups.get("other")?.approvalIds).toEqual(["other"]);
  });
});
