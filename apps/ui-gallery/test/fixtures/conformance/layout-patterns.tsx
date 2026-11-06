import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, vi } from "vitest";
import {
  ListRow,
  PanelHeader,
  ScrollArea,
  SplitPane,
  Toolbar,
} from "@artemis/ui/layout";
import {
  AgentActivity,
  AgentTeamSummary,
  ApprovalCard,
  ContextUsage,
  PATTERN_COMPONENT_CONTRACTS,
  ResultDisclosure,
  RunModeControl,
  TaskPlan,
  ToolActivity,
  TurnStatus,
  UserInput,
} from "@artemis/ui/patterns";

export const layoutPatternsCases = {
  "layout-anatomy"() {
    const { container } = render(
      <>
        <Toolbar
          actions={<button type="button">Run</button>}
          label="Matrix tools"
        >
          Project
        </Toolbar>
        <div role="listbox">
          <ListRow label="Overview" selected />
        </div>
        <PanelHeader title="Activity" />
        <ScrollArea label="Matrix content">Content</ScrollArea>
        <SplitPane
          label="Resize matrix"
          maximumSize={360}
          minimumSize={160}
          onSizeChange={() => undefined}
          primary="One"
          secondary="Two"
          size={240}
        />
      </>,
    );
    expect(screen.getByRole("toolbar", { name: "Matrix tools" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Overview" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Matrix content" })).toBeTruthy();
    expect(
      screen.getByRole("separator", { name: "Resize matrix" }),
    ).toBeTruthy();
    expect(
      container.querySelectorAll('[data-artemis-component="panel-header"]'),
    ).toHaveLength(1);
  },
  "split-pane-events"() {
    function MatrixSplitExample() {
      const [size, setSize] = useState(240);
      return (
        <div dir="rtl">
          <SplitPane
            label="Resize RTL matrix"
            maximumSize={360}
            minimumSize={160}
            onSizeChange={setSize}
            primary="One"
            secondary="Two"
            size={size}
            step={20}
          />
        </div>
      );
    }
    render(<MatrixSplitExample />);
    const separator = screen.getByRole("separator", {
      name: "Resize RTL matrix",
    });
    fireEvent.keyDown(separator, { key: "ArrowLeft" });
    expect(separator.getAttribute("aria-valuenow")).toBe("260");
    fireEvent.keyDown(separator, { key: "Home" });
    expect(separator.getAttribute("aria-valuenow")).toBe("160");
    fireEvent.keyDown(separator, { key: "End" });
    expect(separator.getAttribute("aria-valuenow")).toBe("360");
  },
  "pattern-anatomy"() {
    const { container } = render(
      <>
        <RunModeControl
          label="Run mode"
          onValueChange={() => undefined}
          options={[{ label: "Plan", value: "plan" }]}
          statusLabel="Ready"
          value="plan"
        />
        <ApprovalCard
          actions={<button type="button">Approve</button>}
          label="Approval"
          state="pending"
          statusLabel="Pending"
          title="Run command"
        />
        <ToolActivity
          collapseLabel="Collapse"
          expandLabel="Expand"
          label="Tools"
          state="running"
          statusLabel="Running"
          summary="Reading files"
        >
          Details
        </ToolActivity>
        <TaskPlan
          collapseLabel="Collapse"
          currentStepId="one"
          expandLabel="Expand"
          label="Step 1 of 1"
          progressLabel="Step 1 of 1"
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
        <ContextUsage
          label="Context"
          percent={25}
          statusLabel="Ready"
          valueLabel="25%"
        />
        <UserInput
          label="Input"
          onOptionSelect={() => undefined}
          options={[{ id: "one", label: "One" }]}
          question="Choose"
          state="pending"
          statusLabel="Pending"
        />
        <AgentActivity
          label="Agent"
          state="running"
          statusLabel="Running"
          title="Validate"
        />
        <AgentTeamSummary
          label="Team"
          members={[
            {
              id: "one",
              label: "One",
              state: "completed",
              statusLabel: "Completed",
            },
          ]}
          state="active"
          statusLabel="Active"
          title="Team"
        />
        <TurnStatus label="Turn" state="running" statusLabel="Working" />
        <ResultDisclosure
          collapseLabel="Collapse"
          expandLabel="Expand"
          label="Result"
          state="completed"
          statusLabel="Completed"
          summary="Completed"
        >
          Result
        </ResultDisclosure>
      </>,
    );
    expect(
      [...container.querySelectorAll("[data-artemis-component]")].map((node) =>
        node.getAttribute("data-artemis-component"),
      ),
    ).toEqual([
      "run-mode-control",
      "approval-card",
      "tool-activity",
      "task-plan",
      "context-usage",
      "user-input",
      "agent-activity",
      "agent-team-summary",
      "turn-status",
      "result-disclosure",
    ]);
    for (const contract of Object.values(PATTERN_COMPONENT_CONTRACTS)) {
      const root = container.querySelector(
        `[data-artemis-component="${contract.name}"]`,
      );
      expect(root).not.toBeNull();
      const actualParts = new Set(
        [root!, ...root!.querySelectorAll("[data-part]")].map((node) =>
          node.getAttribute("data-part"),
        ),
      );
      for (const requiredPart of contract.parts) {
        expect(actualParts.has(requiredPart)).toBe(true);
      }
      const allowedParts = new Set([
        ...contract.parts,
        ...(contract.optionalParts ?? []),
      ]);
      for (const actualPart of actualParts) {
        expect(actualPart !== null && allowedParts.has(actualPart)).toBe(true);
      }
    }
  },
  "pattern-state-matrix"() {
    const states = [
      "pending",
      "approved",
      "error",
      "stale",
      "disabled",
      "timeout",
    ] as const;
    const { container } = render(
      <>
        {states.map((state) => (
          <ApprovalCard
            actions={
              <button disabled={state === "disabled"} type="button">
                Action
              </button>
            }
            key={state}
            label={`${state} approval`}
            state={state}
            statusLabel={state}
            title={`${state} state`}
          />
        ))}
      </>,
    );
    expect(
      [
        ...container.querySelectorAll(
          '[data-artemis-component="approval-card"]',
        ),
      ].map((node) => node.getAttribute("data-state")),
    ).toEqual(states);
    expect(
      container.querySelector(
        '[data-artemis-component="approval-card"][data-state="disabled"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[data-artemis-component="approval-card"][data-state="disabled"] button',
      ),
    ).toHaveProperty("disabled", true);
  },
  async "pattern-events"() {
    const user = userEvent.setup();
    const modeChanges = vi.fn();
    const toolChanges = vi.fn();
    const inputChanges = vi.fn();
    render(
      <>
        <RunModeControl
          label="Mode"
          onValueChange={modeChanges}
          options={[
            { label: "Plan", value: "plan" },
            {
              label: "Execute",
              value: "execute",
            },
          ]}
          statusLabel="Ready"
          value="plan"
        />
        <ToolActivity
          collapseLabel="Collapse"
          expandLabel="Expand"
          expanded={false}
          label="Tool event"
          onExpandedChange={toolChanges}
          state="completed"
          statusLabel="Completed"
          summary="Read files"
        >
          Details
        </ToolActivity>
        <UserInput
          label="Question"
          onOptionSelect={inputChanges}
          options={[
            {
              id: "one",
              label: "Option one",
            },
          ]}
          question="Choose"
          state="pending"
          statusLabel="Pending"
        />
      </>,
    );
    await user.click(screen.getByRole("radio", { name: "Execute" }));
    await user.click(
      screen.getByRole("button", { name: "Expand: Tool event" }),
    );
    await user.click(screen.getByRole("button", { name: "Option one" }));
    expect(modeChanges).toHaveBeenCalledWith("execute");
    expect(toolChanges).toHaveBeenCalledWith(true);
    expect(inputChanges).toHaveBeenCalledWith("one");
    expect(
      screen.getByText("Details").closest('[data-part="content"]'),
    ).toHaveProperty("hidden", true);
  },
  "pattern-rtl-long-content"() {
    const longLabel =
      "نتيجة طويلة جدا تبقى مقروءة وتستخدم الهندسة المنطقية في الاتجاه من اليمين إلى اليسار";
    const { container } = render(
      <div dir="rtl">
        <ResultDisclosure
          collapseLabel="طي"
          defaultExpanded
          expandLabel="توسيع"
          label={longLabel}
          state="timeout"
          statusLabel="انتهت المهلة"
          summary={longLabel}
        >
          {longLabel}
        </ResultDisclosure>
      </div>,
    );
    expect(
      screen.getByRole("button", { name: `طي: ${longLabel}` }),
    ).toBeTruthy();
    expect(
      container
        .querySelector('[data-artemis-component="result-disclosure"]')
        ?.closest('[dir="rtl"]'),
    ).not.toBeNull();
    expect(container.querySelector("[data-artemis-portal]")).toBeNull();
  },
};
