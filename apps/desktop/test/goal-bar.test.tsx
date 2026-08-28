import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ThreadGoal } from "@artemis/protocol";

import {
  displayGoalObjective,
  formatGoalProgress,
  GoalBar,
} from "../src/renderer/GoalBar.js";

const goal = (changes: Partial<ThreadGoal> = {}): ThreadGoal => ({
  threadId: "thread-1",
  goalId: "goal-1",
  objective: "Ship the Goal UI",
  status: "active",
  tokenBudget: 10_000,
  tokensUsed: 2_500,
  timeUsedSeconds: 3_600,
  revision: 1,
  createdAt: "2026-08-28T00:00:00.000Z",
  updatedAt: "2026-08-28T00:00:00.000Z",
  ...changes,
});

describe("Codex-style Goal rail", () => {
  it("shows budget progress for active and budget-limited Goals", () => {
    expect(formatGoalProgress(goal(), "en", Date.parse(goal().updatedAt))).toBe(
      "2.5K / 10K",
    );
    expect(
      formatGoalProgress(
        goal({ status: "budgetLimited" }),
        "en",
        Date.parse(goal().updatedAt),
      ),
    ).toBe("2.5K / 10K");
  });

  it("keeps elapsed time live only while the Goal is active", () => {
    const clock = Date.parse(goal().updatedAt) + 4_000;
    expect(
      formatGoalProgress(goal({ tokenBudget: undefined }), "en", clock),
    ).toBe("1h 0m 4s");
    expect(
      formatGoalProgress(
        goal({ status: "paused", tokenBudget: undefined }),
        "en",
        clock,
      ),
    ).toBe("1h 0m 0s");
  });

  it("renders the Codex status and icon-only controls in the same order", () => {
    const markup = renderToStaticMarkup(
      <GoalBar
        clockMs={Date.parse(goal().updatedAt)}
        goal={goal()}
        locale="en"
        onClear={vi.fn()}
        onEdit={vi.fn()}
        onPause={vi.fn()}
        onResume={vi.fn()}
      />,
    );
    expect(markup).toContain("Pursuing goal");
    expect(markup).toContain("Ship the Goal UI");
    expect(markup.indexOf('aria-label="Clear goal"')).toBeLessThan(
      markup.indexOf('aria-label="Pause goal"'),
    );
    expect(markup.indexOf('aria-label="Pause goal"')).toBeLessThan(
      markup.lastIndexOf('aria-label="Edit goal"'),
    );
  });

  it("shows the inline preview for a managed long objective", () => {
    expect(
      displayGoalObjective(
        "Follow the objective in the Artemis-managed file at /tmp/goal.md\n\nObjective preview:\nFull user objective",
      ),
    ).toBe("Full user objective");
  });
});
