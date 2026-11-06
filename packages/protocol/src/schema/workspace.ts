import { z } from "zod";
import { pluginTypeBindingSchema } from "../design-plugin.js";
import { taskNotificationStateSchema } from "./notifications.js";
import { threadGoalSchema } from "./goals.js";
import { runModeSchema } from "./core.js";
import { modelSelectionSchema } from "./models.js";
import { type AgentEvent } from "./events.js";
import { type AppLocale } from "./appearance.js";

export const workspaceTargetSchema = z.enum([
  "local",
  "managed-worktree",
  "permanent-worktree",
]);

export type WorkspaceTarget = z.infer<typeof workspaceTargetSchema>;

export const projectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  path: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export type Project = z.infer<typeof projectSchema>;

export const threadSchema = z.object({
  notification: taskNotificationStateSchema.optional(),
  id: z.string().min(1),
  projectId: z.string().min(1).optional(),
  title: z.string().min(1),
  goal: threadGoalSchema.optional(),
  mode: runModeSchema,
  target: workspaceTargetSchema,
  status: z.enum(["idle", "running", "waiting-approval", "failed"]),
  sessionFile: z.string().optional(),
  modelSelection: modelSelectionSchema.optional(),
  contextWindow: z.number().int().positive().optional(),
  pinned: z.boolean(),
  archived: z.boolean(),
  /** S1 design plugins: type snapshot frozen at thread creation (§6.1). */
  typeBinding: pluginTypeBindingSchema.optional(),
  /** @deprecated Accepted for old clients; Design uses ordinary mode/tool policy. */
  executionProfile: z.string().optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export type Thread = z.infer<typeof threadSchema>;

export const taskWorktreeSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  projectId: z.string().min(1),
  path: z.string().min(1),
  target: z.enum(["managed-worktree", "permanent-worktree"]),
  head: z.string().min(1),
  branch: z.string().min(1).optional(),
  status: z.enum(["active", "removed", "missing"]),
  recoveryPath: z.string().min(1).optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export type TaskWorktree = z.infer<typeof taskWorktreeSchema>;

export interface AppSnapshot {
  projects: Project[];
  threads: Thread[];
  worktrees: TaskWorktree[];
  events: Record<string, AgentEvent[]>;
  locale: AppLocale;
  platform: "win32" | "darwin" | "other";
  sandbox: {
    available: boolean;
    implementation: string;
  };
}
