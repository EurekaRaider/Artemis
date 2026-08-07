export type AgentExecutionKind = "parent" | "child";

interface QueuedExecution<T> {
  kind: AgentExecutionKind;
  task(): Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
  removeAbortListener?(): void;
}

export interface AgentConcurrencySnapshot {
  active: number;
  activeParents: number;
  queued: number;
  limit: number;
}

export class AgentConcurrencyLimiter {
  private active = 0;
  private activeParents = 0;
  private readonly queue: QueuedExecution<unknown>[] = [];

  constructor(
    private limit = 10,
    private parentLimit = Math.max(1, limit - 1),
  ) {
    this.validateLimits(limit, parentLimit);
  }

  setLimits(
    limit: number,
    parentLimit = Math.max(1, limit - 1),
  ): AgentConcurrencySnapshot {
    this.validateLimits(limit, parentLimit);
    this.limit = limit;
    this.parentLimit = parentLimit;
    this.drain();
    return this.snapshot;
  }

  get snapshot(): AgentConcurrencySnapshot {
    return {
      active: this.active,
      activeParents: this.activeParents,
      queued: this.queue.length,
      limit: this.limit,
    };
  }

  run<T>(
    kind: AgentExecutionKind,
    task: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
        return;
      }
      const queued: QueuedExecution<T> = {
        kind,
        task,
        resolve: resolve as (value: unknown) => void,
        reject,
      };
      if (signal) {
        const abort = () => {
          const index = this.queue.indexOf(queued as QueuedExecution<unknown>);
          if (index < 0) return;
          this.queue.splice(index, 1);
          reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
        };
        signal.addEventListener("abort", abort, { once: true });
        queued.removeAbortListener = () =>
          signal.removeEventListener("abort", abort);
      }
      this.queue.push(queued as QueuedExecution<unknown>);
      this.drain();
    });
  }

  private canRun(kind: AgentExecutionKind): boolean {
    return (
      this.active < this.limit &&
      (kind === "child" || this.activeParents < this.parentLimit)
    );
  }

  private validateLimits(limit: number, parentLimit: number): void {
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      !Number.isInteger(parentLimit) ||
      parentLimit < 1 ||
      parentLimit > limit
    ) {
      throw new Error("Agent concurrency limits are invalid");
    }
  }

  private drain(): void {
    while (this.active < this.limit) {
      const index = this.queue.findIndex((queued) => this.canRun(queued.kind));
      if (index < 0) {
        return;
      }
      const queued = this.queue.splice(index, 1)[0]!;
      queued.removeAbortListener?.();
      this.active += 1;
      if (queued.kind === "parent") {
        this.activeParents += 1;
      }
      void queued
        .task()
        .then(queued.resolve, queued.reject)
        .finally(() => {
          this.active -= 1;
          if (queued.kind === "parent") {
            this.activeParents -= 1;
          }
          this.drain();
        });
    }
  }
}
