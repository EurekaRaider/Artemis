export const CSV_PREVIEW_ROWS = 200;
export const CSV_PREVIEW_COLUMNS = 50;
const csvField = (value: string) =>
  /[",\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

/** Splice one field only: unseen rows, quoting, BOM and line endings stay intact. */
export function replaceWorkspaceCsvCell(
  content: string,
  wantedRow: number,
  wantedColumn: number,
  value: string,
) {
  let row = 0,
    column = 0,
    start = content.startsWith("\uFEFF") ? 1 : 0,
    quoted = false;
  for (let index = start; index <= content.length; index++) {
    const char = content[index];
    if (char === '"') {
      if (quoted && content[index + 1] === '"') {
        index++;
        continue;
      }
      quoted = !quoted;
    }
    if (
      quoted ||
      (char !== undefined && char !== "," && char !== "\n" && char !== "\r")
    )
      continue;
    if (row === wantedRow && column === wantedColumn)
      return content.slice(0, start) + csvField(value) + content.slice(index);
    if (char !== "," && row === wantedRow && column < wantedColumn)
      return (
        content.slice(0, index) +
        ",".repeat(wantedColumn - column) +
        csvField(value) +
        content.slice(index)
      );
    if (char === ",") column++;
    else {
      row++;
      column = 0;
      if (char === "\r" && content[index + 1] === "\n") index++;
    }
    start = index + 1;
  }
  throw new Error("CSV cell is outside the document");
}

/** A bounded text-only preview. Never coerce identifiers or evaluate formulas. */
export function parseWorkspaceCsv(
  content: string,
  maxRows = CSV_PREVIEW_ROWS,
  maxColumns = CSV_PREVIEW_COLUMNS,
) {
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false,
    closed = false;
  let truncated = false,
    invalid = false,
    column = 0;
  const text = content.replace(/^\uFEFF/u, "");
  const pushField = () => {
    if (column < maxColumns) row.push(field);
    else truncated = true;
    column += 1;
    field = "";
    closed = false;
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          if (column < maxColumns) field += '"';
          index += 1;
        } else {
          quoted = false;
          closed = true;
        }
      } else if (column < maxColumns) field += char;
      continue;
    }
    if (char === ",") pushField();
    else if (char === "\r" || char === "\n") {
      pushField();
      rows.push(row);
      row = [];
      column = 0;
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      if (rows.length >= maxRows) {
        return {
          rows,
          truncated: truncated || index < text.length - 1,
          invalid,
        };
      }
    } else if (char === '"' && !field && !closed) quoted = true;
    else {
      if (closed || char === '"') invalid = true;
      if (column < maxColumns) field += char;
    }
  }
  if (field || column || closed || quoted || (text && !/[\r\n]$/u.test(text))) {
    pushField();
    rows.push(row);
  }
  return { rows, truncated, invalid: invalid || quoted };
}
