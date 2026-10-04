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
  optionAccessory,
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
  optionAccessory?: ((index: number) => ReactNode) | undefined;
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
  const other = placeholder ?? uiText(locale, "DecisionCard.other");
  return (
    <>
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
                  !["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)
                )
                  return;
                event.preventDefault();
                event.stopPropagation();
                const next = moveUserInputOptionFocus(
                  index,
                  options.length,
                  event.key as "ArrowUp" | "ArrowDown" | "Home" | "End",
                );
                buttons.current[next]?.focus();
              }}
              ref={(button) => {
                buttons.current[index] = button;
                registerButton?.(index, button);
              }}
            >
              <span className="decision-option-number" aria-hidden="true">
                {index + 1}.
              </span>
              <span className="decision-option-copy">
                <strong>{option.label}</strong>
                {option.description && <small>{option.description}</small>}
              </span>
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
          ref={replyRef}
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
    </>
  );
}

export function DecisionResult({
  label,
  answer,
  children,
  approved = false,
}: {
  label: string;
  answer?: string | undefined;
  children: ReactNode;
  approved?: boolean;
}) {
  return (
    <details className={`decision-result${approved ? " approved" : ""}`}>
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
