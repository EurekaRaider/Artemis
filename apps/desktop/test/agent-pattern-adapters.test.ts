import { describe, expect, it } from "vitest";
import type { ApprovalState, ToolState } from "@artemis/protocol";

import {
  approvalPatternView,
  taskPlanPatternView,
  toolActivityPatternView,
} from "../src/renderer/agent-pattern-adapters.js";

describe("Desktop agent pattern adapters", () => {
  it("preserves task-plan order, visible current state, and localized labels", () => {
    const view = taskPlanPatternView(
      {
        currentIndex: 1,
        steps: [
          { step: "Inspect", status: "completed" },
          { step: "Implement", status: "pending" },
          { step: "Verify", status: "pending" },
        ],
      },
      "en",
    );
    expect(view.progressLabel).toBe("Step 2 of 3");
    expect(view.steps.map((step) => step.label)).toEqual([
      "Inspect",
      "Implement",
      "Verify",
    ]);
    expect(view.steps.map((step) => step.status)).toEqual([
      "completed",
      "in_progress",
      "pending",
    ]);
    expect(view.currentStepId).toBe(view.steps[1]?.id);
    expect(view.state).toBe("active");
  });

  it("preserves approval content and the existing deny/project/session/once order", () => {
    const approval: ApprovalState = {
      type: "approval.requested",
      approvalId: "approval-1",
      nonce: "0123456789abcdef",
      summary: "Run tests",
      command: "npm test",
      paths: [],
      network: [],
      risk: "medium",
      allowedScopes: ["once", "session", "project"],
      modelRecommendation: "approve",
      modelReason: "The requested test matches the current task.",
      status: "pending",
      requestedAt: "2026-09-02T00:00:00.000Z",
    };
    const view = approvalPatternView(approval, "Reviewer");
    expect(view).toEqual(
      expect.objectContaining({
        actorLabel: "Reviewer",
        detail: "npm test",
        reason: approval.modelReason,
        state: "pending",
        title: "Run tests",
      }),
    );
    expect(view.actions.map((action) => action.id)).toEqual([
      "deny",
      "approve-project",
      "approve-session",
      "approve-once",
    ]);
    expect(view.actions.map((action) => action.scope)).toEqual([
      "once",
      "project",
      "session",
      "once",
    ]);
    expect(view.actions.at(-1)?.recommended).toBe(true);
  });

  it("maps tool presentation without exposing raw tool payloads to UI patterns", () => {
    const tools: ToolState[] = [
      {
        id: "tool-1",
        name: "read",
        input: { path: "src/App.tsx" },
        output: "source",
        status: "completed",
      },
    ];
    expect(toolActivityPatternView(tools, true, "en")).toEqual({
      actualStatus: "completed",
      fileActivity: true,
      kind: "read",
      state: "running",
      statusLabel: "Completed",
      summary: "Read files",
    });
    expect(toolActivityPatternView(tools, false, "en").state).toBe("completed");
  });

  it("retains the Bash transcript in the Desktop-only adapter", () => {
    const tools: ToolState[] = [
      {
        id: "tool-1",
        name: "bash",
        input: { command: "npm test" },
        output: "PASS\n",
        status: "completed",
      },
    ];
    const view = toolActivityPatternView(tools, false, "en");
    expect(view.kind).toBe("bash");
    expect(view.bashTranscript).toBe("$ npm test\nPASS");
  });
});
