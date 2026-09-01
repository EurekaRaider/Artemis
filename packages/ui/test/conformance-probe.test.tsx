// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  CONFORMANCE_PROBE_ACCESSIBLE_NAME_ERROR,
  CONFORMANCE_PROBE_CONTROL_BOUNDARY_ERROR,
  ConformanceProbe,
  type ConformanceProbeProps,
} from "../src/conformance.js";

describe("ConformanceProbe behavior harness", () => {
  it.each([
    "",
    "  \t\n  ",
    "\u200B\u200C\u200D",
    "\u2060\u2066\u2069",
    "\uFE0F\u00AD",
  ])(
    "fails closed before rendering a non-perceptible accessible label (%j)",
    (label) => {
      expect(() => render(<ConformanceProbe label={label} />)).toThrowError(
        CONFORMANCE_PROBE_ACCESSIBLE_NAME_ERROR,
      );
      expect(() =>
        renderToString(<ConformanceProbe label={label} />),
      ).toThrowError(CONFORMANCE_PROBE_ACCESSIBLE_NAME_ERROR);
    },
  );

  it.each(["中文", "e\u0301", "\u0301", "👩‍💻", " \u200B可见\u2060 "])(
    "accepts a perceptible accessible label (%j)",
    (label) => {
      const { container, unmount } = render(<ConformanceProbe label={label} />);
      expect(screen.getByRole("textbox")).not.toBeNull();
      expect(container.querySelector('[data-part="label"]')?.textContent).toBe(
        label,
      );
      unmount();
      expect(renderToString(<ConformanceProbe label={label} />)).toContain(
        "data-artemis-component",
      );
    },
  );

  it("rejects simultaneous controlled and uncontrolled props in DOM and SSR", () => {
    const invalidProps = {
      label: "Boundary",
      value: "controlled",
      defaultValue: "uncontrolled",
      onValueChange: vi.fn(),
    } as unknown as ConformanceProbeProps;
    expect(() => render(<ConformanceProbe {...invalidProps} />)).toThrowError(
      CONFORMANCE_PROBE_CONTROL_BOUNDARY_ERROR,
    );
    expect(() =>
      renderToString(<ConformanceProbe {...invalidProps} />),
    ).toThrowError(CONFORMANCE_PROBE_CONTROL_BOUNDARY_ERROR);
  });

  it("treats own optional props with undefined values as absent", () => {
    const uncontrolledProps = {
      label: "Optional uncontrolled",
      value: undefined,
      defaultValue: "seed",
    } as unknown as ConformanceProbeProps;
    const controlledProps = {
      label: "Optional controlled",
      value: "fixed",
      defaultValue: undefined,
      onValueChange: vi.fn(),
    } as unknown as ConformanceProbeProps;

    const { unmount } = render(<ConformanceProbe {...uncontrolledProps} />);
    expect(
      screen.getByRole("textbox", { name: "Optional uncontrolled" }),
    ).toHaveProperty("value", "seed");
    unmount();
    expect(() =>
      render(<ConformanceProbe {...controlledProps} />),
    ).not.toThrow();
  });

  it("renders stable anatomy and explicit ARIA relationships", () => {
    const { container } = render(
      <ConformanceProbe
        id="probe"
        label="Probe label"
        description="Probe description"
        error="Probe error"
      />,
    );
    const root = container.querySelector(
      '[data-artemis-component="conformance-probe"]',
    );
    const control = screen.getByRole("textbox", { name: "Probe label" });

    expect(root?.getAttribute("role")).toBe("group");
    expect(root?.getAttribute("data-part")).toBe("root");
    expect(root?.getAttribute("data-state")).toBe("error");
    expect(control.getAttribute("aria-invalid")).toBe("true");
    expect(control.getAttribute("aria-describedby")).toBe(
      "probe-description probe-error",
    );
    expect(
      [...container.querySelectorAll("[data-part]")].map((part) =>
        part.getAttribute("data-part"),
      ),
    ).toEqual(["root", "label", "control", "description", "error"]);
  });

  it("preserves controlled and uncontrolled boundaries and callback order", async () => {
    const user = userEvent.setup();
    const order: string[] = [];
    const onValueChange = vi.fn((value: string) =>
      order.push(`onValueChange:${value}`),
    );
    const onCommit = vi.fn((value: string) => order.push(`onCommit:${value}`));
    const onEvent = vi.fn((event: { type: string; value: string }) =>
      order.push(`onEvent:${event.type}:${event.value}`),
    );
    render(
      <ConformanceProbe
        label="Value"
        defaultValue="a"
        onValueChange={onValueChange}
        onCommit={onCommit}
        onEvent={onEvent}
      />,
    );
    const control = screen.getByRole("textbox", { name: "Value" });
    await user.type(control, "b");
    await user.keyboard("{Enter}");

    expect(control).toHaveProperty("value", "ab");
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(order).toEqual([
      "onValueChange:ab",
      "onEvent:change:ab",
      "onCommit:ab",
      "onEvent:commit:ab",
    ]);

    const controlledChange = vi.fn();
    const { rerender } = render(
      <ConformanceProbe
        label="Controlled"
        value="fixed"
        onValueChange={controlledChange}
      />,
    );
    const controlled = screen.getByRole("textbox", { name: "Controlled" });
    fireEvent.change(controlled, { target: { value: "next" } });
    expect(controlledChange).toHaveBeenCalledOnce();
    expect(controlled).toHaveProperty("value", "fixed");
    rerender(
      <ConformanceProbe
        label="Controlled"
        value="next"
        onValueChange={controlledChange}
      />,
    );
    expect(controlled).toHaveProperty("value", "next");
  });

  it("suppresses Enter commit during IME composition", () => {
    const onCommit = vi.fn();
    render(
      <ConformanceProbe label="IME" defaultValue="中" onCommit={onCommit} />,
    );
    const control = screen.getByRole("textbox", { name: "IME" });
    fireEvent.compositionStart(control);
    fireEvent.keyDown(control, { key: "Enter", isComposing: true });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.compositionEnd(control);
    fireEvent.keyDown(control, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledWith("中");
  });

  it("freezes disabled, busy, stale, and invalid action policies", () => {
    const onValueChange = vi.fn();
    const onCommit = vi.fn();
    const onEvent = vi.fn();
    const { rerender, container } = render(
      <ConformanceProbe
        label="State"
        defaultValue="value"
        disabled
        onValueChange={onValueChange}
        onCommit={onCommit}
        onEvent={onEvent}
      />,
    );
    let control = screen.getByRole("textbox", { name: "State" });
    expect(control).toHaveProperty("disabled", true);
    expect(container.firstElementChild?.getAttribute("data-state")).toBe(
      "disabled",
    );
    fireEvent.change(control, { target: { value: "blocked" } });
    fireEvent.keyDown(control, { key: "Enter" });
    control.focus();
    expect(document.activeElement).not.toBe(control);
    expect(onValueChange).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
    expect(onEvent).not.toHaveBeenCalled();

    rerender(
      <ConformanceProbe
        label="State"
        defaultValue="value"
        busy
        onValueChange={onValueChange}
        onCommit={onCommit}
        onEvent={onEvent}
      />,
    );
    control = screen.getByRole("textbox", { name: "State" });
    expect(control).toHaveProperty("readOnly", true);
    expect(control.getAttribute("aria-busy")).toBe("true");
    expect(container.firstElementChild?.getAttribute("data-state")).toBe(
      "busy",
    );
    fireEvent.keyDown(control, { key: "Enter" });
    control.focus();
    expect(document.activeElement).toBe(control);
    expect(onCommit).not.toHaveBeenCalled();
    expect(onEvent).not.toHaveBeenCalled();

    rerender(
      <ConformanceProbe
        label="State"
        defaultValue="value"
        stale
        onCommit={onCommit}
        onEvent={onEvent}
      />,
    );
    expect(container.firstElementChild?.getAttribute("data-state")).toBe(
      "stale",
    );
    fireEvent.keyDown(control, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onEvent).toHaveBeenCalledOnce();
    onCommit.mockClear();
    onEvent.mockClear();
    rerender(
      <ConformanceProbe
        label="State"
        defaultValue="value"
        error="bad"
        onValueChange={onValueChange}
        onCommit={onCommit}
        onEvent={onEvent}
      />,
    );
    control = screen.getByRole("textbox", { name: "State" });
    expect(container.firstElementChild?.getAttribute("data-state")).toBe(
      "error",
    );
    fireEvent.change(control, { target: { value: "allowed" } });
    fireEvent.keyDown(control, { key: "Enter" });
    expect(onValueChange).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onEvent).toHaveBeenCalledTimes(2);
  });

  it("inherits RTL direction without adding a portal", () => {
    const { container } = render(
      <div dir="rtl">
        <ConformanceProbe label="RTL" />
      </div>,
    );
    const probe = container.querySelector(
      '[data-artemis-component="conformance-probe"]',
    );
    expect(probe?.closest('[dir="rtl"]')).not.toBeNull();
    expect(container.querySelector("[data-artemis-portal]")).toBeNull();
  });
});
