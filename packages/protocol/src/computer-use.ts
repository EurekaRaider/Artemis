import { z } from "zod";

export const COMPUTER_USE_VERSION = 1 as const;
export const COMPUTER_USE_META = "artemis/computer-use";
export const computerOpenSchema = z
  .object({
    target: z
      .string()
      .min(1)
      .max(500)
      .describe(
        "browser, an existing target id, or a macOS application bundle id",
      ),
    url: z.url().max(4096).optional(),
  })
  .strict();
const elementId = z.string().min(1).max(200);
const point = { x: z.number().finite().min(0), y: z.number().finite().min(0) };
export const computerActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("click"), elementId }).strict(),
  z
    .object({ type: z.literal("fill"), elementId, text: z.string().max(16000) })
    .strict(),
  z
    .object({
      type: z.literal("key"),
      key: z.enum([
        "Enter",
        "Tab",
        "Escape",
        "Backspace",
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "Space",
      ]),
      modifiers: z
        .array(z.enum(["Meta", "Control", "Alt", "Shift"]))
        .max(4)
        .optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("scroll"),
      direction: z.enum(["up", "down", "left", "right"]),
      amount: z.number().int().min(1).max(1000),
    })
    .strict(),
  z.object({ type: z.literal("click_at"), ...point }).strict(),
]);
export const computerTargetSchema = z.object({ targetId: elementId }).strict();
export const computerActSchema = z
  .object({
    targetId: elementId,
    observationId: elementId,
    actions: z.array(computerActionSchema).min(1).max(8),
  })
  .strict();
export type ComputerAction = z.infer<typeof computerActionSchema>;
export type ComputerOpen = z.infer<typeof computerOpenSchema>;
export type ComputerAct = z.infer<typeof computerActSchema>;
export interface ComputerTarget {
  id: string;
  kind: "browser" | "desktop";
  name: string;
  url?: string;
  bundleId?: string;
}
export interface ComputerElement {
  id: string;
  role: string;
  label: string;
  value?: string;
  valueDigest?: string;
  bounds?: { x: number; y: number; width: number; height: number };
}
export interface ComputerFrame {
  /** Changes on navigation, window geometry, or element structure changes. */
  revision: string;
  /** Screenshot fingerprint used to reject stale coordinate input. */
  visualRevision?: string;
  width: number;
  height: number;
  elements: ComputerElement[];
  image?: { data: string; mimeType: "image/jpeg" };
  imageUnchanged?: boolean;
  foreground?: boolean;
}
export interface ComputerObservation extends ComputerFrame {
  version: typeof COMPUTER_USE_VERSION;
  target: ComputerTarget;
  observationId: string;
}
export interface ComputerControlState {
  version: typeof COMPUTER_USE_VERSION;
  state: "idle" | "observing" | "acting" | "paused";
  threadId?: string;
  target?: ComputerTarget;
  foreground?: boolean;
  reason?: string;
}
