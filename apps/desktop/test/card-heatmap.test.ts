// @vitest-environment jsdom
//
// D#76 PR9B §5 test matrix: the StatCard and TokenUsageHeatmap local
// components extracted from TokenUsagePage.tsx, the grid container
// aria-label contract (v17 12d), and the rule that the components stay
// presentation-only while the page keeps owning every data source.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement, useState } from "react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";

import "./renderer-test-utils.js";

import {
  formatTokenUsageTooltip,
  TOKEN_USAGE_COPY,
  type TokenUsageCell,
  type TokenUsageLocale,
  type TokenUsageView,
} from "../src/renderer/token-usage.js";

function readSource(relative: string): string {
  try {
    return readFileSync(resolve(process.cwd(), relative), "utf8");
  } catch {
    return "";
  }
}

const pageSource = readSource("src/renderer/TokenUsagePage.tsx");
const heatmapSource = readSource("src/renderer/TokenUsageHeatmap.tsx");
const statCardSource = readSource("src/renderer/StatCard.tsx");
const stylesSource = readFileSync(
  resolve(process.cwd(), "src/renderer/styles.css"),
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

interface StatCardProps {
  label: string;
  value: string;
}

type HeatmapComponent = (props: HeatmapProps) => ReactElement;
type StatCardComponent = (props: StatCardProps) => ReactElement;

async function loadModule(
  moduleName: string,
): Promise<Record<string, unknown>> {
  try {
    return (await import(moduleName)) as Record<string, unknown>;
  } catch {
    throw new Error(`D#76 PR9B component module missing: ${moduleName}`);
  }
}

// 49 synthetic cells: seven Monday-to-Sunday weeks from 2026-07-27 through
// 2026-09-12, hand-built (never the production derivation) so the props →
// DOM assertions below stay independent of the data layer.
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

// Independent re-statement of the four-tier intensity contract the cells
// must honor: value/maximum scaled to 1-4 with a 0 tier for empty cells.
function expectedLevel(value: number, maximum: number): number {
  if (value <= 0 || maximum <= 0) return 0;
  return Math.max(1, Math.ceil((value / maximum) * 4));
}

function gridcells(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('[role="gridcell"]')];
}

