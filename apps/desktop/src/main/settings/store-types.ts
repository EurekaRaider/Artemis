import {
  type AgentPayload,
  type ApprovalScope,
  type Automation,
  type AutomationRunState,
  type AutomationRunTrigger,
  type AutomationTarget,
  type RunMode,
  type TaskWorktree,
  type Thread,
  type ThreadGoalStatus,
  type TurnChangeFile,
  type WorkspaceTarget,
  type CustomAgentInvocationStatus,
  type SubmissionState,
} from "@artemis/protocol";
import type { ReviewComment } from "../../shared/api.js";

export interface ProjectRow {
  id: string;
  name: string;
  path: string;
  created_at: string;
  updated_at: string;
}

export interface ThreadRow {
  id: string;
  project_id: string | null;
  title: string;
  goal: string | null;
  mode: RunMode;
  target: WorkspaceTarget;
  status: Thread["status"];
  session_file: string | null;
  model_selection_json: string | null;
  context_window: number | null;
  pinned: number;
  archived: number;
  type_binding_json: string | null;
  execution_profile: string | null;
  created_at: string;
  updated_at: string;
}

export interface ThreadGoalRow {
  thread_id: string;
  goal_id: string;
  objective: string;
  status: ThreadGoalStatus;
  token_budget: number | null;
  tokens_used: number;
  time_used_seconds: number;
  revision: number;
  blocker: string | null;
  blocker_turns: number;
  created_at: string;
  updated_at: string;
}

export interface WorktreeRow {
  id: string;
  thread_id: string;
  project_id: string;
  path: string;
  target: TaskWorktree["target"];
  head: string;
  branch: string | null;
  status: TaskWorktree["status"];
  recovery_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReviewCommentRow {
  id: string;
  thread_id: string;
  scope: ReviewComment["scope"];
  line_id: string;
  path: string;
  kind: ReviewComment["kind"];
  line_text: string;
  old_line: number | null;
  new_line: number | null;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface AutomationRow {
  id: string;
  project_id: string;
  name: string;
  prompt: string;
  mode: RunMode;
  target: AutomationTarget;
  schedule_json: string;
  model_selection_json: string | null;
  enabled: number;
  authorization_state: Automation["authorizationState"];
  authorization_fingerprint: string | null;
  authorized_at: string | null;
  next_run_at: string | null;
  last_run_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AutomationRunRow {
  id: string;
  automation_id: string;
  scheduled_for: string;
  trigger: AutomationRunTrigger;
  state: AutomationRunState;
  thread_id: string | null;
  reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface TurnChangeSetRow {
  thread_id: string;
  turn_id: string;
  status: TurnChangeSetRecord["status"];
  files_json: string;
  additions: number;
  deletions: number;
  undo_available: number;
  message: string | null;
  diff_text: string;
  snapshot_path: string | null;
  workspace_path: string;
  start_head: string;
  start_index: string;
  end_head: string;
  end_index: string;
  created_at: string;
  updated_at: string;
}

export interface TurnChangeSetRecord {
  threadId: string;
  turnId: string;
  status: "ready" | "undone" | "unavailable";
  files: TurnChangeFile[];
  additions: number;
  deletions: number;
  undoAvailable: boolean;
  message?: string;
  diffText: string;
  snapshotPath?: string;
  workspacePath: string;
  startHead: string;
  startIndex: string;
  endHead: string;
  endIndex: string;
  createdAt: string;
  updatedAt: string;
}

export interface EventAppendInput {
  eventId: string;
  turnId?: string;
  payload: AgentPayload;
  // Optional stamp override for callers that must pin an event to a frozen
  // deadline (multi-question expiry clamping); defaults to append time.
  timestamp?: string;
}

export interface ApprovalGrant {
  scope: Exclude<ApprovalScope, "once">;
  subjectId: string;
  operation: string;
  fingerprint: string;
  createdAt: string;
}

export interface ApprovalGrantQuery {
  threadId: string;
  projectId: string;
  operation: string;
  fingerprint: string;
}

export interface CustomAgentRow {
  id: string;
  revision: number;
  name: string;
  normalized_name: string;
  description: string;
  color: string;
  enabled: number;
  instructions: string;
  scope: "all" | "selected";
  model_policy_json: string;
  thinking_policy_json: string;
  tool_policy_json: string;
  allow_automatic_invocation: number;
  triggers_json: string;
  created_at: string;
  updated_at: string;
}

export interface CustomAgentInvocationRow {
  thread_id: string;
  invocation_id: string;
  request_fingerprint: string;
  definition_id: string;
  definition_revision: number;
  definition_name: string;
  turn_id: string | null;
  instance_id: string | null;
  status: CustomAgentInvocationStatus;
  created_at: string;
  updated_at: string;
}

export interface PromptSubmissionRow {
  submission_id: string;
  thread_id: string;
  source: "panel" | "composer";
  candidate_text: string;
  payload_hash: string;
  sequence: number;
  state: SubmissionState;
  turn_id: string | null;
  binding_revision: string;
  last_transition_reason: string;
  created_at: string;
  updated_at: string;
}

export interface PluginOperationRow {
  operation_id: string;
  thread_id: string;
  plugin_id: string;
  tool_name: string;
  request_digest: string;
  state: "prepared" | "running" | "succeeded" | "failed" | "cancelled";
  result_ref: string | null;
  result_json: string | null;
  error: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}
