interface PowerSaveBlocker {
  start(type: "prevent-app-suspension"): number;
  stop(id: number): boolean;
}

/** Keeps the system awake for the lifetime of the desktop app, including background use. */
export class SleepPrevention {
  private blockerId: number | undefined;

  constructor(private readonly blocker: PowerSaveBlocker) {}

  setEnabled(enabled: boolean): void {
    if (enabled) {
      this.blockerId ??= this.blocker.start("prevent-app-suspension");
    } else if (this.blockerId !== undefined) {
      this.blocker.stop(this.blockerId);
      this.blockerId = undefined;
    }
  }

  dispose(): void {
    this.setEnabled(false);
  }
}
