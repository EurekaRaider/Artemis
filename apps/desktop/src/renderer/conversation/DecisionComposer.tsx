import { useEffect, useRef, type ComponentProps } from "react";
import { createPortal } from "react-dom";
import type {
  AppLocale,
  UserInputResolution,
  SavedPlan,
} from "@artemis/protocol";
import { ComposerSurface } from "@artemis/ui/surfaces";
import { UI_COPY } from "../../shared/i18n/ui-copy.js";
import {
  ApprovalDecisionCard,
  type ResolveApprovalDecision,
} from "./ApprovalDecisionCard.js";
import {
  isMultiQuestionUserInput,
  MultiQuestionUserInputCard,
} from "./MultiQuestionUserInputCard.js";
import { UserInputCard } from "./UserInputCard.js";
import { PlanDecisionCard } from "./PlanDecisionCard.js";

import {
  firstPendingComposerDecision,
  type ComposerDecision,
} from "./thread-presentation.js";
export { firstPendingComposerDecision } from "./thread-presentation.js";

export function DecisionComposer({
  decision,
  decisionTarget,
  children,
  context,
  className,
  locale,
  onResolveApproval,
  onResolveUserInput,
  onAcceptPlan,
  onRevisePlan,
  ...props
}: ComponentProps<typeof ComposerSurface> & {
  decision: ComposerDecision | undefined;
  decisionTarget?: HTMLElement | null;
  locale: AppLocale;
  onResolveApproval: ResolveApprovalDecision;
  onResolveUserInput: (resolution: UserInputResolution) => Promise<void>;
  onAcceptPlan?:
    ((plan: SavedPlan, mode: "work" | "codemode") => Promise<void>) | undefined;
  onRevisePlan?: ((text: string) => Promise<void>) | undefined;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    cardRef.current
      ?.querySelector<HTMLElement>(
        'button:not(:disabled)[tabindex="0"], button:not(:disabled), textarea:not(:disabled)',
      )
      ?.focus();
  }, [decision?.entry, decisionTarget]);
  const card = decision ? (
    <div className="composer-decision" key={decision.entry} ref={cardRef}>
      {decision.kind === "plan" ? (
        <PlanDecisionCard
          plan={decision.plan}
          locale={locale}
          onAccept={onAcceptPlan}
          onRevise={onRevisePlan}
        />
      ) : decision.kind === "approval" ? (
        <ApprovalDecisionCard
          approval={decision.approval}
          locale={locale}
          onResolve={onResolveApproval}
          {...(decision.actorName
            ? {
                actorLabel: `${UI_COPY.App_copy[locale].agentActor}: ${decision.actorName}`,
              }
            : {})}
        />
      ) : isMultiQuestionUserInput(decision.input) ? (
        <MultiQuestionUserInputCard
          active
          input={decision.input}
          locale={locale}
          onResolve={onResolveUserInput}
        />
      ) : (
        <UserInputCard
          active
          input={decision.input}
          locale={locale}
          onResolve={onResolveUserInput}
        />
      )}
    </div>
  ) : null;
  return (
    <>
      {card && decisionTarget ? createPortal(card, decisionTarget) : card}
      <ComposerSurface
        {...props}
        className={className}
        onDragEnter={decision ? undefined : props.onDragEnter}
        onDragLeave={decision ? undefined : props.onDragLeave}
        onDragOver={decision ? undefined : props.onDragOver}
        onDrop={decision ? undefined : props.onDrop}
      >
        {children}
      </ComposerSurface>
      {context ? (
        <div className="composer-context-surface" data-part="context">
          {context}
        </div>
      ) : null}
    </>
  );
}
