import type { ArtifactSelection } from "@artemis/protocol";

export interface OfficeCell {
  row: number;
  column: number;
}

export function cellAddress({ row, column }: OfficeCell): string {
  let letters = "";
  for (let value = column; value > 0; value = Math.floor((value - 1) / 26)) {
    letters = String.fromCharCode(65 + ((value - 1) % 26)) + letters;
  }
  return `${letters}${row}`;
}

export function cellRange(start: OfficeCell, end: OfficeCell): string {
  const first = cellAddress({
    row: Math.min(start.row, end.row),
    column: Math.min(start.column, end.column),
  });
  const last = cellAddress({
    row: Math.max(start.row, end.row),
    column: Math.max(start.column, end.column),
  });
  return first === last ? first : `${first}:${last}`;
}

export function cellRangeBounds(range: string) {
  const match =
    /^\$?([A-Z]{1,3})\$?([1-9]\d{0,6})(?::\$?([A-Z]{1,3})\$?([1-9]\d{0,6}))?$/u.exec(
      range,
    );
  if (!match) return undefined;
  const column = (letters: string) =>
    [...letters].reduce(
      (value, letter) => value * 26 + letter.charCodeAt(0) - 64,
      0,
    );
  const start = { row: Number(match[2]), column: column(match[1]!) };
  const end = {
    row: Number(match[4] ?? match[2]),
    column: column(match[3] ?? match[1]!),
  };
  return {
    top: Math.min(start.row, end.row),
    bottom: Math.max(start.row, end.row),
    left: Math.min(start.column, end.column),
    right: Math.max(start.column, end.column),
  };
}

export function pageRegion(
  page: number,
  start: { x: number; y: number },
  end: { x: number; y: number },
): Extract<ArtifactSelection, { kind: "region" }> | undefined {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.min(Math.abs(end.x - start.x), 1 - x);
  const height = Math.min(Math.abs(end.y - start.y), 1 - y);
  return width > 0.005 && height > 0.005
    ? { kind: "region", page, x, y, width, height }
    : undefined;
}

export function pageRegionQuote(
  region: Extract<ArtifactSelection, { kind: "region" }>,
  runs: readonly {
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }[],
): string | undefined {
  const text = runs
    .filter((run) => {
      const x = run.x + run.width / 2,
        y = run.y + run.height / 2;
      return (
        x >= region.x &&
        x <= region.x + region.width &&
        y >= region.y &&
        y <= region.y + region.height
      );
    })
    .map((run) => run.text)
    .join(" ")
    .slice(0, 8192);
  return text || undefined;
}
