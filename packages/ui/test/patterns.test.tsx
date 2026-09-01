// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AgentActivity,
  AgentTeamSummary,
  ApprovalCard,
  ContextUsage,
  PATTERN_ACCESSIBLE_NAME_ERROR,
  PATTERN_COMPONENT_CONTRACTS,
  PATTERN_COMPONENT_MUTABLE_TOKENS,
  ResultDisclosure,
  RunModeControl,
  TaskPlan,
  ToolActivity,
  TurnStatus,
  UserInput,
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
          { label: "Execute", value: "execute" },
        ]}
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
          { label: "Execute", value: "execute" },
        ]}
        state="busy"
        value="plan"
      />,
    );
    await user.click(screen.getAllByRole("radio")[1]!);
    expect(onValueChange).toHaveBeenCalledTimes(1);
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
    expect(container.textContent).not.toContain("Details");
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
    expect(container.textContent).toContain("Details");
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

  it("blocks resolved user input and reports bounded context usage", async () => {
    const user = userEvent.setup();
    const onOptionSelect = vi.fn();
    const { rerender } = render(
      <UserInput
        label="Choose a direction"
        onOptionSelect={onOptionSelect}
        options={[{ id: "a", label: "Direction A" }]}
        question="Which direction?"
        state="pending"
      />,
    );
    await user.click(screen.getByRole("button", { name: "Direction A" }));
    expect(onOptionSelect).toHaveBeenCalledWith("a");
    rerender(
      <UserInput
        label="Choose a direction"
        onOptionSelect={onOptionSelect}
        options={[{ id: "a", label: "Direction A" }]}
        question="Which direction?"
        state="timeout"
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
          label="Plan"
          progressLabel="Step 1"
          state="active"
          steps={[]}
          stepsLabel=" "
        />,
      ),
    ).toThrow(PATTERN_ACCESSIBLE_NAME_ERROR);
  });

  it("closes uncontrolled result disclosures through native activation", () => {
    render(
      <ResultDisclosure
        collapseLabel="Collapse"
        defaultExpanded
        expandLabel="Expand"
        label="Result"
        state="ready"
        summary="Summary"
      >
        Content
      </ResultDisclosure>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Collapse: Result" }));
    expect(screen.queryByText("Content")).toBeNull();
  });
});
