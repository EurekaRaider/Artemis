// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ThreadGoal } from "@artemis/protocol";

import "./renderer-test-utils.js";

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

describe("compact Goal rail", () => {
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

  it("keeps one status marker and plain progress beside the icon-only controls", () => {
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
    expect(markup).toContain('data-artemis-component="button"');
    expect(markup).toContain('data-artemis-component="icon-button"');
    expect(markup).toContain('data-artemis-component="badge"');
    expect(markup).not.toContain('data-artemis-component="status"');
    expect(markup.match(/data-part="indicator"/g)).toHaveLength(1);
    expect(markup).toContain('class="goal-bar-progress">2.5K / 10K</span>');
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

describe("GoalBar interactions (jsdom)", () => {
  it("retains labelled keyboard controls for editing, clearing and resuming paused goals", async () => {
    const onClear = vi.fn(),
      onEdit = vi.fn(),
      onResume = vi.fn();
    render(
      <GoalBar
        clockMs={Date.parse(goal().updatedAt)}
        goal={goal({ status: "paused" })}
        locale="en"
        onClear={onClear}
        onEdit={onEdit}
        onPause={vi.fn()}
        onResume={onResume}
      />,
    );
    const user = userEvent.setup();
    const clear = screen.getByRole("button", { name: "Clear goal" });
    expect(clear).toHaveAttribute("title", "Clear goal");
    clear.focus();
    await user.keyboard("{Enter}");
    await user.tab();
    expect(screen.getByRole("button", { name: "Resume goal" })).toHaveFocus();
    await user.keyboard("{Enter}");
    await user.tab();
    await user.keyboard("{Enter}");
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Pause goal" })).toBeNull();
  });
  it("pauses an active goal from a real click on the pause button", async () => {
    const onPause = vi.fn();
    render(
      <GoalBar
        clockMs={Date.parse(goal().updatedAt)}
        goal={goal()}
        locale="en"
        onClear={vi.fn()}
        onEdit={vi.fn()}
        onPause={onPause}
        onResume={vi.fn()}
      />,
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Pause goal" }));
    expect(onPause).toHaveBeenCalledTimes(1);
  });

  it("marks a disabled bar aria-busy and blocks the pause action", async () => {
    const onPause = vi.fn();
    render(
      <GoalBar
        clockMs={Date.parse(goal().updatedAt)}
        disabled
        goal={goal()}
        locale="en"
        onClear={vi.fn()}
        onEdit={vi.fn()}
        onPause={onPause}
        onResume={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("region", { name: "Pursuing goal" }),
    ).toHaveAttribute("aria-busy", "true");
    const pause = screen.getByRole("button", { name: "Pause goal" });
    expect(pause).toBeDisabled();
    await userEvent.setup().click(pause);
    expect(onPause).not.toHaveBeenCalled();
  });
});
