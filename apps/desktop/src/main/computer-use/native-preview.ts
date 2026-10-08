import { createRequire } from "node:module";
import { z } from "zod";
import type { ComputerTarget } from "@artemis/protocol";
import type {
  ComputerHelperLease,
  ComputerNativeDriver,
} from "./native-driver.js";

const identityBase = {
  version: z.literal(1),
  targetId: z.string().min(1),
  pid: z.number().int().positive(),
  appIdentity: z.string().min(1).max(500),
};
const identitySchema = z.discriminatedUnion("platform", [
  z
    .object({
      ...identityBase,
      platform: z.literal("darwin"),
      windowId: z.number().int().positive(),
      processStart: z.number().positive(),
    })
    .strict(),
  z
    .object({
      ...identityBase,
      platform: z.literal("win32"),
      windowId: z.string().regex(/^[0-9]+$/u),
      processInstance: z.string().max(100),
      windowPid: z.number().int().positive(),
      windowInstance: z.string().max(100),
      appPath: z.string().min(1).max(32768),
    })
    .strict(),
]);
export type NativeWindowIdentity = z.infer<typeof identitySchema>;
export interface NativePreviewFrame {
  width: number;
  height: number;
  capturedAt: number;
  ioSurface?: Buffer;
  ntHandle?: Buffer;
  error?: string;
  release(): void;
}
interface NativePreviewModule {
  protocol: 1;
  start(
    identity: NativeWindowIdentity,
    maximum: number,
    receive: (frame: NativePreviewFrame) => void,
  ): object;
  stop(session: object): Promise<void>;
  resize(session: object, maximum: number): void;
}
const require = createRequire(import.meta.url);

export class NativePreviewSource {
  private stopped = false;
  private stopStream?: () => void;
  private resizeStream?: (maximum: number) => void;
  private identity: NativeWindowIdentity | undefined;
  constructor(
    private readonly driver: ComputerNativeDriver,
    private readonly acquire: () => Promise<ComputerHelperLease>,
  ) {}
  async start(
    target: ComputerTarget,
    maximum: 1280 | 1920,
    receive: (frame: NativePreviewFrame) => void,
  ) {
    const identity = identitySchema.parse(
      await this.driver.previewIdentity(target),
    );
    this.identity = identity;
    if (this.stopped) return;
    if (
      identity.targetId !== target.id ||
      identity.platform !== process.platform ||
      identity.appIdentity !== (target.appId ?? target.bundleId)
    )
      throw new Error("Preview target identity validation failed.");
    const lease = await this.acquire();
    if (this.stopped) {
      lease.release();
      return;
    }
    if (!lease.previewPath) {
      lease.release();
      throw new Error(
        "Update the Computer Use capability pack for live preview.",
      );
    }
    let outstanding = 0,
      stopped = false,
      released = false;
    const releaseLease = () => {
      if (stopped && !outstanding && !released) {
        released = true;
        lease.release();
      }
    };
    try {
      const module = require(lease.previewPath) as NativePreviewModule;
      if (
        module.protocol !== 1 ||
        typeof module.start !== "function" ||
        typeof module.stop !== "function" ||
        typeof module.resize !== "function"
      )
        throw new Error(
          "Update the Computer Use capability pack for live preview.",
        );
      const session = module.start(identity, maximum, (frame) => {
        if (this.stopped) {
          frame.release();
          return;
        }
        outstanding++;
        let releasedFrame = false;
        const release = frame.release;
        frame.release = () => {
          if (releasedFrame) return;
          releasedFrame = true;
          release();
          outstanding--;
          releaseLease();
        };
        receive(frame);
      });
      this.resizeStream = (maximum) => {
        if (!this.stopped) module.resize(session, maximum);
      };
      this.stopStream = () => {
        void module.stop(session).finally(() => {
          stopped = true;
          releaseLease();
        });
      };
    } catch (error) {
      lease.release();
      throw error;
    }
  }
  resize(maximum: 640 | 960 | 1280 | 1920) {
    this.resizeStream?.(maximum);
  }
  async sameWindow(target: ComputerTarget) {
    return (
      JSON.stringify(this.identity) ===
      JSON.stringify(
        identitySchema.parse(await this.driver.previewIdentity(target)),
      )
    );
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.stopStream?.();
  }
}
