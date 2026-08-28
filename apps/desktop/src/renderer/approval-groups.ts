import type { ApprovalState } from "@artemis/protocol";

export interface ApprovedApprovalGroup {
  approvalIds: string[];
  key: string;
}

export function groupApprovedApprovals(
  order: readonly string[],
  approvals: Readonly<Record<string, ApprovalState>>,
): Map<string, ApprovedApprovalGroup> {
  const groupsByTurn = new Map<string, ApprovedApprovalGroup>();
  const groupsByApproval = new Map<string, ApprovedApprovalGroup>();
  for (const entry of order) {
    if (!entry.startsWith("approval:")) continue;
    const approvalId = entry.slice("approval:".length);
    const approval = approvals[approvalId];
    if (approval?.status !== "approved") continue;
    const key = approval.turnId ?? `approval:${approvalId}`;
    const group = groupsByTurn.get(key) ?? { approvalIds: [], key };
    group.approvalIds.push(approvalId);
    groupsByTurn.set(key, group);
    groupsByApproval.set(approvalId, group);
  }
  return groupsByApproval;
}
