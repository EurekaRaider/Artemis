// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement, useState, type ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";

import "./renderer-test-utils.js";

import {
  formatTokenUsageTooltip,
  TOKEN_USAGE_COPY,
  type TokenUsageCell,
  type TokenUsageLocale,
  type TokenUsageView,
} from "../src/renderer/token-usage.js";

const pageSource = readFileSync(
  resolve(process.cwd(), "src/renderer/TokenUsagePage.tsx"),
  "utf8",
);
const adapterSource = readFileSync(
  resolve(process.cwd(), "src/renderer/TokenUsageHeatmap.tsx"),
  "utf8",
);
const publicDataSource = readFileSync(
  resolve(process.cwd(), "../../packages/ui/src/data.tsx"),
  "utf8",
);
const publicUiStyles = readFileSync(
  resolve(process.cwd(), "../../packages/ui/src/styles.css"),
  "utf8",
);

interface HeatmapProps {
  cells: readonly TokenUsageCell[];
  view: TokenUsageView;
  maximum: number;
  locale: TokenUsageLocale;
  label: string;
  hovered: TokenUsageCell | undefined;
  onHoveredChange: (cell: TokenUsageCell | undefined) => void;
}

type HeatmapComponent = (props: HeatmapProps) => ReactElement;

const DAILY_PATTERN = [0, 1, 15, 31, 47, 63, 63] as const;