function renderHeatmapInteractive(
  component: HeatmapComponent,
  overrides: Partial<HeatmapProps> = {},
): void {
  function Host() {
    const [hovered, setHovered] = useState<TokenUsageCell | undefined>(
      undefined,
    );
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

describe("card and heatmap local components (D#76 PR9B §5)", () => {
  it("exports both components and lets the page consume them instead of the inline blocks", () => {
    expect(statCardSource).toContain("export function StatCard");
    expect(heatmapSource).toContain("export function TokenUsageHeatmap");
    expect(pageSource).toMatch(
      /import\s*\{[^}]*\bStatCard\b[^}]*\}\s*from\s*"\.\/StatCard\.js";/u,
    );
    expect(pageSource).toMatch(
      /import\s*\{\s*TokenUsageHeatmap\s*\}\s*from\s*"\.\/TokenUsageHeatmap\.js";/u,
    );
    expect(pageSource).toContain("<StatCard");
    expect(pageSource).toContain("<TokenUsageHeatmap");

    // The inline heatmap and summary-item markup moved out of the page.
    expect(pageSource).not.toContain("token-usage-cell");
    expect(pageSource).not.toContain("token-usage-grid");
    expect(pageSource).not.toContain("token-usage-months");
    expect(pageSource).not.toContain("token-usage-summary-item");

    // A2: the five-column summary bar container itself stays on the page.
    expect(pageSource).toContain('<section className="token-usage-summary"');
  });

  it("pins the props contracts of both components", () => {
    expect(heatmapSource).toMatch(/cells:\s*readonly TokenUsageCell\[\]/u);
    expect(heatmapSource).toMatch(/view:\s*TokenUsageView;/u);
    expect(heatmapSource).toMatch(/maximum:\s*number;/u);
    expect(heatmapSource).toMatch(/locale:\s*TokenUsageLocale;/u);
    expect(heatmapSource).toMatch(/label:\s*string;/u);
    expect(heatmapSource).toMatch(/hovered:\s*TokenUsageCell \| undefined;/u);
    expect(heatmapSource).toMatch(
      /onHoveredChange:\s*\(cell: TokenUsageCell \| undefined\) => void;/u,
    );
    expect(statCardSource).toMatch(
      /\{[^}]*\blabel:\s*string;\s*value:\s*string\s*\}/u,
    );
  });

  it("renders each stat with its value above its label in the summary bar shape", async () => {
    const statCardModule = await loadModule("../src/renderer/StatCard.js");
    const StatCard = statCardModule.StatCard as StatCardComponent;
    expect(typeof StatCard).toBe("function");

    const summary = [
      { label: "Total Tokens", value: "1.2M" },
      { label: "Peak daily Tokens", value: "12K" },
      { label: "Peak weekly Tokens", value: "48K" },
      { label: "Active days", value: "120" },
      { label: "Longest streak", value: "14 days" },
    ];
    const { container } = render(
      createElement(
        "section",
        { "aria-label": "Token usage", className: "token-usage-summary" },
        summary.map((item) =>
          createElement(StatCard, {
            key: item.label,
            label: item.label,
            value: item.value,
          }),
        ),
      ),
    );

    const items = [...container.querySelectorAll(".token-usage-summary-item")];
    expect(items).toHaveLength(5);
    items.forEach((item, index) => {
      expect(item.querySelector("strong")?.textContent).toBe(
        summary[index]!.value,
      );
      expect(item.querySelector("span")?.textContent).toBe(
        summary[index]!.label,
      );
    });
  });

  it("maps cells, view, and maximum onto gridcells, data-levels, and month labels", async () => {
    const heatmapModule = await loadModule(
      "../src/renderer/TokenUsageHeatmap.js",
    );
    const TokenUsageHeatmap =
      heatmapModule.TokenUsageHeatmap as HeatmapComponent;
    expect(typeof TokenUsageHeatmap).toBe("function");

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

    const grid = document.querySelector('[role="grid"]');
    expect(grid?.className).toContain("token-usage-grid");
    const cells = gridcells();
    expect(cells).toHaveLength(SYNTHETIC_CELLS.length);
    SYNTHETIC_CELLS.forEach((cell, index) => {
      const button = cells[index]!;
      expect(button.dataset.level).toBe(
        String(expectedLevel(cell.dailyTokens, 63)),
      );
      expect(button.getAttribute("aria-label")).toBe(
        formatTokenUsageTooltip(cell, "daily", "en"),
      );
    });

    const months = document.querySelector(".token-usage-months");
    expect(months?.getAttribute("aria-hidden")).toBe("true");
    const monthSpans = [...months!.querySelectorAll("span")];
    expect(monthSpans.map((span) => span.textContent)).toEqual([
      "Jul",
      "Aug",
      "Sep",
    ]);
    expect(monthSpans.map((span) => span.style.gridColumnStart)).toEqual([
      "1",
      "2",
      "7",
    ]);

    cleanup();
    render(
      createElement(TokenUsageHeatmap, {
        cells: SYNTHETIC_CELLS,
        view: "weekly",
        maximum: 441,
        locale: "en",
        label: "Token activity",
        hovered: undefined,
        onHoveredChange: () => undefined,
      }),
    );
    const weeklyCells = gridcells();
    SYNTHETIC_CELLS.forEach((cell, index) => {
      expect(weeklyCells[index]!.dataset.level).toBe(
        String(expectedLevel(cell.weeklyTokens, 441)),
      );
    });
  });

  it("labels the heatmap grid container in both locales (v17 12d contract)", async () => {
    const heatmapModule = await loadModule(
      "../src/renderer/TokenUsageHeatmap.js",
    );
    const TokenUsageHeatmap =
      heatmapModule.TokenUsageHeatmap as HeatmapComponent;

    const enLabel = TOKEN_USAGE_COPY.en.activity;
    const zhLabel = TOKEN_USAGE_COPY["zh-CN"].activity;
    expect(enLabel).toBeTruthy();
    expect(zhLabel).toBeTruthy();
    expect(enLabel).not.toBe(zhLabel);

    const baseProps = {
      cells: SYNTHETIC_CELLS,
      maximum: 63,
      hovered: undefined,
      onHoveredChange: () => undefined,
      view: "daily" as const,
    };
    render(
      createElement(TokenUsageHeatmap, {
        ...baseProps,
        locale: "en",
        label: enLabel,
      }),
    );
    expect(
      document.querySelector('[role="grid"]')?.getAttribute("aria-label"),
    ).toBe(enLabel);

    cleanup();
    render(
      createElement(TokenUsageHeatmap, {
        ...baseProps,
        locale: "zh-CN",
        label: zhLabel,
      }),
    );
    expect(
      document.querySelector('[role="grid"]')?.getAttribute("aria-label"),
    ).toBe(zhLabel);

    // The page supplies the label from localized copy, not a hard-coded string.
    expect(pageSource).toContain("label={t.activity}");
  });

  it("shows the same cell tooltip from pointer hover and keyboard focus", async () => {
    const heatmapModule = await loadModule(
      "../src/renderer/TokenUsageHeatmap.js",
    );
    const TokenUsageHeatmap =
      heatmapModule.TokenUsageHeatmap as HeatmapComponent;

    renderHeatmapInteractive(TokenUsageHeatmap);
    const cells = gridcells();
    const button = cells[10]!;
    expect(button.querySelector('[role="tooltip"]')).toBeNull();

    fireEvent.mouseEnter(button);
    const hoverTooltip = button.querySelector('[role="tooltip"]');
    expect(hoverTooltip?.textContent).toBe(button.getAttribute("aria-label"));

    fireEvent.mouseLeave(button);
    expect(button.querySelector('[role="tooltip"]')).toBeNull();

    fireEvent.focus(button);
    const focusTooltip = button.querySelector('[role="tooltip"]');
    expect(focusTooltip?.textContent).toBe(button.getAttribute("aria-label"));

    fireEvent.blur(button);
    expect(button.querySelector('[role="tooltip"]')).toBeNull();
  });

  it("marks the whole Monday-to-Sunday week as hovered in the weekly view", async () => {
    const heatmapModule = await loadModule(
      "../src/renderer/TokenUsageHeatmap.js",
    );
    const TokenUsageHeatmap =
      heatmapModule.TokenUsageHeatmap as HeatmapComponent;

    renderHeatmapInteractive(TokenUsageHeatmap, {
      maximum: 441,
      view: "weekly",
    });
    const cells = gridcells();
    fireEvent.focus(cells[8]!);
    cells.slice(7, 14).forEach((cell) => {
      expect(cell.className).toContain("period-hovered");
    });
    expect(cells[6]!.className).not.toContain("period-hovered");
    expect(cells[14]!.className).not.toContain("period-hovered");
  });

  it("keeps every data source on the page and the components presentation-only", () => {
    for (const source of [heatmapSource, statCardSource]) {
      expect(source).not.toContain("window.artemis");
      expect(source).not.toContain("getTokenUsageEvents");
      expect(source).not.toContain("onAgentEvent");
      expect(source).not.toContain("fetch(");
    }

    expect(pageSource).toContain(
      "window.artemis\n      .getTokenUsageEvents()",
    );
    expect(pageSource).toContain("onAgentEvent");
    expect(pageSource).toContain("<thead>");
    expect(pageSource).toContain('<header className="token-usage-profile">');
    expect(pageSource).toContain('className="token-usage-details"');

    // A2 keeps the existing summary bar styling untouched.
    expect(stylesSource).toMatch(
      /\.token-usage-summary-item strong\s*\{[^}]*font-variant-numeric:\s*tabular-nums/u,
    );
    expect(stylesSource).toMatch(
      /\.token-usage-grid,?\s*\.token-usage-months\s*\{[^}]*grid-template-columns:\s*repeat\(53,/u,
    );
  });
});
