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

import { randomUUID } from "node:crypto";
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
  ): SubmissionLedgerRecord;
}

/** Consumed or unknown credential — the send entry refuses to reissue. */
export class SendEntryCredentialError extends Error {
  constructor(readonly code: "unknown" | "consumed" | "wrong-state", message: string) {
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
    const credential = `${submissionId}.${randomUUID()}`;
    return { threadId: input.threadId, candidateText: trimmed, credential, submission };
  }

  /**
   * Consume the credential: transitions accepted → queued → dispatching
   * and returns the text for the composer. Second consume throws.
   */
  consumeCredential(credential: string): ConsumedSendEntry {
    const [submissionId, nonce] = credential.split(".");
    if (!submissionId || !nonce) {
      throw new SendEntryCredentialError("unknown", "malformed credential");
    }
    const record = this.store.getPromptSubmission(submissionId);
    if (!record || credential !== `${record.submissionId}.${nonce}`) {
      throw new SendEntryCredentialError("unknown", "credential does not match a submission");
    }
    if (this.consumed.has(credential)) {
      throw new SendEntryCredentialError("consumed", "credential already used");
    }
    // Only an accepted (never yet sent) candidate may be consumed.
    if (record.state !== "accepted") {
      throw new SendEntryCredentialError(
        "wrong-state",
        `submission is ${record.state}, expected accepted`,
      );
    }
    this.store.transitionPromptSubmission(submissionId, "queued", "host-send-entry-queued");
    const dispatching = this.store.transitionPromptSubmission(
      submissionId,
      "dispatching",
      "host-send-entry-dispatching",
    );
    this.consumed.add(credential);
    return { threadId: dispatching.threadId, candidateText: dispatching.candidateText };
  }

  /** Renderer confirmed the composer actually submitted the turn. */
  markRunning(submissionId: string, turnId: string | undefined): SubmissionLedgerRecord {
    const record = this.store.getPromptSubmission(submissionId);
    if (!record) throw new SendEntryCredentialError("unknown", "no such submission");
    if (record.state === "dispatching" || record.state === "queued") {
      const running = this.store.transitionPromptSubmission(
        submissionId,
        "running",
        "composer-submitted",
      );
      return turnId ? running : running;
    }
    return record;
  }

  /** User discarded the card: accepted → cancelled, credential voided. */
  discardCandidate(credential: string): void {
    const [submissionId, nonce] = credential.split(".");
    if (!submissionId || !nonce) {
      throw new SendEntryCredentialError("unknown", "malformed credential");
    }
    const record = this.store.getPromptSubmission(submissionId);
    if (!record || credential !== `${record.submissionId}.${nonce}`) {
      throw new SendEntryCredentialError("unknown", "credential does not match");
    }
    if (record.state === "accepted") {
      this.store.transitionPromptSubmission(submissionId, "cancelled", "user-discard");
      this.consumed.add(credential);
    }
  }

  /**
   * Turn-outcome reconciliation hook: transitions every dispatching/running
   * row of this thread to the turn outcome. Idempotent — terminal rows are
   * returned untouched. Called from applyPayloadSideEffects so both the
   * single-event and batch paths reconcile.
   */
  reconcileTurnOutcome(
    threadId: string,
    outcome: "completed" | "failed",
  ): void {
    for (const record of this.store.listPromptSubmissions(threadId)) {
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
    if (!record) throw new SendEntryCredentialError("unknown", "no such submission");
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
