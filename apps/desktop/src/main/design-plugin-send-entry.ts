// S3 host send-entry service (proposal §9.2/§9.3 slice).
//
// Panel candidates never reach Pi directly. The panel dispatches a DOM
// event; the host surfaces a candidate card; when the user presses Send,
// the renderer asks the main process to CONSUME a one-time credential:
//
//   1. candidate  → main accepts it into the prompt_submissions ledger
//                   (state "accepted", bindingRevision frozen) and issues
//                   a one-time credential (the submissionId + a nonce).
//   2. send       → renderer presents the credential; main transitions
//                   accepted → queued → dispatching, hands the text back
//                   for the composer, and marks the credential consumed.
//                   A second consume with the same credential is refused.
//   3. outcome    → renderer reports the turn id after the prompt is
//                   actually submitted; main records running/completed.
//
// Crash safety: every step is a ledger transition; a restart reads rows
// and reconciles instead of re-offering consumed credentials.
//
// PR#245 P2-9/P2-10 hardening:
//   - Nonces are verified against the digest of the ISSUED nonce (the old
//     check rebuilt the credential from the presented nonce, validating
//     nothing but the submission id). Consume/discard/stage require the
//     digest match; the registry entry is burned on first use.
//   - The ledger binds the submission to the turn it started (turn_id);
//     turn-outcome reconciliation only touches rows of THAT turn, so an
//     unsent draft can no longer be completed by a sibling turn.
//   - 「加入输入框」(add-to-composer) no longer consumes into
//     "dispatching": the credential is staged out (accepted → cancelled,
//     reason staged-to-composer) because the text leaves the credential
//     channel the moment it lands in the editable composer.

import { createHash, randomUUID } from "node:crypto";
import type { SubmissionLedgerRecord } from "@artemis/protocol";

export interface SendEntryStore {
  acceptPromptSubmission(input: {
    submissionId: string;
    threadId: string;
    source: "panel" | "composer";
    candidateText: string;
    bindingRevision: string;
  }): SubmissionLedgerRecord;
  getPromptSubmission(submissionId: string): SubmissionLedgerRecord | undefined;
  listPromptSubmissions(threadId: string): SubmissionLedgerRecord[];
  transitionPromptSubmission(
    submissionId: string,
    nextState: SubmissionLedgerRecord["state"],
    reason: string,
    turnId?: string,
  ): SubmissionLedgerRecord;
}

/** Consumed or unknown credential — the send entry refuses to reissue. */
export class SendEntryCredentialError extends Error {
  constructor(
    readonly code: "unknown" | "consumed" | "wrong-state",
    message: string,
  ) {
    super(`Send-entry credential ${code}: ${message}`);
    this.name = "SendEntryCredentialError";
  }
}

export interface AcceptedCandidate {
  threadId: string;
  candidateText: string;
  /** Opaque one-time credential; single consume entitles one send. */
  credential: string;
  submission: SubmissionLedgerRecord;
}

export interface ConsumedSendEntry {
  threadId: string;
  candidateText: string;
}

/** In-memory credential registry; rows in prompt_submissions are the truth. */
export class PanelSendEntryService {
  private readonly consumed = new Set<string>();
  /** submissionId → SHA-256 of the issued nonce (P2-9: verify what we minted). */
  private readonly issuedNonceDigests = new Map<string, string>();

  constructor(private readonly store: SendEntryStore) {}

  /**
   * A panel candidate arrived (user pressed the panel composer's send).
   * Accept it into the ledger and mint a one-time credential.
   */
  acceptCandidate(input: {
    threadId: string;
    candidateText: string;
    bindingRevision: string;
  }): AcceptedCandidate {
    const trimmed = input.candidateText.trim();
    if (!trimmed) throw new Error("Candidate text is empty.");
    const submissionId = randomUUID();
    const submission = this.store.acceptPromptSubmission({
      submissionId,
      threadId: input.threadId,
      source: "panel",
      candidateText: trimmed,
      bindingRevision: input.bindingRevision,
    });
    const nonce = randomUUID();
    this.issuedNonceDigests.set(submissionId, sha256Hex(nonce));
    const credential = `${submissionId}.${nonce}`;
    return {
      threadId: input.threadId,
      candidateText: trimmed,
      credential,
      submission,
    };
  }

  /** P2-9: the presented nonce must hash to the digest we issued. */
  private requireIssuedCredential(credential: string): {
    submissionId: string;
    record: SubmissionLedgerRecord;
  } {
    const [submissionId, nonce] = credential.split(".");
    if (!submissionId || !nonce) {
      throw new SendEntryCredentialError("unknown", "malformed credential");
    }
    const issued = this.issuedNonceDigests.get(submissionId);
    if (!issued || issued !== sha256Hex(nonce)) {
      throw new SendEntryCredentialError(
        "unknown",
        "credential nonce was not issued for this submission",
      );
    }
    const record = this.store.getPromptSubmission(submissionId);
    if (!record) {
      throw new SendEntryCredentialError(
        "unknown",
        "credential does not match a submission",
      );
    }
    return { submissionId, record };
  }

