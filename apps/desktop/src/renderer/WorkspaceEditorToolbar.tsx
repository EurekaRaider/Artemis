import type { KeyboardEvent, ReactNode } from "react";

export type WorkspaceEditorSaveState = "idle" | "saving" | "saved";

export type WorkspaceEditorView = "rich" | "source";

export interface WorkspaceEditorModeToggle {
  ariaLabel: string;
  onChange(view: WorkspaceEditorView): void;
  richLabel: string;
  sourceLabel: string;
  value: WorkspaceEditorView;
}

export interface WorkspaceEditorToolbarProps {
  children?: ReactNode;
  dirty: boolean;
  modeToggle?: WorkspaceEditorModeToggle;
  path: string;
  readOnly: boolean;
  saveError?: string;
  saveErrorDetail?: string;
  saveLabel: string;
  savedLabel: string;
  saveState: WorkspaceEditorSaveState;
  savingLabel: string;
  unsavedLabel: string;
  onSave(): void;
}

// D#76 PR7: shared toolbar chrome for workspace file editors. The toolbar owns
// the save status live region, the save error alert, the guarded Meta/Ctrl+S
// chord (handled here at the root so slot children only render editing
// surfaces), and the optional rich/source mode toggle.
export function WorkspaceEditorToolbar(
  props: WorkspaceEditorToolbarProps,
): ReactNode {
  const {
    children,
    dirty,
    modeToggle,
    path,
    readOnly,
    saveError,
    saveErrorDetail,
    saveLabel,
    savedLabel,
    saveState,
    savingLabel,
    unsavedLabel,
    onSave,
  } = props;

  const canSave = dirty && saveState !== "saving" && !readOnly;

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // IME composition must never trigger shortcuts (house pattern).
    if (event.nativeEvent.isComposing) return;
    if (event.key.toLowerCase() !== "s" || !(event.metaKey || event.ctrlKey))
      return;
    // The matched chord always claims the browser's native save dialog (v17
    // parity); the save itself only fires while the draft is submittable.
    event.preventDefault();
    if (canSave) onSave();
  };

  return (
    <div className="workspace-editor-toolbar" onKeyDown={handleKeyDown}>
      <div className="workspace-file-viewer-path">
        <span title={path}>{path}</span>
        <span className="workspace-file-editor-actions">
          {modeToggle ? (
            <span
              aria-label={modeToggle.ariaLabel}
              className="workspace-editor-mode-toggle"
              role="group"
            >
              <button
                aria-pressed={modeToggle.value === "rich"}
                disabled={readOnly}
                onClick={() => modeToggle.onChange("rich")}
                type="button"
              >
                {modeToggle.richLabel}
              </button>
              <button
                aria-pressed={modeToggle.value === "source"}
                disabled={readOnly}
                onClick={() => modeToggle.onChange("source")}
                type="button"
              >
                {modeToggle.sourceLabel}
              </button>
            </span>
          ) : null}
          <span
            aria-live="polite"
            className={
              dirty
                ? "workspace-file-save-state dirty"
                : "workspace-file-save-state"
            }
            role="status"
          >
            {saveState === "saving"
              ? savingLabel
              : dirty
                ? unsavedLabel
                : saveState === "saved"
                  ? savedLabel
                  : ""}
          </span>
          <button
            className="workspace-file-save"
            disabled={!canSave}
            onClick={onSave}
            type="button"
          >
            {saveLabel}
          </button>
        </span>
      </div>
      {saveError ? (
        <div className="workspace-file-editor-error" role="alert">
          {saveError}
          {saveErrorDetail ? (
            <small className="workspace-file-editor-error-detail">
              {saveErrorDetail}
            </small>
          ) : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}
