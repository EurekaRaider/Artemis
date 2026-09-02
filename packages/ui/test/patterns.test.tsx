// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AgentActivity,
  AgentTeamSummary,
  ApprovalCard,
  ContextUsage,
  PATTERN_ACCESSIBLE_NAME_ERROR,
  PATTERN_COLLECTION_ERROR,
  PATTERN_COMPONENT_CONTRACTS,
  PATTERN_COMPONENT_MUTABLE_TOKENS,
  PATTERN_DISCLOSURE_CONTROL_ERROR,
  PATTERN_HIDDEN_LABEL_ICON_ERROR,
  ResultDisclosure,
  RunModeControl,
  TaskPlan,
  ToolActivity,
  TurnStatus,
  UserInput,
  type AgentTeamMember,
  type RunModeOption,
  type UserInputOption,
  validatePatternComponentContracts,
} from "../src/patterns.js";

afterEach(() => cleanup());

describe("Agent pattern contracts", () => {
  it("freezes exact policy-free anatomy and token boundaries", () => {
    expect(Object.isFrozen(PATTERN_COMPONENT_CONTRACTS)).toBe(true);
    expect(PATTERN_COMPONENT_CONTRACTS.approvalCard.interaction).toEqual([
      "caller-owned-actions",
      "caller-owned-action-order",
    ]);
    expect(PATTERN_COMPONENT_CONTRACTS.toolActivity.interaction).toContain(
      "caller-formats-tool-data",
    );
    expect(PATTERN_COMPONENT_MUTABLE_TOKENS).not.toContain(
      "--artemis-color-canvas",
    );
    expect(
      validatePatternComponentContracts(PATTERN_COMPONENT_CONTRACTS),
    ).toEqual({ valid: true, errors: [] });
  });

  it("rejects contract drift", () => {
    const drift = structuredClone(PATTERN_COMPONENT_CONTRACTS);
    (drift.approvalCard.interaction as string[]).reverse();
    expect(validatePatternComponentContracts(drift).valid).toBe(false);
  });
});

