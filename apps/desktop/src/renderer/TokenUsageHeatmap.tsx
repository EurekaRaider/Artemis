// D#76 PR9B cat-data-12: the 53-week token activity heatmap, extracted
// verbatim from TokenUsagePage.tsx (zero visual or behavior change). The
// grid keeps its 53-column × 7-row layout, the four-tier data-level blue
// scale, the cell tooltip on hover and keyboard focus, and the weekly
// period highlight. The component is presentation-only: the page owns the
// cells, the maximum, the hovered state (it resets hover whenever the view
// or model filter changes), and every IPC/data call. The v17 12d contract
// gap — a missing container aria-label — is closed via the label prop.
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
  const monthLabels = cells.flatMap((cell, index) => {
    if (index % 7 !== 0) return [];
    const previous = cells[index - 7];
    if (previous?.date.slice(0, 7) === cell.date.slice(0, 7)) return [];
    return [
      {
        column: Math.floor(index / 7) + 1,
        label: monthFormatter.format(new Date(`${cell.date}T12:00:00.000Z`)),
      },
    ];
  });

  return (
    <div className="token-usage-chart">
      <div aria-label={label} className="token-usage-grid" role="grid">
        {cells.map((cell, index) => {
          const tooltip = formatTokenUsageTooltip(cell, view, locale);
          const samePeriod =
            hovered &&
            (view === "weekly"
              ? hovered.weekStart === cell.weekStart
              : hovered.date === cell.date);
          const rightEdge = Math.floor(index / 7) >= 49;
          return (
            <button
              aria-label={tooltip}
              className={`token-usage-cell${samePeriod ? " period-hovered" : ""}`}
              data-level={intensity(tokenUsageValue(cell, view), maximum)}
              key={cell.date}
              onBlur={() => onHoveredChange(undefined)}
              onFocus={() => onHoveredChange(cell)}
              onMouseEnter={() => onHoveredChange(cell)}
              onMouseLeave={() => onHoveredChange(undefined)}
              role="gridcell"
              type="button"
            >
              {hovered?.date === cell.date && (
                <span
                  className={
                    rightEdge
                      ? "token-usage-tooltip align-right"
                      : "token-usage-tooltip"
                  }
                  role="tooltip"
                >
                  {tooltip}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div aria-hidden="true" className="token-usage-months">
        {monthLabels.map((month) => (
          <span
            key={`${month.column}-${month.label}`}
            style={{ gridColumnStart: month.column }}
          >
            {month.label}
          </span>
        ))}
      </div>
    </div>
  );
}
