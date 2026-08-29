// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";

import "./renderer-test-utils.js";
import {
  PullRequestChecksPopover,
  PullRequestChecksSummary,
} from "../src/renderer/EnvironmentPanel.js";

const pullRequest = {
  url: "https://example.org/pr/1",
  number: 1,
  title: "Release fix",
  headRefOid: "abc",
  checks: [
    {
      name: "build",
      status: "passed" as const,
      workflowName: "CI",
      detailsUrl: "https://example.org/checks/build",
    },
    { name: "lint", status: "pending" as const },
  ],
};

function renderSummary(overrides: Record<string, unknown> = {}) {
  const onOpenUrl = vi.fn();
  const onToggleOpen = vi.fn();
  const onShowChecksWithFocus = vi.fn();
  const onBlurredOut = vi.fn();
  const Trigger = () => {
    const ref = useRef<HTMLButtonElement>(null);
    return (
      <PullRequestChecksSummary
        checkSummary="pending"
        checksOpen={false}
        chevronIcon={<span aria-hidden="true">›</span>}
        externalIcon={<span aria-hidden="true">↗</span>}
        onBlurredOut={onBlurredOut}
        onOpenUrl={onOpenUrl}
        onShowChecks={vi.fn()}
        onShowChecksWithFocus={onShowChecksWithFocus}
        onToggleOpen={onToggleOpen}
        prIcon={<span aria-hidden="true">pr</span>}
        pullRequest={pullRequest as never}
        shouldKeepOpen={() => false}
        stateLabel="Open"
        summaryLabel="Checks pending"
        triggerRef={ref}
        {...overrides}
      />
    );
  };
  render(<Trigger />);
  return { onOpenUrl, onToggleOpen, onShowChecksWithFocus, onBlurredOut };
}

describe("PullRequestChecksSummary", () => {
  it("exposes the dialog semantics on the trigger", () => {
    renderSummary();
    const trigger = screen.getByRole("button", { name: /checks pending/i });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-controls", "environment-pr-checks");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("opens the PR url once from the title button", async () => {
    const { onOpenUrl } = renderSummary();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /release fix/i }));
    expect(onOpenUrl).toHaveBeenCalledTimes(1);
    expect(onOpenUrl).toHaveBeenCalledWith("https://example.org/pr/1");
  });

  it("opens with focus on Enter and toggles on click", async () => {
    const user = userEvent.setup();
    const { onShowChecksWithFocus, onToggleOpen } = renderSummary();
    const trigger = screen.getByRole("button", { name: /checks pending/i });
    trigger.focus();
    await user.keyboard("{Enter}");
    expect(onShowChecksWithFocus).toHaveBeenCalledTimes(1);
    await user.click(trigger);
    expect(onToggleOpen).toHaveBeenCalledTimes(1);
  });

  it("renders coverage warning and stale notice with full title", () => {
    renderSummary({
      staleLabel: "Stale",
      staleTitle: "Could not refresh checks",
      warningLabel: "Unpushed changes",
    });
    expect(screen.getByText("Unpushed changes")).toBeInTheDocument();
    const stale = screen.getByText("Stale");
    expect(stale).toHaveAttribute("title", "Could not refresh checks");
  });
});

describe("PullRequestChecksPopover", () => {
  function renderPopover(checks = pullRequest.checks) {
    const onOpenUrl = vi.fn();
    const Popover = () => {
      const ref = useRef<HTMLDivElement>(null);
      return (
        <PullRequestChecksPopover
          checks={checks as never}
          checkSummaryLabels={{ passed: "Passed", pending: "Pending" }}
          containerRef={ref}
          noneLabel="No checks"
          onOpenUrl={onOpenUrl}
          onScheduleClose={vi.fn()}
          onCancelClose={vi.fn()}
          position={{ left: 10, top: 20 }}
          prLabel="#1 · Open"
          title="Check details"
          triggerContains={() => false}
        />
      );
    };
    render(<Popover />);
    return { onOpenUrl };
  }

  it("renders as a labelled dialog with per-check rows", () => {
    renderPopover();
    expect(
      screen.getByRole("dialog", { name: "Check details" }),
    ).toBeInTheDocument();
    expect(screen.getByText("build")).toBeInTheDocument();
    expect(screen.getByText("lint")).toBeInTheDocument();
    expect(screen.getByText("CI · Passed")).toBeInTheDocument();
  });

  it("opens a check detail url exactly once when it has one", async () => {
    const { onOpenUrl } = renderPopover();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /build/i }));
    expect(onOpenUrl).toHaveBeenCalledTimes(1);
    expect(onOpenUrl).toHaveBeenCalledWith("https://example.org/checks/build");
  });

  it("shows the empty state when the PR has no checks", () => {
    renderPopover([]);
    expect(screen.getByText("No checks")).toBeInTheDocument();
  });
});
