import type { ComponentProps } from "react";
import type {
  AppLocale,
  ApprovalState,
  ThreadViewState,
  UserInputResolution,
  SavedPlan,
} from "@artemis/protocol";
import { ComposerSurface } from "@artemis/ui/surfaces";
import { UI_COPY } from "../shared/ui-copy.js";
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

type ComposerDecision =
  | { entry: string; kind: "plan"; plan: SavedPlan }
  | {
      entry: string;
      kind: "input";
      input: ThreadViewState["userInputs"][string];
    }
  | {
      entry: string;
      kind: "approval";
      approval: ApprovalState;
      actorName: string | undefined;
    };

/** Share one composer slot across approvals, questions and completed plans. */
export function firstPendingComposerDecision(
  state: ThreadViewState | undefined,
): ComposerDecision | undefined {
  if (!state) return undefined;
  for (const entry of state.order) {
    if (entry.startsWith("input:")) {
      const input = state.userInputs[entry.slice("input:".length)];
      if (input?.status === "pending") return { entry, kind: "input", input };
    }
    if (entry.startsWith("approval:")) {
      const approval = state.approvals[entry.slice("approval:".length)];
      if (approval?.status === "pending") {
        return {
          entry,
          kind: "approval",
          approval,
          actorName: approval.actorAgentId
            ? (state.childAgents[approval.actorAgentId]?.label ??
              approval.actorAgentId)
            : undefined,
        };
      }
    }
  }
  const plan = state.plans?.at(-1);
  if (state.status === "idle" && plan?.status === "proposed" && plan.ready) {
    return {
      entry: `plan:${plan.planId}:${plan.revision}`,
      kind: "plan",
      plan,
    };
  }
  return undefined;
}

export function DecisionComposer({
  decision,
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
  locale: AppLocale;
  onResolveApproval: ResolveApprovalDecision;
  onResolveUserInput: (resolution: UserInputResolution) => Promise<void>;
  onAcceptPlan?:
    ((plan: SavedPlan, mode: "work" | "codemode") => Promise<void>) | undefined;
  onRevisePlan?: ((text: string) => Promise<void>) | undefined;
}) {
  return (
    <ComposerSurface
      {...props}
      className={`${className ?? ""}${decision ? " composer-awaiting-decision" : ""}`}
      context={decision ? undefined : context}
      onDragEnter={decision ? undefined : props.onDragEnter}
      onDragLeave={decision ? undefined : props.onDragLeave}
      onDragOver={decision ? undefined : props.onDragOver}
      onDrop={decision ? undefined : props.onDrop}
    >
      {decision ? (
        <>
          <div className="composer-decision" key={decision.entry}>
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
          {context ? <div data-part="context">{context}</div> : null}
        </>
      ) : (
        children
      )}
    </ComposerSurface>
  );
}
