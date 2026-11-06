import {
  agentEventFromBody,
  persistentAgentPayload,
} from "../store-row-codecs.js";

import { type ThreadRow, type EventAppendInput } from "../store-types.js";
import { randomUUID } from "node:crypto";

import {
  PROTOCOL_VERSION,
  collectPlans,
  assertAcceptablePlan,
  acceptedPlanPrompt,
  proposedPlanSchema,
  runModeSchema,
  type PlanAcceptance,
  type ProposedPlan,
  agentEventSchema,
  isLegacyInternalAgentMessage,
  reduceAgentEvents,
  type AgentEvent,
  type AgentPayload,
  type MultiQuestionUserInputState,
  type Thread,
} from "@artemis/protocol";

import type { TurnCheckpoint } from "../../conversation/turn-recovery.js";

import type { StoreDependencies } from "./store-dependencies.js";
export function createConversationRepository(
  services: Pick<
    StoreDependencies,
    | "getThreadEvents"
    | "getThread"
    | "plans"
    | "appendEvent"
    | "appendEventsCore"
    | "database"
    | "updateThread"
    | "saveTurnCheckpoint"
    | "clearTurnCheckpoint"
    | "updateAutomationRunForThread"
    | "completeAutomationRunForThreadCore"
    | "getTurnCheckpoint"
  >,
) {
  function plans(threadId: string) {
    return collectPlans(services.getThreadEvents(threadId));
  }

  function proposePlan(
    threadId: string,
    turnId: string,
    content: Pick<ProposedPlan, "title" | "markdown" | "actionable">,
  ): ProposedPlan {
    const thread = services.getThread(threadId);
    if (thread?.mode !== "plan" || thread.status !== "running")
      throw new Error("PLAN_MODE_REQUIRED");
    const previous = services.plans(threadId).at(-1);
    if (previous?.sourceTurnId === turnId)
      throw new Error("A final plan has already been submitted for this turn.");
    const plan = proposedPlanSchema.parse({
      ...content,
      planId: randomUUID(),
      revision: (previous?.revision ?? 0) + 1,
      sourceTurnId: turnId,
    });
    services.appendEvent(randomUUID(), threadId, turnId, {
      type: "plan.proposed",
      ...plan,
    });
    return plan;
  }

  function appendEvent(
    eventId: string,
    threadId: string,
    turnId: string | undefined,
    payload: AgentPayload,
    timestamp?: string,
  ): AgentEvent {
    return services.appendEventsCore(threadId, [
      {
        eventId,
        ...(turnId ? { turnId } : {}),
        payload,
        ...(timestamp ? { timestamp } : {}),
      },
    ])[0]!;
  }

  function appendEvents(
    threadId: string,
    inputs: readonly EventAppendInput[],
  ): AgentEvent[] {
    if (inputs.length === 0) return [];
    services.database.exec("BEGIN IMMEDIATE");
    try {
      const events = services.appendEventsCore(threadId, inputs);
      services.database.exec("COMMIT");
      return events;
    } catch (error) {
      services.database.exec("ROLLBACK");
      throw error;
    }
  }

  function appendEventsAndUpdateThread(
    threadId: string,
    inputs: readonly EventAppendInput[],
    changes: Partial<
      Pick<Thread, "title" | "mode" | "target" | "status" | "sessionFile">
    >,
    checkpoint?: TurnCheckpoint,
    acceptance?: PlanAcceptance,
  ): { events: AgentEvent[]; thread: Thread } {
    services.database.exec("BEGIN IMMEDIATE");
    try {
      const latest = services.plans(threadId).at(-1);
      const prefixes: EventAppendInput[] = [];
      if (acceptance) {
        const acceptedPlan = assertAcceptablePlan(
          services.plans(threadId),
          acceptance,
        );
        const current = services.getThread(threadId);
        if (
          !checkpoint ||
          checkpoint.source !== "user" ||
          checkpoint.mode !== acceptance.mode ||
          checkpoint.text !== acceptedPlanPrompt(acceptedPlan) ||
          changes.mode !== acceptance.mode ||
          current?.status === "running" ||
          current?.status === "waiting-approval"
        )
          throw new Error("PLAN_ACCEPT_REQUIRES_IDLE_USER_TURN");
        prefixes.push({
          eventId: randomUUID(),
          turnId: checkpoint.turnId,
          payload: {
            ...acceptance,
            type: "plan.accepted",
            executionTurnId: checkpoint.turnId,
          },
        });
      } else if (checkpoint && latest?.status === "proposed") {
        if (checkpoint.source !== "user" || checkpoint.mode !== "plan")
          throw new Error("PLAN_REQUIRES_USER_CHOICE");
        prefixes.push({
          eventId: randomUUID(),
          turnId: checkpoint.turnId,
          payload: {
            type: "plan.superseded",
            planId: latest.planId,
            revision: latest.revision,
          },
        });
      }
      const events = services.appendEventsCore(threadId, [
        ...prefixes,
        ...inputs,
      ]);
      const thread = services.updateThread(threadId, changes);
      if (checkpoint) {
        if (checkpoint.threadId !== threadId)
          throw new Error("Turn checkpoint belongs to another task.");
        services.saveTurnCheckpoint(checkpoint);
      }
      services.database.exec("COMMIT");
      return { events, thread };
    } catch (error) {
      services.database.exec("ROLLBACK");
      throw error;
    }
  }

  function appendEventsCore(
    threadId: string,
    inputs: readonly EventAppendInput[],
  ): AgentEvent[] {
    if (inputs.length === 0) return [];
    const seqRow = services.database
      .prepare(
        "SELECT COALESCE(MAX(seq), -1) + 1 AS next_seq FROM events WHERE thread_id = ?",
      )
      .get(threadId) as { next_seq: number };
    const insert = services.database.prepare(
      "INSERT INTO events (event_id, thread_id, seq, body, created_at) VALUES (?, ?, ?, ?, ?)",
    );
    const stampedAt = new Date().toISOString();
    return inputs.map((input, index) => {
      const event = agentEventSchema.parse({
        protocolVersion: PROTOCOL_VERSION,
        eventId: input.eventId,
        threadId,
        ...(input.turnId ? { turnId: input.turnId } : {}),
        seq: seqRow.next_seq + index,
        timestamp: input.timestamp ?? stampedAt,
        payload: persistentAgentPayload(input.payload),
      });
      insert.run(
        event.eventId,
        event.threadId,
        event.seq,
        JSON.stringify(event),
        event.timestamp,
      );
      if (
        event.payload.type === "turn.completed" ||
        event.payload.type === "turn.failed"
      ) {
        services.clearTurnCheckpoint(threadId, event.turnId);
      }
      return event;
    });
  }

  function getThreadEvents(threadId: string): AgentEvent[] {
    return (
      services.database
        .prepare("SELECT body FROM events WHERE thread_id = ? ORDER BY seq ASC")
        .all(threadId) as unknown as Array<{ body: string }>
    ).map((row) => agentEventFromBody(row.body));
  }

  function getTurnCheckpoint(threadId: string): TurnCheckpoint | undefined {
    const row = services.database
      .prepare("SELECT body FROM turn_checkpoints WHERE thread_id = ?")
      .get(threadId) as { body: string } | undefined;
    if (!row) return undefined;
    const record = JSON.parse(row.body) as {
      version: number;
      checkpoint: TurnCheckpoint;
    };
    if (record.version !== 1)
      throw new Error("Unsupported turn checkpoint version.");
    return {
      ...record.checkpoint,
      mode: runModeSchema.parse(record.checkpoint.mode),
    };
  }

  function saveTurnCheckpoint(checkpoint: TurnCheckpoint): void {
    services.database
      .prepare(
        "INSERT OR REPLACE INTO turn_checkpoints (thread_id, turn_id, body) VALUES (?, ?, ?)",
      )
      .run(
        checkpoint.threadId,
        checkpoint.turnId,
        JSON.stringify({
          version: 1,
          checkpoint: {
            ...checkpoint,
            // Definitions stay in memory. Recovery must not reload private
            // instructions or silently route against a different revision.
            ...(checkpoint.customAgents === undefined
              ? {}
              : { customAgents: [] }),
          },
        }),
      );
  }

  function clearTurnCheckpoint(
    threadId: string,
    turnId: string | undefined,
  ): void {
    services.database
      .prepare(
        "DELETE FROM turn_checkpoints WHERE thread_id = ? AND turn_id = ?",
      )
      .run(threadId, turnId ?? "");
  }

  function getTokenUsageEvents(): AgentEvent[] {
    return (
      services.database
        .prepare(
          `SELECT body
           FROM events
           WHERE json_extract(body, '$.payload.type') = 'assistant.usage'
           ORDER BY created_at ASC, event_id ASC`,
        )
        .all() as unknown as Array<{ body: string }>
    ).map((row) => agentEventFromBody(row.body));
  }

  function listPromptHistory(limit = 100): string[] {
    const boundedLimit = Math.max(0, Math.min(Math.trunc(limit), 500));
    if (boundedLimit === 0) return [];
    const rows = services.database
      .prepare(
        `SELECT body FROM events
         WHERE body LIKE ?
           AND json_extract(body, '$.payload.text') NOT LIKE ?
           AND json_extract(body, '$.payload.text') NOT LIKE ?
           AND json_extract(body, '$.payload.text') NOT LIKE ?
           AND json_extract(body, '$.payload.text') NOT LIKE ?
           AND json_extract(body, '$.payload.text') NOT LIKE ?
           AND json_extract(body, '$.payload.text') NOT LIKE ?
           AND json_extract(body, '$.payload.text') NOT LIKE ?
           AND json_extract(body, '$.payload.text') != ?
         ORDER BY created_at DESC, rowid DESC
         LIMIT ?`,
      )
      .all(
        '%"type":"user.message"%',
        "[agent-team finding] %: %",
        "[agent-team request] %: %",
        "[agent-team blocker] %: %",
        "[agent-team handoff] %: %",
        "The user nudged sub-agent % (%). Check its status and adjust the approach if needed.",
        "Sub-agent % (%) was stopped by the user. Do not keep waiting for it; continue with another approach.",
        "The user retried sub-agent % as %. Monitor the new attempt instead of the old one.",
        "The user stopped the agent team. Continue the current task without waiting for its members.",
        boundedLimit * 4,
      ) as unknown as Array<{ body: string }>;
    const history: string[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const event = agentEventFromBody(row.body);
      if (event.payload.type !== "user.message") continue;
      const text = event.payload.text.trim();
      if (!text || isLegacyInternalAgentMessage(text) || seen.has(text)) {
        continue;
      }
      seen.add(text);
      history.push(text);
      if (history.length === boundedLimit) break;
    }
    return history;
  }

  function recoverInterruptedThreads(): AgentEvent[] {
    const interrupted = services.database
      .prepare(
        "SELECT * FROM threads WHERE status IN ('running', 'waiting-approval')",
      )
      .all() as unknown as ThreadRow[];
    if (interrupted.length === 0) {
      return [];
    }

    const recovered: AgentEvent[] = [];
    services.database.exec("BEGIN IMMEDIATE");
    try {
      for (const row of interrupted) {
        const eventRows = services.database
          .prepare(
            "SELECT body FROM events WHERE thread_id = ? ORDER BY seq ASC",
          )
          .all(row.id) as unknown as Array<{ body: string }>;
        const events = eventRows.map((eventRow) =>
          agentEventFromBody(eventRow.body),
        );
        const turnId =
          events.findLast((event) => event.payload.type === "turn.started")
            ?.turnId ?? events.findLast((event) => event.turnId)?.turnId;
        const terminal = events.findLast(
          (event) =>
            event.turnId === turnId &&
            (event.payload.type === "turn.completed" ||
              event.payload.type === "turn.failed"),
        );
        if (terminal) {
          services.clearTurnCheckpoint(row.id, turnId);
          services.updateThread(row.id, {
            status: terminal.payload.type === "turn.failed" ? "failed" : "idle",
          });
          if (terminal.payload.type === "turn.failed") {
            services.updateAutomationRunForThread(
              row.id,
              "failed",
              terminal.payload.message,
            );
          } else {
            services.completeAutomationRunForThreadCore(row.id);
          }
          continue;
        }
        const unresolvedApprovals = new Map<
          string,
          { nonce: string; turnId?: string }
        >();
        const unresolvedUserInputs = new Map<
          string,
          { nonce: string; turnId?: string }
        >();
        const multiRequestIds = new Set<string>();
        // No linear settledness fast path on purpose (review round 3, P1):
        // counting nonce-matching requestId+questionId pairs is strictly
        // weaker than the reducer's discard rules, which also reject
        // premature timeouts (resolvedAtMs < expiresAt), user answers
        // stamped after expiry, non-finite timestamps, and
        // selectedOptionLabels the question never offered. Settling on the
        // weaker check would skip the recovery cancel for questions the
        // reducer keeps pending and strand them as pending forever in the
        // persisted view, so the replay below is the sole arbiter.
        for (const event of events) {
          if (event.payload.type === "approval.requested") {
            unresolvedApprovals.set(event.payload.approvalId, {
              nonce: event.payload.nonce,
              ...(event.turnId ? { turnId: event.turnId } : {}),
            });
          } else if (event.payload.type === "approval.resolved") {
            unresolvedApprovals.delete(event.payload.approvalId);
          } else if (event.payload.type === "user-input.requested") {
            unresolvedUserInputs.set(event.payload.requestId, {
              nonce: event.payload.nonce,
              ...(event.turnId ? { turnId: event.turnId } : {}),
            });
            if (event.payload.kind === "multi-question") {
              multiRequestIds.add(event.payload.requestId);
            }
          } else if (
            event.payload.type === "user-input.resolved" &&
            event.payload.kind === undefined &&
            !multiRequestIds.has(event.payload.requestId)
          ) {
            // Kind-less resolutions do not decide multi-question closure
            // on their own (review R2 P1-2): the reducer translates them
            // per source — a timeout closes only the questions whose
            // deadline has passed — so the replayed final state below
            // decides whether the request is still unresolved.
            unresolvedUserInputs.delete(event.payload.requestId);
          }
        }
        if (multiRequestIds.size > 0) {
          // Multi-question closure is derived solely from replay (review
          // R2 P1-2): replay through the same reducer the renderer uses
          // and let the final per-question state decide — every question
          // terminal means the card is resolved; any question still
          // pending (for example after a kind-less timeout that only
          // closed the questions whose deadline had passed, or after a
          // kind'd resolution the reducer discarded on its time or option
          // gates) keeps the request unresolved so the recovery cancel
          // below closes it. This replay is the sole settledness arbiter
          // (review round 3, P1): it runs for every thread that still has
          // a multi request under the linear scan above.
          const viewState = reduceAgentEvents(row.id, events, row.mode);
          for (const requestId of multiRequestIds) {
            // The kind check remains the runtime guard; the cast only gives
            // the per-question answers their protocol type.
            const input = viewState.userInputs[requestId] as
              MultiQuestionUserInputState | undefined;
            const everyQuestionTerminal =
              input?.kind === "multi-question" &&
              Object.values(input.answers).every(
                (answer) => answer.status !== "pending",
              );
            if (!everyQuestionTerminal) {
              continue;
            }
            unresolvedUserInputs.delete(requestId);
          }
        }
        for (const [requestId, input] of unresolvedUserInputs) {
          recovered.push(
            services.appendEvent(randomUUID(), row.id, input.turnId, {
              type: "user-input.resolved",
              requestId,
              nonce: input.nonce,
              answer: "",
              source: "cancelled",
            }),
          );
        }
        for (const [approvalId, approval] of unresolvedApprovals) {
          recovered.push(
            services.appendEvent(randomUUID(), row.id, approval.turnId, {
              type: "approval.resolved",
              approvalId,
              nonce: approval.nonce,
              approved: false,
              scope: "once",
            }),
          );
        }
        const checkpoint = services.getTurnCheckpoint(row.id);
        if (checkpoint && checkpoint.turnId === turnId && !row.archived) {
          recovered.push(
            services.appendEvent(randomUUID(), row.id, turnId, {
              type: "turn.activity",
              phase: "reconnecting",
              kind: "process-restart",
              attempt: 1,
              delayMs: 0,
            }),
          );
          services.updateThread(row.id, { status: "running" });
          services.updateAutomationRunForThread(row.id, "running");
          continue;
        }
        recovered.push(
          services.appendEvent(randomUUID(), row.id, turnId, {
            type: "turn.failed",
            message:
              "The previous Artemis process stopped before this turn completed.",
            code: "HOST_RESTART",
          }),
        );
        services.updateThread(row.id, { status: "failed" });
        services.updateAutomationRunForThread(
          row.id,
          "failed",
          "The previous Artemis process stopped before this scheduled task completed.",
        );
      }
      services.database.exec("COMMIT");
    } catch (error) {
      services.database.exec("ROLLBACK");
      throw error;
    }
    return recovered;
  }
  const handlers = {
    plans,
    proposePlan,
    appendEvent,
    appendEvents,
    appendEventsAndUpdateThread,
    appendEventsCore,
    getThreadEvents,
    getTurnCheckpoint,
    saveTurnCheckpoint,
    clearTurnCheckpoint,
    getTokenUsageEvents,
    listPromptHistory,
    recoverInterruptedThreads,
  };
  return handlers;
}
