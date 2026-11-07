import type {
  AgentEvent,
  AppLocale,
  Automation,
  Thread,
} from "@artemis/protocol";
import { ArtemisIcon } from "@artemis/ui/icons";
import type { ProjectGitInfo } from "../../shared/api.js";
import { uiText } from "../../shared/i18n/ui-text.js";
import { statusText } from "../../shared/i18n/status-text.js";
import { scheduleLabel } from "../automation/schedule-label.js";
import { ThreadStatusIndicator } from "./ThreadStatusIndicator.js";

/** Reuses snapshots already loaded by navigation and the workspace context bar. */
export function WelcomeResume({
  locale,
  projectId,
  threads,
  events,
  automations,
  gitInfo,
  onOpenThread,
  onOpenReview,
  onOpenAutomation,
}: {
  locale: AppLocale;
  projectId: string;
  threads: readonly Thread[];
  events: Readonly<Record<string, AgentEvent[]>>;
  automations: readonly Automation[];
  gitInfo?: ProjectGitInfo | undefined;
  onOpenThread(thread: Thread): void;
  onOpenReview(scope: "unstaged" | "staged"): void;
  onOpenAutomation(id: string): void;
}) {
  const recent = threads
    .filter(
      (thread) =>
        thread.projectId === projectId &&
        !thread.archived &&
        thread.status !== "idle",
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const projectAutomations = automations.filter(
    (item) => item.projectId === projectId && !item.deletedAt,
  );
  const automation =
    projectAutomations
      .filter((item) => item.enabled && item.nextRunAt)
      .sort((a, b) => a.nextRunAt!.localeCompare(b.nextRunAt!))[0] ??
    (!projectAutomations.some((item) => item.enabled)
      ? projectAutomations
          .filter((item) => !item.enabled)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
      : undefined);
  const changes =
    gitInfo?.managed && gitInfo.changeCount > 0 ? gitInfo : undefined;
  if (!recent && !changes && !automation) return null;
  const lastEvent =
    recent?.status === "failed"
      ? events[recent.id]?.findLast(
          (event) => event.payload.type === "turn.failed",
        )
      : undefined;
  const reason =
    lastEvent?.payload.type === "turn.failed"
      ? lastEvent.payload.message
      : lastEvent?.payload.type === "approval.requested"
        ? lastEvent.payload.summary
        : lastEvent?.payload.type === "user-input.requested" &&
            "question" in lastEvent.payload
          ? lastEvent.payload.question
          : undefined;
  return (
    <section
      className="welcome-resume"
      aria-label={uiText(locale, "WelcomeResume.title")}
    >
      <h2>{uiText(locale, "WelcomeResume.title")}</h2>
      <div className="welcome-resume-grid">
        {recent && (
          <button
            className="welcome-resume-card"
            onClick={() => onOpenThread(recent)}
            type="button"
          >
            <span className="welcome-resume-title">
              <ThreadStatusIndicator thread={recent} locale={locale} />
              <span>{recent.title}</span>
            </span>
            <span className="welcome-resume-meta" title={reason}>
              {statusText(locale, recent.status)}
              {reason ? ` · ${reason}` : ""}
            </span>
          </button>
        )}
        {changes && (
          <button
            className="welcome-resume-card"
            onClick={() =>
              onOpenReview(
                changes.unstagedCount || changes.untrackedCount
                  ? "unstaged"
                  : "staged",
              )
            }
            type="button"
          >
            <span className="welcome-resume-title">
              <ArtemisIcon name="review" width={16} height={16} />
              <span>{uiText(locale, "WelcomeResume.review")}</span>
            </span>
            <span className="welcome-resume-meta">
              {changes.additions > 0 && (
                <bdi className="diff-add">+{changes.additions}</bdi>
              )}{" "}
              {changes.deletions > 0 && (
                <bdi className="diff-remove">−{changes.deletions}</bdi>
              )}{" "}
              ·{" "}
              {uiText(locale, "WelcomeResume.files", {
                count: changes.changeCount,
              })}
            </span>
          </button>
        )}
        {automation && (
          <button
            className="welcome-resume-card"
            onClick={() => onOpenAutomation(automation.id)}
            type="button"
          >
            <span className="welcome-resume-title">
              <ArtemisIcon name="automation" width={16} height={16} />
              <span>{automation.name}</span>
            </span>
            <span className="welcome-resume-meta">
              {scheduleLabel(automation, locale)} ·{" "}
              {automation.enabled && automation.nextRunAt
                ? uiText(locale, "WelcomeResume.next", {
                    date: new Intl.DateTimeFormat(locale, {
                      month: "short",
                      day: "numeric",
                    }).format(new Date(automation.nextRunAt)),
                  })
                : uiText(locale, "GroupAuthorization.paused")}
            </span>
          </button>
        )}
      </div>
    </section>
  );
}
