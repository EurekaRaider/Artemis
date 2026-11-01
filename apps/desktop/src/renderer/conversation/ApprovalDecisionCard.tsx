import { ArtemisIcon } from "@artemis/ui/icons";
import { useRef, useState } from "react";
import type {
  AppLocale,
  ApprovalResolution,
  ApprovalState,
} from "@artemis/protocol";
import { uiText } from "../../shared/i18n/ui-text.js";
import { UI_COPY } from "../../shared/i18n/ui-copy.js";
import { approvalPatternView } from "./agent-pattern-adapters.js";
import { DecisionOptions, DecisionResult } from "./DecisionCard.js";

export type ResolveApprovalDecision = (
  approval: ApprovalState,
  approved: boolean,
  scope: "once" | "session" | "project",
  extra?: Pick<ApprovalResolution, "skipped" | "feedback">,
) => void | Promise<void>;
export function ApprovalDecisionCard({
  approval,
  actorLabel,
  locale,
  onResolve,
}: {
  approval: ApprovalState;
  actorLabel?: string;
  locale: AppLocale;
  onResolve: ResolveApprovalDecision;
}) {
  const t = UI_COPY.App_copy[locale];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const pending = useRef(false);
  const view = approvalPatternView(approval, actorLabel);
  const actions = [
    ...view.actions.filter((a) => a.approved),
    ...view.actions.filter((a) => !a.approved),
  ];
  const options = actions.map((a) => ({
    label:
      a.id === "deny"
        ? t.deny
        : a.id === "approve-once"
          ? t.approveOnce
          : a.id === "approve-session"
            ? t.approveSession
            : t.approveProject,
    description: a.scope === "project" ? t.approvalScopeHint : "",
    recommended: a.recommended,
  }));
  const resolve = async (
    approved: boolean,
    scope: "once" | "session" | "project",
    extra?: Pick<ApprovalResolution, "skipped" | "feedback">,
  ) => {
    if (pending.current || approval.status !== "pending") return;
    pending.current = true;
    setBusy(true);
    setError(false);
    try {
      await onResolve(approval, approved, scope, extra);
    } catch {
      pending.current = false;
      setBusy(false);
      setError(true);
    }
  };
  if (approval.status !== "pending") {
    const label = approval.skipped
      ? uiText(locale, "DecisionCard.skipped")
      : approval.feedback
        ? uiText(locale, "DecisionCard.feedbackSent")
        : approval.status === "denied"
          ? t.approvalDenied
          : approval.scope
            ? uiText(
                locale,
                approval.scope === "project"
                  ? "DecisionCard.allowedProject"
                  : approval.scope === "session"
                    ? "DecisionCard.allowedSession"
                    : "DecisionCard.allowedOnce",
              )
            : t.approvalApproved;
    return (
      <DecisionResult
        label={label}
        answer={approval.feedback ?? view.detail}
        approved={approval.status === "approved"}
      >
        <strong>
          <bdi>{approval.summary}</bdi>
        </strong>
        <pre>
          <bdi>{view.detail}</bdi>
        </pre>
        {actorLabel && <p>{actorLabel}</p>}
        {approval.modelReason && (
          <p>
            <bdi>{approval.modelReason}</bdi>
          </p>
        )}
        {approval.feedback && (
          <p>
            <bdi>{approval.feedback}</bdi>
          </p>
        )}
      </DecisionResult>
    );
  }
  return (
    <article
      className="decision-card approval-decision"
      aria-label={approval.summary}
      aria-busy={busy}
    >
      <header>
        <strong>{uiText(locale, "Review02.decisionApproval")}</strong>
        <span className="decision-waiting">{t.waiting}</span>
      </header>
      <h3 className="decision-title">
        <bdi>{approval.summary}</bdi>
      </h3>
      {view.detail && (
        <pre className="decision-command">
          {approval.command && <span aria-hidden="true">$ </span>}
          <bdi>{view.detail}</bdi>
        </pre>
      )}
      {actorLabel && <small>{actorLabel}</small>}
      {view.reason && (
        <div className="decision-reason">
          <small>{uiText(locale, "Review03.agentReason")}</small>
          <p>
            <bdi>{view.reason}</bdi>
          </p>
        </div>
      )}
      <div className="decision-metadata">
        {approval.network.map((host) => (
          <span key={host}>
            <bdi>{host}</bdi>
          </span>
        ))}
        <span>
          <ArtemisIcon name="alert" width={12} height={12} />
          {uiText(locale, `Review02.risk.${approval.risk}`)}
        </span>
      </div>
      <DecisionOptions
        options={options}
        locale={locale}
        busy={busy}
        placeholder={uiText(locale, "DecisionCard.feedback")}
        onChoose={(index) => {
          const a = actions[index];
          if (a) void resolve(a.approved, a.scope);
        }}
        onReply={(feedback) => void resolve(false, "once", { feedback })}
        onSkip={() => void resolve(false, "once", { skipped: true })}
      />
      {error && (
        <p role="alert" className="decision-error">
          {uiText(locale, "DecisionCard.failed")}
        </p>
      )}
    </article>
  );
}
