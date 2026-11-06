import {
  PROTOCOL_VERSION,
  agentEventSchema,
  automationRunSchema,
  automationSchema,
  modelSelectionSchema,
  type AgentEvent,
  type AgentPayload,
  type Automation,
  type AutomationRun,
  type Project,
  type TaskWorktree,
  type Thread,
  type ThreadGoal,
  type TurnChangeFile,
  type CustomAgentDefinition,
  type CustomAgentInvocationRecord,
  type CustomAgentModelPolicy,
  type CustomAgentThinkingPolicy,
  pluginTypeBindingSchema,
  type SubmissionLedgerRecord,
} from "@artemis/protocol";
import type { ReviewComment } from "../../shared/api.js";
import {
  type CustomAgentRow,
  type CustomAgentInvocationRow,
  type ProjectRow,
  type ThreadGoalRow,
  type TurnChangeSetRow,
  type TurnChangeSetRecord,
  type PromptSubmissionRow,
  type ThreadRow,
  type WorktreeRow,
  type ReviewCommentRow,
  type AutomationRow,
  type AutomationRunRow,
} from "./store-types.js";
export function customAgentFromRow(row: CustomAgentRow): CustomAgentDefinition {
  return {
    id: row.id,
    revision: row.revision,
    name: row.name,
    description: row.description,
    color: row.color,
    enabled: row.enabled === 1,
    instructions: row.instructions,
    scope: row.scope,
    modelPolicy: JSON.parse(row.model_policy_json) as CustomAgentModelPolicy,
    thinkingPolicy: JSON.parse(
      row.thinking_policy_json,
    ) as CustomAgentThinkingPolicy,
    toolPolicy: { kind: "inherit" },
    allowAutomaticInvocation: row.allow_automatic_invocation === 1,
    triggers: JSON.parse(row.triggers_json) as string[],
    createdAt: Date.parse(row.created_at),
    updatedAt: Date.parse(row.updated_at),
  };
}

export function customAgentInvocationFromRow(
  row: CustomAgentInvocationRow,
): CustomAgentInvocationRecord {
  return {
    threadId: row.thread_id,
    invocationId: row.invocation_id,
    requestFingerprint: row.request_fingerprint,
    definitionId: row.definition_id,
    definitionRevision: row.definition_revision,
    definitionName: row.definition_name,
    turnId: row.turn_id,
    instanceId: row.instance_id,
    status: row.status,
    createdAt: Date.parse(row.created_at),
    updatedAt: Date.parse(row.updated_at),
  };
}

