import { describe, expect, it } from "vitest";
import {
  createThreadViewState,
  PROTOCOL_VERSION,
  reduceAgentEventBatch,
  reduceAgentEvents,
  type AgentEvent,
  type Thread,
  type ThreadViewState,
} from "@artemis/protocol";
import { renderToStaticMarkup } from "react-dom/server";
import { threadPresentationStatus } from "../../../src/renderer/conversation/thread-presentation.js";
import {
  ThreadStatusIndicator,
  ThreadWaitingBadge,
} from "../../../src/renderer/conversation/ThreadStatusIndicator.js";
const thread = {
  id: "t",
  projectId: "p",
  status: "running",
  notification: { kind: "completed", unread: true },
} as Thread;
const state = () => createThreadViewState("t");
const event = (seq: number, payload: AgentEvent["payload"]): AgentEvent => ({
  protocolVersion: PROTOCOL_VERSION,
  eventId: `event-${seq}`,
  threadId: "t",
  turnId: "turn",
  seq,
  timestamp: `2026-11-01T00:00:0${seq}.000Z`,
  payload,
});
const inputRequested: AgentEvent["payload"] = {
  type: "user-input.requested",
  requestId: "q",
  nonce: "nonce-0000000001",
  header: "Layout",
  question: "Choose the layout",
  options: [{ label: "Compact", description: "", recommended: true }],
  expiresAt: "2026-11-01T01:00:00.000Z",
};
describe("one waiting presentation across header, sidebar and metadata", () => {
  it.each(["input", "approval", "plan"])(
    "keeps pending %s ahead of stale running/completed statuses",
    (kind) => {
      const view: ThreadViewState = state();
      if (kind === "plan") {
        view.status = "idle";
        view.plans = [
          {
            planId: "p",
            revision: 1,
            status: "proposed",
            ready: true,
          } as ThreadViewState["plans"][number],
        ];
      } else if (kind === "input") {
        view.order = ["input:q"];
        view.userInputs.q = {
          status: "pending",
        } as ThreadViewState["userInputs"][string];
      } else {
        view.order = ["approval:a"];
        view.approvals.a = {
          status: "pending",
        } as ThreadViewState["approvals"][string];
      }
      const header = threadPresentationStatus(thread, view, "completed");
      expect(header).toMatch(/^waiting-/);
      const sidebar = renderToStaticMarkup(
        <ThreadStatusIndicator
          thread={thread}
          locale="en"
          historyState={view}
        />,
      );
      expect(sidebar).toContain(`status-dot ${header}`);
      expect(sidebar).not.toContain("artemis-running-arc");
      expect(
        renderToStaticMarkup(
          <ThreadWaitingBadge
            thread={thread}
            locale="en"
            historyState={view}
          />,
        ),
      ).toContain("thread-waiting-badge");
    },
  );
  it("does not hold resolved decisions in a waiting state", () => {
    const view = state();
    view.status = "running";
    view.order = ["input:q"];
    view.userInputs.q = {
      status: "answered",
    } as ThreadViewState["userInputs"][string];
    expect(threadPresentationStatus(thread, view)).toBe("running");
  });

  it.each(
    ["input", "approval", "plan"].flatMap((kind) =>
      (["running", "waiting-approval"] as const).map((status) => ({
        kind,
        status,
      })),
    ),
  )(
    "merges live resolution into historical pending $kind with a $status snapshot without changing history",
    ({ kind, status }) => {
      const currentThread = { ...thread, status };
      const historyEvents = [event(1, { type: "turn.started", mode: "work" })];
      let resolved: AgentEvent["payload"];
      if (kind === "input") {
        historyEvents.push(event(2, inputRequested));
        resolved = {
          type: "user-input.resolved",
          requestId: "q",
          nonce: "nonce-0000000001",
          answer: "Compact",
          source: "user",
        };
      } else if (kind === "approval") {
        historyEvents.push(
          event(2, {
            type: "approval.requested",
            approvalId: "a",
            nonce: "nonce-0000000002",
            summary: "Run tests",
            command: "npm test",
            paths: [],
            network: [],
            risk: "low",
            allowedScopes: ["once"],
          }),
        );
        resolved = {
          type: "approval.resolved",
          approvalId: "a",
          nonce: "nonce-0000000002",
          approved: true,
          scope: "once",
        };
      } else {
        historyEvents.push(
          event(2, {
            type: "plan.proposed",
            planId: "p",
            revision: 1,
            sourceTurnId: "turn",
            title: "Verify layout",
            markdown: "1. Run tests.",
            actionable: true,
          }),
          event(3, { type: "turn.completed", reason: "completed" }),
        );
        resolved = {
          type: "plan.accepted",
          planId: "p",
          revision: 1,
          mode: "work",
          executionTurnId: "execution",
        };
      }
      const history = reduceAgentEvents(thread.id, historyEvents);
      const original = structuredClone(history);
      const liveEvents = [
        event(4, resolved),
        event(5, { type: "turn.started", mode: "work" }),
      ];
      const events = [...historyEvents, ...liveEvents];
      const merged = reduceAgentEventBatch(history, liveEvents);
      expect(threadPresentationStatus(currentThread, history)).toMatch(
        /^waiting-/,
      );
      expect(threadPresentationStatus(currentThread, merged)).toBe("running");
      expect(
        renderToStaticMarkup(
          <ThreadStatusIndicator
            thread={currentThread}
            locale="en"
            historyState={history}
            events={events}
          />,
        ),
      ).toContain("status-dot running");
      expect(
        renderToStaticMarkup(
          <ThreadWaitingBadge
            thread={currentThread}
            locale="en"
            historyState={history}
            events={events}
          />,
        ),
      ).toBe("");
      expect(history).toEqual(original);
    },
  );

  it("shows a new live decision after an idle history page", () => {
    const idleThread = { ...thread, status: "idle" as const };
    const history = reduceAgentEvents(thread.id, [
      event(1, { type: "turn.started", mode: "work" }),
      event(2, { type: "turn.completed", reason: "completed" }),
    ]);
    const original = structuredClone(history);
    const events = [
      event(3, { type: "turn.started", mode: "work" }),
      event(4, inputRequested),
    ];
    expect(
      threadPresentationStatus(
        idleThread,
        reduceAgentEventBatch(history, events),
        "completed",
      ),
    ).toBe("waiting-user-input");
    expect(
      renderToStaticMarkup(
        <ThreadStatusIndicator
          thread={idleThread}
          locale="en"
          historyState={history}
          events={events}
        />,
      ),
    ).toContain("status-dot waiting-user-input");
    expect(
      renderToStaticMarkup(
        <ThreadWaitingBadge
          thread={idleThread}
          locale="en"
          historyState={history}
          events={events}
        />,
      ),
    ).toContain("thread-waiting-badge");
    expect(history).toEqual(original);
  });
});
