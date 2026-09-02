import { useMemo } from "react";

import {
  WorkspaceEditorToolbar,
  WorkspaceSourceEditor,
} from "@artemis/ui/workspace";
import {
  filePresentation,
  tokenizeSourceLine,
  tokenizeWorkspaceFile,
  type SyntaxToken,
} from "./workspace-file-presentation.js";
import { handleWorkspaceEditorSaveShortcut } from "./workspace-editor-shortcut.js";

export const WORKSPACE_HIGHLIGHT_CHARACTER_LIMIT = 250_000;

interface WorkspaceFileEditorProps {
  ariaLabel: string;
  content: string;
  dirty: boolean;
  path: string;
  readOnly?: boolean;
  saveError: string | undefined;
  saveLabel: string;
  savedLabel: string;
  saveState: "idle" | "saving" | "saved";
  savingLabel: string;
  unsavedLabel: string;
  onChange(content: string): void;
  onSave(): void;
}

export function HighlightedCodeLine({
  content,
  path,
}: {
  content: string;
  path: string;
}) {
  const presentation = filePresentation(path);
  return tokenizeSourceLine(content, presentation.language).map(
    (token, index) => (
      <span className={`syntax-token ${token.kind}`} key={index}>
        {token.text}
      </span>
    ),
  );
}

export function workspaceHighlightTokensByLine(
  content: string,
  language: string,
  tokenize: typeof tokenizeWorkspaceFile = tokenizeWorkspaceFile,
): SyntaxToken[][] | undefined {
  if (content.length > WORKSPACE_HIGHLIGHT_CHARACTER_LIMIT) return undefined;
  const lines: SyntaxToken[][] = [[]];
  for (const token of tokenize(content, language)) {
    const parts = token.text.split("\n");
    parts.forEach((part, index) => {
      if (part) lines.at(-1)!.push({ kind: token.kind, text: part });
      if (index < parts.length - 1) lines.push([]);
    });
  }
  return lines;
}

export function WorkspaceFileEditor({
  ariaLabel,
  content,
  dirty,
  path,
  readOnly = false,
  saveError,
  saveLabel,
  savedLabel,
  saveState,
  savingLabel,
  unsavedLabel,
  onChange,
  onSave,
}: WorkspaceFileEditorProps) {
  const presentation = filePresentation(path);
  const highlightedLines = useMemo(
    () => workspaceHighlightTokensByLine(content, presentation.language),
    [content, presentation.language],
  );

  // exactOptionalPropertyTypes: forward saveError only when defined so the
  // shared toolbar's optional prop stays absent rather than explicitly
  // undefined.
  const errorProps = saveError === undefined ? {} : { saveError };

  const canSave = dirty && saveState !== "saving" && !readOnly;

  // The shared toolbar owns presentation only. Desktop retains the guarded
  // Meta/Ctrl+S chord because save and IME behavior are runtime concerns.
  return (
    <WorkspaceEditorToolbar
      dirty={dirty}
      onKeyDown={(event) =>
        handleWorkspaceEditorSaveShortcut(event, canSave, onSave)
      }
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
      <WorkspaceSourceEditor
        disabled={readOnly}
        highlight={
          highlightedLines
            ? highlightedLines.map((tokens, lineIndex) => (
                <span className="workspace-code-line" key={lineIndex}>
                  <span className="workspace-code-line-number">
                    {lineIndex + 1}
                  </span>
                  <span className="workspace-code-line-content">
                    {tokens.length
                      ? tokens.map((token, tokenIndex) => (
                          <span
                            className={`syntax-token ${token.kind}`}
                            key={`${lineIndex}-${tokenIndex}`}
                          >
                            {token.text}
                          </span>
                        ))
                      : " "}
                  </span>
                  {"\n"}
                </span>
              ))
            : undefined
        }
        label={ariaLabel}
        language={presentation.language}
        onChange={(event) => onChange(event.target.value)}
        readOnly={readOnly}
        spellCheck={false}
        value={content}
        wrap="off"
      />
    </WorkspaceEditorToolbar>
  );
}
