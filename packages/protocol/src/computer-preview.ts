import { z } from "zod";
import type { ComputerTarget } from "./computer-use.js";

export const COMPUTER_PREVIEW_VERSION = 1 as const;
export interface ComputerPreviewState {
  version: typeof COMPUTER_PREVIEW_VERSION;
  sessionId: string;
  threadId: string;
  target: ComputerTarget;
  state: "starting" | "live" | "paused" | "hidden" | "unavailable" | "ended";
  timestamp: number;
  sequence: number;
  actualFps: number;
  p95LatencyMs?: number;
  reason?: string;
  tabId?: string;
}
// GPU handles and frames deliberately have no protocol representation.
export const computerPreviewCommandSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("subscribe"),
      sessionId: z.string().uuid(),
      token: z.string().uuid(),
      expanded: z.boolean().optional(),
    })
    .strict(),
  z
    .object({ action: z.literal("unsubscribe"), token: z.string().uuid() })
    .strict(),
  z
    .object({
      action: z.enum(["hide", "show", "expand"]),
      sessionId: z.string().uuid(),
    })
    .strict(),
]);
export type ComputerPreviewCommand = z.infer<
  typeof computerPreviewCommandSchema
>;
