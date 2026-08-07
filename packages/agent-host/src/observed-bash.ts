import { randomUUID } from "node:crypto";

import {
  createLocalBashOperations,
  type BashOperations,
} from "@earendil-works/pi-coding-agent";

export type ObservedBashStatus =
  "running" | "cancelling" | "completed" | "failed" | "cancelled";

export type ObservedBashHealth = "healthy" | "suspect" | "stalled";

interface BashScope {
  threadId: string;
  turnId: string;
  ownerId: string;
}

interface ObserveInput extends BashScope {
  observationMilliseconds: number;
}

export interface StartObservedBashInput extends ObserveInput {
  command: string;
  cwd: string;
  onActivity?(snapshot: ObservedBashSnapshot): void;
}

export interface WaitObservedBashInput extends ObserveInput {
  executionId: string;
}

export interface CancelObservedBashInput extends BashScope {
  executionId: string;
}

export interface ObservedBashSnapshot {
  executionId: string;
  command: string;
  status: ObservedBashStatus;
  health: ObservedBashHealth;
  startedAt: string;
  lastActivityAt: string;
  elapsedMilliseconds: number;
  observationExpired: boolean;
  outputDelta: string;
  outputTruncated: boolean;
  exitCode?: number | null;
  error?: string;
}

interface ObservedBashRecord extends BashScope {
  executionId: string;
  command: string;
  controller: AbortController;
  status: ObservedBashStatus;
  startedAt: number;
  lastActivityAt: number;
  pendingOutput: string;
  outputTruncated: boolean;
  longestObservationMilliseconds: number;
  exitCode?: number | null;
  error?: string;
  settled: Promise<void>;
  settle(): void;
}

const MAX_PENDING_OUTPUT_CHARS = 64 * 1024;
const MIN_SUSPECT_SILENCE_MILLISECONDS = 60_000;
const CANCEL_OBSERVATION_MILLISECONDS = 5_000;

function scopeKey(scope: BashScope): string {
  return `${scope.threadId}\0${scope.turnId}\0${scope.ownerId}`;
}

