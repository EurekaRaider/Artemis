import { createHash, timingSafeEqual } from "node:crypto";

import type { ApprovalResolution, ApprovalScope } from "@artemis/protocol";

interface PendingApproval<T> {
  approvalId: string;
  nonce: string;
  allowedScopes: ApprovalScope[];
  value: T;
}

export interface CancelledApproval<T> {
  approvalId: string;
  nonce: string;
  value: T;
}

function nonceMatches(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return (
    expectedBuffer.length === actualBuffer.length &&
    timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

export class PendingApprovalRegistry<T> {
  private readonly pending = new Map<string, PendingApproval<T>>();

  get size(): number {
    return this.pending.size;
  }

  hasWhere(predicate: (value: T) => boolean): boolean {
    for (const pending of this.pending.values()) {
      if (predicate(pending.value)) return true;
    }
    return false;
  }

  register(approval: PendingApproval<T>): void {
    if (this.pending.has(approval.approvalId)) {
      throw new Error(`Approval is already pending: ${approval.approvalId}`);
    }
    this.pending.set(approval.approvalId, approval);
  }

  consume(resolution: ApprovalResolution): T {
    const pending = this.pending.get(resolution.approvalId);
    if (!pending) {
      throw new Error("Approval is no longer pending.");
    }
    if (!nonceMatches(pending.nonce, resolution.nonce)) {
      throw new Error("Approval nonce does not match.");
    }
    if (!pending.allowedScopes.includes(resolution.scope)) {
      throw new Error("Approval scope was not offered for this operation.");
    }
    if (!resolution.approved && resolution.scope !== "once") {
      throw new Error("Denied approvals must use one-time scope.");
    }

    this.pending.delete(resolution.approvalId);
    return pending.value;
  }

  cancelWhere(predicate: (value: T) => boolean): CancelledApproval<T>[] {
    const cancelled: CancelledApproval<T>[] = [];
    for (const [approvalId, pending] of this.pending) {
      if (!predicate(pending.value)) {
        continue;
      }
      this.pending.delete(approvalId);
      cancelled.push({
        approvalId,
        nonce: pending.nonce,
        value: pending.value,
      });
    }
    return cancelled;
  }
}

export function createApprovalFingerprint(
  operation: string,
  target: string,
): string {
  return createHash("sha256")
    .update(operation)
    .update("\0")
    .update(target)
    .digest("hex");
}
