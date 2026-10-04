import type { SavedPlan, AppLocale } from "@artemis/protocol";
import { MarkdownContent } from "./MarkdownContent.js";
import { uiText } from "../shared/ui-text.js";
import "./plan-confirmation.css";

export function PlanConfirmationCard({
  plan,
  locale,
}: {
  plan: SavedPlan;
  locale: AppLocale;
}) {
  return (
    <section
      className={`plan-confirmation ${plan.status}`}
      aria-label={uiText(locale, "Plan.card")}
      data-plan-id={plan.planId}
    >
      <header>
        <h3>{plan.title}</h3>
        <span>
          v{plan.revision} ·{" "}
          {uiText(
            locale,
            plan.status === "accepted"
              ? "Plan.accepted"
              : plan.status === "superseded"
                ? "Plan.superseded"
                : !plan.ready
                  ? "Plan.incomplete"
                  : !plan.actionable
                    ? "Plan.noAction"
                    : "Plan.waiting",
          )}
        </span>
      </header>
      <MarkdownContent text={plan.markdown} locale={locale} />
    </section>
  );
}
