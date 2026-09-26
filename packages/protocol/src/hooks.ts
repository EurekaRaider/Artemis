export const HOOK_EVENTS = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "PreCompact",
  "PostCompact",
  "SubagentStart",
  "SubagentStop",
  "Stop",
] as const;
export type HookEvent = (typeof HOOK_EVENTS)[number];
export interface HookDefinition {
  projectId?: string;
  workspacePath?: string;
  id: string;
  hash: string;
  event: HookEvent;
  matcher: string;
  command: string;
  commandWindows?: string;
  timeout: number;
  statusMessage?: string;
  source: "user" | "project" | "plugin";
  sourceId: string;
  sourcePath: string;
  description: string;
  scripts: Array<{ path: string; hash: string }>;
  status: "pending" | "trusted" | "disabled" | "invalid";
  error?: string;
  scope: "project" | "all";
  previousCommand?: string;
  previousDefinition?: string;
  previousHash?: string;
}
export interface HookInvocation {
  version: 1;
  hook_event_name: HookEvent;
  session_id: string;
  turn_id?: string;
  cwd: string;
  permission_mode: string;
  transcript_path?: string | null;
  tool_name?: string;
  tool_use_id?: string;
  tool_input?: unknown;
  tool_response?: unknown;
  prompt?: string;
  source?: string;
  trigger?: string;
  reason?: string;
  agent_id?: string;
  agent_type?: string;
  stop_hook_active?: boolean;
  last_assistant_message?: string | null;
}
export interface HookResult {
  blocked?: boolean;
  reason?: string;
  context?: string;
  updatedInput?: Record<string, unknown>;
  permission?: "allow" | "deny";
  stop?: boolean;
  continuation?: string;
  feedback?: string;
}
export interface HookRunRecord {
  version: 1;
  id: string;
  hookId: string;
  event: HookEvent;
  threadId: string;
  turnId?: string;
  startedAt: string;
  durationMs: number;
  status: "running" | "success" | "failed" | "cancelled";
  output: string;
  error?: string;
}
export interface HookQuery {
  projectId?: string;
  threadId?: string;
  pluginId?: string;
}
export interface HookCatalog {
  remote?: boolean;
  hooks: HookDefinition[];
  workspacePath: string;
  projectId: string;
  records: HookRunRecord[];
}
