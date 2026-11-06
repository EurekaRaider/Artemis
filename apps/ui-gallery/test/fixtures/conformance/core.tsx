import { fireEvent, render, screen } from "@testing-library/react";
import { expect, vi } from "vitest";
import {
  CONFORMANCE_PROBE_ACCESSIBLE_NAME_ERROR,
  ConformanceProbe,
} from "@artemis/ui/conformance";
import { ProbeErrorBoundary } from "./shared.js";

export const coreCases = {
  anatomy() {
    const { container } = render(
      <ConformanceProbe label="Matrix anatomy" defaultValue="value" />,
    );
    const root = container.querySelector(
      '[data-artemis-component="conformance-probe"]',
    );
    expect(root?.getAttribute("data-part")).toBe("root");
    expect(root?.getAttribute("data-state")).toBe("ready");
    expect(
      [...container.querySelectorAll("[data-part]")].map((part) =>
        part.getAttribute("data-part"),
      ),
    ).toEqual(["root", "label", "control", "description", "error"]);
  },
  "aria-relations"() {
    const blankLabelErrors: unknown[] = [];
    const blankLabelRender = render(
      <ProbeErrorBoundary onError={(error) => blankLabelErrors.push(error)}>
        <ConformanceProbe label={"\u200B\u2060"} />
      </ProbeErrorBoundary>,
      { onCaughtError: () => undefined },
    );
    expect(blankLabelErrors).toHaveLength(1);
    expect(blankLabelErrors[0]).toBeInstanceOf(Error);
    expect((blankLabelErrors[0] as Error).message).toBe(
      CONFORMANCE_PROBE_ACCESSIBLE_NAME_ERROR,
    );
    expect(
      blankLabelRender.container.querySelector(
        '[data-artemis-component="conformance-probe"]',
      ),
    ).toBeNull();
    blankLabelRender.unmount();

    const { container } = render(
      <ConformanceProbe
        id="matrix-aria"
        label="Matrix ARIA"
        description="Description"
        error="Error"
      />,
    );
    const root = screen.getByRole("group", { name: "Matrix ARIA" });
    const control = screen.getByRole("textbox", { name: "Matrix ARIA" });
    const label = container.querySelector('[data-part="label"]');
    expect(root.getAttribute("aria-labelledby")).toBe("matrix-aria-label");
    expect(label?.getAttribute("for")).toBe("matrix-aria-control");
    expect(control.getAttribute("aria-describedby")).toBe(
      "matrix-aria-description matrix-aria-error",
    );
    expect(control.getAttribute("aria-invalid")).toBe("true");
    expect(label?.textContent).toBe("Matrix ARIA");
  },
  "finite-states"() {
    const { container, rerender } = render(
      <ConformanceProbe label="Matrix state" />,
    );
    const state = () =>
      container
        .querySelector('[data-artemis-component="conformance-probe"]')
        ?.getAttribute("data-state");
    expect(state()).toBe("ready");
    rerender(<ConformanceProbe label="Matrix state" error="Error" />);
    expect(state()).toBe("error");
    rerender(<ConformanceProbe label="Matrix state" stale />);
    expect(state()).toBe("stale");
    rerender(<ConformanceProbe label="Matrix state" busy />);
    expect(state()).toBe("busy");
    rerender(<ConformanceProbe label="Matrix state" disabled />);
    expect(state()).toBe("disabled");
  },
  "controlled-boundary"() {
    const onValueChange = vi.fn();
    const { rerender } = render(
      <ConformanceProbe
        label="Matrix controlled"
        value="fixed"
        onValueChange={onValueChange}
      />,
    );
    const control = screen.getByRole("textbox", {
      name: "Matrix controlled",
    });
    fireEvent.change(control, { target: { value: "requested" } });
    expect(onValueChange).toHaveBeenCalledOnce();
    expect(onValueChange).toHaveBeenCalledWith("requested");
    expect(control).toHaveProperty("value", "fixed");
    rerender(
      <ConformanceProbe
        label="Matrix controlled"
        value="accepted"
        onValueChange={onValueChange}
      />,
    );
    expect(control).toHaveProperty("value", "accepted");
  },
  "ime-enter"() {
    const onCommit = vi.fn();
    render(
      <ConformanceProbe
        label="Matrix IME"
        defaultValue="中"
        onCommit={onCommit}
      />,
    );
    const control = screen.getByRole("textbox", { name: "Matrix IME" });
    fireEvent.compositionStart(control);
    fireEvent.keyDown(control, { key: "Enter", isComposing: true });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.compositionEnd(control);
    fireEvent.keyDown(control, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledWith("中");
  },
  "callback-order"() {
    const order: string[] = [];
    render(
      <ConformanceProbe
        label="Matrix callbacks"
        defaultValue="a"
        onValueChange={(value) => order.push(`onValueChange:${value}`)}
        onCommit={(value) => order.push(`onCommit:${value}`)}
        onEvent={(event) => order.push(`onEvent:${event.type}:${event.value}`)}
      />,
    );
    const control = screen.getByRole("textbox", {
      name: "Matrix callbacks",
    });
    fireEvent.change(control, { target: { value: "ab" } });
    fireEvent.keyDown(control, { key: "Enter" });
    expect(order).toEqual([
      "onValueChange:ab",
      "onEvent:change:ab",
      "onCommit:ab",
      "onEvent:commit:ab",
    ]);
  },
  "rtl-inheritance"() {
    const { container } = render(
      <div dir="rtl">
        <ConformanceProbe label="Matrix RTL" />
      </div>,
    );
    const probe = container.querySelector(
      '[data-artemis-component="conformance-probe"]',
    );
    expect(probe?.closest('[dir="rtl"]')).not.toBeNull();
    expect(container.querySelector("[data-artemis-portal]")).toBeNull();
  },
};
