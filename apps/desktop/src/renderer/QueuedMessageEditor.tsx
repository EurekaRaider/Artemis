import { useEffect, useState, type KeyboardEvent } from "react";

export interface QueuedMessageEditorProps {
  busy: boolean; // Parent-level busy flag.
  cancelLabel: string;
  errorLabel: string; // Save-failure message text.
  retryLabel: string;
  saveLabel: string;
  textareaLabel: string;
  value: string;
  focusReturnTarget: () => HTMLElement | null; // Delayed focus target after success.
  onCancel: () => void;
  onSave: () => Promise<boolean>; // true = saved, false = failed (throws count as false).
  onSuccess: () => void; // Success callback (parent clears the editing state).
  onValueChange: (value: string) => void;
}

export function QueuedMessageEditor(props: QueuedMessageEditorProps) {
  const { busy, value } = props;
  const [error, setError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = value.trim() !== "" && !busy && !submitting;

  // A draft change invalidates any previous save failure (section 8 h).
  useEffect(() => {
    setError(false);
  }, [value]);

  const submit = async () => {
    if (!canSubmit) return;
    setError(false);
    setSubmitting(true);
    let saved = false;
    try {
      saved = await props.onSave();
    } catch {
      saved = false;
    }
    setSubmitting(false);
    if (saved) {
      props.onSuccess();
      window.setTimeout(() => {
        props.focusReturnTarget()?.focus();
      }, 0);
    } else {
      setError(true);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // IME composition must never trigger shortcuts (house pattern, see
    // GoalEditorPanel's keydown guard).
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.stopPropagation();
      if (canSubmit) void submit();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (!busy && !submitting) props.onCancel();
    }
  };

  return (
    <div aria-busy={submitting || undefined} className="queued-message-editor">
      <textarea
        aria-label={props.textareaLabel}
        onChange={(event) => props.onValueChange(event.target.value)}
        onKeyDown={handleKeyDown}
        value={props.value}
      />
      {error && (
        <p className="queued-message-editor-error" role="alert">
          {props.errorLabel}{" "}
          <button
            disabled={!canSubmit}
            onClick={() => void submit()}
            type="button"
          >
            {props.retryLabel}
          </button>
        </p>
      )}
      <button disabled={!canSubmit} onClick={() => void submit()} type="button">
        {props.saveLabel}
      </button>
      <button
        disabled={busy || submitting}
        onClick={props.onCancel}
        type="button"
      >
        {props.cancelLabel}
      </button>
    </div>
  );
}
