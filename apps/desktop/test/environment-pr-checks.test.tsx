// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
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

const keepOpenImpl = { current: () => false };
const keepOpenMock = (value: boolean) => {
  keepOpenImpl.current = () => value;
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
        onBlurredOut={onBlurredOut}
        onOpenUrl={onOpenUrl}
        onShowChecks={vi.fn()}
        onShowChecksWithFocus={onShowChecksWithFocus}
        onToggleOpen={onToggleOpen}
        prIcon={<span aria-hidden="true">pr</span>}
        pullRequest={pullRequest as never}
        shouldKeepOpen={(node) => keepOpenImpl.current(node)}
        stateLabel="Open"
        summaryLabel="Checks pending"
        triggerRef={ref}
        {...overrides}
      />
    );
  };
  render(<Trigger />);
  return {
    onOpenUrl,
    onToggleOpen,
    onShowChecksWithFocus,
    onBlurredOut,
  };
}

describe("PullRequestChecksSummary", () => {
  it.each(["passed", "pending", "failed", "none", "cancelled", "skipped"])(
    "uses the %s summary state for the PR icon",
    (checkSummary) => {
      renderSummary({ checkSummary });
      expect(document.querySelector(".environment-pr-icon")).toHaveAttribute(
        "data-status",
        checkSummary,
      );
    },
  );

  it("shows proportional passed, failed and pending segments even when the summary is failed", () => {
    renderSummary({
      checkSummary: "failed",
      pullRequest: {
        ...pullRequest,
        checks: ["passed", "passed", "failed", "pending"].map((status, i) => ({
          name: `check-${i}`,
          status,
        })),
      },
    });
    const ring = document.querySelector(".environment-check-ring")!;
    expect(ring.children).toHaveLength(3);
    expect(ring.querySelector('[data-status="passed"]')).toHaveStyle({
      backgroundImage:
        "conic-gradient(transparent 0% 0%, currentColor 0% 50%, transparent 50% 100%)",
    });
    expect(ring.querySelector('[data-status="failed"]')).toHaveStyle({
      backgroundImage:
        "conic-gradient(transparent 0% 50%, currentColor 50% 75%, transparent 75% 100%)",
    });
    expect(ring.querySelector('[data-status="pending"]')).toHaveStyle({
      backgroundImage:
        "conic-gradient(transparent 0% 75%, currentColor 75% 100%, transparent 100% 100%)",
    });
  });

  it.each([
    [[], []],
    [["passed", "passed"], ["passed"]],
    [["failed"], ["failed"]],
    [["pending"], ["pending"]],
    [["skipped", "cancelled"], ["neutral"]],
    [
      ["passed", "skipped"],
      ["passed", "neutral"],
    ],
  ])(
    "handles terminal, empty and neutral check sets %j",
    (statuses, expected) => {
      renderSummary({
        pullRequest: {
          ...pullRequest,
          checks: statuses.map((status, i) => ({ name: `check-${i}`, status })),
        },
      });
      const segments = document.querySelectorAll(".environment-check-segment");
      expect(
        [...segments].map((segment) => segment.getAttribute("data-status")),
      ).toEqual(expected);
    },
  );

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
      const triggerRef = useRef<HTMLButtonElement>(null);
      return (
        <>
          <button ref={triggerRef} type="button">
            Checks
          </button>
          <PullRequestChecksPopover
            anchorRef={triggerRef}
            checks={checks as never}
            checkSummaryLabels={{ passed: "Passed", pending: "Pending" }}
            containerRef={ref}
            externalIcon={<svg aria-hidden="true" data-testid="external" />}
            noneLabel="No checks"
            onOpenChange={vi.fn()}
            onOpenUrl={onOpenUrl}
            onScheduleClose={vi.fn()}
            onCancelClose={vi.fn()}
            open
            prLabel="#1 · Open"
            title="Check details"
            triggerContains={() => false}
          />
        </>
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
    expect(screen.queryByText("CI · Passed")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Passed" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /build/i })).toHaveAttribute(
      "title",
      "build · CI · Passed",
    );
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

describe("PullRequestChecksSummary interaction predicates (review follow-up)", () => {
  it("keeps the popover open on blur only when the predicate says so", () => {
    const { onBlurredOut } = renderSummary();
    const trigger = screen.getByRole("button", { name: /checks pending/i });
    const popoverChild = document.createElement("span");

    keepOpenMock(true);
    fireEvent.blur(trigger, { relatedTarget: popoverChild });
    expect(onBlurredOut).not.toHaveBeenCalled();

    keepOpenMock(false);
    fireEvent.blur(trigger, { relatedTarget: popoverChild });
    expect(onBlurredOut).toHaveBeenCalledTimes(1);

    fireEvent.blur(trigger, { relatedTarget: null });
    expect(onBlurredOut).toHaveBeenCalledTimes(2);
  });

  it("opens with focus via ArrowDown and Space as well", async () => {
    const user = userEvent.setup();
    const { onShowChecksWithFocus } = renderSummary();
    const trigger = screen.getByRole("button", { name: /checks pending/i });
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    expect(onShowChecksWithFocus).toHaveBeenCalledTimes(1);
    await user.keyboard(" ");
    expect(onShowChecksWithFocus).toHaveBeenCalledTimes(2);
  });
});

describe("PullRequestChecksPopover interaction predicates (review follow-up)", () => {
  function renderPopoverWith(onScheduleClose: ReturnType<typeof vi.fn>) {
    const Popover = () => {
      const ref = useRef<HTMLDivElement>(null);
      const triggerRef = useRef<HTMLButtonElement>(null);
      return (
        <>
          <button ref={triggerRef} type="button">
            Checks
          </button>
          <PullRequestChecksPopover
            anchorRef={triggerRef}
            checks={pullRequest.checks as never}
            checkSummaryLabels={{ passed: "Passed", pending: "Pending" }}
            containerRef={ref}
            externalIcon={<svg aria-hidden="true" data-testid="external" />}
            noneLabel="No checks"
            onOpenChange={vi.fn()}
            onOpenUrl={vi.fn()}
            onScheduleClose={onScheduleClose}
            onCancelClose={vi.fn()}
            open
            prLabel="#1 · Open"
            title="Check details"
            triggerContains={(node) => node?.nodeName === "SPAN"}
          />
        </>
      );
    };
    render(<Popover />);
  }

  it("renders the svg external-link indicator on rows with a details url", () => {
    renderPopoverWith(vi.fn());
    expect(
      document.querySelector(".environment-check-list i svg"),
    ).not.toBeNull();
  });

  it("keeps open when focus moves into the trigger and closes otherwise", () => {
    const onScheduleClose = vi.fn();
    renderPopoverWith(onScheduleClose);
    const dialog = screen.getByRole("dialog", { name: "Check details" });
    const triggerChild = document.createElement("span");
    const outside = document.createElement("button");

    fireEvent.blur(dialog, { relatedTarget: triggerChild });
    expect(onScheduleClose).not.toHaveBeenCalled();

    fireEvent.blur(dialog, { relatedTarget: outside });
    expect(onScheduleClose).toHaveBeenCalledTimes(1);

    fireEvent.blur(dialog, { relatedTarget: null });
    expect(onScheduleClose).toHaveBeenCalledTimes(2);
  });
});
