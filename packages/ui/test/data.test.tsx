// @vitest-environment jsdom
import { renderToString } from "react-dom/server";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DATA_ACCESSIBLE_NAME_ERROR,
  DATA_COMPONENT_CONTRACTS,
  DataHeatmap,
  DataStat,
  DataSurface,
  validateDataComponentContracts,
  type DataHeatmapCell,
} from "../src/data.js";

const cells = Object.freeze(
  Array.from({ length: 14 }, (_, index) => ({
    id: `2026-08-${String(index + 1).padStart(2, "0")}`,
    label: `${index + 1} August, ${index * 10} tokens`,
    level: Math.min(4, index % 5) as 0 | 1 | 2 | 3 | 4,
    periodKey: index < 7 ? "week-one" : "week-two",
    tooltipAlign: index >= 7 ? ("end" as const) : ("start" as const),
  })) satisfies readonly DataHeatmapCell[],
);

function ControlledHeatmap({
  direction = "ltr",
}: {
  direction?: "ltr" | "rtl";
}) {
  const [activeCellId, setActiveCellId] = useState<string>();
  return (
    <div dir={direction}>
      <DataHeatmap
        activeCellId={activeCellId}
        cells={cells}
        columnLabels={[
          { column: 1, id: "august", label: "August" },
          { column: 2, id: "september", label: "September" },
        ]}
        columns={2}
        label="Token activity"
        onActiveCellChange={setActiveCellId}
        rows={7}
      />
    </div>
  );
}

afterEach(cleanup);

describe("data display public contract", () => {
  it("is deeply frozen and rejects exact-contract drift", () => {
    expect(Object.isFrozen(DATA_COMPONENT_CONTRACTS)).toBe(true);
    expect(Object.isFrozen(DATA_COMPONENT_CONTRACTS.dataHeatmap.theme)).toBe(
      true,
    );
    expect(validateDataComponentContracts(DATA_COMPONENT_CONTRACTS)).toEqual({
      valid: true,
      errors: [],
    });

    const drifted = structuredClone(DATA_COMPONENT_CONTRACTS);
    (drifted as Record<string, unknown>).usageCalculation = {};
    expect(validateDataComponentContracts(drifted)).toEqual({
      valid: false,
      errors: ["contracts fields are not exact"],
    });
  });

  it("renders a named surface and visible stat without owning effects", () => {
    const html = renderToString(
      <DataSurface
        busy
        header={<h1>Usage</h1>}
        label="Token usage"
        state="loading"
        toolbar={<button type="button">Filter</button>}
      >
        <DataStat label="Total tokens" value="42K" />
      </DataSurface>,
    );

    expect(html).toContain('data-artemis-component="data-surface"');
    expect(html).toContain('aria-label="Token usage"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('data-artemis-component="data-stat"');
    expect(html).toContain("Total tokens");
    expect(html).toContain("42K");
  });

  it("exposes every heatmap value in text and highlights a caller-owned period", () => {
    render(<ControlledHeatmap />);

    const grid = screen.getByRole("grid", { name: "Token activity" });
    const rows = screen.getAllByRole("row");
    expect(grid.getAttribute("aria-rowcount")).toBe("7");
    expect(grid.getAttribute("aria-colcount")).toBe("2");
    expect(rows).toHaveLength(7);
    expect([...grid.children]).toEqual(rows);

    const first = screen.getByRole("gridcell", {
      name: "1 August, 0 tokens",
    });
    const second = screen.getByRole("gridcell", {
      name: "2 August, 10 tokens",
    });
    fireEvent.mouseEnter(first);

    expect(screen.getByRole("tooltip").textContent).toBe("1 August, 0 tokens");
    expect(first.getAttribute("data-period-active")).toBe("true");
    expect(second.getAttribute("data-period-active")).toBe("true");
    for (const cell of screen.getAllByRole("gridcell")) {
      expect(cell.parentElement?.getAttribute("role")).toBe("row");
      expect(cell.parentElement?.parentElement).toBe(grid);
    }
    expect(screen.getByText("August")).toBeTruthy();
  });

  it("supports row and direction-aware column keyboard navigation", () => {
    const onActive = vi.fn();
    const { rerender } = render(
      <DataHeatmap
        activeCellId={cells[0]!.id}
        cells={cells}
        columns={2}
        label="Token activity"
        onActiveCellChange={onActive}
        rows={7}
      />,
    );
    const first = screen.getByRole("gridcell", {
      name: "1 August, 0 tokens",
    });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(onActive).toHaveBeenLastCalledWith(cells[1]!.id);
    expect(document.activeElement).toBe(
      screen.getByRole("gridcell", { name: "2 August, 10 tokens" }),
    );

    rerender(
      <div dir="rtl">
        <DataHeatmap
          activeCellId={cells[0]!.id}
          cells={cells}
          columns={2}
          label="Token activity"
          onActiveCellChange={onActive}
          rows={7}
        />
      </div>,
    );
    const rtlFirst = screen.getByRole("gridcell", {
      name: "1 August, 0 tokens",
    });
    rtlFirst.focus();
    fireEvent.keyDown(rtlFirst, { key: "ArrowLeft" });
    expect(onActive).toHaveBeenLastCalledWith(cells[7]!.id);
    expect(document.activeElement).toBe(
      screen.getByRole("gridcell", { name: "8 August, 70 tokens" }),
    );
  });

  it("rejects imperceptible surface, heatmap, and cell labels", () => {
    expect(() =>
      renderToString(<DataSurface label=" ">Invalid</DataSurface>),
    ).toThrow(DATA_ACCESSIBLE_NAME_ERROR);
    expect(() =>
      renderToString(
        <DataHeatmap
          cells={[{ id: "one", label: " ", level: 0, periodKey: "one" }]}
          columns={1}
          label="Activity"
          onActiveCellChange={() => undefined}
          rows={1}
        />,
      ),
    ).toThrow(DATA_ACCESSIBLE_NAME_ERROR);
  });

  it("removes disabled heatmaps from focus and suppresses interactions", () => {
    const onActive = vi.fn();
    render(
      <DataHeatmap
        activeCellId={cells[0]!.id}
        cells={cells}
        columns={2}
        label="Disabled activity"
        onActiveCellChange={onActive}
        rows={7}
        state="disabled"
      />,
    );

    const grid = screen.getByRole("grid", { name: "Disabled activity" });
    const first = screen.getByRole("gridcell", {
      name: "1 August, 0 tokens",
    });
    expect(grid.getAttribute("aria-disabled")).toBe("true");
    expect((first as HTMLButtonElement).disabled).toBe(true);
    expect(first.getAttribute("aria-disabled")).toBe("true");
    expect(first.getAttribute("tabindex")).toBe("-1");

    fireEvent.focus(first);
    fireEvent.mouseEnter(first);
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(onActive).not.toHaveBeenCalled();
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(document.activeElement).not.toBe(
      screen.getByRole("gridcell", { name: "2 August, 10 tokens" }),
    );
  });
});
