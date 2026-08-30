import { useEffect, useRef, useState, type KeyboardEvent } from "react";

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
  const focusReturnTimerRef = useRef<number | null>(null);

  const canSubmit = value.trim() !== "" && !busy && !submitting;

  // A draft change invalidates any previous save failure (section 8 h).
  useEffect(() => {
    setError(false);
  }, [value]);

  // Never run the delayed focus return after the editor unmounts (review nit).
  useEffect(() => {
    return () => {
      if (focusReturnTimerRef.current !== null) {
        window.clearTimeout(focusReturnTimerRef.current);
      }
    };
  }, []);

  // Shared delayed focus return for the save-success and Esc-cancel paths.
  const scheduleFocusReturn = () => {
    if (focusReturnTimerRef.current !== null) {
      window.clearTimeout(focusReturnTimerRef.current);
    }
    focusReturnTimerRef.current = window.setTimeout(() => {
      focusReturnTimerRef.current = null;
      props.focusReturnTarget()?.focus();
    }, 0);
  };

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
      scheduleFocusReturn();
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
      if (!busy && !submitting) {
        props.onCancel();
        scheduleFocusReturn();
      }
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
      <div className="queued-message-editor-actions">
        <button
          disabled={!canSubmit}
          onClick={() => void submit()}
          type="button"
        >
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
    </div>
  );
}