export function projectFromRow(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function activeGoalSeconds(goal: ThreadGoal, now: string): number {
  return goal.status === "active"
    ? Math.max(0, (Date.parse(now) - Date.parse(goal.updatedAt)) / 1_000)
    : 0;
}

export function threadGoalFromRow(row: ThreadGoalRow): ThreadGoal {
  return {
    threadId: row.thread_id,
    goalId: row.goal_id,
    objective: row.objective,
    status: row.status,
    ...(row.token_budget ? { tokenBudget: row.token_budget } : {}),
    tokensUsed: row.tokens_used,
    timeUsedSeconds: row.time_used_seconds,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function turnChangeSetFromRow(
  row: TurnChangeSetRow,
): TurnChangeSetRecord {
  return {
    threadId: row.thread_id,
    turnId: row.turn_id,
    status: row.status,
    files: JSON.parse(row.files_json) as TurnChangeFile[],
    additions: row.additions,
    deletions: row.deletions,
    undoAvailable: Boolean(row.undo_available),
    ...(row.message ? { message: row.message } : {}),
    diffText: row.diff_text,
    ...(row.snapshot_path ? { snapshotPath: row.snapshot_path } : {}),
    workspacePath: row.workspace_path,
    startHead: row.start_head,
    startIndex: row.start_index,
    endHead: row.end_head,
    endIndex: row.end_index,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function agentEventFromBody(body: string): AgentEvent {
  const persisted = JSON.parse(body) as Record<string, unknown>;
  return agentEventSchema.parse({
    ...persisted,
    protocolVersion: PROTOCOL_VERSION,
  });
}

export function promptSubmissionFromRow(
  row: PromptSubmissionRow,
): SubmissionLedgerRecord {
  return {
    submissionId: row.submission_id,
    threadId: row.thread_id,
    source: row.source,
    candidateText: row.candidate_text,
    payloadHash: row.payload_hash,
    sequence: row.sequence,
    state: row.state,
    turnId: row.turn_id,
    bindingRevision: row.binding_revision,
    lastTransitionReason: row.last_transition_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function threadFromRow(row: ThreadRow, goal?: ThreadGoal): Thread {
  return {
    id: row.id,
    ...(row.project_id ? { projectId: row.project_id } : {}),
    title: row.title,
    ...(goal ? { goal } : {}),
    mode: row.mode,
    target: row.target,
    status: row.status,
    ...(row.session_file ? { sessionFile: row.session_file } : {}),
    ...(row.model_selection_json
      ? {
          modelSelection: modelSelectionSchema.parse(
            JSON.parse(row.model_selection_json),
          ),
        }
      : {}),
    ...(row.context_window ? { contextWindow: row.context_window } : {}),
    pinned: row.pinned === 1,
    archived: row.archived === 1,
    ...(row.type_binding_json
      ? {
          typeBinding: pluginTypeBindingSchema.parse(
            JSON.parse(row.type_binding_json),
          ),
        }
      : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function worktreeFromRow(row: WorktreeRow): TaskWorktree {
  return {
    id: row.id,
    threadId: row.thread_id,
    projectId: row.project_id,
    path: row.path,
    target: row.target,
    head: row.head,
    ...(row.branch ? { branch: row.branch } : {}),
    status: row.status,
    ...(row.recovery_path ? { recoveryPath: row.recovery_path } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function reviewCommentFromRow(row: ReviewCommentRow): ReviewComment {
  return {
    id: row.id,
    threadId: row.thread_id,
    scope: row.scope,
    lineId: row.line_id,
    path: row.path,
    kind: row.kind,
    text: row.line_text,
    ...(row.old_line === null ? {} : { oldLine: row.old_line }),
    ...(row.new_line === null ? {} : { newLine: row.new_line }),
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function automationFromRow(row: AutomationRow): Automation {
  return automationSchema.parse({
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    prompt: row.prompt,
    mode: row.mode,
    target: row.target,
    schedule: JSON.parse(row.schedule_json),
    ...(row.model_selection_json
      ? { modelSelection: JSON.parse(row.model_selection_json) }
      : {}),
    enabled: row.enabled === 1,
    authorizationState: row.authorization_state,
    ...(row.authorization_fingerprint
      ? { authorizationFingerprint: row.authorization_fingerprint }
      : {}),
    ...(row.authorized_at ? { authorizedAt: row.authorized_at } : {}),
    ...(row.next_run_at ? { nextRunAt: row.next_run_at } : {}),
    ...(row.last_run_at ? { lastRunAt: row.last_run_at } : {}),
    ...(row.deleted_at ? { deletedAt: row.deleted_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export function automationRunFromRow(row: AutomationRunRow): AutomationRun {
  return automationRunSchema.parse({
    id: row.id,
    automationId: row.automation_id,
    scheduledFor: row.scheduled_for,
    trigger: row.trigger,
    state: row.state,
    ...(row.thread_id ? { threadId: row.thread_id } : {}),
    ...(row.reason ? { reason: row.reason } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export function persistentAgentPayload(payload: AgentPayload): AgentPayload {
  if (
    payload.type === "message.part.delta" &&
    payload.partType === "thinking" &&
    payload.delta
  ) {
    return { ...payload, delta: "" };
  }
  if (payload.type === "child-agent.status" && payload.activityDelta) {
    return { ...payload, activityDelta: undefined };
  }
  return payload;
}
