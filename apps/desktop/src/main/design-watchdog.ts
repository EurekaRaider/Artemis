export type DesignStopReason = "unresponsive" | "memory-limit";

/** Main-owned liveness monitoring never waits for the generated page to stop. */
export class DesignWatchdog {
  private timer: ReturnType<typeof setInterval> | undefined;
  private pending = false;
  private lastResponse = 0;
  private excessiveMemorySamples = 0;
  private generation = 0;

  constructor(
    private readonly callbacks: {
      probe(): Promise<void>;
      residentBytes(): number;
      stop(reason: DesignStopReason): void;
    },
  ) {}

  start(): void {
    if (this.timer) return;
    this.lastResponse = Date.now();
    this.generation += 1;
    this.pending = false;
    this.excessiveMemorySamples = 0;
    this.timer = setInterval(() => this.sample(), 1000);
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.generation += 1;
  }

  private stop(reason: DesignStopReason): void {
    this.dispose();
    this.callbacks.stop(reason);
  }

  private sample(): void {
    if (Date.now() - this.lastResponse >= 5000) {
      this.stop("unresponsive");
      return;
    }
    this.excessiveMemorySamples =
      this.callbacks.residentBytes() > 512 * 1024 * 1024
        ? this.excessiveMemorySamples + 1
        : 0;
    if (this.excessiveMemorySamples >= 3) {
      this.stop("memory-limit");
      return;
    }
    // At most one outstanding probe, even if the renderer loops forever.
    if (this.pending) return;
    this.pending = true;
    const generation = this.generation;
    void Promise.resolve()
      .then(() => this.callbacks.probe())
      .then(
        () => {
          if (this.timer && generation === this.generation)
            this.lastResponse = Date.now();
        },
        () => {
          // A failed probe counts as a missed response until the fixed deadline.
        },
      )
      .finally(() => {
        if (generation === this.generation) this.pending = false;
      });
  }
}
