export interface ReleasablePreviewFrame {
  release(): void;
}

/** A single GPU transfer plus the newest pending frame; no unbounded work queue. */
export class PreviewFrameQueue<T extends ReleasablePreviewFrame> {
  private pending: T | undefined;
  private busy = false;
  private closed = false;
  constructor(
    private readonly consume: (frame: T) => Promise<void>,
    private readonly failed: (error: unknown) => void,
  ) {}
  push(frame: T) {
    if (this.closed) {
      frame.release();
      return;
    }
    if (this.busy) {
      this.pending?.release();
      this.pending = frame;
    } else void this.send(frame);
  }
  private async send(frame: T) {
    this.busy = true;
    try {
      await this.consume(frame);
    } catch (error) {
      if (!this.closed) this.failed(error);
    } finally {
      frame.release();
      this.busy = false;
      const pending = this.pending;
      this.pending = undefined;
      if (pending) {
        if (this.closed) pending.release();
        else void this.send(pending);
      }
    }
  }
  close() {
    this.closed = true;
    this.pending?.release();
    this.pending = undefined;
  }
}
