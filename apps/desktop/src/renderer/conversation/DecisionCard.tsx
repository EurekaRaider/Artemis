import { Keycap } from "@artemis/ui/actions";
import { useRef, useState, type ReactNode, type Ref } from "react";
import type { AppLocale, UserInputOption } from "@artemis/protocol";
import { ArtemisIcon } from "@artemis/ui/icons";
import { uiText } from "../../shared/i18n/ui-text.js";
import { moveUserInputOptionFocus } from "./user-input-navigation.js";
import "./decision-card.css";

/** Shared direct-choice list and inline reply row for approval and questions. */
export function DecisionOptions({
  options,
  locale,
  busy,
  onChoose,
  onReply,
  onSkip,
  placeholder,
  registerButton,
  replyRef,
  replyMaxLength = 2000,
  replyIsLastOption = false,
  optionAccessory,
  numbered = true,
}: {
  options: readonly Pick<
    UserInputOption,
    "label" | "description" | "recommended"
  >[];
  locale: AppLocale;
  busy: boolean;
  onChoose: (index: number) => void;
  onReply: (text: string) => void;
  onSkip?: (() => void) | undefined;
  placeholder?: string;
  replyRef?: Ref<HTMLInputElement> | undefined;
  replyMaxLength?: number | undefined;
  replyIsLastOption?: boolean;
  optionAccessory?: ((index: number) => ReactNode) | undefined;
  numbered?: boolean;
  registerButton?: (index: number, button: HTMLButtonElement | null) => void;
}) {
  const [focused, setFocused] = useState(
    Math.max(
      0,
      options.findIndex((o) => o.recommended),
    ),
  );
  const [draft, setDraft] = useState("");
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const composing = useRef(false);
  const replyInput = useRef<HTMLInputElement>(null);
  const other = placeholder ?? uiText(locale, "DecisionCard.other");
  return (
    <div className="decision-option-area">
      <div className="decision-options" role="group">
        {options.map((option, index) => {
          const button = (
            <button
              type="button"
              className="user-input-option decision-option"
              key={option.label}
              title={option.label}
              disabled={busy}
              tabIndex={focused === index ? 0 : -1}
              onFocus={() => setFocused(index)}
              onClick={() => onChoose(index)}
              onKeyDown={(event) => {
                if (
                  replyIsLastOption &&
                  event.key === String(options.length + 1)
                ) {
                  event.preventDefault();
                  event.stopPropagation();
                  replyInput.current?.focus();
                  return;
                }
                if (
                  /^[1-9]$/.test(event.key) &&
                  Number(event.key) <= options.length
                ) {
                  event.preventDefault();
                  event.stopPropagation();
                  onChoose(Number(event.key) - 1);
                  return;
                }
                if (
                  !["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)
                )
                  return;
                event.preventDefault();
                event.stopPropagation();
                const next = moveUserInputOptionFocus(
                  index,
                  options.length + (replyIsLastOption ? 1 : 0),
                  event.key as "ArrowUp" | "ArrowDown" | "Home" | "End",
                );
                if (next === options.length) replyInput.current?.focus();
                else buttons.current[next]?.focus();
              }}
              ref={(button) => {
                buttons.current[index] = button;
                registerButton?.(index, button);
              }}
            >
              <span
                className={
                  numbered
                    ? "decision-option-number"
                    : "decision-option-indicator"
                }
                aria-hidden="true"
              >
                {numbered ? index + 1 : null}
              </span>
              <span className="decision-option-copy">
                <strong>{option.label}</strong>
                {option.description && <small>{option.description}</small>}
              </span>
              {option.recommended && numbered && (
                <span className="decision-recommended">
                  {uiText(locale, "WorkRecord.recommended")}
                </span>
              )}
              {!numbered && (
                <Keycap className="decision-option-number">{index + 1}</Keycap>
              )}
            </button>
          );
          return optionAccessory ? (
            <div className="decision-option-row" key={option.label}>
              {button}
              {optionAccessory(index)}
            </div>
          ) : (
            button
          );
        })}
      </div>
      <form
        className="decision-reply"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && !composing.current && draft.trim())
            onReply(draft.trim());
        }}
      >
        <input
          ref={(input) => {
            replyInput.current = input;
            if (typeof replyRef === "function") replyRef(input);
            else if (replyRef) replyRef.current = input;
          }}
          aria-label={other}
          placeholder={other}
          value={draft}
          maxLength={replyMaxLength}
          disabled={busy}
          onChange={(event) => setDraft(event.target.value)}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              (event.nativeEvent.isComposing || composing.current)
            )
              event.preventDefault();
          }}
        />
        {onSkip && (
          <button
            className="decision-skip"
            type="button"
            disabled={busy}
            onClick={onSkip}
          >
            {uiText(locale, "DecisionCard.skip")}
          </button>
        )}
        <button
          className="decision-submit"
          type="submit"
          disabled={busy || !draft.trim()}
        >
          {uiText(locale, "DecisionCard.submit")}
        </button>
      </form>
      <small className="decision-keyboard-hint">
        {uiText(locale, "ComposerMode.decisionHint")}
      </small>
    </div>
  );
}

export function DecisionResult({
  label,
  answer,
  children,
  approved = false,
  className,
  state,
}: {
  label: string;
  answer?: string | undefined;
  children: ReactNode;
  approved?: boolean;
  className?: string;
  state?: string;
}) {
  return (
    <details
      className={`decision-result${approved ? " approved" : ""}${className ? ` ${className}` : ""}`}
      data-state={state}
    >
      <summary>
        <ArtemisIcon
          name={approved ? "check" : "message"}
          width={16}
          height={16}
        />
        <strong>{label}</strong>
        <span className="decision-result-answer">{answer}</span>
        <ArtemisIcon
          className="decision-chevron"
          name="chevron"
          width={16}
          height={16}
        />
      </summary>
      <div className="decision-result-detail">{children}</div>
    </details>
  );
}
