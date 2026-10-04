import { useId, useRef, useState } from "react";
import type { AppLocale, SavedPlan } from "@artemis/protocol";
import { Popover } from "@artemis/ui/feedback";
import { UserInputFrame } from "@artemis/ui/patterns";
import { uiText } from "../../shared/i18n/ui-text.js";
import { DecisionOptions } from "./DecisionCard.js";
import "./plan-confirmation.css";

/** Plan acceptance shares the composer presentation, never the timed question protocol. */
export function PlanDecisionCard({
  plan,
  locale,
  onAccept,
  onRevise,
}: {
  plan: SavedPlan;
  locale: AppLocale;
  onAccept?:
    ((plan: SavedPlan, mode: "work" | "codemode") => Promise<void>) | undefined;
  onRevise?: ((text: string) => Promise<void>) | undefined;
}) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [optionsOpen, setOptionsOpen] = useState(false);
  const reply = useRef<HTMLInputElement>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  const optionsId = useId();
  const available = plan.ready && plan.status === "proposed";
  const run = async (action: () => Promise<void>) => {
    if (!available || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setOptionsOpen(false);
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const accept = (mode: "work" | "codemode") => {
    if (plan.actionable && onAccept) void run(() => onAccept(plan, mode));
  };
  const options = [
    ...(plan.actionable
      ? [
          {
            label: uiText(locale, "Plan.execute"),
            description: uiText(locale, "App_copy.work"),
            recommended: true,
          },
        ]
      : []),
    {
      label: uiText(locale, "Plan.revise"),
      description: "",
      recommended: false,
    },
  ];
  return (
    <UserInputFrame
      className="decision-card user-input-card plan-decision"
      label={uiText(locale, "Plan.card")}
      state={busy ? "busy" : "pending"}
    >
      <header>
        <strong>{plan.title}</strong>
        <span className="decision-waiting">
          v{plan.revision} ·{" "}
          {uiText(locale, plan.actionable ? "Plan.waiting" : "Plan.noAction")}
        </span>
      </header>
      <DecisionOptions
        options={options}
        locale={locale}
        busy={busy || !available || !onRevise || (plan.actionable && !onAccept)}
        placeholder={uiText(locale, "Plan.revise")}
        replyRef={reply}
        replyMaxLength={100_000}
        onChoose={(index) => {
          if (plan.actionable && index === 0) accept("work");
          else reply.current?.focus();
        }}
        onReply={(text) => {
          if (onRevise) void run(() => onRevise(text));
        }}
        optionAccessory={(index) =>
          plan.actionable && index === 0 ? (
            <button
              ref={anchor}
              className="plan-execution-options"
              type="button"
              aria-label={uiText(locale, "Plan.executionOptions")}
              aria-haspopup="menu"
              aria-expanded={optionsOpen}
              aria-controls={optionsId}
              disabled={!available || busy || !onAccept}
              onClick={() => setOptionsOpen(!optionsOpen)}
            >
              ▾
            </button>
          ) : null
        }
      />
      <Popover
        anchorRef={anchor}
        open={optionsOpen && available && !busy}
        onOpenChange={setOptionsOpen}
        label={uiText(locale, "Plan.executionOptions")}
        role="menu"
        id={optionsId}
        className="plan-execution-menu"
      >
        <button
          type="button"
          role="menuitem"
          disabled={!available || busy || !onAccept}
          onClick={() => accept("codemode")}
        >
          {uiText(locale, "Plan.executeCodemode")}
        </button>
      </Popover>
      {error && (
        <p role="alert" className="decision-error">
          {error}
        </p>
      )}
    </UserInputFrame>
  );
}
