import { useMemo, useRef, type UIEvent } from "react";

import { WorkspaceEditorToolbar } from "./WorkspaceEditorToolbar.js";
import {
  filePresentation,
  tokenizeSourceLine,
  tokenizeWorkspaceFile,
  type SyntaxToken,
} from "./workspace-file-presentation.js";

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

function tokensByLine(content: string, language: string): SyntaxToken[][] {
  const lines: SyntaxToken[][] = [[]];
  for (const token of tokenizeWorkspaceFile(content, language)) {
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
  const highlight = useRef<HTMLPreElement>(null);
  const presentation = filePresentation(path);
  const highlightedLines = useMemo(
    () => tokensByLine(content, presentation.language),
    [content, presentation.language],
  );
  const highlightsEnabled = content.length <= 250_000;

  const syncScroll = (event: UIEvent<HTMLTextAreaElement>) => {
    if (!highlight.current) return;
    highlight.current.scrollLeft = event.currentTarget.scrollLeft;
    highlight.current.scrollTop = event.currentTarget.scrollTop;
  };

  // exactOptionalPropertyTypes: forward saveError only when defined so the
  // shared toolbar's optional prop stays absent rather than explicitly
  // undefined.
  const errorProps = saveError === undefined ? {} : { saveError };

  // The shared toolbar owns the save status, save error, and guarded
  // Meta/Ctrl+S chord; the plain file editor has no mode toggle, so the
  // optional prop stays absent and the group never renders.
  return (
    <WorkspaceEditorToolbar
      dirty={dirty}
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
      <div
        className={
          highlightsEnabled
            ? "workspace-code-editor"
            : "workspace-code-editor plain"
        }
        data-file-type={presentation.type}
        data-language={presentation.language}
      >
        {highlightsEnabled && (
          <pre
            aria-hidden="true"
            className="workspace-code-highlight"
            ref={highlight}
          >
            <code>
              {highlightedLines.map((tokens, lineIndex) => (
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
              ))}
            </code>
          </pre>
        )}
        <textarea
          aria-label={ariaLabel}
          className="workspace-file-editor"
          data-language={presentation.language}
          disabled={readOnly}
          onChange={(event) => onChange(event.target.value)}
          onScroll={syncScroll}
          spellCheck={false}
          value={content}
          wrap="off"
        />
      </div>
    </WorkspaceEditorToolbar>
  );
}
