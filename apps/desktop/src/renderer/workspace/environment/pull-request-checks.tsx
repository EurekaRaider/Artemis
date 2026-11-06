import { type ProjectPullRequestCheckSummary } from "./environment-values.js";
import { type ReactNode, type RefObject } from "react";
import { Popover } from "@artemis/ui/feedback";
import { ArtemisIcon, RunningArc } from "@artemis/ui/icons";
import type {
  ProjectPullRequest,
  ProjectPullRequestCheck,
} from "../../../shared/api.js";

export function PullRequestChecksSummary({
  checkSummary,
  checksOpen,
  onBlurredOut,
  onOpenUrl,
  onShowChecks,
  onShowChecksWithFocus,
  onToggleOpen,
  prIcon,
  pullRequest,
  shouldKeepOpen,
  stateLabel,
  staleLabel,
  staleTitle,
  summaryLabel,
  triggerRef,
  warningLabel,
}: {
  checkSummary: ProjectPullRequestCheckSummary;
  checksOpen: boolean;
  chevronIcon: ReactNode;
  onBlurredOut: () => void;
  onOpenUrl: (url: string) => void;
  onShowChecks: () => void;
  onShowChecksWithFocus: () => void;
  onToggleOpen: () => void;
  prIcon: ReactNode;
  pullRequest: ProjectPullRequest;
  shouldKeepOpen: (node: Node | null) => boolean;
  stateLabel: string;
  staleLabel?: string | undefined;
  staleTitle?: string | undefined;
  summaryLabel: string;
  triggerRef: RefObject<HTMLButtonElement | null>;
  warningLabel?: string | undefined;
}) {
  const counts = { passed: 0, failed: 0, pending: 0, neutral: 0 };
  for (const check of pullRequest.checks) {
    const status =
      check.status === "cancelled" || check.status === "skipped"
        ? "neutral"
        : check.status;
    counts[status] += 1;
  }
  return (
    <div className="environment-pr-card">
      <button
        className="environment-pr-title"
        onClick={() => onOpenUrl(pullRequest.url)}
        type="button"
      >
        <span
          className="environment-row-icon environment-pr-icon"
          data-status={checkSummary}
          data-pr-state={
            pullRequest.isDraft ? "draft" : pullRequest.state.toLowerCase()
          }
        >
          {prIcon}
        </span>
        <span>
          <strong title={pullRequest.title}>{pullRequest.title}</strong>
          <small>#{pullRequest.number}</small>
        </span>
      </button>
      <div className="environment-pr-badges">
        <span
          className="environment-pr-state"
          data-state={
            pullRequest.isDraft ? "draft" : pullRequest.state.toLowerCase()
          }
        >
          {stateLabel}
        </span>
        <button
          aria-controls="environment-pr-checks"
          aria-expanded={checksOpen}
          aria-haspopup="dialog"
          className="environment-pr-check-summary"
          onBlur={(event) => {
            const related = event.relatedTarget;
            if (related instanceof Node && shouldKeepOpen(related)) {
              return;
            }
            onBlurredOut();
          }}
          onClick={onToggleOpen}
          onFocus={onShowChecks}
          onKeyDown={(event) => {
            if (
              event.key === "ArrowDown" ||
              event.key === "Enter" ||
              event.key === " "
            ) {
              event.preventDefault();
              onShowChecksWithFocus();
            }
          }}
          onMouseEnter={onShowChecks}
          onMouseLeave={onBlurredOut}
          ref={triggerRef}
          type="button"
        >
          <span
            aria-hidden="true"
            className="environment-check-status"
            data-status={checkSummary}
          >
            {checkSummary === "pending" ? (
              <RunningArc size={14} />
            ) : (
              <ArtemisIcon
                name={
                  checkSummary === "failed"
                    ? "x-circle"
                    : checkSummary === "passed"
                      ? "check"
                      : "circle"
                }
                width={14}
                height={14}
              />
            )}
          </span>
          <span>{summaryLabel}</span>
          <small>
            {counts.passed}/{pullRequest.checks.length}
          </small>
        </button>
      </div>
      {warningLabel && (
        <p className="environment-pr-warning">
          <ArtemisIcon name="info" width={12} height={12} />
          {warningLabel}
        </p>
      )}
      {staleLabel && staleTitle && (
        <p className="environment-pr-stale" title={staleTitle}>
          {staleLabel}
        </p>
      )}
    </div>
  );
}

export function PullRequestChecksPopover({
  anchorRef,
  checks,
  checkSummaryLabels,
  containerRef,
  externalIcon,
  noneLabel,
  onOpenUrl,
  onScheduleClose,
  onCancelClose,
  onOpenChange,
  open,
  prLabel,
  title,
  triggerContains,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  checks: readonly ProjectPullRequestCheck[];
  checkSummaryLabels: Record<string, string>;
  containerRef: RefObject<HTMLDivElement | null>;
  externalIcon: ReactNode;
  noneLabel: string;
  onOpenUrl: (url: string) => void;
  onScheduleClose: () => void;
  onCancelClose: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  prLabel: string;
  title: string;
  triggerContains: (node: Node | null) => boolean;
}) {
  return (
    <Popover
      align="start"
      anchorRef={anchorRef}
      className="environment-checks-popover"
      contentRef={containerRef}
      focusOnOpen={false}
      id="environment-pr-checks"
      label={title}
      onOpenChange={onOpenChange}
      open={open}
      onBlur={(event) => {
        const related = event.relatedTarget;
        if (
          related instanceof Node &&
          (event.currentTarget.contains(related) || triggerContains(related))
        ) {
          return;
        }
        onScheduleClose();
      }}
      onFocus={onCancelClose}
      onMouseEnter={onCancelClose}
      onMouseLeave={onScheduleClose}
      placement="inline-start"
      tabIndex={-1}
    >
      <header>
        <strong>{title}</strong>
        <small>{prLabel}</small>
      </header>
      <div className="environment-check-list">
        {checks.length === 0 ? (
          <p>{noneLabel}</p>
        ) : (
          checks.map((check, index) => {
            const description = `${check.name} · ${check.workflowName ? `${check.workflowName} · ` : ""}${checkSummaryLabels[check.status]}`;
            const content = (
              <>
                <span
                  aria-label={checkSummaryLabels[check.status]}
                  className="environment-check-indicator"
                  data-status={check.status}
                  role="img"
                >
                  {check.status === "pending" ? (
                    <RunningArc size={14} />
                  ) : (
                    <ArtemisIcon
                      width={14}
                      height={14}
                      name={
                        check.status === "passed"
                          ? "check"
                          : check.status === "failed"
                            ? "x-circle"
                            : "clock"
                      }
                    />
                  )}
                </span>
                <span>
                  <strong>{check.name}</strong>
                </span>
                {check.detailsUrl && <i aria-hidden="true">{externalIcon}</i>}
              </>
            );
            return check.detailsUrl ? (
              <button
                key={`${check.name}:${index}`}
                onClick={() => onOpenUrl(check.detailsUrl!)}
                title={description}
                type="button"
              >
                {content}
              </button>
            ) : (
              <div key={`${check.name}:${index}`} title={description}>
                {content}
              </div>
            );
          })
        )}
      </div>
    </Popover>
  );
}
