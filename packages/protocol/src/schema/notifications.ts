import { z } from "zod";

export const taskNotificationStateSchema = z.object({
  revision: z.number().int().nonnegative(),
  seq: z.number().int().min(-1),
  unread: z.boolean(),
  kind: z
    .enum([
      "assigned",
      "completed",
      "failed",
      "input-required",
      "approval-required",
    ])
    .optional(),
});

export type TaskNotificationState = z.infer<typeof taskNotificationStateSchema>;
