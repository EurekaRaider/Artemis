import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ArtifactSelection, ArtifactSnapshot } from "@artemis/protocol";
import type { OfficeEditorState } from "./office-editor-state.js";
import {
  cellAddress,
  cellRange,
  cellRangeBounds,
  type OfficeCell,
} from "./office-preview-selection.js";

// The native snapshot exposes values in this bounded selection index. The PDF
// remains the source of truth for formatting, charts and the full print area.
const ROWS = 50;
const COLUMNS = 26;

export function OfficeSpreadsheet({
  targets,
  sheet,
  selection,
  label,
  onSelect,
  editor,
}: {
  targets: ArtifactSnapshot["targets"];
  sheet: string;
  selection: ArtifactSelection | undefined;
  label: string;
  onSelect(range: string): void;
  editor?: OfficeEditorState;
}) {
  const id = useId();
  const table = useRef<HTMLTableElement>(null);
  const anchor = useRef<OfficeCell>({ row: 1, column: 1 });
  const [cursor, setCursor] = useState<OfficeCell>({ row: 1, column: 1 });
  const [drag, setDrag] = useState<{ start: OfficeCell; end: OfficeCell }>();
  const [editing, setEditing] = useState<string>();
  const cells = useMemo(() => {
    const values = new Map<string, ArtifactSnapshot["targets"][number]>();
    for (const target of targets) {
      if (
        target.selection.kind === "cells" &&
        target.selection.sheet === sheet
      ) {
        values.set(target.selection.range.replaceAll("$", ""), target);
      }
    }
    return values;
  }, [targets, sheet]);
  const range = drag
    ? cellRange(drag.start, drag.end)
    : selection?.kind === "cells" && selection.sheet === sheet
      ? selection.range
      : "";
  const bounds = cellRangeBounds(range);
  useEffect(() => {
    if (selection?.kind !== "cells" || selection.sheet !== sheet) return;
    const selected = cellRangeBounds(selection.range);
    if (!selected) return;
    table.current
      ?.querySelector(
        `[data-row="${selected.top}"][data-column="${selected.left}"]`,
      )
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selection, sheet]);

  const hitCell = (element: Element | null): OfficeCell | undefined => {
    const cell = element?.closest<HTMLTableCellElement>("td[data-cell]");
    return cell && table.current?.contains(cell)
      ? { row: Number(cell.dataset.row), column: Number(cell.dataset.column) }
      : undefined;
  };
  const targetFor = (address: string): ArtifactSnapshot["targets"][number] =>
    cells.get(address) ?? {
      selection: { kind: "cells", sheet, range: address },
      text: "",
    };
  const currentAddress = cellAddress(cursor);
  const currentTarget = targetFor(currentAddress);

  return (
    <>
      <table
        ref={table}
        className="office-sheet-grid"
        role="grid"
        aria-label={`${sheet} · ${label}`}
        aria-readonly={!editor}
        aria-multiselectable="true"
        aria-activedescendant={`${id}-${cellAddress(cursor)}`}
        tabIndex={0}
        onKeyDown={(event) => {
          if ((event.target as HTMLElement).closest("input")) return;
          if (
            editor &&
            currentTarget.editable !== false &&
            (event.key === "F2" ||
              event.key === "Enter" ||
              (event.key.length === 1 &&
                !event.metaKey &&
                !event.ctrlKey &&
                !event.altKey))
          ) {
            event.preventDefault();
            setEditing(currentAddress);
            if (event.key.length === 1)
              editor.setText(currentTarget, event.key);
            return;
          }
          const next = { ...cursor };
          if (event.key === "ArrowDown")
            next.row = Math.min(ROWS, next.row + 1);
          else if (event.key === "ArrowUp")
            next.row = Math.max(1, next.row - 1);
          else if (event.key === "ArrowRight")
            next.column = Math.min(COLUMNS, next.column + 1);
          else if (event.key === "ArrowLeft")
            next.column = Math.max(1, next.column - 1);
          else if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          if (!event.shiftKey) anchor.current = next;
          setCursor(next);
          onSelect(cellRange(anchor.current, next));
          window.document
            .getElementById(`${id}-${cellAddress(next)}`)
            ?.scrollIntoView({ block: "nearest", inline: "nearest" });
        }}
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest("input")) return;
          if (event.button !== 0) return;
          const cell = hitCell(event.target as Element);
          if (!cell) return;
          event.preventDefault();
          table.current?.focus({ preventScroll: true });
          if (!event.shiftKey) anchor.current = cell;
          setCursor(cell);
          setDrag({ start: anchor.current, end: cell });
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!drag) return;
          const cell = hitCell(
            window.document.elementFromPoint(event.clientX, event.clientY),
          );
          if (cell) setDrag({ start: drag.start, end: cell });
        }}
        onPointerUp={(event) => {
          if (!drag) return;
          setCursor(drag.end);
          onSelect(cellRange(drag.start, drag.end));
          setDrag(undefined);
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => setDrag(undefined)}
        onLostPointerCapture={() => setDrag(undefined)}
        onPaste={(event) => {
          if (!editor || (event.target as HTMLElement).closest("input")) return;
          event.preventDefault();
          const rows = event.clipboardData
            .getData("text/plain")
            .replace(/\r\n/gu, "\n")
            .replace(/\n$/u, "")
            .split("\n")
            .map((row) => row.split("\t"));
          if (
            cursor.row + rows.length - 1 > ROWS ||
            rows.some((row) => cursor.column + row.length - 1 > COLUMNS)
          )
            return;
          const changes = rows.flatMap((row, ri) =>
            row.map((text, ci) => ({
              target: targetFor(
                cellAddress({
                  row: cursor.row + ri,
                  column: cursor.column + ci,
                }),
              ),
              text,
            })),
          );
          if (changes.some((change) => change.target.editable === false))
            return;
          editor.setTexts(changes);
        }}
      >
        <thead>
          <tr>
            <th aria-label={label} />
            {Array.from({ length: COLUMNS }, (_, index) => (
              <th key={index} scope="col">
                {String.fromCharCode(65 + index)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: ROWS }, (_, rowIndex) => {
            const row = rowIndex + 1;
            return (
              <tr key={row}>
                <th scope="row">{row}</th>
                {Array.from({ length: COLUMNS }, (_, columnIndex) => {
                  const column = columnIndex + 1;
                  const address = cellAddress({ row, column });
                  const target = cells.get(address);
                  const selected =
                    !!bounds &&
                    row >= bounds.top &&
                    row <= bounds.bottom &&
                    column >= bounds.left &&
                    column <= bounds.right;
                  return (
                    <td
                      key={address}
                      id={`${id}-${address}`}
                      role="gridcell"
                      aria-label={`${address}${target?.text ? ` · ${target.text}` : ""}`}
                      aria-selected={selected}
                      data-cell={address}
                      data-row={row}
                      data-column={column}
                      data-numeric={
                        target?.text &&
                        /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/iu.test(target.text)
                          ? "true"
                          : undefined
                      }
                      data-edge-top={
                        (selected && row === bounds?.top) || undefined
                      }
                      data-edge-bottom={
                        (selected && row === bounds?.bottom) || undefined
                      }
                      data-edge-left={
                        (selected && column === bounds?.left) || undefined
                      }
                      data-edge-right={
                        (selected && column === bounds?.right) || undefined
                      }
                      title={
                        target?.formula
                          ? `${address} · ${target.formula}\n${target.text}`
                          : target?.text
                      }
                      onDoubleClick={() => {
                        if (editor && target?.editable !== false)
                          setEditing(address);
                      }}
                    >
                      {editor && editing === address ? (
                        <input
                          autoFocus
                          aria-label={address}
                          value={editor.value(targetFor(address))}
                          onChange={(event) =>
                            editor.setText(
                              targetFor(address),
                              event.target.value,
                            )
                          }
                          onBlur={() => setEditing(undefined)}
                          onCompositionStart={() => {
                            editor.setComposing(true);
                          }}
                          onCompositionEnd={(event) => {
                            editor.setComposing(false);
                            editor.setText(
                              targetFor(address),
                              event.currentTarget.value,
                            );
                          }}
                          onKeyDown={(event) => {
                            if (
                              !event.nativeEvent.isComposing &&
                              (event.key === "Enter" || event.key === "Escape")
                            ) {
                              event.preventDefault();
                              setEditing(undefined);
                              table.current?.focus();
                            }
                          }}
                        />
                      ) : editor ? (
                        (editor.drafts.get(
                          JSON.stringify({
                            kind: "cells",
                            sheet,
                            range: address,
                          }),
                        )?.text ??
                        target?.text ??
                        "")
                      ) : (
                        (target?.text ?? "")
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
