export type AgentExecutionKind = "parent" | "child";

interface QueuedExecution {
  kind: AgentExecutionKind;
  schedulingKey: string;
  start(): void;
  reject(error: unknown): void;
  removeAbortListener?(): void;
}

export interface AgentConcurrencySnapshot {
  active: number;
  activeParents: number;
  waiting: number;
  queued: number;
  limit: number;
}

export interface AgentConcurrencyLease {
  suspend<T>(task: () => Promise<T>): Promise<T>;
}

class AgentConcurrencyLeaseImpl implements AgentConcurrencyLease {
  private held = false;

  constructor(
    private readonly owner: AgentConcurrencyLimiter,
    readonly kind: AgentExecutionKind,
    readonly schedulingKey: string,
    readonly signal?: AbortSignal,
  ) {}

  markHeld(): void {
    if (this.held) throw new Error("Agent concurrency lease is already held");
    this.held = true;
  }

  releaseIfHeld(): void {
    if (!this.held) return;
    this.held = false;
    this.owner.release(this.kind);
  }

  async suspend<T>(task: () => Promise<T>): Promise<T> {
    if (!this.held) {
      throw new Error("Agent concurrency lease is not active");
    }
    this.releaseIfHeld();
    this.owner.beginWaiting();

    let result: T | undefined;
    let taskError: unknown;
    let taskFailed = false;
    try {
      result = await this.waitForTask(task);
    } catch (error) {
      taskFailed = true;
      taskError = error;
    }

    try {
      await this.owner.reacquire(this);
    } finally {
      this.owner.endWaiting();
    }
    if (taskFailed) throw taskError;
    return result as T;
  }

  private async waitForTask<T>(task: () => Promise<T>): Promise<T> {
    if (!this.signal) return task();
    if (this.signal.aborted) {
      throw this.signal.reason ?? new DOMException("Aborted", "AbortError");
    }
    return new Promise<T>((resolve, reject) => {
      const abort = () => {
        reject(
          this.signal?.reason ?? new DOMException("Aborted", "AbortError"),
        );
      };
      this.signal!.addEventListener("abort", abort, { once: true });
      void task().then(
        (value) => {
          this.signal!.removeEventListener("abort", abort);
          resolve(value);
        },
        (error: unknown) => {
          this.signal!.removeEventListener("abort", abort);
          reject(error);
        },
      );
    });
  }
}

export class AgentConcurrencyLimiter {
  private active = 0;
  private activeParents = 0;
  private waiting = 0;
  private readonly queue: QueuedExecution[] = [];
  private lastSchedulingKey: string | undefined;

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
      waiting: this.waiting,
      queued: this.queue.length,
      limit: this.limit,
    };
  }

  run<T>(
    kind: AgentExecutionKind,
    task: (lease: AgentConcurrencyLease) => Promise<T>,
    signal?: AbortSignal,
    schedulingKey = "default",
  ): Promise<T> {
    const lease = new AgentConcurrencyLeaseImpl(
      this,
      kind,
      schedulingKey,
      signal,
    );
    return new Promise<T>((resolve, reject) => {
      const queued: QueuedExecution = {
        kind,
        schedulingKey,
        start: () => {
          lease.markHeld();
          void task(lease).then(
            (result) => {
              lease.releaseIfHeld();
              resolve(result);
            },
            (error: unknown) => {
              lease.releaseIfHeld();
              reject(error);
            },
          );
        },
        reject,
      };
      this.enqueue(queued, signal);
    });
  }

  beginWaiting(): void {
    this.waiting += 1;
  }

  endWaiting(): void {
    this.waiting = Math.max(0, this.waiting - 1);
  }

  release(kind: AgentExecutionKind): void {
    this.active -= 1;
    if (kind === "parent") this.activeParents -= 1;
    this.drain();
  }

  reacquire(lease: AgentConcurrencyLeaseImpl): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.enqueue(
        {
          kind: lease.kind,
          schedulingKey: lease.schedulingKey,
          start: () => {
            lease.markHeld();
            resolve();
          },
          reject,
        },
        lease.signal,
      );
    });
  }

  private enqueue(queued: QueuedExecution, signal?: AbortSignal): void {
    if (signal?.aborted) {
      queued.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    if (signal) {
      const abort = () => {
        const index = this.queue.indexOf(queued);
        if (index < 0) return;
        this.queue.splice(index, 1);
        queued.reject(
          signal.reason ?? new DOMException("Aborted", "AbortError"),
        );
      };
      signal.addEventListener("abort", abort, { once: true });
      queued.removeAbortListener = () =>
        signal.removeEventListener("abort", abort);
    }
    this.queue.push(queued);
    this.drain();
  }

  private canRun(kind: AgentExecutionKind): boolean {
    const rootWaiting = this.queue.some((queued) => queued.kind === "parent");
    const preservesRootSlot =
      kind === "parent" ||
      this.activeParents > 0 ||
      !rootWaiting ||
      this.active < this.limit - 1;
    return (
      this.active < this.limit &&
      preservesRootSlot &&
      (kind === "child" || this.activeParents < this.parentLimit)
    );
  }

  private nextRunnableIndex(): number {
    const differentKey = this.queue.findIndex(
      (queued) =>
        queued.schedulingKey !== this.lastSchedulingKey &&
        this.canRun(queued.kind),
    );
    return differentKey >= 0
      ? differentKey
      : this.queue.findIndex((queued) => this.canRun(queued.kind));
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
      const index = this.nextRunnableIndex();
      if (index < 0) return;
      const queued = this.queue.splice(index, 1)[0]!;
      queued.removeAbortListener?.();
      this.active += 1;
      if (queued.kind === "parent") this.activeParents += 1;
      this.lastSchedulingKey = queued.schedulingKey;
      queued.start();
    }
  }
}