function isActive(status: ObservedBashStatus): boolean {
  return status === "running" || status === "cancelling";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ObservedBashRegistry {
  private readonly records = new Map<string, ObservedBashRecord>();

  constructor(
    private readonly operations: BashOperations = createLocalBashOperations(),
  ) {}

  async start(input: StartObservedBashInput): Promise<ObservedBashSnapshot> {
    this.validateObservation(input.observationMilliseconds);
    const executionId = randomUUID();
    const controller = new AbortController();
    let settle!: () => void;
    const settled = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const now = Date.now();
    const record: ObservedBashRecord = {
      threadId: input.threadId,
      turnId: input.turnId,
      ownerId: input.ownerId,
      command: input.command,
      executionId,
      controller,
      status: "running",
      startedAt: now,
      lastActivityAt: now,
      pendingOutput: "",
      outputTruncated: false,
      longestObservationMilliseconds: input.observationMilliseconds,
      settled,
      settle,
    };
    this.records.set(executionId, record);

    void this.operations
      .exec(input.command, input.cwd, {
        signal: controller.signal,
        onData: (data) => {
          const outputDelta = data.toString("utf8");
          this.appendOutput(record, outputDelta);
          try {
            input.onActivity?.({
              ...this.snapshot(record, false, false),
              outputDelta,
            });
          } catch {
            // Rendering progress must never interrupt the underlying process.
          }
        },
      })
      .then(({ exitCode }) => {
        record.exitCode = exitCode;
        if (controller.signal.aborted || exitCode === null) {
          record.status = "cancelled";
        } else if (exitCode === 0) {
          record.status = "completed";
        } else {
          record.status = "failed";
          record.error = `Command exited with code ${exitCode}.`;
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          record.status = "cancelled";
        } else {
          record.status = "failed";
          record.error = errorMessage(error);
        }
      })
      .finally(() => {
        record.lastActivityAt = Date.now();
        record.settle();
      });

    const observationExpired = await this.observe(
      record,
      input.observationMilliseconds,
    );
    return this.snapshot(record, observationExpired);
  }

  async wait(input: WaitObservedBashInput): Promise<ObservedBashSnapshot> {
    this.validateObservation(input.observationMilliseconds);
    const record = this.ownedRecord(input);
    record.longestObservationMilliseconds = Math.max(
      record.longestObservationMilliseconds,
      input.observationMilliseconds,
    );
    const observationExpired = await this.observe(
      record,
      input.observationMilliseconds,
    );
    return this.snapshot(record, observationExpired);
  }

  async cancel(input: CancelObservedBashInput): Promise<ObservedBashSnapshot> {
    const record = this.ownedRecord(input);
    if (record.status === "running") {
      record.status = "cancelling";
      record.lastActivityAt = Date.now();
      record.controller.abort();
    }
    const observationExpired = await this.observe(
      record,
      CANCEL_OBSERVATION_MILLISECONDS,
    );
    return this.snapshot(record, observationExpired);
  }

  cancelScope(scope: BashScope): void {
    const expectedScope = scopeKey(scope);
    for (const [executionId, record] of this.records) {
      if (scopeKey(record) !== expectedScope) continue;
      if (isActive(record.status)) {
        record.status = "cancelling";
        record.lastActivityAt = Date.now();
        record.controller.abort();
      }
      this.records.delete(executionId);
    }
  }

  cancelTurn(threadId: string, turnId: string): void {
    for (const [executionId, record] of this.records) {
      if (record.threadId !== threadId || record.turnId !== turnId) continue;
      if (isActive(record.status)) {
        record.status = "cancelling";
        record.lastActivityAt = Date.now();
        record.controller.abort();
      }
      this.records.delete(executionId);
    }
  }

  disposeThread(threadId: string): void {
    for (const [executionId, record] of this.records) {
      if (record.threadId !== threadId) continue;
      if (isActive(record.status)) record.controller.abort();
      this.records.delete(executionId);
    }
  }

  private validateObservation(value: number): void {
    if (!Number.isFinite(value) || value < 1) {
      throw new Error("Observation deadline must be at least 1 millisecond.");
    }
  }

  private ownedRecord(input: CancelObservedBashInput): ObservedBashRecord {
    const record = this.records.get(input.executionId);
    if (!record || scopeKey(record) !== scopeKey(input)) {
      throw new Error("Bash execution was not found in this agent scope.");
    }
    return record;
  }

  private appendOutput(record: ObservedBashRecord, delta: string): void {
    if (!delta) return;
    record.lastActivityAt = Date.now();
    record.pendingOutput += delta;
    if (record.pendingOutput.length > MAX_PENDING_OUTPUT_CHARS) {
      record.pendingOutput = record.pendingOutput.slice(
        -MAX_PENDING_OUTPUT_CHARS,
      );
      record.outputTruncated = true;
    }
  }

  private async observe(
    record: ObservedBashRecord,
    observationMilliseconds: number,
  ): Promise<boolean> {
    if (!isActive(record.status)) return false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<"deadline">((resolve) => {
      timer = setTimeout(() => resolve("deadline"), observationMilliseconds);
    });
    const result = await Promise.race([
      record.settled.then(() => "settled" as const),
      deadline,
    ]);
    if (timer) clearTimeout(timer);
    return result === "deadline" && isActive(record.status);
  }

  private snapshot(
    record: ObservedBashRecord,
    observationExpired: boolean,
    consumeOutput = true,
  ): ObservedBashSnapshot {
    const now = Date.now();
    const suspectAfter = Math.max(
      MIN_SUSPECT_SILENCE_MILLISECONDS,
      record.longestObservationMilliseconds * 2,
    );
    const health: ObservedBashHealth =
      record.status === "cancelling"
        ? "suspect"
        : record.status === "running" &&
            now - record.lastActivityAt >= suspectAfter
          ? "suspect"
          : "healthy";
    const outputDelta = record.pendingOutput;
    if (consumeOutput) record.pendingOutput = "";
    return {
      executionId: record.executionId,
      command: record.command,
      status: record.status,
      health,
      startedAt: new Date(record.startedAt).toISOString(),
      lastActivityAt: new Date(record.lastActivityAt).toISOString(),
      elapsedMilliseconds: now - record.startedAt,
      observationExpired,
      outputDelta,
      outputTruncated: record.outputTruncated,
      ...(record.exitCode === undefined ? {} : { exitCode: record.exitCode }),
      ...(record.error ? { error: record.error } : {}),
    };
  }
}
