import { useMemo, useRef, type KeyboardEvent, type UIEvent } from "react";

import {
  filePresentation,
  tokenizeSourceLine,
  tokenizeWorkspaceFile,
  type SyntaxToken,
} from "./workspace-file-presentation.js";

interface WorkspaceFileEditorProps {
  ariaLabel: string;
  content: string;
  disabled?: boolean;
  path: string;
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
  disabled,
  path,
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

  const saveFromKeyboard = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      onSave();
    }
  };

  return (
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
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={saveFromKeyboard}
        onScroll={syncScroll}
        spellCheck={false}
        value={content}
        wrap="off"
      />
    </div>
  );
}
