import {
  DataHeatmap,
  type DataHeatmapCell,
  type DataHeatmapColumnLabel,
} from "@artemis/ui/data";

import {
  formatTokenUsageTooltip,
  tokenUsageValue,
  type TokenUsageCell,
  type TokenUsageLocale,
  type TokenUsageView,
} from "./token-usage.js";

function intensity(value: number, maximum: number): number {
  if (value <= 0 || maximum <= 0) return 0;
  return Math.max(1, Math.ceil((value / maximum) * 4));
}

export function TokenUsageHeatmap({
  cells,
  hovered,
  label,
  locale,
  maximum,
  onHoveredChange,
  view,
}: {
  cells: readonly TokenUsageCell[];
  hovered: TokenUsageCell | undefined;
  label: string;
  locale: TokenUsageLocale;
  maximum: number;
  onHoveredChange: (cell: TokenUsageCell | undefined) => void;
  view: TokenUsageView;
}) {
  const monthFormatter = new Intl.DateTimeFormat(locale, {
    month: "short",
    timeZone: "UTC",
  });
  const monthLabels: DataHeatmapColumnLabel[] = cells.flatMap((cell, index) => {
    if (index % 7 !== 0) return [];
    const previous = cells[index - 7];
    if (previous?.date.slice(0, 7) === cell.date.slice(0, 7)) return [];
    return [
      {
        column: Math.floor(index / 7) + 1,
        id: `${cell.date.slice(0, 7)}-${index}`,
        label: monthFormatter.format(new Date(`${cell.date}T12:00:00.000Z`)),
      },
    ];
  });
  const displayCells: DataHeatmapCell[] = cells.map((cell, index) => ({
    id: cell.date,
    label: formatTokenUsageTooltip(cell, view, locale),
    level: intensity(tokenUsageValue(cell, view), maximum) as 0 | 1 | 2 | 3 | 4,
    periodKey: view === "weekly" ? cell.weekStart : cell.date,
    tooltipAlign: Math.floor(index / 7) >= 49 ? "end" : "start",
  }));

  return (
    <DataHeatmap
      activeCellId={hovered?.date}
      cells={displayCells}
      className="token-usage-chart"
      columnLabels={monthLabels}
      columns={Math.max(1, Math.ceil(cells.length / 7))}
      label={label}
      onActiveCellChange={(cellId) =>
        onHoveredChange(cells.find((cell) => cell.date === cellId))
      }
      rows={7}
    />
  );
}
