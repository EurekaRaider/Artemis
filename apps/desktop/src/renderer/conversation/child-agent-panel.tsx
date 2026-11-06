import { Button } from "@artemis/ui/actions";
import { MarkdownContent } from "../components/MarkdownContent.js";
import { Badge } from "@artemis/ui/actions";
import { UI_COPY } from "../../shared/i18n/ui-copy.js";
import { useLayoutEffect, useRef, type UIEvent as ReactUIEvent } from "react";

import { type ChildAgentState } from "@artemis/protocol";

import { formatRunDuration } from "./run-presentation.js";
import { customAgentInstanceIdentity } from "../settings/custom-agent-identity.js";
import { agentMemberStatus, agentMemberTone } from "./agent-team-panel.js";
import { type Locale } from "../app/app-types.js";
export function ChildAgentPanel({
  active,
  child,
  clockMs,
  locale,
  onControl,
  pendingAction,
}: {
  active: boolean;
  child: ChildAgentState | undefined;
  clockMs: number;
  locale: Locale;
  onControl: (
    child: ChildAgentState,
    action: "steer" | "cancel" | "retry",
  ) => void;
  pendingAction: string | undefined;
}) {
  const CHILD_AGENT_SCROLL_THRESHOLD = 64;
  const childAgentScrollContainer = useRef<HTMLDivElement>(null);
  const childAgentFollowOutput = useRef(true);
  const labels = UI_COPY.App_labels_10125[locale];
  const content = child?.error ?? child?.output ?? child?.activity;
  const running = child?.status === "queued" || child?.status === "running";
  const lastActivityMs = child?.lastActivityAt
    ? Date.parse(child.lastActivityAt)
    : undefined;
  const silentMilliseconds = lastActivityMs
    ? Math.max(0, clockMs - lastActivityMs)
    : 0;
  const health =
    child?.health === "stalled" ||
    (child?.status === "running" &&
      !child?.currentTool &&
      silentMilliseconds >= CHILD_UNRESPONSIVE_SILENCE_MILLISECONDS)
      ? "stalled"
      : child?.health === "suspect" ||
          (child?.status === "running" && silentMilliseconds >= 60_000)
        ? "suspect"
        : "healthy";
  const healthLabel =
    child?.status === "running"
      ? health === "stalled"
        ? labels.unresponsive
        : health === "suspect"
          ? labels.longRunning
          : undefined
      : undefined;
  const startedMilliseconds = child?.startedAt
    ? Date.parse(child.startedAt)
    : child?.updatedAt
      ? Date.parse(child.updatedAt)
      : clockMs;
  const elapsedMilliseconds = Math.max(0, clockMs - startedMilliseconds);
  const lastActivityLabel =
    silentMilliseconds < 1_000
      ? labels.justNow
      : labels.ago.replace(
          "{{duration}}",
          formatRunDuration(silentMilliseconds, locale),
        );
  const currentToolElapsed = child?.currentToolStartedAt
    ? Math.max(0, clockMs - Date.parse(child.currentToolStartedAt))
    : undefined;
  const controlPending = child
    ? pendingAction?.startsWith(`${child.agentId}:`)
    : false;
  const handleChildAgentScroll = (event: ReactUIEvent<HTMLElement>) => {
    const { clientHeight, scrollHeight, scrollTop } = event.currentTarget;
    childAgentFollowOutput.current =
      scrollHeight - scrollTop - clientHeight <= CHILD_AGENT_SCROLL_THRESHOLD;
  };

  useLayoutEffect(() => {
    if (!active || !childAgentFollowOutput.current) return;
    const container = childAgentScrollContainer.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [active, content, child?.status]);

  return (
    <section
      aria-live="polite"
      className={`child-agent-panel ${child?.status ?? "unavailable"} ${health}`}
    >
      <header className="child-agent-panel-header">
        <span>
          <strong>{child?.label ?? labels.subagent}</strong>
          {child && (
            <Badge
              className="agent-panel-status"
              tone={agentMemberTone(child.status)}
            >
              {agentMemberStatus(child.status, locale) +
                (healthLabel ? ` · ${healthLabel}` : "")}
            </Badge>
          )}
        </span>
        {child && child.status !== "completed" && (
          <div className="child-agent-panel-actions">
            {running && (
              <button
                className="child-agent-panel-control"
                disabled={controlPending}
                onClick={() => onControl(child, "steer")}
                type="button"
              >
                {labels.nudge}
              </button>
            )}
            {(running || child.status === "cancelling") && (
              <button
                className="child-agent-panel-control danger"
                disabled={controlPending || child.status === "cancelling"}
                onClick={() => onControl(child, "cancel")}
                type="button"
              >
                {labels.childStop}
              </button>
            )}
            {(child.status === "failed" ||
              child.status === "blocked" ||
              child.status === "cancelled") && (
              <button
                className="child-agent-panel-control"
                disabled={controlPending}
                onClick={() => onControl(child, "retry")}
                type="button"
              >
                {labels.retry}
              </button>
            )}
          </div>
        )}
      </header>
      {child?.customAgent && (
        <p className="child-agent-panel-identity">
          {customAgentInstanceIdentity(child.customAgent, locale)}
        </p>
      )}
      {child && child.status !== "completed" && (
        <details className="child-agent-panel-runtime-bar">
          <summary>{labels.runtimeDetails}</summary>
          <dl className="child-agent-panel-runtime">
            <div>
              <dt>{labels.elapsed}</dt>
              <dd>{formatRunDuration(elapsedMilliseconds, locale)}</dd>
            </div>
            <div>
              <dt>{labels.lastActivity}</dt>
              <dd>{lastActivityLabel}</dd>
            </div>
            <div>
              <dt>{labels.currentTool}</dt>
              <dd>
                {child.currentTool ?? "—"}
                {child.currentTool && currentToolElapsed !== undefined
                  ? ` · ${formatRunDuration(currentToolElapsed, locale)}`
                  : ""}
              </dd>
            </div>
            {healthLabel && (
              <div className="child-agent-panel-health">
                <dt>{labels.health}</dt>
                <dd>{healthLabel}</dd>
              </div>
            )}
          </dl>
        </details>
      )}
      <div
        className="child-agent-panel-body"
        onScroll={handleChildAgentScroll}
        ref={childAgentScrollContainer}
      >
        <div className="child-agent-panel-body-inner">
          {!child ? (
            <p className="child-agent-panel-empty">{labels.unavailable}</p>
          ) : (
            <>
              {child.task && (
                <section className="child-agent-panel-task">
                  <span>{labels.task}</span>
                  <p>{child.task}</p>
                </section>
              )}
              {(child.activity || child.currentTool) && (
                <section className="child-agent-panel-task">
                  <span>{labels.activityLog}</span>
                  {child.currentTool && (
                    <div className="child-agent-activity-row">
                      <span>{child.currentTool}</span>
                      <Badge
                        className="agent-panel-status"
                        tone={agentMemberTone(child.status)}
                      >
                        {agentMemberStatus(child.status, locale)}
                      </Badge>
                    </div>
                  )}
                  {child.activity && (
                    <MarkdownContent
                      className="child-agent-activity-log"
                      text={child.activity}
                    />
                  )}
                </section>
              )}
              {child.output || child.error ? (
                <section className="child-agent-panel-task">
                  <span>{labels.result}</span>
                  <MarkdownContent
                    className={
                      child.error
                        ? "child-agent-panel-output error"
                        : "child-agent-panel-output"
                    }
                    text={child.error ?? child.output ?? ""}
                  />
                </section>
              ) : !child.activity && !child.currentTool ? (
                <p className="child-agent-panel-empty">{labels.waiting}</p>
              ) : null}
              {child.status === "completed" && (
                <Button
                  className="child-agent-panel-retry"
                  variant="quiet"
                  disabled={controlPending}
                  onClick={() => onControl(child, "retry")}
                >
                  {labels.retry}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

export const CHILD_UNRESPONSIVE_SILENCE_MILLISECONDS = 5 * 60_000;
