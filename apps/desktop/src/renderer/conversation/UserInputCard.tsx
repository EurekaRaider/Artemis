import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  AppLocale,
  UserInputResolution,
  UserInputState,
} from "@artemis/protocol";
import { UserInputFrame } from "@artemis/ui/patterns";
import { UI_COPY } from "../../shared/i18n/ui-copy.js";
import { uiText } from "../../shared/i18n/ui-text.js";
import { DecisionOptions, DecisionResult } from "./DecisionCard.js";
import { formatUserInputCountdown } from "./user-input-countdown.js";

export function UserInputCard({
  input,
  active,
  locale,
  onResolve,
}: {
  input: UserInputState;
  active: boolean;
  locale: AppLocale;
  onResolve: (resolution: UserInputResolution) => Promise<void>;
}) {
  const t = UI_COPY.App_copy[locale];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const pending = useRef(false);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    if (input.status !== "pending") return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [input.requestId, input.status]);
  useLayoutEffect(() => {
    if (active && input.status === "pending")
      buttons.current[
        Math.max(
          0,
          input.options.findIndex((o) => o.recommended),
        )
      ]?.focus({ preventScroll: true });
  }, [active, input.requestId, input.status]);
  if (input.status === "pending" && !active) return null;
  if (input.status !== "pending")
    return (
      <DecisionResult
        label={
          input.skipped
            ? uiText(locale, "DecisionCard.skipped")
            : input.status === "timed-out"
              ? t.timedOut
              : input.status === "cancelled"
                ? t.inputCancelled
                : t.answered
        }
        answer={input.answer}
      >
        <strong>{input.question}</strong>
        {input.answer && <p>{input.answer}</p>}
      </DecisionResult>
    );
  const resolve = async (
    choice: Pick<
      UserInputResolution,
      "selectedOption" | "customAnswer" | "skipped"
    >,
  ) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(false);
    try {
      await onResolve({
        requestId: input.requestId,
        nonce: input.nonce,
        ...choice,
      });
    } catch {
      pending.current = false;
      setBusy(false);
      setError(true);
    }
  };
  return (
    <UserInputFrame
      className="decision-card user-input-card"
      label={input.question}
      state={busy ? "busy" : input.status}
    >
      <header>
        <strong>{input.question}</strong>
        <span className="decision-waiting" title={t.timeoutHint}>
          {t.waitingSelection}{" "}
          <time dateTime={input.expiresAt}>
            {formatUserInputCountdown(Date.parse(input.expiresAt) - clock)}
          </time>
        </span>
      </header>
      <DecisionOptions
        key={input.requestId}
        options={input.options}
        locale={locale}
        busy={busy}
        registerButton={(i, b) => {
          buttons.current[i] = b;
        }}
        onChoose={(selectedOption) => void resolve({ selectedOption })}
        onReply={(customAnswer) => void resolve({ customAnswer })}
        onSkip={() => void resolve({ skipped: true })}
      />
      {error && (
        <p role="alert" className="decision-error">
          {uiText(locale, "DecisionCard.failed")}
        </p>
      )}
    </UserInputFrame>
  );
}