describe("Agent patterns", () => {
  it("keeps run-mode value and ordering caller-controlled", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    const { rerender } = render(
      <RunModeControl
        label="Run mode"
        onValueChange={onValueChange}
        options={[
          { label: "Plan", value: "plan" },
          {
            label: "Execute",
            value: "execute",
          },
        ]}
        statusLabel="Ready"
        value="plan"
      />,
    );
    const modes = screen.getAllByRole("radio");
    expect(modes.map((mode) => mode.textContent)).toEqual(["Plan", "Execute"]);
    await user.click(modes[1]!);
    expect(onValueChange).toHaveBeenCalledWith("execute");
    expect(modes[0]?.getAttribute("aria-checked")).toBe("true");

    rerender(
      <RunModeControl
        label="Run mode"
        onValueChange={onValueChange}
        options={[
          { label: "Plan", value: "plan" },
          {
            label: "Execute",
            value: "execute",
          },
        ]}
        state="busy"
        statusLabel="Busy"
        value="plan"
      />,
    );
    await user.click(screen.getAllByRole("radio")[1]!);
    expect(onValueChange).toHaveBeenCalledTimes(1);
  });

  it("implements roving radio keyboard navigation and skips disabled modes", () => {
    function KeyboardModes() {
      const [value, setValue] = useState<"plan" | "execute" | "review">("plan");
      return (
        <RunModeControl
          label="Run mode"
          onValueChange={setValue}
          options={[
            { label: "Plan", value: "plan" },
            {
              disabled: true,
              label: "Execute",
              value: "execute",
            },
            {
              label: "Review",
              value: "review",
            },
          ]}
          statusLabel="Ready"
          value={value}
        />
      );
    }
    render(<KeyboardModes />);
    const plan = screen.getByRole("radio", { name: "Plan" });
    const execute = screen.getByRole("radio", { name: "Execute" });
    const review = screen.getByRole("radio", { name: "Review" });
    expect([plan.tabIndex, execute.tabIndex, review.tabIndex]).toEqual([
      0, -1, -1,
    ]);
    plan.focus();
    fireEvent.keyDown(plan, { key: "ArrowRight" });
    expect(document.activeElement).toBe(review);
    expect(review.getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(review, { key: "Home" });
    expect(document.activeElement).toBe(plan);
    fireEvent.keyDown(plan, { key: "End" });
    expect(document.activeElement).toBe(review);
  });

  it("keeps icon-only visuals tied to string-owned rendered names", () => {
    const { container } = render(
      <>
        <RunModeControl
          label="Modes"
          onValueChange={() => undefined}
          options={[
            {
              icon: <span>mode icon</span>,
              label: "Plan mode",
              labelVisibility: "hidden",
              value: "plan",
            },
          ]}
          statusLabel="Ready"
          value="plan"
        />
        <UserInput
          label="Input"
          onOptionSelect={() => undefined}
          options={[
            {
              icon: <span>input icon</span>,
              id: "plan",
              label: "Choose plan",
              labelVisibility: "hidden",
            },
          ]}
          question="Choose"
          state="pending"
          statusLabel="Pending"
        />
        <AgentTeamSummary
          label="Team"
          members={[
            {
              icon: <span>member icon</span>,
              id: "validator",
              label: "Open validator",
              labelVisibility: "hidden",
              state: "running",
              statusLabel: "Running",
            },
          ]}
          onMemberSelect={() => undefined}
          state="active"
          statusLabel="Active"
          title="Team"
        />
      </>,
    );
    expect(screen.getByRole("radio", { name: "Plan mode" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Choose plan" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open validator" })).toBeTruthy();
    const icons = container.querySelectorAll('[data-part="icon"]');
    expect(icons).toHaveLength(3);
    expect(
      [...icons].every((icon) => icon.getAttribute("aria-hidden") === "true"),
    ).toBe(true);
    expect(
      [...container.querySelectorAll('[data-part="label"]')].every(
        (label) =>
          label.getAttribute("data-label-visibility") === "hidden" &&
          label.textContent !== "",
      ),
    ).toBe(true);
    expect(
      [...container.querySelectorAll("button")].every(
        (button) =>
          button.hasAttribute("aria-labelledby") &&
          !button.hasAttribute("aria-label"),
      ),
    ).toBe(true);
  });

  it("rejects hidden labels without a renderable icon element", () => {
    const invalidIcons = ["", 0, undefined] as const;
    for (const icon of invalidIcons) {
      const runModeOption = {
        ...(icon === undefined ? {} : { icon }),
        label: "Plan mode",
        labelVisibility: "hidden",
        value: "plan",
      } as unknown as RunModeOption<"plan">;
      expect(() =>
        render(
          <RunModeControl
            label="Modes"
            onValueChange={() => undefined}
            options={[runModeOption]}
            statusLabel="Ready"
            value="plan"
          />,
        ),
      ).toThrow(PATTERN_HIDDEN_LABEL_ICON_ERROR);

      const inputOption = {
        ...(icon === undefined ? {} : { icon }),
        id: "plan",
        label: "Choose plan",
        labelVisibility: "hidden",
      } as unknown as UserInputOption;
      expect(() =>
        render(
          <UserInput
            label="Input"
            onOptionSelect={() => undefined}
            options={[inputOption]}
            question="Choose"
            state="pending"
            statusLabel="Pending"
          />,
        ),
      ).toThrow(PATTERN_HIDDEN_LABEL_ICON_ERROR);

      const member = {
        ...(icon === undefined ? {} : { icon }),
        id: "validator",
        label: "Open validator",
        labelVisibility: "hidden",
        state: "running",
        statusLabel: "Running",
      } as unknown as AgentTeamMember;
      expect(() =>
        render(
          <AgentTeamSummary
            label="Team"
            members={[member]}
            state="active"
            statusLabel="Active"
            title="Team"
          />,
        ),
      ).toThrow(PATTERN_HIDDEN_LABEL_ICON_ERROR);
    }
  });

  it("renders approval actions in the exact order supplied by the caller", () => {
    render(
      <ApprovalCard
        actions={
          <>
            <button type="button">Deny</button>
            <button type="button">Project</button>
            <button type="button">Session</button>
            <button type="button">Once</button>
          </>
        }
        description="npm test"
        label="Approval required"
        reason="The caller also owns this explanation."
        state="pending"
        statusLabel="Pending"
        title="Run tests"
      />,
    );
    const card = screen.getByRole("article", { name: "Approval required" });
    expect(
      within(card)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Deny", "Project", "Session", "Once"]);
    expect(card.getAttribute("data-state")).toBe("pending");
  });

  it("emits disclosure intent without mutating controlled tool state", async () => {
    const user = userEvent.setup();
    const onExpandedChange = vi.fn();
    const { container, rerender } = render(
      <ToolActivity
        collapseLabel="Collapse"
        expandLabel="Expand"
        expanded={false}
        label="Read files"
        onExpandedChange={onExpandedChange}
        state="running"
        statusLabel="Running"
        summary="Reading files"
      >
        Details
      </ToolActivity>,
    );
    await user.click(
      screen.getByRole("button", { name: "Expand: Read files" }),
    );
    expect(onExpandedChange).toHaveBeenCalledWith(true);
    expect(
      screen.getByText("Details").closest('[data-part="content"]'),
    ).toHaveProperty("hidden", true);
    rerender(
      <ToolActivity
        collapseLabel="Collapse"
        expandLabel="Expand"
        expanded
        label="Read files"
        onExpandedChange={onExpandedChange}
        state="completed"
        statusLabel="Completed"
        summary="Read files"
      >
        Details
      </ToolActivity>,
    );
    expect(
      screen.getByText("Details").closest('[data-part="content"]'),
    ).toHaveProperty("hidden", false);
  });

  it("rejects dual disclosure props and controlled ownership changes", () => {
    expect(() =>
      render(
        <ToolActivity
          collapseLabel="Collapse"
          defaultExpanded
          expandLabel="Expand"
          expanded={false}
          label="Tool"
          state="completed"
          statusLabel="Completed"
          summary="Tool"
        >
          Details
        </ToolActivity>,
      ),
    ).toThrow(PATTERN_DISCLOSURE_CONTROL_ERROR);

    const { rerender } = render(
      <ResultDisclosure
        collapseLabel="Collapse"
        expandLabel="Expand"
        expanded={false}
        label="Result"
        state="ready"
        statusLabel="Ready"
        summary="Result"
      >
        Details
      </ResultDisclosure>,
    );
    expect(() =>
      rerender(
        <ResultDisclosure
          collapseLabel="Collapse"
          expandLabel="Expand"
          label="Result"
          state="ready"
          statusLabel="Ready"
          summary="Result"
        >
          Details
        </ResultDisclosure>,
      ),
    ).toThrow(PATTERN_DISCLOSURE_CONTROL_ERROR);
  });

  it("exposes task-plan progress, ordered steps, and current pending state", () => {
    const { container } = render(
      <TaskPlan
        collapseLabel="Collapse"
        currentStepId="two"
        defaultExpanded
        expandLabel="Expand"
        label="Step 2 of 3"
        progressLabel="Step 2 of 3"
        state="active"
        statusLabel="In progress"
        steps={[
          {
            id: "one",
            label: "Inspect",
            status: "completed",
            statusLabel: "Completed",
          },
          {
            id: "two",
            label: "Implement",
            status: "pending",
            statusLabel: "In progress",
          },
          {
            id: "three",
            label: "Verify",
            status: "pending",
            statusLabel: "Not started",
          },
        ]}
        stepsLabel="Task steps"
      />,
    );
    expect(screen.getByRole("list", { name: "Task steps" })).toBeTruthy();
    expect(
      container.querySelector('[data-part="step"][data-status="in_progress"]')
        ?.textContent,
    ).toContain("Implement");
    expect(
      screen.getByRole("button", { name: "Collapse: Step 2 of 3" }),
    ).toBeTruthy();
  });

  it("preserves task-plan hover intent across streaming rerenders", () => {
    vi.useFakeTimers();
    try {
      const renderPlan = (progressLabel: string) => (
        <TaskPlan
          collapseLabel="Collapse"
          currentStepId="one"
          expandLabel="Expand"
          label="Plan"
          progressLabel={progressLabel}
          state="active"
          statusLabel="In progress"
          steps={[
            {
              id: "one",
              label: "Inspect",
              status: "in_progress",
              statusLabel: "In progress",
            },
          ]}
          stepsLabel="Task steps"
        />
      );
      const { rerender } = render(renderPlan("Step 1"));
      fireEvent.pointerEnter(
        screen.getByRole("button", { name: "Expand: Plan" }),
      );
      rerender(renderPlan("Step 1, streaming update"));
      act(() => vi.advanceTimersByTime(175));
      expect(
        screen
          .getByRole("button", { name: "Collapse: Plan" })
          .getAttribute("aria-expanded"),
      ).toBe("true");
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels a scheduled task-plan open when the latest state is disabled", () => {
    vi.useFakeTimers();
    try {
      const onExpandedChange = vi.fn();
      const renderPlan = (state: "active" | "disabled") => (
        <TaskPlan
          collapseLabel="Collapse"
          currentStepId="one"
          expandLabel="Expand"
          label="Plan"
          onExpandedChange={onExpandedChange}
          progressLabel="Step 1"
          state={state}
          statusLabel={state === "disabled" ? "Disabled" : "In progress"}
          steps={[
            {
              id: "one",
              label: "Inspect",
              status: "in_progress",
              statusLabel: "In progress",
            },
          ]}
          stepsLabel="Task steps"
        />
      );
      const { rerender } = render(renderPlan("active"));
      fireEvent.pointerEnter(
        screen.getByRole("button", { name: "Expand: Plan" }),
      );
      rerender(renderPlan("disabled"));
      act(() => vi.advanceTimersByTime(175));
      expect(onExpandedChange).not.toHaveBeenCalled();
      expect(
        screen.getByRole("button", { name: "Expand: Plan" }),
      ).toHaveProperty("disabled", true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses the latest controlled callback for a scheduled task-plan open", () => {
    vi.useFakeTimers();
    try {
      const firstCallback = vi.fn();
      const latestCallback = vi.fn();
      const renderPlan = (onExpandedChange: (expanded: boolean) => void) => (
        <TaskPlan
          collapseLabel="Collapse"
          currentStepId="one"
          expandLabel="Expand"
          expanded={false}
          label="Plan"
          onExpandedChange={onExpandedChange}
          progressLabel="Step 1"
          state="active"
          statusLabel="In progress"
          steps={[
            {
              id: "one",
              label: "Inspect",
              status: "in_progress",
              statusLabel: "In progress",
            },
          ]}
          stepsLabel="Task steps"
        />
      );
      const { rerender } = render(renderPlan(firstCallback));
      fireEvent.pointerEnter(
        screen.getByRole("button", { name: "Expand: Plan" }),
      );
      rerender(renderPlan(latestCallback));
      act(() => vi.advanceTimersByTime(175));
      expect(firstCallback).not.toHaveBeenCalled();
      expect(latestCallback).toHaveBeenCalledTimes(1);
      expect(latestCallback).toHaveBeenCalledWith(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not duplicate task-plan open intent when focus follows pointer enter", () => {
    vi.useFakeTimers();
    try {
      const onExpandedChange = vi.fn();
      render(
        <TaskPlan
          collapseLabel="Collapse"
          currentStepId="one"
          expandLabel="Expand"
          label="Plan"
          onExpandedChange={onExpandedChange}
          progressLabel="Step 1"
          state="active"
          statusLabel="In progress"
          steps={[
            {
              id: "one",
              label: "Inspect",
              status: "in_progress",
              statusLabel: "In progress",
            },
          ]}
          stepsLabel="Task steps"
        />,
      );
      const trigger = screen.getByRole("button", { name: "Expand: Plan" });
      fireEvent.pointerEnter(trigger);
      fireEvent.focus(trigger);
      act(() => vi.advanceTimersByTime(175));
      expect(onExpandedChange).toHaveBeenCalledTimes(1);
      expect(onExpandedChange).toHaveBeenCalledWith(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps every disclosure aria-controls target mounted while collapsed", () => {
    const { container } = render(
      <>
        <ToolActivity
          collapseLabel="Collapse"
          expandLabel="Expand"
          label="Tool"
          state="completed"
          statusLabel="Completed"
          summary="Tool"
        >
          Tool details
        </ToolActivity>
        <TaskPlan
          collapseLabel="Collapse"
          currentStepId="one"
          expandLabel="Expand"
          label="Plan"
          progressLabel="Step 1"
          state="active"
          statusLabel="In progress"
          steps={[
            {
              id: "one",
              label: "Inspect",
              status: "in_progress",
              statusLabel: "In progress",
            },
          ]}
          stepsLabel="Task steps"
        />
        <ResultDisclosure
          collapseLabel="Collapse"
          expandLabel="Expand"
          label="Result"
          state="ready"
          statusLabel="Ready"
          summary="Result"
        >
          Result details
        </ResultDisclosure>
      </>,
    );
    const controls = [
      ...container.querySelectorAll<HTMLElement>("[aria-controls]"),
    ];
    expect(controls).toHaveLength(3);
    for (const control of controls) {
      const target = document.getElementById(
        control.getAttribute("aria-controls")!,
      );
      expect(target).not.toBeNull();
      expect(target).toHaveProperty("hidden", true);
    }
  });

  it("rejects duplicate collection keys and missing task references", () => {
    expect(() =>
      render(
        <RunModeControl
          label="Modes"
          onValueChange={() => undefined}
          options={[
            { label: "One", value: "same" },
            { label: "Two", value: "same" },
          ]}
          statusLabel="Ready"
          value="same"
        />,
      ),
    ).toThrow(PATTERN_COLLECTION_ERROR);
    expect(() =>
      render(
        <TaskPlan
          collapseLabel="Collapse"
          currentStepId="missing"
          expandLabel="Expand"
          label="Plan"
          progressLabel="Step 1"
          state="active"
          statusLabel="In progress"
          steps={[
            {
              id: "one",
              label: "Inspect",
              status: "pending",
              statusLabel: "Not started",
            },
          ]}
          stepsLabel="Task steps"
        />,
      ),
    ).toThrow(PATTERN_COLLECTION_ERROR);
    expect(() =>
      render(
        <UserInput
          label="Input"
          onOptionSelect={() => undefined}
          options={[
            { id: "same", label: "One" },
            { id: "same", label: "Two" },
          ]}
          question="Choose"
          state="pending"
          statusLabel="Pending"
        />,
      ),
    ).toThrow(PATTERN_COLLECTION_ERROR);
  });

  it("blocks resolved user input and reports bounded context usage", async () => {
    const user = userEvent.setup();
    const onOptionSelect = vi.fn();
    const { rerender } = render(
      <UserInput
        label="Choose a direction"
        onOptionSelect={onOptionSelect}
        options={[
          {
            id: "a",
            label: "Direction A",
          },
        ]}
        question="Which direction?"
        state="pending"
        statusLabel="Pending"
      />,
    );
    await user.click(screen.getByRole("button", { name: "Direction A" }));
    expect(onOptionSelect).toHaveBeenCalledWith("a");
    rerender(
      <UserInput
        label="Choose a direction"
        onOptionSelect={onOptionSelect}
        options={[
          {
            id: "a",
            label: "Direction A",
          },
        ]}
        question="Which direction?"
        state="timeout"
        statusLabel="Timed out"
      />,
    );
    expect(screen.getByRole("button", { name: "Direction A" })).toHaveProperty(
      "disabled",
      true,
    );

    cleanup();
    render(
      <ContextUsage
        detail="2.5K of 10K tokens"
        label="Context usage"
        percent={125}
        statusLabel="Ready"
        valueLabel="100%"
      />,
    );
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
      "100",
    );
  });

  it("renders agent, team, turn, and result states without runtime data", async () => {
    const user = userEvent.setup();
    const onMemberSelect = vi.fn();
    render(
      <>
        <AgentActivity
          label="Agent build"
          state="running"
          statusLabel="Running"
          title="Build package"
        />
        <AgentTeamSummary
          label="Migration team"
          members={[
            {
              id: "one",
              label: "Agent one",
              state: "completed",
              statusLabel: "Completed",
            },
            {
              id: "two",
              label: "Agent two",
              state: "waiting",
              statusLabel: "Waiting",
            },
          ]}
          onMemberSelect={onMemberSelect}
          state="active"
          statusLabel="1 of 2 complete"
          title="Migration team"
        />
        <TurnStatus
          durationLabel="12s"
          label="Current turn"
          state="running"
          statusLabel="Working"
        />
        <ResultDisclosure
          collapseLabel="Collapse"
          defaultExpanded
          expandLabel="Expand"
          label="Build result"
          state="completed"
          statusLabel="Completed"
          summary="Build complete"
        >
          No errors
        </ResultDisclosure>
      </>,
    );
    await user.click(screen.getByRole("button", { name: /Agent one/u }));
    expect(onMemberSelect).toHaveBeenCalledWith("one");
    expect(
      screen.getByRole("status", { name: "Current turn" }).textContent,
    ).toContain("12s");
    expect(screen.getByText("No errors")).toBeTruthy();
  });

  it("rejects imperceptible accessible names", () => {
    expect(() =>
      render(<TurnStatus label=" " state="idle" statusLabel="Idle" />),
    ).toThrow(PATTERN_ACCESSIBLE_NAME_ERROR);
    expect(() =>
      render(
        <TaskPlan
          collapseLabel="Collapse"
          expandLabel="Expand"
          currentStepId="one"
          label="Plan"
          progressLabel="Step 1"
          state="active"
          statusLabel="In progress"
          steps={[
            {
              id: "one",
              label: "Inspect",
              status: "in_progress",
              statusLabel: "In progress",
            },
          ]}
          stepsLabel=" "
        />,
      ),
    ).toThrow(PATTERN_ACCESSIBLE_NAME_ERROR);
  });

  it("closes uncontrolled result disclosures through native activation", () => {
    const { container } = render(
      <ResultDisclosure
        collapseLabel="Collapse"
        defaultExpanded
        expandLabel="Expand"
        label="Result"
        state="ready"
        statusLabel="Ready"
        summary="Summary"
      >
        Content
      </ResultDisclosure>,
    );
    const disclosure = container.querySelector(
      '[data-artemis-component="result-disclosure"]',
    );
    expect(disclosure?.getAttribute("data-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Collapse: Result" }));
    expect(disclosure?.getAttribute("data-expanded")).toBe("false");
    expect(
      screen.getByText("Content").closest('[data-part="content"]'),
    ).toHaveProperty("hidden", true);
  });
});
