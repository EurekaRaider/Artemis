import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { SubmissionLedger } from "../src/main/design-plugin-submission-ledger.js";

let dir: string;
let ledgerPath: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "s0-ledger-"));
  ledgerPath = join(dir, "ledger.sqlite");
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("SubmissionLedger (S0 crash windows)", () => {
  it("accept is idempotent for the same id and payload", () => {
    const ledger = new SubmissionLedger(ledgerPath);
    const id = randomUUID();
    const first = ledger.accept({
      submissionId: id,
      threadId: "thread-1",
      source: "panel",
      candidateText: "把这个按钮改为深绿",
      bindingRevision: "rev-1",
    });
    const second = ledger.accept({
      submissionId: id,
      threadId: "thread-1",
      source: "panel",
      candidateText: "把这个按钮改为深绿",
      bindingRevision: "rev-1",
    });
    expect(second).toEqual(first);
    expect(first.state).toBe("accepted");
    ledger.close();
  });

  it("rejects the same id with a different payload (corruption guard)", () => {
    const ledger = new SubmissionLedger(ledgerPath);
    const id = randomUUID();
    ledger.accept({
      submissionId: id,
      threadId: "thread-1",
      source: "composer",
      candidateText: "original",
      bindingRevision: "rev-1",
    });
    expect(() =>
      ledger.accept({
        submissionId: id,
        threadId: "thread-1",
        source: "composer",
        candidateText: "tampered",
        bindingRevision: "rev-1",
      }),
    ).toThrow(/different payload/);
    ledger.close();
  });

  it("two independent user actions with identical text get distinct records", () => {
    const ledger = new SubmissionLedger(ledgerPath);
    const a = ledger.accept({
      submissionId: randomUUID(),
      threadId: "thread-1",
      source: "panel",
      candidateText: "same text",
      bindingRevision: "rev-1",
    });
    const b = ledger.accept({
      submissionId: randomUUID(),
      threadId: "thread-1",
      source: "panel",
      candidateText: "same text",
      bindingRevision: "rev-1",
    });
    expect(a.submissionId).not.toBe(b.submissionId);
    expect(b.sequence).toBe(a.sequence + 1);
    ledger.close();
  });

  it("enforces the state machine on transitions", () => {
    const ledger = new SubmissionLedger(ledgerPath);
    const id = randomUUID();
    ledger.accept({
      submissionId: id,
      threadId: "thread-2",
      source: "panel",
      candidateText: "x",
      bindingRevision: "rev-1",
    });
    expect(() => ledger.transition(id, "running", "skip")).toThrow(/Illegal/);
    ledger.transition(id, "queued", "queued");
    ledger.transition(id, "dispatching", "dispatched", "turn-1");
    ledger.transition(id, "running", "agent started");
    ledger.transition(id, "completed", "done");
    expect(() => ledger.transition(id, "queued", "replay")).toThrow(/Illegal/);
    ledger.close();
  });

  it("crash window 1: accepted-but-not-dispatched is redispatchable after restart", () => {
    const id = randomUUID();
    {
      const ledger = new SubmissionLedger(ledgerPath);
      ledger.accept({
        submissionId: id,
        threadId: "thread-3",
        source: "panel",
        candidateText: "pending work",
        bindingRevision: "rev-1",
      });
      ledger.close(); // simulate crash before dispatch
    }
    {
      const ledger = new SubmissionLedger(ledgerPath);
      const { redispatchable, unknown } = ledger.recover();
      expect(redispatchable.map((r) => r.submissionId)).toContain(id);
      expect(unknown.map((r) => r.submissionId)).not.toContain(id);
      ledger.close();
    }
  });

  it("crash window 2: dispatching without confirmation becomes unknown, never replayed", () => {
    const id = randomUUID();
    {
      const ledger = new SubmissionLedger(ledgerPath);
      ledger.accept({
        submissionId: id,
        threadId: "thread-4",
        source: "panel",
        candidateText: "in flight",
        bindingRevision: "rev-1",
      });
      ledger.transition(id, "queued", "queued");
      ledger.transition(id, "dispatching", "dispatch started");
      ledger.close(); // crash between dispatch and confirmation
    }
    {
      const ledger = new SubmissionLedger(ledgerPath);
      const { redispatchable, unknown } = ledger.recover();
      const record = unknown.find((r) => r.submissionId === id);
      expect(record).toBeDefined();
      expect(record?.state).toBe("unknown");
      expect(record?.lastTransitionReason).toContain("dispatching");
      expect(redispatchable.map((r) => r.submissionId)).not.toContain(id);
      ledger.close();
    }
  });

  it("crash window 3: running without terminal state becomes unknown, never replayed", () => {
    const id = randomUUID();
    {
      const ledger = new SubmissionLedger(ledgerPath);
      ledger.accept({
        submissionId: id,
        threadId: "thread-5",
        source: "composer",
        candidateText: "mid turn",
        bindingRevision: "rev-1",
      });
      ledger.transition(id, "queued", "queued");
      ledger.transition(id, "dispatching", "dispatched", "turn-9");
      ledger.transition(id, "running", "agent started");
      ledger.close(); // crash mid-turn
    }
    {
      const ledger = new SubmissionLedger(ledgerPath);
      const { unknown } = ledger.recover();
      const record = unknown.find((r) => r.submissionId === id);
      expect(record?.state).toBe("unknown");
      expect(record?.turnId).toBe("turn-9");
      ledger.close();
    }
  });

  it("recover is idempotent across repeated restarts", () => {
    const id = randomUUID();
    {
      const ledger = new SubmissionLedger(ledgerPath);
      ledger.accept({
        submissionId: id,
        threadId: "thread-6",
        source: "panel",
        candidateText: "stuck",
        bindingRevision: "rev-1",
      });
      ledger.transition(id, "queued", "queued");
      ledger.transition(id, "dispatching", "dispatch started");
      ledger.close();
    }
    for (let restart = 0; restart < 3; restart++) {
      const ledger = new SubmissionLedger(ledgerPath);
      const { unknown, redispatchable } = ledger.recover();
      expect(unknown.map((r) => r.submissionId)).toContain(id);
      expect(redispatchable.map((r) => r.submissionId)).not.toContain(id);
      ledger.close();
    }
  });
});
