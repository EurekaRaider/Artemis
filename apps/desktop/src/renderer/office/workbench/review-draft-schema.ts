import { z } from "zod";
import { artifactSelectionSchema } from "@artemis/protocol";

export const reviewDraftSchema = z.object({
  protocolVersion: z.literal(1),
  open: z.boolean(),
  note: z.string().max(8192),
  selection: z
    .object({
      value: artifactSelectionSchema,
      version: z.number().int().nonnegative(),
      quote: z.string().max(8192).optional(),
    })
    .optional(),
});
