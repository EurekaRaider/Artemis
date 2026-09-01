// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  CONFORMANCE_PROBE_ACCESSIBLE_NAME_ERROR,
  ConformanceProbe,
} from "../src/conformance.js";

describe("ConformanceProbe behavior harness", () => {
  it.each(["", "  \t\n  "])(
    "fails closed before rendering an empty accessible label (%j)",
    (label) => {
      expect(() => render(<ConformanceProbe label={label} />)).toThrowError(
        CONFORMANCE_PROBE_ACCESSIBLE_NAME_ERROR,
      );
    },
  );

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
    const { rerender, container } = render(
      <ConformanceProbe
        label="State"
        defaultValue="value"
        disabled
        onValueChange={onValueChange}
        onCommit={onCommit}
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

    rerender(
      <ConformanceProbe
        label="State"
        defaultValue="value"
        busy
        onValueChange={onValueChange}
        onCommit={onCommit}
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

    rerender(
      <ConformanceProbe
        label="State"
        defaultValue="value"
        stale
        onCommit={onCommit}
      />,
    );
    expect(container.firstElementChild?.getAttribute("data-state")).toBe(
      "stale",
    );
    fireEvent.keyDown(control, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledOnce();
    onCommit.mockClear();
    rerender(
      <ConformanceProbe
        label="State"
        defaultValue="value"
        error="bad"
        onValueChange={onValueChange}
        onCommit={onCommit}
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
