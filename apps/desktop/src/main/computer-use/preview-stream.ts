import {
  sharedTexture,
  type WebContents,
  type SharedTextureImportTextureInfo,
} from "electron";
import { PreviewFrameQueue } from "./preview-frame-queue.js";

export interface PreviewTexture {
  textureInfo: SharedTextureImportTextureInfo;
  capturedAt: number;
  release(): void;
}
export class PreviewStream {
  private readonly consumers = new Map<string, WebContents>();
  private readonly queue: PreviewFrameQueue<PreviewTexture>;
  private sequence = 0;
  private closed = false;
  private readonly errors = new Set<(error: unknown) => void>();
  constructor(
    readonly id: string,
    private readonly changed: (visible: boolean) => void,
    private readonly failed: (error: unknown) => void,
  ) {
    this.queue = new PreviewFrameQueue(
      async (frame) => {
        const consumers = [...this.consumers].filter(
          ([, contents]) => !contents.isDestroyed(),
        );
        if (!consumers.length) return;
        let released = false;
        let complete!: () => void;
        const completed = new Promise<void>((resolve) => {
          complete = resolve;
        });
        const releaseSource = frame.release.bind(frame);
        const release = () => {
          if (!released) {
            released = true;
            releaseSource();
            complete();
          }
        };
        const imported = sharedTexture.importSharedTexture({
          textureInfo: frame.textureInfo,
          allReferencesReleased: release,
        });
        const metadata = {
          sessionId: this.id,
          capturedAt: frame.capturedAt,
          sequence: ++this.sequence,
        };
        // The imported texture owns the source until all GPU consumers release it.
        frame.release = () => {};
        try {
          await Promise.all(
            consumers.map(async ([token, contents]) => {
              try {
                await sharedTexture.sendSharedTexture(
                  {
                    frame: contents.mainFrame,
                    importedSharedTexture: imported,
                  },
                  token,
                  metadata,
                );
              } catch {
                this.unsubscribe(token);
              }
            }),
          );
        } finally {
          imported.release();
        }
        // Electron's transfer promise resolves before drawing. Backpressure must
        // include GPU consumption, otherwise slow rendering grows the texture pool.
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            completed,
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error("Preview GPU consumption timed out")),
                1000,
              );
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      },
      (error) => this.fail(error),
    );
  }
  subscribe(token: string, contents: WebContents) {
    if (this.closed)
      throw new Error("Preview stream stopped. Reopen the target.");
    if (this.consumers.has(token)) {
      if (this.consumers.get(token) !== contents)
        throw new Error("Preview subscriber ownership mismatch");
      return;
    }
    if (this.consumers.size >= 8) throw new Error("Too many preview consumers");
    this.consumers.set(token, contents);
    this.changed(true);
  }
  unsubscribe(token: string) {
    if (!this.consumers.delete(token)) return;
    if (!this.consumers.size) this.changed(false);
  }
  removeContents(contents: WebContents) {
    for (const [token, owner] of this.consumers)
      if (owner === contents) this.unsubscribe(token);
  }
  owns(token: string, contents: WebContents) {
    return this.consumers.get(token) === contents;
  }
  visible() {
    return this.consumers.size > 0;
  }
  stopped() {
    return this.closed;
  }
  onFailure(listener: (error: unknown) => void) {
    this.errors.add(listener);
    return () => this.errors.delete(listener);
  }
  fail(error: unknown) {
    if (this.closed) return;
    this.close();
    this.failed(error);
    for (const listener of this.errors) listener(error);
  }
  push(frame: PreviewTexture) {
    if (this.visible()) this.queue.push(frame);
    else frame.release();
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.queue.close();
    this.consumers.clear();
    this.changed(false);
  }
}
