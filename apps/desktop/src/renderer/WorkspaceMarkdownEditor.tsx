import { useCallback, useState, type KeyboardEvent } from "react";

import { MarkdownContent } from "./MarkdownContent.js";

interface WorkspaceMarkdownEditorProps {
  ariaLabel: string;
  content: string;
  dirty: boolean;
  path: string;
  richLabel: string;
  saveError: string | undefined;
  saveLabel: string;
  savedLabel: string;
  saveState: "idle" | "saving" | "saved";
  savingLabel: string;
  sourceLabel: string;
  threadId: string | undefined;
  unsavedLabel: string;
  onChange(content: string): void;
  onSave(): void;
}

export function WorkspaceMarkdownEditor({
  ariaLabel,
  content,
  dirty,
  path,
  richLabel,
  saveError,
  saveLabel,
  savedLabel,
  saveState,
  savingLabel,
  sourceLabel,
  threadId,
  unsavedLabel,
  onChange,
  onSave,
}: WorkspaceMarkdownEditorProps) {
  const [view, setView] = useState<"rich" | "source">("rich");
  const resolveImage = useCallback(
    async (href: string) => {
      if (!threadId) return undefined;
      const image = await window.artemis.readWorkspaceImage(
        threadId,
        path,
        href,
      );
      return `data:${image.mimeType};base64,${image.data}`;
    },
    [path, threadId],
  );

  const saveFromKeyboard = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      onSave();
    }
  };

  return (
    <div className="workspace-markdown-editor">
      <div className="workspace-file-viewer-path">
        <span title={path}>{path}</span>
        <span className="workspace-file-editor-actions">
          <span
            aria-label={ariaLabel}
            className="workspace-markdown-mode-toggle"
            role="group"
          >
            <button
              aria-pressed={view === "rich"}
              onClick={() => setView("rich")}
            >
              {richLabel}
            </button>
            <button
              aria-pressed={view === "source"}
              onClick={() => setView("source")}
            >
              {sourceLabel}
            </button>
          </span>
          <span
            className={
              dirty
                ? "workspace-file-save-state dirty"
                : "workspace-file-save-state"
            }
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
            disabled={!dirty || saveState === "saving"}
            onClick={onSave}
          >
            {saveLabel}
          </button>
        </span>
      </div>
      {saveError && (
        <div className="workspace-file-editor-error">{saveError}</div>
      )}
      {view === "rich" ? (
        <MarkdownContent
          className="markdown-reader-content workspace-file-markdown-preview"
          resolveImage={resolveImage}
          text={content}
        />
      ) : (
        <textarea
          aria-label={ariaLabel}
          className="markdown-reader-source"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={saveFromKeyboard}
          spellCheck={false}
          value={content}
        />
      )}
    </div>
  );
}
