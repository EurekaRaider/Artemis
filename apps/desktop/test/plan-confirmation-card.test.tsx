// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createThreadViewState, type SavedPlan } from "@artemis/protocol";
import { PlanConfirmationCard } from "../src/renderer/PlanConfirmationCard.js";
import {
  DecisionComposer,
  firstPendingComposerDecision,
} from "../src/renderer/DecisionComposer.js";
import "./renderer-test-utils.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const plan: SavedPlan = {
  planId: "plan",
  revision: 1,
  sourceTurnId: "turn",
  title: "Complete plan",
  markdown:
    "## Goal\nRepair the reconnect flow.\n## Steps\nKeep completed results.\n## Acceptance\nNo duplicate side effects.",
  actionable: true,
  ready: true,
  status: "proposed",
};
function surface(
  value = plan,
  accept = vi.fn(async () => {}),
  revise = vi.fn(async (_text: string) => {}),
) {
  const state = { ...createThreadViewState("thread"), plans: [value] };
  return (
    <>
      <PlanConfirmationCard plan={value} locale="en" />
      <DecisionComposer
        className="composer"
        label="Message"
        decision={firstPendingComposerDecision(state)}
        locale="en"
        onResolveApproval={vi.fn()}
        onResolveUserInput={vi.fn()}
        onAcceptPlan={accept}
        onRevisePlan={revise}
        context={<span>Plan · Local</span>}
      >
        <textarea aria-label="Normal composer" defaultValue="Preserved draft" />
      </DecisionComposer>
    </>
  );
}
it("keeps the full plan in history and waits inside the ordinary composer without a timer", async () => {
  vi.useFakeTimers();
  const accept = vi.fn(async () => {});
  const revise = vi.fn(async (_text: string) => {});
  render(surface(plan, accept, revise));
  const composer = screen.getByRole("region", { name: "Message" });
  expect(composer.classList.contains("composer-awaiting-decision")).toBe(true);
  expect(document.querySelector(".plan-confirmation button")).toBeNull();
  expect(screen.getByText("Keep completed results.")).toBeTruthy();
  expect(screen.queryByRole("textbox", { name: "Normal composer" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Skip" })).toBeNull();
  await act(async () => vi.advanceTimersByTime(24 * 60 * 60 * 1000));
  expect(accept).not.toHaveBeenCalled();
  expect(revise).not.toHaveBeenCalled();
  fireEvent.click(
    within(composer).getByRole("button", {
      name: "Add requirements",
      exact: true,
    }),
  );
  expect(document.activeElement).toBe(
    screen.getByRole("textbox", { name: "Add requirements" }),
  );
  expect(revise).not.toHaveBeenCalled();
  const execute = within(composer).getByRole("button", {
    name: /^Execute plan/,
  });
  fireEvent.click(execute);
  fireEvent.click(execute);
  await act(async () => {});
  expect(accept).toHaveBeenCalledExactlyOnceWith(plan, "work");
});
it("submits typed requirements directly and offers Codemode only through the dropdown", async () => {
  const accept = vi.fn(async () => {});
  const revise = vi.fn(async (_text: string) => {});
  render(surface(plan, accept, revise));
  const input = screen.getByRole("textbox", { name: "Add requirements" });
  fireEvent.change(input, { target: { value: "Include rollback checks" } });
  fireEvent.submit(input.closest("form")!);
  await act(async () => {});
  expect(revise).toHaveBeenCalledExactlyOnceWith("Include rollback checks");
  expect(accept).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Execution options" }));
  await act(async () => {});
  fireEvent.click(
    screen.getByRole("menuitem", {
      name: "Execute in Code mode",
      hidden: true,
    }),
  );
  await act(async () => {});
  expect(accept).toHaveBeenCalledExactlyOnceWith(plan, "codemode");
});
it("restores the normal composer for incomplete, superseded, or accepted plans", () => {
  const { rerender } = render(surface({ ...plan, ready: false }));
  for (const value of [
    { ...plan, ready: false },
    { ...plan, status: "superseded" as const },
    { ...plan, status: "accepted" as const },
  ]) {
    rerender(surface(value));
    expect(screen.queryByRole("button", { name: /^Execute plan/ })).toBeNull();
    expect(
      (
        screen.getByRole("textbox", {
          name: "Normal composer",
        }) as HTMLTextAreaElement
      ).value,
    ).toBe("Preserved draft");
  }
});
it("shows a no-action plan without execution controls and keeps the requirements input available", () => {
  render(surface({ ...plan, actionable: false }));
  expect(screen.queryByRole("button", { name: /^Execute plan/ })).toBeNull();
  expect(
    screen.getByRole("textbox", { name: "Add requirements" }),
  ).toBeTruthy();
  expect(screen.getAllByText(/No action needed/)).toHaveLength(2);
});
