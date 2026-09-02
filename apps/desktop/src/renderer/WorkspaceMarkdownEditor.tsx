import { useCallback, useState } from "react";
import {
  WorkspaceEditorToolbar,
  WorkspacePreview,
  WorkspaceSourceEditor,
  type WorkspaceEditorView,
} from "@artemis/ui/workspace";

import { MarkdownContent } from "./MarkdownContent.js";

interface WorkspaceMarkdownEditorProps {
  ariaLabel: string;
  content: string;
  dirty: boolean;
  imageFailureText?: string;
  path: string;
  readOnly?: boolean;
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
  imageFailureText,
  path,
  readOnly = false,
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
  // The shared toolbar owns the mode toggle; map its controlled view onto the
  // local editing state one mode at a time.
  const changeView = (next: WorkspaceEditorView) => {
    if (next === "rich") setView("rich");
    else setView("source");
  };

  // exactOptionalPropertyTypes: forward saveError only when defined so the
  // shared toolbar's optional prop stays absent rather than explicitly
  // undefined.
  const errorProps = saveError === undefined ? {} : { saveError };
  // Same contract for the optional localized image-failure copy.
  const imageProps = imageFailureText === undefined ? {} : { imageFailureText };

  return (
    <WorkspaceEditorToolbar
      dirty={dirty}
      modeToggle={{
        ariaLabel,
        onChange: changeView,
        richLabel,
        sourceLabel,
        value: view,
      }}
      path={path}
      readOnly={readOnly}
      {...errorProps}
      saveLabel={saveLabel}
      savedLabel={savedLabel}
      saveState={saveState}
      savingLabel={savingLabel}
      unsavedLabel={unsavedLabel}
      onSave={onSave}
    >
      {view === "rich" ? (
        <WorkspacePreview label={ariaLabel} readOnly={readOnly}>
          <MarkdownContent
            {...imageProps}
            resolveImage={resolveImage}
            text={content}
          />
        </WorkspacePreview>
      ) : (
        <WorkspaceSourceEditor
          disabled={readOnly}
          label={ariaLabel}
          language="markdown"
          onChange={(event) => onChange(event.target.value)}
          readOnly={readOnly}
          spellCheck={false}
          value={content}
          variant="markdown"
        />
      )}
    </WorkspaceEditorToolbar>
  );
}
