// Render-only stub for D#76 PR6 task 3 (failing-tests-first).
// It satisfies the QueuedMessageEditor props contract with a controlled
// textarea plus Save/Cancel buttons so the interaction suite in
// test/queued-message-editor.test.tsx fails per missing behavior instead of
// import errors. Keyboard shortcuts, submit state (aria-busy/disabled), the
// error/retry region, and focus-return logic are intentionally absent; the
// real implementation lands in a later PR task.
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
  return (
    <div>
      <textarea
        aria-label={props.textareaLabel}
        value={props.value}
        onChange={(event) => props.onValueChange(event.target.value)}
      />
      <button type="button" onClick={() => void props.onSave()}>
        {props.saveLabel}
      </button>
      <button type="button" onClick={props.onCancel}>
        {props.cancelLabel}
      </button>
    </div>
  );
}
