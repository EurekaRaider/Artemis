import { fireEvent, render, screen } from "@testing-library/react";
import { expect, vi } from "vitest";
import {
  DATA_COMPONENT_CONTRACTS,
  DataHeatmap,
  DataStat,
  DataSurface,
} from "@artemis/ui/data";
import { dataSource, uiCss } from "./shared.js";

export const dataCases = {
  "data-anatomy"() {
    const { container } = render(
      <DataSurface label="Usage">
        <DataStat label="Tokens" value="42K" />
        <DataHeatmap
          cells={[
            { id: "one", label: "One token", level: 1, periodKey: "week" },
            { id: "two", label: "Two tokens", level: 2, periodKey: "week" },
          ]}
          columnLabels={[{ column: 1, id: "week", label: "Week" }]}
          columns={1}
          label="Token activity"
          onActiveCellChange={() => undefined}
          rows={2}
        />
      </DataSurface>,
    );
    for (const contract of Object.values(DATA_COMPONENT_CONTRACTS)) {
      expect(
        container.querySelector(`[data-artemis-component="${contract.name}"]`),
      ).not.toBeNull();
    }
    expect(screen.getByRole("region", { name: "Usage" })).toBeTruthy();
    expect(screen.getByRole("grid", { name: "Token activity" })).toBeTruthy();
    expect(screen.getByRole("gridcell", { name: "One token" })).toBeTruthy();
  },
  "data-state-matrix"() {
    const { container } = render(
      <>
        <DataSurface busy label="Loading data" state="loading">
          Loading
        </DataSurface>
        <DataSurface label="Empty data" state="empty">
          Empty
        </DataSurface>
        <DataSurface label="Failed data" state="error">
          Error
        </DataSurface>
        <DataHeatmap
          cells={[{ id: "one", label: "One", level: 0, periodKey: "one" }]}
          columns={1}
          label="Disabled map"
          onActiveCellChange={() => undefined}
          rows={1}
          state="disabled"
        />
      </>,
    );
    for (const state of ["loading", "empty", "error", "disabled"]) {
      expect(container.querySelector(`[data-state="${state}"]`)).not.toBeNull();
    }
    expect(
      screen
        .getByRole("region", { name: "Loading data" })
        .getAttribute("aria-busy"),
    ).toBe("true");
  },
  async "data-controlled-events"() {
    const active = vi.fn();
    render(
      <DataHeatmap
        activeCellId="one"
        cells={[
          { id: "one", label: "One", level: 1, periodKey: "week" },
          { id: "two", label: "Two", level: 2, periodKey: "week" },
        ]}
        columns={1}
        label="Activity"
        onActiveCellChange={active}
        rows={2}
      />,
    );
    const first = screen.getByRole("gridcell", { name: "One" });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(active).toHaveBeenLastCalledWith("two");
    expect(document.activeElement).toBe(
      screen.getByRole("gridcell", { name: "Two" }),
    );
  },
  "data-rtl-long-content"() {
    const { container } = render(
      <div dir="rtl">
        <DataSurface label="بيانات اصطناعية بعنوان طويل للغاية">
          <DataStat
            label="إجمالي الرموز في الفترة المحلية الطويلة"
            value="١٢٣٬٤٥٦"
          />
        </DataSurface>
      </div>,
    );
    expect(
      container
        .querySelector('[data-artemis-component="data-surface"]')
        ?.closest('[dir="rtl"]'),
    ).not.toBeNull();
    expect(dataSource).not.toMatch(/window\.artemis|electron|node:/u);
    expect(dataSource).toContain(
      "caller-owns-data-loading-calculation-and-effects",
    );
    expect(uiCss).toContain("inset-inline-start");
  },
};