function addDaysIso(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

const SYNTHETIC_CELLS: TokenUsageCell[] = (() => {
  const cells: TokenUsageCell[] = [];
  let cumulative = 0;
  for (let day = 0; day < 49; day += 1) {
    const daily = DAILY_PATTERN[day % DAILY_PATTERN.length]!;
    cumulative += daily;
    cells.push({
      date: addDaysIso("2026-07-27", day),
      weekStart: addDaysIso("2026-07-27", day - (day % 7)),
      dailyTokens: daily,
      weeklyTokens: daily * 7,
      cumulativeTokens: cumulative,
    });
  }
  return cells;
})();

function expectedLevel(value: number, maximum: number): number {
  if (value <= 0 || maximum <= 0) return 0;
  return Math.max(1, Math.ceil((value / maximum) * 4));
}

function gridcells(): HTMLButtonElement[] {
  return [
    ...document.querySelectorAll<HTMLButtonElement>('[role="gridcell"]'),
  ].sort((left, right) => {
    const columnDifference =
      Number(left.getAttribute("aria-colindex")) -
      Number(right.getAttribute("aria-colindex"));
    if (columnDifference !== 0) return columnDifference;
    return (
      Number(left.parentElement?.getAttribute("aria-rowindex")) -
      Number(right.parentElement?.getAttribute("aria-rowindex"))
    );
  });
}

function renderHeatmapInteractive(
  component: HeatmapComponent,
  overrides: Partial<HeatmapProps> = {},
): void {
  function Host() {
    const [hovered, setHovered] = useState<TokenUsageCell>();
    return createElement(component, {
      cells: SYNTHETIC_CELLS,
      view: "daily",
      maximum: 63,
      locale: "en",
      label: TOKEN_USAGE_COPY.en.activity,
      hovered,
      onHoveredChange: setHovered,
      ...overrides,
    });
  }
  render(createElement(Host));
}

afterEach(cleanup);

describe("public data stat and heatmap migration (D#76 MIG5B)", () => {
  it("moves reusable stat and heatmap presentation into @artemis/ui", () => {
    expect(pageSource).toContain(
      'import { DataStat, DataSurface } from "@artemis/ui/data";',
    );
    expect(pageSource).toContain("<DataStat");
    expect(pageSource).toContain("<DataSurface");
    expect(adapterSource).toContain('from "@artemis/ui/data"');
    expect(adapterSource).toContain("<DataHeatmap");
    expect(publicDataSource).toContain("export function DataStat");
    expect(publicDataSource).toContain("export function DataHeatmap");
    expect(publicUiStyles).toContain('[data-artemis-component="data-heatmap"]');
    expect(pageSource).not.toContain("token-usage-summary-item");
    expect(adapterSource).not.toContain("token-usage-cell");
  });

  it("keeps token calculation and IPC ownership in Desktop", () => {
    expect(pageSource).toContain(
      "window.artemis\n      .getTokenUsageEvents()",
    );
    expect(pageSource).toContain("onAgentEvent");
    for (const source of [adapterSource, publicDataSource]) {
      expect(source).not.toContain("window.artemis");
      expect(source).not.toContain("getTokenUsageEvents");
      expect(source).not.toContain("onAgentEvent");
    }
    expect(publicDataSource).not.toMatch(/@artemis\/protocol|electron|node:/u);
  });

  it("maps page cells onto public levels, labels, and month columns", async () => {
    const { TokenUsageHeatmap } =
      (await import("../src/renderer/TokenUsageHeatmap.js")) as {
        TokenUsageHeatmap: HeatmapComponent;
      };
    render(
      createElement(TokenUsageHeatmap, {
        cells: SYNTHETIC_CELLS,
        view: "daily",
        maximum: 63,
        locale: "en",
        label: "Token activity",
        hovered: undefined,
        onHoveredChange: () => undefined,
      }),
    );

    expect(
      document.querySelector('[data-artemis-component="data-heatmap"]'),
    ).not.toBeNull();
    const cells = gridcells();
    expect(cells).toHaveLength(SYNTHETIC_CELLS.length);
    expect(
      document.querySelectorAll('[role="grid"] > [role="row"]'),
    ).toHaveLength(7);
    for (const cell of cells) {
      expect(cell.parentElement?.getAttribute("role")).toBe("row");
      expect(cell.parentElement?.parentElement?.getAttribute("role")).toBe(
        "grid",
      );
    }
    SYNTHETIC_CELLS.forEach((cell, index) => {
      expect(cells[index]!.dataset.level).toBe(
        String(expectedLevel(cell.dailyTokens, 63)),
      );
      expect(cells[index]!.getAttribute("aria-label")).toBe(
        formatTokenUsageTooltip(cell, "daily", "en"),
      );
    });
    const months = document.querySelector('[data-part="column-labels"]');
    expect(months?.getAttribute("aria-hidden")).toBe("true");
    expect(
      [...months!.querySelectorAll('[data-part="column-label"]')].map(
        (month) => month.textContent,
      ),
    ).toEqual(["Jul", "Aug", "Sep"]);
  });

  it("uses pointer, focus, and arrow keys with text-equivalent tooltips", async () => {
    const { TokenUsageHeatmap } =
      (await import("../src/renderer/TokenUsageHeatmap.js")) as {
        TokenUsageHeatmap: HeatmapComponent;
      };
    renderHeatmapInteractive(TokenUsageHeatmap);
    const cells = gridcells();
    const first = cells[0]!;

    fireEvent.mouseEnter(first);
    expect(first.querySelector('[role="tooltip"]')?.textContent).toBe(
      first.getAttribute("aria-label"),
    );
    fireEvent.mouseLeave(first);
    expect(first.querySelector('[role="tooltip"]')).toBeNull();

    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(cells[1]);
    expect(cells[1]!.querySelector('[role="tooltip"]')?.textContent).toBe(
      cells[1]!.getAttribute("aria-label"),
    );
  });

  it("marks a complete caller-defined week without relying on color alone", async () => {
    const { TokenUsageHeatmap } =
      (await import("../src/renderer/TokenUsageHeatmap.js")) as {
        TokenUsageHeatmap: HeatmapComponent;
      };
    renderHeatmapInteractive(TokenUsageHeatmap, {
      maximum: 441,
      view: "weekly",
    });
    const cells = gridcells();
    fireEvent.focus(cells[8]!);
    cells.slice(7, 14).forEach((cell) => {
      expect(cell.dataset.periodActive).toBe("true");
      expect(cell.getAttribute("aria-label")).toBeTruthy();
    });
    expect(cells[6]!.dataset.periodActive).toBeUndefined();
    expect(cells[14]!.dataset.periodActive).toBeUndefined();
  });
});
