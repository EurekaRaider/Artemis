import { useMemo, useState, type ComponentProps } from "react";
import type { AppLocale } from "@artemis/protocol";
import {
  WorkspaceEditorToolbar,
  WorkspaceSourceEditor,
} from "@artemis/ui/workspace";
import type { WorkspaceFileEditor } from "./WorkspaceFileEditor.js";
import { handleWorkspaceEditorSaveShortcut } from "./workspace-editor-shortcut.js";
import {
  CSV_PREVIEW_COLUMNS,
  CSV_PREVIEW_ROWS,
  parseWorkspaceCsv,
  replaceWorkspaceCsvCell,
} from "./workspace-csv.js";
import "./workspace-csv.css";

export function WorkspaceCsvEditor({
  content,
  ariaLabel,
  locale,
  onChange,
  previewLabel,
  sourceLabel,
  saveError,
  ...toolbar
}: ComponentProps<typeof WorkspaceFileEditor> & {
  locale: AppLocale;
  previewLabel: string;
  sourceLabel: string;
}) {
  const [view, setView] = useState<"rich" | "source">("rich");
  const [cell, setCell] = useState<string>();
  const preview = useMemo(
    () => (view === "rich" ? parseWorkspaceCsv(content) : undefined),
    [content, view],
  );
  const columns =
    preview?.rows.reduce((max, row) => Math.max(max, row.length), 0) ?? 0;
  const zh = locale.startsWith("zh");
  return (
    <WorkspaceEditorToolbar
      {...toolbar}
      readOnly={toolbar.readOnly ?? false}
      {...(saveError === undefined ? {} : { saveError })}
      modeToggle={{
        ariaLabel,
        value: view,
        onChange: (next) => setView(next === "rich" ? "rich" : "source"),
        richLabel: previewLabel,
        sourceLabel,
      }}
      onKeyDown={(event) =>
        handleWorkspaceEditorSaveShortcut(
          event,
          toolbar.dirty && toolbar.saveState !== "saving" && !toolbar.readOnly,
          toolbar.onSave,
        )
      }
    >
      {preview ? (
        <div
          className="workspace-csv-preview"
          role="region"
          aria-label={previewLabel}
          tabIndex={0}
        >
          {preview.invalid && (
            <p role="status">
              {zh
                ? "CSV 引号格式不完整，请在源码中检查。"
                : "CSV quotes are malformed. Check the source."}
            </p>
          )}
          {preview.truncated && (
            <p role="status">
              {zh
                ? `预览最多显示 ${CSV_PREVIEW_ROWS} 行、${CSV_PREVIEW_COLUMNS} 列；源码保留全部内容。`
                : `Preview limited to ${CSV_PREVIEW_ROWS} rows and ${CSV_PREVIEW_COLUMNS} columns. The source keeps all content.`}
            </p>
          )}
          <table aria-label={toolbar.path}>
            <thead>
              <tr>
                <th aria-label="#" />
                {Array.from({ length: columns }, (_, column) => (
                  <th scope="col" key={column}>
                    {column + 1}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((row, index) => (
                <tr key={index}>
                  <th scope="row">{index + 1}</th>
                  {Array.from({ length: columns }, (_, column) => (
                    <td
                      key={column}
                      tabIndex={toolbar.readOnly ? undefined : 0}
                      onDoubleClick={() => {
                        if (!toolbar.readOnly && !preview.invalid)
                          setCell(`${index}:${column}`);
                      }}
                      onKeyDown={(event) => {
                        if (
                          event.target === event.currentTarget &&
                          (event.key === "Enter" || event.key === "F2") &&
                          !toolbar.readOnly &&
                          !preview.invalid
                        ) {
                          event.preventDefault();
                          setCell(`${index}:${column}`);
                        }
                      }}
                    >
                      {cell === `${index}:${column}` ? (
                        <textarea
                          autoFocus
                          aria-label={`${index + 1}:${column + 1}`}
                          value={row[column] ?? ""}
                          onChange={(event) =>
                            onChange(
                              replaceWorkspaceCsvCell(
                                content,
                                index,
                                column,
                                event.target.value,
                              ),
                            )
                          }
                          onBlur={() => setCell(undefined)}
                          onKeyDown={(event) => {
                            if (
                              !event.nativeEvent.isComposing &&
                              (event.key === "Escape" ||
                                (event.key === "Enter" && !event.shiftKey))
                            ) {
                              event.preventDefault();
                              setCell(undefined);
                              event.currentTarget.parentElement?.focus();
                            }
                          }}
                        />
                      ) : (
                        (row[column] ?? "")
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <WorkspaceSourceEditor
          label={ariaLabel}
          language="text"
          value={content}
          readOnly={toolbar.readOnly}
          onChange={(event) => onChange(event.target.value)}
          spellCheck={false}
          wrap="off"
        />
      )}
    </WorkspaceEditorToolbar>
  );
}
