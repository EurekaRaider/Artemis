/** Worker reservations outlive script cancellation and end on actual exit. */
export class CodemodeWorkerPool {
  private active = 0;
  private disposed = false;
  private readonly queue: Array<{
    start(): void;
    reject(error: unknown): void;
  }> = [];

  constructor(private readonly normalCapacity: () => number) {}

  get snapshot() {
    return { active: this.active, queued: this.queue.length };
  }

  acquire(signal?: AbortSignal): Promise<() => void> {
    if (this.disposed)
      return Promise.reject(new Error("Codemode host is closed"));
    if (signal?.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
      const cancel = () => {
        const index = this.queue.indexOf(entry);
        if (index < 0) return;
        this.queue.splice(index, 1);
        reject(signal?.reason);
      };
      const entry = {
        start: () => {
          signal?.removeEventListener("abort", cancel);
          this.active++;
          let released = false;
          resolve(() => {
            if (released) return;
            released = true;
            this.active--;
            this.refresh();
          });
        },
        reject: (error: unknown) => {
          signal?.removeEventListener("abort", cancel);
          reject(error);
        },
      };
      signal?.addEventListener("abort", cancel, { once: true });
      this.queue.push(entry);
      this.refresh();
    });
  }

  refresh(): void {
    // Two exit slots cover shutdown overlap without reducing normal concurrency.
    // Waiting supervisors are included by the host in normalCapacity().
    const capacity = Math.max(1, this.normalCapacity()) + 2;
    while (!this.disposed && this.active < capacity && this.queue.length)
      this.queue.shift()!.start();
  }

  dispose(): void {
    this.disposed = true;
    for (const entry of this.queue.splice(0))
      entry.reject(new Error("Codemode host is closed"));
  }
}
