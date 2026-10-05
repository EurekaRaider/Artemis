import { z } from "zod";

export const browserViewportSchema = z
  .object({
    width: z.number().int().min(320).max(2560),
    height: z.number().int().min(240).max(2560),
    scale: z.number().min(0.1).max(2),
  })
  .strict();
export const browserPreviewCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("snapshot") }).strict(),
  z.object({ action: z.literal("clear") }).strict(),
  z.object({ action: z.literal("screenshot") }).strict(),
  z.object({ action: z.literal("reload") }).strict(),
  z.object({ action: z.literal("devtools") }).strict(),
  z
    .object({
      action: z.literal("viewport"),
      viewport: browserViewportSchema.nullable(),
    })
    .strict(),
  z
    .object({
      action: z.literal("inspect"),
      x: z.number().min(0).max(2560),
      y: z.number().min(0).max(2560),
      navigationId: z.number().int().min(0),
    })
    .strict(),
]);
export const computerBrowserDebugSchema = z
  .object({
    targetId: z.string().min(1).max(200),
    command: browserPreviewCommandSchema,
  })
  .strict();
export type BrowserViewport = z.infer<typeof browserViewportSchema>;
export type BrowserPreviewCommand = z.infer<typeof browserPreviewCommandSchema>;
export interface BrowserDiagnostic {
  id: number;
  time: number;
  source: "console" | "network";
  level: "info" | "warning" | "error";
  text: string;
  url?: string;
  status?: number;
  durationMs?: number;
}
export interface BrowserElementInspection {
  navigationId: number;
  tag: string;
  attributes: Record<string, string>;
  styles: Record<string, string>;
  bounds: { x: number; y: number; width: number; height: number };
  regionOnly: boolean;
}
export interface BrowserPreviewSnapshot {
  version: 1;
  targetId: string;
  url: string;
  navigationId: number;
  paused: boolean;
  viewport: BrowserViewport | null;
  entries: BrowserDiagnostic[];
  inspection?: BrowserElementInspection;
  image?: { data: string; mimeType: "image/jpeg" };
}
