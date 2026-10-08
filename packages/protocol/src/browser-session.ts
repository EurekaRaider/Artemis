import { z } from "zod";
const id = z.string().min(1).max(500);
const point = {
  x: z.number().finite().min(0).max(8192),
  y: z.number().finite().min(0).max(8192),
};
const modifiers = z
  .array(z.enum(["shift", "control", "alt", "meta"]))
  .max(4)
  .optional();
export const browserHumanInputSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.enum(["mouseDown", "mouseUp", "mouseMove"]),
      ...point,
      button: z.enum(["left", "right", "middle"]),
      clickCount: z.number().int().min(0).max(3),
      buttons: z.number().int().min(0).max(7).optional(),
      modifiers,
    })
    .strict(),
  z
    .object({
      type: z.literal("mouseWheel"),
      ...point,
      deltaX: z.number().finite().min(-10000).max(10000),
      deltaY: z.number().finite().min(-10000).max(10000),
      modifiers,
    })
    .strict(),
  z
    .object({
      type: z.enum(["keyDown", "keyUp", "char"]),
      keyCode: z.string().min(1).max(100),
      modifiers,
    })
    .strict(),
  z.object({ type: z.literal("text"), text: z.string().max(16000) }).strict(),
  z
    .object({
      type: z.literal("composition"),
      text: z.string().max(16000),
      selectionStart: z.number().int().min(0).max(16000),
      selectionEnd: z.number().int().min(0).max(16000),
    })
    .strict(),
]);
export type BrowserHumanInput = z.infer<typeof browserHumanInputSchema>;
export const browserSessionCommandSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("open"),
      threadId: id,
      tabId: id,
      url: z.string().max(4096).optional(),
      path: z.string().max(4096).optional(),
      revision: id.optional(),
    })
    .strict(),
  z.object({ action: z.literal("snapshot"), threadId: id, tabId: id }).strict(),
  z
    .object({
      action: z.literal("navigate"),
      threadId: id,
      tabId: id,
      url: z.string().max(4096),
    })
    .strict(),
  z
    .object({
      action: z.enum(["back", "forward", "reload", "close"]),
      threadId: id,
      tabId: id,
    })
    .strict(),
  z
    .object({
      action: z.literal("subscribe"),
      threadId: id,
      tabId: id,
      token: z.string().uuid(),
      width: z.number().int().min(1).max(2560),
      height: z.number().int().min(1).max(2560),
    })
    .strict(),
  z
    .object({
      action: z.literal("unsubscribe"),
      threadId: id,
      tabId: id,
      token: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      action: z.literal("input"),
      threadId: id,
      tabId: id,
      token: z.string().uuid(),
      input: browserHumanInputSchema,
    })
    .strict(),
]);
export type BrowserSessionCommand = z.infer<typeof browserSessionCommandSchema>;
export interface BrowserSessionSnapshot {
  threadId: string;
  tabId: string;
  sessionId: string;
  contentsId: number;
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
  width: number;
  height: number;
  error?: string;
}