  /**
   * Consume the credential: transitions accepted → queued → dispatching
   * and returns the text for the composer. Second consume throws.
   */
  consumeCredential(credential: string): ConsumedSendEntry {
    if (this.consumed.has(credential)) {
      throw new SendEntryCredentialError("consumed", "credential already used");
    }
    const { submissionId, record } = this.requireIssuedCredential(credential);
    // Only an accepted (never yet sent) candidate may be consumed.
    if (record.state !== "accepted") {
      throw new SendEntryCredentialError(
        "wrong-state",
        `submission is ${record.state}, expected accepted`,
      );
    }
    this.store.transitionPromptSubmission(
      submissionId,
      "queued",
      "host-send-entry-queued",
    );
    const dispatching = this.store.transitionPromptSubmission(
      submissionId,
      "dispatching",
      "host-send-entry-dispatching",
    );
    this.consumed.add(credential);
    this.issuedNonceDigests.delete(submissionId);
    return {
      threadId: dispatching.threadId,
      candidateText: dispatching.candidateText,
    };
  }

  /**
   * P2-10: 「加入输入框」— the text moves into the editable composer and
   * leaves the credential channel. The submission is staged out (accepted →
   * cancelled) instead of entering "dispatching", so a later turn's outcome
   * can never mark this unsent draft as completed.
   */
  stageCredential(credential: string): ConsumedSendEntry {
    if (this.consumed.has(credential)) {
      throw new SendEntryCredentialError("consumed", "credential already used");
    }
    const { submissionId, record } = this.requireIssuedCredential(credential);
    if (record.state !== "accepted") {
      throw new SendEntryCredentialError(
        "wrong-state",
        `submission is ${record.state}, expected accepted`,
      );
    }
    const cancelled = this.store.transitionPromptSubmission(
      submissionId,
      "cancelled",
      "staged-to-composer",
    );
    this.consumed.add(credential);
    this.issuedNonceDigests.delete(submissionId);
    return {
      threadId: cancelled.threadId,
      candidateText: cancelled.candidateText,
    };
  }

  /** Renderer confirmed the composer actually submitted the turn. */
  markRunning(
    submissionId: string,
    turnId: string | undefined,
  ): SubmissionLedgerRecord {
    const record = this.store.getPromptSubmission(submissionId);
    if (!record)
      throw new SendEntryCredentialError("unknown", "no such submission");
    if (record.state === "dispatching" || record.state === "queued") {
      const running = this.store.transitionPromptSubmission(
        submissionId,
        "running",
        "composer-submitted",
        turnId,
      );
      return running;
    }
    return record;
  }

  /**
   * P2-10: bind the thread's in-flight dispatching submission to the turn
   * that just started (the composer is single-flight: a dispatching row at
   * turn.started is the submission that triggered this turn).
   */
  bindStartedTurn(threadId: string, turnId: string | undefined): void {
    if (!turnId) return;
    for (const record of this.store.listPromptSubmissions(threadId)) {
      if (record.state === "dispatching" && !record.turnId) {
        this.store.transitionPromptSubmission(
          record.submissionId,
          "running",
          "turn-started",
          turnId,
        );
      }
    }
  }

  /** User discarded the card: accepted → cancelled, credential voided. */
  discardCandidate(credential: string): void {
    const { submissionId, record } = this.requireIssuedCredential(credential);
    if (record.state === "accepted") {
      this.store.transitionPromptSubmission(
        submissionId,
        "cancelled",
        "user-discard",
      );
      this.consumed.add(credential);
      this.issuedNonceDigests.delete(submissionId);
    }
  }

  /**
   * Turn-outcome reconciliation: transitions the submissions bound to THIS
   * turn to the outcome. Idempotent — terminal rows are returned untouched.
   * Rows bound to another turn, or not yet bound to any turn, are left
   * alone (P2-10: no more cross-turn sweeps).
   */
  reconcileTurnOutcome(
    threadId: string,
    outcome: "completed" | "failed",
    turnId?: string,
  ): void {
    if (!turnId) return;
    for (const record of this.store.listPromptSubmissions(threadId)) {
      if (record.turnId !== turnId) continue;
      if (outcome === "failed") {
        // dispatching/running both allow -> failed directly.
        if (record.state === "dispatching" || record.state === "running") {
          this.store.transitionPromptSubmission(
            record.submissionId,
            "failed",
            "turn-failed",
          );
        }
        continue;
      }
      if (record.state === "dispatching") {
        // dispatching has no direct completed edge; pass through running.
        this.store.transitionPromptSubmission(
          record.submissionId,
          "running",
          "turn-started",
        );
        this.store.transitionPromptSubmission(
          record.submissionId,
          "completed",
          "turn-completed",
        );
      } else if (record.state === "running") {
        this.store.transitionPromptSubmission(
          record.submissionId,
          "completed",
          "turn-completed",
        );
      }
    }
  }

  /**
   * Crash-window recovery at startup: a row still in dispatching/running
   * when the app restarts can never be confirmed — mark unknown (never
   * blindly re-dispatched). Accepted rows stay accepted so their cards can
   * reappear via candidate re-emit.
   */
  recoverInterruptedSubmissions(threadId: string): number {
    let recovered = 0;
    for (const record of this.store.listPromptSubmissions(threadId)) {
      if (record.state === "dispatching" || record.state === "running") {
        this.store.transitionPromptSubmission(
          record.submissionId,
          "unknown",
          "restart-recovery",
        );
        recovered += 1;
      }
    }
    return recovered;
  }

  /** Turn finished (completed/failed) — idempotent terminal recording. */
  markOutcome(
    submissionId: string,
    outcome: "completed" | "failed",
  ): SubmissionLedgerRecord {
    const record = this.store.getPromptSubmission(submissionId);
    if (!record)
      throw new SendEntryCredentialError("unknown", "no such submission");
    if (record.state === outcome) return record;
    if (record.state === "running" || record.state === "unknown") {
      return this.store.transitionPromptSubmission(
        submissionId,
        outcome,
        `turn-${outcome}`,
      );
    }
    return record;
  }
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
